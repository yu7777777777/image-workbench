# 工作流程（分支 / 审核 / 发布 / 升级）

> 本项目自 1.16.0 起采用「分支 → PR → 审核 → 合并 → 打 tag → 自动构建 → 服务器半自动升级」的工作流。

## 1. 分支与审核（按改动大小分档）

**小改动**（文档、文案、单行修复、配置微调）：直接提交 main 并 push，不走分支、不占版本号。

**功能性改动**（新功能、多文件重构、需要审核的内容）：走分支 + PR：

1. `git checkout -b feature/<主题>`（或 fix/、chore/）。
2. 完成后 `git push -u origin feature/<主题>`，创建 PR（`gh pr create` 或网页）。
3. 审核：仓库所有者在 GitHub PR 页审阅 diff，也可以让其他 AI 模型审阅（`gh pr diff` 导出）。
4. 审核通过后合并（建议 squash merge）：`gh pr merge --squash` 或网页操作。

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
