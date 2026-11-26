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

def test_managed_shared_routes_keep_credentials_on_the_server(monkeypatch) -> None:
    import json
    from fastapi.responses import Response

    profiles = [
        {"id": "drawing", "name": "Drawing", "role": "image", "provider": "openai",
         "base_url": "https://images.example/v1", "api_key": "image-secret", "model": "image-model",
         "description": "", "group": "", "enabled": True},
        {"id": "writing", "name": "Writing", "role": "chat", "provider": "custom",
         "base_url": "https://text.example", "api_key": "text-secret", "model": "text-model",
         "description": "", "group": "", "enabled": True},
    ]
    calls = []

    async def forward(url, method, body, headers, *, stream=False):
        calls.append((url, method, body, headers, stream))
        return Response("data: {}\n\n" if stream else '{"ok":true}', media_type="text/event-stream" if stream else "application/json")

    def identity(auth):
        if auth != "Bearer site-session":
            raise shared_image_proxy.HTTPException(401)
        return {"id": "user-1", "role": "user"}

    monkeypatch.setattr(shared_image_proxy.config, "get_shared_profiles", lambda enabled_only=False: profiles)
    monkeypatch.setattr(shared_image_proxy, "require_identity", identity)
    monkeypatch.setattr(shared_image_proxy, "_forward_managed", forward)
    app = FastAPI()
    app.include_router(shared_image_proxy.create_router())
    headers = {"Authorization": "Bearer site-session"}
    with TestClient(app) as client:
        base = "/v1/workbench/shared/"
        assert client.post(base + "drawing/images/generations", json={"model": "image-model"}).status_code == 401
        assert client.post(base + "drawing/images/generations", headers=headers, json={"model": "wrong"}).status_code == 403
        assert client.post(base + "writing/images/generations", headers=headers, json={"model": "text-model"}).status_code == 403
        assert client.post(base + "drawing/images/generations", headers=headers, json={"model": "image-model"}).status_code == 200
        assert client.post(base + "drawing/images/edits", headers=headers, data={"model": "image-model"}, files={"image": ("ref.png", b"image")}).status_code == 200
        assert client.post(base + "writing/chat/completions", headers=headers, json={"model": "text-model"}).status_code == 200
        stream = client.post(base + "writing/responses", headers=headers, json={"model": "text-model", "stream": True})
        assert stream.text == "data: {}\n\n"
    assert [call[0] for call in calls] == [
        "https://images.example/v1/images/generations", "https://images.example/v1/images/edits",
        "https://text.example/v1/chat/completions", "https://text.example/v1/responses",
    ]
    assert [call[3]["Authorization"] for call in calls] == ["Bearer image-secret"] * 2 + ["Bearer text-secret"] * 2
    assert b"image" in calls[1][2]
    assert calls[-1][-1] is True
    catalog = json.dumps(shared_image_proxy.managed_shared_profiles())
    assert "secret" not in catalog and "example" not in catalog
    assert "generate_image" in catalog and "run_agent" in catalog


def test_managed_fal_queue_is_bound_to_owner_and_configured_app(monkeypatch) -> None:
    from fastapi.responses import JSONResponse

    calls = []

    async def forward(url, method, body, headers, *, stream=False):
        calls.append((url, method, headers["Authorization"]))
        return JSONResponse({"request_id": "upstream-job", "status": "COMPLETED"})

    profile = {"id": "fal", "role": "image", "provider": "fal", "base_url": "https://fal.run",
               "model": "openai/gpt-image-2", "api_key": "server-key"}
    monkeypatch.setattr(shared_image_proxy.config, "get_shared_profiles", lambda enabled_only=False: [profile])
    monkeypatch.setattr(shared_image_proxy, "require_identity", lambda key: {"id": key, "role": "user"})
    monkeypatch.setattr(shared_image_proxy, "_forward_managed", forward)

    app = FastAPI()
    app.include_router(shared_image_proxy.create_router())
    with TestClient(app) as client:
        endpoint = "/v1/workbench/shared/fal/fal"
        app_url = "https://queue.fal.run/openai/gpt-image-2"
        headers = {"Authorization": "Bearer owner-a", "X-Fal-Target-Url": app_url}
        response = client.post(endpoint, headers=headers, json={"prompt": "test"})
        assert response.status_code == 200
        ticket = response.json()["request_id"]
        assert ticket != "upstream-job"
        headers["X-Fal-Target-Url"] = f"{app_url}/requests/{ticket}/status?logs=1"
        assert client.get(endpoint, headers={**headers, "Authorization": "Bearer owner-b"}).status_code == 403
        assert client.get(endpoint, headers=headers).status_code == 200
        headers["X-Fal-Target-Url"] = f"{app_url}/requests/{ticket}/cancel"
        assert client.put(endpoint, headers=headers).status_code == 200

    assert calls == [
        (app_url, "POST", "Key server-key"),
        (app_url + "/requests/upstream-job/status?logs=1", "GET", "Key server-key"),
        (app_url + "/requests/upstream-job/cancel", "PUT", "Key server-key"),
    ]
