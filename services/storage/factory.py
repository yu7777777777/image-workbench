from __future__ import annotations

import os
from pathlib import Path

from services.storage.base import StorageBackend
from services.storage.database_storage import DatabaseStorageBackend
from services.storage.json_storage import JSONStorageBackend


def create_storage_backend(data_dir: Path) -> StorageBackend:
    """Create a JSON or database storage backend."""
    backend_type = os.getenv("STORAGE_BACKEND", "json").lower().strip()
    print(f"[storage] Initializing storage backend: {backend_type}")

    if backend_type == "json":
        file_path = data_dir / "accounts.json"
        auth_keys_path = data_dir / "auth_keys.json"
        print(f"[storage] Using JSON storage: {file_path}")
        return JSONStorageBackend(file_path, auth_keys_path)

    if backend_type in ("sqlite", "postgres", "postgresql", "mysql", "database"):
        database_url = os.getenv("DATABASE_URL", "").strip()
        if not database_url:
            database_url = f"sqlite:///{data_dir / 'accounts.db'}"
            print(f"[storage] No DATABASE_URL provided, using local SQLite: {database_url}")
        else:
            print(f"[storage] Using database storage: {_mask_password(database_url)}")
        return DatabaseStorageBackend(database_url)

    raise ValueError(
        f"Unknown storage backend: {backend_type}. "
        "Supported backends: json, sqlite, postgres"
    )


def _mask_password(url: str) -> str:
    """Mask a database password in logs."""
    if "://" not in url:
        return url
    try:
        protocol, rest = url.split("://", 1)
        if "@" in rest:
            credentials, host = rest.split("@", 1)
            if ":" in credentials:
                username, _ = credentials.split(":", 1)
                return f"{protocol}://{username}:****@{host}"
        return url
    except Exception:
        return url
