"""Translate text-only upstream plans to client-executed Responses function calls."""
from __future__ import annotations

import json
import re
import uuid
from typing import Any


def function_tools(body: dict[str, Any]) -> list[dict[str, Any]]:
    # 注意：请求模型会把 tools 显式设为 None，不能用 .get("tools", []) 取默认值，
    # 否则拿到 None 后迭代会抛 TypeError: 'NoneType' object is not iterable。
    tools = body.get("tools") or []
    if not isinstance(tools, list):
        return []
    return [tool for tool in tools
            if isinstance(tool, dict) and tool.get("type") == "function" and tool.get("name")]


def should_search_for_function_plan(query: str) -> bool:
    """An optional search tool must not delay an ordinary image request or function continuation."""
    text = str(query or "").strip()
    if text.startswith("Function result for call_id="):
        return False
    return bool(re.search(r"搜索|联网|上网|查找|查询|最新|今日|今天|新闻|\bsearch\b|\bbrowse\b|\bweb\b", text, re.I))


def function_planning_instruction(tools: list[dict[str, Any]]) -> str:
    return (
        "You are the planner for an application that executes the following functions on the client. "
        "These functions ARE available. You do not execute them yourself: request execution by returning calls. "
        "For image creation requests, call generate_image or generate_image_batch when provided; "
        "do not tell the user image generation is unavailable. Preserve existing <ref id=... /> tags in prompts. "
        "Return ONLY a JSON object with exactly this shape: "
        '{"text":"brief response or progress note","calls":[{"name":"function_name","arguments":{}}]}. '
        "Use only the listed function names and match their parameter schemas. "
        "Use an empty calls array for ordinary conversation or when the requested work is complete. "
        "Do not repeat already completed calls. Function results in the conversation describe work already executed. "
        "Do not fabricate results or claim an image is complete before receiving a successful function result. "
        "Available functions:\n" + json.dumps(tools, ensure_ascii=False)
    )


def validate_arguments(value: object, schema: dict[str, Any], path: str = "arguments") -> None:
    expected = schema.get("type")
    valid = {
        "object": isinstance(value, dict), "array": isinstance(value, list),
        "string": isinstance(value, str), "boolean": isinstance(value, bool),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "null": value is None,
    }
    types = expected if isinstance(expected, list) else [expected]
    if expected and not any(valid.get(kind, False) for kind in types):
        raise ValueError(f"{path}: incorrect argument type")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: unsupported argument value")
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        if any(key not in value for key in schema.get("required", [])):
            raise ValueError(f"{path}: missing required argument")
        if schema.get("additionalProperties") is False and any(key not in properties for key in value):
            raise ValueError(f"{path}: unexpected argument")
        for key, item in value.items():
            if key in properties:
                validate_arguments(item, properties[key], f"{path}.{key}")
    if isinstance(value, list):
        for item in value:
            validate_arguments(item, schema.get("items", {}), path + "[]")
    if isinstance(value, (str, list)):
        minimum = schema.get("minLength" if isinstance(value, str) else "minItems")
        maximum = schema.get("maxLength" if isinstance(value, str) else "maxItems")
        if minimum is not None and len(value) < minimum or maximum is not None and len(value) > maximum:
            raise ValueError(f"{path}: argument length out of range")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"] or "maximum" in schema and value > schema["maximum"]:
            raise ValueError(f"{path}: argument value out of range")


def parse_function_plan(text: str, tools: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    content = text.strip()
    if content.startswith("```") and content.endswith("```"):
        content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        plan = json.loads(content)
    except (ValueError, IndexError):
        # Some text-only upstreams wrap the requested object in prose or a reasoning tag.
        # Accept only a complete JSON object with the expected keys; never execute prose.
        plan = None
        for position, character in enumerate(content):
            if character != "{":
                continue
            try:
                candidate, _ = json.JSONDecoder().raw_decode(content[position:])
            except ValueError:
                continue
            if isinstance(candidate, dict) and isinstance(candidate.get("calls"), list):
                plan = candidate
                break
        if plan is None:
            raise ValueError("The upstream model did not return a valid function plan; please retry.")
    if not isinstance(plan, dict) or not isinstance(plan.get("text"), str) or not isinstance(plan.get("calls"), list):
        raise ValueError("The upstream function plan has an invalid structure.")
    available = {str(tool["name"]): tool for tool in tools}
    calls: list[dict[str, Any]] = []
    if len(plan["calls"]) > 16:
        raise ValueError("Too many function calls in one response.")
    for call in plan["calls"]:
        if not isinstance(call, dict) or not isinstance(call.get("name"), str) or call["name"] not in available:
            raise ValueError("The upstream model requested an unavailable function.")
        arguments = call.get("arguments")
        if not isinstance(arguments, dict):
            raise ValueError("Function arguments must be an object.")
        validate_arguments(arguments, available[call["name"]].get("parameters", {"type": "object"}))
        calls.append({"type": "function_call", "id": f"fc_{uuid.uuid4().hex}",
                      "call_id": f"call_{uuid.uuid4().hex}", "status": "completed",
                      "name": call["name"], "arguments": json.dumps(arguments, ensure_ascii=False)})
    return plan["text"], calls
