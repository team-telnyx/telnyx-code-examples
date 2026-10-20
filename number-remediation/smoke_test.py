"""Smoke tests: every workflow script imports, exposes its entrypoint, and the
demo-mode pipeline runs end-to-end producing the expected artifacts."""

import importlib
import os
import sys
from pathlib import Path

import pytest

MODULES = [
    "app",
    "check_reputation",
    "submit_remediation",
    "poll_remediation",
    "report",
    "webhook_receiver",
]


@pytest.fixture(autouse=True)
def _demo_env(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")
    monkeypatch.setenv("TELNYX_PUBLIC_KEY", "demo-public-key")


@pytest.mark.parametrize("name", MODULES)
def test_module_imports(name):
    module = importlib.import_module(name)
    assert module is not None


@pytest.mark.parametrize("name", MODULES)
def test_module_has_main(name):
    module = importlib.import_module(name)
    assert callable(getattr(module, "main", None)), f"{name} missing callable main()"


def test_webhook_receiver_has_route():
    module = importlib.import_module("webhook_receiver")
    rules = {rule.rule for rule in module.app.url_map.iter_rules()}
    assert "/hooks/remediation" in rules


def test_report_buckets_constant():
    module = importlib.import_module("report")
    assert module.BUCKETS == [
        "remediated",
        "not_flagged",
        "requires_review",
        "ineligible",
        "refused",
    ]


def test_demo_pipeline_end_to_end(tmp_path, monkeypatch):
    """Run check_reputation -> submit -> poll -> report in demo mode."""
    monkeypatch.chdir(tmp_path)

    numbers_csv = tmp_path / "numbers.csv"
    numbers_csv.write_text(
        "phone_number\n+15550000001\n+15550000002\n+15550000003\n",
        encoding="utf-8",
    )

    check = importlib.import_module("check_reputation")
    monkeypatch.setattr(
        sys, "argv",
        ["check_reputation.py", "--numbers", str(numbers_csv)],
    )
    assert check.main() == 0
    flagged = tmp_path / "flagged.csv"
    assert flagged.exists()
    assert "phone_number" in flagged.read_text(encoding="utf-8")

    submit = importlib.import_module("submit_remediation")
    monkeypatch.setattr(
        sys, "argv",
        ["submit_remediation.py", "--purpose", "Outbound appointment reminders."],
    )
    assert submit.main() == 0
    request_id_file = tmp_path / "remediation_request_id.txt"
    assert request_id_file.exists()
    request_id = request_id_file.read_text(encoding="utf-8").strip()
    assert request_id

    poll = importlib.import_module("poll_remediation")
    monkeypatch.setattr(sys, "argv", ["poll_remediation.py", "--once"])
    assert poll.main() == 0

    report = importlib.import_module("report")
    monkeypatch.setattr(sys, "argv", ["report.py"])
    assert report.main() == 0
    report_path = tmp_path / "remediation_report.md"
    assert report_path.exists()
    body = report_path.read_text(encoding="utf-8")
    for bucket in report.BUCKETS:
        assert bucket in body
    assert request_id in body


def test_invalid_purpose_demo_shows_400(tmp_path, monkeypatch, capsys):
    """--invalid-purpose must surface the documented 400 envelope in demo mode."""
    monkeypatch.chdir(tmp_path)
    submit = importlib.import_module("submit_remediation")
    monkeypatch.setattr(sys, "argv", ["submit_remediation.py", "--invalid-purpose"])
    assert submit.main() == 0
    out = capsys.readouterr().out
    assert "HTTP 400" in out
    assert "10009" in out
    assert "10010" in out
