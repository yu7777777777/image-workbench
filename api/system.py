from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, ConfigDict

from api.support import require_admin, require_identity, resolve_image_base_url
from services.backup_service import BackupError, backup_service
from services.config import BASE_DIR, config
from services.image_service import (
    cleanup_by_age,
    compress_images,
    delete_images,
    delete_to_target,
    download_images_zip,
    get_image_download_response,
    get_image_response,
    get_thumbnail_response,
    list_images,
    storage_stats,
)
from services.image_storage_service import ImageStorageError, image_storage_service
from services.image_tags_service import delete_tag, get_all_tags, set_tags
from services.log_service import log_service
from services.proxy_service import proxy_settings, test_clearance, test_proxy


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class UpgradeRequest(BaseModel):
    version: str


# ===== 半自动升级助手（容器写触发文件，宿主机 server_upgrader.py 消费） =====

UPGRADE_TRIGGER_RELPATH = Path("data/upgrade/upgrade-request.json")
UPGRADE_RESULT_RELPATH = Path("data/upgrade/upgrade-result.json")
UPGRADE_GITHUB_REPO = "yu7777777777/image-workbench"


def _upgrade_paths() -> tuple[Path, Path]:
    base = Path(BASE_DIR)
    return base / UPGRADE_TRIGGER_RELPATH, base / UPGRADE_RESULT_RELPATH


def _github_latest_version() -> str | None:
    try:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{UPGRADE_GITHUB_REPO}/releases/latest",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "chatgpt2api-upgrade-check"},
        )
        with urllib.request.urlopen(request, timeout=8) as resp:
            tag = str(json.load(resp).get("tag_name") or "")
        return tag.lstrip("v") or None
    except Exception:
        return None


def _github_release_exists(version: str) -> bool:
    try:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{UPGRADE_GITHUB_REPO}/releases/tags/v{version}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "chatgpt2api-upgrade-check"},
        )
        with urllib.request.urlopen(request, timeout=8) as resp:
            return bool(json.load(resp).get("assets"))
    except Exception:
        return False


class ProxyTestRequest(BaseModel):
    url: str = ""


class ClearanceTestRequest(BaseModel):
    target_url: str = "https://chatgpt.com"


class FetchExternalModelsRequest(BaseModel):
    base_url: str = ""
    api_key: str = ""
    provider: str = "openai"


class TestExternalModelRequest(FetchExternalModelsRequest):
    model: str = ""


def _fetch_external_models_sync(base_url: str, api_key: str, provider: str = "openai") -> list[str]:
    if provider == "fal":
        return [
            "fal-ai/flux/schnell",
            "fal-ai/flux/dev",
            "fal-ai/flux-pro",
            "fal-ai/flux-realism",
            "fal-ai/stable-diffusion-v35-large",
            "fal-ai/recraft-v3",
            "fal-ai/ideogram/v2",
        ]

    clean_base = base_url.strip().rstrip("/")
    if not clean_base:
        return []

    headers: dict[str, str] = {}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"

    urls: list[str] = []
    if clean_base.endswith("/v1"):
        urls.append(f"{clean_base}/models")
        urls.append(f"{clean_base[:-3]}/models")
    else:
        urls.append(f"{clean_base}/models")
        urls.append(f"{clean_base}/v1/models")

    from curl_cffi import requests
    last_err: Exception | None = None
    for url in urls:
        try:
            resp = requests.get(url, headers=headers, timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                models: list[str] = []
                if isinstance(data, dict):
                    items = data.get("data") or data.get("models") or []
                    if isinstance(items, list):
                        for item in items:
                            if isinstance(item, dict) and "id" in item:
                                models.append(str(item["id"]))
                            elif isinstance(item, str):
                                models.append(item)
                elif isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "id" in item:
                            models.append(str(item["id"]))
                        elif isinstance(item, str):
                            models.append(item)
                if models:
                    return sorted(list(set(models)))
            else:
                last_err = Exception(f"HTTP {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            last_err = e
            continue

    if last_err:
        raise ValueError(f"拉取模型失败: {last_err}")
    return []


class ImageDeleteRequest(BaseModel):
    paths: list[str] = []
    start_date: str = ""
    end_date: str = ""
    all_matching: bool = False

class ImageDownloadRequest(BaseModel):
    paths: list[str]

class ImageTagsRequest(BaseModel):
    path: str
    tags: list[str]

class LogDeleteRequest(BaseModel):
    ids: list[str] = []

class LogCleanupRequest(BaseModel):
    days: int = 30
class BackupDeleteRequest(BaseModel):
    key: str = ""


def create_router(app_version: str) -> APIRouter:
    router = APIRouter()

    @router.post("/auth/login")
    async def login(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return {
            "ok": True,
            "version": app_version,
            "role": identity.get("role"),
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
        }

    @router.get("/version")
    async def get_version():
        return {"version": app_version}

    @router.get("/api/settings")
    async def get_settings(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"config": config.get()}

    @router.get("/api/third-party-apps")
    async def get_third_party_apps(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        return {"third_party_apps": config.get_third_party_apps_settings()}

    @router.get("/api/shared-profiles")
    async def get_public_shared_profiles(authorization: str | None = Header(default=None)) -> dict[str, list[dict[str, object]]]:
        require_identity(authorization)
        return {"shared_profiles": config.get_shared_profiles(enabled_only=True)}

    @router.post("/api/external/fetch-models")
    async def fetch_external_models_endpoint(body: FetchExternalModelsRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            models = await run_in_threadpool(_fetch_external_models_sync, body.base_url, body.api_key, body.provider)
            return {"models": models}
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/external/test-model")
    async def test_external_model_endpoint(body: TestExternalModelRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        model = body.model.strip()
        if not model:
            raise HTTPException(status_code=400, detail={"error": "请填写模型 ID"})
        try:
            models = await run_in_threadpool(_fetch_external_models_sync, body.base_url, body.api_key, body.provider)
            if model not in models:
                return {"ok": False, "model": model, "models_count": len(models), "error": "接口可访问，但模型列表中未找到该模型"}
            return {"ok": True, "model": model, "models_count": len(models)}
        except Exception as exc:
            return {"ok": False, "model": model, "models_count": 0, "error": str(exc)}

    @router.post("/api/settings")
    async def save_settings(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"config": config.update(body.model_dump(mode="python"))}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    # ===== 半自动升级（提示 → 管理员确认 → 宿主机 server_upgrader 执行） =====

    @router.get("/api/system/upgrade/status")
    async def upgrade_status(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        trigger, result = _upgrade_paths()
        latest = await run_in_threadpool(_github_latest_version)
        last_result = None
        if result.exists():
            try:
                last_result = json.loads(result.read_text(encoding="utf-8"))
            except Exception:
                last_result = None
        return {
            "current_version": app_version,
            "latest_version": latest,
            "request_pending": trigger.exists(),
            "last_result": last_result,
        }

    @router.post("/api/system/upgrade")
    async def trigger_upgrade(body: UpgradeRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        version = body.version.strip().lstrip("v")
        if not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise HTTPException(status_code=400, detail={"error": f"版本号格式不正确: {version}"})
        exists = await run_in_threadpool(_github_release_exists, version)
        if not exists:
            raise HTTPException(status_code=400, detail={"error": f"GitHub 上不存在 v{version} 的 Release，无法升级"})
        trigger, result = _upgrade_paths()
        trigger.parent.mkdir(parents=True, exist_ok=True)
        # 发起新升级或重试升级时清理旧结果文件，避免前端轮询立刻读到上一次同版本的失败记录。
        result.unlink(missing_ok=True)
        trigger.write_text(
            json.dumps({"version": version, "requested_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False),
            encoding="utf-8",
        )
        return JSONResponse(
            status_code=202,
            content={"accepted": True, "version": version, "message": "升级请求已受理，宿主机升级器将在一分钟内执行，可稍后刷新查看结果"},
        )

    @router.get("/api/images")
    async def get_images(request: Request, start_date: str = "", end_date: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(
            list_images,
            resolve_image_base_url(request),
            start_date.strip(),
            end_date.strip(),
        )

    @router.get("/images/{image_path:path}", include_in_schema=False)
    async def get_image(image_path: str):
        return await run_in_threadpool(get_image_response, image_path)

    @router.get("/image-thumbnails/{image_path:path}", include_in_schema=False)
    async def get_image_thumbnail(image_path: str):
        return await run_in_threadpool(get_thumbnail_response, image_path)

    @router.post("/api/images/delete")
    async def delete_images_endpoint(body: ImageDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(
            delete_images,
            body.paths,
            body.start_date.strip(),
            body.end_date.strip(),
            body.all_matching,
        )

    @router.post("/api/images/download")
    async def download_images_endpoint(body: ImageDownloadRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        buf = await run_in_threadpool(download_images_zip, body.paths)
        return StreamingResponse(
            buf,
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="images.zip"'},
        )

    @router.get("/api/images/download/{image_path:path}")
    async def download_single_image_endpoint(image_path: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(get_image_download_response, image_path)

    @router.get("/api/logs")
    async def get_logs(type: str = "", start_date: str = "", end_date: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        items = await run_in_threadpool(
            log_service.list,
            type.strip(),
            start_date.strip(),
            end_date.strip(),
        )
        return {"items": items}

    @router.post("/api/logs/delete")
    async def delete_logs(body: LogDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(log_service.delete, body.ids)

    @router.post("/api/logs/cleanup")
    async def cleanup_logs(body: LogCleanupRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return await run_in_threadpool(log_service.cleanup_before, body.days, type="account")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/proxy/test")
    async def test_proxy_endpoint(body: ProxyTestRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"result": await run_in_threadpool(test_proxy, (body.url or "").strip())}

    @router.get("/api/proxy/runtime")
    async def get_proxy_runtime_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {
            "runtime": config.get_public_proxy_runtime_settings(),
            "status": proxy_settings.get_runtime_status(),
        }

    @router.post("/api/proxy/runtime")
    async def save_proxy_runtime_endpoint(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            config.update({"proxy_runtime": body.model_dump(mode="python")})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {
            "runtime": config.get_public_proxy_runtime_settings(),
            "status": proxy_settings.get_runtime_status(),
        }

    @router.post("/api/proxy/clearance/test")
    async def test_proxy_clearance_endpoint(body: ClearanceTestRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"result": await run_in_threadpool(test_clearance, body.target_url)}

    @router.get("/api/storage/info")
    async def get_storage_info(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        storage = config.get_storage_backend()
        return {
            "backend": storage.get_backend_info(),
            "health": storage.health_check(),
        }

    @router.post("/api/backup/test")
    async def test_backup_connection(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(backup_service.test_connection)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/image-storage/test")
    async def test_image_storage_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"result": await run_in_threadpool(image_storage_service.test_webdav)}

    @router.post("/api/image-storage/sync")
    async def sync_image_storage_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(image_storage_service.sync_all)}
        except ImageStorageError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups")
    async def get_backups(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {
                "items": await run_in_threadpool(backup_service.list_backups),
                "state": backup_service.get_status(),
                "settings": backup_service.get_settings(),
            }
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/run")
    async def run_backup_endpoint(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(backup_service.run_backup)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/backups/delete")
    async def delete_backup_endpoint(body: BackupDeleteRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            await run_in_threadpool(backup_service.delete_backup, body.key)
            return {"ok": True}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups/detail")
    async def get_backup_detail(key: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"item": await run_in_threadpool(backup_service.get_backup_detail, key)}
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/backups/download")
    async def download_backup_endpoint(key: str = "", authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            item = await run_in_threadpool(backup_service.download_backup, key)
        except BackupError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        filename = str(item.get("name") or "backup.bin")
        quoted = quote(filename)
        headers = {
            "Content-Disposition": f"attachment; filename*=UTF-8''{quoted}",
            "Content-Length": str(int(item.get("size") or 0)),
        }
        return Response(
            content=bytes(item.get("payload") or b""),
            media_type=str(item.get("content_type") or "application/octet-stream"),
            headers=headers,
        )


    @router.get("/api/images/tags")
    async def list_image_tags(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"tags": get_all_tags()}

    @router.post("/api/images/tags")
    async def update_image_tags(body: ImageTagsRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        rel = body.path.strip().lstrip("/")
        if not rel:
            raise HTTPException(status_code=400, detail={"error": "path is required"})
        tags = set_tags(rel, body.tags)
        return {"ok": True, "tags": tags}

    @router.delete("/api/images/tags/{tag}")
    async def delete_image_tag(tag: str, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        count = delete_tag(tag)
        return {"ok": True, "removed_from": count}

    @router.get("/api/images/storage")
    async def get_image_storage(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return storage_stats()

    @router.post("/api/images/storage/compress")
    async def compress_all_images(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return await run_in_threadpool(compress_images)

    @router.post("/api/images/storage/cleanup-by-age")
    async def cleanup_by_age_endpoint(
        days: int = Query(default=0, ge=0),
        dry_run: bool = Query(default=False),
        authorization: str | None = Header(default=None),
    ) -> dict[str, object]:
        require_admin(authorization)
        effective_days = days if days > 0 else config.image_retention_days
        return await run_in_threadpool(cleanup_by_age, effective_days, dry_run)
    @router.post("/api/images/storage/cleanup-to-target")
    async def cleanup_to_target(
        target_free_mb: int = 500,
        dry_run: bool = False,
        authorization: str | None = Header(default=None),
    ):
        require_admin(authorization)
        return await run_in_threadpool(delete_to_target, target_free_mb, dry_run)

    @router.get("/health", response_model=None)
    async def health_dashboard(format: str = Query(default="html")):
        from services.account_service import account_service as acct_svc
        stats = acct_svc.get_stats()
        storage = config.get_storage_backend()
        storage_health = storage.health_check()
        healthy = stats["active"] > 0

        stats_json = {
            "status": "ok" if healthy else "degraded",
            "healthy": healthy,
            "version": app_version,
            "storage": {"backend": storage.get_backend_info(), "health": storage_health},
            "proxy_runtime": proxy_settings.get_runtime_status(),
            "accounts": stats,
        }
        if format == "json":
            return stats_json
        return HTMLResponse(f"""<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>号池健康监控 - AI 创作平台</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh}}
.header{{background:#1a1d27;border-bottom:1px solid #2a2d3a;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}}
.header h1{{font-size:20px}}
.status-dot{{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}}
.status-ok{{background:#22c55e;box-shadow:0 0 8px #22c55e88}}
.status-degraded{{background:#f59e0b;box-shadow:0 0 8px #f59e0b88}}
.container{{max-width:960px;margin:0 auto;padding:24px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px}}
.card{{background:#1a1d27;border:1px solid #2a2d3a;border-radius:10px;padding:16px}}
.card .value{{font-size:28px;font-weight:700;margin:4px 0}}
.card .label{{font-size:13px;color:#94a3b8}}
.green{{color:#22c55e}}.yellow{{color:#f59e0b}}.red{{color:#ef4444}}.blue{{color:#6c63ff}}
table{{width:100%;border-collapse:collapse;background:#1a1d27;border:1px solid #2a2d3a;border-radius:10px;overflow:hidden}}
th{{background:#242836;font-weight:600;text-align:left;padding:10px 12px;font-size:12px;color:#94a3b8;text-transform:uppercase}}
td{{padding:8px 12px;border-top:1px solid #2a2d3a;font-size:14px}}tr:hover td{{background:rgba(108,99,255,.05)}}
.api-url{{font-family:monospace;font-size:12px;color:#6c63ff}}
.refresh{{font-size:12px;color:#64748b;text-align:center;margin-top:24px}}
</style>
<meta http-equiv="refresh" content="30">
</head>
<body>
<div class="header">
<h1><span class="status-dot {'status-ok' if healthy else 'status-degraded'}"></span>号池健康监控</h1>
<div style="font-size:13px;color:#94a3b8">v{app_version} · 30s 自动刷新</div>
</div>
<div class="container">
<div class="cards">
<div class="card"><div class="label">号池状态</div><div class="value {'green' if healthy else 'yellow'}">{'正常' if healthy else '异常'}</div></div>
<div class="card"><div class="label">当前账号</div><div class="value blue">{stats['total']}</div></div>
<div class="card"><div class="label">累计入库</div><div class="value">{stats['cumulative_total']}</div></div>
<div class="card"><div class="label">可用账号</div><div class="value green">{stats['active']}</div></div>
<div class="card"><div class="label">剩余额度</div><div class="value">{stats['total_quota']}</div></div>
<div class="card"><div class="label">限流</div><div class="value yellow">{stats['limited']}</div></div>
<div class="card"><div class="label">异常</div><div class="value red">{stats['abnormal']}</div></div>
<div class="card"><div class="label">禁用</div><div class="value">{stats['disabled']}</div></div>
<div class="card"><div class="label">成功/失败</div><div class="value">{stats['total_success']}<span style="font-size:18px;color:#94a3b8">/</span><span class="red">{stats['total_fail']}</span></div></div>
</div>
<h2 style="margin-bottom:12px;font-size:16px">账号类型分布</h2>
<table>
<tr><th>类型</th><th>数量</th></tr>
{''.join(f'<tr><td>{t}</td><td>{c}</td></tr>' for t,c in sorted(stats['by_type'].items()))}
</table>
<div class="refresh">JSON: <span class="api-url">/health?format=json</span></div>
</div></body></html>""")

    return router
