from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import uuid
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlsplit

from curl_cffi import requests

from services.config import DATA_DIR, config
from services.openai_backend_api import OpenAIBackendAPI
from services.proxy_service import proxy_settings


CHAT_ATTACHMENT_ROOT = DATA_DIR / "chat_attachments"
MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024
_ATTACHMENT_ID = re.compile(r"[0-9a-f]{32}")


class ChatAttachmentStore:
    def __init__(self, root: Path = CHAT_ATTACHMENT_ROOT) -> None:
        self.root = root

    def _owner_directory(self, owner_id: str) -> Path:
        return self.root / hashlib.sha256(owner_id.encode("utf-8")).hexdigest()

    @staticmethod
    def _cutoff() -> float:
        return time.time() - max(1, int(config.image_retention_days)) * 86400

    def _remove_expired(self, directory: Path) -> None:
        cutoff = self._cutoff()
        for item in directory.iterdir():
            if not _ATTACHMENT_ID.fullmatch(item.name) or not item.is_dir() or item.is_symlink():
                continue
            try:
                if item.stat().st_mtime < cutoff:
                    shutil.rmtree(item, ignore_errors=True)
            except FileNotFoundError:
                continue

    def save(self, owner_id: str, filename: str, chunks: Iterable[bytes]) -> str:
        directory = self._owner_directory(owner_id)
        directory.mkdir(parents=True, exist_ok=True)
        self._remove_expired(directory)
        attachment_id = uuid.uuid4().hex
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            staging = Path(temporary)
            size = 0
            with (staging / "content").open("wb") as target:
                for chunk in chunks:
                    size += len(chunk)
                    if size > MAX_ATTACHMENT_BYTES:
                        raise ValueError("chat attachment exceeds size limit")
                    target.write(chunk)
            (staging / "filename.json").write_text(json.dumps(filename, ensure_ascii=False), encoding="utf-8")
            os.replace(staging, directory / attachment_id)
        return attachment_id

    def locate(self, owner_id: str, attachment_id: str) -> tuple[Path, str] | None:
        if not owner_id or not _ATTACHMENT_ID.fullmatch(attachment_id):
            return None
        directory = self._owner_directory(owner_id) / attachment_id
        path = directory / "content"
        try:
            if directory.stat().st_mtime < self._cutoff() or not path.is_file():
                return None
            filename = json.loads((directory / "filename.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return (path, filename) if isinstance(filename, str) and filename else None


chat_attachment_store = ChatAttachmentStore()


def _download_host(url: str) -> str:
    try:
        parsed = urlsplit(url)
        host = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username is not None or parsed.password is not None or parsed.port not in (None, 443):
            return ""
        if host == "chatgpt.com" and parsed.path in {"/backend-api/estuary/content", "/backend-api/estuary/content/"}:
            return host
        if host == "oaiusercontent.com" or host.endswith(".oaiusercontent.com"):
            return host
    except ValueError:
        pass
    return ""


def save_downloaded_chat_attachment(
    backend: OpenAIBackendAPI,
    url: str,
    owner_id: str,
    filename: str,
    deadline: float,
) -> str:
    # Signed asset hosts must never receive the account's ChatGPT bearer headers.
    if url.startswith("/"):
        url = urljoin(backend.base_url, url)
    with requests.Session(**proxy_settings.build_session_kwargs(account=backend.account, verify=True)) as public_session:
        for _ in range(3):
            remaining = deadline - time.monotonic()
            host = _download_host(url)
            if not host or remaining <= 0:
                break
            session = backend.session if host == "chatgpt.com" else public_session
            response = session.get(url, stream=True, allow_redirects=False, timeout=remaining)
            try:
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("Location", "")
                    if not location:
                        break
                    url = urljoin(url, location)
                    continue
                if response.status_code != 200:
                    break
                content_length = response.headers.get("Content-Length", "")
                if content_length.isdecimal() and int(content_length) > MAX_ATTACHMENT_BYTES:
                    raise ValueError("chat attachment exceeds size limit")

                def chunks() -> Iterable[bytes]:
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if time.monotonic() >= deadline:
                            raise TimeoutError("chat attachment download expired")
                        yield chunk

                return chat_attachment_store.save(owner_id, filename, chunks())
            finally:
                response.close()
    return ""
