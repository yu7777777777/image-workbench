from __future__ import annotations

import base64
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event
from unittest.mock import Mock

import pytest

from services.account_service import AccountService
from services.model_service import ModelCatalogService
from services.openai_backend_api import OpenAIBackendAPI
from services.storage.json_storage import JSONStorageBackend


def jwt_token(name: str, expires_in: int) -> str:
    claims = json.dumps({"exp": int(time.time()) + expires_in, "sub": name}).encode()
    return "e30." + base64.urlsafe_b64encode(claims).decode().rstrip("=") + ".signature"


@pytest.fixture
def accounts(tmp_path):
    service = AccountService(JSONStorageBackend(tmp_path / "accounts.json"))
    yield service
    service.refresh_coordinator.shutdown()


def test_image_rotation_prefers_valid_credentials_after_more_than_twenty_expired(accounts):
    expired = [jwt_token(str(index), -3600) for index in range(30)]
    valid = jwt_token("valid", 172800)
    codex = jwt_token("codex", 172800)
    accounts.add_account_items([
        {"access_token": token, "quota": 4, "source_type": "oauth_login"}
        for token in [*expired, valid]
    ] + [{"access_token": codex, "quota": 100, "source_type": "codex"}])
    accounts._index = 21  # Global rotation index must not bypass credential ranking.
    calls = []

    def fetch(token: str, *args, **kwargs):
        calls.append(token)
        assert token == valid
        return accounts.get_account(token)

    accounts.fetch_remote_info = fetch
    selected = accounts.get_available_access_token(source_type=("oauth_login", "password", "web"))
    assert selected == valid
    assert calls == [valid]
    accounts.release_image_slot(selected)
    assert not accounts._image_inflight
    assert len(accounts.list_accounts()) == 32


def test_preflight_failure_is_not_reported_as_exhausted_quota_or_leak_credentials(accounts):
    accounts.add_account_items([{"access_token": "secret-credential", "quota": 4}])

    def fail(*args, **kwargs):
        raise RuntimeError("private upstream error secret-credential")

    accounts.fetch_remote_info = fail
    with pytest.raises(RuntimeError, match="preflight failed") as error:
        accounts.get_available_access_token()
    assert "quota" not in str(error.value)
    assert "secret-credential" not in str(error.value)
    assert not accounts._image_inflight
    assert accounts.get_account("secret-credential")["quota"] == 4


def test_all_twenty_failed_probes_report_preflight_failure_with_remaining_pool(accounts):
    accounts.add_account_items([{"access_token": f"secret-{i}", "quota": 4} for i in range(25)])
    accounts.fetch_remote_info = Mock(side_effect=RuntimeError("network unavailable"))
    with pytest.raises(RuntimeError, match="preflight failed"):
        accounts.get_available_access_token()
    assert accounts.fetch_remote_info.call_count == 20
    assert not accounts._image_inflight


def test_zero_cached_quota_is_still_unavailable(accounts):
    accounts.add_account_items([{"access_token": "zero", "quota": 0}])
    accounts.fetch_remote_info = Mock(side_effect=AssertionError("no network probe expected"))
    with pytest.raises(RuntimeError, match="no available image quota"):
        accounts.get_available_access_token()
    assert not accounts._image_inflight


def test_image_cached_preflight_does_not_allow_an_expired_token(accounts):
    token = jwt_token("expired", -60)
    accounts.add_account_items([{
        "access_token": token, "quota": 4,
        "last_account_refresh_at": datetime.now(timezone.utc).isoformat(),
    }])
    accounts.fetch_remote_info = Mock(side_effect=RuntimeError("expired credential"))
    with pytest.raises(RuntimeError, match="preflight failed"):
        accounts.get_available_access_token()
    accounts.fetch_remote_info.assert_called_once()
    assert not accounts._image_inflight


def test_catalog_skips_expired_and_codex_accounts_without_rotating_oauth(accounts):
    expired = jwt_token("expired", -60)
    valid = jwt_token("valid", 172800)
    accounts.add_account_items([
        {"access_token": expired, "source_type": "oauth_login"},
        {"access_token": "codex", "source_type": "codex"},
        {"access_token": valid, "source_type": "oauth_login"},
    ])
    accounts.refresh_access_token = Mock(side_effect=AssertionError("must not rotate tokens"))
    calls = []

    def backend(access_token: str = ""):
        calls.append(access_token)
        return Mock(list_models=lambda: {"data": [{"id": "actual-model"}]})

    catalog = ModelCatalogService(accounts, backend_factory=backend)
    try:
        assert catalog.list_models()["data"] == [{"id": "actual-model"}]
        assert set(calls) == {"", valid}
        accounts.refresh_access_token.assert_not_called()
    finally:
        catalog._refresh_executor.shutdown()


def test_catalog_attempt_budget_is_independent_of_pool_size(accounts):
    accounts.add_account_items([{"access_token": f"bad-{i}"} for i in range(100)])
    calls = []

    def backend(access_token: str = ""):
        calls.append(access_token)
        return Mock(list_models=Mock(side_effect=RuntimeError("blocked upstream")))

    catalog = ModelCatalogService(accounts, backend_factory=backend)
    try:
        assert catalog.list_models()["data"] == []
        assert len([token for token in calls if token]) == 3
    finally:
        catalog._refresh_executor.shutdown()


def test_catalog_foreground_timeout_shares_refresh_and_recovers(accounts):
    entered, release = Event(), Event()
    calls = []

    def slow_models():
        calls.append("probe")
        entered.set()
        assert release.wait(5)
        return {"data": [{"id": "actual-model"}]}

    catalog = ModelCatalogService(
        accounts, backend_factory=lambda **kwargs: Mock(list_models=slow_models),
        foreground_wait_seconds=0.03,
    )
    try:
        with ThreadPoolExecutor(max_workers=4) as executor:
            jobs = [executor.submit(catalog.list_models) for _ in range(4)]
            assert entered.wait(1)
            for job in jobs:
                with pytest.raises(RuntimeError, match="暂时不可用"):
                    job.result(1)
        assert calls == ["probe"]
        release.set()
        catalog._refresh_future.result(1)
        assert catalog.list_models()["data"] == [{"id": "actual-model"}]
        assert calls == ["probe"]
    finally:
        release.set()
        catalog._refresh_executor.shutdown()


@pytest.mark.parametrize("token", ["", "authenticated-token"])
def test_backend_models_does_not_require_homepage_bootstrap(monkeypatch, token):
    backend = OpenAIBackendAPI.__new__(OpenAIBackendAPI)
    backend.access_token = token
    backend.base_url = "https://upstream.example"
    backend._bootstrap = Mock(side_effect=AssertionError("homepage must not be fetched"))
    backend._headers = Mock(return_value={})
    backend.session = Mock()
    backend.session.get.return_value.json.return_value = {"models": [{"slug": "actual-model"}]}
    monkeypatch.setattr("services.openai_backend_api.ensure_ok", lambda *args: None)
    assert backend.list_models()["data"][0]["id"] == "actual-model"
    backend._bootstrap.assert_not_called()
    assert backend.session.get.call_args.kwargs["timeout"] == 8
