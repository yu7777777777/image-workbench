from __future__ import annotations

import base64
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import services.protocol.conversation as conversation


def _image_bytes(image_format: str = "PNG") -> bytes:
    """Create an asymmetric in-memory fixture, including transparency/metadata."""
    image = Image.new("RGBA", (24, 24), (12, 34, 56, 0))
    image.putpixel((0, 0), (255, 0, 0, 255))
    image.putpixel((23, 23), (0, 255, 0, 127))
    options: dict[str, object] = {}
    if image_format == "PNG":
        metadata = PngInfo()
        metadata.add_text("upstream", "preserve this original encoding")
        options["pnginfo"] = metadata
    elif image_format == "JPEG":
        image = image.convert("RGB")
    elif image_format == "WEBP":
        options["lossless"] = True
    buffer = BytesIO()
    image.save(buffer, format=image_format, **options)
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def storage(monkeypatch: pytest.MonkeyPatch) -> Mock:
    # Never call the real local/WebDAV save, image index, or cleanup paths.
    service = Mock()
    service.save.return_value = SimpleNamespace(url="https://images.example.test/original")
    monkeypatch.setattr(conversation, "image_storage_service", service)
    return service


@pytest.mark.parametrize("requested_size", [
    "1536x1024", "1024x1536", "48x48", "24x24", "auto", None, "",
])
@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
def test_fit_preserves_original_bytes_and_dimensions(
    requested_size: str | None, image_format: str,
) -> None:
    original = _image_bytes(image_format)

    result = conversation._fit_image_size(original, requested_size)

    assert result is original
    with Image.open(BytesIO(result)) as image:
        assert image.size == (24, 24)
        assert image.format == image_format
        if image_format == "PNG":
            assert image.mode == "RGBA"
            assert image.getpixel((0, 1)) == (12, 34, 56, 0)
            assert image.getpixel((23, 23)) == (0, 255, 0, 127)
            assert image.info["upstream"] == "preserve this original encoding"


@pytest.mark.parametrize("response_format", ["url", "b64_json"])
@pytest.mark.parametrize("requested_size", [
    "1536x1024", "1024x1536", "24x24", "auto", None,
])
@pytest.mark.parametrize("image_format", ["PNG", "JPEG", "WEBP"])
def test_format_image_result_saves_and_returns_original_bytes(
    storage: Mock, response_format: str, requested_size: str | None, image_format: str,
) -> None:
    original = _image_bytes(image_format)
    encoded = base64.b64encode(original).decode("ascii")

    result = conversation.format_image_result(
        [{"b64_json": encoded, "revised_prompt": "upstream prompt"}],
        prompt="request prompt",
        response_format=response_format,
        base_url="https://api.example.test",
        created=123,
        requested_size=requested_size,
    )

    storage.save.assert_called_once_with(original, "https://api.example.test")
    saved_bytes = storage.save.call_args.args[0]
    assert saved_bytes == original
    with Image.open(BytesIO(saved_bytes)) as image:
        assert image.size == (24, 24)
        assert image.format == image_format
    expected_item = {
        "url": "https://images.example.test/original",
        "revised_prompt": "upstream prompt",
    }
    if response_format == "b64_json":
        expected_item["b64_json"] = encoded
        assert base64.b64decode(result["data"][0]["b64_json"]) == saved_bytes
    # Exact response shape also guards against reporting the requested dimensions.
    assert result == {"created": 123, "data": [expected_item]}


def test_format_image_result_without_requested_size(storage: Mock) -> None:
    original = _image_bytes()
    encoded = base64.b64encode(original).decode("ascii")

    result = conversation.format_image_result(
        [{"b64_json": encoded}], prompt="fallback prompt", response_format="b64_json",
    )

    storage.save.assert_called_once_with(original, None)
    assert result["data"][0]["b64_json"] == encoded
    assert result["data"][0]["revised_prompt"] == "fallback prompt"


@pytest.mark.parametrize("original", [b"", b"opaque upstream bytes"])
def test_fit_is_a_passthrough_without_decoding(original: bytes) -> None:
    assert conversation._fit_image_size(original, "1536x1024") is original
