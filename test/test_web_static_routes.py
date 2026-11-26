from pathlib import Path

from fastapi.testclient import TestClient

def test_exported_pages_serve_both_route_spellings(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CHATGPT2API_AUTH_KEY", "web-static-routes-fixture")
    from api import support
    from api.app import create_app

    monkeypatch.setattr(support, "WEB_DIST_DIR", tmp_path)
    (tmp_path / "index.html").write_text("<main>Home</main>", encoding="utf-8")
    for name in ("settings", "image"):
        directory = tmp_path / name
        directory.mkdir()
        (directory / "index.html").write_text(f"<main>{name}</main>", encoding="utf-8")
        (directory / "index.txt").write_text(f"Flight data for {name}", encoding="utf-8")
        segment = directory / f"__next.{name}"
        segment.mkdir()
        (segment / "__PAGE__.txt").write_text(f"Page segment for {name}", encoding="utf-8")
        (directory / f"__next.{name}.__PAGE__.txt").write_text("Stale page segment", encoding="utf-8")
        (tmp_path / f"{name}.txt").write_text("Stale flight data", encoding="utf-8")

    client = TestClient(create_app())
    for name in ("settings", "image"):
        for route in (f"/{name}", f"/{name}/"):
            response = client.get(route)
            assert response.text == f"<main>{name}</main>"
            assert response.headers["cache-control"] == "no-cache"
            assert client.head(route).status_code == 200

        for route in (f"/{name}.txt", f"/{name}/index.txt"):
            response = client.get(route + "?_rsc=fixture")
            assert response.text == f"Flight data for {name}"
            assert response.headers["content-type"].startswith("text/plain")
            assert response.headers["cache-control"] == "no-cache"

        response = client.get(f"/{name}/__next.{name}.__PAGE__.txt")
        assert response.text == f"Page segment for {name}"
        assert response.headers["content-type"].startswith("text/plain")

    assert client.get("/image/__next._tree.txt").status_code == 404
    assert client.get("/_next/static/missing.js").status_code == 404
    assert client.get("/unknown-page").text == "<main>Home</main>"
