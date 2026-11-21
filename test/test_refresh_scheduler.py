import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier, Event, Lock
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.account_refresh_scheduler import RefreshCoordinator
from services.config import config
from test.test_account_performance import make_service


def test_shared_inflight_and_recent_success_only_call_upstream_once():
    entered, release = Event(), Event()
    calls = []
    def fetch(token, *args):
        calls.append(token)
        entered.set()
        assert release.wait(5)
        return {"access_token": token}
    coordinator = RefreshCoordinator(fetch, lambda token: {"access_token": token}, lambda t: t, workers=2)
    try:
        first, reused = coordinator.submit('a')
        assert not reused and entered.wait(5)
        second, reused = coordinator.submit('a')
        assert reused and first is second
        release.set()
        first.result(5)
        third, reused = coordinator.submit('a')
        assert reused and third.result(5)['access_token'] == 'a'
        assert calls == ['a']
    finally:
        release.set()
        coordinator.shutdown()


def test_failed_refresh_can_be_retried_and_is_not_cached_as_success():
    calls = []
    def fetch(token, *args):
        calls.append(token)
        if len(calls) == 1:
            raise RuntimeError('temporary failure')
        return {'access_token': token}
    coordinator = RefreshCoordinator(fetch, lambda t: {}, lambda t: t)
    try:
        first, _ = coordinator.submit('a')
        try:
            first.result(5)
        except RuntimeError:
            pass
        # Wait for completion callback by removing the completed mapping, as
        # the next request normally observes it after the callback runs.
        coordinator._remove('a', first)
        second, reused = coordinator.submit('a')
        assert not reused and second.result(5)['access_token'] == 'a'
        assert len(calls) == 2
    finally:
        coordinator.shutdown()


def test_many_accounts_have_bounded_workers_and_pending_futures(tmp_path):
    service, _ = make_service(tmp_path, 250)
    gate, entered, lock = Event(), Event(), Lock()
    active = peak = 0
    def fetch(token, *args):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            if active == 3:
                entered.set()
        assert gate.wait(5)
        with lock:
            active -= 1
        return service.get_account(token)
    service.refresh_coordinator.shutdown()
    service.refresh_coordinator = RefreshCoordinator(fetch, service.get_account, service.resolve_access_token, workers=3)
    try:
        with ThreadPoolExecutor(max_workers=1) as runner:
            job = runner.submit(service.refresh_accounts, service.list_tokens(), 'bulk', include_items=False)
            assert entered.wait(5)
            try:
                assert len(service.refresh_coordinator._inflight) <= 6
                assert peak == 3
            finally:
                gate.set()
            result = job.result(10)
        assert result['refreshed'] == 250
        assert 'items' not in result
        assert service.get_refresh_progress('bulk')['processed'] == 250
        assert service.get_refresh_progress('bulk')['done']
    finally:
        gate.set()
        service.refresh_coordinator.shutdown()


def test_targeted_save_does_not_iterate_the_pool_and_retries_failed_dirty_records(tmp_path):
    service, backend = make_service(tmp_path, 100)
    class NoScanDict(dict):
        def items(self): raise AssertionError('full scan')
        def keys(self): raise AssertionError('full scan')
        def __iter__(self): raise AssertionError('full scan')
    service._accounts = NoScanDict(service._accounts)
    with patch.object(backend, 'save_account_changes', side_effect=RuntimeError('disk failure')):
        try:
            service.update_account('token-0', {'quota': 42}, quiet=True)
        except RuntimeError:
            pass
    service.update_account('token-1', {'quota': 43}, quiet=True)
    saved = {x['access_token']: x for x in backend.load_accounts()}
    assert saved['token-0']['quota'] == 42
    assert saved['token-1']['quota'] == 43


def test_background_batches_skip_fresh_disabled_and_not_yet_restored_accounts(tmp_path):
    service, _ = make_service(tmp_path, 6)
    now = datetime.now(timezone.utc)
    service.update_account('token-1', {'status': '禁用'}, quiet=True)
    service.update_account('token-2', {'status': '限流', 'restore_at': (now + timedelta(hours=1)).isoformat()}, quiet=True)
    service.update_account('token-3', {'status': '限流', 'restore_at': (now - timedelta(hours=1)).isoformat()}, quiet=True)
    service.update_account('token-4', {'last_account_refresh_at': now.isoformat()}, quiet=True)
    service.refresh_coordinator._attempted['token-5'] = time.monotonic()
    with patch.dict(config.data, {'refresh_account_interval_minute': 5, 'auto_remove_rate_limited_accounts': False}):
        assert service.select_background_refresh_tokens(service.list_tokens()) == ['token-0', 'token-3']
        # Interval changes are read immediately, without restarting the watcher.
        service.refresh_coordinator._attempted['token-5'] -= 120
        config.data['refresh_account_interval_minute'] = 1
        assert 'token-5' in service.select_background_refresh_tokens(service.list_tokens())


def test_image_preflight_reuses_recent_successful_refresh(tmp_path):
    service, _ = make_service(tmp_path, 1)
    service.update_account(
        "token-0",
        {"last_account_refresh_at": datetime.now(timezone.utc).isoformat()},
        quiet=True,
    )
    with patch.object(service.refresh_coordinator, "submit") as submit:
        token = service.get_available_access_token()
    try:
        assert token == "token-0"
        submit.assert_not_called()
    finally:
        service.release_image_slot(token)


def test_failed_image_invalidates_preflight_timestamp(tmp_path):
    service, _ = make_service(tmp_path, 1)
    service.update_account(
        "token-0",
        {"last_account_refresh_at": datetime.now(timezone.utc).isoformat()},
        quiet=True,
    )
    service.mark_image_result("token-0", success=False)
    assert service.get_account("token-0")["last_account_refresh_at"] is None


def test_manual_duplicate_task_and_legacy_progress_compatibility(tmp_path):
    from api import accounts
    service, _ = make_service(tmp_path, 2)
    entered, release = Event(), Event()
    def refresh(tokens, progress_id, *args, **kwargs):
        entered.set()
        assert release.wait(5)
        service.finish_refresh_progress(progress_id, {'refreshed': 2, 'errors': [], 'relogined': 0})
    with patch.object(accounts, 'account_service', service), patch.object(accounts, 'require_admin'), patch.object(service, 'refresh_accounts', refresh):
        app = FastAPI()
        app.include_router(accounts.create_router())
        with TestClient(app) as client:
            try:
                first = client.post('/api/accounts/refresh', json={'access_tokens': []}).json()
                assert entered.wait(5)
                service._accounts['new-token'] = dict(service._accounts['token-0'], access_token='new-token')
                second = client.post('/api/accounts/refresh', json={'access_tokens': []}).json()
                assert first == second
                id = first['progress_id']
                assert client.get(f'/api/accounts/refresh/progress/{id}').status_code == 200
                service.finish_refresh_progress(id, {'refreshed': 2, 'errors': []})
                summary = client.get(f'/api/accounts/refresh/progress/{id}?summary_only=true').json()
                assert 'items' not in summary['result']
                legacy = client.get(f'/api/accounts/refresh/progress/{id}').json()
                assert len(legacy['result']['items']) == 3
                assert 'items' not in service.get_refresh_progress(id)['result']
            finally:
                release.set()


def test_different_accounts_can_renew_tokens_concurrently(tmp_path):
    service, _ = make_service(tmp_path, 2)
    # Pick two identities in different bounded lock stripes.
    first = 'identity-0'
    second = next(f'identity-{i}' for i in range(1, 1000) if hash(f'identity-{i}') % 256 != hash(first) % 256)
    for i, identity in enumerate([first, second]):
        service.update_account(f'token-{i}', {'account_id': identity, 'refresh_token': f'refresh-{i}'}, quiet=True)
    barrier = Barrier(2)
    def renew(refresh_token, account):
        barrier.wait(timeout=5)
        return {'access_token': account['access_token'] + '-new', 'refresh_token': refresh_token}
    with patch.object(service, '_request_access_token_refresh', side_effect=renew):
        with ThreadPoolExecutor(max_workers=2) as executor:
            jobs = [executor.submit(service.refresh_access_token, f'token-{i}', force=True) for i in range(2)]
            assert [job.result(10) for job in jobs] == ['token-0-new', 'token-1-new']


def test_same_account_concurrent_forced_rotation_preserves_latest_credentials(tmp_path):
    service, backend = make_service(tmp_path, 1)
    service.update_account('token-0', {'refresh_token': 'refresh-old'}, quiet=True)
    entered, release = Event(), Event()
    calls = []
    def renew(refresh_token, account):
        calls.append(refresh_token)
        entered.set()
        assert release.wait(5)
        return {'access_token': 'token-new', 'refresh_token': 'refresh-new'}
    with patch.object(service, '_request_access_token_refresh', side_effect=renew):
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(service.refresh_access_token, 'token-0', force=True)
            assert entered.wait(5)
            second = executor.submit(service.refresh_access_token, 'token-0', force=True)
            release.set()
            assert first.result(10) == second.result(10) == 'token-new'
    assert calls == ['refresh-old']
    saved = backend.load_accounts()
    assert len(saved) == 1 and saved[0]['refresh_token'] == 'refresh-new'
