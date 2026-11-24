# 工作流程（分支 / 审核 / 发布 / 升级）

> 本项目自 1.16.0 起采用「分支 → PR → 审核 → 合并 → 打 tag → 自动构建 → 服务器半自动升级」的工作流。

## 1. 分支与审核（会话工作流）

**日常小改**：直接在 main 上提交并推送，不开分支、不占版本号。

**一个会话改动较多时**（一次 AI 协作、一个功能主题）：会话开始建一个分支（如 wip/主题），期间所有改动都在这个分支上提交；改得差不多后，一次性提交审核（PR 或让 AI 审查），确认后合并、删除分支。

要点：分支用完即删，保持分支列表干净；版本号按批次发布时才 bump（见下节）。

## 2. 发布（按批次打 tag，不是每个 PR 发一版）

改动攒到一批后再发版本：功能性更新递增 minor（1.16→1.17），修复类递增 patch（1.16.1→1.16.2）。

1. 更新 `VERSION`，并在 `CHANGELOG.md`（技术向）与 `RELEASE-NOTES.md`（用户向，只写用户能感知的）补条目。
2. 打 tag 并推送：`git tag v1.16.1 && git push origin v1.16.1`。
3. GitHub Actions（`.github/workflows/release.yml`）自动：
   - 构建 web + playground + 全量代码 payload（277 个文件，~2.3MB）
   - 校验 payload SHA256
   - 创建 GitHub Release 并上传 `payload.tar.gz / manifest.json / release-info.json / deploy_host.py`

## 3. 服务器升级（半自动）

1. 管理页右上角「版本更新」→ 弹窗显示 当前版本 / 最新版本。
2. 检测到新版本时，管理员可见「立即升级到 X」按钮；点击后：
   - 应用写入升级触发文件（`data/upgrade/upgrade-request.json`）
   - 宿主机 `server_upgrader.py`（systemd timer 每分钟检查）自动：
     从 GitHub Release 下载产物 → SHA256 校验 → 快照备份（DB/compose/前端/代码）→ 派生新镜像 → 离线自检 → 保 inode 前端写入 → 重启 → 健康检查；**任一步失败自动回滚**
3. 完成后弹窗提示刷新页面。结果与历史见 `data/upgrade/upgrade-result.json`。

手动触发（等价）：宿主机执行 `python3 /opt/chatgpt2api-trial-20261029/scripts/deploy/server_upgrader.py --version <版本>`；`--status` 查看状态。

## 4. 回滚

- 部署失败：deploy_host 自动回滚到运行中镜像。
- 部署成功后发现问题：`python3 scripts/deploy/server_upgrader.py --version <旧版本>`（对应 Release 存在即可）或 `deploy.py rollback --image <标签>`。

## 5. 本地工具链速查

```bash
python scripts/deploy/deploy.py check     # 本地体检（白名单守护/凭据/工具链）
python scripts/deploy/deploy.py build     # 构建+打包（产物在 out/deploy/）
python scripts/deploy/deploy.py all --yes # 本机直连部署（不再必需，已被自动升级取代）
python scripts/deploy/check_whitelist.py  # Dockerfile 白名单守护
```

## 6. 测试服务器（上线前验证，2026-11-23 起）

- **本地测试服务器**：`192.168.123.27`（凭据在 `本地资料/服务器连接.txt` 的「本地测试服务器」段落）。
- 运行目录与容器名**刻意与线上同构**（`/opt/chatgpt2api-trial-20261029` + `chatgpt2api-trial-app`），共用 `deploy_config.json`，只有凭据段落不同。
- 数据从零开始（与线上完全隔离）：测试账号需在测试服务器上单独添加；测试产生的额度消耗走测试账号。
- 部署方法：`python scripts/deploy/deploy.py --target test all --yes`（`--target test` 要放在子命令前面）。
- 建议节奏：新版本先 `--target test` 部署验证，通过后再发线上（tag → 自动升级）。
