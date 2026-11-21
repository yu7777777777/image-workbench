"""Validate the actual release files without loading user configuration or data."""
from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def extract(path: Path, names: set[str]) -> dict[str, object]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    selected = [node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    assert {node.name for node in selected} == names, "Release is missing shared model functionality"
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), "exec"), namespace)
    return namespace


@pytest.fixture
def shared_config() -> SimpleNamespace:
    helpers = extract(ROOT / "services/config.py", {"_normalize_bool", "_normalize_shared_profile", "_normalize_shared_profiles", "get_shared_profiles"})
    config = SimpleNamespace(data={"shared_profiles": [
        {"id": "chat", "name": "Shared chat", "role": "chat", "model": "chat-model", "api_key": "test-only"},
        {"id": "image", "name": "Shared image", "role": "image", "model": "image-model", "enabled": "true"},
        {"id": "off", "name": "Disabled", "enabled": "false"},
        {"name": ""}, None,
    ]})
    config.get_shared_profiles = lambda enabled_only=False: helpers["get_shared_profiles"](config, enabled_only)
    return config


def test_enabled_shared_models_preserve_roles(shared_config: SimpleNamespace) -> None:
    profiles = shared_config.get_shared_profiles(enabled_only=True)
    assert [(p["id"], p["role"], p["model"]) for p in profiles] == [("chat", "chat", "chat-model"), ("image", "image", "image-model")]
    assert len(shared_config.get_shared_profiles()) == 3


def test_shared_endpoint_is_json_and_requires_login(shared_config: SimpleNamespace) -> None:
    tree = ast.parse((ROOT / "api/system.py").read_text(encoding="utf-8"))
    handler = next(node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == "get_public_shared_profiles")
    router = APIRouter()

    def require_identity(authorization: str | None) -> None:
        if authorization != "Bearer test-session":
            raise HTTPException(status_code=401)

    namespace = {"router": router, "config": shared_config, "Header": Header, "require_identity": require_identity}
    exec(compile(ast.Module(body=[handler], type_ignores=[]), "shared_route", "exec"), namespace)
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        assert client.get("/api/shared-profiles").status_code == 401
        response = client.get("/api/shared-profiles", headers={"Authorization": "Bearer test-session"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert len(response.json()["shared_profiles"]) == 2
