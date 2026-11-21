"""Offline watcher tests: never import application/storage singletons or secrets."""
import ast
import importlib.util
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

ROOT = Path(__file__).resolve().parents[1]


class Clock:
    now = 0.0

    def monotonic(self) -> float:
        return self.now


class Stop:
    def __init__(self, clock: Clock, cycles: int = 1) -> None:
        self.clock = clock
        self.cycles = cycles
        self.stopped = False
        self.waits: list[float] = []
        self.on_wait = lambda: None

    def is_set(self) -> bool:
        return self.stopped

    def set(self) -> None:
        self.stopped = True

    def wait(self, seconds: float) -> bool:
        self.waits.append(seconds)
        self.clock.now += seconds
        self.on_wait()
        self.cycles -= 1
        if self.cycles <= 0:
            self.set()
        return self.stopped


class InlineThread:
    def __init__(self, target, **kwargs) -> None:
        self.target = target

    def start(self) -> None:
        self.target()


class Pool:
    def __init__(self, size: int, clock: Clock) -> None:
        self.tokens = [f"fake-{i}" for i in range(size)]
        self.clock = clock
        self.due: list[str] = []
        self.skip: set[str] = set()
        self.calls: list[list[str]] = []
        self.background_refresh_coordinator = SimpleNamespace(workers=3)
        self.duration = 0.0
        self.after_refresh = lambda: None
        self.errors: list[dict] = []
        self.keepalive: list[str] = []
        self.keepalive_calls: list[list[str]] = []

    def list_tokens(self) -> list[str]:
        return self.tokens[:]

    def list_due_limited_tokens(self) -> list[str]:
        return self.due[:]

    def select_background_refresh_tokens(self, tokens: list[str]) -> list[str]:
        return [t for t in tokens if t not in self.skip]

    def refresh_accounts(self, tokens: list[str], **kwargs) -> dict:
        assert kwargs == {"include_items": False, "coordinator": self.background_refresh_coordinator}
        assert len(tokens) <= 3
        self.calls.append(tokens[:])
        self.clock.now += self.duration
        self.after_refresh()
        return {"errors": self.errors}

    def list_refresh_token_keepalive_tokens(self) -> list[str]:
        return self.keepalive[:]

    def keepalive_refresh_tokens(self, tokens: list[str]) -> dict:
        self.keepalive_calls.append(tokens[:])
        return {"errors": []}


@pytest.fixture
def watcher(monkeypatch):
    # Load the actual support source under a private name, stubbing only its
    # three stateful imports. api.__init__ would otherwise create the whole app.
    for name in ("INTERVAL_MINUTE", "TARGET_HOURS", "BATCH_SIZE", "MAX_ACCOUNTS_PER_CYCLE"):
        monkeypatch.delenv("ACCOUNT_WATCHER_" + name, raising=False)
    clock = Clock()
    pool = Pool(0, clock)
    config = SimpleNamespace(refresh_account_interval_minute=5)
    with monkeypatch.context() as imports:
        for name, attr, value in (
            ("services.account_service", "account_service", pool),
            ("services.auth_service", "auth_service", Mock()),
            ("services.config", "config", config),
        ):
            module = ModuleType(name)
            setattr(module, attr, value)
            imports.setitem(sys.modules, name, module)
        spec = importlib.util.spec_from_file_location("_offline_watcher", ROOT / "api/support.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    monkeypatch.setattr(module, "monotonic", clock.monotonic)
    monkeypatch.setattr(module, "Thread", InlineThread)
    return module, pool, clock


def run(watcher, size: int, cycles: int = 1) -> Stop:
    module, pool, clock = watcher
    pool.tokens = [f"fake-{i}" for i in range(size)]
    stop = Stop(clock, cycles)
    module.start_limited_account_watcher(stop)
    return stop


@pytest.mark.parametrize("size", [0, 1, 7, 100, 42767, 53760])
def test_daily_coverage_and_fractional_small_pools(watcher, size: int) -> None:
    module, _, _ = watcher
    credit, total = 1.0, 0
    for _ in range(96):
        coverage, credit, demand = module._watcher_cycle_coverage(size, 900, 86400, credit)
        assert 0 <= coverage <= size
        assert 0 <= credit < 1 or size == 0
        total += coverage
    assert total >= size
    if size == 1:
        assert total == 2  # Initial check plus a check after ~21.6 hours, not 96.
    if size == 53760:
        assert demand == 623  # 560 * 96 = 53760 before the 10% safety reserve.


def test_period_is_independent_of_account_cooldown(watcher) -> None:
    module, _, _ = watcher
    module.config.refresh_account_interval_minute = 1440
    stop = run(watcher, 100)
    assert stop.waits == [900]
    assert module.config.refresh_account_interval_minute == 1440


@pytest.mark.parametrize("value", ["", "bad", "0", "-1", "1.5", "nan", "999999999999999999999"])
def test_invalid_settings_fall_back(watcher, monkeypatch, capsys, value: str) -> None:
    module, _, _ = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_INTERVAL_MINUTE", value)
    assert module._watcher_setting("ACCOUNT_WATCHER_INTERVAL_MINUTE", 15, 1440) == 15
    stop = run(watcher, 0)
    assert stop.waits == [900]
    assert "invalid ACCOUNT_WATCHER_INTERVAL_MINUTE" in capsys.readouterr().out


def test_work_time_is_deducted_and_prediction_reserves_time(watcher, capsys) -> None:
    _, pool, _ = watcher
    pool.duration = 200
    stop = run(watcher, 42767)
    assert len(pool.calls) == 4  # 800s spent; another 200s wave will not fit 810s.
    assert stop.waits == [100]
    assert "coverage shortfall" in capsys.readouterr().out


def test_blocked_upstream_overrun_has_no_full_extra_sleep(watcher, capsys) -> None:
    _, pool, _ = watcher
    pool.duration = 1000
    stop = run(watcher, 42767)
    assert len(pool.calls) == 1
    assert stop.waits == [1.0]
    assert "time capacity insufficient" in capsys.readouterr().out


def test_hard_cap_is_not_raised_to_batch_size(watcher, monkeypatch, capsys) -> None:
    _, pool, _ = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_BATCH_SIZE", "1000")
    monkeypatch.setenv("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", "5")
    run(watcher, 42767)
    assert sum(map(len, pool.calls)) == 5
    assert "capacity insufficient" in capsys.readouterr().out


def test_due_priority_filters_before_cap_and_deduplicates(watcher, monkeypatch) -> None:
    _, pool, _ = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", "5")
    pool.due = ["fake-0", "fake-1", "fake-99"]
    pool.skip = {"fake-0", "fake-1"}
    run(watcher, 100)
    assert pool.calls[0] == ["fake-99"]
    flattened = [t for call in pool.calls for t in call]
    assert len(flattened) == len(set(flattened))


def test_due_and_normal_share_one_hard_cap(watcher, monkeypatch) -> None:
    _, pool, _ = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", "5")
    pool.due = [f"due-{i}" for i in range(10)]
    run(watcher, 42767)
    flattened = [t for call in pool.calls for t in call]
    assert flattened[0] == pool.due[0]
    assert flattened[1:] == [f"fake-{i}" for i in range(4)]


def test_stop_during_refresh_prevents_next_wave_after_keepalive(watcher) -> None:
    module, pool, clock = watcher
    pool.tokens = [f"fake-{i}" for i in range(42767)]
    stop = Stop(clock)
    pool.keepalive = ["keepalive"]
    pool.after_refresh = stop.set
    module.start_limited_account_watcher(stop)
    assert len(pool.calls) == 1
    assert pool.keepalive_calls == [["keepalive"]]


def test_initial_stop_does_no_work(watcher) -> None:
    module, pool, clock = watcher
    stop = Stop(clock)
    stop.set()
    module.start_limited_account_watcher(stop)
    assert not pool.calls and not stop.waits


def test_growth_shrink_and_zero_pool_recalculate_without_bad_cursor(watcher, monkeypatch) -> None:
    module, pool, clock = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", "1000")
    pool.tokens = [f"fake-{i}" for i in range(100)]
    stop = Stop(clock, 4)
    sizes = iter([42767, 0, 1, 0])
    def resize() -> None:
        pool.tokens = [f"fake-{i}" for i in range(next(sizes))]
    stop.on_wait = resize
    module.start_limited_account_watcher(stop)
    assert sum(map(len, pool.calls)) > 490
    assert pool.calls[-1] == ["fake-0"]


def test_errors_are_explicit_without_leaking_tokens(watcher, capsys) -> None:
    _, pool, _ = watcher
    pool.errors = [{"token": "secret-value", "error": "private-upstream-text"}]
    run(watcher, 100)
    output = capsys.readouterr().out
    assert "refresh errors=1" in output and "daily target not guaranteed" in output
    assert "secret-value" not in output and "private-upstream-text" not in output


def test_cycle_exception_recovers_next_cycle_without_leaking(watcher, capsys) -> None:
    module, pool, clock = watcher
    pool.list_tokens = Mock(side_effect=[RuntimeError("private-value"), []])
    stop = Stop(clock, 2)
    module.start_limited_account_watcher(stop)
    assert stop.waits == [900, 900]
    output = capsys.readouterr().out
    assert "RuntimeError" in output and "private-value" not in output


def test_keepalive_shares_remaining_hard_cap(watcher, monkeypatch) -> None:
    _, pool, _ = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", "2")
    pool.keepalive = ["keep-0", "keep-1", "keep-2"]
    run(watcher, 1)
    assert pool.keepalive_calls == [["keep-0", "keep-1"]]
    assert not pool.calls


def test_existing_eligibility_cooldown_and_manual_refresh_contract() -> None:
    # Compile unchanged AccountService methods without evaluating imports or its
    # storage-backed singleton. This executes production eligibility logic only.
    tree = ast.parse((ROOT / "services/account_service.py").read_text(encoding="utf-8"))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "AccountService")
    names = {"select_background_refresh_tokens", "_parse_time", "list_due_limited_tokens"}
    methods = [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in names]
    namespace = {"datetime": datetime, "timezone": timezone, "time": time,
                 "config": SimpleNamespace(refresh_account_interval_minute=5)}
    exec(compile(ast.Module(body=methods, type_ignores=[]), "eligibility", "exec"), namespace)
    now = datetime.now(timezone.utc)
    accounts = {
        "ok": {"status": "正常"},
        "disabled": {"status": "禁用"},
        "future": {"status": "限流", "restore_at": (now + timedelta(hours=1)).isoformat()},
        "due": {"status": "限流", "restore_at": (now - timedelta(minutes=1)).isoformat()},
        "recent": {"status": "正常", "last_account_refresh_at": now.isoformat()},
        "attempt": {"status": "正常"},
    }
    for token, account in accounts.items():
        account["access_token"] = token
    service = SimpleNamespace(
        get_account=accounts.get, _parse_time=namespace["_parse_time"],
        _token_needs_refresh=lambda t: False,
        refresh_coordinator=SimpleNamespace(last_attempt=lambda t: time.monotonic() if t == "attempt" else None),
        background_refresh_coordinator=SimpleNamespace(last_attempt=lambda t: None),
    )
    assert namespace["select_background_refresh_tokens"](service, list(accounts)) == ["ok", "due"]
    refresh = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "refresh_accounts")
    assert all(not isinstance(n, ast.Attribute) or n.attr != "select_background_refresh_tokens" for n in ast.walk(refresh))


def test_continuous_due_backlog_preserves_daily_regular_coverage(watcher) -> None:
    module, pool, clock = watcher
    pool.tokens = [f"fake-{i}" for i in range(42767)]
    pool.due = [f"due-{i}" for i in range(1000)]
    pool.keepalive = ["keep-0", "keep-1", "keep-2"]
    module.start_limited_account_watcher(Stop(clock, 96))
    regular = {t for batch in pool.calls for t in batch if t.startswith("fake-")}
    assert regular == set(pool.tokens)
    assert len(pool.keepalive_calls) == 96
    assert all(len(batch) <= 3 for batch in pool.calls)


def test_deleted_prefix_does_not_skip_pending_accounts(watcher, monkeypatch) -> None:
    module, pool, clock = watcher
    monkeypatch.setenv("ACCOUNT_WATCHER_MAX_ACCOUNTS_PER_CYCLE", "2")
    monkeypatch.setenv("ACCOUNT_WATCHER_TARGET_HOURS", "1")
    pool.tokens = [f"fake-{i}" for i in range(10)]
    stop = Stop(clock, 5)
    def remove_prefix() -> None:
        pool.tokens = [t for t in pool.tokens if t not in {"fake-0", "fake-1"}]
    stop.on_wait = remove_prefix
    module.start_limited_account_watcher(stop)
    assert {t for batch in pool.calls for t in batch} == {f"fake-{i}" for i in range(10)}


def test_keepalive_is_not_refreshed_again_in_same_cycle(watcher) -> None:
    _, pool, _ = watcher
    pool.keepalive = ["fake-0"]
    pool.due = ["fake-0", "due-1"]
    run(watcher, 100)
    assert pool.keepalive_calls == [["fake-0"]]
    assert "fake-0" not in [t for batch in pool.calls for t in batch]


def test_due_time_budget_preserves_regular_progress(watcher) -> None:
    _, pool, _ = watcher
    pool.duration = 100
    pool.due = [f"due-{i}" for i in range(1000)]
    run(watcher, 42767)
    assert any(t.startswith("fake-") for batch in pool.calls for t in batch)
