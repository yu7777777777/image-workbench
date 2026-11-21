from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import services.protocol.conversation as conversation
from services.protocol.conversation import (
    ConversationRequest,
    ImageGenerationError,
    NATIVE_4K_PIXELS,
    _native_4k_size_error,
    _parse_requested_image_size,
    is_native_4k_codex_model,
)


def test_square_2880_is_native_4k_by_pixel_budget() -> None:
    assert 2880 * 2880 == NATIVE_4K_PIXELS
    assert _native_4k_size_error("2880x2880", (2880, 2880)) is None


def test_low_dimension_is_rejected_even_when_other_dimension_is_large() -> None:
    error = _native_4k_size_error("3840x2160", (4096, 2000))
    assert error is not None
    assert "3840x2160" in error
    assert "4096x2000" in error


def test_lower_pixel_count_is_rejected() -> None:
    assert _native_4k_size_error("3840x2160", (1536, 1024)) is not None


def test_non_4k_requests_are_not_rejected_for_smaller_output() -> None:
    assert _native_4k_size_error("2048x2048", (1024, 1024)) is None


def test_size_parser_rejects_malformed_values() -> None:
    assert _parse_requested_image_size("2880 X 2880") == (2880, 2880)
    assert _parse_requested_image_size("auto") is None


@pytest.mark.parametrize("model", [
    "gpt-image-2.5",
    "plus-gpt-image-2.5",
    "team-gpt-image-2.5-flare",
    "pro-gpt-image-2.5-sunburst",
])
def test_native_4k_validation_applies_to_codex_25_family(model: str) -> None:
    assert is_native_4k_codex_model(model)


@pytest.mark.parametrize("model", ["gpt-image-2", "codex-gpt-image-2", "plus-gpt-image-2"])
def test_native_4k_validation_does_not_apply_to_non_25_models(model: str) -> None:
    assert not is_native_4k_codex_model(model)


def test_native_4k_mismatch_rotates_codex_pool_until_a_valid_account(monkeypatch: pytest.MonkeyPatch) -> None:
    selected = ["bad-1", "bad-2", "healthy"]
    selector = Mock(side_effect=selected)
    monkeypatch.setattr(conversation.account_service, "get_available_access_token", selector)
    monkeypatch.setattr(conversation.account_service, "get_account", lambda token: {"email": token})
    monkeypatch.setattr(conversation.account_service, "mark_image_result", Mock())
    monkeypatch.setattr(conversation, "OpenAIBackendAPI", lambda access_token: SimpleNamespace(
        access_token=access_token,
        close=lambda: None,
    ))

    output = SimpleNamespace(kind="result", conversation_id="", account_email="")

    def stream(_backend: object, request: ConversationRequest, _index: int, _total: int):
        if request.model and _backend.access_token != "healthy":
            raise ImageGenerationError(
                "Native 4K generation failed: requested 3840x2160, but the upstream returned 1374x1145.",
                code="native_4k_size_mismatch",
                param="size",
            )
        yield output

    monkeypatch.setattr(conversation, "stream_codex_image_outputs", stream)
    request = ConversationRequest(model="gpt-image-2.5", size="3840x2160")

    assert conversation._generate_single_image(request, 1, 1) == [output]
    assert selector.call_count == 3
    assert selector.call_args_list[1].kwargs["excluded_tokens"] == {"bad-1"}
    assert selector.call_args_list[2].kwargs["excluded_tokens"] == {"bad-1", "bad-2"}


def test_native_4k_pool_exhaustion_preserves_last_size_error(monkeypatch: pytest.MonkeyPatch) -> None:
    selector = Mock(side_effect=["bad-1", RuntimeError("no available codex image quota")])
    monkeypatch.setattr(conversation.account_service, "get_available_access_token", selector)
    monkeypatch.setattr(conversation.account_service, "get_account", lambda token: {"email": token})
    monkeypatch.setattr(conversation.account_service, "mark_image_result", Mock())
    monkeypatch.setattr(conversation, "OpenAIBackendAPI", lambda access_token: SimpleNamespace(close=lambda: None))

    def stream(*_args: object, **_kwargs: object):
        raise ImageGenerationError(
            "Native 4K generation failed: requested 2880x2880, but the upstream returned 1374x1145.",
            code="native_4k_size_mismatch",
            param="size",
        )
        yield

    monkeypatch.setattr(conversation, "stream_codex_image_outputs", stream)
    request = ConversationRequest(model="gpt-image-2.5", size="2880x2880")

    with pytest.raises(ImageGenerationError) as caught:
        conversation._generate_single_image(request, 1, 1)
    assert caught.value.code == "native_4k_size_mismatch"
    assert "requested 2880x2880" in str(caught.value)
    assert "returned 1374x1145" in str(caught.value)


def test_native_4k_retry_does_not_apply_to_non_25_models(monkeypatch: pytest.MonkeyPatch) -> None:
    selector = Mock(side_effect=["only-account"])
    monkeypatch.setattr(conversation.account_service, "get_available_access_token", selector)
    monkeypatch.setattr(conversation.account_service, "get_account", lambda token: {"email": token})
    monkeypatch.setattr(conversation.account_service, "mark_image_result", Mock())
    monkeypatch.setattr(conversation, "OpenAIBackendAPI", lambda access_token: SimpleNamespace(close=lambda: None))

    def stream(*_args: object, **_kwargs: object):
        raise ImageGenerationError(
            "Native 4K generation failed: requested 3840x2160, but the upstream returned 1374x1145.",
            code="native_4k_size_mismatch",
            param="size",
        )
        yield

    monkeypatch.setattr(conversation, "stream_image_outputs", stream)
    request = ConversationRequest(model="gpt-image-2", size="3840x2160")

    with pytest.raises(ImageGenerationError) as caught:
        conversation._generate_single_image(request, 1, 1)
    assert caught.value.code == "native_4k_size_mismatch"
    assert selector.call_count == 1
