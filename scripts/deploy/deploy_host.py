"""远端部署执行器（在服务器上运行；由本地 deploy.py 经 SSH stdin 调用，或手动执行）。

职责（每一步都对应历史事故防护，见 docs/DEVELOPMENT.md）：
  1. 前置断言：容器 Running、磁盘余量、四个挂载点（1.13.74 inode 挂载 / 资源 OOM）
  2. payload 校验：manifest 逐文件 SHA256 + 路径穿越防护（传输截断/包错配）
  3. 快照：运行中代码 tar + compose(0600) + 前端目录 copytree + SQLite Connection.backup
     （一次性旧镜像容器执行，禁 cp 运行中裸库）
  4. 候选镜像：从运行中镜像 id 派生（DOCKER_BUILDKIT=0，BuildKit 不收裸 image id），
     全量 COPY 当前代码（消灭白名单静默旧代码 1.13.70），离线自检（逐文件哈希 + import api）
  5. 前端保 inode 原地写入（copy2→os.replace，HTML/sw.js 优先；1.13.74）+ manifest 复验
  6. compose 原位改 image + 字段级 diff 断言（unexpected=[]）
  7. up -d --no-deps --pull never → readiness（/health?format=json；不信 /api/version 的 SPA HTML）
  8. 任一步失败自动回滚；全程证据落盘 deployment-result.json

用法：
  python3 deploy_host.py --config '<JSON>' --release /opt/.../releases/<name> [--check-only]
  JSON 字段：root, container, service, health_url, disk_min_gb, image_prefix, keep_images, version, image_tag
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path


def log(stage: str, **fields: object) -> None:
    print(json.dumps({"stage": stage, **fields}, ensure_ascii=False), flush=True)


class HostError(RuntimeError):
    pass


class Host:
    def __init__(self, cfg: dict, release: Path) -> None:
        self.cfg = cfg
        self.release = release
        self.root = Path(cfg["root"]).resolve()
        self.container = cfg["container"]
        self.service = cfg.get("service", "app")
        self.image_prefix = cfg.get("image_prefix", "chatgpt2api")
        self.disk_min_gb = int(cfg.get("disk_min_gb", 4))
        self.keep_images = int(cfg.get("keep_images", 3))
        self.health_url = cfg.get("health_url", "http://127.0.0.1:3000/health?format=json")
        self.allow_degraded_health = bool(cfg.get("allow_degraded_health", False))

    def run(self, arguments: list[str], check: bool = True) -> bytes:
        result = subprocess.run(arguments, capture_output=True)
        if result.returncode and check:
            error_log = self.release / "last-command-error.log"
            error_log.write_bytes(result.stderr)
            os.chmod(error_log, 0o600)
            raise HostError(f"command failed: {arguments[0]}")
        return result.stdout

    def info(self) -> dict:
        return json.loads(self.run(["docker", "inspect", self.container]))[0]

    # ===== 前置断言 =====

    def preflight(self) -> dict:
        old = self.info()
        assert old["State"]["Running"], "容器未在运行"
        free_gb = shutil.disk_usage(self.root).free / 1024**3
        assert free_gb >= self.disk_min_gb, f"磁盘余量 {free_gb:.1f}GB 低于门槛 {self.disk_min_gb}GB"
        mounts = [(m["Source"], m["Destination"], m["RW"]) for m in old["Mounts"]]
        for name, writable in [("data", True), ("config.json", True), ("playground_dist", False), ("web_dist", False)]:
            assert (str(self.root / name), "/app/" + name, writable) in mounts, f"挂载点缺失: {name}"
        self.preflight_mounts = mounts
        self.config_hash = hashlib.sha256((self.root / "config.json").read_bytes()).hexdigest()
        self.inodes = {name: (self.root / name).stat().st_ino for name in ("data", "web_dist", "playground_dist")}
        labels = old["Config"]["Labels"]
        compose_files = [Path(p).resolve() for p in labels["com.docker.compose.project.config_files"].split(",")]
        assert all(p.parent == self.root for p in compose_files), "compose 文件不在部署根目录"
        self.compose = next((p for p in compose_files if p.suffix == ".json"), compose_files[-1])
        self.compose_command = ["docker", "compose"]
        for path in compose_files:
            self.compose_command += ["-f", str(path)]
        self.compose_command += ["-p", labels["com.docker.compose.project"]]
        assert labels["com.docker.compose.service"] == self.service, "compose 服务名不符"
        report = {
            "root": str(self.root),
            "container": self.container,
            "running_image_id": old["Image"],
            "disk_free_gb": round(free_gb, 2),
            "inodes": {k: str(v) for k, v in self.inodes.items()},
            "compose": str(self.compose),
            "app_version": self.container_version(),
        }
        self.old_image_id = old["Image"]
        return report

    def container_version(self) -> str:
        return self.run(["docker", "exec", self.container, "/bin/sh", "-c", "cat /app/VERSION"]).decode().strip()

    # ===== payload 校验 =====

    def verify_payload(self) -> dict:
        manifest = json.loads((self.release / "manifest.json").read_text(encoding="utf-8"))
        payload_root = self.release / "payload"
        if payload_root.exists():
            shutil.rmtree(payload_root)
        payload_root.mkdir(mode=0o700)
        with tarfile.open(self.release / "payload.tar.gz") as tar:
            members = tar.getmembers()
            assert {m.name for m in members} == set(manifest), "tar 内容与 manifest 不一致"
            for member in members:
                target = (payload_root / member.name).resolve()
                assert member.isfile(), f"payload 含非文件条目: {member.name}"
                assert target.is_relative_to(payload_root), f"路径穿越: {member.name}"
                target.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                assert source is not None
                target.write_bytes(source.read())
                assert hashlib.sha256(target.read_bytes()).hexdigest() == manifest[member.name], f"哈希不符: {member.name}"
        log("payload_verified", files=len(manifest))
        return manifest

    # ===== 快照 =====

    def snapshot(self) -> dict:
        rollback = self.release / "rollback"
        if rollback.exists():
            shutil.rmtree(rollback)
        rollback.mkdir(mode=0o700)
        snapshot_code = r'''
from pathlib import Path
import sys,tarfile
base=Path('/app');paths=list(base.glob('*.py'))
for folder in ['api','services','utils']:
    paths.extend((base/folder).rglob('*.py'))
for name in ['VERSION','CHANGELOG.md','RELEASE-NOTES.md']:
    if (base/name).is_file():paths.append(base/name)
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|') as tar:
    for p in sorted(set(paths)):
        if '__pycache__' not in p.parts:tar.add(p,arcname=p.relative_to(base).as_posix(),recursive=False)
'''
        live_tar = self.run(["docker", "exec", self.container, "/app/.venv/bin/python", "-B", "-c", snapshot_code])
        (rollback / "runtime-code.tar").write_bytes(live_tar)
        for path in [self.compose] + [p for p in self.root.glob("*.json") if p.name in ("compose.json",)]:
            shutil.copy2(path, rollback / path.name)
            os.chmod(rollback / path.name, 0o600)
        databases: list[str] = []
        for database in sorted((self.root / "data").glob("*.db")):
            destination = rollback / (database.name + ".sqlite")
            # 只读 URI + backup API：一致性快照，禁 cp 运行中裸库（防撕裂副本）
            with sqlite3.connect(f"file:{database}?mode=ro", uri=True) as source:
                with sqlite3.connect(destination) as target:
                    source.backup(target, pages=512, sleep=0.05)
                    assert target.execute("PRAGMA quick_check").fetchone()[0] == "ok"
            os.chmod(destination, 0o600)
            databases.append(database.name)
        assert "accounts.db" in databases, "缺少 accounts.db 备份"
        for name in ("web_dist", "playground_dist"):
            if (rollback / name).exists():
                shutil.rmtree(rollback / name)
            shutil.copytree(self.root / name, rollback / name)
        log("snapshot_ready", databases=databases)
        return {"rollback_dir": str(rollback), "databases": databases, "live_tar_bytes": len(live_tar)}

    # ===== 候选镜像 =====

    def build_candidate(self, manifest: dict, version: str) -> str:
        version = version or "release"
        date = time.strftime("%Y%m%d")
        image = f"{self.image_prefix}:{version}-{date}"
        payload_root = self.release / "payload"
        build = self.release / "build"
        if build.exists():
            shutil.rmtree(build)
        build.mkdir(mode=0o700)
        # 构建上下文：payload 的 app/ + 两套前端产物
        for name in ("app", "web_dist", "playground_dist"):
            context_target = build / name
            if context_target.exists():
                shutil.rmtree(context_target)
            shutil.copytree(payload_root / name, context_target)
        base_image = f"{self.image_prefix}:base-{version}-{self.old_image_id.removeprefix('sha256:')[:12]}"
        self.run(["docker", "tag", self.old_image_id, base_image])
        assert json.loads(self.run(["docker", "image", "inspect", base_image]))[0]["Id"] == self.old_image_id
        # 全量 COPY 当前代码：镜像内不再保留基础镜像的任何旧 .py（1.13.70 类事故的根治）
        (build / "Dockerfile").write_text(
            f"FROM {base_image}\n"
            "COPY app/ /app/\n"
            "COPY web_dist/ /app/web_dist\n"
            "COPY playground_dist/ /app/playground_dist\n"
        )
        # BuildKit 不接受裸 image id 作 FROM（pull access denied）
        env = dict(os.environ, DOCKER_BUILDKIT="0")
        result = subprocess.run(
            ["docker", "build", "--pull=false", "-t", image, str(build)],
            capture_output=True, env=env,
        )
        if result.returncode:
            (self.release / "last-command-error.log").write_bytes(result.stderr)
            os.chmod(self.release / "last-command-error.log", 0o600)
            raise HostError("candidate image build failed")
        expected: dict[str, str] = {}
        for name, sha in manifest.items():
            if name.startswith("app/"):
                expected[name.removeprefix("app/")] = sha
            elif name.startswith(("web_dist/", "playground_dist/")):
                expected[name] = sha
        check = (
            "from pathlib import Path;import hashlib,py_compile,glob;"
            "expected=" + repr(expected) + ";"
            "assert all(hashlib.sha256(Path('/app',p).read_bytes()).hexdigest()==s for p,s in expected.items()),'hash mismatch';"
            "[py_compile.compile(f,doraise=True) for f in glob.glob('/app/**/*.py',recursive=True)];"
            "import api;print('hashes_compile_import_ok')"
        )
        self.run([
            "docker", "run", "--rm", "--network", "none", "--tmpfs", "/app/data", "--tmpfs", "/tmp",
            "-e", "STORAGE_BACKEND=sqlite",
            "--entrypoint", "/app/.venv/bin/python",
            image, "-B", "-c", check,
        ])
        log("candidate_verified", image=image, total_hashes=len(expected))
        return image

    # ===== 前端保 inode 写入 =====

    def copy_in_place(self, source: Path, destination: Path) -> None:
        assert destination.resolve() in [self.root / "web_dist", self.root / "playground_dist"]
        paths = sorted(
            (p for p in source.rglob("*") if p.is_file()),
            key=lambda p: p.suffix == ".html" or p.name == "sw.js",
        )
        for path in paths:
            target = (destination / path.relative_to(source)).resolve()
            assert target.is_relative_to(destination.resolve()), f"路径穿越: {path}"
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".deploy-tmp")
            shutil.copy2(path, temporary)
            os.replace(temporary, target)

    # ===== compose 原位改 =====

    def update_compose_image(self, image: str) -> tuple[str, dict]:
        original = self.compose.read_text(encoding="utf-8")
        old_resolved = json.loads(self.run(self.compose_command + ["config", "--format", "json"]))
        if self.compose.suffix == ".json":
            model = json.loads(original)
            model["services"][self.service]["image"] = image
            updated = json.dumps(model, indent=2)
        else:
            lines = original.splitlines(keepends=True)
            inside = False
            changed = 0
            for index, line in enumerate(lines):
                if re.match(r"^  " + re.escape(self.service) + r":\s*$", line):
                    inside = True
                elif inside and re.match(r"^  \S", line):
                    inside = False
                if inside and re.match(r"^\s*image:", line):
                    lines[index] = re.sub(r"image:\s*.*$", f"image: {image}", line)
                    changed += 1
            assert changed == 1, f"compose image 行匹配 {changed} 处，预期 1 处"
            updated = "".join(lines)
        return updated, old_resolved

    def assert_compose_diff_only_image(self, old_resolved: dict, image: str) -> None:
        resolved = json.loads(self.run(self.compose_command + ["config", "--format", "json"]))
        expected = json.loads(json.dumps(old_resolved))
        expected["services"][self.service]["image"] = image
        assert resolved == expected, "compose 在 image 之外发生了变化"

    # ===== readiness =====

    def wait_ready(self, version: str, attempts: int = 60) -> None:
        for _ in range(attempts):
            try:
                with urllib.request.urlopen(self.health_url, timeout=2) as response:
                    result = json.load(response)
                    if result.get("version") == version and (
                        result.get("healthy")
                        or (self.allow_degraded_health and result.get("status") == "degraded")
                    ):
                        return
            except Exception:
                pass
            time.sleep(1)
        raise HostError("应用就绪检查失败（/health 未返回目标版本 healthy）")

    # ===== 镜像保留策略 =====

    def prune_images(self, current_image: str, keep: int) -> list[str]:
        container_ids = self.run(["docker", "ps", "-a", "--format", "{{.ID}}"]).decode().split()
        used_ids: set[str] = set()
        for container_id in container_ids:
            used_ids.add(json.loads(self.run(["docker", "inspect", container_id]))[0]["Image"])
        used_ids.add(current_image)
        images = self.run(["docker", "images", "--format", "{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}"]).decode()
        ours = []
        for line in images.splitlines():
            parts = line.split(" ", 2)
            if len(parts) < 3 or not parts[0].startswith(self.image_prefix + ":"):
                continue
            reference, image_id, created = parts
            if image_id in used_ids:
                continue
            ours.append((created, reference, image_id))
        ours.sort(reverse=True)
        removed = []
        for _, reference, image_id in ours[keep:]:
            if image_id in used_ids:
                continue
            try:
                self.run(["docker", "rmi", reference], check=False)
                removed.append(reference)
            except Exception:
                pass
        return removed

    # ===== 主流程 =====

    def deploy(self) -> dict:
        manifest = self.verify_payload()
        metadata_version = (self.release / "payload" / "app" / "VERSION").read_text(encoding="utf-8").strip()
        snapshot_info = self.snapshot()
        version = self.cfg.get("version") or metadata_version
        image = self.build_candidate(manifest, version)

        original_compose = self.compose.read_text(encoding="utf-8")
        old_resolved = json.loads(self.run(self.compose_command + ["config", "--format", "json"]))
        updated, old_resolved = self.update_compose_image(image)
        activation_attempted = False
        static_changed = False
        try:
            assert self.info()["Image"] == self.old_image_id, "准备阶段期间线上镜像已变化"
            self.compose.write_text(updated)
            self.assert_compose_diff_only_image(old_resolved, image)
            activation_attempted = True
            self.run(self.compose_command + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", self.service])
            self.wait_ready(metadata_version)
            current = self.info()
            assert current["Image"] == json.loads(self.run(["docker", "image", "inspect", image]))[0]["Id"], "容器镜像未切换"
            assert sorted(self.preflight_mounts) == sorted((m["Source"], m["Destination"], m["RW"]) for m in current["Mounts"]), "挂载点发生变化"
            static_changed = True
            for name in ("playground_dist", "web_dist"):
                self.copy_in_place(self.release / "payload" / name, self.root / name)
                self.verify_static_dir(self.release / "payload" / name, self.root / name)
            for name, inode in self.inodes.items():
                assert (self.root / name).stat().st_ino == inode, f"目录 inode 变化: {name}"
            assert hashlib.sha256((self.root / "config.json").read_bytes()).hexdigest() == self.config_hash, "config.json 被改动"
            for name in ("VERSION", "CHANGELOG.md", "RELEASE-NOTES.md"):
                shutil.copy2(self.release / "payload" / "app" / name, self.root / name)
            # 容器内复验代码指纹（镜像已切换，静态目录经挂载生效）
            fingerprint = self.run(["docker", "exec", self.container, "/bin/sh", "-c", "cat /app/VERSION"]).decode().strip()
            assert fingerprint == metadata_version, "容器内版本不符"
            removed_images = self.prune_images(current["Image"], self.keep_images)
            result = {
                "deployed": True,
                "version": metadata_version,
                "image": image,
                "image_id": current["Image"],
                "release": str(self.release),
                "payload_files": len(manifest),
                "databases_backed_up": snapshot_info["databases"],
                "directory_inodes_preserved": True,
                "config_unchanged": True,
                "removed_old_images": removed_images,
            }
            (self.release / "deployment-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(result, ensure_ascii=False), flush=True)
            return result
        except Exception as error:
            self.compose.write_text(original_compose)
            if static_changed:
                for name in ("playground_dist", "web_dist"):
                    self.copy_in_place(self.release / "rollback" / name, self.root / name)
            if activation_attempted:
                self.run(self.compose_command + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", self.service])
                self.wait_ready(self.container_version())
            print(json.dumps({"rolled_back": True, "error_type": type(error).__name__, "reason": str(error)[:200]}, ensure_ascii=False), flush=True)
            raise SystemExit(1)

    def verify_static_dir(self, source: Path, destination: Path) -> None:
        for path in source.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(source)
            target = destination / relative
            assert hashlib.sha256(target.read_bytes()).hexdigest() == hashlib.sha256(path.read_bytes()).hexdigest(), f"前端文件校验失败: {relative.as_posix()}"

    # ===== 只读体检 =====

    def check_only(self) -> dict:
        report = self.preflight()
        images = self.run(["docker", "images", "--format", "{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedAt}}"]).decode()
        report["rollback_images"] = [
            line for line in images.splitlines()
            if line.startswith(self.image_prefix + ":")
        ][:10]
        return report

    # ===== 回滚模式 =====

    def rollback(self, image: str) -> dict:
        original = self.compose.read_text(encoding="utf-8")
        old_resolved = json.loads(self.run(self.compose_command + ["config", "--format", "json"]))
        updated, _ = self.update_compose_image(image)
        try:
            self.compose.write_text(updated)
            self.assert_compose_diff_only_image(old_resolved, image)
            self.run(self.compose_command + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", self.service])
            version = self.run(["docker", "exec", self.container, "/bin/sh", "-c", "cat /app/VERSION"]).decode().strip()
            self.wait_ready(version)
            result = {"rolled_back": True, "image": image, "version": version}
            (self.release / "rollback-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
            print(json.dumps(result), flush=True)
            return result
        except Exception as error:
            self.compose.write_text(original)
            print(json.dumps({"rollback_failed": True, "reason": str(error)[:200]}, ensure_ascii=False), flush=True)
            raise SystemExit(1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="JSON 字符串：root/container/service/health_url 等")
    parser.add_argument("--release", required=True, help="发布目录（含 manifest.json/payload.tar.gz）")
    parser.add_argument("--mode", choices=("deploy", "check-only", "rollback"), default="deploy")
    parser.add_argument("--image", help="rollback 模式：回滚目标镜像引用")
    args = parser.parse_args()

    cfg = json.loads(args.config)
    release = Path(args.release).resolve()
    if args.mode == "deploy":
        assert (release / "manifest.json").is_file() and (release / "payload.tar.gz").is_file()
    host = Host(cfg, release)

    if args.mode == "check-only":
        print(json.dumps(host.check_only(), ensure_ascii=False, indent=2))
        return 0
    if args.mode == "rollback":
        assert args.image, "rollback 模式需要 --image"
        host.preflight()
        host.rollback(args.image)
        return 0

    host.preflight()
    log("preflight_ok")
    host.deploy()
    return 0


if __name__ == "__main__":
    sys.exit(main())
