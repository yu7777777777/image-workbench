"""1.13.61 审计修复的回归测试。

覆盖：管理员密钥 setter 持久化、图片 zip 的 WebDAV 回退、任务超时字段
（conversation_id / account_token）的捕获与续轮询校验、任务时间戳时区、
图片 URL 内网拦截、鉴权失败限流、可编辑文件过期清理。
"""
from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException

from api.app import AuthFailureRateLimitMiddleware
from api.image_inputs import _assert_public_image_url
from services.config import ConfigStore
from services.image_service import download_images_zip
from services.image_task_service import (
    ImageTaskService,
    TASK_STATUS_ERROR,
    _timestamp,
)
from services.openai_backend_api import ImagePollTimeoutError


OWNER = {"id": "owner-1", "name": "Owner", "role": "admin"}


def wait_for_task(service: ImageTaskService, identity: dict, task_id: str, status: str, timeout: float = 2.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        result = service.list_tasks(identity, [task_id])
        last = (result.get("items") or [None])[0]
        if last and last.get("status") == status:
            return last
        time.sleep(0.02)
    raise AssertionError(f"task {task_id} did not reach {status}, last={last}")


class ConfigAuthKeySetterTests(unittest.TestCase):
    def _make_store(self, tmp_dir: str) -> ConfigStore:
        path = Path(tmp_dir) / "config.json"
        path.write_text(json.dumps({"auth-key": "old-key"}), encoding="utf-8")
        return ConfigStore(path)

    def test_setter_persists_to_disk(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = self._make_store(tmp_dir)
            store.auth_key = "new-key-123"
            self.assertEqual(store.auth_key, "new-key-123")
            # 重新加载实例应读到新值（说明写入了文件而不是只改内存）
            reloaded = ConfigStore(Path(tmp_dir) / "config.json")
            self.assertEqual(reloaded.auth_key, "new-key-123")

    def test_setter_rejects_empty_key(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = self._make_store(tmp_dir)
            with self.assertRaises(ValueError):
                store.auth_key = "   "

    def test_setter_refuses_when_env_var_takes_precedence(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            store = self._make_store(tmp_dir)
            with mock.patch.dict("os.environ", {"CHATGPT2API_AUTH_KEY": "env-key"}):
                with self.assertRaises(ValueError):
                    store.auth_key = "new-key-123"
            self.assertEqual(json.loads((Path(tmp_dir) / "config.json").read_text(encoding="utf-8"))["auth-key"], "old-key")


class DownloadImagesZipWebdavFallbackTests(unittest.TestCase):
    def test_remote_only_images_are_included(self):
        from services import image_service

        payload = b"remote-png-bytes"
        fake_config = mock.Mock()
        fake_config.images_dir = Path(tempfile.gettempdir())
        with mock.patch.object(image_service, "config", new=fake_config), \
                mock.patch.object(image_service.image_storage_service, "has_local", return_value=False), \
                mock.patch.object(image_service.image_storage_service, "get_bytes", return_value=payload):
            buf = download_images_zip(["2026/10/24/1_remote.png"])
        import io
        import zipfile

        with zipfile.ZipFile(buf) as archive:
            self.assertEqual(archive.namelist(), ["1_remote.png"])
            self.assertEqual(archive.read("1_remote.png"), payload)


class TimeoutTaskFieldsTests(unittest.TestCase):
    def _make_service(self, path: Path, handler) -> ImageTaskService:
        return ImageTaskService(
            path,
            generation_handler=handler,
            edit_handler=handler,
            retention_days_getter=lambda: 30,
        )

    def test_timeout_error_captures_conversation_and_token(self):
        def handler(_payload):
            exc = ImagePollTimeoutError("ChatGPT 生图超时（已等待 120 秒）。", conversation_id="conv-1")
            exc.account_token = "tok-1"
            raise exc

        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self._make_service(Path(tmp_dir) / "tasks.json", handler)
            service.submit_generation(
                OWNER, client_task_id="t1", prompt="cat", model="gpt-image-2",
                size=None, base_url="http://local.test",
            )
            task = wait_for_task(service, OWNER, "t1", TASK_STATUS_ERROR)
            self.assertIn("超时", task["error"])
            self.assertNotIn("account_token", task)  # 对外返回不携带 token
            with service._lock:
                stored = service._tasks["owner-1:t1"]
            self.assertEqual(stored.get("conversation_id"), "conv-1")
            self.assertEqual(stored.get("account_token"), "tok-1")

    def test_resume_poll_requires_stored_account_token(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self._make_service(
                Path(tmp_dir) / "tasks.json",
                lambda _payload: {"data": [{"url": "u"}]},
            )
            service.submit_generation(
                OWNER, client_task_id="t2", prompt="cat", model="gpt-image-2",
                size=None, base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "t2", "success")
            with service._lock:
                key = "owner-1:t2"
                service._tasks[key]["status"] = TASK_STATUS_ERROR
                service._tasks[key]["error"] = "ChatGPT 生图超时（已等待 120 秒）。"
                service._tasks[key]["conversation_id"] = "conv-2"
                # 不写 account_token
            with self.assertRaises(ValueError) as ctx:
                service.resume_poll(OWNER, "t2", 30.0)
            self.assertIn("account token", str(ctx.exception))

    def test_resume_poll_uses_original_account_session(self):
        from services.protocol.conversation import format_image_result  # noqa: F401 确认可导入

        with tempfile.TemporaryDirectory() as tmp_dir:
            service = self._make_service(
                Path(tmp_dir) / "tasks.json",
                lambda _payload: {"data": [{"url": "u"}]},
            )
            service.submit_generation(
                OWNER, client_task_id="t3", prompt="cat", model="gpt-image-2",
                size=None, base_url="http://local.test",
            )
            wait_for_task(service, OWNER, "t3", "success")
            with service._lock:
                key = "owner-1:t3"
                service._tasks[key]["status"] = TASK_STATUS_ERROR
                service._tasks[key]["error"] = "ChatGPT 生图超时（已等待 120 秒）。"
                service._tasks[key]["conversation_id"] = "conv-3"
                service._tasks[key]["account_token"] = "tok-old"

            with mock.patch("services.account_service.account_service") as acct, \
                    mock.patch("services.openai_backend_api.OpenAIBackendAPI") as backend_cls:
                acct.resolve_access_token.return_value = "tok-new"
                acct.get_account.return_value = {"access_token": "tok-new"}
                backend = backend_cls.return_value
                backend._poll_image_results.return_value = (["file-1"], [])
                backend.resolve_conversation_image_urls.return_value = ["http://up/i.png"]
                backend.download_image_bytes.return_value = [b"png"]

                service.resume_poll(OWNER, "t3", 30.0)
                task = wait_for_task(service, OWNER, "t3", "success")

                backend_cls.assert_called_once_with(access_token="tok-new")
                backend._poll_image_results.assert_called_once_with("conv-3", 30.0)
            self.assertTrue(task.get("data"))


class TaskTimestampTimezoneTests(unittest.TestCase):
    def test_naive_beijing_time_string_interpreted_with_tz(self):
        # "2026-10-24 20:00:00" 按 +8 解析 = 12:00:00Z
        ts = _timestamp("2026-10-24 20:00:00")
        expected = _timestamp("2026-10-24T20:00:00+08:00")
        self.assertEqual(ts, expected)

    def test_invalid_values_fall_back_to_zero(self):
        self.assertEqual(_timestamp(None), 0.0)
        self.assertEqual(_timestamp("not-a-date"), 0.0)


class ImageUrlSsrfGuardTests(unittest.TestCase):
    def test_loopback_and_private_addresses_rejected(self):
        for url in (
            "http://127.0.0.1/x.png",
            "http://127.0.0.1:8080/x.png",
            "http://10.0.0.5/x.png",
            "http://192.168.1.4/x.png",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/x.png",
        ):
            with self.assertRaises(HTTPException) as ctx:
                _assert_public_image_url(url)
            self.assertEqual(ctx.exception.status_code, 400)

    def test_public_ip_allowed_without_dns(self):
        _assert_public_image_url("http://8.8.8.8/x.png")  # 不应抛异常


class AuthRateLimitTests(unittest.TestCase):
    def _middleware(self) -> AuthFailureRateLimitMiddleware:
        from starlette.types import Receive, Scope, Send

        async def noop_app(scope: Scope, receive: Receive, send: Send) -> None:
            return None

        return AuthFailureRateLimitMiddleware(noop_app, max_failures=3, window_secs=100, block_secs=200)

    def test_blocks_after_repeated_failures(self):
        mw = self._middleware()
        base = 1000.0
        for i in range(3):
            mw._record_failure_locked("1.2.3.4", base + i)
        self.assertTrue(mw._is_blocked_locked("1.2.3.4", base + 10))
        # 封禁过期后自动解除
        self.assertFalse(mw._is_blocked_locked("1.2.3.4", base + 10 + 201))

    def test_failures_outside_window_do_not_accumulate(self):
        mw = self._middleware()
        base = 2000.0
        mw._record_failure_locked("1.2.3.4", base)
        mw._record_failure_locked("1.2.3.4", base + 99)
        mw._prune_locked(base + 150)
        self.assertFalse(mw._is_blocked_locked("1.2.3.4", base + 150))


class EditableFileCleanupTests(unittest.TestCase):
    def test_expired_task_removes_output_dir(self):
        from services.editable_file_task_service import (
            EDITABLE_FILE_ROOT,
            EditableFileTaskService,
        )

        with tempfile.TemporaryDirectory() as tmp_dir:
            with mock.patch(
                "services.editable_file_task_service.EDITABLE_FILE_ROOT",
                new=Path(tmp_dir) / "files",
            ):
                output_dir = Path(tmp_dir) / "files" / "ppt" / "task-old"
                output_dir.mkdir(parents=True, exist_ok=True)
                (output_dir / "deck.pptx").write_bytes(b"x")
                service = EditableFileTaskService(Path(tmp_dir) / "editable.json")
                with service._lock:
                    service._tasks["owner:task-old"] = {
                        "id": "task-old",
                        "owner_id": "owner",
                        "status": "success",
                        "kind": "ppt",
                        "updated_ts": time.time() - 40 * 86400,
                    }
                    removed = service._cleanup_expired_locked()
                self.assertTrue(removed)
                self.assertFalse(output_dir.exists())
                self.assertNotIn("owner:task-old", service._tasks)


if __name__ == "__main__":
    unittest.main()
