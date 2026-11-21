"""构建并打包全量发布 payload。

payload 设计：不再是"增量挑文件"，而是携带**全部当前代码**（main.py + api/ services/ utils/
全部跟踪 .py + VERSION/CHANGELOG/RELEASE-NOTES）与两套前端产物，彻底消灭
"漏带文件→静默旧代码"这一类事故（1.13.56/1.13.61/1.13.70）。
包体 ~2MB（依赖都在服务器的基础镜像里），全量代价可忽略。

产物（out/deploy/<版本>-<日期>/）：
  payload.tar.gz   条目：app/<相对 /app 路径>、web_dist/<…>、playground_dist/<…>
  manifest.json    {相对条目名: sha256}
  release-info.json 元信息（版本、时间、文件数、总大小）

用法：
  python scripts/deploy/build_release.py            # 构建+打包
  python scripts/deploy/build_release.py --skip-web # 只重建 playground
  python scripts/deploy/build_release.py --skip-playground
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_common import load_config, run_command, app_payload_files_list  # noqa: E402


def build_playground(cfg: dict, skip: bool, allow_failing_tests: bool = False) -> Path:
    dist = ROOT / "playground" / "dist"
    if skip:
        assert dist.is_dir(), "playground/dist 不存在，无法跳过构建"
        return dist
    bun = os.environ.get("DEPLOY_BUN") or cfg.get("bun_path", "bun")
    flags = cfg.get("playground_flags", {})
    test_result = run_command([bun, "run", "test"], cwd=ROOT / "playground", desc="playground vitest 门", check=False)
    if test_result.returncode != 0:
        if allow_failing_tests:
            print("[警告] vitest 存在失败用例，已按 --allow-failing-tests 继续。请确认失败均为已知历史遗留。")
        else:
            raise SystemExit(
                "[失败] playground vitest 存在失败用例。"
                "如已甄别为已知历史遗留，可用 --allow-failing-tests 继续；否则请先修复。"
            )
    env = dict(os.environ)
    for key, value in flags.items():
        env[key] = value
    run_command([bun, "run", "build"], cwd=ROOT / "playground", desc="playground 构建（公开开关自动注入）", env=env)
    assert dist.is_dir(), "playground 构建后未找到 dist/"
    return dist


def build_web(cfg: dict, skip: bool) -> Path:
    out = ROOT / "web" / "out"
    if skip:
        assert out.is_dir(), "web/out 不存在，无法跳过构建"
        return out
    bun = os.environ.get("DEPLOY_BUN") or cfg.get("bun_path", "bun")
    run_command([bun, "install", "--frozen-lockfile"], cwd=ROOT / "web", desc="web 依赖冻结安装")
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    env = dict(os.environ)
    env["NEXT_PUBLIC_APP_VERSION"] = version
    run_command([bun, "run", "build"], cwd=ROOT / "web", desc="web 构建（NEXT_PUBLIC_APP_VERSION 已注入）", env=env)
    assert out.is_dir(), "web 构建后未找到 out/"
    return out


def app_payload_files() -> list[Path]:
    return app_payload_files_list()


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def package(cfg: dict, web_out: Path, playground_dist: Path, output_root: Path | None = None) -> Path:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    date = time.strftime("%Y%m%d")
    output_dir = (output_root or (ROOT / "out" / "deploy")) / f"{version}-{date}"
    if output_dir.exists():
        shutil.rmtree(output_dir)
    (output_dir / "payload").mkdir(parents=True, exist_ok=True)

    payload_root = output_dir / "payload"
    manifest: dict[str, str] = {}

    # app/**（全部当前代码 + 元信息，COPY 到镜像 /app）
    for source in app_payload_files_list():
        relative = source.relative_to(ROOT)
        target = payload_root / "app" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        manifest[f"app/{relative.as_posix()}"] = sha256_of(target)

    # 前端产物
    for name, built in (("web_dist", web_out), ("playground_dist", playground_dist)):
        for source in sorted(built.rglob("*")):
            if not source.is_file():
                continue
            relative = source.relative_to(built)
            target = payload_root / name / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            manifest[f"{name}/{relative.as_posix()}"] = sha256_of(target)

    # 打包
    tar_path = output_dir / "payload.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for source in sorted(payload_root.rglob("*")):
            if source.is_file():
                tar.add(source, arcname=source.relative_to(payload_root).as_posix())
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    info = {
        "version": version,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "payload_files": len(manifest),
        "app_files": sum(1 for key in manifest if key.startswith("app/")),
        "web_dist_files": sum(1 for key in manifest if key.startswith("web_dist/")),
        "playground_dist_files": sum(1 for key in manifest if key.startswith("playground_dist/")),
        "tar_sha256": sha256_of(tar_path),
        "tar_bytes": tar_path.stat().st_size,
    }
    (output_dir / "release-info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    # 自检：解包复验每个文件哈希
    with tarfile.open(tar_path) as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            extracted = tar.extractfile(member)
            assert extracted is not None
            digest = hashlib.sha256(extracted.read()).hexdigest()
            assert digest == manifest[member.name], f"自检失败: {member.name}"

    print(json.dumps(info, ensure_ascii=False, indent=2))
    print(f"\n发布包已就绪：{output_dir}")
    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-web", action="store_true", help="跳过 web 构建（复用 web/out）")
    parser.add_argument("--skip-playground", action="store_true", help="跳过 playground 构建（复用 dist/）")
    parser.add_argument("--skip-tests", action="store_true", help="跳过 playground vitest 门（不建议）")
    parser.add_argument("--allow-failing-tests", action="store_true",
                        help="vitest 失败时继续（仅限已甄别为历史遗留的失败）")
    args = parser.parse_args()

    cfg = load_config()
    playground_dist = build_playground(cfg, args.skip_playground, args.allow_failing_tests)
    web_out = build_web(cfg, args.skip_web)
    package(cfg, web_out, playground_dist)
    return 0


if __name__ == "__main__":
    sys.exit(main())
