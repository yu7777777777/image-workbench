from __future__ import annotations

from services import openai_backend_api


def test_authenticated_backend_uses_chatgpt_account_id(monkeypatch) -> None:
    class FakeSession:
        def __init__(self) -> None:
            self.headers: dict[str, str] = {}

        def close(self) -> None:
            pass

    session = FakeSession()
    monkeypatch.setattr(openai_backend_api.account_service, "get_account", lambda token: {"account_id": "account-from-record"})
    monkeypatch.setattr(openai_backend_api.requests, "Session", lambda **kwargs: session)

    backend = openai_backend_api.OpenAIBackendAPI("token")
    assert backend.session.headers["ChatGPT-Account-Id"] == "account-from-record"
