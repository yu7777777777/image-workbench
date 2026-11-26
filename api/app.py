from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from threading import Event, Lock
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from api import accounts, ai, image_tasks, shared_image_proxy, system
from api.errors import install_exception_handlers
from api.support import resolve_web_asset, start_limited_account_watcher
from services.backup_service import backup_service
from services.config import config
from services.image_service import start_image_cleanup_scheduler


class AuthFailureRateLimitMiddleware:
    """按客户端 IP 统计 401 次数，超阈值后临时封禁，缓解密钥在线爆破。

    纯 ASGI 实现（不走 BaseHTTPMiddleware），对 SSE 流式响应零干预。
    阈值取保守值：正常用户偶发输错密钥不会触发；共享出口 IP 也留有余量。
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        max_failures: int = 20,
        window_secs: float = 300.0,
        block_secs: float = 600.0,
    ) -> None:
        self.app = app
        self.max_failures = max_failures
        self.window_secs = window_secs
        self.block_secs = block_secs
        self._failures: dict[str, list[float]] = {}
        self._blocked_until: dict[str, float] = {}
        self._lock = Lock()

    def _client_ip(self, scope: Scope) -> str:
        client = scope.get("client")
        return str(client[0]) if client else ""

    def _prune_locked(self, now: float) -> None:
        for ip, timestamps in list(self._failures.items()):
            fresh = [ts for ts in timestamps if now - ts < self.window_secs]
            if fresh:
                self._failures[ip] = fresh
            else:
                self._failures.pop(ip, None)
                self._blocked_until.pop(ip, None)

    def _is_blocked_locked(self, ip: str, now: float) -> bool:
        until = self._blocked_until.get(ip, 0.0)
        if until > now:
            return True
        if until:
            self._blocked_until.pop(ip, None)
        return False

    def _record_failure_locked(self, ip: str, now: float) -> None:
        timestamps = self._failures.setdefault(ip, [])
        timestamps.append(now)
        if len([ts for ts in timestamps if now - ts < self.window_secs]) >= self.max_failures:
            self._blocked_until[ip] = now + self.block_secs
            self._failures.pop(ip, None)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        now = time.monotonic()
        ip = self._client_ip(scope)
        with self._lock:
            self._prune_locked(now)
            blocked = bool(ip) and self._is_blocked_locked(ip, now)
        if blocked:
            response = JSONResponse(
                status_code=429,
                content={"detail": "鉴权失败次数过多，请稍后再试"},
            )
            await response(scope, receive, send)
            return

        status_code = 200

        async def send_wrapper(message: object) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        await self.app(scope, receive, send_wrapper)

        if status_code == 401 and ip:
            with self._lock:
                self._record_failure_locked(ip, time.monotonic())


def create_app() -> FastAPI:
    app_version = config.app_version

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop_event = Event()
        watcher_enabled = os.getenv("ACCOUNT_WATCHER_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
        thread = start_limited_account_watcher(stop_event) if watcher_enabled else None
        cleanup_thread = start_image_cleanup_scheduler(stop_event)
        backup_service.start()
        config.cleanup_old_images()
        try:
            yield
        finally:
            stop_event.set()
            if thread is not None:
                thread.join(timeout=1)
            cleanup_thread.join(timeout=1)
            backup_service.stop()

    app = FastAPI(title="chatgpt2api", version=app_version, lifespan=lifespan)
    install_exception_handlers(app)
    app.add_middleware(AuthFailureRateLimitMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=1)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ai.create_router())
    app.include_router(accounts.create_router())
    app.include_router(image_tasks.create_router())
    app.include_router(shared_image_proxy.create_router())
    app.include_router(system.create_router(app_version))

    playground = Path(__file__).resolve().parent.parent / "playground_dist"
    if playground.is_dir():
        app.mount("/playground", StaticFiles(directory=playground, html=True), name="playground")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def serve_web(full_path: str):
        asset = resolve_web_asset(full_path)
        if asset is not None:
            # HTML 与路由数据须来自同一次部署，避免缓存引用已经替换的构建文件。
            headers = {"Cache-Control": "no-cache"} if asset.suffix in {".html", ".txt"} else None
            return FileResponse(asset, headers=headers)
        if full_path.strip("/").startswith("_next/") or full_path.rstrip("/").endswith(".txt"):
            raise HTTPException(status_code=404, detail="Not Found")
        fallback = resolve_web_asset("")
        if fallback is None:
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(fallback, headers={"Cache-Control": "no-cache"})

    return app
