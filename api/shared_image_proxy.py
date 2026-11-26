from __future__ import annotations

import hashlib
import hmac
import json
import re
from urllib.parse import urlsplit

from anyio import CancelScope
from curl_cffi import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response, StreamingResponse

from api.support import require_identity
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


OPENAI_OPERATIONS = {
    "image": {"generate_image": "images/generations", "edit_image": "images/edits"},
    "chat": {"complete_text": "chat/completions", "run_agent": "responses"},
}


def _profile_model(profile: dict[str, object]) -> str:
    return str(profile.get("model") or (
        "gpt-4o" if profile.get("role") == "chat" else
        "fal-ai/flux/schnell" if profile.get("provider") == "fal" else "dall-e-3"
    ))


def managed_shared_profiles() -> list[dict[str, object]]:
    profiles = []
    for profile in config.get_shared_profiles(enabled_only=True):
        role = str(profile["role"])
        provider = str(profile["provider"])
        if provider == "fal" and role != "image":
            continue
        profiles.append({
            **{field: profile[field] for field in ("id", "name", "role", "provider", "description", "group", "enabled")},
            "model": _profile_model(profile),
            "managed": True,
            "operations": list(OPENAI_OPERATIONS[role]),
        })
    return profiles


def _managed_profile(profile_id: str) -> dict[str, object]:
    for profile in config.get_shared_profiles(enabled_only=True):
        if profile["id"] == profile_id:
            return profile
    raise HTTPException(status_code=404, detail={"error": "共享渠道不存在或已停用"})


async def _forward_managed(
    url: str, method: str, body: bytes, headers: dict[str, str], *, stream: bool = False,
) -> Response:
    session = requests.AsyncSession()
    try:
        response = await session.request(
            method, url, data=body or None, headers=headers, timeout=(15, 600),
            verify=True, allow_redirects=False, stream=stream,
        )
    except Exception as exc:
        await session.close()
        raise HTTPException(status_code=502, detail={"error": "共享上游请求失败"}) from exc
    except BaseException:
        await session.close()
        raise
    content_type = response.headers.get("content-type") or "application/json"
    if stream and response.ok and "text/event-stream" in content_type.lower():
        async def chunks():
            try:
                async for chunk in response.aiter_content():
                    yield chunk
            finally:
                with CancelScope(shield=True):
                    try:
                        await response.aclose()
                    finally:
                        await session.close()

        return StreamingResponse(chunks(), status_code=response.status_code, headers={
            "Content-Type": content_type, "Cache-Control": "no-store", "X-Accel-Buffering": "no",
        })
    try:
        if 300 <= response.status_code < 400:
            raise HTTPException(status_code=502, detail={"error": "共享渠道暂不支持上游重定向"})
        content = await response.acontent() if stream else response.content
        return Response(content, status_code=response.status_code, headers={"Content-Type": content_type})
    finally:
        await session.close()


async def _openai_request(request: Request, profile: dict[str, object], path: str) -> Response:
    body = await request.body()
    content_type = request.headers.get("content-type", "application/json")
    stream = False
    if content_type.split(";", 1)[0].strip().lower() == "application/json":
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail={"error": "请求 JSON 无效"}) from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail={"error": "请求 JSON 必须为对象"})
        model = payload.get("model")
        stream = payload.get("stream") is True
    elif path == "images/edits" and content_type.lower().startswith("multipart/form-data"):
        async with request.form() as form:
            model = form.get("model") if len(form.getlist("model")) == 1 else None
            stream = form.get("stream") == "true"
    else:
        raise HTTPException(status_code=415, detail={"error": "共享渠道不支持此请求格式"})
    if model != _profile_model(profile):
        raise HTTPException(status_code=403, detail={"error": "请求模型与共享配置不匹配"})
    upstream = _upstream_url(str(profile.get("base_url") or "https://api.openai.com/v1"), path)
    return await _forward_managed(upstream, "POST", body, {
        "Authorization": f"Bearer {profile['api_key']}",
        "Content-Type": content_type,
        "Accept": "text/event-stream" if stream else "application/json",
    }, stream=stream)


def _fal_endpoints(model: str) -> tuple[str, str, str]:
    path = model.strip("/")
    if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)+", path):
        raise HTTPException(status_code=502, detail={"error": "共享 fal 模型配置无效"})
    app = "/".join(path.split("/")[:3 if path.startswith(("workflows/", "comfy/")) else 2])
    if path.endswith("/edit"):
        return path.removesuffix("/edit") + "/text-to-image", path, app
    if path.endswith("/text-to-image"):
        return path, path.removesuffix("/text-to-image") + "/edit", app
    if "gpt-image-2.5/" in path:
        return path + "/text-to-image", path + "/edit", app
    return path, path + "/edit", app


def _fal_ticket(profile: dict[str, object], identity: dict[str, object], request_id: str) -> str:
    scope = json.dumps([profile["id"], _profile_model(profile), identity.get("role"), identity.get("id"), request_id])
    signature = hmac.new(str(config.auth_key).encode(), scope.encode(), hashlib.sha256).hexdigest()
    return f"{request_id}.{signature}"


async def _fal_request(request: Request, profile: dict[str, object], identity: dict[str, object]) -> Response:
    generate, edit, app = _fal_endpoints(_profile_model(profile))
    target = urlsplit(request.headers.get("x-fal-target-url", ""))
    if target.scheme != "https" or target.netloc != "queue.fal.run" or target.fragment:
        raise HTTPException(status_code=403, detail={"error": "共享 fal 仅支持已配置的队列操作"})

    method = request.method
    requested_path = target.path.strip("/")
    submitting = method == "POST" and requested_path in {generate, edit} and not target.query
    if submitting:
        path = requested_path
    else:
        match = re.fullmatch(re.escape(app) + r"/requests/([a-zA-Z0-9_-]+)\.([a-f0-9]{64})(/status|/cancel)?", requested_path)
        if not match:
            raise HTTPException(status_code=403, detail={"error": "共享 fal 任务地址无效"})
        request_id, signature, operation = match.groups()
        valid_method = method == ("PUT" if operation == "/cancel" else "GET")
        allowed_query = target.query in {"", "logs=0", "logs=1"} if operation == "/status" else not target.query
        if not valid_method or not allowed_query or not hmac.compare_digest(_fal_ticket(profile, identity, request_id), f"{request_id}.{signature}"):
            raise HTTPException(status_code=403, detail={"error": "共享 fal 任务未授权"})
        path = f"{app}/requests/{request_id}{operation or ''}"
    upstream = f"https://queue.fal.run/{path}" + (f"?{target.query}" if target.query else "")
    headers = {"Authorization": f"Key {profile['api_key']}", "Content-Type": "application/json"}
    base_url = str(profile.get("base_url") or "https://fal.run").strip().rstrip("/")
    if base_url not in {"https://fal.run", "https://queue.fal.run"}:
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise HTTPException(status_code=502, detail={"error": "共享 fal 代理地址无效"})
        headers["X-Fal-Target-Url"] = upstream
        upstream = base_url
    response = await _forward_managed(upstream, method, await request.body(), headers)
    if not submitting or not 200 <= response.status_code < 300:
        return response
    try:
        payload = json.loads(response.body)
        request_id = payload["request_id"]
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", request_id):
            raise ValueError
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail={"error": "共享 fal 未返回有效任务 ID"}) from exc
    return JSONResponse({"request_id": _fal_ticket(profile, identity, request_id)}, status_code=response.status_code)


def create_router() -> APIRouter:
    router = APIRouter()

    @router.api_route("/v1/workbench/shared/{profile_id}/fal", methods=["POST", "GET", "PUT"])
    async def managed_fal(profile_id: str, request: Request) -> Response:
        identity = require_identity(request.headers.get("authorization"))
        profile = _managed_profile(profile_id)
        if profile["provider"] != "fal" or profile["role"] != "image":
            raise HTTPException(status_code=404, detail={"error": "共享 fal 渠道不可用"})
        return await _fal_request(request, profile, identity)

    @router.post("/v1/workbench/shared/{profile_id}/{path:path}")
    async def managed_openai(profile_id: str, path: str, request: Request) -> Response:
        require_identity(request.headers.get("authorization"))
        profile = _managed_profile(profile_id)
        allowed = OPENAI_OPERATIONS.get(str(profile["role"]), {})
        if profile["provider"] == "fal" or path not in allowed.values():
            raise HTTPException(status_code=403, detail={"error": "共享渠道不支持该操作"})
        return await _openai_request(request, profile, path)

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
