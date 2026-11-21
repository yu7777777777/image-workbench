# 服务层

这里是项目的核心业务逻辑。API 层只负责接收请求，主要业务应在这里实现并配套测试。

- `account_service.py`：账号池、token、并发和账号状态
- `account_refresh_scheduler.py`：自动和手动刷新协调
- `image_service.py`、`image_task_service.py`：图片调用和任务轮询
- `openai_backend_api.py`、`openai_oauth.py`：上游请求和 OAuth
- `protocol/`：OpenAI/Anthropic 兼容协议
- `storage/`：JSON、SQLite 等存储后端
