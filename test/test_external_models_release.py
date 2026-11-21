"""Check the route shipped in the release image without loading production data."""
from __future__ import annotations

import ast
from pathlib import Path

from fastapi import APIRouter, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel


def test_external_models_route_is_post_json_and_admin_only() -> None:
    source = Path(__file__).resolve().parents[1] / "api" / "system.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    handler = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "fetch_external_models_endpoint"
    )
    assert any(
        isinstance(decorator, ast.Call)
        and isinstance(decorator.func, ast.Attribute)
        and decorator.func.attr == "post"
        and decorator.args
        and isinstance(decorator.args[0], ast.Constant)
        and decorator.args[0].value == "/api/external/fetch-models"
        for decorator in handler.decorator_list
    )

    class FetchExternalModelsRequest(BaseModel):
        base_url: str = ""
        api_key: str = ""
        provider: str = "openai"

    def require_admin(authorization: str | None) -> None:
        if authorization != "Bearer test-admin":
            raise HTTPException(status_code=401)

    async def run_in_threadpool(func, *args):  # type: ignore[no-untyped-def]
        return func(*args)

    def fetch_models(base_url: str, api_key: str, provider: str) -> list[str]:
        assert (base_url, api_key, provider) == ("https://example.test/v1", "test-key", "openai")
        return ["example-model"]

    router = APIRouter()
    namespace = {
        "router": router,
        "Header": Header,
        "HTTPException": HTTPException,
        "FetchExternalModelsRequest": FetchExternalModelsRequest,
        "require_admin": require_admin,
        "run_in_threadpool": run_in_threadpool,
        "_fetch_external_models_sync": fetch_models,
    }
    exec(compile(ast.Module(body=[handler], type_ignores=[]), str(source), "exec"), namespace)
    app = FastAPI()
    app.include_router(router)

    with TestClient(app) as client:
        assert client.post("/api/external/fetch-models", json={}).status_code == 401
        response = client.post(
            "/api/external/fetch-models",
            headers={"Authorization": "Bearer test-admin"},
            json={"base_url": "https://example.test/v1", "api_key": "test-key"},
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/json")
        assert response.json() == {"models": ["example-model"]}
