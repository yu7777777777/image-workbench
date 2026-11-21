"""Dockerfile 白名单守护。

历史事故：白名单漏文件的 .py 不会报错，镜像静默保留基础镜像（refresh-20260920）里的旧代码
（1.13.56 启动崩溃 / 1.13.61 errors.py+image_inputs.py 未生效 / 1.13.70 edits 必然 500）。
本脚本把"漏文件"变成显式报告：
  - missing  ：git 跟踪的 .py 不在 Dockerfile 白名单 → 从零构建镜像时会保留基础镜像旧版本
  - ghost    ：白名单引用了已不存在的文件 → docker build 直接失败
注意：日常部署走 scripts/deploy 的"全量 payload"（不受白名单影响）；本检查守护的是
`docker build -f Dockerfile` 从零构建镜像这条路径，也是白名单卫生的日常体检。

用法：
  python scripts/deploy/check_whitelist.py            # 退出码 0/1
  python scripts/deploy/check_whitelist.py --json     # 机读输出
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CODE_DIRS = ("api", "services", "utils")
ENTRY_FILES = ("main.py",)

COPY_RE = re.compile(r"^COPY\s+(.+?)\s+/app/", re.MULTILINE)
TARGET_RE = re.compile(r"^(?:api|services|utils)/[A-Za-z0-9_/.-]+$")


def tracked_py_files() -> set[str]:
    result = subprocess.run(
        ["git", "ls-files", "main.py", "api", "services", "utils"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    files = set()
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line.endswith(".py"):
            continue
        if line == "main.py" or line.startswith(CODE_DIRS):
            files.add(line)
    return files


def whitelist_py_files() -> set[str]:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    files: set[str] = set()
    for copy_line in COPY_RE.findall(dockerfile):
        for token in copy_line.split():
            if token.startswith("--"):
                continue
            if not TARGET_RE.match(token):
                continue
            if token.endswith(".py"):
                files.add(token)
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()

    tracked = tracked_py_files()
    whitelisted = whitelist_py_files()

    missing = sorted(tracked - whitelisted)
    ghosts = sorted(whitelisted - tracked)

    if args.json:
        print(json.dumps({
            "tracked_py": len(tracked),
            "whitelisted_py": len(whitelisted),
            "missing_from_whitelist": missing,
            "ghost_entries": ghosts,
            "ok": not missing and not ghosts,
        }, ensure_ascii=False, indent=2))
        return 0 if not missing and not ghosts else 1

    print(f"git 跟踪 .py：{len(tracked)} 个；Dockerfile 白名单 .py：{len(whitelisted)} 个")
    if missing:
        print(f"\n[!] {len(missing)} 个跟踪文件不在白名单（从零构建镜像时会静默保留基础镜像旧代码）：")
        for name in missing:
            print(f"  - {name}")
        print("\n说明：日常部署走 scripts/deploy 全量 payload，不受此影响；")
        print("执行 docker build -f Dockerfile 从零构建前，请把上述文件补进 Dockerfile COPY 清单。")
    if ghosts:
        print(f"\n[!] {len(ghosts)} 个白名单条目已无对应跟踪文件（docker build 会失败）：")
        for name in ghosts:
            print(f"  - {name}")
    if not missing and not ghosts:
        print("白名单完整，无差异。")
    return 0 if not missing and not ghosts else 1


if __name__ == "__main__":
    sys.exit(main())
