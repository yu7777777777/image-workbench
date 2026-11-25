from __future__ import annotations

from typing import Any

from services.account_service import account_service
from services.model_service import model_catalog_service
from utils.helper import (
    CODEX_IMAGE_MODEL,
    CODEX_IMAGE_MODELS,
    IMAGE_MODEL_PLAN_TYPES,
    WEB_IMAGE_ACCOUNT_SOURCES,
    looks_like_image_model,
)


def list_models() -> dict[str, Any]:
    catalog = model_catalog_service.list_account_models()
    plans = account_service.available_image_account_plans()
    web_plans = {plan for source, plan in plans if source in WEB_IMAGE_ACCOUNT_SOURCES}
    image_models = {f"{plan}-gpt-image-2" for plan in IMAGE_MODEL_PLAN_TYPES if plan in web_plans}
    if web_plans:
        image_models.add("gpt-image-2")
    if any(("codex", plan) in plans for plan in IMAGE_MODEL_PLAN_TYPES):
        image_models.update(CODEX_IMAGE_MODELS - {CODEX_IMAGE_MODEL})

    data = [
        {**item, "kind": "text"}
        for item in catalog["data"]
        if not looks_like_image_model(item["id"])
        and not item["id"].startswith(("chatgpt_alpha_model_external_access_reserved_gate_", "gpt-audio", "whisper", "tts-"))
    ]
    data.extend({
        "id": model,
        "object": "model",
        "created": 0,
        "owned_by": "chatgpt2api",
        "permission": [],
        "root": model,
        "parent": None,
        "kind": "image",
    } for model in sorted(image_models))
    return {"object": "list", "data": data}
