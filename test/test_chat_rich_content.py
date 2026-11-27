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


def test_image_components_preserve_only_their_own_query_results() -> None:
    markup = '<AsyncImageGroup query={["地图", "装备", "场景"]} layout="bento"/>'
    text = '前文\n<AsyncImage query="监控室"/>\n' + markup
    distractions = [{"type": "search_result", "thumbnail_url": f"https://example.org/other-{i}.png"} for i in range(15)]
    answer = _message("answer", "assistant", {"content_type": "text", "parts": [text]},
        search_result_groups=distractions,
        content_references=[
            {"type": "async_image", "component_resolution_id": "route-img", "genui_attributes": {"query": "监控室"}},
            {"type": "async_image_group", "component_resolution_id": "overview-img", "start_index": text.index(markup), "end_index": len(text)},
        ],
        model_dil_v2={"appData": {"opGenui": {"componentResults": {
            "route-img": {"state": {"images": [{"thumbnail_url": "https://example.org/route.png", "ref_id": "unrelated-image-ref"}]}},
            "overview-img": {"state": {"image_urls": ["https://example.org/a.png", "https://example.org/b.png", "http://127.0.0.1/nonpublic.png"]}},
        }}}})
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {}
    rich = ChatRichContent("owner-a")
    rich.observe(backend, _event(answer, text))
    rich.finish(backend)
    associated = [block for block in rich.blocks if block.get("queries")]
    assert [(block["ref"], block["queries"], block["imageUrl"]) for block in associated] == [
        ("route-img", ["监控室"], "https://example.org/route.png"),
        ("overview-img", ["地图", "装备", "场景"], "https://example.org/a.png"),
        ("overview-img", ["地图", "装备", "场景"], "https://example.org/b.png"),
    ]


def test_image_components_support_queries_attr_and_content_references_images() -> None:
    markup = '<AsyncImageGroup queries={["地图", "装备"]} layout="bento"/>'
    answer = _message("answer", "assistant", {"content_type": "text", "parts": [markup]},
        content_references=[{
            "type": "async_image_group",
            "component_resolution_id": "ref-group",
            "start_index": 0,
            "end_index": len(markup),
            "images": [{"thumbnail_url": "https://example.org/m1.png"}, {"thumbnail_url": "https://example.org/m2.png"}],
        }])
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {}
    rich = ChatRichContent("owner-a")
    rich.observe(backend, _event(answer, markup))
    rich.finish(backend)
    associated = [block for block in rich.blocks if block.get("queries")]
    assert [(block["ref"], block["queries"], block["imageUrl"]) for block in associated] == [
        ("ref-group", ["地图", "装备"], "https://example.org/m1.png"),
        ("ref-group", ["地图", "装备"], "https://example.org/m2.png"),
    ]


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


def test_content_references_image_v2_and_matched_text_preserve_queries_and_titles() -> None:
    text = '<AsyncImage query="东京塔夜景"/>\n<AsyncImageGroup query={["京都神社", "大阪城"]} layout="bento"/>'
    answer = _message(
        "answer",
        "assistant",
        {"content_type": "text", "parts": [text]},
        content_references=[
            {
                "type": "image_v2",
                "matched_text": '<AsyncImage query="东京塔夜景"/>',
                "alt": "东京塔夜景实拍",
                "images": [
                    {
                        "content_url": "https://images.openai.com/static-rsc-4/tokyo-tower.jpg",
                        "source_url": "https://travel.example.org/tokyo",
                        "title": "Tokyo Tower Night View",
                    },
                ],
            },
            {
                "type": "image_results",
                "query": ["京都神社", "大阪城"],
                "alt": "关西景点",
                "items": [
                    {"thumbnail_url": "https://images.openai.com/static-rsc-4/kyoto.jpg"},
                    {"image_url": "https://images.openai.com/static-rsc-4/osaka.jpg", "alt": "大阪城天守阁"},
                ],
            },
        ],
    )
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {}
    rich = ChatRichContent("owner-a")
    rich.observe(backend, _event(answer, text))
    rich.finish(backend)

    images = [block for block in rich.blocks if block["type"] == "image"]
    assert len(images) == 3
    by_url = {block["imageUrl"]: block for block in images}
    assert by_url["https://images.openai.com/static-rsc-4/tokyo-tower.jpg"]["queries"] == ["东京塔夜景"]
    assert by_url["https://images.openai.com/static-rsc-4/tokyo-tower.jpg"]["title"] == "Tokyo Tower Night View"
    assert by_url["https://images.openai.com/static-rsc-4/tokyo-tower.jpg"]["url"] == "https://travel.example.org/tokyo"
    assert by_url["https://images.openai.com/static-rsc-4/kyoto.jpg"]["queries"] == ["京都神社", "大阪城"]
    assert by_url["https://images.openai.com/static-rsc-4/kyoto.jpg"]["title"] == "关西景点"
    assert by_url["https://images.openai.com/static-rsc-4/osaka.jpg"]["queries"] == ["京都神社", "大阪城"]
    assert by_url["https://images.openai.com/static-rsc-4/osaka.jpg"]["title"] == "大阪城天守阁"


def test_grouped_webpages_matched_text_and_utm_dedup_preserve_all_citation_refs() -> None:
    text = (
        '结论 A<Cite refs={["turn0search0", "turn0search1"]}/> '
        '与结论 B<Cite refs={["turn0search2"]}/> '
        '和结论 C<Cite refs={["turn0news4"]}/>。'
    )
    search = _message(
        "search-1",
        "tool",
        {"content_type": "text", "text": "raw search"},
        name="web.run",
        search_result_groups=[
            {
                "type": "search_result_group",
                "entries": [
                    {
                        "type": "search_result",
                        "ref_id": {"turn_index": 0, "ref_type": "search", "ref_index": 0},
                        "url": "https://docs.example.org/alpha",
                        "title": "Alpha Doc",
                    },
                ],
            }
        ],
    )
    assistant = _message(
        "answer",
        "assistant",
        {"content_type": "text", "parts": [text]},
        content_references=[
            {
                "type": "grouped_webpages",
                "matched_text": "\ue200cite\ue202turn0search0\ue202turn0search1\ue201",
                "items": [
                    {
                        "title": "Alpha Doc (Official)",
                        "url": "https://docs.example.org/alpha?utm_source=chatgpt.com",
                        "snippet": "Alpha summary",
                        "refs": [{"turn_index": 0, "ref_type": "search", "ref_index": 0}],
                        "supporting_websites": [
                            {
                                "title": "Beta Supporting",
                                "url": "https://docs.example.org/beta?utm_source=chatgpt.com",
                                "refs": [{"turn_index": 0, "ref_type": "search", "ref_index": 1}],
                            }
                        ],
                    }
                ],
            },
            {
                "type": "webpage",
                "matched_text": "\ue200cite\ue202turn0search2\ue201",
                "url": "https://docs.example.org/gamma?id=9&utm_source=chatgpt.com",
                "title": "Gamma Page",
            },
            {
                "type": "sources_footnote",
                "refs": ["turn0news4"],
                "safe_urls": ["https://news.example.org/story?utm_source=chatgpt.com"],
                "title": "News Story",
            },
        ],
    )
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {}
    rich = ChatRichContent("owner-a")
    rich.observe(backend, _event(search, ""))
    rich.observe(backend, _event(assistant, text))
    rich.finish(backend)

    sources = [block for block in rich.blocks if block["type"] == "source"]
    by_ref = [block for block in sources if block.get("ref") == "turn0search0"]
    # Same ref across search_result_groups and content_references must never emit conflicting duplicate URLs
    assert len(by_ref) == 1
    assert by_ref[0]["url"] == "https://docs.example.org/alpha"
    assert by_ref[0]["description"] == "Alpha summary"
    refs_map = {block["ref"]: block["url"] for block in sources if block.get("ref")}
    assert refs_map["turn0search0"] == "https://docs.example.org/alpha"
    assert refs_map["turn0search1"] == "https://docs.example.org/beta"
    assert refs_map["turn0search2"] == "https://docs.example.org/gamma?id=9"
    assert refs_map["turn0news4"] == "https://news.example.org/story"


def test_cited_sources_evict_uncited_results_when_over_source_limit() -> None:
    text = '详见<Cite refs={["turn1search2"]}/>'
    many_results = [
        {
            "type": "search_result",
            "ref_id": {"turn_index": 0, "ref_type": "search", "ref_index": i},
            "url": f"https://noise.example.org/page-{i}",
            "title": f"Noise {i}",
        }
        for i in range(28)
    ]
    search1 = _message(
        "search-1",
        "tool",
        {"content_type": "text", "text": "raw"},
        name="web.run",
        search_result_groups=[{"type": "search_result_group", "entries": many_results}],
    )
    search2 = _message(
        "search-2",
        "tool",
        {"content_type": "text", "text": "raw"},
        name="web.run",
        search_result_groups=[
            {
                "type": "search_result_group",
                "entries": [
                    {
                        "type": "search_result",
                        "ref_id": {"turn_index": 1, "ref_type": "search", "ref_index": 2},
                        "url": "https://cited.example.org/final",
                        "title": "Cited Final Source",
                    }
                ],
            }
        ],
    )
    assistant = _message("answer", "assistant", {"content_type": "text", "parts": [text]})
    backend = Mock()
    backend._get_editable_conversation_detail.return_value = {}
    rich = ChatRichContent("owner-a")
    rich.observe(backend, _event(search1, ""))
    rich.observe(backend, _event(search2, ""))
    rich.observe(backend, _event(assistant, text))
    rich.finish(backend)

    sources = [block for block in rich.blocks if block["type"] == "source"]
    assert len(sources) == 24
    cited = [block for block in sources if block.get("ref") == "turn1search2"]
    assert len(cited) == 1
    assert cited[0]["url"] == "https://cited.example.org/final"


def test_observe_captures_streamed_metadata_patches_when_detail_unavailable() -> None:
    text = '参考<Cite refs={["turn0search5"]}/>\n<AsyncImage query="海边日落"/>'
    assistant = _message("answer", "assistant", {"content_type": "text", "parts": [text]})
    patch_event = {
        "conversation_id": "conversation-1",
        "text": text,
        "raw": {
            "o": "patch",
            "v": [
                {
                    "p": "/message/metadata/content_references",
                    "o": "append",
                    "v": [
                        {
                            "type": "webpage",
                            "matched_text": "\ue200cite\ue202turn0search5\ue201",
                            "url": "https://patch.example.org/ref5",
                            "title": "Patched Source",
                        },
                        {
                            "type": "image_v2",
                            "query": "海边日落",
                            "images": [{"thumbnail_url": "https://images.openai.com/sunset.jpg", "alt": "日落"}],
                        },
                    ],
                }
            ],
        },
    }
    backend = Mock()
    backend._get_editable_conversation_detail.side_effect = RuntimeError("upstream unavailable")
    rich = ChatRichContent("owner-a")
    rich.observe(backend, _event(assistant, text))
    rich.observe(backend, patch_event)
    rich.finish(backend)

    sources = {block.get("ref"): block for block in rich.blocks if block["type"] == "source"}
    images = [block for block in rich.blocks if block["type"] == "image"]
    assert sources["turn0search5"]["url"] == "https://patch.example.org/ref5"
    assert len(images) == 1
    assert images[0]["queries"] == ["海边日落"]
    assert images[0]["imageUrl"] == "https://images.openai.com/sunset.jpg"


def _patch_fake_backend(monkeypatch: pytest.MonkeyPatch, payloads_by_token: dict[str, list[str] | Exception]) -> None:
    class FakeBackend:
        def __init__(self, access_token: str = "") -> None:
            self.access_token = access_token

        def stream_conversation(self, **kwargs: object):
            entry = payloads_by_token[self.access_token]
            if isinstance(entry, Exception):
                raise entry
            return iter(entry)

        def _get_editable_conversation_detail(self, *args: object, **kwargs: object) -> dict:
            return {"mapping": {}}

        def close(self) -> None:
            pass

    monkeypatch.setattr(conversation, "OpenAIBackendAPI", FakeBackend)
    monkeypatch.setattr(conversation.account_service, "mark_text_used", Mock())


def test_thoughts_and_incremental_patches_emit_status_before_first_delta(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = [
        json.dumps({
            "conversation_id": "conv-think",
            "v": {
                "message": {
                    "id": "thought-1",
                    "author": {"role": "assistant"},
                    "recipient": "all",
                    "content": {"content_type": "thoughts", "thoughts": []},
                }
            },
        }),
        json.dumps({
            "o": "patch",
            "v": [
                {
                    "p": "/message/content/thoughts",
                    "o": "append",
                    "v": [{"summary": "分析日程", "content": "先检查\ue200cite\ue202turn0search0\ue201字段"}],
                }
            ],
        }),
        json.dumps({
            "o": "patch",
            "v": [
                {"p": "/message/content/thoughts/0/summary", "o": "append", "v": "卡片结构\ue200cite\ue202turn0search1\ue201"},
            ],
        }),
        # Duplicate content patch when summary already set should be deduplicated
        json.dumps({
            "o": "patch",
            "v": [
                {"p": "/message/content/thoughts/0/content", "o": "append", "v": "补充细节"},
            ],
        }),
        json.dumps({
            "conversation_id": "conv-think",
            "v": {
                "message": {
                    "id": "answer-1",
                    "author": {"role": "assistant"},
                    "channel": "final",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": ["这是最终日程建议。"]},
                }
            },
        }),
        "[DONE]",
    ]
    _patch_fake_backend(monkeypatch, {"tok-1": payloads})

    rich = ChatRichContent("owner-a")
    chunks = list(
        openai_v1_chat_complete.stream_text_chat_completion(
            SimpleNamespace(access_token="tok-1"),
            [{"role": "user", "content": "帮我设计日程卡片"}],
            "gpt-5",
            rich_content=rich,
        )
    )

    first_delta_idx = next(
        idx for idx, chunk in enumerate(chunks)
        if chunk["choices"][0]["delta"].get("content")
    )
    status_before_delta = [
        chunk["workbench"]["status"]
        for chunk in chunks[:first_delta_idx]
        if "workbench" in chunk and "status" in chunk["workbench"]
    ]

    assert first_delta_idx >= 3
    assert [s["stage"] for s in status_before_delta[:3]] == ["thinking", "thinking", "thinking"]
    assert status_before_delta[1]["detail"] == "分析日程"
    assert status_before_delta[2]["detail"] == "分析日程卡片结构"
    assert status_before_delta[2]["thoughts"] == ["分析日程卡片结构"]
    # Verify private-use annotation markers are completely stripped
    for status in status_before_delta:
        serialized = json.dumps(status, ensure_ascii=False)
        assert "\ue200" not in serialized and "\ue201" not in serialized and "\ue202" not in serialized
    # Status chunks before answer have empty delta and finish_reason None
    for chunk in chunks[:first_delta_idx]:
        assert chunk["choices"][0]["delta"] == {}
        assert chunk["choices"][0]["finish_reason"] is None

    assert openai_v1_chat_complete.collect_chat_content(chunks) == "这是最终日程建议。"
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"
    assert chunks[-1]["workbench"]["status"]["thoughts"] == ["分析日程卡片结构"]


def test_analysis_channel_reasoning_emits_thinking_without_leaking_to_content(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = [
        json.dumps({
            "conversation_id": "conv-analysis",
            "v": {
                "message": {
                    "id": "analysis-1",
                    "author": {"role": "assistant"},
                    "channel": "analysis",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": [""]},
                }
            },
        }),
        json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "**梳理需求**\n"}),
        json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "校验输出格式与边界"}),
        json.dumps({
            "conversation_id": "conv-analysis",
            "v": {
                "message": {
                    "id": "final-1",
                    "author": {"role": "assistant"},
                    "channel": "final",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": [""]},
                }
            },
        }),
        json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "最终回答内容。"}),
        "[DONE]",
    ]
    _patch_fake_backend(monkeypatch, {"tok-1": payloads})

    rich = ChatRichContent("owner-a")
    chunks = list(
        openai_v1_chat_complete.stream_text_chat_completion(
            SimpleNamespace(access_token="tok-1"),
            [{"role": "user", "content": "解释一下"}],
            "gpt-5",
            rich_content=rich,
        )
    )

    content = openai_v1_chat_complete.collect_chat_content(chunks)
    assert content == "最终回答内容。"
    assert "梳理需求" not in content
    assert "校验输出格式与边界" not in content

    thinking_statuses = [
        chunk["workbench"]["status"]
        for chunk in chunks
        if "workbench" in chunk and chunk["workbench"].get("status", {}).get("stage") == "thinking"
    ]
    assert thinking_statuses
    assert any(status.get("detail") == "梳理需求" for status in thinking_statuses)
    assert any(status.get("detail") == "校验输出格式与边界" for status in thinking_statuses)


def test_web_search_python_and_image_tools_emit_realtime_status(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = [
        json.dumps({
            "conversation_id": "conv-tools",
            "v": {
                "message": {
                    "id": "call-web",
                    "author": {"role": "assistant"},
                    "recipient": "web",
                    "content": {"content_type": "code", "text": ""},
                }
            },
        }),
        json.dumps({
            "o": "patch",
            "v": [
                {"p": "/message/content/text", "o": "append", "v": '{"search_query":[{"q":"2026年南京天气预报"}]}'},
            ],
        }),
        json.dumps({
            "conversation_id": "conv-tools",
            "v": {
                "message": {
                    "id": "call-py",
                    "author": {"role": "assistant"},
                    "recipient": "python",
                    "content": {"content_type": "code", "text": "print(1 + 1)"},
                }
            },
        }),
        json.dumps({
            "conversation_id": "conv-tools",
            "v": {
                "message": {
                    "id": "call-img",
                    "author": {"role": "assistant"},
                    "recipient": "t2uay3k.sj1i4kz",
                    "content": {"content_type": "text", "parts": [""]},
                    "metadata": {"async_task_type": "image_gen"},
                }
            },
        }),
        json.dumps({
            "conversation_id": "conv-tools",
            "v": {
                "message": {
                    "id": "ans-tools",
                    "author": {"role": "assistant"},
                    "channel": "final",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": ["查询完成。"]},
                }
            },
        }),
        "[DONE]",
    ]
    _patch_fake_backend(monkeypatch, {"tok-1": payloads})

    rich = ChatRichContent("owner-a")
    chunks = list(
        openai_v1_chat_complete.stream_text_chat_completion(
            SimpleNamespace(access_token="tok-1"),
            [{"role": "user", "content": "查一下天气并画图"}],
            "gpt-5",
            rich_content=rich,
        )
    )

    statuses = [
        chunk["workbench"]["status"]
        for chunk in chunks
        if "workbench" in chunk and "status" in chunk["workbench"]
    ]
    assert any(s["stage"] == "searching" and s["label"] == "正在联网检索" and s.get("detail") == "2026年南京天气预报" for s in statuses)
    assert any(s["stage"] == "tool" and s["label"] == "正在运行分析工具" for s in statuses)
    assert any(s["stage"] == "tool" and s["label"] == "正在检索或生成配图" for s in statuses)
    assert openai_v1_chat_complete.collect_chat_content(chunks) == "查询完成。"


@pytest.mark.parametrize(
    ("recap_text", "meta", "expected"),
    [
        ("Thought for 1m 7s", {}, 67),
        ("Thought for 42 seconds", {}, 42),
        ("思考了 1m 7s", {}, 67),
        ("思考了 25 秒", {}, 25),
        ("", {"finished_duration_sec": 38.6}, 39),
    ],
)
def test_reasoning_recap_parses_thought_duration_sec(recap_text: str, meta: dict, expected: int) -> None:
    backend = Mock()
    rich = ChatRichContent("owner-a")
    recap_msg = {
        "id": "recap-1",
        "author": {"role": "assistant"},
        "recipient": "all",
        "content": {"content_type": "reasoning_recap", "content": recap_text},
        "metadata": meta,
    }
    rich.observe(backend, {"conversation_id": "conv-recap", "raw": {"v": {"message": recap_msg}}})
    status = rich.pop_status()
    assert status is not None
    assert status["thoughtDurationSec"] == expected
    assert rich.thought_duration_sec == expected
    summary = rich.final_thinking_summary()
    assert summary is not None and summary["thoughtDurationSec"] == expected


def test_account_retry_emits_retrying_status_before_next_account(monkeypatch: pytest.MonkeyPatch) -> None:
    answer_payloads = [
        json.dumps({
            "conversation_id": "conv-retry",
            "v": {
                "message": {
                    "id": "ans-retry",
                    "author": {"role": "assistant"},
                    "channel": "final",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": ["切换账号后成功返回"]},
                }
            },
        }),
        "[DONE]",
    ]
    _patch_fake_backend(
        monkeypatch,
        {
            "expired-tok": RuntimeError("chat_requirements_prepare status=401 token_expired"),
            "healthy-tok": answer_payloads,
        },
    )
    monkeypatch.setattr(conversation.account_service, "refresh_access_token", Mock(return_value=""))
    monkeypatch.setattr(conversation.account_service, "get_text_access_token", Mock(return_value="healthy-tok"))

    rich = ChatRichContent("owner-a")
    chunks = list(
        openai_v1_chat_complete.stream_text_chat_completion(
            SimpleNamespace(access_token="expired-tok"),
            [{"role": "user", "content": "你好"}],
            "gpt-5",
            rich_content=rich,
        )
    )

    retrying_chunks = [
        chunk for chunk in chunks
        if chunk.get("workbench", {}).get("status", {}).get("stage") == "retrying"
    ]
    assert len(retrying_chunks) == 1
    assert retrying_chunks[0]["workbench"]["status"] == {
        "stage": "retrying",
        "label": "正在切换可用账号重试",
    }
    assert retrying_chunks[0]["choices"][0]["delta"] == {}
    assert openai_v1_chat_complete.collect_chat_content(chunks) == "切换账号后成功返回"


def test_generic_stream_without_rich_content_emits_zero_workbench_and_zero_reasoning(monkeypatch: pytest.MonkeyPatch) -> None:
    payloads = [
        json.dumps({
            "conversation_id": "conv-plain",
            "v": {
                "message": {
                    "id": "t1",
                    "author": {"role": "assistant"},
                    "recipient": "all",
                    "content": {"content_type": "thoughts", "thoughts": [{"summary": "内部思考"}]},
                }
            },
        }),
        json.dumps({
            "conversation_id": "conv-plain",
            "v": {
                "message": {
                    "id": "a1",
                    "author": {"role": "assistant"},
                    "channel": "analysis",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": [""]},
                }
            },
        }),
        json.dumps({"p": "/message/content/parts/0", "o": "append", "v": "隐藏推理文本"}),
        json.dumps({
            "conversation_id": "conv-plain",
            "v": {
                "message": {
                    "id": "w1",
                    "author": {"role": "assistant"},
                    "recipient": "web",
                    "content": {"content_type": "code", "text": 'search("query")'},
                }
            },
        }),
        json.dumps({
            "conversation_id": "conv-plain",
            "v": {
                "message": {
                    "id": "r1",
                    "author": {"role": "assistant"},
                    "recipient": "all",
                    "content": {"content_type": "reasoning_recap", "content": "Thought for 1m 7s"},
                }
            },
        }),
        json.dumps({
            "conversation_id": "conv-plain",
            "v": {
                "message": {
                    "id": "f1",
                    "author": {"role": "assistant"},
                    "channel": "final",
                    "recipient": "all",
                    "content": {"content_type": "text", "parts": ["公开回答"]},
                }
            },
        }),
        "[DONE]",
    ]
    _patch_fake_backend(monkeypatch, {"tok-1": payloads})

    chunks = list(
        openai_v1_chat_complete.stream_text_chat_completion(
            SimpleNamespace(access_token="tok-1"),
            [{"role": "user", "content": "hello"}],
            "gpt-5",
            rich_content=None,
        )
    )

    assert all("workbench" not in chunk for chunk in chunks)
    assert openai_v1_chat_complete.collect_chat_content(chunks) == "公开回答"
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"


def test_status_caps_lengths_thoughts_count_and_search_model_queries() -> None:
    backend = Mock()
    rich = ChatRichContent("owner-a")

    many_thoughts = [{"summary": f"步骤{i:02d}-" + ("长" * 320)} for i in range(15)]
    rich.observe(
        backend,
        {
            "conversation_id": "conv-cap",
            "raw": {
                "v": {
                    "message": {
                        "id": "t-cap",
                        "author": {"role": "assistant"},
                        "recipient": "all",
                        "content": {"content_type": "thoughts", "thoughts": many_thoughts},
                    }
                }
            },
        },
    )
    status = rich.pop_status()
    assert status is not None
    assert len(status["thoughts"]) == 12
    assert status["thoughts"][0].startswith("步骤03-")
    assert status["thoughts"][-1].startswith("步骤14-")
    assert all(len(item) <= 280 for item in status["thoughts"])
    assert len(status["detail"]) <= 160
    # Calling pop_status again without changes must deduplicate
    assert rich.pop_status() is None

    # Test metadata.search_model_queries cap at 120 chars and annotation stripping
    long_query = "检索关键词\ue200cite\ue202turn0search0\ue201" + ("x" * 200)
    rich.observe(
        backend,
        {
            "conversation_id": "conv-cap",
            "raw": {
                "v": {
                    "message": {
                        "id": "s-cap",
                        "author": {"role": "tool", "name": "web.run"},
                        "recipient": "all",
                        "content": {"content_type": "text", "parts": [""]},
                        "metadata": {"search_model_queries": {"queries": [long_query]}},
                    }
                }
            },
        },
    )
    search_status = rich.pop_status()
    assert search_status is not None
    assert search_status["stage"] == "searching"
    assert search_status["label"] == "正在联网检索"
    assert len(search_status["detail"]) <= 120
    assert "\ue200" not in search_status["detail"]
