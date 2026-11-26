from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import time
from collections.abc import Iterable, Iterator
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

from services.chat_attachments import save_downloaded_chat_attachment
from services.openai_backend_api import EditableFileArtifact, OpenAIBackendAPI
from services.protocol.conversation import assistant_message_text, is_visible_assistant_message


RichBlock = dict[str, Any]
_MARKUP = re.compile(r"<(?:Cite|AsyncImage(?:Group)?|Entity|Link)\b")
_REFERENCE = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
_OBJECT_ID = re.compile(r"[A-Za-z0-9_-]{1,128}")
_MARKUP_REF = re.compile(r"\bref\s*=\s*[\"']([A-Za-z0-9_.:-]{1,128})[\"']")
_MARKUP_IMAGE_QUERY = re.compile(r"<AsyncImage(?:Group)?\b[^<>]*?\s(?:query|queries)\s*=\s*(\{\s*)?(?=[\[\"'])")
_CITE_REF_TOKEN = re.compile(r"(?<![A-Za-z0-9_])(turn\d+[a-z_]{1,32}\d+)(?![A-Za-z0-9_])", re.IGNORECASE)
_TEXT_CITE_TAG = re.compile(r"<Cite\s+refs=\{\s*\[([^\]]{1,2048})\]\s*\}\s*/\s*>")
_TEXT_LINK_TAG = re.compile(r"<Link\b[^<>]*?\bref\s*=\s*[\"']([A-Za-z0-9_.:-]{1,128})[\"']")
_SANDBOX_LINK = re.compile(r"(?:<sandbox:(/mnt/data/[^>\r\n]+)>|(?<=\]\()sandbox:(/mnt/data/[^)\s<>]+))")
_MAX_MESSAGES = 128
_MAX_ATTACHMENTS = 3
_BLOCK_LIMITS = {"attachment": _MAX_ATTACHMENTS, "python": 8, "product": 12, "image": 12, "source": 24, "tool": 1}
_PYTHON_TOOLS = {"python", "ipython", "python.exec"}
_SEARCH_TOOLS = {"web", "web.run", "web.search", "web_search", "browser", "browser.search", "search", "image_search"}
_IMAGE_REF_TYPES = {"async_image", "async_image_group", "image_v2", "images", "image", "image_results", "image_result", "image_group"}
_SOURCE_REF_TYPES = {
    "search_result", "webpage", "webpage_extended", "grouped_webpages",
    "url_citation", "web_result", "web", "sources_footnote", "nav_list", "attribution",
}


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


def _clean_source_url(url: str) -> str:
    if not url or "utm_source=" not in url:
        return url
    try:
        parsed = urlsplit(url)
        pairs = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=100)
        filtered = [(k, v) for k, v in pairs if not (k.casefold() == "utm_source" and v.casefold() == "chatgpt.com")]
        if len(filtered) == len(pairs):
            return url
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(filtered), parsed.fragment))
    except ValueError:
        return url


def _ref(value: object) -> str:
    if isinstance(value, str) and _REFERENCE.fullmatch(value):
        return value
    data = _obj(value)
    turn, kind, index = data.get("turn_index"), data.get("ref_type"), data.get("ref_index")
    if type(turn) is int and 0 <= turn <= 100000000 and type(index) is int and 0 <= index <= 100000000:
        if isinstance(kind, str) and re.fullmatch(r"[a-zA-Z_]{1,32}", kind):
            return f"turn{turn}{kind.lower()}{index}"
    return ""


def _refs_from_text(value: object) -> list[str]:
    if not isinstance(value, str) or "turn" not in value.lower():
        return []
    found: list[str] = []
    for token in _CITE_REF_TOKEN.findall(value[:8192]):
        if token not in found:
            found.append(token)
            if len(found) >= 16:
                break
    return found


def _extract_source_refs(item: dict[str, Any], fallback_refs: list[str] | None = None) -> list[str]:
    refs: list[str] = []

    def add(candidate: str) -> None:
        if candidate and candidate not in refs and len(refs) < 16:
            refs.append(candidate)

    for key in ("ref_id", "ref", "citation_id"):
        add(_ref(item.get(key)))
    add(_ref(item))
    for key in ("refs", "ref_ids"):
        for entry in _items(item.get(key))[:16]:
            add(_ref(entry))
    item_id = item.get("id")
    if isinstance(item_id, str) and _CITE_REF_TOKEN.fullmatch(item_id):
        add(item_id)
    for token in _refs_from_text(item.get("matched_text")):
        add(token)
    if not refs and fallback_refs:
        for candidate in fallback_refs:
            add(_ref(candidate))
    return refs


def _cited_refs_in_text(text: str) -> set[str]:
    refs: set[str] = set()
    for match in _TEXT_CITE_TAG.finditer(text):
        for ref_match in re.finditer(r'"([A-Za-z0-9_.:-]{1,128})"', match.group(1)):
            refs.add(ref_match.group(1))
    for match in _TEXT_LINK_TAG.finditer(text):
        refs.add(match.group(1))
    return refs


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


def source_blocks(value: object, fallback_refs: list[str] | None = None) -> list[RichBlock]:
    item = _obj(value)
    nested_meta = _obj(item.get("metadata"))
    raw_url = _public_url(item.get("url") or item.get("uri") or nested_meta.get("url") or nested_meta.get("uri"))
    if not raw_url:
        return []
    url = _clean_source_url(raw_url)
    title = _text(
        item.get("title") or item.get("name") or item.get("attribution")
        or nested_meta.get("title") or nested_meta.get("name")
    )
    description = _text(
        item.get("snippet") or item.get("description")
        or nested_meta.get("snippet") or nested_meta.get("text"),
        500,
    )
    refs = _extract_source_refs(item, fallback_refs)
    if not refs:
        return [_block("source", f":{url}", url=url, ref="", title=title, description=description)]
    return [_block("source", f"{ref}:{url}", url=url, ref=ref, title=title, description=description) for ref in refs]


def source_block(value: object) -> RichBlock | None:
    blocks = source_blocks(value)
    return blocks[0] if blocks else None


def _extract_item_queries(item: dict[str, Any]) -> list[str]:
    for key in ("query", "queries", "search_query", "image_query", "prompt"):
        queries = _image_queries(item.get(key))
        if queries:
            return queries
    return []


def _image_url(item: dict[str, Any], *, allow_src: bool = False) -> str:
    image = item.get("image") or item.get("thumbnail")
    nested = _obj(image)
    image_urls = [
        _obj(entry).get("url") or _obj(entry).get("uri") or _obj(entry).get("image_url")
        or _obj(entry).get("thumbnail_url") or _obj(entry).get("content_url") or entry
        for entry in _items(item.get("image_urls"))[:8]
    ]
    options: tuple[object, ...] = (
        item.get("thumbnail_url"),
        item.get("image_url"),
        item.get("content_url"),
        item.get("src") if allow_src else None,
        nested.get("url"),
        nested.get("uri"),
        nested.get("thumbnail_url"),
        nested.get("image_url"),
        nested.get("content_url"),
        nested.get("src") if allow_src else None,
        image,
        *image_urls,
    )
    return next((url for value in options if (url := _public_url(value))), "")


def _image_block(
    item: dict[str, Any],
    ref: str = "",
    queries: list[str] | None = None,
    *,
    fallback_title: str = "",
    allow_src: bool = False,
) -> RichBlock | None:
    image_url = _image_url(item, allow_src=allow_src)
    if not image_url:
        return None
    resolved_queries = queries or _extract_item_queries(item)
    resolved_ref = ref if queries and ref else _ref(item.get("ref_id")) or _ref(item.get("ref")) or ref
    page_url = _public_url(item.get("url") or item.get("source_url") or item.get("page_url") or item.get("host_page_url"))
    title = _text(item.get("title") or item.get("alt") or item.get("caption") or item.get("prompt") or fallback_title)
    block = _block("image", f"{resolved_ref}:{image_url}", ref=resolved_ref, imageUrl=image_url, url=page_url, title=title)
    if resolved_queries:
        block["queries"] = resolved_queries
    return block


def _yield_image_blocks(
    item: dict[str, Any],
    ref: str,
    queries: list[str],
    *,
    fallback_title: str = "",
    allow_src: bool = True,
) -> Iterator[RichBlock]:
    nested_queries = _extract_item_queries(item) or queries
    image = _image_block(item, ref, nested_queries, fallback_title=fallback_title, allow_src=allow_src)
    if image:
        yield image
    for value in _items(item.get("image_urls"))[:8]:
        entry = _obj(value)
        url_candidate = (
            entry.get("image_url") or entry.get("thumbnail_url") or entry.get("content_url") or entry.get("url")
            if entry else value
        )
        merged = {**item, **entry, "image_url": url_candidate, "thumbnail_url": None, "content_url": None}
        extra = _image_block(merged, ref, nested_queries, fallback_title=fallback_title, allow_src=allow_src)
        if extra:
            yield extra


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
            if rest.startswith("["):
                bracket = re.match(r"\[(\s*'[^'\r\n]{1,400}'(?:\s*,\s*'[^'\r\n]{1,400}')*\s*)\]", rest)
                if bracket:
                    value = re.findall(r"'([^'\r\n]{1,400})'", bracket.group(1))
                    end = bracket.end()
                else:
                    return []
            else:
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
        attrs = _obj(item.get("genui_attributes") or item.get("attributes") or item.get("props"))
        alias = _ref(attrs.get("ref")) or _ref(item.get("ref"))
        image = item.get("type") in _IMAGE_REF_TYPES
        queries = (_extract_item_queries(attrs) or _extract_item_queries(item)) if image else []
        markups: list[str] = []
        start, end = item.get("start_index"), item.get("end_index")
        if type(start) is int and type(end) is int and 0 <= start < end <= len(text) and end - start <= 8192:
            markups.append(text[start:end])
        matched = item.get("matched_text")
        if isinstance(matched, str) and matched and len(matched) <= 8192:
            markups.append(matched)
        for markup in markups:
            if not alias and (match := _MARKUP_REF.search(markup)):
                alias = match.group(1)
            if not queries:
                queries = _markup_image_queries(markup)
        if alias or queries:
            previous_alias, previous_queries = bindings.get(component, ("", []))
            bindings[component] = alias or previous_alias, queries or previous_queries
    return bindings


def _content_reference_blocks(item: dict[str, Any], bindings: dict[str, tuple[str, list[str]]]) -> Iterator[RichBlock]:
    item_type = item.get("type")
    if item_type in _IMAGE_REF_TYPES or any(isinstance(item.get(key), list) for key in ("images", "image_results")):
        attrs = _obj(item.get("genui_attributes") or item.get("attributes") or item.get("props"))
        component_id = _ref(item.get("component_resolution_id"))
        alias, bound_queries = bindings.get(component_id, ("", []))
        ref = alias or _ref(attrs.get("ref")) or _ref(item.get("ref_id")) or _ref(item.get("ref")) or component_id
        matched_queries = _markup_image_queries(_text(item.get("matched_text"), 8192))
        queries = _extract_item_queries(attrs) or _extract_item_queries(item) or bound_queries or matched_queries
        fallback_title = _text(attrs.get("alt") or attrs.get("title") or item.get("title") or item.get("alt") or item.get("caption"))
        for nested in _objects(item):
            yield from _yield_image_blocks(nested, ref, queries, fallback_title=fallback_title, allow_src=True)

    parent_refs = _extract_source_refs(item)
    is_source_container = (
        item_type in _SOURCE_REF_TYPES
        or bool(parent_refs)
        or any(key in item for key in ("items", "supporting_websites", "fallback_items", "sources", "entries", "results", "safe_urls"))
    )
    if not is_source_container:
        return
    emitted_child_source = False
    for block in source_blocks(item):
        emitted_child_source = True
        yield block
    if item_type not in _IMAGE_REF_TYPES:
        image = _image_block(item)
        if image:
            yield image
    for list_key in ("items", "supporting_websites", "fallback_items", "sources", "entries", "results"):
        children = _items(item.get(list_key))[:32]
        if not children:
            continue
        for idx, raw_child in enumerate(children):
            child = _obj(raw_child)
            if not child:
                continue
            child_refs = _extract_source_refs(child)
            fallback: list[str] | None = None
            if not child_refs and parent_refs:
                if list_key == "items" and len(children) == 1:
                    fallback = parent_refs
                elif list_key == "items" and len(parent_refs) == len(children):
                    fallback = [parent_refs[idx]]
                elif len(parent_refs) == 1:
                    fallback = parent_refs
            for block in source_blocks(child, fallback_refs=fallback):
                emitted_child_source = True
                yield block
            child_img = _image_block(child)
            if child_img:
                yield child_img
            for raw_sub in _items(child.get("supporting_websites"))[:16]:
                sub = _obj(raw_sub)
                if not sub:
                    continue
                for block in source_blocks(sub):
                    emitted_child_source = True
                    yield block
                sub_img = _image_block(sub)
                if sub_img:
                    yield sub_img
    if not emitted_child_source and parent_refs:
        safe_urls = [value for value in _items(item.get("safe_urls"))[:16] if isinstance(value, str)]
        for idx, raw_url in enumerate(safe_urls):
            fb = parent_refs if len(safe_urls) == 1 else (
                [parent_refs[idx]] if len(parent_refs) == len(safe_urls) else []
            )
            yield from source_blocks({"url": raw_url, "title": item.get("title") or item.get("alt") or ""}, fallback_refs=fb)


def _resource_blocks(message: dict[str, Any], visible_assistant: bool) -> Iterator[RichBlock]:
    metadata = _obj(message.get("metadata"))
    bindings = _component_bindings(metadata, assistant_message_text(message)) if visible_assistant else {}
    for ref_entry in _items(metadata.get("content_references"))[:128]:
        entry_obj = _obj(ref_entry)
        if entry_obj:
            yield from _content_reference_blocks(entry_obj, bindings)
    for name in ("search_result_groups", "citations", "content_references", "inline_cot_expandable_content"):
        for item in _objects(metadata.get(name)):
            item_type = item.get("type")
            if name == "inline_cot_expandable_content" and item_type != "search_result":
                continue
            if item_type in _SOURCE_REF_TYPES or name == "citations" or "ref_id" in item or "refs" in item:
                yield from source_blocks(item)
                image = _image_block(item)
                if image:
                    yield image
    if not visible_assistant:
        return
    for part in _items(_obj(message.get("content")).get("parts"))[:32]:
        part_obj = _obj(part)
        if not part_obj:
            continue
        part_queries = _extract_item_queries(part_obj)
        yield from _yield_image_blocks(part_obj, _ref(part_obj.get("ref")), part_queries, allow_src=False)
    app_data = _obj(_obj(metadata.get("model_dil_v2")).get("appData"))
    components = _obj(_obj(app_data.get("opGenui")).get("componentResults"))
    if not components:
        components = _obj(_obj(metadata.get("opGenui")).get("componentResults"))
    for component, result in list(components.items())[:64]:
        alias, queries = bindings.get(component, ("", []))
        ref = alias or _ref(component)
        result_obj = _obj(result)
        state = _obj(result_obj.get("state") or result_obj.get("data") or result_obj.get("props") or result_obj)
        queries = queries or _extract_item_queries(state) or _extract_item_queries(result_obj)
        fallback_title = _text(state.get("alt") or state.get("title") or result_obj.get("alt") or result_obj.get("title"))
        products = [product for item in _objects(state) if (product := _product_block(item, ref))]
        if products:
            # A component's action can repeat the very same product in multiple places.
            yield from {block["id"]: block for block in reversed(products)}.values()
            continue
        for item in _objects(state):
            yield from _yield_image_blocks(item, ref, queries, fallback_title=fallback_title, allow_src=True)


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


_PATCH_LIST_KEYS = {
    "/message/metadata/content_references": "content_references",
    "/message/metadata/search_result_groups": "search_result_groups",
    "/message/metadata/citations": "citations",
}
_PATCH_DICT_KEYS = {
    "/message/metadata/model_dil_v2": "model_dil_v2",
    "/message/metadata/opGenui": "opGenui",
}


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
        self._last_message_id = ""

    def _apply_metadata_patch(self, op: dict[str, Any]) -> None:
        if not self._last_message_id or self._last_message_id not in self._messages:
            return
        path = op.get("p")
        action = op.get("o")
        value = op.get("v")
        if not isinstance(path, str):
            return
        message = self._messages[self._last_message_id]
        if path in _PATCH_LIST_KEYS:
            key = _PATCH_LIST_KEYS[path]
            metadata = dict(_obj(message.get("metadata")))
            current = list(_items(metadata.get(key)))
            if action == "append":
                if isinstance(value, list):
                    current.extend(value[:256])
                elif isinstance(value, dict):
                    current.append(value)
                else:
                    return
            elif action in ("replace", "add") and isinstance(value, list):
                current = list(value[:256])
            else:
                return
            metadata[key] = current[:256]
            self._messages[self._last_message_id] = {**message, "metadata": metadata}
        elif path in _PATCH_DICT_KEYS and isinstance(value, dict):
            key = _PATCH_DICT_KEYS[path]
            metadata = dict(_obj(message.get("metadata")))
            metadata[key] = value
            self._messages[self._last_message_id] = {**message, "metadata": metadata}
        elif path == "/message/metadata" and isinstance(value, dict):
            metadata = dict(_obj(message.get("metadata")))
            changed = False
            for key in ("content_references", "search_result_groups", "citations"):
                if isinstance(value.get(key), list):
                    current = list(_items(metadata.get(key))) if action == "append" else []
                    current.extend(value[key][:256])
                    metadata[key] = current[:256]
                    changed = True
            for key in ("model_dil_v2", "opGenui"):
                if isinstance(value.get(key), dict):
                    metadata[key] = value[key]
                    changed = True
            if changed:
                self._messages[self._last_message_id] = {**message, "metadata": metadata}

    def observe(self, backend: OpenAIBackendAPI, event: dict[str, Any]) -> None:
        if self._backend is not backend:
            self._backend = backend
            self._conversation_id = ""
            self._text = ""
            self._blocked = False
            self._messages.clear()
            self._last_message_id = ""
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
                if self._last_message_id == message_id:
                    self._last_message_id = ""
            elif len(self._messages) < _MAX_MESSAGES or message_id in self._messages:
                self._messages[message_id] = message
                self._last_message_id = message_id
        if isinstance(raw.get("p"), str):
            self._apply_metadata_patch(raw)
        elif isinstance(raw.get("v"), list):
            for patch_op in raw["v"][:64]:
                if isinstance(patch_op, dict) and isinstance(patch_op.get("p"), str):
                    self._apply_metadata_patch(patch_op)

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
                _obj(message.get("metadata")).get(key) for key in ("content_references", "search_result_groups", "model_dil_v2", "opGenui")
            ) for message in self._messages.values()
        )
        if self._conversation_id and (paths or has_tool_or_refs or _MARKUP.search(self._text)):
            self._supplement_detail(backend, timeout=3.0)
        cited_refs = _cited_refs_in_text(self._text)
        for message in self._messages.values():
            if _message_kind(message) == "assistant":
                cited_refs.update(_cited_refs_in_text(assistant_message_text(message)))
        cited_refs_lower = {ref.lower() for ref in cited_refs}
        blocks: dict[str, dict[str, RichBlock]] = {kind: {} for kind in _BLOCK_LIMITS}
        source_by_ref: dict[str, str] = {}
        source_by_url: dict[str, str] = {}
        image_by_url: dict[str, str] = {}

        def _merge_fields(primary: RichBlock, secondary: RichBlock, keys: tuple[str, ...]) -> RichBlock:
            merged = dict(primary)
            for field in keys:
                if not merged.get(field) and secondary.get(field):
                    merged[field] = secondary[field]
            return merged

        def _source_priority(block: RichBlock) -> int:
            ref = str(block.get("ref") or "")
            if not ref:
                return 0
            if ref in cited_refs or ref.lower() in cited_refs_lower:
                return 2
            return 1

        def _drop_source(victim_id: str) -> None:
            victim = blocks["source"].pop(victim_id, None)
            if not victim:
                return
            v_ref = str(victim.get("ref") or "")
            v_url = str(victim.get("url") or "")
            if v_ref and source_by_ref.get(v_ref) == victim_id:
                source_by_ref.pop(v_ref, None)
            if v_url and source_by_url.get(v_url) == victim_id:
                source_by_url.pop(v_url, None)

        def keep(block: RichBlock, *, prefer_authoritative: bool = False) -> None:
            kind, block_id = block["type"], block["id"]
            group = blocks[kind]
            if kind == "source":
                ref = str(block.get("ref") or "")
                url = str(block.get("url") or "")
                if block_id in group:
                    group[block_id] = _merge_fields(group[block_id], block, ("title", "description"))
                    return
                if ref and ref in source_by_ref:
                    existing_id = source_by_ref[ref]
                    existing = group.get(existing_id)
                    if existing:
                        if prefer_authoritative:
                            _drop_source(existing_id)
                            merged = _merge_fields(block, existing, ("title", "description"))
                            group[block_id] = merged
                            source_by_ref[ref] = block_id
                            if url:
                                source_by_url.setdefault(url, block_id)
                        else:
                            group[existing_id] = _merge_fields(existing, block, ("title", "description"))
                        return
                if url and url in source_by_url:
                    existing_id = source_by_url[url]
                    existing = group.get(existing_id)
                    if existing:
                        if not ref:
                            group[existing_id] = _merge_fields(existing, block, ("title", "description"))
                            return
                        if not existing.get("ref"):
                            _drop_source(existing_id)
                            merged = _merge_fields(block, existing, ("title", "description"))
                            group[block_id] = merged
                            source_by_ref[ref] = block_id
                            source_by_url[url] = block_id
                            return
                if len(group) >= _BLOCK_LIMITS["source"]:
                    incoming_prio = _source_priority(block)
                    victim_id: str | None = None
                    victim_prio = incoming_prio
                    for key in reversed(list(group.keys())):
                        key_prio = _source_priority(group[key])
                        if key_prio < victim_prio:
                            victim_id = key
                            victim_prio = key_prio
                            if victim_prio == 0:
                                break
                    if victim_id is None:
                        return
                    _drop_source(victim_id)
                group[block_id] = block
                if ref:
                    source_by_ref[ref] = block_id
                if url:
                    source_by_url.setdefault(url, block_id)
                return

            if kind == "image":
                image_url = str(block.get("imageUrl") or "")
                if block_id in group:
                    existing = group[block_id]
                    if existing.get("queries") and not block.get("queries"):
                        group[block_id] = _merge_fields(existing, block, ("title", "url"))
                    else:
                        group[block_id] = _merge_fields(block, existing, ("title", "url"))
                    return
                if image_url and image_url in image_by_url:
                    existing_id = image_by_url[image_url]
                    existing = group.get(existing_id)
                    if existing:
                        if block.get("queries") and not existing.get("queries"):
                            del group[existing_id]
                            merged = _merge_fields(block, existing, ("title", "url"))
                            group[block_id] = merged
                            image_by_url[image_url] = block_id
                            return
                        if existing.get("queries") and not block.get("queries"):
                            group[existing_id] = _merge_fields(existing, block, ("title", "url"))
                            return
                        if not block.get("queries") and not existing.get("queries") and (
                            not block.get("ref") or existing.get("ref") == block.get("ref")
                        ):
                            group[existing_id] = _merge_fields(existing, block, ("title", "url"))
                            return
                if len(group) >= _BLOCK_LIMITS["image"]:
                    if not block.get("queries"):
                        return
                    replace = next((key for key in reversed(group) if not group[key].get("queries")), None)
                    if replace is None:
                        return
                    replaced = group.pop(replace)
                    rep_url = str(replaced.get("imageUrl") or "")
                    if rep_url and image_by_url.get(rep_url) == replace:
                        image_by_url.pop(rep_url, None)
                group[block_id] = block
                if image_url:
                    image_by_url[image_url] = block_id
                return

            if len(group) >= _BLOCK_LIMITS[kind] and block_id not in group:
                return
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
                    keep(block, prefer_authoritative=(kind == "assistant"))
        if search_status:
            description = "已接收当前回复的公开网页搜索结果" if search_status == "success" else "上游网页搜索返回错误"
            keep(_block("tool", "web.run", title="网页搜索", status=search_status, description=description))
        self.blocks = [block for group in blocks.values() for block in group.values()]
