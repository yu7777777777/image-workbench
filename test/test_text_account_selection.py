"""Text account routing regressions without production config, storage, or network."""
from __future__ import annotations

import ast
import base64
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from threading import Lock
import sys
import time
from types import ModuleType, SimpleNamespace
from typing import Any, Iterator

import pytest


def load_account_service() -> type:
    tree = ast.parse(Path("services/account_service.py").read_text(encoding="utf-8-sig"))
    source = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "AccountService")
    methods = {"get_text_access_token", "_account_matches_source_type", "_normalize_source_type",
               "_normalize_account_type", "_image_preflight_is_fresh", "_parse_time",
               "_decode_jwt_payload", "_jwt_exp", "_token_expires_in", "_token_needs_refresh"}
    selected = ast.ClassDef(name="AccountService", bases=[], keywords=[], decorator_list=[],
                            body=[node for node in source.body
                                  if isinstance(node, ast.FunctionDef) and node.name in methods
                                  or isinstance(node, ast.Assign) and any(
                                      isinstance(target, ast.Name) and target.id == "_ACCESS_TOKEN_REFRESH_SKEW_SECONDS"
                                      for target in node.targets)])
    namespace = {"datetime": datetime, "timezone": timezone, "time": time,
                 "config": SimpleNamespace(image_preflight_cache_secs=300)}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[selected], type_ignores=[])),
                 "isolated_text_account_service", "exec"), namespace)
    return namespace["AccountService"]


def account(name: str, source: object = "web", *, age: int | None = None,
            expires_in: int = 172800, plan: str = "free", status: str = "正常",
            refresh_token: str = "") -> dict[str, Any]:
    payload = json.dumps({"name": name, "exp": int(time.time()) + expires_in}).encode()
    token = "test." + base64.urlsafe_b64encode(payload).decode().rstrip("=") + ".signature"
    item = {"access_token": token, "source_type": source, "type": plan,
            "status": status, "quota": 0, "refresh_token": refresh_token}
    if age is not None:
        item["last_account_refresh_at"] = (datetime.now(timezone.utc) - timedelta(seconds=age)).isoformat()
    return item


@pytest.fixture
def service_factory() -> Iterator[Any]:
    instances = []

    def create(items: list[dict[str, Any]]) -> Any:
        service_type = load_account_service()
        service = service_type.__new__(service_type)
        service._lock = Lock()
        service._accounts = {item["access_token"]: deepcopy(item) for item in items}
        service._index = 0
        service.refreshed = []

        def refresh(token: str, *, event: str) -> str:
            assert event == "get_text_access_token"
            service.refreshed.append(token)
            return token

        def forbidden(*args: Any, **kwargs: Any) -> None:
            pytest.fail("Text selection must not delete accounts or persist data")

        service.refresh_access_token = refresh
        service.delete_accounts = forbidden
        service.remove_invalid_token = forbidden
        service._save_accounts = forbidden
        service.storage = SimpleNamespace(save_accounts=forbidden, save_account_changes=forbidden)
        instances.append((service, deepcopy(service._accounts)))
        return service

    yield create
    for service, snapshot in instances:
        assert service._accounts == snapshot


@pytest.mark.parametrize("source", ["oauth_login", "password", "web", None, "", "  ", " WEB "])
def test_text_candidates_only_include_web_compatible_sources(service_factory: Any, source: object) -> None:
    web = account("compatible", source)
    codex = account("codex", "codex", age=0)
    other = account("unknown", "unrecognized", age=0)
    service = service_factory([codex, other, web])
    assert service.get_text_access_token() == web["access_token"]
    assert service.refreshed == [web["access_token"]]


def test_missing_legacy_source_defaults_to_web(service_factory: Any) -> None:
    legacy = account("legacy")
    legacy.pop("source_type")
    service = service_factory([account("codex", "CODEX"), legacy])
    assert service.get_text_access_token() == legacy["access_token"]


def test_fresh_accounts_are_preferred_and_round_robin_is_preserved(service_factory: Any) -> None:
    stale = account("stale", age=3600)
    first = account("fresh-1", "oauth_login", age=0)
    second = account("fresh-2", "password", age=60)
    service = service_factory([stale, first, second])
    assert [service.get_text_access_token() for _ in range(4)] == [
        first["access_token"], second["access_token"], first["access_token"], second["access_token"],
    ]


@pytest.mark.parametrize("stamp", [None, "invalid", "expired", "future"])
def test_no_fresh_account_preserves_round_robin_fallback(service_factory: Any, stamp: object) -> None:
    first = account("first")
    if stamp == "invalid":
        first["last_account_refresh_at"] = "not-a-time"
    elif stamp == "expired":
        first["last_account_refresh_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    elif stamp == "future":
        first["last_account_refresh_at"] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    second = account("second", age=3600)
    service = service_factory([first, second])
    assert service.get_text_access_token() == first["access_token"]
    assert service.get_text_access_token() == second["access_token"]


def test_usable_credentials_take_priority_over_fresh_but_refresh_needed(service_factory: Any) -> None:
    usable = account("usable-stale", age=3600)
    needs_refresh = account("refresh-needed-fresh", age=0, expires_in=3600, refresh_token="synthetic-refresh")
    service = service_factory([needs_refresh, usable])
    assert service.get_text_access_token() == usable["access_token"]


def test_refresh_needed_pool_still_prefers_fresh_if_no_usable_credentials(service_factory: Any) -> None:
    stale = account("needs-refresh-stale", age=3600, expires_in=3600)
    fresh = account("needs-refresh-fresh", age=0, expires_in=3600)
    service = service_factory([stale, fresh])
    assert service.get_text_access_token() == fresh["access_token"]


def test_excluding_fresh_account_falls_back_without_changing_exclusion_set(service_factory: Any) -> None:
    fresh = account("fresh", age=0)
    stale = account("stale", age=3600)
    excluded = {fresh["access_token"]}
    service = service_factory([fresh, stale])
    assert service.get_text_access_token(excluded) == stale["access_token"]
    assert excluded == {fresh["access_token"]}
    assert service.get_text_access_token({fresh["access_token"], stale["access_token"]}) == ""


def install_route(monkeypatch: pytest.MonkeyPatch, *, plans: set[str], anonymous: bool = False) -> type:
    class ModelUnavailableError(RuntimeError):
        pass

    module = ModuleType("services.model_service")
    module.ModelUnavailableError = ModelUnavailableError
    module.model_catalog_service = SimpleNamespace(route_for_model=lambda model: SimpleNamespace(
        account_types=plans, allow_anonymous=anonymous,
    ))
    monkeypatch.setitem(sys.modules, "services.model_service", module)
    return ModelUnavailableError


def test_explicit_route_keeps_plan_restrictions_before_freshness(
    service_factory: Any, monkeypatch: pytest.MonkeyPatch,
) -> None:
    install_route(monkeypatch, plans={"Plus"})
    free = account("fresh-free", age=0)
    codex = account("fresh-codex-plus", "codex", age=0, plan="Plus")
    plus = account("stale-web-plus", age=3600, plan="plus")
    service = service_factory([free, codex, plus])
    assert service.get_text_access_token(model="explicit-plus") == plus["access_token"]


@pytest.mark.parametrize("anonymous", [False, True])
def test_explicit_route_empty_pool_keeps_anonymous_or_error_behavior(
    service_factory: Any, monkeypatch: pytest.MonkeyPatch, anonymous: bool,
) -> None:
    error = install_route(monkeypatch, plans={"Plus"}, anonymous=anonymous)
    service = service_factory([account("codex-plus", "codex", plan="Plus"), account("web-free")])
    if anonymous:
        assert service.get_text_access_token(model="explicit-plus") == ""
    else:
        with pytest.raises(error, match="not available to any active account"):
            service.get_text_access_token(model="explicit-plus")
    assert service.refreshed == []


def test_disabled_abnormal_and_expired_unrefreshable_accounts_stay_excluded(service_factory: Any) -> None:
    candidates = [account("disabled", status="禁用", age=0), account("abnormal", status="异常", age=0),
                  account("expired", age=0, expires_in=-3600), account("healthy", age=3600)]
    service = service_factory(candidates)
    assert service.get_text_access_token() == candidates[-1]["access_token"]


def test_all_codex_or_expired_accounts_allow_anonymous_without_removal(service_factory: Any) -> None:
    service = service_factory([account("codex", "codex"), account("expired", expires_in=-3600)])
    assert service.get_text_access_token() == ""
    assert service.refreshed == []


def test_failed_refresh_keeps_accounts_and_bounds_attempts(service_factory: Any) -> None:
    items = [account(str(index), expires_in=-3600, refresh_token="synthetic-refresh") for index in range(5)]
    service = service_factory(items)
    with pytest.raises(RuntimeError, match="账号未删除"):
        service.get_text_access_token()
    assert service.refreshed == [item["access_token"] for item in items[:3]]


def test_rotated_token_in_exclusion_set_is_not_returned(service_factory: Any) -> None:
    first, second = account("first"), account("second")
    service = service_factory([first, second])
    service.refresh_access_token = lambda token, **kwargs: "excluded-rotated" if token == first["access_token"] else token
    assert service.get_text_access_token({"excluded-rotated"}) == second["access_token"]
