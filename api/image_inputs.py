from __future__ import annotations

import base64
import binascii
import ipaddress
import json
import mimetypes
import re
import socket
from pathlib import PurePosixPath
from typing import Any, TypeGuard
from urllib.parse import unquote, unquote_to_bytes, urlparse

from curl_cffi import requests
from fastapi import HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from services.image_comments import image_comments_to_dicts, normalize_image_comments
from services.image_markup import markup_strokes_to_dicts, normalize_markup_strokes
from services.proxy_service import proxy_settings

ImageInput = tuple[bytes, str, str]
ImageSource = str | UploadFile | ImageInput

MAX_IMAGE_REFERENCE_BYTES = 50 * 1024 * 1024
IMAGE_REFERENCE_FIELDS = {"image", "image[]", "images", "images[]", "image_url", "image_url[]"}
MASK_REFERENCE_FIELDS = {"mask", "mask[]"}
MARKUP_REFERENCE_FIELDS = {"markup", "markup[]"}


def _clean(value: object, default: str = "") -> str:
    """清理字符串：转换为字符串并去掉首尾空白。"""
    text = str(value if value is not None else default).strip()
    return text or default


def _is_upload(value: object) -> TypeGuard[UploadFile]:
    """识别上传文件：兼容 Starlette 表单返回的 UploadFile。"""
    return isinstance(value, UploadFile)


def _parse_bool(value: object) -> bool | None:
    """解析布尔字段：兼容 JSON 布尔值和表单字符串。"""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    text = _clean(value).lower()
    if text in {"true", "1", "yes", "y", "on"}:
        return True
    if text in {"false", "0", "no", "n", "off"}:
        return False
    raise HTTPException(status_code=400, detail={"error": "stream must be a boolean"})


def _parse_count(value: object) -> int:
    """解析生成数量：保持图片接口的 1 到 4 限制。"""
    try:
        count = int(value or 1)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail={"error": "n must be an integer"}) from exc
    if count < 1 or count > 4:
        raise HTTPException(status_code=400, detail={"error": "n must be between 1 and 4"})
    return count


def _parse_comments_field(value: object) -> list[dict[str, Any]]:
    """解析评论字段：支持 JSON 字符串（表单）或数组（JSON 请求体）。"""
    if value is None or value == "" or value == []:
        return []
    try:
        comments = normalize_image_comments(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": f"invalid comments: {exc}"}) from exc
    return image_comments_to_dicts(comments)


def _parse_markup_strokes_field(value: object) -> list[dict[str, Any]]:
    """解析标注笔迹字段：支持 JSON 字符串（表单）或数组（JSON 请求体）。"""
    if value is None or value == "" or value == []:
        return []
    try:
        strokes = normalize_markup_strokes(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": f"invalid markup_strokes: {exc}"}) from exc
    return markup_strokes_to_dicts(strokes)


def _payload_from_fields(fields: dict[str, Any], *, has_markup_overlay: bool = False) -> dict[str, Any]:
    """构造图片编辑载荷：从表单或 JSON 字段提取通用参数。"""
    prompt = _clean(fields.get("prompt"))
    comments = _parse_comments_field(fields.get("comments"))
    markup_strokes = _parse_markup_strokes_field(fields.get("markup_strokes"))
    if not prompt and not comments and not markup_strokes and not has_markup_overlay:
        raise HTTPException(status_code=400, detail={"error": "prompt is required"})
    payload = {
        "prompt": prompt,
        "model": _clean(fields.get("model"), "gpt-image-2"),
        "n": _parse_count(fields.get("n")),
        "size": _clean(fields.get("size")) or None,
        "quality": _clean(fields.get("quality"), "auto"),
        "response_format": _clean(fields.get("response_format")) or None,
        "stream": _parse_bool(fields.get("stream")),
    }
    if comments:
        payload["comments"] = comments
    if markup_strokes:
        payload["markup_strokes"] = markup_strokes
    if "client_task_id" in fields:
        payload["client_task_id"] = _clean(fields.get("client_task_id"))
    return payload


def _json_reference_value(value: object) -> object:
    """解析表单图片引用：支持把 images 字段写成 JSON 字符串。"""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "[{":
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def _decode_base64_image(value: object, filename: str, mime_type: str) -> ImageInput:
    try:
        data = base64.b64decode(str(value).strip(), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail={"error": "invalid base64 image data"}) from exc
    if not data:
        raise HTTPException(status_code=400, detail={"error": "image file is empty"})
    if len(data) > MAX_IMAGE_REFERENCE_BYTES:
        raise HTTPException(status_code=400, detail={"error": "image URL exceeds 50MB limit"})
    return data, filename, mime_type


def _source_from_object(value: dict[str, Any]) -> list[ImageSource]:
    """提取图片引用对象：支持 image_url 或 url，明确拒绝 file_id。"""
    has_url = "image_url" in value or "url" in value
    if value.get("file_id"):
        raise HTTPException(
            status_code=400,
            detail={"error": "file_id image references are not supported; use image_url instead"},
        )
    inline = value.get("b64_json") or value.get("base64")
    if inline:
        filename = _clean(value.get("filename") or value.get("file_name"), "image.png")
        mime_type = _clean(value.get("mime_type") or value.get("mimeType"), "image/png")
        return [_decode_base64_image(inline, filename, mime_type)]
    if not has_url:
        raise HTTPException(status_code=400, detail={"error": "image reference must include image_url"})
    image_url = value.get("image_url", value.get("url"))
    if isinstance(image_url, dict):
        image_url = image_url.get("url")
    return _sources_from_value(image_url)


def _sources_from_value(value: object) -> list[ImageSource]:
    """展开图片引用：把字符串、数组和对象统一成图片来源列表。"""
    value = _json_reference_value(value)
    if _is_upload(value):
        return [value]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text.lower().startswith(("data:", "http://", "https://")):
            return [text]
        return [_decode_base64_image(text, "image.png", "image/png")]
    if isinstance(value, list):
        sources: list[ImageSource] = []
        for item in value:
            sources.extend(_sources_from_value(item))
        return sources
    if isinstance(value, dict):
        return _source_from_object(value)
    if value is None:
        return []
    raise HTTPException(status_code=400, detail={"error": "invalid image reference"})


def _json_image_sources(body: dict[str, Any]) -> list[ImageSource]:
    """读取 JSON 图片引用：优先支持官方 images 数组字段。"""
    sources: list[ImageSource] = []
    for key in ("images", "image", "image_url"):
        if key in body:
            sources.extend(_sources_from_value(body.get(key)))
    return sources


def _json_mask_sources(body: dict[str, Any]) -> list[ImageSource]:
    """读取 JSON mask 引用。"""
    mask = body.get("mask")
    if mask is not None:
        return _sources_from_value(mask)
    return []


def _json_markup_sources(body: dict[str, Any]) -> list[ImageSource]:
    """读取 JSON markup overlay 引用（透明笔迹图，语义同 mask）。"""
    markup = body.get("markup")
    if markup is not None:
        return _sources_from_value(markup)
    return []


async def parse_image_edit_request(request: Request) -> tuple[dict[str, Any], list[ImageSource], list[ImageSource], list[ImageSource]]:
    """解析图片编辑请求：同时支持 multipart 上传和官方 JSON 图片 URL。
    
    返回 (payload, image_sources, mask_sources, markup_sources)
    """
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type == "application/json":
        try:
            body = await request.json()
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail={"error": "invalid JSON body"}) from exc
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail={"error": "JSON body must be an object"})
        markup_sources = _json_markup_sources(body)
        payload = _payload_from_fields(body, has_markup_overlay=bool(markup_sources))
        return payload, _json_image_sources(body), _json_mask_sources(body), markup_sources

    form = await request.form()
    fields: dict[str, Any] = {}
    for key in ("client_task_id", "prompt", "model", "n", "size", "quality", "response_format", "stream", "comments", "markup_strokes"):
        value = form.get(key)
        if isinstance(value, str):
            fields[key] = value
    sources: list[ImageSource] = []
    mask_sources: list[ImageSource] = []
    markup_sources: list[ImageSource] = []
    for key, value in form.multi_items():
        if key in IMAGE_REFERENCE_FIELDS:
            sources.extend(_sources_from_value(value))
        elif key in MASK_REFERENCE_FIELDS:
            mask_sources.extend(_sources_from_value(value))
        elif key in MARKUP_REFERENCE_FIELDS:
            markup_sources.extend(_sources_from_value(value))
    payload = _payload_from_fields(fields, has_markup_overlay=bool(markup_sources))
    return payload, sources, mask_sources, markup_sources


def _extension_from_mime(mime_type: str) -> str:
    """推导图片扩展名：把 MIME 类型转换为常见文件后缀。"""
    subtype = mime_type.split("/", 1)[1].split("+", 1)[0] if "/" in mime_type else "png"
    if subtype == "jpeg":
        return "jpg"
    return re.sub(r"[^a-z0-9]+", "", subtype.lower()) or "png"


def _safe_filename(name: str, mime_type: str, fallback: str) -> str:
    """生成安全文件名：清理 URL 文件名并补齐扩展名。"""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not cleaned:
        cleaned = fallback
    if "." not in cleaned:
        cleaned = f"{cleaned}.{_extension_from_mime(mime_type)}"
    return cleaned


def _decode_data_url(url: str) -> ImageInput:
    """解码 data URL：把内联图片转成标准图片输入元组。"""
    header, separator, payload = url.partition(",")
    if not separator:
        raise HTTPException(status_code=400, detail={"error": "invalid data image URL"})
    mime_type = header.split(";", 1)[0].removeprefix("data:") or "image/png"
    if not mime_type.startswith("image/"):
        raise HTTPException(status_code=400, detail={"error": "image_url must point to an image"})
    try:
        data = base64.b64decode(payload, validate=True) if ";base64" in header else unquote_to_bytes(payload)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail={"error": "invalid data image URL"}) from exc
    if not data:
        raise HTTPException(status_code=400, detail={"error": "image URL is empty"})
    if len(data) > MAX_IMAGE_REFERENCE_BYTES:
        raise HTTPException(status_code=400, detail={"error": "image URL exceeds 50MB limit"})
    return data, f"image_url.{_extension_from_mime(mime_type)}", mime_type


def _response_mime_type(response: requests.Response, parsed_path: str) -> str:
    """识别下载图片类型：优先响应头，必要时按 URL 后缀推断。"""
    header_type = str(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    guessed_type = mimetypes.guess_type(parsed_path)[0] or ""
    if header_type.startswith("image/"):
        return header_type
    if header_type and header_type not in {"application/octet-stream", "binary/octet-stream"}:
        raise HTTPException(status_code=400, detail={"error": "image_url must point to an image"})
    if guessed_type.startswith("image/"):
        return guessed_type
    if not header_type or header_type in {"application/octet-stream", "binary/octet-stream"}:
        return "image/png"
    raise HTTPException(status_code=400, detail={"error": "image_url must point to an image"})


def _filename_from_url(parsed_path: str, mime_type: str) -> str:
    """生成 URL 图片文件名：从链接路径提取名称并做安全化。"""
    raw_name = PurePosixPath(unquote(parsed_path)).name
    return _safe_filename(raw_name, mime_type, "image_url")


def _assert_public_image_url(source: str) -> None:
    """SSRF 防护：拒绝解析到内网/环回/链路本地地址的图片 URL。

    仅做域名解析层面的拦截（重定向与 DNS 重绑定仍可能绕过，属已知残留面），
    阻止最常见的内网探测路径。本函数阻塞（getaddrinfo），只在 threadpool 里调用。
    """
    parsed = urlparse(source)
    host = parsed.hostname or ""
    if not host:
        raise HTTPException(status_code=400, detail={"error": "image_url host is required"})
    try:
        addrinfos = socket.getaddrinfo(
            host,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            proto=socket.IPPROTO_TCP,
        )
    except OSError as exc:
        raise HTTPException(status_code=400, detail={"error": f"image_url host resolution failed: {exc}"}) from exc
    for addrinfo in addrinfos:
        try:
            ip = ipaddress.ip_address(addrinfo[4][0])
        except ValueError:
            continue
        if not ip.is_global:
            raise HTTPException(status_code=400, detail={"error": "image_url 不允许指向内网、本机或链路本地地址"})


def _download_image_url(url: str) -> ImageInput:
    """下载远程图片：把 http/https 图片链接转成标准图片输入元组。"""
    source = _clean(url)
    if source.startswith("data:"):
        return _decode_data_url(source)
    parsed = urlparse(source)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail={"error": "image_url must be an http or https URL"})
    _assert_public_image_url(source)
    try:
        response = requests.get(
            source,
            headers={"Accept": "image/*,*/*;q=0.8", "User-Agent": "chatgpt2api image fetcher"},
            timeout=60,
            allow_redirects=True,
            **proxy_settings.build_session_kwargs(),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"error": f"image_url fetch failed: {exc}"}) from exc
    if not 200 <= response.status_code < 300:
        raise HTTPException(status_code=400, detail={"error": f"image_url fetch failed: HTTP {response.status_code}"})
    content_length = _clean(response.headers.get("content-length"))
    if content_length and content_length.isdigit() and int(content_length) > MAX_IMAGE_REFERENCE_BYTES:
        raise HTTPException(status_code=400, detail={"error": "image_url exceeds 50MB limit"})
    data = response.content
    if not data:
        raise HTTPException(status_code=400, detail={"error": "image_url returned empty content"})
    if len(data) > MAX_IMAGE_REFERENCE_BYTES:
        raise HTTPException(status_code=400, detail={"error": "image_url exceeds 50MB limit"})
    mime_type = _response_mime_type(response, parsed.path)
    return data, _filename_from_url(parsed.path, mime_type), mime_type


async def read_image_sources(sources: list[ImageSource]) -> list[ImageInput]:
    """读取图片来源：上传文件直接读取，URL 下载后统一返回图片元组。"""
    images: list[ImageInput] = []
    for source in sources:
        if isinstance(source, tuple):
            images.append(source)
            continue
        if _is_upload(source):
            try:
                image_data = await source.read()
            finally:
                await source.close()
            if not image_data:
                raise HTTPException(status_code=400, detail={"error": "image file is empty"})
            images.append((image_data, source.filename or "image.png", source.content_type or "image/png"))
            continue
        images.append(await run_in_threadpool(_download_image_url, source))
    if not images:
        raise HTTPException(status_code=400, detail={"error": "image file or image_url is required"})
    return images
