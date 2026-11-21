from datetime import datetime, timedelta

from services.log_service import LogService


def test_cleanup_before_removes_only_old_account_logs(tmp_path):
    service = LogService(tmp_path / "logs.jsonl")
    service.add("account", "old")
    service.add("call", "keep-call")
    lines = service.path.read_text(encoding="utf-8").splitlines()
    lines[0] = lines[0].replace(datetime.now().strftime("%Y-%m-%d"), (datetime.now() - timedelta(days=40)).strftime("%Y-%m-%d"), 1)
    service.path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert service.cleanup_before(30) == {"removed": 1}
    assert [item["summary"] for item in service.list(limit=10)] == ["keep-call"]
