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

## 二、留在项目根目录（工程运行必需，不同步）

这些目录/文件必须保持在根目录原位——Docker、uv、Next.js、应用运行时都按固定路径读写，**挪动会把项目搞坏**：

| 路径 | 内容 | 说明 |
|---|---|---|
| `.git` / `.github` / `.gitignore` | 仓库本体与配置（历史都在 GitHub 上，本地 .git 删了也能重新 clone，但没必要） | |
| `data/` | 运行时数据（本地为开发数据；**生产数据在服务器 `/opt/.../data/`**） | 应用运行时写入 |
| `config.json` | 真实密钥（本地开发用；生产在服务器） | 容器挂载约定路径 |
| `logs/` | 运行日志 | 应用运行时写入 |
| `out/` | 部署打包产物（build_release 输出） | 可删，构建自动重建 |
| `.venv` / `web/node_modules` / `playground/node_modules` | 依赖 | install 重建 |
| `agents.md` | AI 助手工作规则 | 需在根目录（AI 工具按约定加载） |
| `.env.local` | 本地开发代理密钥 | 本地开发用 |
| `docker-compose.override.yml` | 本地模拟编排（约定路径） | |

## 三、本地资料/（不同步——工作文档、备份、凭据、历史归档）

本地资料已集中归入 **`本地资料/`** 文件夹（不同步 GitHub）：

| 子目录/文件 | 内容 |
|---|---|
| `部署记录/` | 全部历史部署/验收/事故记录（123 份，含服务器 IP）+ DEVELOPMENT.md 等内部开发文档 |
| `工作文档/` | 待上线与功能规划清单.md、项目结构.md、AI 任务简报 |
| `账号备份/` | 手动导出的账号资产 |
| `服务器连接.txt` | SSH 凭据（部署工具自动在此查找） |
| `杂项归档/` | r.txt、pwrun、.codex 历史脚本、node_modules 孤儿等临时产物 |

## 四、可随时删除的（重新生成即可）

- `web/out/`、`playground/dist/` —— 前端构建产物，`bun run build` 重建
- `web/node_modules/`、`playground/node_modules/`、`.venv/` —— 依赖，install 重建
- `out/deploy/` —— 发布包，`deploy.py build` 重建
- `logs/` —— 运行日志（排障价值随时间降低）
- `本地资料/杂项归档/` —— 历史遗留，确认无用可删
- `data/upgrade/` —— 升级触发/结果文件（升级器自管）

## 五、注意

- **`config.json` 与 `data/` 永远不要加进 Git 跟踪**（密钥与数据泄露）——备份走 `本地资料/账号备份/` 或部署工具的 SQLite 一致性备份
- **生产数据与配置在服务器** `/opt/chatgpt2api-trial-20261029/`（data/、config.json），本地仅是开发副本
- 分不清就跑 `git status`——干净 = 该同步的都同步了
