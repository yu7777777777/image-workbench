# 一键部署工具

把历史上分散在 100+ 个一次性脚本里的发布流程收敛为**单一入口 + 稳定远端执行器**。
安全网全部自动化（不砍任何检查），每一步都对应 `docs/DEVELOPMENT.md` 里的历史事故防护。

## 快速上手

```bash
python scripts/deploy/deploy.py check          # 只读体检（白名单/凭据/工具链/版本一致性）
python scripts/deploy/deploy.py build          # 构建前端 + 全量 payload 打包（~2MB）
python scripts/deploy/deploy.py upload         # SFTP 直传（失败打印 115 中转手动指引）
python scripts/deploy/deploy.py release        # 服务器端执行发布（校验/快照/派生/写入/回滚）
python scripts/deploy/deploy.py status         # 服务器只读体检
python scripts/deploy/deploy.py rollback --image chatgpt2api:1.14.1-20261120
python scripts/deploy/deploy.py all --yes      # 一条龙（破坏性阶段跳过交互确认）
```

构建逃逸门：`build --allow-failing-tests`（仅限已甄别为历史遗留的 vitest 失败）；
`build --skip-web / --skip-playground` 复用现有产物。

## 前置条件

- `服务器连接.txt` 在项目根目录（冒号分隔行，第 5-8 个字段 = 新机 host:port:user:password）。
  缺失时 `upload/release` 会明确报错；也可走 115 中转手动通道（upload 失败时打印逐步指引）。
- 本地 `bun`（可用 `deploy_config.json` 的 `bun_path` 指定完整路径）；`paramiko`（`pip install paramiko`）。
- 服务器磁盘余量 ≥4GB；回退镜像未被删除。

## 安全网清单（自动化了什么）

| 步骤 | 防的事故 |
|---|---|
| `check_whitelist.py`：Dockerfile COPY 清单 vs git 跟踪 .py，缺失即报告 | 1.13.56/1.13.61/1.13.70 白名单静默旧代码 |
| payload 携带**全部当前代码**（不再增量挑文件） | "漏带文件"整类风险 |
| manifest 逐文件 SHA256 + 路径穿越防护 | 传输截断/包版本错配 |
| 快照：代码 tar + compose(0600) + SQLite `Connection.backup()` + 前端 copytree | 备份撕裂、回滚材料不全 |
| 增量镜像派生（`DOCKER_BUILDKIT=0`，BuildKit 不收裸 image id）+ 离线自检（逐文件哈希 + py_compile + `import api`） | 构建成功≠能启动（1.13.56）、白名单静默旧代码（1.13.70） |
| 前端保 inode 原地写（copy2→os.replace，资源先行、HTML/sw 收尾）+ 逐文件复验 + inode 断言 | 1.13.74 inode 挂载坑（两度踩坑） |
| compose JSON 解析改 image + `docker compose config` 字段级 diff 断言 | "顺手多改/漏改" |
| readiness 用 `/health?format=json` + 容器内 `/app/VERSION` 指纹 | `/api/version` 返回 SPA HTML 的假通过 |
| config.json 哈希断言不变 | 1.14.0 inode 锁定事故 |
| 任一步失败自动回滚 + `deployment-result.json` 证据包 | 人工点检差错面（1.14.1 当天两次统计口径撤回） |
| 镜像保留策略（默认保留最近 3 个未使用镜像） | 磁盘耗尽（30G 盘曾剩 9.8G） |

## 产物与证据

- 本地：`out/deploy/<版本>-<日期>/`（payload.tar.gz / manifest.json / release-info.json）
- 服务器：`releases/<版本>-<日期>/`（含 `deployment-result.json`、`rollback/` 快照、错误日志 0600）
- 独立复核人直接读 `deployment-result.json`（哈希/inode/冒烟/资源）即可完成验收，不必逐项 SSH 重查。

## 与旧流程的关系

- `.codex/` 下的历史一次性脚本不再使用（保留仅作参考）；
- `docs/DEVELOPMENT.md`「更新流程」的传统 6 步保留用于手工发布/排查；
- 后续可选轨道：GitHub Actions 构建完整镜像推 GHCR、服务器 pull（涉及基础镜像重建，需单独一轮验证，暂不启用）。

## 已知事项

- vitest 门：playground 现有 19 个历史遗留失败用例（已 stash 甄别，非新引入）；
  已甄别后可用 `--allow-failing-tests` 通过构建门，根治请另行处理。
- Dockerfile 白名单当前缺 23 个跟踪 .py（守护脚本会列出）——只影响"从零构建镜像"路径，
  日常部署的全量 payload 不受影响；补齐前不要用 `docker build -f Dockerfile` 从零构建。
