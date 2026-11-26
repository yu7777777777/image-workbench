from __future__ import annotations

import hashlib
import json
import itertools
import os
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, StreamingResponse

from services.config import DATA_DIR
from services.protocol.error_response import anthropic_error_response, openai_error_response
from utils.helper import anthropic_sse_stream, sse_json_stream

LOG_TYPE_CALL = "call"
LOG_TYPE_ACCOUNT = "account"
INTERNAL_RESPONSE_KEYS = {"_account_email", "_conversation_id"}

# 日志展示时间统一按北京时间输出，不依赖容器/系统时区（容器默认 UTC）。
_LOCAL_TZ = timezone(timedelta(hours=8))


def _local_time(ts: float | None = None) -> datetime:
    return datetime.fromtimestamp(ts, tz=_LOCAL_TZ) if ts is not None else datetime.now(_LOCAL_TZ)


def _now_str() -> str:
    return _local_time().strftime("%Y-%m-%d %H:%M:%S")


def _shift_to_local(value: object) -> str:
    """历史日志记录的是 UTC 时间串，整体后移 8 小时转为北京时间。"""
    text = str(value or "").strip()
    if not text:
        return text
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return text
    return parsed.astimezone(_LOCAL_TZ).strftime("%Y-%m-%d %H:%M:%S")


class LogService:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _legacy_id(raw_line: str, line_number: int) -> str:
        payload = f"{line_number}:{raw_line}".encode("utf-8", errors="ignore")
        return hashlib.sha1(payload).hexdigest()[:24]

    def _parse_line(self, raw_line: str, line_number: int) -> dict[str, Any] | None:
        try:
            item = json.loads(raw_line)
        except Exception:
            return None
        if not isinstance(item, dict):
            return None
        parsed = dict(item)
        parsed["id"] = str(parsed.get("id") or self._legacy_id(raw_line, line_number))
        return parsed

    @staticmethod
    def _serialize_item(item: dict[str, Any]) -> str:
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _matches_filters(item: dict[str, Any], *, type: str = "", start_date: str = "", end_date: str = "") -> bool:
        t = str(item.get("time") or "")
        day = t[:10]
        if type and item.get("type") != type:
            return False
        if start_date and day < start_date:
            return False
        if end_date and day > end_date:
            return False
        return True

    def add(self, type: str, summary: str = "", detail: dict[str, Any] | None = None, **data: Any) -> None:
        item = {
            "id": uuid4().hex,
            "time": _now_str(),
            "type": type,
            "summary": summary,
            "detail": detail or data,
        }
        with self.path.open("a", encoding="utf-8") as file:
            file.write(self._serialize_item(item) + "\n")

    def _line_count(self) -> int:
        with self.path.open("rb") as file:
            return sum(1 for _ in file)

    def _iter_reverse_lines(self):
        """Yield (line number, text) from the end without loading the file."""
        chunk_size = 64 * 1024
        line_number = self._line_count() - 1
        pending = b""
        with self.path.open("rb") as file:
            file.seek(0, os.SEEK_END)
            while file.tell() > 0:
                read_size = min(chunk_size, file.tell())
                file.seek(-read_size, os.SEEK_CUR)
                pending = file.read(read_size) + pending
                file.seek(-read_size, os.SEEK_CUR)
                parts = pending.split(b"\n")
                pending = parts.pop(0)
                for raw_line in reversed(parts):
                    yield line_number, raw_line.decode("utf-8", errors="replace")
                    line_number -= 1
            if pending:
                yield line_number, pending.decode("utf-8", errors="replace")

    def _migrate_timezone(self) -> None:
        """把历史日志里按容器时区（UTC）写入的时间校正为北京时间，只执行一次。"""
        marker_path = self.path.parent / ".logs_timezone_migrated"
        if marker_path.exists() or not self.path.exists():
            return
        temp_path = self.path.with_suffix(".migrating")
        try:
            with self.path.open("r", encoding="utf-8", errors="replace") as source, \
                    temp_path.open("w", encoding="utf-8") as target:
                for line_number, raw_line in enumerate(source):
                    clean_line = raw_line.rstrip("\r\n")
                    if not clean_line:
                        target.write(raw_line)
                        continue
                    try:
                        item = json.loads(clean_line)
                    except json.JSONDecodeError:
                        target.write(clean_line + "\n")
                        continue
                    if isinstance(item, dict):
                        item["time"] = _shift_to_local(item.get("time"))
                        detail = item.get("detail")
                        if isinstance(detail, dict):
                            for key in ("started_at", "ended_at"):
                                if key in detail:
                                    detail[key] = _shift_to_local(detail[key])
                    target.write(self._serialize_item(item) + "\n")
            os.replace(temp_path, self.path)
            marker_path.write_text("1", encoding="utf-8")
        except OSError:
            if temp_path.exists():
                temp_path.unlink(missing_ok=True)

    def list(self, type: str = "", start_date: str = "", end_date: str = "", limit: int = 200) -> list[dict[str, Any]]:
        self._migrate_timezone()
        if not self.path.exists():
            return []
        items: list[dict[str, Any]] = []
        for line_number, raw_line in self._iter_reverse_lines():
            item = self._parse_line(raw_line, line_number)
            if item is None:
                continue
            if not self._matches_filters(item, type=type, start_date=start_date, end_date=end_date):
                continue
            items.append(item)
            if len(items) >= limit:
                break
        return items

    def delete(self, ids: list[str]) -> dict[str, int]:
        target_ids = {str(item or "").strip() for item in ids if str(item or "").strip()}
        if not self.path.exists() or not target_ids:
            return {"removed": 0}
        removed = 0
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent,
                                         prefix=f".{self.path.name}.", suffix=".tmp", delete=False) as temp:
            temp_path = Path(temp.name)
            with self.path.open("r", encoding="utf-8", errors="replace") as source:
                for line_number, raw_line in enumerate(source):
                    raw_line = raw_line.rstrip("\r\n")
                    item = self._parse_line(raw_line, line_number)
                    if item is not None and str(item.get("id") or "") in target_ids:
                        removed += 1
                        continue
                    temp.write(raw_line + "\n")
        os.replace(temp_path, self.path)
        return {"removed": removed}

    def cleanup_before(self, days: int, *, type: str = LOG_TYPE_ACCOUNT) -> dict[str, int]:
        if days < 1:
            raise ValueError("清理天数必须至少为 1 天")
        if not self.path.exists():
            return {"removed": 0}
        cutoff = _local_time() - timedelta(days=days)
        removed = 0
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=self.path.parent,
                                         prefix=f".{self.path.name}.", suffix=".tmp", delete=False) as temp:
            temp_path = Path(temp.name)
            with self.path.open("r", encoding="utf-8", errors="replace") as source:
                for line_number, raw_line in enumerate(source):
                    clean_line = raw_line.rstrip("\r\n")
                    item = self._parse_line(clean_line, line_number)
                    item_time = self._parse_time(item.get("time")) if item else None
                    if item and item.get("type") == type and item_time is not None and item_time < cutoff:
                        removed += 1
                        continue
                    temp.write(clean_line + "\n")
        os.replace(temp_path, self.path)
        return {"removed": removed}

    @staticmethod
    def _parse_time(value: object) -> datetime | None:
        try:
            # 日志里的时间串按北京时间写入，解析时补上时区以便与 cutoff 比较。
            return datetime.strptime(str(value or ""), "%Y-%m-%d %H:%M:%S").replace(tzinfo=_LOCAL_TZ)
        except ValueError:
            return None


log_service = LogService(DATA_DIR / "logs.jsonl")


def _collect_urls(value: object) -> list[str]:
    urls: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "url" and isinstance(item, str):
                urls.append(item)
            elif key == "urls" and isinstance(item, list):
                urls.extend(str(url) for url in item if isinstance(url, str))
            else:
                urls.extend(_collect_urls(item))
    elif isinstance(value, list):
        for item in value:
            urls.extend(_collect_urls(item))
    return urls


def _collect_account_emails(value: object) -> list[str]:
    emails: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"_account_email", "account_email"} and isinstance(item, str) and item.strip():
                emails.append(item.strip())
            else:
                emails.extend(_collect_account_emails(item))
    elif isinstance(value, list):
        for item in value:
            emails.extend(_collect_account_emails(item))
    return emails


def _collect_conversation_ids(value: object) -> list[str]:
    ids: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "_conversation_id" and isinstance(item, str) and item.strip():
                ids.append(item.strip())
            else:
                ids.extend(_collect_conversation_ids(item))
    elif isinstance(value, list):
        for item in value:
            ids.extend(_collect_conversation_ids(item))
    return ids


def _strip_internal_response_fields(value: object) -> object:
    if isinstance(value, dict):
        return {
            key: _strip_internal_response_fields(item)
            for key, item in value.items()
            if key not in INTERNAL_RESPONSE_KEYS
        }
    if isinstance(value, list):
        return [_strip_internal_response_fields(item) for item in value]
    return value


def _request_excerpt(text: object, limit: int = 1000) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    normalized = " ".join(value.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _image_error_response(exc: Exception) -> JSONResponse:
    from services.protocol.conversation import public_image_error_message

    message = public_image_error_message(str(exc))
    if "no available image quota" in message.lower():
        return openai_error_response(
            {
                "error": {
                    "message": "no available image quota",
                    "type": "insufficient_quota",
                    "param": None,
                    "code": "insufficient_quota",
                }
            },
            429,
        )
    if hasattr(exc, "to_openai_error") and hasattr(exc, "status_code"):
        return JSONResponse(status_code=int(exc.status_code), content=exc.to_openai_error())
    return openai_error_response(message, 502)


def _protocol_error_response(exc: Exception, status_code: int, sse: str) -> JSONResponse:
    message = str(exc)
    if sse == "anthropic":
        return anthropic_error_response(message, status_code)
    return openai_error_response(message, status_code)


def _next_item(items):
    try:
        return True, next(items)
    except StopIteration:
        return False, None


@dataclass
class LoggedCall:
    identity: dict[str, object]
    endpoint: str
    model: str
    summary: str
    started: float = field(default_factory=time.time)
    request_text: str = ""
    request_shape: dict[str, int] | None = None

    async def run(self, handler, *args, sse: str = "openai"):
        from services.protocol.conversation import ImageGenerationError

        try:
            result = await run_in_threadpool(handler, *args)
        except ImageGenerationError as exc:
            self.log("调用失败", status="failed", error=str(exc), account_email=getattr(exc, "account_email", ""),
                     conversation_id=getattr(exc, "conversation_id", ""))
            return _image_error_response(exc)
        except HTTPException as exc:
            self.log("调用失败", status="failed", error=str(exc.detail))
            raise
        except Exception as exc:
            self.log("调用失败", status="failed", error=str(exc), account_email=getattr(exc, "account_email", ""))
            if self.endpoint.startswith("/v1/images"):
                return _image_error_response(exc)
            return _protocol_error_response(exc, 502, sse)

        if isinstance(result, dict):
            self.log("调用完成", result)
            response = dict(result)
            response.pop("_account_email", None)
            return response

        sender = anthropic_sse_stream if sse == "anthropic" else sse_json_stream
        try:
            has_first, first = await run_in_threadpool(_next_item, result)
        except ImageGenerationError as exc:
            self.log("调用失败", status="failed", error=str(exc), account_email=getattr(exc, "account_email", ""),
                     conversation_id=getattr(exc, "conversation_id", ""))
            return _image_error_response(exc)
        except HTTPException as exc:
            self.log("调用失败", status="failed", error=str(exc.detail))
            raise
        except Exception as exc:
            self.log("调用失败", status="failed", error=str(exc), account_email=getattr(exc, "account_email", ""))
            if self.endpoint.startswith("/v1/images"):
                return _image_error_response(exc)
            return _protocol_error_response(exc, 502, sse)
        if not has_first:
            self.log("流式调用结束")
            return StreamingResponse(sender(()), media_type="text/event-stream")
        return StreamingResponse(sender(self.stream(itertools.chain([first], result))), media_type="text/event-stream")

    def stream(self, items):
        urls: list[str] = []
        account_emails: list[str] = []
        conversation_ids: list[str] = []
        failed = False
        try:
            for item in items:
                log_item = item
                if self.endpoint == "/v1/chat/completions" and isinstance(item, dict) and "workbench" in item:
                    log_item = {key: value for key, value in item.items() if key != "workbench"}
                urls.extend(_collect_urls(log_item))
                account_emails.extend(_collect_account_emails(log_item))
                conversation_ids.extend(_collect_conversation_ids(log_item))
                yield _strip_internal_response_fields(item)
        except Exception as exc:
            failed = True
            self.log(
                "流式调用失败",
                status="failed",
                error=str(exc),
                urls=urls,
                account_email=(account_emails[0] if account_emails else getattr(exc, "account_email", "")),
                conversation_id=(conversation_ids[0] if conversation_ids else getattr(exc, "conversation_id", "")),
            )
            if self.endpoint.startswith("/v1/images") and not hasattr(exc, "to_openai_error"):
                from services.protocol.conversation import ImageGenerationError, public_image_error_message

                raise ImageGenerationError(public_image_error_message(str(exc))) from exc
            raise
        finally:
            if not failed:
                self.log("流式调用结束", urls=urls, account_email=account_emails[0] if account_emails else "",
                         conversation_id=conversation_ids[0] if conversation_ids else "")

    def log(self, suffix: str, result: object = None, status: str = "success", error: str = "",
            urls: list[str] | None = None, account_email: str = "", conversation_id: str = "") -> None:
        detail = {
            "key_id": self.identity.get("id"),
            "key_name": self.identity.get("name"),
            "role": self.identity.get("role"),
            "endpoint": self.endpoint,
            "model": self.model,
            "started_at": _local_time(self.started).strftime("%Y-%m-%d %H:%M:%S"),
            "ended_at": _now_str(),
            "duration_ms": int((time.time() - self.started) * 1000),
            "status": status,
        }
        request_excerpt = _request_excerpt(self.request_text)
        if request_excerpt:
            detail["request_text"] = request_excerpt
        if self.request_shape:
            detail["request_shape"] = self.request_shape
        if error:
            detail["error"] = error
        email = str(account_email or "").strip()
        if not email:
            emails = _collect_account_emails(result)
            email = emails[0] if emails else ""
        if email:
            detail["account_email"] = email
        conv_id = str(conversation_id or "").strip()
        if not conv_id:
            conv_ids = _collect_conversation_ids(result)
            conv_id = conv_ids[0] if conv_ids else ""
        if conv_id:
            detail["conversation_id"] = conv_id
        collected_urls = [*(urls or []), *_collect_urls(result)]
        if collected_urls and not self.endpoint.startswith("/v1/search"):
            detail["urls"] = list(dict.fromkeys(collected_urls))
        log_service.add(LOG_TYPE_CALL, f"{self.summary}{suffix}", detail)
