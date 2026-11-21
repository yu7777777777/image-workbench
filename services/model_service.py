from __future__ import annotations

import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError, as_completed
from dataclasses import dataclass
from threading import RLock
from typing import Any

from services.account_service import AccountService, account_service
from services.openai_backend_api import OpenAIBackendAPI
from utils.log import logger


@dataclass(frozen=True)
class ModelRoute:
    account_types: frozenset[str]
    allow_anonymous: bool = False


class ModelUnavailableError(RuntimeError):
    pass


class ModelCatalogService:
    """Caches the model catalogs advertised to each active account type."""

    _MAX_ACCOUNT_PROBES = 3
    _MODEL_ACCOUNT_SOURCES = {"oauth_login", "password", "web"}

    def __init__(
        self,
        accounts: AccountService,
        *,
        backend_factory: Callable[..., Any] = OpenAIBackendAPI,
        cache_ttl_seconds: float = 300,
        foreground_wait_seconds: float = 12,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._accounts = accounts
        self._backend_factory = backend_factory
        self._cache_ttl_seconds = max(1.0, float(cache_ttl_seconds))
        self._clock = clock
        self._foreground_wait_seconds = max(0.01, foreground_wait_seconds)
        self._lock = RLock()
        self._refresh_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model-catalog")
        self._refresh_future: Future[None] | None = None
        self._expires_at = 0.0
        self._account_signature: tuple[tuple[str, int], ...] = ()
        self._anonymous_models: dict[str, dict[str, Any]] = {}
        self._models_by_account_type: dict[str, dict[str, dict[str, Any]]] = {}

    @staticmethod
    def _model_map(result: object) -> dict[str, dict[str, Any]]:
        if not isinstance(result, dict) or not isinstance(result.get("data"), list):
            raise TypeError("upstream model response has no data list")
        models: dict[str, dict[str, Any]] = {}
        for item in result["data"]:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if model_id and model_id not in models:
                models[model_id] = dict(item)
        return models

    def _active_accounts_by_type(self) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for account in self._accounts.list_accounts():
            if not isinstance(account, dict) or account.get("status") in {"禁用", "异常"}:
                continue
            access_token = str(account.get("access_token") or "").strip()
            account_type = self._accounts._normalize_account_type(account.get("type"))
            source_type = self._accounts._normalize_source_type(account.get("source_type"))
            remaining = self._accounts._token_expires_in(access_token)
            if (access_token and account_type and source_type in self._MODEL_ACCOUNT_SOURCES
                    and (remaining is None or remaining > 0)):
                groups.setdefault(account_type, []).append(access_token)
        for tokens in groups.values():
            tokens.sort(key=lambda token: (
                self._accounts._token_needs_refresh(token),
                -(self._accounts._token_expires_in(token) or 0),
            ))
        return groups

    @staticmethod
    def _signature(groups: dict[str, list[str]]) -> tuple[tuple[str, int], ...]:
        return tuple(
            (account_type, len(tokens))
            for account_type, tokens in sorted(groups.items())
        )

    def _fetch_models(self, access_token: str = "") -> dict[str, dict[str, Any]]:
        backend = self._backend_factory(access_token=access_token)
        try:
            return self._model_map(backend.list_models())
        finally:
            backend.close()

    def _fetch_account_type_models(
        self,
        account_type: str,
        access_tokens: list[str],
    ) -> dict[str, dict[str, Any]] | None:
        attempted_tokens: set[str] = set()
        last_error: Exception | None = None
        for access_token in access_tokens[: self._MAX_ACCOUNT_PROBES]:
            try:
                # A read of the catalog must not start OAuth rotation for a
                # large pool. Expired tokens are handled by the refresh service.
                resolved_token = self._accounts.resolve_access_token(access_token)
                if resolved_token in attempted_tokens:
                    continue
                attempted_tokens.add(resolved_token)
                return self._fetch_models(resolved_token)
            except Exception as exc:  # noqa: BLE001 - try the next account for any upstream failure
                last_error = exc
        if last_error is not None:
            logger.warning({
                "event": "model_catalog_account_type_failed",
                "account_type": account_type,
                "error_type": type(last_error).__name__,
            })
        return None

    def _refresh(self, groups: dict[str, list[str]], signature: tuple[tuple[str, int], ...]) -> None:
        with ThreadPoolExecutor(max_workers=min(4, len(groups) + 1)) as executor:
            anonymous_future = executor.submit(self._fetch_models)
            account_futures = {
                account_type: executor.submit(
                    self._fetch_account_type_models,
                    account_type,
                    access_tokens,
                )
                for account_type, access_tokens in groups.items()
            }
            future_types = {future: account_type for account_type, future in account_futures.items()}
            for future in as_completed([anonymous_future, *future_types]):
                try:
                    models = future.result()
                except Exception as exc:  # noqa: BLE001 - retain cached models on upstream failure
                    logger.warning({"event": "model_catalog_fetch_failed", "error_type": type(exc).__name__})
                    continue
                if models is not None:
                    with self._lock:
                        if future is anonymous_future:
                            self._anonymous_models = models
                        else:
                            self._models_by_account_type[future_types[future]] = models

        with self._lock:
            self._account_signature = signature
            self._expires_at = self._clock() + self._cache_ttl_seconds

    def _ensure_catalog(self) -> None:
        groups = self._active_accounts_by_type()
        signature = self._signature(groups)
        with self._lock:
            if signature == self._account_signature and self._clock() < self._expires_at:
                return
            # Share one refresh, retain the previous catalog on timeout, and
            # never hold the read lock across upstream network requests.
            for account_type in set(self._models_by_account_type) - groups.keys():
                self._models_by_account_type.pop(account_type, None)
            if self._refresh_future is None or self._refresh_future.done():
                self._refresh_future = self._refresh_executor.submit(self._refresh, groups, signature)
            future = self._refresh_future
        try:
            future.result(timeout=self._foreground_wait_seconds)
        except TimeoutError:
            with self._lock:
                if not self._anonymous_models and not self._models_by_account_type:
                    raise RuntimeError("上游模型列表暂时不可用，请稍后重试") from None

    def list_models(self) -> dict[str, Any]:
        self._ensure_catalog()
        with self._lock:
            union: dict[str, dict[str, Any]] = {
                model_id: dict(item)
                for model_id, item in self._anonymous_models.items()
            }
            for account_type in sorted(self._models_by_account_type):
                for model_id, item in self._models_by_account_type[account_type].items():
                    union.setdefault(model_id, dict(item))
        return {
            "object": "list",
            "data": [union[model_id] for model_id in sorted(union)],
        }

    def route_for_model(self, model: str) -> ModelRoute:
        model = str(model or "").strip()
        self._ensure_catalog()
        with self._lock:
            account_types = frozenset(
                account_type
                for account_type, models in self._models_by_account_type.items()
                if model in models
            )
            return ModelRoute(
                account_types=account_types,
                allow_anonymous=model in self._anonymous_models,
            )


model_catalog_service = ModelCatalogService(account_service)
