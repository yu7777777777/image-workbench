"""一键部署本地编排入口。

子命令：
  check     只读体检：白名单守护、凭据、本地工具链、配置
  build     构建前端（开关自动注入）+ 全量 payload 打包（= build_release.py）
  upload    SFTP 直传发布包（失败自动降级：打印 115 中转手动指引）
  release   在服务器执行 deploy_host.py（校验/快照/派生镜像/自检/写入/回滚）
  rollback  回滚到指定镜像（--image）
  status    只读查看服务器状态（运行镜像/磁盘/回退镜像清单）
  all       check→build→upload→release 一条龙（破坏性阶段需 --yes）

典型用法：
  python scripts/deploy/deploy.py check
  python scripts/deploy/deploy.py build
  python scripts/deploy/deploy.py all --yes
"""
from __future__ import annotations

import argparse
import json
import shlex
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from deploy_common import load_config, read_credentials, run_command  # noqa: E402

import build_release  # noqa: E402


def release_output_dir() -> Path:
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    return ROOT / "out" / "deploy" / f"{version}-{time.strftime('%Y%m%d')}"


def ssh_client(cfg: dict):
    try:
        import paramiko
    except ImportError:
        raise SystemExit("缺少 paramiko：请先执行  pip install paramiko  （或 uv pip install paramiko）")
    host, port, user, password = read_credentials(ROOT, int(cfg.get("credentials_offset", 4)))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=int(port), username=user, password=password, timeout=30)
    return client


def remote_exec(cfg: dict, script_source: str, arguments: list[str], stream: bool = True) -> int:
    """把脚本源码经 stdin 交给远端 python3 - 执行，实时回显。"""
    client = ssh_client(cfg)
    try:
        quoted = " ".join(shlex.quote(argument) for argument in arguments)
        command = f"python3 - --config {shlex.quote(json.dumps(cfg_host(cfg)))} {quoted}"
        stdin, stdout, stderr = client.exec_command(command, get_pty=False)
        stdin.write(script_source)
        stdin.channel.shutdown_write()
        while not stdout.channel.exit_status_ready():
            if stream and stdout.channel.recv_ready():
                sys.stdout.write(stdout.channel.recv(4096).decode(errors="replace"))
                sys.stdout.flush()
            time.sleep(0.05)
        remainder = stdout.read().decode(errors="replace")
        if stream and remainder:
            sys.stdout.write(remainder)
        errors = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        if code != 0 and errors:
            sys.stderr.write(errors[-4000:])
        return code
    finally:
        client.close()


def cfg_host(cfg: dict) -> dict:
    return {
        "root": cfg["root"],
        "container": cfg["container"],
        "service": cfg.get("service", "app"),
        "health_url": cfg.get("health_url"),
        "disk_min_gb": cfg.get("disk_min_gb", 4),
        "image_prefix": cfg.get("image_prefix", "chatgpt2api"),
        "keep_images": cfg.get("keep_images", 3),
    }


def ensure_release_built() -> Path:
    output_dir = release_output_dir()
    if not (output_dir / "payload.tar.gz").is_file():
        raise SystemExit(f"发布包不存在：{output_dir}。请先执行 build。")
    return output_dir


def cmd_check(cfg: dict) -> int:
    print("== 1. Dockerfile 白名单守护")
    result = run_command([sys.executable, str(ROOT / "scripts" / "deploy" / "check_whitelist.py")], desc="check_whitelist", check=False)
    whitelist_ok = result.returncode == 0
    print("\n== 2. 凭据文件")
    credentials_path = ROOT / cfg.get("credentials_file", "服务器连接.txt")
    if credentials_path.is_file():
        print(f"已找到：{credentials_path.name}（部署时读取第 {cfg.get('credentials_offset', 4) + 1}-{cfg.get('credentials_offset', 4) + 4} 个字段=新机）")
    else:
        print(f"[提示] 未找到 {credentials_path}。upload/release 需要它；恢复后重试，或走 115 中转手动通道（upload 失败时会打印指引）。")
    print("\n== 3. 本地工具链")
    bun = cfg.get("bun_path", "bun")
    import shutil
    print(f"bun: {'找到' if shutil.which(bun) else '未在 PATH（可用 deploy_config.json 的 bun_path 指定完整路径）'}")
    try:
        import paramiko  # noqa: F401
        print("paramiko: 已安装")
    except ImportError:
        print("paramiko: 未安装（upload/release 需要）→ pip install paramiko")
    print("\n== 4. 版本一致性")
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    notes = (ROOT / "RELEASE-NOTES.md").read_text(encoding="utf-8")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    print(f"VERSION={version}；RELEASE-NOTES 含该版本：{f'## {version}' in notes}；CHANGELOG 含该版本：{f'# {version}' in changelog}")
    if not whitelist_ok:
        print("\n[结论] 白名单存在差异（见上）。部署走全量 payload 不受影响；如需 docker build -f Dockerfile 从零构建，请先补齐。")
    return 0


def cmd_upload(cfg: dict, output_dir: Path) -> int:
    import paramiko

    host, port, user, password = read_credentials(ROOT, int(cfg.get("credentials_offset", 4)))
    target_dir = f"{cfg['root']}/releases/{output_dir.name}"
    print(f"== SFTP 直传 → {target_dir}")
    client = ssh_client(cfg)
    try:
        client.exec_command(f"mkdir -p {shlex.quote(target_dir)}")
        sftp = client.open_sftp()
        for name in ("payload.tar.gz", "manifest.json", "release-info.json"):
            local = output_dir / name
            remote = f"{target_dir}/{name}"
            print(f"  上传 {name}（{local.stat().st_size} bytes）...")
            sftp.put(str(local), remote)
        sftp.put(str(ROOT / "scripts" / "deploy" / "deploy_host.py"), f"{target_dir}/deploy_host.py")
        sftp.close()
        print("上传完成。")
        return 0
    except Exception as error:
        print(f"\n[SFTP 失败] {error}")
        tar_sha = json.loads((output_dir / "release-info.json").read_text(encoding="utf-8"))["tar_sha256"]
        print(f"""
===== 降级为 115 中转手动通道 =====
1. 把以下两个文件上传到 115 网盘临时目录并生成直链：
   - {output_dir / 'payload.tar.gz'}
   - {output_dir / 'manifest.json'}
2. 在服务器上执行（115 CDN 对带 UA 的请求 403，必须 -A ''）：
   mkdir -p {target_dir}
   curl -A '' -o {target_dir}/payload.tar.gz '<payload.tar.gz 直链>'
   curl -A '' -o {target_dir}/manifest.json '<manifest.json 直链>'
3. 落地校验后再继续 release（脚本会再次校验）：
   echo '{tar_sha}  {target_dir}/payload.tar.gz' | sha256sum -c -
4. 把 scripts/deploy/deploy_host.py 内容粘贴到 {target_dir}/deploy_host.py
====================================""")
        return 1


def cmd_release(cfg: dict, output_dir: Path, check_only: bool = False) -> int:
    target_dir = f"{cfg['root']}/releases/{output_dir.name}"
    host_source = (ROOT / "scripts" / "deploy" / "deploy_host.py").read_text(encoding="utf-8")
    mode = "--mode check-only" if check_only else "--mode deploy"
    code = remote_exec(cfg, host_source, [mode, "--release", target_dir])
    return code


def cmd_rollback(cfg: dict, image: str, output_dir: Path | None) -> Path:
    output_dir = output_dir or release_output_dir()
    if not (output_dir / "payload.tar.gz").is_file():
        raise SystemExit("回滚需要一个本地发布目录（deploy_host.py 从这里上传）。请先 build 或指定 --release。")
    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("check")
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("--skip-web", action="store_true")
    build_parser.add_argument("--skip-playground", action="store_true")
    build_parser.add_argument("--skip-tests", action="store_true")
    build_parser.add_argument("--allow-failing-tests", action="store_true")
    subparsers.add_parser("upload")
    release_parser = subparsers.add_parser("release")
    release_parser.add_argument("--check-only", action="store_true", help="只做服务器只读预检，不发布")
    subparsers.add_parser("status")
    rollback_parser = subparsers.add_parser("rollback")
    rollback_parser.add_argument("--image", required=True)
    all_parser = subparsers.add_parser("all")
    all_parser.add_argument("--yes", action="store_true", help="跳过交互确认（自动化用）")
    all_parser.add_argument("--allow-failing-tests", action="store_true")
    args = parser.parse_args()

    cfg = load_config()

    if args.command == "check":
        return cmd_check(cfg)
    if args.command == "build":
        run_command([sys.executable, str(ROOT / "scripts" / "deploy" / "build_release.py"),
                     *(["--skip-web"] if args.skip_web else []),
                     *(["--skip-playground"] if args.skip_playground else []),
                     *(["--skip-tests"] if args.skip_tests else []),
                     *(["--allow-failing-tests"] if args.allow_failing_tests else [])], desc="build_release")
        return 0
    if args.command == "upload":
        return cmd_upload(cfg, ensure_release_built())
    if args.command == "release":
        return cmd_release(cfg, ensure_release_built(), check_only=args.check_only)
    if args.command == "status":
        return cmd_release(cfg, ensure_release_built(), check_only=True)
    if args.command == "rollback":
        output_dir = cmd_rollback(cfg, args.image, None)
        client = ssh_client(cfg)
        try:
            target_dir = f"{cfg['root']}/releases/{output_dir.name}"
            host_source = (ROOT / "scripts" / "deploy" / "deploy_host.py").read_text(encoding="utf-8")
            quoted = " ".join([shlex.quote("--mode"), "rollback", shlex.quote("--image"), args.image,
                               shlex.quote("--release"), shlex.quote(target_dir)])
            stdin, stdout, stderr = client.exec_command(f"python3 - --config {shlex.quote(json.dumps(cfg_host(cfg)))} {quoted}")
            stdin.write(host_source)
            stdin.channel.shutdown_write()
            print(stdout.read().decode(errors="replace"))
            code = stdout.channel.recv_exit_status()
            errors = stderr.read().decode(errors="replace")
            if errors:
                sys.stderr.write(errors[-4000:])
            return code
        finally:
            client.close()
    if args.command == "all":
        if cmd_check(cfg) != 0:
            return 1
        run_command([sys.executable, str(ROOT / "scripts" / "deploy" / "build_release.py"),
                     *(["--allow-failing-tests"] if args.allow_failing_tests else [])], desc="build_release 全量构建打包")
        output_dir = ensure_release_built()
        info = json.loads((output_dir / "release-info.json").read_text(encoding="utf-8"))
        print("\n===== 预检报告 =====")
        print(json.dumps(info, ensure_ascii=False, indent=2))
        print("将执行：SFTP 上传 → 服务器校验/快照/派生镜像/自检/原位写入/重启/健康检查（失败自动回滚）")
        if not args.yes:
            answer = input("确认发布？（输入 yes 继续）: ").strip().lower()
            if answer != "yes":
                print("已取消。")
                return 1
        if cmd_upload(cfg, output_dir) != 0:
            return 1
        return cmd_release(cfg, output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
