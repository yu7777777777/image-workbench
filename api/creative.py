from __future__ import annotations

import base64
import binascii
import io
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field, StringConstraints, model_validator

from api.support import require_admin
from services.config import DATA_DIR

CreativeKind = Literal["prompt", "style", "skill"]
MAX_COVER_BYTES = 5 * 1024 * 1024
MAX_EXAMPLES = 6
EncodedImage = Annotated[str, StringConstraints(max_length=(MAX_COVER_BYTES + 2) // 3 * 4)]
ITEM_COLUMNS = """
    creative_items.id, kind, title, content, updated_at, cover IS NOT NULL AS has_cover,
    (SELECT group_concat(id) FROM (
        SELECT id FROM creative_examples WHERE item_id = creative_items.id ORDER BY position
    )) AS example_ids
"""
ITEM_WITH_FAVORITE = f"{ITEM_COLUMNS}, creative_favorites.item_id IS NOT NULL AS is_favorite"
ITEMS_BY_OWNER = """
    FROM creative_items
    LEFT JOIN creative_favorites ON creative_favorites.item_id = creative_items.id
        AND creative_favorites.owner_id = ?
"""


class ExampleInput(BaseModel):
    id: UUID | None = None
    data: EncodedImage | None = None

    @model_validator(mode="after")
    def validate_source(self):
        if (self.id is None) == (self.data is None):
            raise ValueError("请选择已有示例图或上传图片")
        return self


class CreativeInput(BaseModel):
    kind: CreativeKind
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] = ""
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=16_000)]
    cover: EncodedImage | None = None
    examples: Annotated[list[ExampleInput], Field(max_length=MAX_EXAMPLES)] | None = None


class FavoriteInput(BaseModel):
    favorite: bool


def _admin(authorization: str | None = Header(default=None)) -> str:
    return str(require_admin(authorization)["id"])


AdminOwner = Annotated[str, Depends(_admin)]


def _encode_cover(value: str | None) -> bytes | None:
    if value is None:
        return None
    try:
        raw = base64.b64decode(value, validate=True)
        if len(raw) > MAX_COVER_BYTES:
            raise ValueError
        with Image.open(io.BytesIO(raw), formats=["JPEG", "PNG", "WEBP"]) as source:
            if source.width * source.height > 25_000_000:
                raise ValueError
            image = ImageOps.exif_transpose(source)
            image.thumbnail((960, 960))
            output = io.BytesIO()
            image.convert("RGBA").save(output, "WEBP", quality=86)
            return output.getvalue()
    except (ValueError, OSError, binascii.Error, Image.DecompressionBombError) as exc:
        raise HTTPException(422, detail={"error": "请选择不超过 5 MB、2500 万像素的 JPG、PNG 或 WebP 图片"}) from exc


def _item(row: sqlite3.Row) -> dict:
    item = dict(row)
    examples = item.pop("example_ids")
    item["example_ids"] = examples.split(",") if examples else []
    item["kind"] = "prompt" if row["kind"] == "style" else row["kind"]
    text = " ".join(row["content"].split())
    item["display_title"] = row["title"] or (text[:28] + "…" if len(text) > 28 else text)
    item["has_cover"] = bool(row["has_cover"])
    item["is_favorite"] = bool(row["is_favorite"])
    return item


def _prepare_examples(payload: CreativeInput) -> list[tuple[str, bytes | None]] | None:
    if payload.examples is not None:
        return [
            (str(image.id), None) if image.id else (str(uuid4()), _encode_cover(image.data))
            for image in payload.examples
        ]
    if "cover" in payload.model_fields_set:
        cover = _encode_cover(payload.cover)
        return [(str(uuid4()), cover)] if cover is not None else []
    return None


def _replace_examples(connection: sqlite3.Connection, item_id: UUID, examples: list[tuple[str, bytes | None]] | None):
    if examples is None:
        return
    identifier = str(item_id)
    existing = dict(connection.execute("SELECT id, image FROM creative_examples WHERE item_id = ?", (identifier,)))
    images = [(image_id, data if data is not None else existing.get(image_id)) for image_id, data in examples]
    if any(data is None for _, data in images) or len({image_id for image_id, _ in images}) != len(images):
        raise HTTPException(422, detail={"error": "示例图不存在或重复，请重新选择"})
    connection.execute("DELETE FROM creative_examples WHERE item_id = ?", (identifier,))
    connection.executemany(
        "INSERT INTO creative_examples (id, item_id, position, image) VALUES (?, ?, ?, ?)",
        [(image_id, identifier, index, data) for index, (image_id, data) in enumerate(images)],
    )
    # Keep the cover column readable by an older build when rolling back.
    connection.execute("UPDATE creative_items SET cover = ? WHERE id = ?", (images[0][1] if images else None, identifier))


def create_router(db_path: Path = DATA_DIR / "creative.db") -> APIRouter:
    router = APIRouter(prefix="/api/creative", dependencies=[Depends(_admin)])

    @contextmanager
    def connect():
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            with connection:
                connection.execute("""
                    CREATE TABLE IF NOT EXISTS creative_items (
                        id TEXT PRIMARY KEY,
                        kind TEXT NOT NULL,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        cover BLOB,
                        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                    )
                """)
                connection.execute("""
                    CREATE TABLE IF NOT EXISTS creative_favorites (
                        owner_id TEXT NOT NULL,
                        item_id TEXT NOT NULL REFERENCES creative_items(id) ON DELETE CASCADE,
                        PRIMARY KEY (owner_id, item_id)
                    )
                """)
                connection.execute("CREATE INDEX IF NOT EXISTS creative_favorites_item ON creative_favorites(item_id)")
                connection.execute("""
                    CREATE TABLE IF NOT EXISTS creative_examples (
                        id TEXT PRIMARY KEY,
                        item_id TEXT NOT NULL REFERENCES creative_items(id) ON DELETE CASCADE,
                        position INTEGER NOT NULL,
                        image BLOB NOT NULL,
                        UNIQUE (item_id, position)
                    )
                """)
                if connection.execute("PRAGMA user_version").fetchone()[0] < 1:
                    connection.execute("BEGIN IMMEDIATE")
                    if connection.execute("PRAGMA user_version").fetchone()[0] < 1:
                        connection.execute("""
                            INSERT INTO creative_examples (id, item_id, position, image)
                            SELECT id, id, 0, cover FROM creative_items WHERE cover IS NOT NULL
                        """)
                        connection.execute("PRAGMA user_version = 1")
                    connection.commit()
                yield connection
        finally:
            connection.close()

    def get_item(connection: sqlite3.Connection, item_id: UUID, owner: str) -> dict:
        row = connection.execute(
            f"SELECT {ITEM_WITH_FAVORITE} {ITEMS_BY_OWNER} WHERE creative_items.id = ?", (owner, str(item_id)),
        ).fetchone()
        if row is None:
            raise HTTPException(404, detail={"error": "此条目已删除或不存在"})
        return _item(row)

    @router.get("")
    def list_items(owner: AdminOwner, kind: CreativeKind | None = None, favorites_only: bool = False):
        with connect() as connection:
            return {"items": [_item(row) for row in connection.execute(
                f"""SELECT {ITEM_WITH_FAVORITE} {ITEMS_BY_OWNER}
                    WHERE (? IS NULL OR kind = ? OR (? = 'prompt' AND kind = 'style'))
                        AND (? = 0 OR creative_favorites.item_id IS NOT NULL)
                    ORDER BY updated_at DESC, creative_items.id""",
                (owner, kind, kind, kind, favorites_only),
            )]}

    @router.post("", status_code=201)
    def create_item(payload: CreativeInput, owner: AdminOwner):
        item_id = uuid4()
        examples = _prepare_examples(payload)
        with connect() as connection:
            connection.execute(
                "INSERT INTO creative_items (id, kind, title, content) VALUES (?, ?, ?, ?)",
                (str(item_id), "prompt" if payload.kind == "style" else payload.kind, payload.title, payload.content),
            )
            _replace_examples(connection, item_id, examples)
            return get_item(connection, item_id, owner)

    @router.get("/{item_id}")
    def read_item(item_id: UUID, owner: AdminOwner):
        with connect() as connection:
            return get_item(connection, item_id, owner)

    @router.put("/{item_id}")
    def update_item(item_id: UUID, payload: CreativeInput, owner: AdminOwner):
        examples = _prepare_examples(payload)
        with connect() as connection:
            updated = connection.execute("""
                UPDATE creative_items SET kind = ?, title = ?, content = ?,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
            """, ("prompt" if payload.kind == "style" else payload.kind, payload.title, payload.content, str(item_id)))
            if not updated.rowcount:
                raise HTTPException(404, detail={"error": "此条目已删除或不存在"})
            _replace_examples(connection, item_id, examples)
            return get_item(connection, item_id, owner)

    @router.put("/{item_id}/favorite", status_code=204)
    def set_favorite(item_id: UUID, payload: FavoriteInput, owner: AdminOwner):
        with connect() as connection:
            if payload.favorite:
                connection.execute("""
                    INSERT INTO creative_favorites (owner_id, item_id)
                    SELECT ?, id FROM creative_items WHERE id = ?
                    ON CONFLICT (owner_id, item_id) DO NOTHING
                """, (owner, str(item_id)))
                get_item(connection, item_id, owner)
            else:
                connection.execute("DELETE FROM creative_favorites WHERE owner_id = ? AND item_id = ?", (owner, str(item_id)))
        return Response(status_code=204)

    @router.delete("/{item_id}", status_code=204)
    def delete_item(item_id: UUID):
        with connect() as connection:
            if not connection.execute("DELETE FROM creative_items WHERE id = ?", (str(item_id),)).rowcount:
                raise HTTPException(404, detail={"error": "此条目已删除或不存在"})
        return Response(status_code=204)

    @router.get("/{item_id}/cover")
    def read_cover(item_id: UUID):
        with connect() as connection:
            row = connection.execute("SELECT cover FROM creative_items WHERE id = ?", (str(item_id),)).fetchone()
        if row is None or row["cover"] is None:
            raise HTTPException(404, detail={"error": "此条目没有示例图"})
        return Response(row["cover"], media_type="image/webp", headers={"Cache-Control": "private, no-store"})

    @router.get("/{item_id}/examples/{example_id}")
    def read_example(item_id: UUID, example_id: UUID):
        with connect() as connection:
            row = connection.execute(
                "SELECT image FROM creative_examples WHERE item_id = ? AND id = ?", (str(item_id), str(example_id)),
            ).fetchone()
        if row is None:
            raise HTTPException(404, detail={"error": "示例图已删除或不存在"})
        return Response(row["image"], media_type="image/webp", headers={"Cache-Control": "private, no-store"})

    return router
