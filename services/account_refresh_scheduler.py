"""Shared, bounded account refresh workers for manual and scheduled jobs."""
from concurrent.futures import Future, ThreadPoolExecutor
from threading import Lock
from time import monotonic


class RefreshCoordinator:
    def __init__(self, fetch, get_account, resolve_token, workers=20, reuse_seconds=60):
        self.fetch = fetch
        self.get_account = get_account
        self.resolve_token = resolve_token
        self.workers = workers
        self.reuse_seconds = reuse_seconds
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="account-refresh")
        self._lock = Lock()
        self._inflight = {}
        self._attempted = {}
        self._succeeded = {}

    def last_attempt(self, token):
        with self._lock:
            return self._attempted.get(token)

    def submit(self, token, defer_invalid_removal=True, event="refresh_accounts"):
        token = self.resolve_token(token)
        with self._lock:
            current = self._inflight.get(token)
            if current is not None:
                return current, True
            succeeded = self._succeeded.get(token)
            if succeeded is not None and monotonic() - succeeded < self.reuse_seconds:
                future = Future()
                future.set_result(self.get_account(token))
                return future, True
            future = self._executor.submit(self._run, token, defer_invalid_removal, event)
            self._inflight[token] = future
        # Register outside the lock: an already-completed Future invokes this
        # callback immediately on the registering thread.
        future.add_done_callback(lambda completed: self._remove(token, completed))
        return future, False

    def _remove(self, token, future):
        with self._lock:
            if self._inflight.get(token) is future:
                self._inflight.pop(token, None)

    def _run(self, token, defer_invalid_removal, event):
        succeeded = False
        try:
            result = self.fetch(token, event, defer_invalid_removal)
            succeeded = result is not None
            return result
        finally:
            now = monotonic()
            resolved = self.resolve_token(token)
            with self._lock:
                for key in {token, resolved}:
                    self._attempted[key] = now
                    if succeeded:
                        self._succeeded[key] = now
                # Retain timestamps, never full account snapshots or results.
                if len(self._attempted) > 100000:
                    self._attempted = {k: t for k, t in self._attempted.items() if now - t < 3600}
                    self._succeeded = {k: t for k, t in self._succeeded.items() if now - t < 3600}

    def shutdown(self):
        self._executor.shutdown(wait=True, cancel_futures=True)
