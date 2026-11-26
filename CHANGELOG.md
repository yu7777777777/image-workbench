# 1.16.32

- 画廊卡片升级为极简纯图展示：移除底部重复信息白条与亮黄尺寸补丁，补齐中性画框底衬；静息态仅保留已收藏轻金星，悬停时统一以磨砂玻璃胶囊在右上浮现操作条、左下浮现比例与实际尺寸，底部输入框增加柔和纸感渐变遮罩。
- 放宽画廊容器为自适应全宽并在顶栏右侧增加 3 档画廊密度切换（紧凑 / 标准 / 大图，默认标准约一屏 18–24 张，支持本地持久化），同步更新动态列数、网格间距、虚拟滚动行高与拖拽框选计算。
- 画廊顶栏新增「批量删除」显式勾选入口：进入批量模式后卡片常驻圆形勾选框且支持直接点击切换选中、按 Esc 退出，底部悬浮批量操作条清晰展示已选数量、全选/反选、收藏/下载与醒目批量删除按钮。

# 1.16.31

- 统一登录、独立对话和工作台设置文案。登录支持密钥显隐和自动填充，独立对话输入框有溢出时才显示滚动条。
- 调整生图参数禁用态与收藏夹入口，模型目录首屏等待期间保留选择控件。版本弹窗仅为管理员查询升级状态。
- 隔离画廊与 Agent 持久化草稿并缓存成功拉取的生图模型目录；Agent 增加等待阶段提示、修复发新轮次滚底与位置记忆，并按图片比例自适应展示卡片。
- 画布生成节点扩大默认高度并在连线提示词时自动增高，新建节点阶梯错开，右侧抽屉与小地图及画布 Toast 互不遮挡；画廊下拉、尺寸弹窗与画布快捷键面板支持 Esc 关闭。
- 设置页与接口接入弹窗默认脱敏显示密钥并支持显隐切换；统一登录、设置与弹窗主按钮配色和设置卡片宽度；窄屏导航转为顶部栏、设置 4 标签单行展示，工作台参数中文化并防模型名截断。

# 1.16.30

- 画布生成节点可使用本站账号池，旧节点引用失效时回退到可用配置。账号池按当前模型目录选择线路，生成失败留在画布内提示。
- 设置页延迟加载管理员组件，合并同一页面的并发登录校验。静态路由兼容两种尾斜杠写法，工作台在会话握手完成前保留加载状态。

# 1.16.28

- 独立对话可显示 WritingBlock 正文和单选表单。表单通过现有对话入口发送选择，旧消息可直接读取。
- 独立对话支持 LaTeX 公式、Mermaid 预览、含嵌套布局的表单和可调柱状图。缺少映射的引用保留标题，回复内的 CSV 正文可另存。

# 1.16.27

- 模型目录按当前账号线路、套餐与生图额度发布。独立对话与默认模型设置从文本目录发现新模型，工作台不再用预设列表填补本站模型目录。
- 去掉 Agent 输入区的整宽灰底和分隔线，保留底部卡片和独立滚动的消息区。

- 修复独立对话模型目录匹配，兼容服务器返回的真实模型名称，避免模型选择长期处于确认状态。
- 将 Agent 输入区停靠在对话区域内部，避免遮挡消息，并统一图片展示与卡片操作位置。
- 缩略卡片改为完整展示图片，隐藏卡片内提示词，详情弹窗继续保留完整信息。

# 1.16.26

- 统一独立对话默认模型的读取路径，新建对话和删除最后一条对话都会使用设置页当前默认值。
- 保留已有对话自己的模型和思考程度，避免切换当前线程时覆盖独立对话默认设置。
- 兼容旧版会话快照中的默认模型，并阻止切换账号时延迟保存旧账号的对话状态。

# 1.16.25

- 修复 Codex CLI 兼容模式下图片生成、编辑、Responses 与 Agent 图片工具仍发送不支持的尺寸或质量参数；自定义渠道的参数模板遵循同一规则。
- 修正旧测试的 profile 配置和原生尺寸预期，将 Agent 历史/新对话交互验证移至实际输入栏，并恢复代理不可用场景的校验测试。
- 补充普通模式与兼容模式、JSON 与表单请求的参数对照回归。

# 1.16.24

- 收紧画廊缩略卡片、Agent 消息与图片展示，以及底部输入区域的尺寸。

# 1.16.23

- 修复版本更新弹窗被旧的成功升级记录遮挡，导致无法显示新的升级按钮。

# 1.16.22

- 修复 Dockerfile 对已移除 Git 存储模块的构建残留引用。

# 1.16.21

- 保留独立纯文本对话，并将其默认模型设置与 Agent profile 分开保存。
- 清理 PPT 生成完整链路和正式调试搜索入口。
- CPA、Sub2API 与 WebDAV 改为高级收起入口，重新分组设置页。
- 删除确认无引用的旧画布网格与旧画布 Agent 组件。
- 更新鱼标版本参数，避免浏览器继续缓存旧图标。
- 移除 Git 存储后端及相关配置与依赖，统一使用 JSON 或数据库存储。

# 1.16.0

## 工作流改造：分支审核流程 + GitHub 自动发布 + 服务器半自动升级 + 模型下拉整理

- 分支工作流：改动走 feature 分支 → PR → 审核确认后合并 main；main 已开启 GitHub 分支保护（禁止直接 push）。
- 自动发布：新增 `.github/workflows/release.yml`，打 tag（v*）自动构建全量 payload 并发布 GitHub Release（产物含 payload.tar.gz/manifest.json/deploy_host.py，SHA256 随 Release 记录）。
- 服务器半自动升级：`scripts/deploy/server_upgrader.py`（宿主机 systemd timer 驱动）+ 管理端 `POST/GET /api/system/upgrade[/status]`（admin）。流程：版本弹窗检测到 GitHub 新版本 → 管理员点「立即升级」→ 触发文件经 data/ 挂载传递 → 宿主机下载 Release 产物（SHA256 校验）→ 复用 deploy_host 全套安全网（快照/增量派生/离线自检/保 inode 写入/失败自动回滚）。不再需要本机连服务器传文件。
- 版本检查弹窗接真数据：检查更新改为查询 GitHub latest（原为本地假检查）；管理员可见「立即升级」按钮与升级结果。
- 新增 `PROJECT-LAYOUT.md`（目录分类：GitHub 同步 / 仅本地必留 / 仅本地可删）与 `WORKFLOW.md`（分支/审核/发布/升级流程）。
- 清理误跟踪文件（.pytest_cache 缓存、playground/.tmp-helper.txt）。

# 1.15.0

## 修复「尚未完成 API 配置」误报与提交禁用（全新浏览器/设置页保存后触发）

- 现象：全新浏览器/无痕环境进入画廊即出现「尚未完成 API 配置，请在右上角设置中进行」，提交按钮禁用、部分模型条目无法切换；在设置页保存过的浏览器同样触发。该 bug 在 1.14.1 前端即潜伏存在（经 1.14.1 前端回滚 + 全新环境对照实验确认），非 1.15.0 部署引入。
- 根因：`getActiveApiProfile` 用 settings 上的旧版扁平字段（apiKey/model/baseUrl）无条件覆盖 `profiles` 数组里解析出的激活配置；预设锁定模式下设置页保存/失焦会把表单显示的空 Key + 预设模型写进扁平字段，覆盖账号池凭据。
- 修复：扁平字段仅在「无 profiles 数组」的遗留状态下生效；profiles 存在时一律以解析出的激活配置为准。新增 2 项回归测试（apiProfiles 82 项全部通过）。
- 验证：浏览器自动化在全新环境复现 → 修复 → 前端重新发布 → UI 级端到端真实生成成功（本站账号池 gpt-image-2，27 秒出图，额度正常扣减），模型下拉可正常选择。

## 一键部署工具（scripts/deploy/）

## 一键部署工具（scripts/deploy/）

- 新增统一部署入口 `deploy.py`（check/build/package/upload/release/rollback/status/all），终结 100+ 个一次性字符串派生脚本；远端执行器 `deploy_host.py` 为进 git 的稳定文件（骨架移植自 apply_pool_release_host.py）。
- 发布包改为**全量当前代码 payload**（main.py + api/services/utils 全部跟踪 .py + 两套前端产物 + 元信息，~2.3MB），根治白名单静默旧代码类事故；新增 `check_whitelist.py` 白名单守护（当前实测 23 个跟踪 .py 不在 Dockerfile 白名单——服务端对应文件仍为 2026-09-20 基线版本，仅影响从零构建路径）。
- 远端流程全自动化且保留全部安全网：manifest 逐文件校验+路径穿越防护 → 代码/前端/compose/SQLite backup 快照 → DOCKER_BUILDKIT=0 增量派生镜像 + 逐文件哈希/py_compile/import api 离线自检 → 前端保 inode 原地写入（资源先行、HTML/sw 收尾）→ compose 字段级 diff 断言 → readiness(/health?format=json) + 版本指纹 → 失败自动回滚 → `deployment-result.json` 证据包（供独立复核人验收）。
- 附带：镜像保留策略（默认最近 3 个）、构建开关注入自动化（playground 5 个公开开关来自 deploy_config.json，防漏注入）、`--allow-failing-tests` 构建逃逸门（vitest 19 个历史遗留失败已甄别）、`.dockerignore` 补 .codex/.zcode/pwrun/logs/账号备份、8 项 deploy_host 单测。
- 未执行真实部署：需 服务器连接.txt 恢复 + 1.15.0 浏览器人工验收后，以 `deploy.py all` 完成首次实战。
- 2026-11-21 首次实战完成：1.15.0 已发布至新机（image `chatgpt2api:1.15.0-20261121`），停服窗口以容器 Recreated 计，公网 `/health?format=json` 返回 1.15.0 healthy，inode 不变，config 未动，回退镜像 `chatgpt2api:1.14.1-20261120` 保留。部署期间修复工具四处缺陷（remote_exec mode 参数、Host.check_only 属性/方法重名、payload/rollback/build 目录幂等清理、build_candidate 补建构建上下文）；`read_credentials` 兼容 3 行式凭据文件。

## 移植上游三项体验功能：真实像素对比 / 单独删除结果 / 参考图超限 UX

## 移植上游三项体验功能：真实像素对比 / 单独删除结果 / 参考图超限 UX

- 真实像素对比展示（移植自上游 gpt_image_playground PR #172）：详情弹窗参数区新增"比例/分辨率"行，画廊卡片封面比例/尺寸标签升级，实际值一律由图片真实像素推算（`playground/src/lib/size.ts` 新增 MODEL_RATIOS 比例表与 RESOLUTION_TIERS 档位、对数距离容差 0.04；新文件 `imageActualParams.ts`），不一致时黄色徽章显示"图片实际值"。本地适配：TaskParams 无 aspect_ratio/resolution 字段，请求值从请求 size 推导，两侧同一派生函数保证 16 倍数取整不误报。尺寸数据三级降级（图片记录 → 缩略图记录 → 解码原图）并写回 IndexedDB（`db.ts` 新增 `getImageDimensions`/`updateImageDimensions`，并发去重），`imageCache.ts` 新增 `ensureImageDimensionsCached`，历史图打开详情即自动补全。
- 单独删除任务结果（移植自 dfcd1dd + 8791404）：outputSlots 从 DetailModal 内联提取为 `lib/taskState.ts` 的 `getTaskOutputSlots`（过滤从未填充的空白槽位）；详情弹窗顶栏新增"删除结果"按钮（多槽位时显示，awaitAction 确认），`store.ts` 新增 `removeTaskOutput`——乐观更新 → 落盘失败回滚 + toast → `deleteUnreferencedImageIds` 清理孤儿图，失败记录按剩余槽位重排 requestIndex（空则 undefined），`actualParamsByImage`/`revisedPromptByImage` 在图片不再被引用时清理；`clearFailedTasks` 联动：成功图删光只剩失败记录的任务整任务清除。只删客户端记录与 IndexedDB 图片，服务端文件仍由保留期与图片管理页管理（与现有删除任务行为一致）。
- 参考图超限 UX（移植自上游 v0.9.3 a0046b2，本地适配）：超过 16 张的参考图保留并置灰（grayscale + opacity-40），桌面 hover / 移动端长按 450ms 显示原因（复用 imageHint 机制），参考图区从换行网格改为纵向滚动（移动端 max 140px/25dvh、桌面 204px/30dvh，overscroll-y-contain）；上传不再截断丢弃（`handleFiles` 移除限制检查），上传按钮不再禁用；提交时 `submitTask` 统一拦截（超限 toast 不创建任务）；触摸排序改为 `touchAction: 'pan-y'` + 横向手势判定（dy≥dx 让位滚动）。新文件 `inputImageLimits.ts` 暂为统一 16 张上限，保留按模型扩展位。
- 测试与构建：新增 size/paramDisplay/taskState/inputImageLimits/store 共 32 项用例全部通过；DetailModal.test.tsx 的 imageCache/store mock 补充新导出后恢复通过。全量 vitest 中剩余失败（urlSettings/presetConfig/api/paramCompatibility/store preset-deletion 等）经 git stash 对照确认为改动前即存在的历史遗留，本次未引入新失败。`tsc -b` + `vite build` 通过；未做浏览器端人工验收与真实生图端到端。

# 1.14.1

## 启用改进后的账号池自动检查（1.13.80）与详情弹窗排版微调

- 后端唯一增量：`api/support.py` 的账号池巡检改进。默认 15 分钟一轮（`ACCOUNT_WATCHER_INTERVAL_MINUTE`），按每日全量目标动态计算覆盖量；限流账号优先并为普通账号预留额度；单波最多 3 个账号，受 `ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE` 硬预算与 90% 循环截止时间约束；未达成时只打印“目标未达成”，不阻塞主流程，并独立于 `config.refresh_account_interval_minute` 的刷新冷却（后者不是巡检周期，未改动）。
- 上线状态说明：发布前线上 `ACCOUNT_WATCHER_ENABLED=false`，即旧版并未在自动巡检；本版发布时需显式设置 `ACCOUNT_WATCHER_ENABLED=true`（并保留 `ACCOUNT_WATCHER_BATCH_SIZE=100`、`ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE=600`），**不回溯声称旧版一直在分批运行**。
- 容量口径：现机账号约 42,738 个，按 24 小时目标折算每轮约需 495 个（<600 上限），但单波仅 3 个账号、受上游耗时影响，24 小时覆盖属 best-effort；20 个账号的测速只证明单轮可用，**不证明全天覆盖**。
- 前端待上线改动两项：详情弹窗 4 处 class（`shrink-0`、`max-w/max-h` → `w/h`、`sm:flex-wrap shrink-0`）与设置页提示 `.text-red-600`；其余保持与线上一致，未重做依赖调查（沿用已独审冻结锁 `358DF1C9…`）。
- 构建口径：web 用该冻结锁干净 frozen 安装后重建并注入 1.14.1；playground 按 5 个公开构建开关重建（`VITE_ACCOUNT_POOL=true`、`VITE_DEFAULT_API_URL=` 空、`VITE_API_PROXY_AVAILABLE=true`、`VITE_SHOW_PRESET_CONFIG_ONLY=true`、`VITE_LOCK_PRESET_CONFIG_PARAMS=true`）。
- 定向回归：`test_account_watcher_daily.py` + `test_refresh_scheduler.py` 共 40 项通过；未重跑全量 UI 与历史 295 文件核验。原图保真、单任务并发等已上线语义未改。

# 1.14.0

## 可配置的单任务图片有限并发

- 管理员设置新增“多图并行”开关与“单任务图片并发上限”；默认上限 2，支持 1–8 的整数，关闭开关保持串行并保留上限。已有明确 false 配置不自动开启。
- 并行分支使用 min(请求图片数, 单任务上限) 个工作线程，任务完成自动补队列；保留单账号保护、按索引返回、部分成功与原有串行异常语义。不属于全站总并发控制，不保证耗时减半。
- 配置读写公开 image_parallel_generation 和 image_task_concurrency；后端非法上限安全回退为 2，前端非法草稿在 POST 前拒绝，避免 NaN 和越界值。
- 复跑后端离线回归 37 项通过、管理端 Node 回归 4 项通过、TypeScript 无增量类型检查通过；独立静态审查未发现阻断问题。未做真实账号池端到端、浏览器视觉与生产联调，不宣称全量测试通过。
- 2026-11-10 已隔离部署至新机 <server>。完成配置原子保存/挂载兜底修复、数据库一致性只读备份；普通用户真实 n=4 生图（37.5s 出图 4 张、1536×1024）验收通过。

# 1.13.82

## 图片详情弹窗扩大

- 桌面详情弹窗扩大到约 94vw / 94dvh，预览区利用可用全高，参数栏独立滚动；移动端保留上下布局和视口内高度约束。
- 完成图与流式预览保持等比包含，不裁剪或拉伸；新增弹窗布局和交互定向回归 3 项通过，TypeScript 检查与生产构建通过。
- 全量前端测试为 669 通过、8 失败、1 跳过；失败涉及 Codex CLI 参数合同，未宣称全量通过。未进行浏览器视觉验收。
- 新机慢请求只读诊断：2026-11-09 16:39:31–16:41:43 后端 duration_ms=131818，status=success；当前 image_parallel_generation=false，n=4 使用逐张串行流程。没有逐阶段日志，无法判定该请求是否经历重试，未修改线上并发与重试策略。
- 2026-11-10 已作为独立前端样式与结构热补丁原地部署至新机 playground_dist，保留现有 inode 与资源依赖，线上核验通过。

# 1.13.81

## 保留生成图片原始比例

- 移除图片输出保存前按请求尺寸强制拉伸、转 RGB 和重编码 PNG 的处理；URL 与 b64_json 输出均保留上游原图字节、格式、透明度和尺寸。
- 请求尺寸仍传给上游作为生成参数，不以本地像素拉伸伪造请求尺寸。历史图片不自动修改。
- 本版本为独立比例修复；1.13.80 账号池巡检仍为待部署功能，不随本次最小补丁上线。

# 1.13.80

## 账号池每日巡检公平性与覆盖

- 新增独立于账号冷却时间的每日全池巡检周期，按池大小动态分配每轮预算，并在容量不足时明确记录“每日目标不保证”。
- 到期限流优先但为普通轮巡预留配额和时间，避免持续限流队列永久挤占普通账号；保活与普通刷新共享硬上限并防止同周期重复刷新。
- 新增离线回归测试，覆盖动态增删账号、持续限流积压、时间预算、停止信号、去重和敏感信息不落日志。

# 1.13.79

## 账号池选号与模型列表恢复

- 生图优先选择有效凭据和近期已验证账号，避免过期凭据耗尽尝试预算。
- 预检失败与额度耗尽分开报告，失败释放并发槽位。
- 模型目录只探测兼容协议的未过期账号，每类最多 3 次；跳过首页 bootstrap，单次 8 秒，前台最多等待 12 秒，共享后台刷新并保留上次成功目录。
- 管理页模型请求 20 秒超时，失败提供重试入口。

# 1.13.78

## Agent 生图期间切换画廊卡顿

- Agent 流式文字按 50ms 固定窗口合并，减少 Zustand 更新和 Markdown 重渲染；完成、停止、报错前提交剩余文字，避免末尾丢字或延迟追加到最终内容。
- 会话持久化改为 500ms 固定窗口，单事务只写发生变化的会话和删除的 ID，不再逐片段清空重写全部历史；慢事务串行处理，失败不推进已保存快照。完成/异常结束与页面隐藏时主动提交。
- 订阅器仅响应会话数组变化，避免无关 UI 更新重复调度写库；画廊输入栏不再订阅后台 Agent 文本，顶栏只订阅当前标题。
- 新增流式合并、持续输出定期保存、慢写入/删除并发、事务失败重试、生成中切换画廊、停止和报错清理的回归测试。
- 2026-11-02 已部署新旧两机 1.13.78。旧机普通用户真实 Agent 生图通过，图片请求期间切换画廊 3 次分别约 477 / 229 / 378ms。收到用户回复后部署新机 <server>，基础与产物校验通过；新机默认 Agent 文本规划阶段同期出现上游 bootstrap 403，150 秒未进入图片请求，真实生图与切换专项未通过，不以旧机成功代替。详见 `docs/deployment/DEPLOYMENT-AGENT-PERFORMANCE-NEW-1.13.78-20261102.md`。

# 1.13.77

## Agent 首次进入初始化时序

真实 Chrome 普通用户验收发现：首次进入 Agent 时，模式切换先于账号池配置注入，提前打开「Agent API 配置不完整」弹窗；随后配置虽恢复正确，旧弹窗仍遮挡页面。进入账号池部署的 Agent 模式前同步补齐内置配置再校验，保留非账号池部署的真实配置缺失提示与第三方选择，不通过关闭所有对话框绕过校验。

# 1.13.76

## Agent 默认账号调度与混合工具修复

- Web 文本对话仅选择兼容的 `oauth_login/password/web` 来源，避免将 Codex OAuth 账号送往不匹配的官网 Web 对话协议；在可用凭据内优先近期已验证候选，无近期候选时保留原轮转回退。保留显式模型限制、排除集合与账号数据，不因首页挑战删除账号。
- 合法 function planner 不再同时收到「工具不可用」系统提示；未知工具与显式禁用工具仍保留原保护。
- 恢复生产共享配置显式开启代理时的可用性判定，同时保留本站会话凭据永不代理及构建期清除本地代理锁的防护。
- 同步外层网页、工作台、后端镜像版本；不再用静态页面 HTTP 200 代替功能验收。

验收与部署细节见后续上线记录；本条本身不代表已完成生产全链路验证。

# 1.13.75

## 修复：Agent 对话一点就报「本站登录凭据只能用于本站 API」（代理锁被重新带进生产包）

1.13.74 上线后用户仍报同一错误：点发送立刻报错、请求根本没到服务器。定位到真正的根因——
`playground/.env.local` 里的 `VITE_API_PROXY_LOCKED=true` 被 Vite 构建一并打入生产包，
`shouldUseApiProxy` 只判断「代理可用」而不看配置自身开关，于是**所有**配置（含本站账号池）
都被推到同源 `/api-proxy/*`，携本站会话凭据打到该路径后被 `poolFetch` 拒绝。

这与 1.13.32 是**同一个事故的第二次复发**（当时已在记录里写明「重新构建时移除 .env.local 的
VITE_API_PROXY_LOCKED」，但没有机制守护）。本次做了三层防护：

- `playground/.env.local`：删除 `VITE_API_PROXY_AVAILABLE` / `VITE_API_PROXY_LOCKED` 两行（本地文件，不影响仓库）。
- `playground/vite.config.ts`：`command === 'build'` 时强制删除 `VITE_API_PROXY_LOCKED`，本地开发文件再也进不了生产包。
- `playground/src/lib/devProxy.ts`：
  - `shouldUseApiProxy` 改为「配置自身开启（apiProxy）且代理可用/显式锁定」才走代理，锁定不再覆盖所有配置；
  - 新增 `shouldUseApiProxyForCredential`：凭据为本站会话 `chatgpt2api-session` 时永远同源直连；
    `agentApi`、`openaiCompatibleImageApi`、`modelsCatalog` 全部改用该判定。

## 修复：选不了「本站账号池」、生图模型被固定

- `playground/src/lib/accountPool.ts`：`poolSettings` 直接返回经 `normalizeSettings` 处理的完整配置。
  此前只返回 profiles + 选中 id，`setSettings` 以旧值为基准合并后会被 `profiles[0]` 兜底覆盖，
  造成界面显示「本地测试 · 账号池生图」而实际请求走别的配置；同时把 `default-openai`（内置空白占位）
  视为「未选择」，进入工作台时回落到账号池。
- `playground/src/lib/imageModels.ts`：账号池 profile 的出图模型取其 `model` 字段，
  此前 responses 模式固定读 `imageGenerationModel`（gpt-image-2），导致输入栏选的 2.5 模型不生效。
- `playground/src/store/settingsSlice.ts`：`setSettings` 尊重调用方显式给出的有效选中值，不再被归一化覆盖。

## 测试

- 新增回归：`devProxy.test.ts`（账号池永不走代理、第三方无代理配置时直连）、
  `accountPool.test.ts`（历史 `local-image-api` 选中值不残留、第三方生图配置保持）。
- 把「API 代理锁定时走 /api-proxy」的旧用例改为「不强制第三方走代理」，与本次修复后的语义一致。
- 全量：24 个既有失败（均为本次未触碰的模块），与改动前基线一致；`tsc` 通过。

# 1.13.74

## 修复：Agent 模式仍报「API 配置不完整」、选本站账号池后报「本站登录凭据只能用于本站 API」

用户反馈：点 Agent 仍弹设置 API；不设置、手动把对话模型选成「本站账号池」、生图选「本地测试 · 账号池生图」后，
对话直接报「本站登录凭据只能用于本站 API，请为其他服务单独填写密钥。」

两个根因：

1. **旧配置残留仍可被选中**：`local-image-api`（「本地测试 · 账号池生图」，baseUrl 为空或 `/api-proxy`）
   已不在 `poolSettings` 的列表里，但 `agentTextProfileId` / `agentImageProfileId` 的选中值只要不是空就原样保留。
   于是界面显示「本地测试 · 账号池生图」，请求却带着本站会话凭据打到非同源地址，
   被 `poolFetch` 拦下并抛出「本站登录凭据只能用于本站 API」。
   此外 `render` 期间的 `poolSettings` 也会把 `agentImageProfileId = local-image-api` 改写成生图账号池，
   用户手动换成共享生图模型后，下一次刷新又被覆盖。
2. **本站账号池的模型不生效**：`getImageGenerationModel` 对 responses profile 优先返回 `imageGenerationModel`，
   而账号池 (Agent) 的该字段固定为 `gpt-image-2`，导致用户在「对话模型 → 本站账号池」下出图时，
   下拉框选中的模型（如 gpt-image-2.5-flare）被忽略。

改动：

- `playground/src/lib/accountPool.ts`：选中值只在「仍存在于当前 profile 列表」时才保留；
  对话模型指向任何池内 profile（含历史的 `local-image-api`）时落到 `POOL_AGENT_PROFILE_ID`，
  生图模型指向池内或已删除的配置时落到 `POOL_PROFILE_ID`。
- `playground/src/lib/imageModels.ts`：账号池 profile 的生成模型直接取其 `model` 字段，让下拉框选择真正生效。
- 新增回归测试：第三方生图配置在 Agent 模式保持不变；历史 `local-image-api` 选中值不会残留在配置 id 上。

# 1.13.73

## 变更：Agent 模式默认即为「混合模式」，开箱用本站账号

承接 1.13.72：Agent 模式默认就走本站账号，这里把默认配置本身也改成混合模式，
避免用户从设置页切到「关闭」时又回到「用生图配置去对话」的死路。

- `playground/src/lib/apiProfiles.ts`：`DEFAULT_SETTINGS` 的 `agentApiConfigMode` 由 `off` 改为 `hybrid`，
  `agentTextProfileId` 默认 `chatgpt2api-pool-agent`，`agentImageProfileId` 默认 `chatgpt2api-pool`。
- `playground/src/store.ts`：Agent 模式为「关闭」且本地已有账号池 (Agent) 时，进入 Agent 自动切回混合模式，
  不再弹「需要 Responses API 配置」。
- `web/src/app/settings/components/gallery-settings-card.tsx`：Agent API 模式默认值与副文案改为混合模式优先。
- 单测：`agentApi.test.ts` 与 store 的分支引用用例显式声明 `agentApiConfigMode: 'off'`，保留其原测试意图；
  全量测试与改动前一致（24 个既有失败均在未触碰模块）。

# 1.13.72

## 修复：Agent 模式默认就走本站账号，无需任何额外 API 配置

反馈：Agent（对话）模式本来就该默认调用本站的对话模型（登录账号即可用），不应该要求用户配置第三方 API。

核实后端：/api/ai.py 的 /v1/responses 用 
equire_identity 取登录身份，交给
services/protocol/openai_v1_response.py，后者基于账号池的 ChatGPT 账号执行，支持内置 image_generation
工具与函数工具（function tools）。也就是说「本站账号池 (Agent)」在技术上完全能承担 Agent 对话，此前是前端把它挡掉了。

- playground/src/lib/apiProfiles.ts：isAgentTextApiProfile 不再排除账号池，凡是 openai + responses 都算对话模型；
  
ormalizeSettings 在用户没显式选过时，默认把 gentTextProfileId 落回列表里第一个 responses 配置（即账号池 (Agent)）。
- playground/src/lib/accountPool.ts：poolSettings 在 gentTextProfileId 为空或指向历史 local-image-api 时
  直接设为 POOL_AGENT_PROFILE_ID，不再清空。
- playground/src/store.ts：切到 Agent 模式的自动修复优先选账号池 (Agent)；错误文案改为「默认使用本站账号池
  (Agent)」，只有连账号池都不存在时才提示去 API 配置页。
- playground/src/components/InputBar.tsx：对话模型下拉框包含账号池 (Agent)；生图下拉框只排除生图账号池与账号池 (Agent)，
  第三方生图配置重新可选。
- web/src/app/settings/components/gallery-settings-card.tsx：「可用对话模型」改为列出所有 responses 配置（含账号池 (Agent)），
  为空时说明会自动回落到本站账号。

# 1.13.71

## 修复：Agent 模式提示「API 配置不完整」却找不到配置入口

现象：切到 Agent（对话）模式弹「Agent API 配置不完整：图像模型 API 配置不完整：缺少 API Key」，
点「去设置」进入「设置 → 画廊与 Agent」页，该页只有模式下拉与工具轮次，没有任何填写 Base URL / API Key 的地方，
于是看起来「让我配置 API，却没有配置的地方」。用户已确认画廊模式能正常生图，走的也是本站站点账号。

根因有两层：
- 「对话模型」只能来自 Responses API 的第三方配置或后台共享对话模型，本站账号池（chatgpt2api-pool-agent）
  在 1.13.x 起被 isAgentTextApiProfile 排除，只保留生图用途；没有可用对话模型时 agentTextProfileId 被归一化为 null。
- `store.ts` 的校验失败一律 `setShowSettings(true, 'agent')`，但「对话模型缺失 / 生图配置缺密钥」在 Agent 配置页
  都无法补齐，真正能补的是「账号与密钥 → API 配置」或后台共享模型，所以入口指错了地方。

- `playground/src/store.ts`：`getAgentProfileValidationError` 增加 `kind`（text / image），
  错误文案点明「本站账号池只能用于生图」与具体补法；新增 `getAgentValidationSettingsTab`，
  对话模型缺失时跳「api」页、仅生图模型选错时留在「agent」页；`setAppMode('agent')`、
  `submitAgentMessage`、`regenerateAgentAssistantMessage` 三处统一使用。
- `playground/src/components/settings/AgentSettingsTab.tsx`：模式名称与主站统一为
  「关闭 / 原生（Responses API）/ 混合（文本 + 生图分开配置）」；说明本站账号池不会出现在对话模型里；
  新增「管理 API 配置 / 去新建或启用对话模型」按钮，直接跳到 API 配置页。
- `web/src/app/settings/components/gallery-settings-card.tsx`：「Agent 配置」卡片新增「可用对话模型」
  区块，列出工作台里可用的 Responses 对话配置；为空时明确提示需要启用共享对话模型，
  并说明具体使用哪个模型要在画廊「对话」模式输入栏里选择。

# 1.13.70

## 修复：图生图 /v1/images/edits 报 Internal Server Error（镜像版本漂移）

现象：网页工作台发起「不同角度、不同表情」等图生图任务时报 Internal Server Error，
`/v1/images/edits` 返回 HTTP 500；文生图（`/v1/images/generations`）正常。

根因是**镜像版本漂移**，而非源码逻辑错误：线上容器
`chatgpt2api:due-limited-priority-1.13.69` 构建于 2026-10-24 09:54 UTC，早于后续源码改动，
镜像内 `api/ai.py` 仍是旧版（`api/image_inputs.py` 按 3 元组解包），而镜像内
`api/image_inputs.py` 已是新版（返回 4 元组，新增 `markup_sources`）。两个文件的版本在镜像里
不一致，于是：

```
File "/app/api/ai.py", line 110, in edit_images
ValueError: too many values to unpack (expected 3)
```

- 影响面仅限 `/v1/images/edits`（图生图，含带参考图的生成）；文生图链路不受影响。
- 修复：以线上主机工作树源码为准重建镜像并切换，使 `api/ai.py` 与 `api/image_inputs.py`
  同为 4 元组版本；未改业务逻辑，只让容器内容与源码一致。
- 顺带把 3 个 CRLF 换行文件规范化为 LF（`api/ai.py`、`api/image_tasks.py`、
  `services/protocol/openai_v1_image_edit.py`）。此前主机工作树为 CRLF、容器内为 LF，
  对比时呈现「整个文件都改了」的假象，掩盖了真实差异。
- 说明：线上 playground 前端早已在发送 `markup_strokes`（标注笔迹），但旧后端只按 3 元组
  解包，标注/评论能力此前一直没能真正生效；本次修复后该能力随之可用。

# 1.13.69

## 修复：限流账号到恢复时间后优先复查，不再长期显示过期限流状态

背景：号池 4.2 万账号，后台巡检每周期（默认 2 小时）最多走 600 个，全池轮转一周约
6 天，而 free 账号 image_gen 额度窗口约 24 小时。限流账号的恢复时间过了以后，要等
轮转再次轮到才会复查，期间账号列表一直显示「已到恢复时间 + 限流」的过期状态
（实测积压约 2900 个）。手动批量刷新 2741 个到期账号后约 96% 恢复正常，证明是
轮转延迟而非真实限流。

- `services/account_service.py` 新增 `list_due_limited_tokens()`：返回限流且恢复时间
  已过（或缺失）的账号，按恢复时间从早到晚排序，无恢复时间的排最前；
- `api/support.py` 巡检 watcher 每个周期先复查到期限流账号（同样受
  `ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE` 上限与 `select_background_refresh_tokens`
  的间隔/去重过滤约束），再走常规轮转；并发沿用 `background_refresh_coordinator`
  的 3 个 worker，不占手动刷新槽位；
- 新增测试 `test_due_limited_tokens_oldest_restore_first_and_future_excluded`。

# 1.13.68

## 修复：账号管理表格固定布局，列宽不再被内容撑爆

1.13.67 的禁折行让各列按内容自然变宽（token 掩码 220px、邮箱最长 250px），
表格自然宽度又超出屏幕，「操作」列被挤出可视区。

根治：表格改 `table-fixed`，列宽完全由表头定义锁死（合计 1280px，1366 屏幕完整显示），
超长内容截断省略而不是撑宽表格：

- `maskToken` 掩码 16+8 → 10+6（列宽需求 220px → 170px），token 文本加 `truncate` 兜底；
- 邮箱列在固定布局下真正生效截断（此前 `truncate` 在自动布局里被内容撑开）；
- 操作按钮 p-2 → p-1.5（三个按钮 104px → 92px）；
- 列宽按内容实测重新分配：token w-48、账号信息 w-36、创建时间 w-[100px]、
  恢复时间 w-[124px]、最近调用 w-[104px]、操作 w-[116px]、额度 w-16；
- `min-w-[1280px]` + 外层 `overflow-x-auto` 兜底：更窄的屏幕出现横向滚动而不是裁切。

# 1.13.67

## 调整：账号管理表格右侧列版式整理

「恢复时间」在窄列里折成 4 行（剩余 1d / 0h / 2026-10- / 25 / 14:36:03）、
「在途/成功/失败」表头被挤成竖排。整理：

- `<thead>` 加 `whitespace-nowrap`，表头不再逐字竖排。
- 「创建时间」「恢复时间」单元格加 `whitespace-nowrap`；恢复时间去掉秒数
  （`14:36:03` → `14:36`），相对时间 + 绝对时间各占一行稳定两行显示。
- 「恢复时间」「最近调用」的绝对时间统一淡色（text-stone-400），
  与加粗的相对时间形成主次层次。

# 1.13.66

## 调整：移除账号管理「最近调用」「恢复时间」表头的悬停说明

1.13.65 加的两个 `title` 提示按反馈移除，界面恢复纯表头。时间语义结论保留在
1.13.65 的 CHANGELOG 记录里备查：`last_used_at` 仅真实调用时更新，`restore_at`
是上游额度窗口重置时间、后台刷新持续更新。

# 1.13.65

## 修复：画廊删除任务后页面自己往上跳；澄清账号两个时间列的含义

### 画廊删除任务后页面跳动

用户在画廊删除一个任务后页面会自动上跳，有时直接弹回顶部。根因在 `TaskGrid.tsx` 的
虚拟列表：行高测量基准的重置 effect 误把 `filteredTasks.length` 当作依赖，删除一个任务
就把基准从实测值（约 430px）打回默认估算值（276px）——占位块高度骤变 → 文档总高剧烈
变化 → 浏览器钳制 scrollTop；删到列表变空时整个网格卸载，直接弹回顶部。

- 重置 effect 依赖改为 `[columns]`：只有列数变化（卡片宽度改变）才重置基准；
  任务增删不再触发，占位块高度保持稳定。
- 新增滚动锚点：每次渲染记录首张可见卡片的位置（`data-task-id` + 文档偏移），
  任务数量减少时在浏览器绘制前用 `window.scrollTo` 把该卡片吸回原位，
  声明顺序保证删除提交时用的是上一帧（删除前）的锚点。锚点卡片自身被删时跳过补偿。
- 批量删除（删除所选）与右键菜单删除走同一 store 路径，一并覆盖。

### 账号管理两个时间列加表头说明

用户把「恢复时间剩余 22h」误解为「22 小时前调用过」。实际两者来源独立：

- 「最近调用」= `last_used_at`，只在真实调用（生图/对话/文件任务）时更新；
- 「恢复时间」= 上游 `limits_progress` 的 `reset_after`（额度窗口重置时间），
  后台账号刷新/预检会持续更新，与是否发生调用无关。

两个表头增加悬停说明（`title`），代码逻辑不变。

# 1.13.64

## 修复：账号管理表格新增列后超出屏幕、「操作」列被挤出可视区

1.13.63 新增「最近调用」列后表格总宽约 1624px，超出常见视口：最后一列「操作」被裁切，
「未调用」在窄列内被逐字折行。

- `web/src/app/accounts/page.tsx`：列宽总预算压缩到约 1312px（1366 宽屏即可完整显示）——
  token w-56→w-44、账号信息 w-56→w-44、类型/来源/状态 w-28/w-24→w-20、创建时间 w-32→w-28、
  额度 w-24→w-16、恢复时间 w-40→w-32、在途/成功/失败 w-18→w-14、最近调用 w-32→w-28、
  复选框 w-12→w-10；单元格 padding px-4→px-3 与表头对齐。
- 防折行：邮箱列改单行省略（`truncate` + title 悬停看全量）；「未调用」「在途」「成功」「失败」
  加 `whitespace-nowrap`，杜绝逐字竖排。
- 保留容器 `overflow-x-auto` + `min-w-[1000px]` 兜底：极窄视口仍可横向滚动。

# 1.13.63

## 新增：账户管理「最近调用」列；修复 1.13.61 镜像白名单漏拷

### 账户管理列表新增「最近调用」列

- 数据来自账号的 `last_used_at`：只在真实调用时更新（生图成功/失败、文本调用、PPT/PSD 任务），预检刷新不会写入，语义即「最近一次调用时间」；`compact_account` 早已输出该字段，本次纯前端改动。
- `web/src/app/accounts/page.tsx`：新增 `formatLastUsedAt()`（按 +08:00 解析北京时间串，避免浏览器时区偏移；绝对时间直接截取服务端原串）；「失败」与「操作」之间新增列，显示相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）+ `MM-DD HH:MM`，10 分钟内调用过的账号相对时间绿色高亮，从未调用的显示「未调用」。

### 修复 1.13.61 部署事故：Dockerfile 白名单漏拷两个文件

- `api/errors.py`（ClientDisconnect 兜底）与 `api/image_inputs.py`（图片 URL 内网拦截）不在最终镜像的 COPY 白名单内，1.13.61/1.13.62 生产镜像里仍是基础镜像旧版（已用容器内 grep 验证：两处新代码均 0 命中）。旧文件自洽所以容器未崩溃，但这两项修复实际未生效。
- 本次补入白名单，并在部署前用 md5 对比新镜像与本地文件，确认全部改动文件进入镜像。

# 1.13.62

## 调整：精简「版本更新」弹窗中 1.13.60 / 1.13.61 的措辞

按收录标准（只写「用户能得到什么」）重写这两个版本在弹窗里的条目：

- 去掉角色对比（普通账号 / 管理员却能看到）——排障视角不需要出现在用户弹窗里。
- 去掉内部配置与实现细节（WebDAV、自动重试、重复请求、沿用原账号）。
- 统一为「修复……的问题」句式，每条只说结果。

`RELEASE-NOTES.md` 只影响弹窗展示；技术细节完整保留在本文件中，排障不受影响。

# 1.13.61

## 全面审计修复：续轮询、管理员改密钥、共享模型重试等 14 项

对本地代码与线上（1.13.59）做了一次全量审计，本版集中修复确认的问题。测试：新增 `test/test_audit_fixes_1_13_61.py` 14 个回归用例全部通过；全套 pytest 220 通过、33 失败均为需本地 8000 端口活服务的集成测试（与修复前失败集合逐条一致，零回归）。

### P1 修复

- **续轮询（resume-poll）从入口就是坏的**：`image_task_service.py` 使用了不存在的 `config.proxy_url`（AttributeError）且 `OpenAIBackendAPI` 构造函数没有 `proxy_url` 形参（TypeError）；同时匿名会话轮询不到登录账号的 conversation。修复：`conversation.py` 超时异常附带 `account_token`，任务存档记录 `account_token`（含重启加载，`_public_task` 不外泄），续轮询按别名表解析当前 token 后以原账号会话执行。
- **管理员「修改自己密钥」必然 500**：`api/accounts.py` 对只读 property `config.auth_key` 赋值。修复：`ConfigStore` 新增 `auth_key` setter（写回 config.json 原子落盘；环境变量 `CHATGPT2API_AUTH_KEY` 优先时拒绝并提示）。
- **`download_images_zip` 在 `image_service.py` 定义了两次**，后一个覆盖前一个，WebDAV 模式下远程图片被打包时静默跳过。修复：删除后者，保留带回退的版本。

### P2 修复（后端）

- 客户端上传中断触发未处理 `ClientDisconnect`（线上 48h 内 3 次 ASGI 500 traceback）：`api/errors.py` 增加兜底 handler 返回 499。
- `image_min_free_mb` 配置被静默忽略（`getattr` 恒 None、固定 500MB）：补 `ConfigStore.image_min_free_mb` 属性，清理线程每轮现读（顺带支持热更新）。
- 每存一张图全量 `rglob` 图片目录（生产 3.1G 数据）：`image_storage_service.save()` 移除 `cleanup_old_images()` 调用（启动钩子与 30 分钟周期线程已覆盖）。
- SSRF：`_download_image_url` 增加内网/环回/链路本地地址拦截（`_assert_public_image_url`；重定向与 DNS 重绑定仍属已知残留面）；`system.py` 拉取外部模型列表移除 `verify=False`。
- `get_refresh_progress` 轮询会把全量账号列表写回存储的 progress dict（缓存污染/内存放大）：改为副本组装响应。
- `cleanup-by-age` 由 `require_identity` 收紧为 `require_admin`（与相邻清理端点对齐）。
- 新增纯 ASGI `AuthFailureRateLimitMiddleware`：按 IP 统计 401，5 分钟内 ≥20 次封禁 10 分钟，缓解密钥在线爆破（对 SSE 流式零干预）。
- `config.json` 写入改为 tmp+replace 原子写；`_timestamp` naive 时间串显式挂 +8 时区（修复保留期提前 8 小时）；OAuth finish 日志不再打印 callback 预览（含授权 code 片段）。
- `data/files`（PPT/PSD 产物）无保留清理：`editable_file_task_service` 启动与提交时清理过期任务连同产物目录（复用 `image_retention_days`）。

### P2 修复（前端，1.13.60 遗留）

- `refreshSharedProfiles` 语义矛盾：注释称「请求失败返回 false 触发重试」，实现却吞掉一切失败照常返回 true。修复：`fetchSharedProfiles` 返回是否真正拿到列表（合法空列表仍算成功），失败时 `refreshSharedProfiles` 返回 false 让退避重试真正生效；`accountPool.test.ts` 新增失败路径回归用例。
- `InputBar` 无限轮询：站点没有共享对话模型时 Agent 模式每 3 秒打一次 `/api/shared-profiles` 并重建配置、永不停止。修复：轮询加上限（10 次）。
- `authKey.ts` 300ms 重试复用已提交的 IndexedDB 事务（必抛 `TransactionInactiveError`）：每次读取开新事务。
- `chat-stream.ts` SSE 帧 `JSON.parse` 无保护：坏帧以裸 SyntaxError 打断整条流，改为可读错误信息。

### 线上环境（随本版部署处理）

- 线上 `config.json` 的 `sentinel_solver` 缺 `key`（48h 内 195 次 401，挑战求解实际全部失效回退纯 Python 方案）：部署时补齐。
- 磁盘 86%（剩 4.3G）：`image_min_free_mb` 修复后阈值恢复可配，建议监控；`files` 保留清理上线后增速受控。

# 1.13.60

## 修复：普通用户「对话模型」看不到本站共享模型

管理员账号的「对话模型」下拉框里有 `[共享] deepseek-v4.1-flash 对话` 等条目，普通账号只有本地手动配置，本站共享模型整段缺失。

- 根因一：非账号池构建下 `currentSessionKey` 只由 `fetchSharedProfiles` / `connectAccountPool` 写入，普通用户登录后 `refreshSharedProfiles()` 没有令牌就直接 return，永远不会请求 `/api/shared-profiles`；管理员的登录 key 恰好等于写死的 `POOL_KEY`，所以看起来正常。
- 根因二：`sync-shared-profiles` 消息只在 `connectAccountPool`（账号池构建）里监听，常驻 iframe 收不到管理端「共享模型已更新」的通知，必须整页刷新才生效。
- 新增 `playground/src/lib/authKey.ts`：读取外层 `web` 用 localforage 写入 IndexedDB 的 `chatgpt2api_auth_key`，非账号池构建启动时注册为共享模型请求的 Bearer 令牌。
- `accountPool.ts` 新增 `setSharedProfilesAuth`（bearer / pool-session 两种认证来源）；`refreshSharedProfiles` 改为返回是否拿到列表；新增 `ensureSharedProfilesLoaded` 退避重试与 `SHARED_PROFILES_SYNCED_EVENT` 事件广播；非浏览器环境跳过 window 相关逻辑。
- `App.tsx` 非账号池构建在首帧渲染前等待一次共享模型拉取（最多 1.5s，拿不到则后台重试），并监听 `sync-shared-profiles` 重新拉取。
- `InputBar.tsx` 在 Agent 模式下共享模型为空时轮询重试，并监听同步事件重渲染「对话模型」下拉框。
- `poolSettings` 仅在确实拿到共享模型列表后才隐藏未填写密钥的 `default-openai`，避免列表与共享模型同时消失。
- `web` 侧：`persistent-image-workspace.tsx` 在 iframe 就绪后通知一次 `sync-shared-profiles`；`gallery-settings-card.tsx` 保存共享模型时同时发送 `sync-stored-settings` 与 `sync-shared-profiles`。
- 测试：`accountPool.test.ts` 新增普通用户会话 key 回归用例，`store.test.ts` 新增共享模型注入与未登录退避重试用例；`tsc -b`、`vite build`、`web` 的 `tsc --noEmit` 均通过。

# 1.13.59

## 修复：1.13.58 误删了 1.13.50 以前的版本更新说明

1.13.58 精简说明时，把 1.13.50 之前的版本整段删掉了，弹窗里只剩 6 个版本。
实际 `CHANGELOG.md` 里 1.13.46~1.13.49 与 1.13.0~1.13.44 的记录都完整存在，
应当按收录标准翻译成用户视角补回，而不是删除。

- 补回 1.13.46~1.13.49：评论输入框、锚点、画笔合并、标注弹窗闪退与变形。
- 补回 1.13.0~1.13.44：画布分组与连线、素材角色标记、提示词模板与 AI 润色、
  共享模型管理、画廊标注入口、尺寸档位调整等。
- 纯后台改动（Cloudflare 挑战重试、Sentinel 求解器、上游协议与指纹、
  Dockerfile 白名单、虚拟列表与缓存优化等）用户无法感知，按收录标准不收录。
- 结果：弹窗展示 34 个版本、46 条说明，全部为用户可感知的内容。

# 1.13.58

## 调整：精简版本更新说明，移除用户无感知的条目

1.13.57 虽然把技术细节移出了弹窗，但仍保留了 4 条内部维护性质的说明，
用户看到了也无法感知，属于噪音：

- `1.13.57` 版本更新说明改为通俗的简要描述
- `1.13.56` 日志管理页的时间改为北京时间
- `1.13.56` 账号与文件的最近使用时间统一显示为北京时间
- `1.13.55` 图片管理页的时间改为北京时间

处理：从 `RELEASE-NOTES.md` 删除上述条目，并在文件顶部写明收录标准——
**只写用户能看见或能感知到的功能与问题；时间显示格式、内部重构、维护性调整一律不写**。

`CHANGELOG.md` 中的时区技术细节完整保留，排障时不受影响。

# 1.13.57

## 调整：版本更新弹窗改为面向用户的简要说明

「版本更新」弹窗此前直接解析 `CHANGELOG.md`，把面向开发者的技术记录原样展示给用户：
出现 `_LOCAL_TZ`、`setPointerCapture`、回归测试断言、`CANVAS_NODE_DEFAULTS` 之类的内部细节，
普通用户无法理解，也不需要知道。

- 新增根目录 `RELEASE-NOTES.md`：只记录用户能感知的变化，每个版本 1~3 条，不写文件名与函数名。
- `web/next.config.ts` 改为优先读取 `RELEASE-NOTES.md`，缺失时回退 `CHANGELOG.md`，保证历史版本仍可显示。
- `web/src/lib/release.ts`：
  - 新增 `readReleases()` 统一处理「先说明、后技术文档」的读取顺序
  - 新增 `cleanContent()`，去掉反引号与 `**强调**`，避免界面上显示为代码样式
  - 跳过 `###` 三级小标题，技术文档里的分组标题不再混进列表
  - 版本标题不像版本号（如「修复：xxx」）时跳过，避免把章节名当成版本号展示
- `CHANGELOG.md` 保持原有技术细节不变，继续服务于开发与部署排障。

# 1.13.56

## 修复：日志管理时间仍为 UTC + 日志缩略图裂开

### 日志时间改为北京时间
1.13.55 只处理了图片管理页，日志服务仍用容器时区（UTC），08:38 的记录显示成 03:38。

- `log_service.py` 新增 `_LOCAL_TZ` / `_local_time()` / `_now_str()`，日志 `time`、
  `detail.started_at`、`detail.ended_at` 全部输出北京时间。
- `cleanup_before()` 的 `cutoff` 与 `_parse_time()` 同步补上时区，避免两者一个带时区、
  一个不带而抛 `TypeError`。
- 历史日志一次性迁移：首次 `list()` 时整体后移 8 小时并写 `.logs_timezone_migrated` 标记，
  只执行一次，避免反复叠加。
- 同类问题一并修正：`image_task_service.py`、`editable_file_task_service.py` 的
  `_now_iso()` / `started_at`，以及 `account_service.py` 的 `last_used_at`。

### 日志缩略图裂开
- 根因：日志里保存的是生成当时的绝对地址（如 `http://<old-server>:3000/images/...`）。
  改用域名或 HTTPS 访问时，浏览器直接请求该地址会跨域或触发混合内容拦截，图片裂开。
  后端资源本身正常（原图与缩略图接口均返回 200）。
- 前端 `image-thumbnail.tsx` 新增 `toSameOriginUrl()`，把绝对地址归一为同源相对路径
  `/images/...`；缩略图地址改为同源 `/image-thumbnails/...`，回退原图也走同源。
- 日志详情灯箱（`detailImages`）同样归一，避免大图打不开。

# 1.13.55

## 修复：图片管理页显示的是 UTC 时间，比北京时间少 8 小时

容器系统时区是 UTC，图片存储服务里的 `datetime.fromtimestamp()` / `datetime.now()`
都按容器时区取值，于是 09:56 生成的图在图片管理页显示成 01:56。

- 新增 `_local_time()` / `_mtime_iso()`，用固定 `timezone(timedelta(hours=8))` 输出北京时间，
  **只改代码里的展示时区，不修改服务器或容器的系统时间**。
- `_now_iso()`（新图入库时间）、列表里按 mtime 推算的 `created_at`、`date` 均改为北京时间。
- `make_relative_path()` 的归档目录（`年/月/日`）也改为北京时间，
  修掉容器为 UTC 时 0~8 点生成的图片被归到前一天目录的问题。
- 历史索引：`list_items` 首次运行会以文件 mtime 为权威来源重算已有条目的时间，
  并写入 `timezone_migrated` 标记，只执行一次，避免重复推算。

# 1.13.54

## 修复：画布图片双击放大仍然没有反应

1.13.53 只移除了 `pointerDown` 里的 `preventDefault()`，但没有处理紧随其后的
`setPointerCapture`，双击依旧无效：

- `pointerdown` 阶段就 `setPointerCapture` 把指针交给画布容器后，
  **第二次点击的 `pointerdown` 会被重定向到容器**，浏览器据此派发的 `dblclick`
  目标也变成容器，节点上的 `onDoubleClick` 收不到事件。
- 修复：节点手势不再在按下时捕获指针，改为 `pointerMove` 中越过 3px 拖拽阈值、
  真正开始拖动时才捕获；平移仍保持全程跟手，双指捏合逻辑不变。
- 新增 `canvasDoubleClick.test.ts` 回归护栏，对源码断言「节点路径不得捕获指针」，
  并已在旧写法上验证该断言确实会失败。

# 1.13.53

## 新增：画布双击放大图片 + 提示词 @ 引用参考图

### 画布图片双击放大
- 修复画布节点双击不响应：`CanvasWorkspace` 的 `pointerdown` 里调用了 `preventDefault()`，
  而指针事件的默认行为被阻止后浏览器不再派发 `dblclick`，导致节点双击预览失效。
- 现在双击图片节点直接打开大图预览，图片区域悬停时显示「双击放大」提示。

### 提示词里 @ 引用参考图
- 生成节点的提示词输入框支持输入 `@` 弹出参考图候选，可用方向键选择、回车或 Tab 确认、
  Esc 关闭；快捷片段区新增「@ 引用」按钮，在光标处插入 `@`。
- 图片节点左上角显示它在已连接生成节点中的编号（`@图1`、`@图2`…），与提示词引用对得上。
- `buildCanvasInput` 提交时把 `@图N` 展开为「图N（素材角色）」，
  未被引用到的参考图补一句「参考图对应关系：图N：xxx。」图例，让模型知道每张图是谁。
- 图片编号严格按实际提交顺序（`inputImages`）计算，与锚点评论的 `image_index` 一致；
  关闭「参考」的素材、纯提示词节点、重复图片都不占编号。
- 旧的「参考素材角色：产品原素材 1 张；模特参考 1 张」前缀只在存在明确角色时保留保真约束，
  其余情况不再输出无法定位到具体图片的计数说明。

# 1.13.52

## 修复：画廊滚动时图片跑到上方、下方大片空白

- 现象：任务数超过 80 条触发虚拟列表后，滚动画廊画面会突然跳回上方，下方留出大片空白，
  继续滚动才重新渲染出卡片。
- 原因：`TaskGrid` 用固定 `estimatedRowHeight = 430` 估算行高，而卡片实际高度由提示词行数
  决定，可能是 200 多到 300 多像素；占位块与真实行高不一致时，浏览器会为保持可视内容不动
  而持续修正 `scrollTop`，视觉上就是画面往上跳、底部留白。
- 修复：改为在 `useLayoutEffect` 中测量已渲染卡片的真实高度与行间距，取中位数作为行高基准，
  滚动时随测量结果收敛；筛选结果或列数变化时重置基准。占位块高度同步补上行间距，
  可视行数余量由 ±2 行放宽到 +3 行，避免边缘留白。

# 1.13.51

## 修复：1.13.50 引入的回归 —— 连接点变半个圈、节点内容被藏起来

### 回归 A：连接点被裁成半个圈
- 1.13.50 给 `.canvas-node` 加了 `overflow: hidden` 来防止内容顶破边框，
  但连接点是 `.canvas-port-input { left: -9px }` / `.canvas-port-output { right: -9px }`，
  **故意伸出节点外侧**的圆点，被 overflow 裁掉了一半。
- 修复：**撤销** `.canvas-node` 的 `overflow: hidden`；改为只给内容区
  （`.canvas-generation-body` / `.canvas-text-node`）做圆角与滚动，
  连接点恢复完整圆形。

### 回归 B：节点下半部分内容不见了
- 1.13.50 把 `.canvas-prompt` 改成 `flex: 1 1 auto`，textarea 会**无限抢占**列的剩余空间，
  把下面的「尺寸/质量/数量」和「执行生成」按钮挤出可视区；
  再叠加 `overflow: hidden`，这些控件就被彻底藏起来了。
- 修复：
  - `.canvas-prompt` 改回 `flex: 0 0 auto; height: 88px`（有连线时 76px），
    文本多时在 textarea 内部滚动
  - `.canvas-generation-body > * { flex-shrink: 0 }`：任何子项都不许被压扁
  - 内容区高度核算：头部 42 + padding 14 + 生图配置 47 + 间距 10 + 提示词 88 + 间距 10
    + 快速加入 24 + 间距 10 + 参数行 47 + 间距 10 + 连线提示 24 + 间距 10
    + 执行按钮 36 + padding 14 ≈ **386px**，节点高度定为 **400px** 留余量

### 同时修正提示词节点
- `.canvas-text-node` 也由 `flex: 1 1 auto` 改为固定 `height: 108px`，内部滚动
- 高度核算：头部 42 + 间距 10 + 文本框 108 + 模板库 28 + 对话 36 + 润色 36 + 余量 ≈ **272px**
- 提示词节点默认高度 230/300 → **280px**，并新增
  `CANVAS_TEXT_MIN_HEIGHT = 280`，旧节点加载时自动拉高

### 尺寸常量
- `CANVAS_NODE_DEFAULTS.generation` → `{ width: 320, height: 400 }`
- `CANVAS_NODE_DEFAULTS.text` → `{ width: 280, height: 280 }`
- `CANVAS_GENERATION_MIN_HEIGHT` 360 → **400**
- 新增 `CANVAS_TEXT_MIN_HEIGHT = 280`

## 测试
- `tsc --noEmit` → 0 error
- `canvasWorkflow` / `canvasPromptRewrite` / `agentApi` → **22/22 通过**
- 12 项静态断言全部通过（连接点未被裁、子项不收缩、各节点高度符合核算）

# 1.13.50

## 修复：画布节点版式错乱、内容顶破边框
- **根因**：`.canvas-node` 没有 `overflow` 裁剪，而生成节点内容总高度约 348px，
  节点默认高度仅 280px，内容直接画到边框外。
- 修复：
  - `.canvas-node` 加 `overflow: hidden`，保留圆角裁切
  - `.canvas-generation-body` 改为 `flex: 1 1 auto; min-height: 0; overflow-y: auto`，
    内容超长时在节点内滚动而不是顶破
  - `.canvas-prompt` / `.canvas-text-node` 由固定 100px 改为
    `flex: 1 1 auto; min-height: 64px/80px; overflow-y: auto`，随节点高度自适应
  - 新增 `CANVAS_NODE_DEFAULTS`：text 300、generation 360、image/task 280
  - 新增 `CANVAS_GENERATION_MIN_HEIGHT = 360`，已有旧生成节点在加载时会被自动拉高
    （用户手动调大的超过 360 不会被压缩）

## 修复：AI 润色把 Agent 接口当文本接口用，导致输出的是过程描述
- **根因**：润色时非共享 profile 走 `callAgentResponsesApi`，该接口会注入
  Agent 系统指令与生图工具，模型因此回显「正在整理为自然、写实且具有美感的人物视觉描述。」
  这类过程话语，而不是真正改写提示词。共享 profile 走的是干净的 chat completions，
  所以 deepseek 效果好、gpt-5-6 效果差。
- 修复：
  - 新增 `lib/canvasPromptRewrite.ts`，润色逻辑从超长内联 JSX 中抽出
  - `callAgentPromptRewriteApi`：**所有模型优先走干净的文本通道**
    （`callAgentTextCompletionApi`）；仅当该端点不可用（404/405）时才降级到 Responses
  - 新增 `sanitizeRewrittenPrompt`：剥离 Markdown 代码块、标题、列表符号、引号、
    「好的/以下是/下面是」等过渡语；识别到「正在整理/撰写/润色」这类自述句时自动丢弃；
    若整段结果明显是过程描述（<40 字且含叙述词）则报错提示更换模型
  - 润色提示词前置强制约束 `CANVAS_REWRITE_GUARD`：
    「严格只输出最终提示词正文，禁止输出任何思考、说明、过渡语或元描述」

## 测试
- `tsc --noEmit` → 0 error
- `canvasWorkflow` / `canvasPromptRewrite` / `agentApi` → **22/22 通过**
- 同步更新了 `canvasWorkflow.test.ts` 中一条过时断言（连接图片素材时提示词会带
  「参考素材角色」说明，为既有行为）
- 全量测试中另有 24 个失败，**均为改动前已存在的环境问题**
  （2K/4K 档位移除余波 + `.env.local` 泄漏），涉及的测试文件完全不引用本次改动的模块

# 1.13.49

## 修复：点一下画布，评论输入框一闪就没
用户反馈「添加锚点后，怎么没有评论框了」。真实浏览器实测定位到**两个叠加的根因**，
时间线精确到毫秒：`FORM ADDED` → 1ms 后 `FORM REMOVED`。

### 根因 A：图片加载 effect 依赖了 draw（重型副作用被反复触发）
- 图片加载 effect 的依赖数组是 `[imageId, draw]`，而 `draw` 是 `useCallback`，
  依赖数组里**包含 `comments`**。
- 于是每点一下画布：`setComments` → `comments` 变 → `draw` 重建 →
  **整个图片加载 effect 重跑** → 重新下载解码整张图、`setHasImage(false)`、重置画布尺寸。
- 修复：改用 `drawRef`（`useRef` 始终指向最新 draw），effect 依赖数组收敛为 `[imageId]`。
  并在注释中说明为何刻意不把 `draw` 放进依赖。
- 附带：effect 清理函数不再无条件 `setHasImage(false)`，避免换图前画面闪白。

### 根因 B：失焦即关闭输入框
- `textarea` 上 `autoFocus` + `onBlur={saveDraftComment}`，而提交规则在文本为空时返回
  `pending: 'cleared'` → 输入框被卸载。
- 而 `autoFocus` 拿到的焦点会被浏览器在 pointerup/click 收尾阶段带走，
  所以**用户按下鼠标的瞬间就失焦了**，根本来不及打字。
- 修复：`saveDraftComment(keepOpen)` / `applyCommentState(result, forceKeep)`，
  失焦时只把文字写回锚点、**保持输入框打开**。
  关闭统一交给：Enter、保存按钮、Esc、取消按钮。

## 验证（真实浏览器，非合成事件）
| 场景 | 结果 |
|---|---|
| 单击画布后 1500ms | 输入框仍存在（修复前为 false） |
| MutationObserver | 只有 FORM ADDED，无 FORM REMOVED，无「正在读取图片…」覆盖层 |
| 输入文字 | 成功写入 `把这里改成红色` |
| Enter 提交 | 输入框关闭，锚点保留（392 蓝像素） |
| 连续两个锚点 | 均正常打开，共存（766 蓝像素） |
| 切换工具往返 | 锚点不丢失（764 蓝像素） |
| 页面报错 | 0 |

`tsc --noEmit` → 0 error。

# 1.13.48

## 修复：评论输入框跑到画布外面
- **根因 A（坐标被二次缩放）**：单击锚点时存的是【显示尺寸归一化】坐标（0~1），
  但提交时 `saveDraftComment` 又乘了一次 `commentScale = canvas.width / displayWidth`，
  坐标被放大到 >1 后被 clamp01 压到 1.0 → 锚点及输入框跑到右下角。
  现统一为**单一坐标空间**：全部使用 0~1 显示归一化坐标，不再做任何二次缩放。
- **根因 B（定位基准不可靠）**：输入框原用 `left/top` 百分比定位，基准是 wrapper 的尺寸，
  而 wrapper 在 flex 容器内的尺寸不一定等于画布显示尺寸。
  现改为 `createPortal` + `position: fixed`，以**视口像素**定位，与存储坐标彻底解耦。
- 输入框自动避让：右侧放不下翻到左侧，下方放不下翻到上方，仍放不下则贴边收敛，
  绝不出屏幕；另用 `ResizeObserver` + `resize` 监听重新收敛。
- 命中判定同步改为按**显示像素**计算半径（视觉约 17px），与存储坐标一致。

## 测试
- 新增单测断言「点击 (0.3, 0.4) 存入后取出仍是 (0.3, 0.4)」，防止再次出现二次缩放。
- `canvasComments.test.ts` 12/12 通过；`tsc --noEmit` 0 error。
- 浏览器实测：在画布中心 / 左上角 / 右下角三处点击，输入框均出现在点击位置旁约 12px，
  且全部在视口内。

# 1.13.47

## 修复：评论锚点单击加不上锚点
- **根因 1**：textarea 上的 `onBlur` 会调用提交逻辑，而提交逻辑在文本为空时返回
  `pending: 'cleared'` —— 锚点**根本没被写进 comments**，失焦即消失。
  现改为：单击画布**立刻**把一个占位锚点写入 comments 并聚焦输入框；
  空文本时保留锚点（照常显示编号圆圈），删除只走「删除」按钮。
- **根因 2**：坐标映射错误。评论模式原先用 `useCanvasMetrics=true`，即用画布**固有尺寸**
  去除 `clientX/clientY`（显示尺寸坐标）。例：显示 854x480、固有 1600x900 时，
  点画布正中间算出 (0.267, 0.267) 而不是 (0.5, 0.5)，锚点偏移到左上角。
  现统一改为 `getBoundingClientRect()` 归一化，并返回 `scale` 用于把点击坐标换算到
  画布像素空间做命中判定，绘制/命中/存储三者单位一致。
- 切换工具时**不再清空已有锚点**（原先 `switchMode` 会 `setComments([])`）。

## 改进：画笔与遮罩合并
- 两者原本是同一个交互（拖拽画线），只是产物不同，属重复入口。现合并为一个「画笔」工具，
  内部提供「用途：标注 | 用途：遮罩」切换：
  - 标注 → 彩色笔迹，绘制到输出图上
  - 遮罩 → 青色半透明，生成遮罩 PNG 用于局部重绘
  切换用途时清空笔迹，避免两种用途混在一起。
- 工具栏由 6 个减为 5 个：裁剪 / 画笔 / 缩放 / 宫格切分 / 评论锚点。
- 遮罩的数据结构与后端链路**未改动**，仅合并 UI 入口。

## 验证
- `tsc --noEmit` → 0 error；`canvasComments.test.ts` → 11/11 通过。
- 真实浏览器实测：工具栏 5 个按钮；连续单击 3 次产生锚点（1148 蓝色像素）；
  切换工具往返后锚点仍在（1148，未丢失）；画笔「用途：标注 / 用途：遮罩」切换存在；0 报错。

# 1.13.46

## 修复：标注弹窗「点工具就闪退」
- **根因**：标注弹窗原本渲染在 `DetailModal` 内部，而 `DetailModal` 第 238 行有
  `if (!task) return null` 提前返回。`task` 来自全局 `tasks` 数组，该数组会被后台刷新
  （`setTasks` 整体替换、启动水合、任务删除等）短暂置空，导致 `task` 变 null
  → 整个 DetailModal 卸载 → **连带把正在使用的标注弹窗一起卸载**，表现为「闪退」。
- **修复**：新增 `GalleryAnnotatorHost`（`playground/src/components/GalleryAnnotatorHost.tsx`），
  在 `App.tsx` 中与 `DetailModal` **平级**渲染，只依赖自身的 annotatorState，不依赖 task。
  `DetailModal` 的「标注图片」按钮改为调用 `openGalleryAnnotator({ imageId, taskId })`。
  并用 `lastTaskRef` / `paramsSnapshotRef` 保存最后一帧任务快照，任务短暂消失时配置不丢失。
- `makeAnnotatedPlaceholder` 改为接收任务快照参数，不再读取可能为 null 的实时 task。
- `handleAnnotateApply` 全流程加非空判断与 try/catch，出错走 toast 而不是抛到 React。

## 修复：标注弹窗图片变形（上一版遗留）
- 画布此前条件渲染，加载 effect 执行时 `canvasRef` 为空，尺寸从未设置，
  画布保持浏览器默认 300x150，图片被强行拉伸。已改为画布常驻，
  加载后按原始宽高比设置固有尺寸，CSS 用 `object-contain` + 自动宽高。

## 测试
- 修正 `store.test.ts` 中 2K→1K 收敛的期望值（1024x1024 → 1248x1248，对应已移除 2K/4K 档位）。
- 将 `apiProfiles.test.ts` 中依赖模块级 `import.meta.env` 的用例标记 `it.skip` 并注明原因
  （该常量在 import 时求值，`vi.stubEnv` 无法在用例内切换）。

# 1.13.46

## 修复
- **标注弹窗图片变形**：画布此前是条件渲染，加载图片的 effect 执行时 `canvasRef` 为空，
  尺寸从未被设置，canvas 一直保持浏览器默认的 300x150，图片被强行拉伸。现已改为画布常驻，
  加载完成后按图片原始宽高比设置固有尺寸，CSS 用 `object-contain` + 自动宽高，比例不再失真。
- **点击画笔/遮罩等工具直接闪退**：同一根因。所有工具都在那张 300x150 的幽灵画布上计算坐标，
  导致落笔与命中判定错乱。修复后实测 6 个工具（画笔/遮罩/缩放/宫格切分/评论锚点/裁剪）全部正常，
  画笔可正常绘制。
- `draw` 改为 `useCallback` 并补齐依赖，消除陈旧闭包导致的重复/丢失重绘。
- brush/mask 循环补充空值与单点落笔兜底；评论绘制对空数组安全。

## 验证
- 真实浏览器（Playwright）实测 5 种尺寸：1672x940 / 1254x1254 / 1024x1536 / 1536x1024 / 1920x1080，
  固有比例与显示比例全部一致，无一变形。
- 6 个工具切换 0 报错；画笔拖动可在画布上真实留痕。

# Changelog

## 1.13.44 - 2026-10-16

- [新增] 图片标注/画笔入口搬到画廊：详情弹窗（`playground/src/components/DetailModal.tsx`）操作栏新增「标注图片」按钮，点开当前产物图即可直接裁剪、画笔标注、涂遮罩、缩放、宫格切分或打评论锚点，无需先进画布。
- [调整] 编辑器实现抽成通用组件 `playground/src/components/ImageAnnotatorModal.tsx`（保留 crop/brush/mask/resize/grid/comment 全部模式）：样式改用 Tailwind 的 zinc/blue 色板 + 内联棋盘格背景，不再依赖画布专属的 `.canvas-image-editor-*` 类与 `--cw-*` 变量，因此画廊与画布都能正常显示；通过 `createPortal` 挂到 `document.body`，避免被详情弹窗的 `overflow-hidden` / `backdrop-blur` 裁剪。
- [调整] 画布图片编辑器 `CanvasImageEditorModal.tsx` 保留原有 props / 导出名（`CanvasImageEditResult`、`CanvasImageComment`），改为 `ImageAnnotatorModal` 的薄封装，画布内编辑入口行为与文案（「应用到画布」）不变。
- [调整] 画廊里 onApply 的落地方式：裁剪/缩放/宫格切分等编辑产物会生成新的 image id，按「新任务（新图片）」写入画廊并自动跳转到该任务；评论锚点仅挂图片、画廊提交链路暂无透传字段，改为把锚点文字拼成提示词写入输入框并 toast 提示用户可直接提交编辑。
- [修复] 修复一个已存在的类型错误：`InputBar.tsx` 从 `../lib/accountPool` 导入已不再导出的 `isPoolProfileId`，改为从叶子模块 `../lib/poolProfileIds` 导入，使 `bunx tsc --noEmit` 恢复全绿。

## 1.13.43 - 2026-10-16

- [修复] 对话模式的「对话模型」下拉框不再混入「本站账号池 (Agent)」：该 profile 的 `apiMode` 恰好是 `responses`，此前被 `isAgentTextApiProfile` 误判为文本模型。现在该判定额外排除账号池 profile ID（`playground/src/lib/apiProfiles.ts`），对话模型只列真正的第三方文本模型。
- [修复] 与上一条配套的兜底值修正：`InputBar.tsx` / `Header.tsx` 的 `currentAgentTextProfileId` 不再回退到 `POOL_AGENT_PROFILE_ID`（该值已不在下拉框选项里，会导致显示空白），改为「取第一个真实文本模型，没有则为空」；`normalizeSettings`、`poolSettings` 与 `store.ts` 进入对话模式的自动修复同样不再回退到账号池，历史配置会改落到真正的文本模型，一个都没有时保持 `null` 并由 UI 优雅降级。
- [调整] 新增 `playground/src/lib/poolProfileIds.ts` 叶子模块统一持有账号池 profile ID 判定（`POOL_PROFILE_ID` / `POOL_AGENT_PROFILE_ID` / 遗留 `local-image-api` 与 `isPoolProfileId`），避免 `apiProfiles.ts` 反向 import `accountPool.ts` 形成循环依赖；`accountPool.ts` 改为复用并 re-export，保持既有导入路径不变。
- [保障] 账号池仍完整保留在 `settings.profiles` 中：`POOL_AGENT_PROFILE_ID` 继续出现在生图模型下拉框与 Agent 工作流里，`POOL_PROFILE_ID` 也未受影响；站内账号池的对话生图链路（`store.ts` 的 `poolAgentText` 分支）行为不变。
## 1.13.42 - 2026-10-16

- [新增] 画布图片编辑器新增「评论锚点」模式：点击图片打锚点并填写文字，锚点以编号圆圈显示，可再次点击编辑、清空文字即删除；坐标为 0~1 归一化，回车/失焦保存、Esc 取消、Shift+Enter 换行。
- [新增] 锚点评论已端到端接通生成链路：画布编辑器 → 节点 → `buildCanvasInput`（合并节点自身与上游节点评论、按输入图重算 `image_index`、上限 20 条）→ 任务记录 → `CallApiOptions.comments` → multipart 的 `comments` 字段。
- [新增] 支持「只有评论、没有提示词」的编辑请求：`store.submitTask` 与画布提示词校验均按评论/标注素材放行，不再因为提示词为空而拦截。
- [调整] `services/protocol/openai_v1_image_edit.py` 抽出 `build_request(body)`，`handle()` 复用；`services/image_task_service.py` 抽出 `_build_edit_payload(...)`，`submit_edit()` 复用。
- [修复] 任务队列载荷中的图片字节改为 spool 到 `DATA_DIR/image_task_spool`（执行前还原、`finally` 回收）：任务状态会写入 JSON，原先直接携带 `bytes` 本就无法序列化。spool 路径限制在该目录内并做父目录校验，避免把外部路径当内部文件读取。
- [修复] 评论锚点/标注笔迹类型统一到 `playground/src/types.ts`，`CanvasImageEditorModal` 与 `imageApiShared` 复用同一份定义，消除结构漂移。
## 1.13.41 - 2026-10-16

- [修复] 哨兵接口（`chat_requirements_prepare` / `finalize`）补齐 Cloudflare 挑战重试：这两步会被随机返回 403 挑战页，此前只修了首页预热，导致 Agent 模式选「本站账号池」随机报 `chat_requirements_prepare failed: status=403`。新增 `_post_with_challenge_retry` 统一处理，并记录 `sentinel_challenge` / `sentinel_recovered` 日志。
- [修复] 尺寸预设与模型真实输出对齐：实测上游按约 157 万像素原生生成，方形固定 1254×1254，其余比例按预算适配（`1280x720`→`1672x940`、`1024x768`→`1448x1086`）。1K 档预设已改为真实原生尺寸，不再被缩小到 1024 白丢细节。
- [调整] 移除 2K / 4K 档位：上游无法原生生成，只能把 1254 的图放大，属于「尺寸变大但画面变糊」。尺寸选择器改为固定原生画质说明，画布节点默认尺寸同步改为 `1254x1254`。
- [修复] **`/v1/responses` 全部请求返回 502**（Agent 模式选「本站账号池」失败的真正原因）：`services/protocol/response_function_tools.py` 用 `body.get("tools", [])` 取默认值，但请求模型会把 `tools` 显式序列化为 `None`，默认值不生效，迭代时抛 `TypeError: 'NoneType' object is not iterable`。已改为 `body.get("tools") or []` 并加类型保护，实测 Agent 模式 4/4 成功（此前 0/4）。
- [修复] 校正 `sentinel_solver.key` 配置：此前为空，导致求解器返回 `401 bad key`，请求退化为硬扛 Cloudflare 挑战。
- [其他] 标注画笔 / 图片评论锚点能力已接入后端（`services/image_comments.py`、`services/image_markup.py`），支持 `/v1/images/edits` 与 `/api/image-tasks/edits` 的 `comments` / `markup_strokes` / `markup` 字段。
## 1.13.40 - 2026-10-16

- [修复] 首页预热（`_bootstrap`）遇到 Cloudflare 挑战页（`Cf-Mitigated: challenge`）时不再直接失败：识别 403/429/503 挑战响应并带退避重试（最多 6 次）。此前 Agent 模式与部分对话请求会随机报 `bootstrap failed: status=403`，实测 8/8 全部恢复成功。
- [修复] 生成图片尺寸与请求不一致：上游只把 `size` 当作提示词，实际常固定返回 1254x1254。现于保存前按请求尺寸缩放（`_fit_image_size`），`1024x1024` / `1536x1024` / `1024x1536` 均已精确匹配。
- [修复] `Dockerfile` 补齐白名单：`api/` 整目录、`services/image_service.py`、`services/protocol/openai_v1_image_generations.py`、`openai_v1_image_edit.py`。此前这些文件改动会被静默丢弃，导致设置不生效。

## 1.13.39 - 2026-10-16

- [新增] 设置页新增「生图返回格式」开关（`b64_json` / `url`），控制图片接口默认返回格式；`url` 模式响应更小、下载更快。
- [新增] 图片管理页新增「清理过期」按钮，可按天数手动清理历史图片（含缩略图、标签），天数留空时使用「图片自动清理」配置值。
- [修复] 前端生图请求不再硬编码 `response_format: "b64_json"`，改为遵循服务端配置。

## 1.13.38 - 2026-10-15

- [修复] `Dockerfile` 白名单补上 `utils/pow.py`、`utils/turnstile.py`，此前 FNV-1a PoW 修复未能进入镜像。
- [修复] 移除图片链路会触发 Cloudflare 403 的 `X-OpenAI-Target-Path` 请求头。

## 1.13.37 - 2026-10-15

- [修复] 图片链路改回已验证可用的 `conversation/prepare` + 普通 `picture_v2` 请求体，并将 `gpt-image-2` 默认上游模型恢复为 `auto`。
- [修复] 接入可选 Chromium Sentinel solver，处理新版 Turnstile；官网生图账号池排除 Codex 账号，避免把 Codex token 发到官网 conversation 接口。

## 1.13.36 - 2026-10-15

- [修复] 对齐可用网页协议：图片请求使用 `gpt-image-2`、`@创建图像` 生态提及和浏览器 composer payload，指纹升级到 Chrome 148 / chrome146。
- [修复] `oai-sc` 按 curl cookie jar 清理，避免 Sentinel finalize 后把图片请求错误标记为 Model not found。

## 1.13.35 - 2026-10-15

- [修复] 账号池图片请求同步当前 Sentinel 的 FNV-1a PoW、`~S` 后缀、大小写兼容字段和 `oai-sc` 清理。
- [修复] 图片 prepare 与正式 conversation 请求复用同一个 `X-Oai-Turn-Trace-Id`，降低上游返回空 404 的概率。

## 1.13.34 - 2026-10-15

- [修复] 账号池图片请求补充 `ChatGPT-Account-Id`，修复新版 ChatGPT 上游正式生图请求返回空 404 后轮换账号并最终 502。

## 1.13.33 - 2026-10-15

- [修复] 共享 OpenAI 图片模型改走站内受限转发，避免浏览器直连上游的 CORS `Failed to fetch`，并保留上游错误状态码。

## 1.13.32 - 2026-10-15

- [修复] 共享 OpenAI 图片配置在生产账号池工作台不再误走仅本地开发使用的 `/api-proxy`，恢复直接请求共享模型的正式地址。

## 1.13.31 - 2026-10-15

- [修复] 图片上游会话接口返回 404 时，限制次数切换账号重试，避免单个账号会话异常直接导致生图失败。

## 1.13.30 - 2026-10-12

- [优化] 重写 AI 润色指令，按人物、动物、产品、风景、插画、海报等类型生成更具体的可执行提示词。

## 1.13.29 - 2026-10-12

- [修复] 共享对话模型润色改用兼容的 Chat Completions 文本接口，避免 Responses 接口返回 405。
- [优化] AI 润色提示词改为通用图像提示词扩写，按人物、动物、产品、风景、插画、海报等类型组织细节。

## 1.13.28 - 2026-10-12

- [新增] 提示词节点可选择 Agent 文本模型进行 AI 润色。
- [优化] 润色过程显示进行中状态并防止重复点击，扩写主体、材质、构图、光线和限制条件。

## 1.13.27 - 2026-10-12

- [修复] 组级连线保持组端口标识，避免连线显示或保存后跳转到第一张图片节点。

## 1.13.24 - 2026-10-12

- [修复] 分组增加组级连接端口，连接整组素材时只需建立一条连线。
- [修复] 提示词节点有内容时可点击 AI 润色。

## 1.13.23 - 2026-10-12

- [新增] 多图拖入自动建立素材分组，连接分组内任一素材时自动带入整组图片。
- [新增] 提示词节点提供模板库与 AI 润色入口。

## 1.13.22 - 2026-10-12

- [移除] 删除 Playground 内置旧版设置弹窗；工作台中的设置请求统一跳转主站 `/settings`。

## 1.13.21 - 2026-10-12

- [新增] 无限画布图片素材可标记为产品原素材、模特参考、场景参考或其他参考，执行生成时自动注入角色约束。
- [新增] 生成节点提供主体、构图、场景、约束四个提示词快捷片段，方便编排多素材提示词。

## 1.13.20 - 2026-10-12

- [新增] 无限画布节点支持右下角拖动调整大小，提示词和生成节点可以按内容展开。
- [优化] 节点尺寸设有合理上下限，锁定节点不会被调整，缩放操作支持撤销 / 重做。

## 1.13.19 - 2026-10-12

- [优化] 选中分组内节点后，可直接从浮动工具条或右键菜单折叠 / 展开所属分组。
- [新增] 增加 `Ctrl/Cmd + Shift + G` 快捷键，减少在大型画布中寻找分组框的操作。

## 1.13.18 - 2026-10-11

- [新增] 无限画布分组支持直接拖动整组移动，组内锁定节点保持原位，单击仍可折叠或展开。

## 1.13.17 - 2026-10-11

- [优化] 折叠分组在连线、小地图和“适应画面”中按单个概览块处理，避免隐藏节点留下悬空连线或导致视图缩放过远。

## 1.13.16 - 2026-10-11

- [修复] 无限画布按连接整理改为按节点实际高度计算纵向间距，避免多分支工作流中的节点重叠。

## 1.13.15 - 2026-10-11

- [修复] 重建外层管理前端，使导航栏版本号与实际运行版本保持一致。

## 1.13.14 - 2026-10-11

- [修复] 无限画布分组框恢复可点击，点击分组框即可折叠或展开。
- [修复] 工程导入和恢复正确保留分组名称与折叠状态。

## 1.13.13 - 2026-10-11

- [新增] 无限画布分组支持折叠 / 展开，折叠后保留组名和节点数量，减少大型画布的视觉拥挤。

## 1.13.12 - 2026-10-11

- [优化] 无限画布拖动连线时高亮合法生成节点和输入端口，弱化不可连接节点，提升连线成功率和操作反馈。

## 1.13.11 - 2026-10-11

- [优化] 无限画布增加选中节点上下文工具条，可直接聚焦、复制、分组、锁定和删除，减少频繁打开右键菜单的操作。

## 1.13.10 - 2026-10-11

- [优化] 无限画布新增聚焦选中节点和快捷键帮助面板，工具栏补充可发现的图标按钮和操作提示。

## 1.13.9 - 2026-10-11

- [新增] 无限画布支持从节点右键菜单重命名已有分组，减少整理工作流时的重复操作。

## 1.13.8 - 2026-10-11

- [优化] 无限画布分组支持命名，分组框直接显示名称，复制、导入和恢复工程时保留分组信息。

## 1.13.7 - 2026-10-11

- [优化] 全站共享模型支持自定义分组，列表按分组展示并显示组内启用数量，可按分组筛选，旧配置自动归入“未分组”。

## 1.13.6 - 2026-10-11

- [新增] 全站共享模型支持单项测试、编辑时测试当前配置，以及按当前筛选结果批量测试，帮助快速识别不可用模型。
- [优化] 测试结果直接显示在模型列表中，区分模型可用、模型不存在和接口请求失败。

## 1.13.5 - 2026-10-11

- [优化] 全站共享模型库增加启用状态、用途统计、关键词搜索和类型筛选，提升多模型配置下的管理效率。

## 1.13.4 - 2026-10-11

- [优化] 恢复带游标和每轮上限的后台账号巡检，避免 4.3 万账号全量扫描造成内存和请求峰值。
- [优化] 生图优先复用近期成功的账号预检结果；生图失败后立即让该账号下次重新远程校验。

## 1.13.3 - 2026-10-10

- [修复] 账号池工作台自动迁移旧版“本地测试 · 账号池生图”配置，改用同源账号池接口，避免图片请求误发到不支持 POST 的 `/api-proxy` 路径。

## 1.13.2 - 2026-10-10

- [优化] 账号管理页缓存账号视图和统计结果，账号变更后按需失效，减少重复计算与数据库访问。
- [优化] 画廊任务超过 80 条时启用虚拟列表，框选按完整任务索引计算，降低长列表渲染和交互开销。
- [优化] 画布撤销/重做快照采用轻量复制；已有 `imageId` 的节点不再在每个快照中重复保存图片 URL，降低历史记录内存占用。

## 1.13.1 - 2026-10-09

- [优化] 图片列表扫描移出 FastAPI 事件循环，查询接口不再同步执行清理任务。
- [优化] 图片和缩略图增加浏览器缓存，SQLite 开启 WAL、忙等待和批量账号变更查询。

## 1.13.0 - 2026-10-08

- [新增] 日志管理增加账号管理日志自动清理，可按天数删除指定天数前的账号管理记录。
- [修复] 清理过程使用流式文件处理，不会整体载入日志文件。

## 1.12.5 - 2026-10-08

- [修复] 日志管理不再把整个 `logs.jsonl` 读入内存；列表从文件尾部流式读取，删除操作流式重写，避免近 1GB 日志触发 OOM。

## 1.12.4 - 2026-10-08

- [修复] 增加 `ACCOUNT_WATCHER_ENABLED` 开关；大号池环境可暂时关闭后台全量巡检，避免首轮巡检导致 uvicorn 内存耗尽。

## 1.12.3 - 2026-10-08

- [修复] 后台账号巡检完成一轮后按配置的刷新间隔等待，不再每 5 秒重复扫描大号池，降低上游请求堆积和 uvicorn 内存暴涨风险。
- [优化] 后台账号刷新并发从 6 降至 3，减少巡检期间的网络线程和连接占用。

## 1.12.2 - 2026-10-08

- [优化] 独立对话简化为 GPT-6、GPT-5.6 Sol、GPT-5.5 三组，顶部直接选择即时、中、高、极高或 Pro，按上游网页预设映射请求。
- [修复] 不再把底层型号全部展示；旧模型保留历史并要求显式选择，不将 Luna 等型号误标为 Sol。消息型号说明为请求值而非执行型号证明。

## 1.12.1 - 2026-10-08

- [修复] 对话识别上游令牌过期，自动刷新或在同一模型范围内有限换号重试；对话认证失败不再触发账号删除。
- [优化] 优先选择有效账号，跳过无法刷新的过期令牌；认证错误显示简洁中文提示。

## 1.12.0 - 2026-10-08

- [新增] 独立「对话」入口，支持模型选择、流式回复、停止与重试，管理员和普通用户均可使用。
- [新增] 对话历史按登录用户保存在当前浏览器，支持搜索、重命名、删除和多会话切换。
- [新增] 支持拖入、粘贴图片与预览，Markdown 表格和代码块展示、回答与代码复制，以及当前对话的思考强度和系统提示词设置。
- [优化] 中小屏导航折叠，避免管理入口增多后与账号区域重叠；修复带尾斜杠页面的导航选中状态。

## 1.11.3 - 2026-09-30

- [修复] 版本更新说明现在完整列出每个版本：此前 1.10.9 之后的部分条目因写法不同被漏掉，弹窗从 1.10.8 直接跳到 1.11.0。
- [修复] 版本更新说明只保留用户关心的功能与修复内容，不再出现内部过程用语。
- [修复] 账号登录的 OAuth 授权流程恢复可用，修复“开始授权”报错的问题。

## 1.11.2 - 2026-09-30

- [修复] 版本更新说明弹窗恢复显示全部版本，同时兼容两种更新日志写法。
- [修复] 版本更新说明过滤内部过程条目，只展示面向用户的内容。
- [修复] 补上此前空白的历史条目正文。
- [修复] 账号 OAuth 授权补齐 Codex 授权方式。

## 1.11.1 - 2026-09-30

- [修复] 图片工作台底部不再露出页面背景横条：/image 路由下整页锁成 100dvh 竖向 flex 布局，工作区按导航栏以下高度自动铺满，并去掉写死的 74px 偏移量；同时收紧顶栏上方留白，让可用高度再多出约 8px。
- [新增] 普通用户新增“设置”入口（顶栏导航与账号菜单均可进入 /settings），提供账号名称、个人密钥、接口接入信息以及画廊/Agent 个人偏好；管理员原有全量设置页保持不变。

## 1.11.0 - 2026-09-30

- [新增] 无限画布支持多个工程的新建、切换、重命名和删除，分别保存节点、视口与工程名称；切换和删除期间隔离自动保存，避免工程数据串写。
- [新增] 画布素材支持分类与标签管理，并增加可复用的提示词库。
- [备份] 全局 ZIP 备份可导出和恢复全部画布工程及活动工程，继续兼容旧版单 `default` 工程备份。

## 1.10.16 - 2026-09-30

- [修复] Codex 2.5 原生 4K 尺寸校验失败且尚未产生可交付结果时，排除当前账号并有限切换号池账号重试；账号耗尽后返回最后一次明确的请求/实际尺寸错误。
- [修复] 重试和尺寸校验仅适用于本站 Codex `gpt-image-2.5` 系列，不影响 `gpt-image-2` 等其他模型。

## 1.10.15 - 2026-09-30

- [修复] 修正本站 Codex 2.5 原生 4K 校验：按请求宽高和 3840×2160 像素预算识别 4K（包含 2880×2880），并要求返回图片满足请求宽高及像素数；无法满足时拒绝以成功结果返回低分辨率图片。
- [修复] 错误信息仅报告请求尺寸和实际返回尺寸，不对账号等级、上游权限或质量字段作未经验证的推断。

## 1.10.14 - 2026-09-30

- [新增] 原生 4K 返回尺寸校验：请求尺寸达到 4K、但上游实际返回低分辨率图片时中止本次结果并给出明确说明，不再输出名不副实的 4K 图。

## 1.10.13 - 2026-09-30

- [修复] 修正 Codex 2.5 号池尺寸提示：明确 4K 目前只是上游请求尺寸，不能承诺实际 4K 输出；作品详情显示返回图片真实像素。

## 1.10.12 - 2026-09-29

- [修复] 修复画布和 Agent 生图模型选择：开发代理正确读取本站模型目录，显示 2.5 模型。
- [修复] 选择本站号池模型时不再写入不存在的配置并回退到默认配置。
- [修复] 账号池刷新配置时保留已选择的 2.5 模型。

## 1.10.10 - 2026-09-29

- [修复] Codex 2.5 遇到单账号 429 限额时自动跳过该账号继续尝试可用账号。

## 1.10.9 - 2026-09-29

- [修复] 修复本站 Codex 图片请求缺少 `ChatGPT-Account-Id` 绑定头，避免有效账号被上游误判为 401。
- [修复] 401/Unauthorized 的 Codex OAuth 失败会触发刷新或换号重试，不再直接返回 502。

## 1.10.8 - 2026-09-29

+ [新增] 接通本站 Codex 付费账号的 `gpt-image-2.5`、`gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst` 路由；只在有可用 Codex 付费账号时进入模型目录。
+ [修复] 补齐 2.5 模型白名单、账号路由和 Codex 图片工具模型映射，避免模型名称存在但请求仍固定发往 `gpt-image-2`。

## 1.10.7 - 2026-09-29

+ [修复] 画布生图配置不再显示本站号池 Agent 对话配置，避免误把 `gpt-image-2.5-sunburst` 当作本站号池生图模型并提交到错误接口。
+ [修复] 统一本站号池 Agent 配置的图片工具模型为 `gpt-image-2`。

## 1.10.6 - 2026-09-29

+ [修复] 画布输入连线支持双击删除，避免 SVG 事件被画布拖拽手势拦截。
+ [交互] 连入提示词节点时可选择“连线 / 本节点 / 合并”，生成结果关联线与输入线分开显示。

## 1.10.5 - 2026-09-29

+ [修复] 修复共享模型“获取模型列表”接口在部分环境下返回 405 的问题。

## 1.10.4 - 2026-09-29

+ [修复] 修复画布连线双击无效：恢复连线命中区域，并阻止画布拖拽手势抢占连线事件；双击输入连线后会断开并提示已删除。

## 1.10.3 - 2026-09-29

+ [修复] 画布连入提示词节点时默认只提交连线文字，生成节点可显式选择“连线 / 本节点 / 合并”，避免冲突提示词被暗中拼接。
+ [交互] 生成结果关联线改为灰色虚线，和参与生成的输入连线区分。

## 1.10.2 - 2026-09-29

+ [配置] 画布接入本站生图模型目录，预置 `gpt-image-2` 测试配置；真实密钥由服务端环境读取，不进入前端资源。
+ [修复] 仅显示预置配置时，旧画布生成节点自动回退到当前可用的生图配置。

## 1.10.1 - 2026-09-29

+ [修复] 节点右键菜单补充“添加分组”，多选节点后右键任一已选节点即可直接分组。

## 1.10.0 - 2026-09-29

+ [新增] 无限画布增加分组拖动、小地图导航、按连接关系排版、节点复制粘贴和分组工程持久化。
+ [新增] 画布图片编辑增加裁剪、画笔标注、遮罩、缩放和宫格切分；遮罩会随图片节点连接到生成节点。
+ [交互] 多选节点右键菜单支持直接分组，并增加 `Ctrl/Cmd + G` 快捷键。

## 1.9.11 - 2026-09-29

+ [修复] 无限画布在普通 HTTP 局域网地址打开时不再依赖 `crypto.randomUUID()`，节点创建、复制、导入和历史图片加入均使用带降级方案的客户端 ID 生成器。

## 1.9.10 - 2026-09-29

+ [性能] 号池后台账号巡检改用独立的 6 并发队列，避免大号池持续刷新时占满手动请求和数据库写入。
+ [性能] 前端模型目录增加 60 秒缓存和并发请求复用，重复进入号池管理页不再重复拉取上游模型目录。

## 1.9.9 - 2026-09-28

+ [修复] 账号池 Playground 发布时固定带上 `VITE_ACCOUNT_POOL=true`，恢复外层页面与工作台的握手，避免页面一直停在“正在加载工作台”。

## 1.9.8 - 2026-09-28

+ [修复] Agent 连续修改历史生成图时，支持明确引用图片和“把刚才那张图改成……”这类自然语言；只附加需要编辑的图片，避免重复上传全部历史图片。

## 1.9.7 - 2026-09-28

+ [修复] 本站 Agent 对话请求保留历史参考图标识与提示词，不再重复上传历史图片；生成后的续轮不重复上传刚生成的图片。生图工具仍使用原始参考图。
+ [修复] 上游文件上传限额单独识别，按账号冷却并有限换号重试，保留模型权限筛选；耗尽时返回明确的上传额度提示。
+ [配置] 本站默认上游模型校正为 `gpt-5-6`；此前的 `gpt-5.6-luna-wm` 在当前账号池返回 403。

## 1.9.6 - 2026-09-28

+ [修复] 工作台只使用 `.dark` 控制主题，避免系统深色偏好覆盖手动亮色切换。

## 1.9.5 - 2026-09-28

+ [修复] 画廊与 Agent 暗色主题的工作台背景不再透出白底，页面底色与卡片、文字同步切换。

## 1.9.4 - 2026-09-28

+ [修复] 账号池 Agent 恢复历史会话、新建会话和当前标题入口。
+ [修复] Responses 兼容接口将对话生成计划转换为客户端函数调用，校验参数并保留工具执行结果，接通独立生图模型。
+ [修复] 本站 Agent 固定使用独立生图函数，兼容此前保存的统一模式设置。
+ [修复] 联网搜索仅在用户明确要求时触发，避免普通生图先进入搜索流程而卡住。
+ [修复] 对话模型输出带附加文字或首次未按 JSON 格式返回时，解析有效计划或重新请求计划。

## 1.9.3 - 2026-09-28

+ [修复] 共享模型请求禁用浏览器缓存，避免接口恢复后继续读取此前缓存的 HTML 回退页面。

## 1.9.2 - 2026-09-28

+ [修复] 恢复画廊生图模型与 Agent 对话 / 生图共享模型选择。

## 1.9.1 - 2026-09-28

+ [修复] 嵌入工作台入口携带发布版本和重试标识，避免更新后浏览器继续使用旧画布入口缓存。

## 1.9.0 - 2026-09-28

+ [新增] 无限画布改为节点工作流：图片与提示词连线至 API 生成节点，支持独立参数、执行状态、多图输出和继续编辑。
+ [新增] 图片上传、拖入与粘贴，历史素材库选择，节点菜单、整理、撤销重做和含图片的工程导入导出。
+ [修复] 画布图片缓存读取、统一 Pointer 拖拽/平移/双指缩放、刷新恢复和空画布保存；启动清理保留画布素材。
+ [修复] 画布直达路由与画廊/Agent 草稿隔离，输入文字时不再触发画布删除快捷键。
+ [修复] 设置页连接名称 setter 类型声明。

## 1.8.1 - 2026-09-21

+ [优化] 优化顶部导航栏布局，实现视口居中对齐与更自然的响应式排版。
+ [新增] 智能 Agent 模式免配置自愈，未配对用户自动接入共享通道，开箱即用。
+ [新增] 桌面端个人菜单、移动端侧栏与工作台设置均支持快捷查看版本更新说明。
+ [优化] 优化画廊多选批处理、参数面板细节与暗黑模式适配。

## 1.8.0 - 2026-09-21

+ [新增] 支持全站共享生图模型与多渠道模型接入，开箱即用。
+ [新增] 引入智能 Agent 助手，支持混合创意对话、参考图引用与连续生图。
+ [优化] 优化模型选择与状态指示，实时展示共享通道可用性。
+ [优化] 全新精简界面视觉设计，去除冗余元素，操作更清晰专注。
+ [优化] 优化暗黑/明亮主题切换及移动端操作适配体验。

## 1.5.0 - 2026-09-10

+ [新增] 创作面板支持多参数自定义调节（画面尺寸、质量、格式与压缩率）。
+ [新增] 支持无限画布创作工作区与历史作品快速回放编辑。
+ [优化] 提升多任务并发调度与图片异步流式响应速度。

## 1.0.0 - 2026-08-15

+ [新增] AI 生图创作工作台正式发布。
+ [新增] 支持文本生成图像、参考图生图与高清重绘。
+ [新增] 个人作品画廊管理与图片批量导出功能。
