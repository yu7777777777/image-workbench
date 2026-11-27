FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY RELEASE-NOTES.md /app/RELEASE-NOTES.md
COPY web ./
RUN NEXT_PUBLIC_APP_VERSION="$(cat /app/VERSION)" npm run build

FROM node:22-alpine AS playground-build
WORKDIR /app/playground
COPY playground/package.json playground/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY playground ./
RUN rm -f .env.local .env.test dev-proxy.config.json gpt-image-config.local.json
RUN VITE_ACCOUNT_POOL=true VITE_DEFAULT_API_URL= VITE_API_PROXY_AVAILABLE=true npm run build

FROM chatgpt2api:refresh-20260920
COPY VERSION CHANGELOG.md RELEASE-NOTES.md main.py /app/
COPY api/__init__.py api/accounts.py api/ai.py api/app.py api/creative.py api/errors.py api/image_inputs.py api/image_tasks.py api/shared_image_proxy.py api/support.py api/system.py /app/api/
COPY services/__init__.py services/account_service.py services/account_refresh_scheduler.py services/auth_service.py services/backup_service.py services/config.py services/content_filter.py services/cpa_service.py /app/services/
COPY services/model_service.py services/openai_backend_api.py services/proxy_service.py /app/services/
COPY services/sentinel_solver_service.py services/sub2api_service.py /app/services/
COPY services/oauth_login_service.py services/openai_oauth.py /app/services/
COPY services/upload_limits.py /app/services/
COPY services/log_service.py services/image_task_service.py services/image_tags_service.py /app/services/
COPY services/editable_file_task_service.py services/image_storage_service.py services/image_service.py /app/services/
COPY services/chat_attachments.py /app/services/
COPY services/image_comments.py services/image_markup.py services/README.md /app/services/
COPY services/storage/__init__.py services/storage/base.py services/storage/database_storage.py services/storage/factory.py services/storage/json_storage.py /app/services/storage/
COPY services/protocol/__init__.py services/protocol/anthropic_v1_messages.py services/protocol/chat_completion_cache.py services/protocol/conversation.py services/protocol/error_response.py services/protocol/openai_search.py services/protocol/openai_v1_chat_complete.py services/protocol/openai_v1_image_edit.py services/protocol/openai_v1_image_generations.py services/protocol/openai_v1_models.py services/protocol/openai_v1_response.py services/protocol/response_function_tools.py services/protocol/web_search_tool.py /app/services/protocol/
COPY services/protocol/chat_rich_content.py /app/services/protocol/
COPY utils/__init__.py utils/helper.py utils/image_tokens.py utils/log.py utils/pkce.py utils/pow.py utils/sentinel.py utils/turnstile.py /app/utils/
COPY --from=web-build /app/web/out /app/web_dist
COPY --from=playground-build /app/playground/dist /app/playground_dist
