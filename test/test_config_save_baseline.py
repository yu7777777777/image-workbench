"""Exercise the recovered online save method without loading runtime credentials."""
import ast
import errno
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, mock


ROOT = Path(__file__).resolve().parents[1]


def isolated_save():
    tree = ast.parse((ROOT / "services" / "config.py").read_text(encoding="utf-8-sig"))
    store_class = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ConfigStore")
    method = next(node for node in store_class.body if isinstance(node, ast.FunctionDef) and node.name == "_save")
    namespace = {"json": json}
    exec(compile(ast.Module(body=[method], type_ignores=[]), "<isolated-config-save>", "exec"), namespace)
    return namespace["_save"]


class ConfigSaveBaselineTests(TestCase):
    def setUp(self):
        import tempfile
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "config.json"
        self.path.write_text(json.dumps({"old": "x" * 200}), encoding="utf-8")
        self.store = SimpleNamespace(path=self.path, data={"message": "本地验证", "enabled": True})
        self.save = isolated_save()

    def test_normal_replace_writes_complete_utf8_and_removes_temporary_file(self):
        self.save(self.store)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), self.store.data)
        self.assertFalse(self.path.with_suffix(".json.tmp").exists())

    def test_busy_bind_mount_falls_back_in_place_and_fsyncs(self):
        inode = self.path.stat().st_ino
        with mock.patch.object(Path, "replace", side_effect=OSError(errno.EBUSY, "simulated bind mount")), mock.patch.object(os, "fsync", wraps=os.fsync) as sync:
            self.save(self.store)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8")), self.store.data)
        self.assertEqual(self.path.stat().st_ino, inode)
        self.assertTrue(self.path.read_bytes().endswith(b"\n"))
        self.assertFalse(self.path.with_suffix(".json.tmp").exists())
        sync.assert_called_once()

    def test_write_error_is_reported_and_temporary_file_is_cleaned(self):
        before = self.path.read_bytes()
        with mock.patch.object(Path, "replace", side_effect=OSError(errno.EBUSY, "simulated bind mount")), mock.patch("builtins.open", side_effect=PermissionError("simulated write denial")):
            with self.assertRaises(PermissionError):
                self.save(self.store)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertFalse(self.path.with_suffix(".json.tmp").exists())
