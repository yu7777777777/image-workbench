from __future__ import annotations

import json
import time
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api import ai
from services import chat_attachments, log_service
from services.chat_attachments import ChatAttachmentStore
from services.config import config
from services.protocol import chat_rich_content, conversation, openai_v1_chat_complete
from services.protocol.chat_rich_content import ChatRichContent


def _message(message_id: str, role: str, content: dict, *, name: str = "", turn: str = "current", **metadata: object) -> dict:
    return {"id": message_id, "author": {"role": role, "name": name}, "content": content,
            "metadata": {"turn_exchange_id": turn, **metadata}}


def _event(message: dict, text: str = "") -> dict:
    return {"conversation_id": "conversation-1", "text": text, "raw": {"v": {"message": message}}}


def test_rich_blocks_use_actual_results_and_current_turn_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    text = '看图 <AsyncImage ref="sample-product"/> [下载](sandbox:/mnt/data/calculation%20result.txt)'
    component_start = text.index("<AsyncImage")
    source = {"type": "search_result", "ref_id": {"turn_index": 0, "ref_type": "search", "ref_index": 3},
              "url": "https://www.example.org/report", "title": "公开来源", "thumbnail_url": "https://www.example.org/report.png"}
    extra_sources = [{"type": "search_result", "url": f"https://www.example.org/{index}"} for index in range(75)]
    product = {"title": "样例产品", "price": {"amount": 25, "currency": "USD"}, "url": "https://store.example.org/1",
               "image_urls": ["https://store.example.org/1.jpg"], "offers": [{"merchant": "Example Store"}]}
    assistant = _message("answer", "assistant", {"content_type": "text", "parts": [text]},
        content_references=[{"type": "async_image", "component_resolution_id": "component-1",
                             "start_index": component_start, "end_index": text.index("/>", component_start) + 2}],
        model_dil_v2={"appData": {"opGenui": {"componentResults": {
            "component-1": {"state": {"click_action": {"payload": {"extraParams": {"product": product}}}}},
        }}}})
    search = _message("search", "tool", {"content_type": "text", "text": "private tool plumbing"}, name="web.run",
                      search_result_groups=[{"type": "search_result_group", "entries": [source, *extra_sources]}])
    execution = _message("execution", "tool", {"content_type": "execution_output", "text": "42"}, name="python")
    error = _message("error", "tool", {"content_type": "execution_output", "text": "Traceback (most recent call last):\nValueError: bad data"}, name="python")
    previous = _message("unrelated", "tool", {"content_type": "execution_output", "text": "foreign history"}, name="python", turn="other")
    hidden = _message("hidden", "tool", {"content_type": "execution_output", "text": "internal"}, name="python",
                      is_visually_hidden_from_conversation=True)
    plugin = _message("plugin", "tool", {"content_type": "text", "text": "connector secret"}, name="api_tool.list_resources")
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {"mapping": {
        message["id"]: {"message": message} for message in (assistant, search, execution, error, previous, hidden, plugin)
    }}
    backend._resolve_editable_download_url.side_effect = lambda _, artifact, **kwargs: (
        "https://files.oaiusercontent.com/result?sig=private" if artifact.message_id == "answer" else ""
    )
    save = Mock(return_value="a" * 32)
    monkeypatch.setattr(chat_rich_content, "save_downloaded_chat_attachment", save)

    reply = ChatRichContent("owner-a")
    reply.observe(backend, _event(assistant, text))
    reply.observe(backend, _event(search, text))
    reply.finish(backend)

    attachments = [block for block in reply.blocks if block["type"] == "attachment"]
    assert attachments == [{"id": "a" * 32, "type": "attachment", "path": "sandbox:/mnt/data/calculation%20result.txt", "title": "calculation result.txt"}]
    call = backend._resolve_editable_download_url.call_args
    assert (call.args[0], call.args[1].message_id, call.args[1].sandbox_path) == ("conversation-1", "answer", "/mnt/data/calculation result.txt")
    assert not call.args[1].file_id and not call.args[1].attachment_id
    assert call.kwargs["allow_redirects"] is False
    assert save.call_args.args[2:4] == ("owner-a", "calculation result.txt")
    by_type = {block["type"]: block for block in reply.blocks}
    sources = [block for block in reply.blocks if block["type"] == "source"]
    assert len(sources) == 24
    assert sources[0]["ref"] == "turn0search3"
    assert by_type["image"]["imageUrl"] == source["thumbnail_url"]
    assert by_type["product"]["ref"] == "sample-product"
    assert by_type["product"]["price"] == "25 USD"
    assert by_type["product"]["merchant"] == "Example Store"
    outputs = [block for block in reply.blocks if block["type"] == "python"]
    assert outputs[0]["text"] == "42" and outputs[0]["status"] == "success"
    assert "ValueError: bad data" in outputs[1]["text"] and outputs[1]["status"] == "error"
    exposed = json.dumps(reply.blocks)
    assert all(word not in exposed for word in ("foreign history", "internal", "connector secret", "sig=private", "private tool plumbing"))


def test_attachment_resolution_rejects_non_visible_paths_and_other_turns(monkeypatch: pytest.MonkeyPatch) -> None:
    text = "[wrong](sandbox:/mnt/data/%2e%2e/file.txt) [missing](sandbox:/mnt/data/test.txt)"
    current = _message("current", "assistant", {"content_type": "text", "parts": [text]})
    other_turn = _message("other", "assistant", {"content_type": "text", "parts": ["[x](sandbox:/mnt/data/other.txt)"]}, turn="old")
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {"mapping": {"other": {"message": other_turn}}}
    backend._resolve_editable_download_url.return_value = ""
    save = Mock()
    monkeypatch.setattr(chat_rich_content, "save_downloaded_chat_attachment", save)

    reply = ChatRichContent("owner-a")
    reply.observe(backend, _event(current, f"{text} [other](sandbox:/mnt/data/other.txt)"))
    reply.finish(backend)

    backend._resolve_editable_download_url.assert_called_once()
    artifact = backend._resolve_editable_download_url.call_args.args[1]
    assert (artifact.message_id, artifact.sandbox_path) == ("current", "/mnt/data/test.txt")
    assert reply.blocks == []
    save.assert_not_called()


def test_download_is_authenticated_and_owner_bound(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    store = ChatAttachmentStore(tmp_path)
    attachment = store.save("alice", "报告.txt", iter([b"first\r\n", b"second\r\n"]))
    monkeypatch.setattr(ai, "chat_attachment_store", ChatAttachmentStore(tmp_path))

    def identity(authorization: str | None) -> dict[str, object]:
        if authorization not in {"Bearer alice", "Bearer bob"}:
            raise HTTPException(status_code=401)
        return {"id": authorization.removeprefix("Bearer ")}

    monkeypatch.setattr(ai, "require_identity", identity)
    app = FastAPI()
    app.include_router(ai.create_router())
    with TestClient(app) as client:
        endpoint = f"/v1/chat/attachments/{attachment}"
        assert client.get(endpoint).status_code == 401
        assert client.get(endpoint, headers={"Authorization": "Bearer bob"}).status_code == 404
        response = client.get(endpoint, headers={"Authorization": "Bearer alice"})
        assert response.status_code == 200
        assert response.content == b"first\r\nsecond\r\n"
        assert response.headers["cache-control"] == "private, no-store"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert "%E6%8A%A5%E5%91%8A.txt" in response.headers["content-disposition"]


def test_attachment_download_rechecks_redirects_and_aborts_over_limit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    response = Mock(status_code=302, headers={"Location": "http://127.0.0.1/private"})
    public_session = Mock()
    public_session.get.return_value = response
    monkeypatch.setattr(chat_attachments.requests, "Session", lambda **kwargs: nullcontext(public_session))
    auth_session = Mock()
    backend = SimpleNamespace(account={}, session=auth_session)
    deadline = time.monotonic() + 60
    assert chat_attachments.save_downloaded_chat_attachment(
        backend, "https://files.oaiusercontent.com/valid?sig=private", "alice", "a.txt", deadline,
    ) == ""
    auth_session.get.assert_not_called()
    public_session.get.assert_called_once()

    store = ChatAttachmentStore(tmp_path)
    monkeypatch.setattr(chat_attachments, "MAX_ATTACHMENT_BYTES", 4)
    with pytest.raises(ValueError, match="size limit"):
        store.save("alice", "big.txt", iter([b"too big"]))
    assert not list(tmp_path.glob("*/*"))


def test_plain_stream_and_citation_fragments_remain_compatible(monkeypatch: pytest.MonkeyPatch) -> None:
    deltas = Mock(return_value=iter(["hi"]))
    monkeypatch.setattr(openai_v1_chat_complete, "stream_text_deltas", deltas)
    chunks = list(openai_v1_chat_complete.stream_text_chat_completion(object(), [], "gpt-6"))
    assert all("workbench" not in chunk for chunk in chunks)
    assert deltas.call_args.kwargs == {}
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"

    first = json.dumps({"message": _message("answer", "assistant", {"content_type": "text", "parts": ["A\ue200cite\ue202turn0"]})})
    second = json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "search0\ue201."})
    ordinary = list(conversation.iter_conversation_payloads(iter([first, second, "[DONE]"])))
    rich = list(conversation.iter_conversation_payloads(iter([first, second, "[DONE]"]), preserve_citations=True))
    assert ordinary[-1]["text"] == "A."
    assert rich[-1]["text"] == 'A<Cite refs={["turn0search0"]}/>.'


def test_workbench_envelope_is_not_copied_to_call_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    chunk = {"choices": [], "workbench": {"blocks": [{"type": "source", "url": "https://example.com/?sig=private"}]}}
    capture = Mock()
    monkeypatch.setattr(log_service.LoggedCall, "log", capture)
    call = log_service.LoggedCall({"id": "alice"}, "/v1/chat/completions", "gpt-6", "chat")
    assert list(call.stream([chunk])) == [chunk]
    assert capture.call_args.kwargs["urls"] == []


def test_authenticated_stream_opt_in_is_separately_cached_per_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(config.data, "chat_completion_cache", {"enabled": True, "stream_cache": True})
    openai_v1_chat_complete.chat_completion_cache.clear()
    monkeypatch.setattr(conversation.account_service, "mark_text_used", Mock())
    monkeypatch.setattr(log_service.LoggedCall, "log", Mock())

    async def allow_request(*args: object) -> None:
        pass

    monkeypatch.setattr(ai, "filter_or_log", allow_request)
    monkeypatch.setattr(ai, "require_identity", lambda header: {"id": header.removeprefix("Bearer ")})
    factory = Mock()

    def backend(access_token: str) -> SimpleNamespace:
        instance = factory()
        answer = _message("answer", "assistant", {"content_type": "text", "parts": ["结果"]})
        execution = _message("python", "tool", {"content_type": "execution_output", "text": f"run {factory.call_count}"}, name="python")
        instance.stream_conversation.return_value = iter([
            json.dumps({"conversation_id": "conversation-1", "message": execution}),
            json.dumps({"conversation_id": "conversation-1", "message": answer}),
            "[DONE]",
        ])
        instance._get_editable_conversation_detail.return_value = {"mapping": {}}
        return instance

    monkeypatch.setattr(conversation, "OpenAIBackendAPI", backend)
    monkeypatch.setattr(openai_v1_chat_complete, "text_backend", lambda model: SimpleNamespace(access_token="test", close=lambda: None))
    app = FastAPI()
    app.include_router(ai.create_router())

    def send(client: TestClient, owner: str, rich: bool) -> list[dict]:
        response = client.post("/v1/chat/completions", headers={"Authorization": f"Bearer {owner}"}, json={
            "model": "gpt-6", "stream": True, "prompt": "same request", "rich_content": rich,
        })
        assert response.status_code == 200
        frames = [line.removeprefix("data: ") for line in response.text.splitlines() if line.startswith("data: ")]
        assert frames[-1] == "[DONE]"
        return [json.loads(payload) for payload in frames[:-1]]

    try:
        with TestClient(app) as client:
            ordinary = send(client, "alice", rich=False)
            alice = send(client, "alice", rich=True)
            repeat = send(client, "alice", rich=True)
            bob = send(client, "bob", rich=True)
        assert factory.call_count == 3
        assert ordinary[-1]["choices"][0]["finish_reason"] == "stop"
        assert all("workbench" not in chunk for chunk in ordinary)
        assert alice[-1]["workbench"]["blocks"][0]["text"] == "run 2"
        assert repeat == alice
        assert bob[-1]["workbench"]["blocks"][0]["text"] == "run 3"
    finally:
        openai_v1_chat_complete.chat_completion_cache.clear()
