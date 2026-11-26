from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "deploy"))

import deploy_host  # noqa: E402


class TestDeployHostPrune(unittest.TestCase):
    def _make_host(self, root: Path, release_name: str, keep_releases: int = 1) -> deploy_host.Host:
        releases_dir = root / "releases"
        release_dir = releases_dir / release_name
        release_dir.mkdir(parents=True, exist_ok=True)
        cfg = {
            "root": str(root),
            "container": "chatgpt2api-trial-app",
            "keep_images": 0,
            "keep_releases": keep_releases,
        }
        return deploy_host.Host(cfg, release_dir)

    def test_prune_releases_keeps_only_current_and_cleans_temp_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            releases = root / "releases"
            old1 = releases / "1.16.26-20261125"
            old2 = releases / "1.16.27-20261125"
            current = releases / "1.16.33-20261126"
            for d in (old1, old2, current):
                (d / "rollback").mkdir(parents=True)
                (d / "rollback" / "accounts.db.sqlite").write_bytes(b"db")
            (current / "payload" / "app").mkdir(parents=True)
            (current / "payload" / "app" / "VERSION").write_text("1.16.33", encoding="utf-8")
            (current / "build" / "app").mkdir(parents=True)
            (current / "deployment-result.json").write_text("{}", encoding="utf-8")
            # Unrelated file inside releases root should remain untouched
            marker = releases / "README.txt"
            marker.write_text("keep", encoding="utf-8")

            host = self._make_host(root, "1.16.33-20261126", keep_releases=1)
            report = host.prune_releases(1)

            self.assertEqual(set(report["cleaned_temp_dirs"]), {"payload", "build"})
            self.assertEqual(set(report["removed_releases"]), {"1.16.26-20261125", "1.16.27-20261125"})
            self.assertFalse(old1.exists())
            self.assertFalse(old2.exists())
            self.assertTrue(current.exists())
            self.assertFalse((current / "payload").exists())
            self.assertFalse((current / "build").exists())
            self.assertTrue((current / "rollback" / "accounts.db.sqlite").exists())
            self.assertTrue((current / "deployment-result.json").exists())
            self.assertTrue(marker.exists())

    def test_prune_releases_respects_keep_count(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            releases = root / "releases"
            oldest = releases / "1.16.24-20261124"
            recent = releases / "1.16.27-20261125"
            current = releases / "1.16.33-20261126"
            for d in (oldest, recent, current):
                d.mkdir(parents=True)
            os.utime(oldest, (1_700_000_000, 1_700_000_000))
            os.utime(recent, (1_700_001_000, 1_700_001_000))
            os.utime(current, (1_700_002_000, 1_700_002_000))

            host = self._make_host(root, "1.16.33-20261126", keep_releases=2)
            report = host.prune_releases(2)

            self.assertEqual(report["removed_releases"], ["1.16.24-20261124"])
            self.assertFalse(oldest.exists())
            self.assertTrue(recent.exists())
            self.assertTrue(current.exists())

    def test_prune_build_cache_handles_command_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            host = self._make_host(Path(tmp), "1.16.33-20261126", keep_releases=1)
            with patch("subprocess.run") as mock_run:
                mock_run.return_value.returncode = 0
                self.assertTrue(host.prune_build_cache())
                mock_run.assert_called_once_with(["docker", "builder", "prune", "-af"], capture_output=True)

            with patch("subprocess.run", side_effect=OSError("docker unavailable")):
                self.assertFalse(host.prune_build_cache())


if __name__ == "__main__":
    unittest.main()
