from __future__ import annotations

import json
from urllib.parse import urlsplit

from curl_cffi import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from services.config import config


def _bearer_token(value: str | None) -> str:
    scheme, _, token = str(value or "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def _find_profile(token: str, model: str) -> dict[str, object]:
    if not token:
        raise HTTPException(status_code=401, detail={"error": "共享模型密钥无效"})

    for profile in config.get_shared_profiles(enabled_only=True):
        if profile.get("role") != "image":
            continue
        if profile.get("provider") not in {"openai", "custom"}:
            continue
        if str(profile.get("api_key") or "").strip() != token:
            continue
        configured_model = str(profile.get("model") or "").strip()
        if configured_model and model and configured_model != model:
            continue
        return profile

    raise HTTPException(status_code=403, detail={"error": "共享图片模型未授权或模型不匹配"})


def _upstream_url(base_url: str, path: str) -> str:
    value = str(base_url or "").strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
        raise HTTPException(status_code=502, detail={"error": "共享图片模型地址无效"})
    if parsed.username or parsed.password:
        raise HTTPException(status_code=502, detail={"error": "共享图片模型地址不允许携带账号信息"})
    if parsed.path.rstrip("/").endswith("/v1"):
        return f"{value}/{path.lstrip('/')}"
    return f"{value}/v1/{path.lstrip('/')}"


def _model_from_body(content_type: str, body: bytes) -> str:
    if content_type.split(";", 1)[0].strip().lower() != "application/json":
        return ""
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ""
    return str(payload.get("model") or "").strip() if isinstance(payload, dict) else ""


def _forward_sync(url: str, body: bytes, content_type: str, api_key: str, accept: str, user_agent: str):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": content_type,
        "Accept": accept or "*/*",
    }
    if user_agent:
        headers["User-Agent"] = user_agent
    try:
        return requests.post(url, data=body, headers=headers, timeout=(15, 600), verify=True)
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": f"共享图片上游请求失败: {exc}"}) from exc


def create_router() -> APIRouter:
    router = APIRouter()

    @router.post("/api-proxy/images/generations")
    @router.post("/api-proxy/images/edits")
    async def proxy_shared_image(request: Request) -> Response:
        path = request.url.path.rsplit("/", 1)[-1]
        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        profile = _find_profile(
            _bearer_token(request.headers.get("authorization")),
            _model_from_body(content_type, body),
        )
        upstream = _upstream_url(str(profile.get("base_url") or ""), f"images/{path}")
        response = await run_in_threadpool(
            _forward_sync,
            upstream,
            body,
            content_type,
            str(profile.get("api_key") or "").strip(),
            request.headers.get("accept", ""),
            request.headers.get("user-agent", ""),
        )
        response_content_type = response.headers.get("content-type") or "application/json"
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers={"Content-Type": response_content_type},
        )

    return router
