from __future__ import annotations

import math
from collections import deque
import os
from time import monotonic
from pathlib import Path
from threading import Event, Thread

from fastapi import HTTPException, Request

from services.account_service import account_service
from services.auth_service import auth_service, can_use_auth_header
from services.config import config

BASE_DIR = Path(__file__).resolve().parents[1]
WEB_DIST_DIR = BASE_DIR / "web_dist"


def extract_bearer_token(authorization: str | None) -> str:
    scheme, _, value = str(authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return ""
    return value.strip()


def _legacy_admin_identity(token: str) -> dict[str, object] | None:
    auth_key = str(config.auth_key or "").strip()
    if auth_key and token == auth_key:
        return {"id": "admin", "name": "管理员", "role": "admin"}
    return None


def require_identity(authorization: str | None) -> dict[str, object]:
    return _require_identity_for_key(extract_bearer_token(authorization))


def require_legacy_key_identity(raw_key: str) -> dict[str, object]:
    key = raw_key.strip()
    # Only callers that cannot send their existing key as an HTTP header use the JSON path.
    return _require_identity_for_key(key if key and not can_use_auth_header(key) else "")


def _require_identity_for_key(token: str) -> dict[str, object]:
    identity = _legacy_admin_identity(token) or auth_service.authenticate(token)
    if identity is None:
        raise HTTPException(status_code=401, detail={"error": "密钥无效或已失效，请重新登录"})
    return identity


def require_auth_key(authorization: str | None) -> None:
    require_identity(authorization)


def require_admin(authorization: str | None) -> dict[str, object]:
    identity = require_identity(authorization)
    if identity.get("role") != "admin":
        raise HTTPException(status_code=403, detail={"error": "需要管理员权限才能执行这个操作"})
    return identity


def resolve_image_base_url(request: Request) -> str:
    return config.base_url or f"{request.url.scheme}://{request.headers.get('host', request.url.netloc)}"


def raise_image_quota_error(exc: Exception) -> None:
    message = str(exc)
    if "no available image quota" in message.lower():
        raise HTTPException(status_code=429, detail={"error": "no available image quota"}) from exc
    raise HTTPException(status_code=502, detail={"error": message}) from exc


def sanitize_cpa_pool(pool: dict | None) -> dict | None:
    if not isinstance(pool, dict):
        return None
    return {key: value for key, value in pool.items() if key != "secret_key"}


def sanitize_cpa_pools(pools: list[dict]) -> list[dict]:
    return [sanitized for pool in pools if (sanitized := sanitize_cpa_pool(pool)) is not None]


def sanitize_sub2api_server(server: dict | None) -> dict | None:
    if not isinstance(server, dict):
        return None
    sanitized = {key: value for key, value in server.items() if key not in {"password", "api_key"}}
    sanitized["has_api_key"] = bool(str(server.get("api_key") or "").strip())
    return sanitized


def sanitize_sub2api_servers(servers: list[dict]) -> list[dict]:
    return [sanitized for server in servers if (sanitized := sanitize_sub2api_server(server)) is not None]


def _watcher_setting(name: str, default: int, maximum: int) -> int:
    """Invalid environment settings must not disable the watcher or busy-loop."""
    try:
        value = int(os.getenv(name, str(default)))
        if 1 <= value <= maximum:
            return value
    except (TypeError, ValueError):
        pass
    print(f"[account-watcher] invalid {name}; using default {default}")
    return default


def _watcher_cycle_coverage(
    pool_size: int, interval_seconds: int, target_seconds: int, credit: float
) -> tuple[int, float, int]:
    """Return coverage, fractional credit and demand; never accrue catch-up debt."""
    if pool_size <= 0:
        return 0, 1.0, 0
    demand = pool_size * interval_seconds / (target_seconds * 0.9)
    credit += demand
    return min(pool_size, int(credit)), credit - int(credit), math.ceil(demand)


def start_limited_account_watcher(stop_event: Event) -> Thread:
    """Best-effort daily traversal, independent of per-account refresh cooldown.

    Reserve 10% of both the target horizon and each cycle for scheduling/I/O
    variance. In-flight synchronous requests cannot be interrupted: stop prevents
    new waves (at most three accounts), not the completion of an existing wave.
    """
    def worker() -> None:
        pending: deque[str] = deque()
        pass_seen: set[str] = set()
        # Fractional coverage avoids refreshing a tiny pool every 15 minutes.
        credit = 1.0
        while not stop_event.is_set():
            started = monotonic()
            interval = _watcher_setting("ACCOUNT_WATCHER_INTERVAL_MINUTE", 15, 1440) * 60
            target = _watcher_setting("ACCOUNT_WATCHER_TARGET_HOURS", 24, 8760) * 3600
            batch_size = _watcher_setting("ACCOUNT_WATCHER_BATCH_SIZE", 100, 1000)
            maximum = _watcher_setting("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", 600, 100000)
            deadline = started + interval * 0.9
            wave_seconds = 0.0
            sent = visited = 0
            try:
                tokens = account_service.list_tokens()
                pool_size = len(tokens)
                # Recalculate on every cycle, including pool growth and shrinkage.
                coverage, credit, required_per_cycle = _watcher_cycle_coverage(
                    pool_size, interval, target, credit
                )
                live = set(tokens)
                pending = deque(token for token in pending if token in live)
                pass_seen.intersection_update(live)
                pending.extend(token for token in tokens if token not in pass_seen)
                pass_seen.update(tokens)
                if not tokens:
                    credit = 1.0
                elif not pending:
                    pending.extend(tokens)
                    pass_seen = set(tokens)
                if required_per_cycle > maximum or interval > target * 0.9:
                    print(
                        f"[account-watcher] capacity insufficient: pool={pool_size} "
                        f"required_per_cycle={required_per_cycle} hard_limit={maximum}; "
                        "daily target is best-effort, not guaranteed"
                    )

                def can_start() -> bool:
                    return (
                        not stop_event.is_set()
                        and monotonic() + wave_seconds < deadline
                        and sent < maximum
                    )

                def refresh(batch: list[str]) -> None:
                    nonlocal sent, wave_seconds
                    if not batch or not can_start():
                        return
                    wave_start = monotonic()
                    sent += len(batch)
                    result = account_service.refresh_accounts(
                        batch,
                        include_items=False,
                        coordinator=account_service.background_refresh_coordinator,
                    )
                    wave_seconds = max(wave_seconds, monotonic() - wave_start)
                    if result.get("errors"):
                        print(f"[account-watcher] refresh errors={len(result['errors'])}; daily target not guaranteed")

                # Keepalive is a small, independent maintenance pass, but shares
                # the hard cap so it cannot turn the watcher into an unbounded loop.
                width = min(batch_size, 3)
                keepalive_sent: set[str] = set()
                if can_start():
                    keepalive = account_service.list_refresh_token_keepalive_tokens()
                    keepalive_batch = keepalive[:min(width, maximum - sent)]
                    if keepalive_batch and can_start():
                        sent += len(keepalive_batch)
                        keepalive_sent.update(keepalive_batch)
                        result = account_service.keepalive_refresh_tokens(keepalive_batch)
                        if result.get("errors"):
                            print(f"[account-watcher] keepalive errors={len(result['errors'])}")

                # Due-limited rechecks retain the original cooldown, not 24 hours.
                # Reserve ordinary capacity so a large due list cannot starve the
                # cursor forever. Due accounts still get first refusal of the
                # remaining budget; tiny caps may defer all due work.
                due = account_service.list_due_limited_tokens()
                due_sent: set[str] = set()
                ordinary_reserve = min(coverage, max(1, maximum - sent - 1))
                due_budget = max(0, maximum - sent - ordinary_reserve)
                due_started = monotonic()
                due_deadline = min(deadline, due_started + interval * 0.2)
                for offset in range(0, len(due), width):
                    if not can_start() or monotonic() >= due_deadline or len(due_sent) >= due_budget:
                        break
                    window = due[offset:offset + width]
                    batch = account_service.select_background_refresh_tokens(window)
                    batch = [token for token in batch if token not in due_sent and token not in keepalive_sent]
                    batch = batch[:max(0, due_budget - len(due_sent))]
                    if batch and can_start():
                        refresh(batch)
                        due_sent.update(batch)
                while visited < coverage and can_start():
                    size = min(width, coverage - visited, maximum - sent)
                    if size <= 0:
                        break
                    if not pending:
                        pending.extend(tokens)
                        pass_seen = set(tokens)
                    size = min(size, len(pending))
                    window = [pending[index] for index in range(size)]
                    batch = account_service.select_background_refresh_tokens(window)
                    batch = [token for token in batch if token not in due_sent and token not in keepalive_sent]
                    # Selection can take time too: leave this slice for next cycle
                    # if stop/deadline arrives before dispatch.
                    if not can_start():
                        break
                    refresh(batch)
                    for _ in range(size):
                        pending.popleft()
                    visited += size
                if visited < coverage or len(due_sent) < min(len(due), due_budget):
                    print(
                        f"[account-watcher] coverage shortfall: visited={visited}/{coverage} "
                        f"submitted={sent} due_submitted={len(due_sent)}/{len(due)}; "
                        "hard limit, cooldown, stop or time budget; daily target not guaranteed"
                    )
                print(
                    f"[account-watcher] cycle: pool={pool_size} scanned={visited}/{coverage} "
                    f"submitted={sent} keepalive={len(keepalive_sent)} "
                    f"due_submitted={len(due_sent)} interval={interval}s target={target}s"
                )
            except Exception as exc:
                # Never put account tokens/upstream credential-bearing text in logs.
                print(f"[account-watcher] cycle failed: {type(exc).__name__}; daily target not guaranteed")
            elapsed = monotonic() - started
            if elapsed >= interval * 0.9:
                print(f"[account-watcher] time capacity insufficient: elapsed={elapsed:.1f}s period={interval}s; daily target not guaranteed")
            # Anchor to cycle start, rather than adding a full sleep after work.
            # A blocked upstream may overrun; no immediate catch-up spin then.
            stop_event.wait(max(1.0, interval - elapsed))

    thread = Thread(target=worker, name="account-watcher", daemon=True)
    thread.start()
    return thread


def resolve_web_asset(requested_path: str) -> Path | None:
    if not WEB_DIST_DIR.exists():
        return None
    clean_path = requested_path.strip("/")
    base_dir = WEB_DIST_DIR.resolve()
    candidates = [base_dir / "index.html"] if not clean_path else [
        base_dir / Path(clean_path),
        base_dir / clean_path / "index.html",
        base_dir / f"{clean_path}.html",
    ]
    # webpack 导出目录中的页面数据也可由 Next 的扁平预取地址访问。
    asset_name = Path(clean_path).name
    if asset_name.startswith("__next.") and asset_name.endswith(".__PAGE__.txt"):
        # 原位部署会保留旧文件。先读取当前目录式导出的产物，避免命中旧的扁平文件。
        candidates.insert(0, base_dir / clean_path.removesuffix(".__PAGE__.txt") / "__PAGE__.txt")
    # Next 静态导出会按路由尾斜杠请求 route.txt 或 route/index.txt。
    elif clean_path.endswith(".txt") and not asset_name.startswith("__next."):
        if clean_path.endswith("/index.txt"):
            candidates.append(base_dir / f"{clean_path[:-len('/index.txt')]}.txt")
        else:
            candidates.insert(0, base_dir / clean_path[:-4] / "index.txt")
    for candidate in candidates:
        try:
            candidate.resolve().relative_to(base_dir)
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    return None
