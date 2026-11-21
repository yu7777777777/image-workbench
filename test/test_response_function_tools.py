from __future__ import annotations

import ast
import json
from pathlib import Path
import time
from types import SimpleNamespace
from typing import Any, Iterator
import uuid

import pytest

from services.protocol.response_function_tools import function_planning_instruction, function_tools, parse_function_plan, should_search_for_function_plan

TOOLS = [{"type": "function", "name": "generate_image", "parameters": {
    "type": "object", "properties": {"id": {"type": "string"}, "prompt": {"type": "string"}},
    "required": ["id", "prompt"], "additionalProperties": False,
}}]


def load_response_functions() -> dict[str, Any]:
    # Load the release functions without importing production config or account storage.
    tree = ast.parse(Path("services/protocol/openai_v1_response.py").read_text(encoding="utf-8-sig"))
    names = {"stream_function_response", "response_created", "response_completed", "text_output_item",
             "thinking_effort_from_body", "normalize_thinking_effort", "messages_from_input",
             "_append_response_message", "_is_response_content_part", "_message_content_from_response_item",
             "text_response_parts", "has_unsupported_response_tools", "response_events"}
    namespace = {"Any": Any, "Iterator": Iterator, "time": time, "uuid": uuid,
                 "function_tools": function_tools, "parse_function_plan": parse_function_plan,
                 "function_planning_instruction": function_planning_instruction,
                 "should_search_for_function_plan": should_search_for_function_plan,
                 "RESPONSE_CONTENT_PART_TYPES": {"text", "input_text", "output_text", "input_image", "image_url"},
                 "count_message_text_tokens": lambda *args: 1,
                 "count_message_image_tokens": lambda *args: 0, "count_text_tokens": lambda *args: 1,
                 "token_usage": lambda **kwargs: kwargs, "ConversationRequest": lambda **kwargs: SimpleNamespace(**kwargs),
                 "text_backend": lambda model: model, "extract_response_prompt": lambda value: ""}
    web_tree = ast.parse(Path("services/protocol/web_search_tool.py").read_text(encoding="utf-8-sig"))
    web_names = {"_tool_type", "has_unsupported_tools", "has_web_search_tool", "message_text", "search_query_from_messages"}
    web_selected = ast.Module(body=[node for node in web_tree.body
                                   if isinstance(node, ast.FunctionDef) and node.name in web_names
                                   or isinstance(node, ast.Assign) and any(
                                       isinstance(target, ast.Name) and target.id == "WEB_SEARCH_TOOL_TYPES"
                                       for target in node.targets)], type_ignores=[])
    exec(compile(web_selected, "release_web_tool_functions", "exec"), namespace)
    namespace["normalize_messages"] = lambda messages: messages
    namespace["normalize_text_messages"] = lambda messages: messages
    namespace["is_text_response_request"] = lambda body: True
    selected = ast.Module(body=[node for node in tree.body
                               if isinstance(node, ast.FunctionDef) and node.name in names
                               or isinstance(node, ast.Assign) and any(
                                   isinstance(target, ast.Name) and target.id == "TOOL_UNAVAILABLE_SYSTEM_MESSAGE"
                                   for target in node.targets)], type_ignores=[])
    exec(compile(selected, "release_response_functions", "exec"), namespace)
    return namespace


def test_single_image_plan_preserves_reference_and_emits_real_call() -> None:
    prompt = 'Edit <ref id="round-1-image-1" /> into a cat portrait'
    text, calls = parse_function_plan(json.dumps({"text": "Generating", "calls": [
        {"name": "generate_image", "arguments": {"id": "cat", "prompt": prompt}}]}), TOOLS)
    assert text == "Generating"
    assert json.loads(calls[0]["arguments"])["prompt"] == prompt
    assert calls[0]["type"] == "function_call" and calls[0]["call_id"].startswith("call_")


def test_plan_embedded_after_upstream_prose_is_recovered() -> None:
    text, calls = parse_function_plan('I will call the tool.\n{"text":"开始","calls":[{"name":"generate_image","arguments":{"id":"cat","prompt":"a cat"}}]}\nDone.', TOOLS)
    assert text == "开始" and calls[0]["name"] == "generate_image"


@pytest.mark.parametrize("call", [
    {"name": "shell", "arguments": {}},
    {"name": "generate_image", "arguments": {"id": "cat"}},
    {"name": "generate_image", "arguments": {"id": "cat", "prompt": 2}},
    {"name": "generate_image", "arguments": {"id": "cat", "prompt": "cat", "secret": "extra"}},
])
def test_invalid_calls_are_rejected(call: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        parse_function_plan(json.dumps({"text": "", "calls": [call]}), TOOLS)


def test_function_stream_contains_calls_in_completed_response() -> None:
    module = load_response_functions()
    def upstream(backend: object, request: object) -> Iterator[str]:
        assert "These functions ARE available" in request.messages[-1]["content"]
        yield json.dumps({"text": "开始生成", "calls": [{"name": "generate_image", "arguments": {"id": "dog", "prompt": "a dog"}}]})
    module["stream_text_deltas"] = upstream
    events = list(module["stream_function_response"]({"tools": TOOLS, "model": "auto"}, [{"role": "user", "content": "一只狗"}]))
    assert events[0]["type"] == "response.created"
    assert any(event["type"] == "response.function_call_arguments.done" for event in events)
    output = events[-1]["response"]["output"]
    assert output[1]["name"] == "generate_image"
    assert json.loads(output[1]["arguments"])["prompt"] == "a dog"


@pytest.mark.parametrize("tool_choice", [None, "auto", "required", {"type": "function", "name": "generate_image"}])
@pytest.mark.parametrize("with_search", [False, True])
def test_function_route_does_not_tell_planner_tools_are_unavailable(tool_choice: object, with_search: bool) -> None:
    module = load_response_functions()
    tools = [*TOOLS, *([{"type": "web_search"}] if with_search else [])]
    body = {"tools": tools, "tool_choice": tool_choice, "input": "生成一只猫", "instructions": "Keep references"}

    def upstream(backend: object, request: object) -> Iterator[str]:
        assert all(message["content"] != module["TOOL_UNAVAILABLE_SYSTEM_MESSAGE"] for message in request.messages)
        assert request.messages[0] == {"role": "system", "content": "Keep references"}
        assert "These functions ARE available" in request.messages[-1]["content"]
        yield '{"text":"开始","calls":[{"name":"generate_image","arguments":{"id":"cat","prompt":"a cat"}}]}'

    module["stream_text_deltas"] = upstream
    events = list(module["response_events"](body))
    assert any(item["type"] == "function_call" for item in events[-1]["response"]["output"])


@pytest.mark.parametrize("tools, tool_choice, unavailable", [
    ([{"type": "shell"}], None, True),
    ([*TOOLS, {"type": "shell"}], None, True),
    ([*TOOLS, {"type": "web_search"}, {"type": "unknown"}], None, True),
    (TOOLS, "none", True),
    ([*TOOLS, {"type": "web_search"}], "none", True),
    ([{"type": "function"}], None, True),
    ([{"type": "web_search"}], None, False),
    ([{"type": "image_generation"}], None, False),
    (None, None, False),
    ([], None, False),
])
def test_unavailable_guard_preserves_unknown_disabled_and_non_function_tools(
    tools: object, tool_choice: object, unavailable: bool,
) -> None:
    module = load_response_functions()
    body = {"tools": tools, "tool_choice": tool_choice, "input": "hello"}
    _, messages = module["text_response_parts"](body)
    assert module["has_unsupported_response_tools"](body) is unavailable
    assert any(message["content"] == module["TOOL_UNAVAILABLE_SYSTEM_MESSAGE"] for message in messages) is unavailable


@pytest.mark.parametrize("with_search", [False, True])
def test_tool_choice_none_does_not_route_to_function_or_search_planner(with_search: bool) -> None:
    module = load_response_functions()
    body = {"tools": [*TOOLS, *([{"type": "web_search"}] if with_search else [])],
            "tool_choice": "none", "input": "hello"}
    module["cache_key"] = lambda *args, **kwargs: "test-key"
    module["chat_completion_cache"] = SimpleNamespace(get_or_compute_stream=lambda key, compute: compute())

    def text_response(backend: object, request_body: dict[str, Any], messages: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
        assert messages[0]["content"] == module["TOOL_UNAVAILABLE_SYSTEM_MESSAGE"]
        yield {"type": "text-only"}

    module["stream_text_response"] = text_response
    assert list(module["response_events"](body)) == [{"type": "text-only"}]


def test_continuation_preserves_completed_function_results() -> None:
    module = load_response_functions()
    messages = module["messages_from_input"]([
        {"type": "function_call", "name": "generate_image", "call_id": "call_1", "arguments": '{"id":"cat"}'},
        {"type": "function_call_output", "call_id": "call_1", "output": '{"status":"success"}'},
    ])
    assert "generate_image" in messages[0]["content"]
    assert "success" in messages[1]["content"] and "call_1" in messages[1]["content"]


def test_completed_turn_does_not_create_another_image_call() -> None:
    module = load_response_functions()
    module["stream_text_deltas"] = lambda *args: iter(['{"text":"图片已生成","calls":[]}'])
    events = list(module["stream_function_response"]({"tools": TOOLS}, []))
    assert all(item["type"] != "function_call" for item in events[-1]["response"]["output"])


def test_invalid_first_plan_is_retried_before_emitting_calls() -> None:
    module = load_response_functions()
    attempts = iter(["I cannot call tools", '{"text":"开始","calls":[{"name":"generate_image","arguments":{"id":"cat","prompt":"a cat"}}]}'])
    module["stream_text_deltas"] = lambda *args: iter([next(attempts)])
    events = list(module["stream_function_response"]({"tools": TOOLS}, [{"role": "user", "content": "生成猫"}]))
    assert any(item["type"] == "function_call" for item in events[-1]["response"]["output"])


def test_nested_batch_arguments_are_validated() -> None:
    tools = [{"type": "function", "name": "generate_image_batch", "parameters": {
        "type": "object", "properties": {"images": {"type": "array", "items": TOOLS[0]["parameters"]}}, "required": ["images"],
    }}]
    with pytest.raises(ValueError):
        parse_function_plan('{"text":"","calls":[{"name":"generate_image_batch","arguments":{"images":[{"id":"1","prompt":false}]}}]}', tools)


def test_search_only_runs_for_explicit_search_requests() -> None:
    assert not should_search_for_function_plan("请生成一张白底蓝色圆形图标")
    assert not should_search_for_function_plan('Function result for call_id=call_1: {"status":"success"}')
    assert should_search_for_function_plan("请联网搜索最新图片风格，再生成封面")
