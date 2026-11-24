"""部署工具共享模块：配置加载、命令执行、payload 文件清单。"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def load_config() -> dict:
    config_path = Path(__file__).resolve().parent / "deploy_config.json"
    return json.loads(config_path.read_text(encoding="utf-8"))


def run_command(
    arguments: list[str],
    cwd: Path | None = None,
    desc: str = "",
    env: dict | None = None,
    check: bool = True,
) -> subprocess.CompletedProcess:
    printable = desc or " ".join(arguments)
    print(f"\n==> {printable}")
    result = subprocess.run(arguments, cwd=str(cwd) if cwd else None, env=env)
    if result.returncode != 0 and check:
        raise SystemExit(f"[失败] {printable}（退出码 {result.returncode}）")
    return result


def app_payload_files_list(root: Path = ROOT) -> list[Path]:
    """全部应进入镜像 /app 的当前代码文件：main.py + api/services/utils 下跟踪的 .py + 元信息。"""
    tracked = subprocess.run(
        ["git", "ls-files", "main.py", "api", "services", "utils"],
        cwd=str(root), capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    result = [root / "main.py"]
    for line in tracked:
        line = line.strip()
        if (
            line
            and line != "main.py"
            and line.endswith(".py")
            and line.split("/")[0] in ("api", "services", "utils")
            and (root / line).is_file()
        ):
            result.append(root / line)
    for name in ("VERSION", "CHANGELOG.md", "RELEASE-NOTES.md"):
        result.append(root / name)
    existing = [path for path in result if path.is_file()]
    missing = sorted(set(result) - set(existing))
    if missing:
        raise SystemExit("payload 依赖的文件不存在: " + ", ".join(str(p.relative_to(root)) for p in missing))
    return existing


def read_credentials(root: Path = ROOT, offset: int = 4, target: str = "online") -> tuple[str, str, str, str]:
    """读取 服务器连接.txt，兼容三种格式：
    - 旧格式：冒号分隔行（offset=4 取第 5-8 个字段 = 新机 host:port:user:password）
    - 单服务器：3 行 = host/user/password（端口默认 22）；4 行 = host/port/user/password
    - 双服务器（2026-11-23 起）：线上段落（3/4 行）+ 标记行「本地测试服务器」+ 测试段落（3/4 行）。
      target="online"（默认）读第一段，target="test" 读标记行之后的段落。
    查找位置：项目根目录 或 本地资料/ 目录（1.16.1 起文件归入本地资料文件夹）。
    """
    candidates = [root / "服务器连接.txt", root / "本地资料" / "服务器连接.txt"]
    credentials_path = next((p for p in candidates if p.is_file()), None)
    if credentials_path is None:
        raise FileNotFoundError(
            "未找到 服务器连接.txt（项目根目录或 本地资料/ 目录）。请恢复该文件后重试。"
        )
    lines = [line.strip() for line in credentials_path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
    if any(":" in line or "：" in line for line in lines):
        values = [
            line.split("：", 1)[1].strip() if "：" in line else line.split(":", 1)[1].strip()
            for line in lines
        ]
        if len(values) < offset + 4:
            raise SystemExit(f"服务器连接.txt 字段不足：需要至少 {offset + 4} 个冒号分隔字段，实际 {len(values)} 个")
        host, port, user, password = values[offset:offset + 4]
        return host, port, user, password
    marker = "本地测试服务器"
    if marker in lines:
        marker_index = lines.index(marker)
        blocks = {"online": lines[:marker_index], "test": lines[marker_index + 1:]}
    else:
        blocks = {"online": lines}
    if target not in blocks or not blocks[target]:
        raise SystemExit(f"服务器连接.txt 中没有目标「{target}」的凭据段落（缺少标记行「{marker}」或其后无内容）")
    block = blocks[target]
    if len(block) == 3:
        host, user, password = block
        return host, "22", user, password
    if len(block) == 4:
        host, port, user, password = block
        return host, port, user, password
    raise SystemExit(
        f"服务器连接.txt 的「{target}」段落格式无法识别（{len(block)} 行）。支持：3 行 host/user/password、4 行 host/port/user/password。"
    )
