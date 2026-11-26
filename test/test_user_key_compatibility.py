from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import accounts, support, system
from services.auth_service import AuthService
from services.storage.json_storage import JSONStorageBackend

LEGACY_KEY = "历史密钥-123"
NEW_KEY = "local-user-123!@"
ADMIN_HEADERS = {"Authorization": "Bearer isolated-test-admin"}


@pytest.fixture
def isolated_auth(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "isolated-test-admin")
    storage = JSONStorageBackend(tmp_path / "accounts.json")
    storage.save_auth_keys([{
        "id": "legacy-account",
        "name": "兼容测试用户",
        "role": "user",
        "enabled": True,
        "key_hash": hashlib.sha256(LEGACY_KEY.encode("utf-8")).hexdigest(),
    }])
    service = AuthService(storage)
    monkeypatch.setattr(accounts, "auth_service", service)
    monkeypatch.setattr(support, "auth_service", service)
    app = FastAPI()
    app.include_router(accounts.create_router())
    app.include_router(system.create_router("test"))
    with TestClient(app) as client:
        yield client, storage


@pytest.mark.parametrize("invalid", ["新密钥123", "clé-test", "key🔑123", "ascii\tcontrol", "ascii\r\nheader", "delete\x7fcharacter"])
def test_admin_cannot_save_non_printable_ascii_keys(isolated_auth, invalid: str):
    client, storage = isolated_auth
    old_hash = storage.load_auth_keys()[0]["key_hash"]
    response = client.post("/api/auth/users/legacy-account", headers=ADMIN_HEADERS, json={
        "name": "不应保存的名称", "key": invalid,
    })
    assert response.status_code == 400
    assert "ASCII" in response.json()["detail"]["error"]
    saved = storage.load_auth_keys()[0]
    assert saved["key_hash"] == old_hash
    assert saved["name"] == "兼容测试用户"


def test_generated_keys_and_standard_bearer_rotation(isolated_auth):
    client, _ = isolated_auth
    created = client.post("/api/auth/users", headers=ADMIN_HEADERS, json={"name": "新账号"})
    assert created.status_code == 200
    old = created.json()["key"]
    assert old.isascii()
    headers = {"Authorization": f"Bearer {old}"}
    response = client.post("/auth/login", headers={**headers, "Content-Type": "text/plain"}, content="legacy-client")
    assert response.json()["subject_id"] == created.json()["item"]["id"]
    invalid = client.post("/api/auth/self/profile", headers=headers, json={
        "old_key": old, "new_key": "新的非ASCII密钥",
    })
    assert invalid.status_code == 400
    assert "ASCII" in invalid.json()["detail"]["error"]
    valid = client.post("/api/auth/self/profile", headers=headers, json={"old_key": old, "new_key": NEW_KEY})
    assert valid.status_code == 200
    assert client.post("/auth/login", headers=headers).status_code == 401
    assert client.post("/auth/login", headers={"Authorization": f"Bearer {NEW_KEY}"}).status_code == 200


def test_legacy_json_login_and_rotation_preserve_identity(isolated_auth):
    client, _ = isolated_auth
    logged_in = client.post("/auth/login", json={"key": LEGACY_KEY})
    assert logged_in.status_code == 200
    assert logged_in.json()["subject_id"] == "legacy-account"
    assert client.post("/auth/login", json={"key": LEGACY_KEY}, headers={"Authorization": "Bearer invalid"}).status_code == 401
    assert client.post("/auth/login", json={"key": "isolated-test-admin"}).status_code == 401
    assert client.post("/api/auth/self/profile", json={"old_key": LEGACY_KEY, "name": "不允许通过此方式改名"}).status_code == 401
    assert client.post("/api/auth/self/profile", json={"old_key": "错误密钥", "new_key": NEW_KEY}).status_code == 401

    invalid = client.post("/api/auth/self/profile", json={"old_key": LEGACY_KEY, "new_key": "继续用中文密钥"})
    assert invalid.status_code == 400
    assert "ASCII" in invalid.json()["detail"]["error"]
    updated = client.post("/api/auth/self/profile", json={"old_key": LEGACY_KEY, "new_key": NEW_KEY})
    assert updated.status_code == 200
    assert updated.json()["user"]["id"] == "legacy-account"
    assert client.post("/auth/login", json={"key": LEGACY_KEY}).status_code == 401
    assert client.post("/auth/login", json={"key": NEW_KEY}).status_code == 401
    assert client.post("/auth/login", headers={"Authorization": f"Bearer {NEW_KEY}"}).json()["subject_id"] == "legacy-account"


def test_admin_rotation_rejects_unicode_before_writing_configuration(isolated_auth):
    client, _ = isolated_auth
    response = client.post("/api/auth/self/profile", headers=ADMIN_HEADERS, json={
        "old_key": "isolated-test-admin", "new_key": "管理员中文密钥",
    })
    assert response.status_code == 400
    assert "ASCII" in response.json()["detail"]["error"]
    assert client.post("/auth/login", headers=ADMIN_HEADERS).json()["role"] == "admin"

def test_legacy_admin_key_does_not_break_user_key_rotation(isolated_auth, monkeypatch: pytest.MonkeyPatch):
    client, _ = isolated_auth
    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "旧管理员密钥")
    assert client.post("/auth/login", json={"key": "旧管理员密钥"}).json()["role"] == "admin"
    # A pre-existing Unicode administrator key must not break comparison when a user rotates.
    legacy_login = client.post("/api/auth/self/profile", json={"old_key": LEGACY_KEY, "new_key": NEW_KEY})
    assert legacy_login.status_code == 200
    assert client.post("/auth/login", headers={"Authorization": f"Bearer {NEW_KEY}"}).json()["subject_id"] == "legacy-account"

def test_existing_latin1_bearer_key_stays_usable(isolated_auth, monkeypatch: pytest.MonkeyPatch):
    client, storage = isolated_auth
    key = "clé-historique"
    [record] = storage.load_auth_keys()
    record["key_hash"] = hashlib.sha256(key.encode("utf-8")).hexdigest()
    storage.save_auth_keys([record])
    # A fresh service loads the historical key just as it would at startup.
    monkeypatch.setattr(support, "auth_service", AuthService(storage))
    assert client.post("/auth/login", json={"key": key}).status_code == 401
    # TestClient re-encodes headers as UTF-8. Check the value FastAPI receives from ASGI's Latin-1 decoding.
    assert support.require_identity(f"Bearer {key}")["id"] == "legacy-account"
