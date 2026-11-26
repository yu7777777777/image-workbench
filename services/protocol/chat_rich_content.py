from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import time
from collections.abc import Iterable, Iterator
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import parse_qsl, quote, unquote, urlsplit

from services.chat_attachments import save_downloaded_chat_attachment
from services.openai_backend_api import EditableFileArtifact, OpenAIBackendAPI
from services.protocol.conversation import assistant_message_text, is_visible_assistant_message


RichBlock = dict[str, Any]
_MARKUP = re.compile(r"<(?:Cite|AsyncImage(?:Group)?|Entity|Link)\b")
_REFERENCE = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
_OBJECT_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
_MARKUP_REF = re.compile(r"\bref\s*=\s*[\"']([A-Za-z0-9_.:-]{1,128})[\"']")
_MARKUP_IMAGE_QUERY = re.compile(r"<AsyncImage(?:Group)?\b[^<>]*?\squery\s*=\s*(\{\s*)?(?=[\[\"'])")
_SANDBOX_LINK = re.compile(r"(?:<sandbox:(/mnt/data/[^>\r\n]+)>|(?<=\]\()sandbox:(/mnt/data/[^)\s<>]+))")
_MAX_MESSAGES = 128
_MAX_ATTACHMENTS = 3
_BLOCK_LIMITS = {"attachment": _MAX_ATTACHMENTS, "python": 8, "product": 12, "image": 12, "source": 24, "tool": 1}
_PYTHON_TOOLS = {"python", "ipython", "python.exec"}
_SEARCH_TOOLS = {"web", "web.run", "browser", "browser.search"}


def _obj(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _items(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _text(value: object, limit: int = 240) -> str:
    return value[:limit].strip() if isinstance(value, str) else ""


def _public_url(value: object) -> str:
    url = _text(value, 4097)
    if len(url) > 4096 or re.search(r"[\x00-\x20\x7f\\]", url):
        return ""
    try:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").rstrip(".")
        if parsed.scheme not in {"https", "http"} or not host or parsed.username is not None or parsed.password is not None:
            return ""
        if parsed.port not in (None, 80, 443):
            return ""
        if any(key.casefold() in {"access_token", "authorization", "api_key", "apikey", "client_secret"}
               for key, _ in parse_qsl(parsed.query, max_num_fields=100)):
            return ""
        try:
            if not ipaddress.ip_address(host).is_global:
                return ""
        except ValueError:
            if "." not in host or host.rsplit(".", 1)[-1].isdigit() or host.endswith((".local", ".localhost", ".internal", ".lan")):
                return ""
        return url
    except ValueError:
        return ""


def _ref(value: object) -> str:
    if isinstance(value, str) and _REFERENCE.fullmatch(value):
        return value
    data = _obj(value)
    turn, kind, index = data.get("turn_index"), data.get("ref_type"), data.get("ref_index")
    if type(turn) is int and 0 <= turn <= 100000000 and type(index) is int and 0 <= index <= 100000000:
        if isinstance(kind, str) and re.fullmatch(r"[a-z_]{1,32}", kind):
            return f"turn{turn}{kind}{index}"
    return ""


def _block(kind: str, key: str, **fields: str) -> RichBlock:
    digest = hashlib.sha256(key.encode("utf-8", errors="replace")).hexdigest()[:24]
    return {"id": f"{kind}-{digest}", "type": kind, **{k: v for k, v in fields.items() if v}}


def _objects(value: object) -> Iterator[dict[str, Any]]:
    stack = [value]
    for _ in range(512):
        if not stack:
            break
        child = stack.pop()
        if isinstance(child, dict):
            yield child
            stack.extend(list(child.values())[:128][::-1])
        elif isinstance(child, list):
            stack.extend(child[:128][::-1])


def source_block(value: object) -> RichBlock | None:
    item = _obj(value)
    url = _public_url(item.get("url") or item.get("uri"))
    if not url:
        return None
    ref = _ref(item.get("ref_id")) or _ref(item.get("ref"))
    return _block("source", f"{ref}:{url}", url=url, ref=ref, title=_text(item.get("title") or item.get("name")),
                  description=_text(item.get("snippet") or item.get("description"), 500))


def _image_url(item: dict[str, Any]) -> str:
    image = item.get("image") or item.get("thumbnail")
    nested = _obj(image)
    options = (item.get("thumbnail_url"), item.get("image_url"), nested.get("url"), nested.get("uri"), image,
               *_items(item.get("image_urls"))[:8])
    return next((url for value in options if (url := _public_url(value))), "")


def _image_block(item: dict[str, Any], ref: str = "", queries: list[str] | None = None) -> RichBlock | None:
    image_url = _image_url(item)
    if not image_url:
        return None
    ref = ref if queries and ref else _ref(item.get("ref_id")) or _ref(item.get("ref")) or ref
    block = _block("image", f"{ref}:{image_url}", ref=ref, imageUrl=image_url, url=_public_url(item.get("url")),
                   title=_text(item.get("title") or item.get("alt")))
    if queries:
        block["queries"] = queries
    return block


def _price(value: object) -> str:
    if isinstance(value, str):
        return _text(value, 64)
    if type(value) in (int, float):
        return str(value)
    data = _obj(value)
    displayed = _text(data.get("displayed_price") or data.get("formatted") or data.get("text"), 64)
    amount = data.get("amount")
    if not displayed and type(amount) in (int, float):
        return f"{amount} {_text(data.get('currency'), 8)}".strip()
    return displayed


def _product_block(item: dict[str, Any], ref: str) -> RichBlock | None:
    title = _text(item.get("title"))
    if not title or not ({"price", "displayed_price", "offers"} & item.keys()):
        return None
    page = item.get("product_page")
    url = _public_url(item.get("url") or _obj(page).get("uri") or _obj(page).get("url") or page)
    if not url:
        return None
    offers = _items(item.get("offers"))
    offer = _obj(offers[0]) if offers else {}
    merchant = item.get("merchant") or offer.get("merchant")
    price = next((display for owner in (item, offer) for key in ("displayed_price", "price") if (display := _price(owner.get(key)))), "")
    return _block("product", f"{ref}:{url}", ref=ref, title=title, url=url, imageUrl=_image_url(item), price=price,
                  merchant=_text(merchant or offer.get("merchant_name")) or _text(_obj(merchant).get("name")))


def _image_queries(value: object) -> list[str]:
    queries = [value] if isinstance(value, str) else _items(value)
    if 0 < len(queries) <= 8 and all(isinstance(query, str) and 0 < len(query) <= 400 and query.strip()
                                       and not re.search(r"[\x00-\x1f\x7f]", query) for query in queries):
        return [query.strip() for query in queries]
    return []


def _markup_image_queries(markup: str) -> list[str]:
    match = _MARKUP_IMAGE_QUERY.search(markup)
    if not match:
        return []
    rest = markup[match.end():]
    if rest.startswith("'"):
        literal = re.match(r"'([^'\r\n]{1,400})'", rest)
        value, end = (literal.group(1), literal.end()) if literal else (None, 0)
    else:
        try:
            value, end = json.JSONDecoder().raw_decode(rest)
        except (ValueError, RecursionError):
            return []
    if match[1] and not rest[end:].lstrip().startswith("}"):
        return []
    return _image_queries(value)


def _component_bindings(metadata: dict[str, Any], text: str) -> dict[str, tuple[str, list[str]]]:
    bindings: dict[str, tuple[str, list[str]]] = {}
    for item in _items(metadata.get("content_references"))[:128]:
        item = _obj(item)
        component = _ref(item.get("component_resolution_id"))
        if not component:
            continue
        attrs = _obj(item.get("genui_attributes"))
        alias = _ref(attrs.get("ref"))
        image = item.get("type") in ("async_image", "async_image_group")
        queries = _image_queries(attrs.get("query") or attrs.get("queries")) if image else []
        start, end = item.get("start_index"), item.get("end_index")
        if type(start) is int and type(end) is int and 0 <= start < end <= len(text) and end - start <= 8192:
            markup = text[start:end]
            if not alias and (match := _MARKUP_REF.search(markup)):
                alias = match.group(1)
            if not queries:
                queries = _markup_image_queries(markup)
        if alias or queries:
            previous_alias, previous_queries = bindings.get(component, ("", []))
            bindings[component] = alias or previous_alias, queries or previous_queries
    return bindings


def _resource_blocks(message: dict[str, Any], visible_assistant: bool) -> Iterator[RichBlock]:
    metadata = _obj(message.get("metadata"))
    for name in ("search_result_groups", "citations", "content_references", "inline_cot_expandable_content"):
        for item in _objects(metadata.get(name)):
            item_type = item.get("type")
            if name == "inline_cot_expandable_content" and item_type != "search_result":
                continue
            if item_type in ("search_result", "webpage", "url_citation", "web_result", "web") or name == "citations" or "ref_id" in item:
                source = source_block(item)
                if source:
                    yield source
                image = _image_block(item)
                if image:
                    yield image
    if not visible_assistant:
        return
    app_data = _obj(_obj(metadata.get("model_dil_v2")).get("appData"))
    components = _obj(_obj(app_data.get("opGenui")).get("componentResults"))
    bindings = _component_bindings(metadata, assistant_message_text(message))
    for component, result in list(components.items())[:64]:
        alias, queries = bindings.get(component, ("", []))
        ref = alias or _ref(component)
        state = _obj(_obj(result).get("state"))
        queries = queries or _image_queries(state.get("query") or state.get("queries"))
        products = [product for item in _objects(state) if (product := _product_block(item, ref))]
        if products:
            # A component's action can repeat the very same product in multiple places.
            yield from {block["id"]: block for block in reversed(products)}.values()
            continue
        for item in _objects(state):
            image = _image_block(item, ref, queries)
            if image:
                yield image
            if queries:
                for value in _items(item.get("image_urls"))[:8]:
                    image = _image_block({**item, "image_url": value, "thumbnail_url": None}, ref, queries)
                    if image:
                        yield image


def _python_block(message: dict[str, Any]) -> RichBlock | None:
    content = _obj(message.get("content"))
    if content.get("content_type") != "execution_output":
        return None
    metadata = _obj(message.get("metadata"))
    stdout = _text(content.get("stdout") or content.get("text"), 12000)
    if not stdout:
        stdout = _text("\n".join(part for part in _items(content.get("parts"))[:32] if isinstance(part, str)), 12000)
    stderr = _text(content.get("stderr") or content.get("error"), 4000)
    failed = bool(stderr or metadata.get("is_error") is True or content.get("status") == "error" or
                  re.search(r"(?:^|\n)(?:Traceback \(|[A-Za-z]+(?:Error|Exception):)", stdout))
    status = "error" if failed else "success"
    return _block("python", str(message["id"]), title="Python 执行结果", text="\n".join(dict.fromkeys(filter(None, [stdout, stderr]))), status=status)


def _sandbox_paths(text: str) -> Iterator[str]:
    for match in _SANDBOX_LINK.finditer(text):
        path = unquote(match.group(1) or match.group(2))
        if not path.startswith("/mnt/data/") or len(path) > 1024 or re.search(r"[\x00-\x1f\x7f\\]", path):
            continue
        if any(part in {"", ".", ".."} for part in path[len("/mnt/data/"):].split("/")):
            continue
        yield path


def _message_kind(message: dict[str, Any]) -> str:
    metadata = _obj(message.get("metadata"))
    if metadata.get("is_visually_hidden_from_conversation") is True:
        return ""
    if is_visible_assistant_message(message):
        content_type = _obj(message.get("content")).get("content_type")
        return "assistant" if content_type in ("text", "multimodal_text") else ""
    author = _obj(message.get("author"))
    if author.get("role") == "tool":
        name = author.get("name")
        if isinstance(name, str) and name in _PYTHON_TOOLS:
            return "python"
        if isinstance(name, str) and name in _SEARCH_TOOLS:
            return "search"
    return ""


class ChatRichContent:
    """Collect the public resources of an explicitly requested text reply."""

    def __init__(self, owner_id: str) -> None:
        self.owner_id = owner_id
        self.blocks: list[RichBlock] = []
        self._backend: OpenAIBackendAPI | None = None
        self._conversation_id = ""
        self._text = ""
        self._blocked = False
        self._messages: dict[str, dict[str, Any]] = {}

    def observe(self, backend: OpenAIBackendAPI, event: dict[str, Any]) -> None:
        if self._backend is not backend:
            self._backend = backend
            self._conversation_id = ""
            self._text = ""
            self._blocked = False
            self._messages.clear()
        self._blocked |= event.get("blocked") is True
        text = event.get("text")
        if isinstance(text, str):
            self._text = text
        conversation_id = event.get("conversation_id")
        if isinstance(conversation_id, str) and _OBJECT_ID.fullmatch(conversation_id):
            self._conversation_id = conversation_id
        raw = _obj(event.get("raw"))
        for obj in (raw, _obj(raw.get("v"))):
            message = _obj(obj.get("message"))
            message_id = message.get("id")
            if not isinstance(message_id, str) or not _OBJECT_ID.fullmatch(message_id):
                continue
            if not _message_kind(message):
                self._messages.pop(message_id, None)
            elif len(self._messages) < _MAX_MESSAGES or message_id in self._messages:
                self._messages[message_id] = message

    def _supplement_detail(self, backend: OpenAIBackendAPI, timeout: float) -> None:
        try:
            detail = backend._get_editable_conversation_detail(self._conversation_id, timeout=timeout, allow_redirects=False)
        except Exception:
            return  # Text rendering survives details unavailable on an upstream account.
        # Streams can carry output patches after the initial message. Accept snapshots
        # only for messages already observed in this request, or the same turn exchange.
        turn_ids = {
            turn for message in self._messages.values()
            if (turn := _ref(_obj(message.get("metadata")).get("turn_exchange_id")))
        }
        for node in list(_obj(_obj(detail).get("mapping")).values())[-_MAX_MESSAGES * 2:]:
            message = _obj(_obj(node).get("message"))
            message_id = message.get("id")
            if not isinstance(message_id, str) or not _OBJECT_ID.fullmatch(message_id):
                continue
            if not _message_kind(message):
                self._messages.pop(message_id, None)
                continue
            if message_id in self._messages or _ref(_obj(message.get("metadata")).get("turn_exchange_id")) in turn_ids:
                self._messages[message_id] = message

    def _attachments(self, backend: OpenAIBackendAPI, paths: list[str], deadline: float) -> Iterator[RichBlock]:
        messages = [message for message in self._messages.values() if _message_kind(message) in {"assistant", "python"}]
        visible_paths = {
            path for message in messages if _message_kind(message) == "assistant"
            for path in _sandbox_paths(assistant_message_text(message))
        }
        for path in paths:
            filename = PurePosixPath(path).name
            if path not in visible_paths or len(filename) > 240 or len(filename.encode("utf-8", errors="replace")) > 255:
                continue
            candidates = sorted(
                messages,
                key=lambda m: (path in assistant_message_text(m) or quote(path) in assistant_message_text(m), _message_kind(m) == "assistant"),
                reverse=True,
            )
            for message in candidates[:6]:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return
                artifact = EditableFileArtifact(name=filename, message_id=message["id"], sandbox_path=path)
                try:
                    url = backend._resolve_editable_download_url(self._conversation_id, artifact, timeout=remaining,
                                                                allow_redirects=False)
                    attachment_id = save_downloaded_chat_attachment(backend, url, self.owner_id, filename, deadline) if url else ""
                except Exception:
                    continue
                if attachment_id:
                    yield {"id": attachment_id, "type": "attachment", "path": f"sandbox:{quote(path)}", "title": filename}
                    break

    def finish(self, backend: OpenAIBackendAPI) -> None:
        if self._blocked or self._backend is not backend:
            return
        paths = list(dict.fromkeys(_sandbox_paths(self._text)))[:_MAX_ATTACHMENTS]
        has_tool_or_refs = any(
            _message_kind(message) in {"python", "search"} or any(
                _obj(message.get("metadata")).get(key) for key in ("content_references", "search_result_groups", "model_dil_v2")
            ) for message in self._messages.values()
        )
        if self._conversation_id and (paths or has_tool_or_refs or _MARKUP.search(self._text)):
            self._supplement_detail(backend, timeout=3.0)
        blocks: dict[str, dict[str, RichBlock]] = {kind: {} for kind in _BLOCK_LIMITS}

        def keep(block: RichBlock) -> None:
            kind, block_id = block["type"], block["id"]
            group = blocks[kind]
            if len(group) >= _BLOCK_LIMITS[kind] and block_id not in group:
                if kind != "image" or not block.get("queries"):
                    return
                replace = next((key for key in reversed(group) if not group[key].get("queries")), None)
                if replace is None:
                    return
                del group[replace]
            group[block_id] = block

        if paths and self._conversation_id:
            for block in self._attachments(backend, paths, time.monotonic() + 12.0):
                keep(block)
        search_status = ""
        for message in self._messages.values():
            kind = _message_kind(message)
            if kind == "python":
                block = _python_block(message)
                if block:
                    keep(block)
            if kind == "search":
                search_status = "error" if _obj(message.get("metadata")).get("is_error") is True else "success"
            if kind in {"assistant", "search"}:
                for block in _resource_blocks(message, kind == "assistant"):
                    keep(block)
        if search_status:
            description = "已接收当前回复的公开网页搜索结果" if search_status == "success" else "上游网页搜索返回错误"
            keep(_block("tool", "web.run", title="网页搜索", status=search_status, description=description))
        self.blocks = [block for group in blocks.values() for block in group.values()]
