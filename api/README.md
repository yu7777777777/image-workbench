# API 层

这里是 FastAPI 路由和输入解析层。接口入口包括图片生成、图片编辑、账号管理、配置和兼容的 OpenAI API。

- `app.py`：组装应用和路由
- `image_inputs.py`：图片上传、URL、data URL 和多图输入解析
- `image_tasks.py`：图片任务 API
- `accounts.py`：账号管理 API
- `system.py`：系统配置和运行状态 API
