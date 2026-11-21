"""Account-scoped upload cooldowns, separate from image generation quota."""
from __future__ import annotations

import re
import threading
import time

_lock = threading.Lock()
_cooldowns: dict[str, float] = {}


def is_file_upload_limit(message: str) -> bool:
    text = str(message or "").lower()
    return (
        "/backend-api/files" in text
        and ("status=429" in text or "throttled" in text)
        and any(marker in text for marker in ("文件上传上限", "file upload limit", "upload limit"))
    )


def mark_upload_limited(token: str, message: str) -> None:
    if not token:
        return
    match = re.search(r"(\d+)\s*(?:小时|hours?)", str(message), re.IGNORECASE)
    hours = min(24, max(1, int(match.group(1)))) if match else 24
    with _lock:
        _cooldowns[token] = time.monotonic() + hours * 3600


def upload_limited_tokens() -> set[str]:
    now = time.monotonic()
    with _lock:
        expired = [token for token, deadline in _cooldowns.items() if deadline <= now]
        for token in expired:
            del _cooldowns[token]
        return set(_cooldowns)


UPLOAD_LIMIT_MESSAGE = "参考图上传额度已用尽，已尝试其他可用账号。请稍后重试或选择其他模型。"
