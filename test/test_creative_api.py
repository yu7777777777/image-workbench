import base64
import io
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from api import support
from api.creative import create_router


def test_creative_items_and_covers_are_admin_only(tmp_path, monkeypatch):
    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "creative-test-admin")
    monkeypatch.setattr(support.auth_service, "authenticate", lambda token: (
        {"id": "user", "role": "user"} if token == "creative-test-user" else None
    ))
    app = FastAPI()
    app.include_router(create_router(tmp_path / "creative.db"))
    client = TestClient(app)
    admin = {"Authorization": "Bearer creative-test-admin"}
    user = {"Authorization": "Bearer creative-test-user"}
    image = io.BytesIO()
    Image.new("RGB", (1200, 800), "teal").save(image, "PNG")
    payload = {"kind": "prompt", "title": "胶片", "content": "低饱和\n细颗粒"}

    created = client.post("/api/creative", headers=admin, json={
        **payload, "cover": base64.b64encode(image.getvalue()).decode(),
    })
    assert created.status_code == 201
    item = created.json()
    item_path = f"/api/creative/{item['id']}"
    cover_path = f"{item_path}/cover"
    assert client.get("/api/creative?kind=prompt", headers=admin).json() == {"items": [item]}
    assert client.get("/api/creative?kind=skill", headers=admin).json() == {"items": []}
    assert client.get(item_path, headers=admin).json() == item
    cover = client.get(cover_path, headers=admin)
    assert cover.headers["content-type"] == "image/webp"
    assert Image.open(io.BytesIO(cover.content)).size == (960, 640)

    for method, path, kwargs in (
        ("GET", "/api/creative", {}), ("GET", item_path, {}), ("GET", cover_path, {}),
        ("POST", "/api/creative", {"json": payload}), ("PUT", item_path, {"json": payload}), ("DELETE", item_path, {}),
        ("PUT", f"{item_path}/favorite", {"json": {"favorite": True}}),
    ):
        assert client.request(method, path, headers=user, **kwargs).status_code == 403
        assert client.request(method, path, **kwargs).status_code == 401

    assert client.put(item_path, headers=admin, json={**payload, "title": "新标题"}).json()["has_cover"]
    assert client.get(cover_path, headers=admin).content == cover.content
    assert client.put(item_path, headers=admin, json={**payload, "cover": "not base64"}).status_code == 422
    assert not client.put(item_path, headers=admin, json={**payload, "cover": None}).json()["has_cover"]
    assert client.get(cover_path, headers=admin).status_code == 404
    assert client.delete(item_path, headers=admin).status_code == 204
    assert client.get(item_path, headers=admin).status_code == 404


def test_creative_favorites_are_owner_scoped_and_removed_with_the_item(tmp_path, monkeypatch):
    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "creative-test-admin")
    monkeypatch.setattr(support.auth_service, "authenticate", lambda token: (
        {"id": "admin-two", "role": "admin"} if token == "creative-test-admin-two" else None
    ))
    path = tmp_path / "creative.db"
    app = FastAPI()
    app.include_router(create_router(path))
    client = TestClient(app)
    admin = {"Authorization": "Bearer creative-test-admin"}
    other = {"Authorization": "Bearer creative-test-admin-two"}
    payload = {"kind": "prompt", "title": "日落", "content": "海岸上的橙色余晖"}
    item = client.post("/api/creative", headers=admin, json=payload).json()
    item_path = f"/api/creative/{item['id']}"
    favorite_path = f"{item_path}/favorite"
    favorites = "/api/creative?favorites_only=true"

    assert client.get(favorites, headers=admin).json() == {"items": []}
    for _ in range(2):
        assert client.put(favorite_path, headers=admin, json={"favorite": True}).status_code == 204
    assert client.get(f"{favorites}&kind=prompt", headers=admin).json()["items"] == [{**item, "is_favorite": True}]
    assert client.get(f"{favorites}&kind=skill", headers=admin).json() == {"items": []}
    assert client.get(favorites, headers=other).json() == {"items": []}
    assert client.get(item_path, headers=other).json()["is_favorite"] is False
    assert client.put(item_path, headers=admin, json={**payload, "title": "傍晚"}).json()["is_favorite"] is True
    assert client.put(favorite_path, headers=other, json={"favorite": True}).status_code == 204
    assert client.put(favorite_path, headers=admin, json={"favorite": False}).status_code == 204
    assert client.get(favorites, headers=admin).json() == {"items": []}
    assert len(client.get(favorites, headers=other).json()["items"]) == 1
    assert client.delete(item_path, headers=admin).status_code == 204
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT count(*) FROM creative_favorites").fetchone() == (0,)
    assert client.put(favorite_path, headers=admin, json={"favorite": True}).status_code == 404


def test_legacy_style_and_image_survive_upgrade_and_ordered_example_edits(tmp_path, monkeypatch):
    from uuid import uuid4

    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "creative-test-admin")
    admin = {"Authorization": "Bearer creative-test-admin"}
    path = tmp_path / "creative.db"
    item_id = str(uuid4())
    legacy = io.BytesIO()
    Image.new("RGB", (400, 400), "teal").save(legacy, "WEBP")
    with sqlite3.connect(path) as previous:
        previous.execute("""
            CREATE TABLE creative_items (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
                content TEXT NOT NULL, cover BLOB, updated_at TEXT NOT NULL
            )
        """)
        previous.execute("""
            CREATE TABLE creative_favorites (
                owner_id TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES creative_items(id) ON DELETE CASCADE,
                PRIMARY KEY (owner_id, item_id)
            )
        """)
        previous.execute("INSERT INTO creative_items VALUES (?, 'style', '', '低反差胶片', ?, '2026-11-27')", (item_id, legacy.getvalue()))
        previous.execute("INSERT INTO creative_favorites VALUES ('admin', ?)", (item_id,))
    app = FastAPI()
    app.include_router(create_router(path))
    client = TestClient(app)
    url = f"/api/creative/{item_id}"
    listed = client.get("/api/creative?kind=prompt&favorites_only=true", headers=admin).json()["items"]
    assert len(listed) == 1
    item = listed[0]
    assert (item["kind"], item["title"], item["display_title"], item["example_ids"]) == ("prompt", "", "低反差胶片", [item_id])
    assert client.get(f"{url}/examples/{item_id}", headers=admin).content == legacy.getvalue()
    assert client.get(f"{url}/examples/{item_id}").status_code == 401

    photo = io.BytesIO()
    Image.new("RGB", (800, 300), "orange").save(photo, "PNG")
    encoded = {"data": base64.b64encode(photo.getvalue()).decode()}
    input_data = {"kind": "prompt", "content": item["content"]}
    saved = client.put(url, headers=admin, json={**input_data, "examples": [encoded, {"id": item_id}]}).json()
    new_id, old_id = saved["example_ids"]
    assert old_id == item_id and new_id != old_id
    assert saved["title"] == "" and saved["is_favorite"]
    assert Image.open(io.BytesIO(client.get(f"{url}/cover", headers=admin).content)).size == (800, 300)
    assert client.put(url, headers=admin, json={**input_data, "examples": [{"id": old_id}, {"id": old_id}]}).status_code == 422
    assert client.get(url, headers=admin).json()["example_ids"] == [new_id, old_id]
    assert client.put(url, headers=admin, json={**input_data, "examples": [{"id": old_id}]}).json()["example_ids"] == [old_id]
    assert client.get(f"{url}/examples/{new_id}", headers=admin).status_code == 404
    assert client.get(f"{url}/cover", headers=admin).content == legacy.getvalue()
    assert client.post("/api/creative", headers=admin, json={**input_data, "examples": [encoded] * 7}).status_code == 422
