from __future__ import annotations

from io import BytesIO
from typing import Any, Iterator

from PIL import Image

from services.config import config
from services.image_comments import normalize_image_comments
from services.image_markup import composite_markup_images, normalize_markup_strokes
from services.protocol.conversation import (
    ConversationRequest,
    ImageGenerationError,
    collect_image_outputs,
    count_text_tokens,
    encode_images,
    stream_image_chunks,
    stream_image_outputs_with_pool,
)
from utils.image_tokens import count_image_inputs_tokens, count_image_output_items_tokens, image_usage


def _composite_mask(
    images: list[tuple[bytes, str, str]],
    masks: list[tuple[bytes, str, str]],
) -> list[tuple[bytes, str, str]]:
    """将 mask 的 alpha 通道合成到图片中，标识需要编辑的区域。
    
    mask 的透明区域（低 alpha）= 需要编辑的区域，
    mask 的不透明区域（高 alpha）= 保留的区域。
    如果无 mask 则返回原图。
    """
    if not masks:
        return images
    result: list[tuple[bytes, str, str]] = []
    for i, (data, filename, mime_type) in enumerate(images):
        mask_data = masks[i][0] if i < len(masks) else masks[-1][0]
        img = Image.open(BytesIO(data)).convert("RGBA")
        mask_img = Image.open(BytesIO(mask_data))
        if mask_img.mode == "RGBA":
            alpha = mask_img.split()[3]
        elif mask_img.mode == "L":
            alpha = mask_img
        else:
            alpha = mask_img.convert("L")
        alpha = alpha.resize(img.size, Image.LANCZOS)
        img.putalpha(alpha)
        buf = BytesIO()
        img.save(buf, format="PNG")
        result.append((buf.getvalue(), filename, "image/png"))
    return result


def build_request(body: dict[str, Any]) -> ConversationRequest:
    """把 OpenAI 兼容的图片编辑请求体归一化为 ConversationRequest。

    负责评论锚点、标注笔迹与 mask 的归一化和像素合成，非法输入抛
    ImageGenerationError（400），供 handle() 与测试直接复用。
    注意：为保持与网页端抓包一致的语义，标注笔迹/覆盖层会被合成进输入图，
    同时把 body 中的 images/mask/markup 就地清空，避免下游重复上传原始素材。
    """
    prompt = str(body.get("prompt") or "")
    images = body.get("images") or []
    masks = body.get("mask") or []
    images = _composite_mask(images, masks)
    try:
        comments = normalize_image_comments(body.get("comments"))
    except ValueError as exc:
        raise ImageGenerationError(
            str(exc),
            status_code=400,
            error_type="invalid_request_error",
            code="invalid_image_comments",
        ) from exc
    try:
        markup_strokes = normalize_markup_strokes(body.get("markup_strokes"))
    except ValueError as exc:
        raise ImageGenerationError(
            str(exc),
            status_code=400,
            error_type="invalid_request_error",
            code="invalid_image_markup",
        ) from exc
    markup_overlays = body.get("markup") or []
    markup = bool(markup_overlays or markup_strokes)
    if markup:
        # 网页端「标注」编辑：把笔迹合成进输入图像素后再走普通编辑链路
        images = composite_markup_images(images, markup_overlays, markup_strokes)
        # 笔迹已进入像素，原始 overlay 引用不再向下游传递
        body["markup"] = []
    encoded_images = encode_images(images)
    if not encoded_images:
        raise ImageGenerationError("image is required")
    # 图片已编码进 request，避免任务层重复持有原始素材
    body["images"] = []
    if masks:
        body["mask"] = []
    return ConversationRequest(
        prompt=prompt,
        model=str(body.get("model") or "gpt-image-2"),
        n=int(body.get("n") or 1),
        size=body.get("size"),
        quality=str(body.get("quality") or "auto"),
        response_format=str(body.get("response_format") or config.image_response_format),
        base_url=str(body.get("base_url") or "") or None,
        images=encoded_images,
        message_as_error=True,
        progress_callback=body.get("progress_callback"),
        comments=comments,
        markup=markup,
    )


def handle(body: dict[str, Any]) -> dict[str, Any] | Iterator[dict[str, Any]]:
    request = build_request(body)
    outputs = stream_image_outputs_with_pool(request)
    if body.get("stream"):
        return stream_image_chunks(outputs)
    result = collect_image_outputs(outputs)
    result["usage"] = image_usage(
        input_text_tokens=count_text_tokens(request.prompt, request.model),
        input_image_tokens=count_image_inputs_tokens(request.images or [], request.model),
        output_tokens=count_image_output_items_tokens(result.get("data"), request.size, request.quality),
    )
    return result
