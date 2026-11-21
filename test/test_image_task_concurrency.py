"""Offline concurrency/settings contracts; never import runtime data services.

Execute the actual AST definitions, omitting import-time singleton startup (which
opens production data). This follows test_external_models_release.py's pattern.
"""
from __future__ import annotations

import ast
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from pathlib import Path
import threading
from types import SimpleNamespace
from typing import Callable
from unittest.mock import Mock

from fastapi import APIRouter, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict
import pytest

ROOT = Path(__file__).resolve().parents[1]


def _definitions(path: str, names: set[str], namespace: dict) -> dict:
    source = ROOT / path
    tree = ast.parse(source.read_text(encoding="utf-8"))
    nodes = [node for node in tree.body if getattr(node, "name", None) in names]
    # Future annotations avoid importing service model types solely for hints.
    future = ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)
    module = ast.fix_missing_locations(ast.Module(body=[future, *nodes], type_ignores=[]))
    exec(compile(module, str(source), "exec"), namespace)
    return namespace


@pytest.fixture
def store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    source = ROOT / "services/config.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    # Retain all real configuration definitions, but no runtime singleton or
    # storage imports. ConfigStore itself points exclusively at pytest temp dir.
    tree.body = [node for node in tree.body if not (
        isinstance(node, ast.ImportFrom) and node.module == "services.storage.base"
        or isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "config" for target in node.targets
        )
    )]
    namespace = {"__file__": str(source), "__name__": __name__}
    exec(compile(tree, str(source), "exec"), namespace)
    namespace["DATA_DIR"] = tmp_path
    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "offline-test-admin")
    return namespace["ConfigStore"](tmp_path / "settings.json")


@pytest.mark.parametrize("raw,expected", [
    (1, 1), (2, 2), (8, 8), ("4", 4), (" 3 ", 3),
    (None, 2), (0, 2), (-1, 2), (9, 2), (999999, 2),
    (True, 2), (False, 2), (1.0, 2), (2.9, 2),
    (float("nan"), 2), (float("inf"), 2),
    ("", 2), ("abc", 2), ("2.5", 2), ("9", 2), ([], 2), ({}, 2),
])
def test_config_getter_and_save_normalize(store, raw: object, expected: int) -> None:
    store.data["image_task_concurrency"] = raw
    assert store.image_task_concurrency == expected
    assert store.get()["image_task_concurrency"] == expected
    result = store.update({"image_task_concurrency": raw})
    assert type(result["image_task_concurrency"]) is int
    assert result["image_task_concurrency"] == expected
    assert json.loads(store.path.read_text(encoding="utf-8"))["image_task_concurrency"] == expected


def test_missing_config_defaults_and_master_switch(store) -> None:
    assert store.image_task_concurrency == 2
    assert store.get()["image_parallel_generation"] is True
    assert store.get()["image_task_concurrency"] == 2
    store.update({"image_parallel_generation": False, "image_task_concurrency": 4})
    assert store.get()["image_parallel_generation"] is False
    assert store.get()["image_task_concurrency"] == 4


def _pool(store, generate: Callable, executor: Callable = ThreadPoolExecutor) -> dict:
    return _definitions("services/protocol/conversation.py", {
        "ImageGenerationError", "stream_image_outputs_with_pool",
    }, {
        "config": store, "_generate_single_image": generate,
        "ThreadPoolExecutor": executor, "as_completed": as_completed,
        "is_supported_image_model": lambda model: True,
        "image_stream_error_message": str, "logger": Mock(),
    })


@pytest.mark.parametrize("n,cap,parallel,expected", [
    (1, 2, True, 1), (4, 2, True, 2), (4, 1, True, 1),
    (2, 8, True, 2), (4, 8, False, 1), (4, "invalid", True, 2),
])
def test_worker_cap_and_order(store, n: int, cap: object, parallel: bool, expected: int) -> None:
    store.data.update(image_task_concurrency=cap, image_parallel_generation=parallel)
    lock = threading.Lock()
    barrier = threading.Barrier(expected)
    active = peak = 0
    called: list[tuple[int, int]] = []
    workers: list[int] = []

    def executor(*, max_workers: int) -> ThreadPoolExecutor:
        workers.append(max_workers)
        return ThreadPoolExecutor(max_workers=max_workers)

    def generate(request, index: int, total: int) -> list[int]:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            called.append((index, total))
        try:
            if index <= expected:
                barrier.wait(timeout=5)
            return [index]
        finally:
            with lock:
                active -= 1

    namespace = _pool(store, generate, executor)
    result = list(namespace["stream_image_outputs_with_pool"](SimpleNamespace(n=n, model="gpt-image-2")))
    assert result == list(range(1, n + 1))
    assert peak == expected
    assert sorted(called) == [(index, n) for index in range(1, n + 1)]
    assert workers == ([expected] if n > 1 and parallel else [])


def test_finished_worker_refills_queue_without_waiting_for_slow_first(store) -> None:
    store.data["image_task_concurrency"] = 2
    third_started = threading.Event()
    completed: list[int] = []

    def generate(request, index: int, total: int) -> list[int]:
        if index == 1:
            assert third_started.wait(timeout=5), "queue waited for whole first batch"
        elif index == 3:
            third_started.set()
        completed.append(index)
        return [index]

    namespace = _pool(store, generate)
    assert list(namespace["stream_image_outputs_with_pool"](SimpleNamespace(n=4, model="gpt-image-2"))) == [1, 2, 3, 4]
    assert completed.index(2) < completed.index(1)
    assert completed.index(3) < completed.index(1)


@pytest.mark.parametrize("failures", [{1}, {2, 4}, {1, 2, 3, 4}])
def test_parallel_partial_success_or_all_failed(store, failures: set[int]) -> None:
    called: list[int] = []

    def generate(request, index: int, total: int) -> list[int]:
        called.append(index)
        if index in failures:
            raise RuntimeError(f"failure-{index}")
        return [index]

    namespace = _pool(store, generate)
    outputs = namespace["stream_image_outputs_with_pool"](SimpleNamespace(n=4, model="gpt-image-2"))
    if len(failures) == 4:
        with pytest.raises(namespace["ImageGenerationError"], match="failure-4"):
            list(outputs)
    else:
        assert list(outputs) == [i for i in range(1, 5) if i not in failures]
    assert sorted(called) == [1, 2, 3, 4]


@pytest.mark.parametrize("n,parallel", [(1, True), (4, False)])
def test_direct_or_serial_exception_still_propagates(store, n: int, parallel: bool) -> None:
    store.data["image_parallel_generation"] = parallel
    generate = Mock(side_effect=RuntimeError("unchanged serial failure"))
    namespace = _pool(store, generate)
    with pytest.raises(RuntimeError, match="unchanged serial failure"):
        list(namespace["stream_image_outputs_with_pool"](SimpleNamespace(n=n, model="gpt-image-2")))
    assert generate.call_count == 1


def test_settings_http_get_and_post_contract(store) -> None:
    namespace = _definitions("api/system.py", {"SettingsUpdateRequest"}, {
        "BaseModel": BaseModel, "ConfigDict": ConfigDict,
    })
    tree = ast.parse((ROOT / "api/system.py").read_text(encoding="utf-8"))
    handlers = [node for node in ast.walk(tree) if
                isinstance(node, ast.AsyncFunctionDef) and node.name in {"get_settings", "save_settings"}]
    router = APIRouter()

    def require_admin(authorization: str | None) -> None:
        if authorization != "Bearer offline-admin":
            raise HTTPException(status_code=401)

    namespace.update(router=router, config=store, Header=Header,
                     HTTPException=HTTPException, require_admin=require_admin)
    exec(compile(ast.Module(body=handlers, type_ignores=[]), "settings-routes", "exec"), namespace)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        assert client.get("/api/settings").status_code == 401
        assert client.post("/api/settings", json={"image_task_concurrency": 4}).status_code == 401
        headers = {"Authorization": "Bearer offline-admin"}
        initial = client.get("/api/settings", headers=headers).json()["config"]
        assert initial["image_task_concurrency"] == 2
        assert initial["image_parallel_generation"] is True
        for raw, expected in [(4, 4), ("3", 3), (False, 2), (9, 2), (1.5, 2), (None, 2)]:
            response = client.post("/api/settings", headers=headers, json={
                "image_task_concurrency": raw, "image_parallel_generation": False,
            })
            assert response.status_code == 200
            config = response.json()["config"]
            assert config["image_task_concurrency"] == expected
            assert config["image_parallel_generation"] is False
            fetched = client.get("/api/settings", headers=headers).json()["config"]
            assert fetched["image_task_concurrency"] == expected
            assert fetched["image_parallel_generation"] is False
        # A partial save does not reset an existing cap or master switch.
        client.post("/api/settings", headers=headers, json={"image_task_concurrency": 8})
        final = client.post("/api/settings", headers=headers, json={}).json()["config"]
        assert final["image_task_concurrency"] == 8
        assert final["image_parallel_generation"] is False
