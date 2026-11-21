# DESIGN.md · 项目视觉契约

> 任何 agent 接手这个项目时先读它，再动手写界面。
> 它只写「这个项目的视觉决定」，不重复通用规矩——通用规矩在 `web-ui-spec` 技能里。

---

## 0. 一句话

| 项 | 填 |
|---|---|
| 产品是什么 | ChatGPT 图片生成/编辑的 OpenAI 兼容工具站（自托管，多用户） |
| 界面主职 | 让用户在画廊/画布/Agent 三模式里快速完成图片生成与编辑 |
| 场景预设 | `admin`（后台/工具站） |
| 方向感 | 冷静、干净、利落——白底冷灰、蓝强调、克制的动效 |
| 明确不要的方向 | 暖色/米黄底（显脏）、渐变背景、四模式各自为政、静态死板 |

## 1. 令牌来源

| 项 | 填 |
|---|---|
| 令牌文件 | `web/src/app/globals.css`（shadcn oklch 体系）+ `playground/src/index.css`（HSL 通道体系）——两套均为令牌定义文件 |
| 色板 | **zinc 冷灰系**（禁止 stone 暖灰——1.16.1 前的暖黄底已清除） |
| 唯一允许写字面色值的位置 | 两个令牌文件的 `:root`/`.dark` 块（已用 `check-ignore-start/end` 豁免）；其他文件一律 Tailwind 类或 `var(--token)` |
| 主题机制 | `html.dark` 类切换（跟随手动选择，不跟随系统） |
| 强调色 | **蓝** `#2563eb`（playground --primary hsl(221 83% 53%)）；全站只用它一个；canvas.css 的 `--cw-accent` 与它一致 |
| 字阶 | ≤8 档：11px / 12px / 14px / 16px / clamp(30,4vw,42) / 1.6em / 1.35em / 1.15em |
| 间距基数 | 4px；可用档 4/8/12/16/20/24/32/48/64 |
| 圆角 | 6/8/12/16 + 全圆角；嵌套 = 外圆角 − 内边距 |
| 阴影 | 三档：`--cw-shadow-1/2/3`（冷灰黑，禁止 #000 纯黑与暖 alpha） |

## 2. 项目特有约定

- **双前端架构**：web/（Next.js 管理壳）+ playground/（三模式工作台，iframe 嵌入）——两套配色必须一致（zinc + 蓝）
- **四模式同一设计语言**：画廊 / Agent / 画布 / 设置共用 nav、圆角、阴影、强调色；禁止某模式单独换肤
- 画布点阵底：冷灰 `#a1a1aa/26%`，禁止暖灰
- 暗色模式：zinc 暗系（--cw-* 的 .dark 值），与浅色同一套令牌结构
- 前端构建产物（web/out、playground/dist）不入库，部署时重新构建

## 3. 硬性禁止（黑名单）

- stone 暖灰系（#f5f4f1/#e7e5e4/rgba(120,113,108,…) 等——黄调来源，1.16.1 已清除）
- 字面色值、`rgba()` 直接写在组件里（令牌定义块除外，需 check-ignore 豁免）
- 一屏两个以上实心主按钮 / 两个以上强调色
- `outline: none` 无替代焦点环（需 `check-ignore-next` 豁免 + 全局焦点环）
- `overflow-x: hidden` 掩盖横向溢出（纵向滚动容器用 `clip`）
- 一屏 9 档以上字号；正文 600+ 字重
- 纯图标按钮无 `aria-label`；`<img>` 无 `alt`
- 装饰性位移超 8px；入场动画无 `prefers-reduced-motion` 降级
- 长段落居中；正文加粗
- 「强大、一站式、赋能」类不可验证形容词

## 4. 验收

```bash
# web-ui-spec 门禁（error 必须为 0）
bun web-ui-spec/scripts/check.mjs web/src
bun web-ui-spec/scripts/check.mjs playground/src
# web 类型检查
cd web && bun x tsc --noEmit
# playground 测试
cd playground && bun run test
```

人眼三看：首屏 3 秒说清"这是什么、下一步" · 键盘 Tab 焦点清晰 · 暗色下边界可见。
