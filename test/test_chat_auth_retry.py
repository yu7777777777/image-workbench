from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Iterator
from unittest.mock import Mock

import pytest

from test.test_upload_limits import load_retry_functions


@pytest.mark.parametrize('refreshed', ['fresh', 'expired', 'throws'])
def test_expired_token_refresh_or_rotate_without_deleting(refreshed: str) -> None:
    module = load_retry_functions()
    accounts = SimpleNamespace(refresh_access_token=Mock(return_value=refreshed),
        get_text_access_token=Mock(return_value='fresh'), mark_text_used=Mock(), remove_invalid_token=Mock())
    module['account_service'] = accounts
    if refreshed == 'throws':
        accounts.refresh_access_token.side_effect = RuntimeError('refresh unavailable')
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    def events(backend: Any, **kwargs: Any) -> Iterator[dict[str, str]]:
        if backend.access_token == 'expired':
            raise RuntimeError('chat_requirements_prepare status=401 token_expired')
        yield {'type': 'conversation.delta', 'delta': 'ok'}
    module['conversation_events'] = events
    request = SimpleNamespace(model='gpt-5-6', messages=[], prompt='', thinking_effort='')
    assert list(module['stream_text_deltas'](SimpleNamespace(access_token='expired'), request)) == ['ok']
    accounts.remove_invalid_token.assert_not_called()
    if refreshed != 'fresh':
        accounts.get_text_access_token.assert_called_once_with(excluded_tokens={'expired'}, model='gpt-5-6')


def test_auth_retries_bounded_and_no_delete() -> None:
    module = load_retry_functions()
    accounts = SimpleNamespace(refresh_access_token=Mock(side_effect=lambda token, **kwargs: token),
        get_text_access_token=Mock(side_effect=['bad2', 'bad3']), mark_text_used=Mock(), remove_invalid_token=Mock())
    module['account_service'] = accounts
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    module['conversation_events'] = Mock(side_effect=RuntimeError('token_expired'))
    request = SimpleNamespace(model='auto', messages=[], prompt='', thinking_effort='')
    with pytest.raises(RuntimeError, match='自动重试后仍不可用'):
        list(module['stream_text_deltas'](SimpleNamespace(access_token='bad1'), request))
    assert module['conversation_events'].call_count == 3
    accounts.remove_invalid_token.assert_not_called()


def test_no_auth_retry_after_partial_output() -> None:
    module = load_retry_functions()
    accounts = SimpleNamespace(refresh_access_token=Mock(), get_text_access_token=Mock())
    module['account_service'] = accounts
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    def events(backend: Any, **kwargs: Any) -> Iterator[dict[str, str]]:
        yield {'type': 'conversation.delta', 'delta': 'partial'}
        raise RuntimeError('token_expired')
    module['conversation_events'] = events
    request = SimpleNamespace(model='auto', messages=[], prompt='', thinking_effort='')
    stream = module['stream_text_deltas'](SimpleNamespace(access_token='bad'), request)
    assert next(stream) == 'partial'
    with pytest.raises(RuntimeError, match='token_expired'):
        next(stream)
    accounts.refresh_access_token.assert_not_called()
    accounts.get_text_access_token.assert_not_called()
