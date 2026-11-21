"""deploy_host.py 纯逻辑单元测试（不依赖 Docker）。

被测对象：manifest 校验与路径穿越防护、compose image 修改与字段级 diff 断言、
镜像保留策略、前端写入排序（HTML/sw.js 优先）。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "deploy"))

import deploy_host  # noqa: E402


def make_host(tmp_path: Path) -> deploy_host.Host:
    cfg = {
        "root": str(tmp_path / "opt" / "app"),
        "container": "test-container",
        "service": "app",
        "health_url": "http://127.0.0.1:1/health",
        "disk_min_gb": 0,
        "image_prefix": "chatgpt2api",
        "keep_images": 2,
    }
    release = tmp_path / "release"
    release.mkdir(parents=True, exist_ok=True)
    return deploy_host.Host(cfg, release)


# ===== manifest 校验与路径穿越防护 =====

def test_verify_payload_rejects_traversal(tmp_path: Path) -> None:
    host = make_host(tmp_path)
    import io
    import tarfile

    manifest = {"../escape.txt": "0" * 64}
    (host.release / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with tarfile.open(host.release / "payload.tar.gz", "w:gz") as tar:
        data = b"x"
        info = tarfile.TarInfo("../escape.txt")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))

    with pytest.raises(AssertionError):
        host.verify_payload()


def test_verify_payload_hashes(tmp_path: Path) -> None:
    host = make_host(tmp_path)
    import hashlib
    import io
    import tarfile

    content = b"hello payload"
    sha = hashlib.sha256(content).hexdigest()
    manifest = {"app/VERSION": sha}
    (host.release / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    tar_path = host.release / "payload.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        info = tarfile.TarInfo("app/VERSION")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))

    result = host.verify_payload()
    assert result == manifest
    assert (host.release / "payload" / "app" / "VERSION").read_bytes() == content


def test_verify_payload_detects_hash_mismatch(tmp_path: Path) -> None:
    host = make_host(tmp_path)
    import io
    import tarfile

    manifest = {"app/VERSION": "f" * 64}
    (host.release / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    with tarfile.open(host.release / "payload.tar.gz", "w:gz") as tar:
        info = tarfile.TarInfo("app/VERSION")
        info.size = 5
        tar.addfile(info, io.BytesIO(b"wrong"))
    with pytest.raises(AssertionError):
        host.verify_payload()


# ===== compose image 修改 =====

def make_host_with_compose(tmp_path: Path, compose_name: str, compose_content: str) -> deploy_host.Host:
    host = make_host(tmp_path)
    (host.root).mkdir(parents=True, exist_ok=True)
    compose = host.root / compose_name
    compose.write_text(compose_content, encoding="utf-8")
    host.compose = compose
    host.compose_command = ["docker", "compose", "-f", str(compose), "-p", "test"]
    return host


def test_update_compose_image_json(tmp_path: Path) -> None:
    compose_content = json.dumps({
        "services": {
            "app": {"image": "chatgpt2api:old", "ports": ["3000:80"]},
            "solver": {"image": "ghcr.io/example/solver:latest"},
        }
    })
    host = make_host_with_compose(tmp_path, "compose.json", compose_content)
    host.run = lambda arguments, check=True: compose_content.encode()  # stub 掉 docker compose config

    updated, old_resolved = host.update_compose_image("chatgpt2api:new")

    model = json.loads(updated)
    assert model["services"]["app"]["image"] == "chatgpt2api:new"
    assert model["services"]["solver"]["image"] == "ghcr.io/example/solver:latest"
    assert model["services"]["app"]["ports"] == ["3000:80"]


def test_assert_compose_diff_only_image_passes_on_image_change(tmp_path: Path) -> None:
    compose_content = json.dumps({"services": {"app": {"image": "chatgpt2api:old"}}})
    host = make_host_with_compose(tmp_path, "compose.json", compose_content)
    resolved = {"services": {"app": {"image": "chatgpt2api:new", "ports": ["3000:80"]}}}
    host.run = lambda arguments, check=True: json.dumps(resolved).encode()

    old_resolved = {"services": {"app": {"image": "chatgpt2api:old", "ports": ["3000:80"]}}}
    host.assert_compose_diff_only_image(old_resolved, "chatgpt2api:new")  # 仅 image 变化 → 通过


def test_assert_compose_diff_only_image_rejects_other_changes(tmp_path: Path) -> None:
    compose_content = json.dumps({"services": {"app": {"image": "chatgpt2api:old"}}})
    host = make_host_with_compose(tmp_path, "compose.json", compose_content)

    old_resolved = {"services": {"app": {"image": "chatgpt2api:old", "restart": "unless-stopped"}}}
    resolved_wrong = {"services": {"app": {"image": "chatgpt2api:new", "restart": "always"}}}
    monkey_resolved = json.loads(json.dumps(resolved_wrong))
    monkey = pytest.MonkeyPatch()
    monkey.setattr(host, "run", lambda arguments, check=True: json.dumps(monkey_resolved).encode())
    try:
        with pytest.raises(AssertionError):
            host.assert_compose_diff_only_image(old_resolved, "chatgpt2api:new")
    finally:
        monkey.undo()


# ===== 镜像保留策略 =====

def test_prune_images_keeps_newest_and_used(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    host = make_host(tmp_path)
    current_id = "sha256:current"
    listing = "\n".join([
        "chatgpt2api:1.14.1-20261120 sha256:oldest1 2026-11-01",
        "chatgpt2api:1.14.0 sha256:old2 2026-11-10",
        "chatgpt2api:1.15.0 sha256:new3 2026-11-20",
    ])

    calls: list[list[str]] = []

    def fake_run(arguments: list[str], check: bool = True) -> bytes:
        calls.append(arguments)
        if arguments[:2] == ["docker", "ps"]:
            return b"container1\n"
        if arguments[:2] == ["docker", "inspect"]:
            return json.dumps([{"Image": "sha256:new3"}]).encode()
        if arguments[:2] == ["docker", "images"]:
            return listing.encode()
        if arguments[:2] == ["docker", "rmi"]:
            return b""
        raise AssertionError(f"unexpected command: {arguments}")

    monkeypatch.setattr(host, "run", fake_run)
    removed = host.prune_images(current_id, keep=1)

    assert "chatgpt2api:1.14.1-20261120" in removed
    assert "chatgpt2api:1.14.0" not in removed  # keep=1 保留最新 1 个未使用镜像
    assert any(arguments[:2] == ["docker", "rmi"] and "chatgpt2api:1.14.1-20261120" in arguments for arguments in calls)


# ===== 前端写入排序 =====

def test_copy_in_place_writes_html_and_sw_first(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    host = make_host(tmp_path)
    host.root = tmp_path / "opt" / "app"  # copy_in_place 断言目标是 root/web_dist|root/playground_dist
    source = tmp_path / "payload" / "web_dist"
    destination = host.root / "web_dist"
    source.mkdir(parents=True)
    destination.mkdir(parents=True)

    for name in ("assets/index.js", "index.html", "sw.js"):
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(name, encoding="utf-8")

    order: list[str] = []
    real_replace = __import__("os").replace

    def fake_replace(src, dst):
        order.append(Path(dst).name)
        real_replace(src, dst)

    monkeypatch.setattr(deploy_host.os, "replace", fake_replace)

    host.copy_in_place(source, destination)

    # 语义：hashed 资源先落盘，HTML/sw.js 最后写（保证 HTML 引用的 chunk 一定已存在）
    assert order[0] == "index.js"
    assert order[-2:] == ["index.html", "sw.js"]
    assert (destination / "assets" / "index.js").read_text() == "assets/index.js"
