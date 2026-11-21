"""服务器端半自动升级器（宿主机运行，stdlib only）。

流程（由 systemd timer 每分钟触发，或 --version 手动触发）：
  1. 读取触发文件 <root>/data/upgrade/upgrade-request.json（由容器内管理 API 写入；
     容器 /app/data 与宿主 <root>/data 是同一 RW bind，无需额外通信机制）
  2. 从 GitHub Release（公开仓库，匿名）下载 payload.tar.gz / manifest.json /
     deploy_host.py / release-info.json
  3. 校验 tar SHA256（release-info）→ 落盘 releases/<版本>-<日期>/
  4. 调 deploy_host.py deploy（全套安全网：manifest 校验/快照/增量派生镜像/
     离线自检/保 inode 写入/失败自动回滚）
  5. 结果写 <root>/data/upgrade/upgrade-result.json → 删除触发文件

用法：
  python3 server_upgrader.py                # 读触发文件，无则静默退出
  python3 server_upgrader.py --version 1.16.0   # 手动指定版本
  python3 server_upgrader.py --status       # 只打印当前版本/GitHub latest/待处理状态
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

GITHUB_REPO = "yu7777777777/image-workbench"
DEFAULT_ROOT = "/opt/chatgpt2api-trial-20261029"
DEFAULT_CONTAINER = "chatgpt2api-trial-app"
TRIGGER_REL = "data/upgrade/upgrade-request.json"
RESULT_REL = "data/upgrade/upgrade-result.json"
LOCK_REL = "data/upgrade/upgrade-running.lock"
UPGRADER_ASSETS = ("payload.tar.gz", "manifest.json", "release-info.json", "deploy_host.py")


def log(stage: str, **fields: object) -> None:
    print(json.dumps({"stage": stage, **fields}, ensure_ascii=False), flush=True)


def http_json(url: str, timeout: int = 15) -> dict:
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "chatgpt2api-upgrader"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def http_download(url: str, target: Path, timeout: int = 300) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "chatgpt2api-upgrader"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(target, "wb") as handle:
        shutil.copyfileobj(resp, handle)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_version(root: Path) -> str:
    result = subprocess.run(
        ["docker", "exec", DEFAULT_CONTAINER, "/bin/sh", "-c", "cat /app/VERSION"],
        capture_output=True, text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def latest_release_version(repo: str) -> str | None:
    data = http_json(f"https://api.github.com/repos/{repo}/releases/latest")
    tag = str(data.get("tag_name") or "").lstrip("v")
    return tag or None


def download_release_assets(repo: str, version: str, output_dir: Path) -> dict:
    release = http_json(f"https://api.github.com/repos/{repo}/releases/tags/v{version}")
    assets = {asset["name"]: asset["browser_download_url"] for asset in release.get("assets", [])}
    missing = [name for name in UPGRADER_ASSETS if name not in assets]
    if missing:
        raise RuntimeError(f"Release v{version} 缺少产物: {', '.join(missing)}")
    for name in UPGRADER_ASSETS:
        http_download(assets[name], output_dir / name)
    info = json.loads((output_dir / "release-info.json").read_text(encoding="utf-8"))
    expected = info.get("tar_sha256")
    actual = sha256_of(output_dir / "payload.tar.gz")
    if expected and actual != expected:
        raise RuntimeError(f"payload.tar.gz SHA256 不符: {actual} != {expected}")
    return {"tar_sha256": actual, "tar_bytes": (output_dir / "payload.tar.gz").stat().st_size}


def run_deploy(root: Path, release_dir: Path, container: str) -> dict:
    # deploy_host 的配置与 scripts/deploy/deploy_config.json 保持一致
    host_cfg = {
        "root": str(root),
        "container": container,
        "service": "app",
        "health_url": "http://127.0.0.1:3000/health?format=json",
        "disk_min_gb": 4,
        "image_prefix": "chatgpt2api",
        "keep_images": 0,
    }
    config_path = release_dir / "host-config.json"
    config_path.write_text(json.dumps(host_cfg), encoding="utf-8")
    result = subprocess.run(
        ["python3", str(release_dir / "deploy_host.py"),
         "--config", json.dumps(host_cfg),
         "--release", str(release_dir),
         "--mode", "deploy"],
        capture_output=True, text=True, timeout=900,
    )
    output = (result.stdout or "") + (result.stderr or "")
    (release_dir / "upgrader-run.log").write_text(output, encoding="utf-8")
    if result.returncode != 0:
        raise RuntimeError(f"deploy_host 退出码 {result.returncode}（详见 upgrader-run.log）")
    for line in output.splitlines():
        if line.startswith('{"deployed"'):
            return json.loads(line)
    raise RuntimeError("deploy_host 未输出部署结果")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=DEFAULT_ROOT)
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--repo", default=GITHUB_REPO)
    parser.add_argument("--version", help="手动指定版本（跳过触发文件）")
    parser.add_argument("--status", action="store_true", help="只打印状态")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    trigger_path = root / TRIGGER_REL
    result_path = root / RESULT_REL
    lock_path = root / LOCK_REL

    if args.status:
        print(json.dumps({
            "current_version": current_version(root),
            "latest_version": latest_release_version(args.repo),
            "request_pending": trigger_path.exists(),
            "last_result": json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else None,
        }, ensure_ascii=False))
        return 0

    # 防重入锁
    if lock_path.exists():
        print("已有升级在执行中（upgrade-running.lock），本次跳过")
        return 0

    version = args.version
    if not version:
        if not trigger_path.exists():
            return 0  # 无触发请求，静默退出（timer 每分钟跑一次）
        try:
            request = json.loads(trigger_path.read_text(encoding="utf-8"))
            version = str(request.get("version") or "").strip()
        except Exception as exc:
            trigger_path.unlink(missing_ok=True)
            print(f"触发文件损坏，已删除: {exc}")
            return 1
    if not version:
        trigger_path.unlink(missing_ok=True)
        return 0

    lock_path.write_text(str(time.time()), encoding="utf-8")
    started = time.time()
    try:
        log("upgrade_start", version=version)
        date = time.strftime("%Y%m%d")
        release_dir = root / "releases" / f"{version}-{date}"
        if release_dir.exists():
            shutil.rmtree(release_dir)
        release_dir.mkdir(parents=True, mode=0o700)

        downloaded = download_release_assets(args.repo, version, release_dir)
        log("assets_downloaded", **downloaded)

        deploy_result = run_deploy(root, release_dir, args.container)

        result_payload = {
            "status": "success",
            "version": version,
            "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "elapsed_secs": round(time.time() - started, 1),
            **deploy_result,
        }
        result_path.write_text(json.dumps(result_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log("upgrade_success", version=version, elapsed_secs=result_payload["elapsed_secs"])
        return 0
    except Exception as exc:
        result_path.write_text(json.dumps({
            "status": "failed",
            "version": version,
            "finished_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "error": str(exc)[:500],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        log("upgrade_failed", version=version, error=str(exc)[:300])
        return 1
    finally:
        trigger_path.unlink(missing_ok=True)
        lock_path.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
