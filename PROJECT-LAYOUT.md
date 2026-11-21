# 项目目录分类说明（哪些同步 GitHub、哪些只留本地）

> 本文档随仓库分发，帮助你快速判断：本地哪些文件**能删**（可随时重新生成）、哪些**必须保留**（数据/密钥/记录）、哪些**会同步到 GitHub**。
> 判定规则以 `.gitignore` 为准——`git ls-files` 列出的就是会同步的内容。

## 一、会同步到 GitHub（仓库内容，可随时在任何机器 clone 重建）

| 路径 | 说明 |
|---|---|
| `main.py` / `api/` / `services/` / `utils/` | 后端全部源码（FastAPI） |
| `web/src/` | 管理壳/画廊外壳前端源码（Next.js，构建产物 out/ 不同步） |
| `playground/src/` | 多模式图片工作台源码（Vite，构建产物 dist/ 不同步） |
| `scripts/` | 部署工具（deploy.py/build_release.py/deploy_host.py/server_upgrader.py 等）与辅助脚本 |
| `test/` | 后端 pytest 与前端 vitest 测试 |
| `Dockerfile` / `docker-compose*.yml` / `docker/` | 容器构建与编排 |
| `VERSION` / `CHANGELOG.md` / `RELEASE-NOTES.md` | 版本三件套 |
| `config.example.json` / `.env.example` | 脱敏配置模板（真实配置不同步） |
| `pyproject.toml` / `uv.lock` / `web/bun.lock` / `playground/package-lock.json` / `bun.lock` | 依赖锁 |
| `PROJECT-LAYOUT.md` / `WORKFLOW.md` / `README.md` / `LICENSE` | 说明文档 |
| `.github/workflows/release.yml` | 打 tag 自动构建并发布 GitHub Release |

## 二、仅本地必留（不同步，删了会出事）

| 路径 | 内容 | 为什么必留 |
|---|---|---|
| `data/` | **生产数据库**（accounts.db 等）+ 生成的图片 | 全部用户数据与生图产物，误删不可恢复（部署工具会自动备份） |
| `config.json` | 真实运行配置，含 **auth-key** | 登录与 API 鉴权凭据 |
| `服务器连接.txt` | SSH 凭据（host/user/password） | 部署工具的连接来源；泄露=服务器被控制 |
| `账号备份/` | 账号导出备份 | 手动备份的账号资产 |
| `docs/deployment/`（123 份） | 历史部署/验收/事故记录（含服务器 IP） | 运维审计与复盘依据；含敏感信息故不入库 |
| `docs/` 其余（DEVELOPMENT.md 等） | 开发约束、内部运维文档（含服务器信息） | 同上 |
| `待上线与功能规划清单.md` / `项目结构.md` | 规划与结构文档（含服务器信息） | 内部工作文档 |
| `agents.md` | AI 助手工作规则（含服务器信息） | 同上 |

## 三、仅本地可删（随时可重新生成或为临时产物）

| 路径 | 内容 | 删除后果 |
|---|---|---|
| `web/out/`、`playground/dist/` | 前端构建产物 | `bun run build` 重新生成 |
| `web/node_modules/`、`playground/node_modules/`、`.venv/` | 依赖 | `bun install` / `uv sync` 重新生成 |
| `out/` | 部署打包产物与历史归档 | `deploy.py build` 重新生成；`03-部署中间产物/` 是历史归档，确认无用可删 |
| `logs/` | 运行日志 | 可删（排障价值随时间降低） |
| `pwrun/`、`.codex/`、`.zcode/` | AI 会话遗留脚本/状态 | 历史参考，可删 |
| `r.txt`、`.task_*.md`、`.pytest_cache/` | 临时文件 | 可删 |
| `web/.next/`、`web/test-results/`、`web/next-build.log` | 构建缓存/测试输出 | 可删 |
| `data/upgrade/` | 升级触发/结果文件（升级器自动清理） | 可删（升级器自管） |

## 四、注意

- `config.json` 与 `data/` 在 `.gitignore` 中，**永远不会**被提交——不要为了"备份到 GitHub"把它们加回跟踪（密钥泄露）。备份走 `账号备份/` 或部署工具的 SQLite 一致性备份。
- `docs/` 整体不入库的原因：其中 123 份部署记录含服务器 IP 等敏感信息。若确有文档要公开，单独移到仓库白名单路径并在 `.gitignore` 加反排除。
