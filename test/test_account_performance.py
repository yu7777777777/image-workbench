import json
from copy import deepcopy
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event

from services.account_service import AccountService
from services.storage.database_storage import DatabaseStorageBackend


def make_service(tmp_path, count=100):
    backend = DatabaseStorageBackend(f"sqlite:///{tmp_path / 'accounts.db'}")
    backend.save_accounts([
        {"access_token": f"token-{i}", "email": f"{i}@example.test", "quota": 5,
         "status": "正常", "refresh_token": "private", "id_token": "private"}
        for i in range(count)
    ])
    return AccountService(backend), backend


def test_single_update_does_not_scan_or_rewrite_database(tmp_path):
    service, backend = make_service(tmp_path, 5000)
    # Persist normalization once, then measure a steady-state update.
    service.update_account("token-0", {"quota": 4}, quiet=True)
    statements = []
    event.listen(backend.engine, "before_cursor_execute",
                 lambda conn, cursor, statement, params, context, many: statements.append(statement))
    service.update_account("token-1", {"quota": 3}, quiet=True)
    assert sum(s.startswith("UPDATE") for s in statements) == 1
    assert all("WHERE" in s for s in statements if s.startswith("SELECT"))
    assert len(backend.load_accounts()) == 5000
    assert AccountService(backend).get_account("token-1")["quota"] == 3


def test_delta_deletion_nested_edit_and_failed_commit_retry(tmp_path):
    service, backend = make_service(tmp_path, 3)
    service._accounts["token-0"]["limits_progress"] = [{"remaining": 4}]
    service._save_accounts()
    service._accounts["token-0"]["limits_progress"][0]["remaining"] = 2
    before = deepcopy(service._persisted_accounts)
    with patch.object(backend, "save_account_changes", side_effect=RuntimeError("disk failure")):
        with pytest.raises(RuntimeError):
            service._save_accounts()
    assert service._persisted_accounts == before
    service._save_accounts()
    service.delete_accounts(["token-1"])
    saved = {a["access_token"]: a for a in backend.load_accounts()}
    assert set(saved) == {"token-0", "token-2"}
    assert saved["token-0"]["limits_progress"][0]["remaining"] == 2


def test_delta_rotation_is_atomic(tmp_path):
    service, backend = make_service(tmp_path, 2)
    rotated = dict(service._accounts.pop("token-0"), access_token="rotated")
    service._accounts["rotated"] = rotated
    service._save_accounts()
    assert {a["access_token"] for a in backend.load_accounts()} == {"rotated", "token-1"}


def test_compact_accounts_and_endpoint_auth(tmp_path):
    from api import accounts
    service, _ = make_service(tmp_path, 2)
    with patch.object(accounts, "account_service", service):
        app = FastAPI()
        app.include_router(accounts.create_router())
        client = TestClient(app)
        assert client.get('/api/accounts?compact=true').status_code == 401
        with patch.object(accounts, 'require_admin'):
            compact = client.get('/api/accounts?compact=true').json()['items']
            full = client.get('/api/accounts').json()['items']
            assert len(compact) == len(full) == 2
            assert compact[0]['access_token'] == full[0]['access_token']
            assert 'refresh_token' not in compact[0]
            assert full[0]['refresh_token'] == 'private'
            assert compact[0]['image_inflight'] == 0
            assert compact[0]['created_at'] == full[0]['created_at']


def test_completed_progress_is_bounded_without_removing_running_tasks(tmp_path):
    service, _ = make_service(tmp_path)
    service._refresh_progress = {}
    service.init_refresh_progress('running', 1)
    for i in range(20):
        service.init_refresh_progress(str(i), 1)
        service.finish_refresh_progress(str(i), {'items': service.list_accounts()})
    assert service.get_refresh_progress('running')['done'] is False
    assert service.get_refresh_progress('19')['done'] is True
    assert len(service._refresh_progress) <= 17


def test_account_stats_cache_invalidates_after_account_update(tmp_path):
    service, _ = make_service(tmp_path, 2)
    first = service.get_stats()
    assert first["total_quota"] == 10
    assert service.get_stats() == first
    service.update_account("token-0", {"quota": 1}, quiet=True)
    assert service.get_stats()["total_quota"] == 6
