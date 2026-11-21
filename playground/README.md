# 图片工作台资源

该目录是接入 `CookSleep/gpt_image_playground` 后保留的静态工作台资源。它由 ChatGPT2API 的图片 API 提供生成和编辑能力。

页面入口和业务组件位于 `web/src/app/image/`；这里主要放工作台构建后的资源，不要把账号或运行数据放入此目录。

本地独立运行画布时，`dev-proxy.config.json` 只保存代理地址，根目录 `.env.local` 的 `PLAYGROUND_DEV_PROXY_API_KEY` 由 Vite 服务端读取并替换请求头；`playground/.env.local` 和 `gpt-image-config.local.json` 只包含前端预置配置和测试占位值。这些本地文件均不提交。不要把真实密钥放入 `VITE_` 环境变量或 Vite 项目根目录下可直接访问的 JSON 文件。
