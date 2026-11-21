from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator
from unittest.mock import Mock

import pytest

from services import upload_limits

LIMIT = '/backend-api/files failed: status=429, body={"detail":{"code":"throttled","message":"你已达到文件上传上限。请18小时 内重试。"}}'


@pytest.fixture(autouse=True)
def clear_cooldowns() -> Iterator[None]:
    upload_limits._cooldowns.clear()
    yield
    upload_limits._cooldowns.clear()


def test_upload_limit_is_distinct_from_other_429s() -> None:
    assert upload_limits.is_file_upload_limit(LIMIT)
    assert not upload_limits.is_file_upload_limit('/backend-api/conversation failed: status=429')
    assert not upload_limits.is_file_upload_limit('/backend-api/files failed: status=400, invalid file')


def test_cooldown_expires_at_upstream_retry_time(monkeypatch: pytest.MonkeyPatch) -> None:
    now = [100.0]
    monkeypatch.setattr(upload_limits.time, 'monotonic', lambda: now[0])
    upload_limits.mark_upload_limited('limited', LIMIT)
    now[0] += 18 * 3600 - 1
    assert upload_limits.upload_limited_tokens() == {'limited'}
    now[0] += 2
    assert not upload_limits.upload_limited_tokens()


def load_retry_functions() -> dict[str, Any]:
    tree = ast.parse(Path('services/protocol/conversation.py').read_text(encoding='utf-8-sig'))
    names = {'ImageGenerationError', 'public_image_error_message', 'stream_text_deltas', '_generate_single_image'}
    selected = ast.Module(body=[node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names], type_ignores=[])
    namespace: dict[str, Any] = {'Any': Any, 'Iterator': Iterator, 'OpenAIBackendAPI': object,
        'ConversationRequest': object, 'ImageOutput': object, 'ImagePollTimeoutError': type('PollError', (Exception,), {}),
        'ImageContentPolicyError': type('PolicyError', (Exception,), {}),
        'UpstreamHTTPError': type('UpstreamHTTPError', (Exception,), {'status_code': 0}),
        'is_file_upload_limit': upload_limits.is_file_upload_limit,
        'mark_upload_limited': upload_limits.mark_upload_limited,
        'upload_limited_tokens': upload_limits.upload_limited_tokens,
        'UPLOAD_LIMIT_MESSAGE': upload_limits.UPLOAD_LIMIT_MESSAGE,
        'logger': SimpleNamespace(debug=lambda *a: None, warning=lambda *a: None),
        'split_image_model': lambda model: (None, None), 'is_codex_image_model': lambda model: False,
        '_remove_image_conversation_later': lambda *a, **k: None,
        'is_token_invalid_error': lambda message: False,
        'is_tls_connection_error': lambda message: False,
        'is_connection_timeout_error': lambda message: False,
        'image_stream_error_message': lambda message: message}
    exec(compile(selected, 'upload_retry_functions', 'exec'), namespace)
    return namespace


def test_text_upload_limit_rotates_account_with_model_filter() -> None:
    module = load_retry_functions()
    accounts = SimpleNamespace(get_text_access_token=Mock(return_value='healthy'), mark_text_used=Mock())
    closed: list[str] = []
    module['account_service'] = accounts
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: closed.append(access_token))
    def events(backend: Any, **kwargs: Any) -> Iterator[dict[str, str]]:
        if backend.access_token == 'limited':
            raise RuntimeError(LIMIT)
        yield {'type': 'conversation.delta', 'delta': '计划完成'}
    module['conversation_events'] = events
    request = SimpleNamespace(messages=[], model='requested-model', prompt='', thinking_effort='')
    assert list(module['stream_text_deltas'](SimpleNamespace(access_token='limited'), request)) == ['计划完成']
    accounts.get_text_access_token.assert_called_once_with(excluded_tokens={'limited'}, model='requested-model')
    assert closed == ['limited', 'healthy']


def test_no_account_switch_after_text_was_emitted() -> None:
    module = load_retry_functions()
    accounts = SimpleNamespace(get_text_access_token=Mock(), mark_text_used=Mock())
    module['account_service'] = accounts
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    def events(backend: Any, **kwargs: Any) -> Iterator[dict[str, str]]:
        yield {'type': 'conversation.delta', 'delta': 'partial'}
        raise RuntimeError(LIMIT)
    module['conversation_events'] = events
    request = SimpleNamespace(messages=[], model='auto', prompt='', thinking_effort='')
    with pytest.raises(RuntimeError):
        list(module['stream_text_deltas'](SimpleNamespace(access_token='limited'), request))
    accounts.get_text_access_token.assert_not_called()


def test_image_upload_limit_excludes_account_and_preserves_reference() -> None:
    module = load_retry_functions()
    accounts = SimpleNamespace(get_available_access_token=Mock(side_effect=['limited', 'healthy']),
        get_account=lambda token: {}, mark_image_result=Mock())
    module['account_service'] = accounts
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    request = SimpleNamespace(model='gpt-image-2', images=['original-reference'], progress_callback=None, message_as_error=True)
    output = SimpleNamespace(kind='result', conversation_id='generated', account_email='')
    def images(backend: Any, received: Any, index: int, total: int) -> Iterator[Any]:
        assert received.images == ['original-reference']
        if backend.access_token == 'limited':
            raise RuntimeError(LIMIT)
        yield output
    module['stream_image_outputs'] = images
    assert module['_generate_single_image'](request, 1, 1) == [output]
    assert accounts.get_available_access_token.call_args_list[1].kwargs['excluded_tokens'] == {'limited'}
    assert accounts.mark_image_result.call_args_list[0].args == ('limited', False)
    assert accounts.mark_image_result.call_args_list[1].args == ('healthy', True)


def test_exhausted_image_pool_reports_upload_limit() -> None:
    module = load_retry_functions()
    module['account_service'] = SimpleNamespace(get_available_access_token=Mock(side_effect=['limited', RuntimeError('no available image quota')]),
        get_account=lambda token: {}, mark_image_result=Mock())
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    def images(*args: Any) -> Iterator[Any]:
        raise RuntimeError(LIMIT)
        yield
    module['stream_image_outputs'] = images
    request = SimpleNamespace(model='gpt-image-2', images=['reference'], progress_callback=None, message_as_error=True)
    with pytest.raises(module['ImageGenerationError']) as caught:
        module['_generate_single_image'](request, 1, 1)
    assert caught.value.status_code == 429
    assert caught.value.code == 'file_upload_limit'


def test_image_upload_retry_budget_is_bounded() -> None:
    module = load_retry_functions()
    selector = Mock(side_effect=['limited-1', 'limited-2', 'limited-3', 'limited-4', 'unused'])
    module['account_service'] = SimpleNamespace(get_available_access_token=selector,
        get_account=lambda token: {}, mark_image_result=Mock())
    module['OpenAIBackendAPI'] = lambda access_token: SimpleNamespace(access_token=access_token, close=lambda: None)
    def images(*args: Any) -> Iterator[Any]:
        raise RuntimeError(LIMIT)
        yield
    module['stream_image_outputs'] = images
    request = SimpleNamespace(model='gpt-image-2', images=['reference'], progress_callback=None, message_as_error=True)
    with pytest.raises(module['ImageGenerationError']):
        module['_generate_single_image'](request, 1, 1)
    assert selector.call_count == 4
    assert selector.call_args_list[-1].kwargs['excluded_tokens'] == {'limited-1', 'limited-2', 'limited-3'}
