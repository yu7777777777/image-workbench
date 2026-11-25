from __future__ import annotations

import json
import unittest
from unittest import mock

import requests

from services.protocol import openai_v1_models


AUTH_KEY = "chatgpt2api"
BASE_URL = "http://localhost:8000"


class ModelListTests(unittest.TestCase):
    def test_list_models_only_returns_image_models_backed_by_account_types(self):
        with (
            mock.patch.object(
                openai_v1_models.model_catalog_service,
                "list_account_models",
                return_value={"object": "list", "data": [
                    {"id": "gpt-next"},
                    {"id": "pro-gpt-image-2"},
                    {"id": "gpt-image-2.6"},
                    {"id": "chatgpt_alpha_model_external_access_reserved_gate_12"},
                ]},
            ),
            mock.patch.object(
                openai_v1_models.account_service,
                "available_image_account_plans",
                return_value={("web", "free"), ("web", "team"), ("codex", "team")},
            ),
        ):
            result = openai_v1_models.list_models()

        self.assertEqual({item["id"]: item["kind"] for item in result["data"]}, {
            "gpt-next": "text",
            "gpt-image-2": "image",
            "team-gpt-image-2": "image",
            "gpt-image-2.5": "image",
            "gpt-image-2.5-flare": "image",
            "gpt-image-2.5-sunburst": "image",
        })

    def test_list_models_does_not_return_codex_models_for_web_plus_accounts(self):
        with (
            mock.patch.object(
                openai_v1_models.model_catalog_service,
                "list_account_models",
                return_value={"object": "list", "data": [{"id": "gpt-image-2.5"}]},
            ),
            mock.patch.object(
                openai_v1_models.account_service,
                "available_image_account_plans",
                return_value={("web", "plus")},
            ),
        ):
            result = openai_v1_models.list_models()

        ids = {item["id"] for item in result["data"]}
        self.assertEqual(ids, {"gpt-image-2", "plus-gpt-image-2"})

    def test_list_models_function(self):
        """测试直接调用服务层获取模型列表。"""
        result = openai_v1_models.list_models()
        print("function result:")
        print(json.dumps(result, ensure_ascii=False, indent=2))

    def test_list_models_http(self):
        """测试通过 HTTP 接口获取模型列表。"""
        response = requests.get(
            f"{BASE_URL}/v1/models",
            headers={"Authorization": f"Bearer {AUTH_KEY}"},
            timeout=30,
        )
        print("http status:")
        print(response.status_code)
        print("http result:")
        print(json.dumps(response.json(), ensure_ascii=False, indent=2))
