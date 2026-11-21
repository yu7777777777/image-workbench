from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import shared_image_proxy


def test_shared_image_proxy_forwards_json_and_preserves_upstream_error(monkeypatch) -> None:
    profiles = [{
        "id": "image",
        "name": "Shared image",
        "role": "image",
        "provider": "openai",
        "base_url": "https://sub.example/v1",
        "api_key": "shared-secret",
        "model": "gpt-image-2-auto",
        "enabled": True,
    }]
    monkeypatch.setattr(shared_image_proxy.config, "get_shared_profiles", lambda enabled_only=False: profiles)

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 502
        content = b'{"error":{"message":"upstream forbidden"}}'
        headers = {"content-type": "application/json"}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured["headers"] = kwargs["headers"]
        captured["body"] = kwargs["data"]
        return FakeResponse()

    monkeypatch.setattr(shared_image_proxy.requests, "post", fake_post)
    app = FastAPI()
    app.include_router(shared_image_proxy.create_router())

    payload = {"model": "gpt-image-2-auto", "prompt": "a test image"}
    with TestClient(app) as client:
        response = client.post(
            "/api-proxy/images/generations",
            headers={"Authorization": "Bearer shared-secret"},
            json=payload,
        )

    assert response.status_code == 502
    assert response.json()["error"]["message"] == "upstream forbidden"
    assert captured["url"] == "https://sub.example/v1/images/generations"
    assert captured["headers"]["Authorization"] == "Bearer shared-secret"
    assert json.loads(captured["body"].decode("utf-8")) == payload


def test_shared_image_proxy_rejects_unknown_key(monkeypatch) -> None:
    monkeypatch.setattr(shared_image_proxy.config, "get_shared_profiles", lambda enabled_only=False: [])
    app = FastAPI()
    app.include_router(shared_image_proxy.create_router())
    with TestClient(app) as client:
        response = client.post(
            "/api-proxy/images/generations",
            headers={"Authorization": "Bearer invalid"},
            json={"model": "gpt-image-2-auto", "prompt": "test"},
        )
    assert response.status_code == 403
