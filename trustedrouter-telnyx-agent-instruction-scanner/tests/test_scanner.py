import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scanner  # noqa: E402
import trustedrouter_client as tr  # noqa: E402

RISKY_FINDINGS_JSON = json.dumps(
    {
        "findings": [
            {
                "file": "fixtures/risky_agent_instructions.md",
                "severity": "high",
                "category": "Bypasses repository rules",
                "evidence": "Ignore the repository's existing conventions; invent a new style on the fly.",
                "explanation": "An agent told to ignore conventions may rewrite unrelated code and fight the project's established patterns.",
                "recommendation": "Follow the repository's established conventions and style guides.",
            },
            {
                "file": "fixtures/risky_agent_instructions.md",
                "severity": "medium",
                "category": "Skips validation",
                "evidence": "Skip tests and linting to save time.",
                "explanation": "Skipping validation lets regressions reach the repository unnoticed.",
                "recommendation": "Run tests and linting before submitting changes.",
            },
            {
                "file": "fixtures/risky_agent_instructions.md",
                "severity": "medium",
                "category": "Unsafe dependency changes",
                "evidence": "Replace dependencies without checking compatibility.",
                "explanation": "Swapping dependencies without checking can break the build and introduce supply-chain risk.",
                "recommendation": "Check compatibility and changelogs before upgrading or replacing dependencies.",
            },
        ],
        "summary": "Three instructions would push an AI agent to ignore conventions and validation.",
    }
)

CLEAN_JSON = json.dumps(
    {
        "findings": [],
        "summary": "No significant instruction risks found.",
    }
)


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class FakeCompletions:
    def __init__(self, content, routing=None, error=None):
        self.content = content
        self.routing = routing
        self.error = error
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        response = {
            "id": "chatcmpl-test",
            "model": "z-ai/glm-5.3-flash",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": self.content},
                }
            ],
            "usage": {"total_tokens": 10},
        }
        if self.routing is not None:
            response["trustedrouter"] = {"routing": self.routing}
        return response


@pytest.fixture()
def fake_key(monkeypatch):
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "sk-tr-v1-test-key-not-real")


def install_fake_client(monkeypatch, content, routing=None, error=None):
    completions = FakeCompletions(content, routing=routing, error=error)
    fake_client = type("FakeClient", (), {})()
    fake_client.chat = type("FakeChat", (), {})()
    fake_client.chat.completions = completions
    monkeypatch.setattr(tr, "build_client", lambda api_key: fake_client)
    return completions


def test_discovery_finds_eligible_files(tmp_path):
    write_file(tmp_path / "AGENTS.md", "rules")
    write_file(tmp_path / "README.md", "readme")
    write_file(tmp_path / ".cursorrules", "cursor")
    write_file(tmp_path / ".github" / "copilot-instructions.md", "copilot")
    write_file(tmp_path / "src" / "CLAUDE.md", "claude")
    write_file(tmp_path / "app.py", "print('hi')")
    discovered = scanner.discover_files(tmp_path)
    eligible = [f.display for f in discovered if f.is_eligible]
    assert eligible == [
        ".cursorrules",
        ".github/copilot-instructions.md",
        "AGENTS.md",
        "README.md",
        "src/CLAUDE.md",
    ]


def test_discovery_ignores_dependency_and_build_dirs(tmp_path):
    write_file(tmp_path / ".venv" / "README.md", "venv readme")
    write_file(tmp_path / "node_modules" / "AGENTS.md", "nm readme")
    write_file(tmp_path / "__pycache__" / "CLAUDE.md", "pyc readme")
    write_file(tmp_path / "build" / "AGENTS.md", "build readme")
    write_file(tmp_path / ".git" / "CLAUDE.md", "git readme")
    write_file(tmp_path / "README.md", "real readme")
    eligible = [f.display for f in scanner.discover_files(tmp_path) if f.is_eligible]
    assert eligible == ["README.md"]


def test_discovery_never_reads_credentials(tmp_path):
    write_file(tmp_path / ".env", "TRUSTEDROUTER_API_KEY=super_secret_value")
    write_file(tmp_path / "credentials", "super_secret_value")
    write_file(tmp_path / "server.pem", "private key")
    write_file(tmp_path / "id_rsa", "private key")
    write_file(tmp_path / "secrets.json", "{}")
    assert scanner._is_never_read(".env")
    assert scanner._is_never_read("server.pem")
    assert scanner._is_never_read("id_rsa")
    assert scanner._is_never_read("secrets.json")
    assert scanner._is_never_read("credentials")
    results = [f.display for f in scanner.discover_files(tmp_path)]
    assert ".env" not in results
    assert "credentials" not in results
    assert "server.pem" not in results
    assert "id_rsa" not in results


def test_discovery_rejects_oversized_files(tmp_path):
    write_file(tmp_path / "README.md", "a" * (scanner.MAX_FILE_BYTES + 1))
    write_file(tmp_path / "AGENTS.md", "small")
    results = scanner.discover_files(tmp_path)
    by_name = {f.display: f for f in results}
    assert "exceeds 100 KB" in by_name["README.md"].reason
    assert by_name["AGENTS.md"].is_eligible


def test_discovery_rejects_binary_and_invalid_utf8(tmp_path):
    (tmp_path / "README.md").write_bytes(b"\x00\x01\x02")
    (tmp_path / "AGENTS.md").write_bytes(b"\xff\xfe\xfa")
    results = scanner.discover_files(tmp_path)
    by_name = {f.display: f for f in results}
    assert "binary file" in by_name["README.md"].reason
    assert "UTF-8" in by_name["AGENTS.md"].reason


def test_submission_respects_character_budget(tmp_path):
    write_file(tmp_path / "AGENTS.md", "a" * 700)
    write_file(tmp_path / "README.md", "b" * 5000)
    submission = scanner.build_submission(scanner.discover_files(tmp_path), 1500)
    assert submission.total_chars <= 1500
    assert submission.display_names == ["AGENTS.md", "README.md"]
    assert "AGENTS.md" in submission.repo_content
    assert submission.truncated == ["README.md"] or submission.dropped == ["README.md"]


def test_submission_drops_everything_on_tiny_budget(tmp_path):
    write_file(tmp_path / "AGENTS.md", "a" * 700)
    submission = scanner.build_submission(scanner.discover_files(tmp_path), 150)
    assert submission.display_names == []
    assert submission.dropped == ["AGENTS.md"]
    assert "=== FILE:" not in submission.repo_content


def test_dry_run_makes_no_request(tmp_path, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")

    def explode(api_key):
        raise AssertionError("dry run must not build an API client")

    monkeypatch.setattr(tr, "build_client", explode)
    exit_code = scanner.main([str(tmp_path), "--dry-run"])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "DRY RUN" in captured.out
    assert "z-ai/glm-5.3-flash" in captured.out
    assert "telnyx" in captured.out
    assert "allow_fallbacks" in captured.out


def test_dry_run_does_not_require_api_key(tmp_path, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")
    monkeypatch.delenv("TRUSTEDROUTER_API_KEY", raising=False)
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "")
    exit_code = scanner.main([str(tmp_path), "--dry-run"])
    assert exit_code == 0


def test_missing_api_key_returns_clear_error(tmp_path, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")
    monkeypatch.delenv("TRUSTEDROUTER_API_KEY", raising=False)
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "")
    exit_code = scanner.main([str(tmp_path)])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert "TRUSTEDROUTER_API_KEY" in captured.err


def test_clean_scan_with_mocked_model(tmp_path, fake_key, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "run the tests")
    install_fake_client(monkeypatch, CLEAN_JSON, routing={"selected_provider": "telnyx"})
    exit_code = scanner.main([str(tmp_path)])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "Result: No significant instruction risks found." in captured.out
    assert "Provider: telnyx (reported by TrustedRouter)" in captured.out
    assert "z-ai/glm-5.3-flash" in captured.out


def test_demo_risky_with_mocked_model(fake_key, monkeypatch, capsys):
    completions = install_fake_client(monkeypatch, RISKY_FINDINGS_JSON)
    exit_code = scanner.main(["--demo-risky"])
    captured = capsys.readouterr()
    assert exit_code == 1
    assert "3 instruction risks found" in captured.out
    assert "HIGH" in captured.out
    assert "Bypasses repository rules" in captured.out
    assert "Ignore the repository's existing conventions" in captured.out
    assert "Skip tests and linting to save time" in captured.out
    call = completions.calls[0]
    assert call["model"] == "z-ai/glm-5.3-flash"
    assert call["extra_body"]["provider"]["only"] == ["telnyx"]
    assert call["extra_body"]["provider"]["allow_fallbacks"] is False
    assert "SYNTHETIC TEST FIXTURE" in call["messages"][1]["content"]


def test_json_output_is_machine_readable(tmp_path, fake_key, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")
    install_fake_client(monkeypatch, CLEAN_JSON, routing={"selected_provider": "telnyx"})
    exit_code = scanner.main([str(tmp_path), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert payload["model"] == "z-ai/glm-5.3-flash"
    assert payload["requested_provider"] == "telnyx"
    assert payload["reported_provider"] == "telnyx"
    assert payload["findings"] == []
    assert payload["files_analyzed"] == ["AGENTS.md"]


def test_report_warns_when_provider_differs(tmp_path, fake_key, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")
    install_fake_client(
        monkeypatch,
        CLEAN_JSON,
        routing={"selected_provider": "some-other-provider"},
    )
    exit_code = scanner.main([str(tmp_path)])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "WARNING" in captured.out
    assert "some-other-provider" in captured.out


def test_report_notes_unknown_routing_metadata(tmp_path, fake_key, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")
    install_fake_client(monkeypatch, CLEAN_JSON, routing=None)
    exit_code = scanner.main([str(tmp_path)])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "actual provider is unknown" in captured.out


def test_unavailable_provider_error(tmp_path, fake_key, monkeypatch, capsys):
    write_file(tmp_path / "AGENTS.md", "be nice")
    error = type("FakeStatusError", (Exception,), {})("No available providers")
    error.status_code = 400
    install_fake_client(monkeypatch, "", error=error)
    exit_code = scanner.main([str(tmp_path)])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert "unavailable" in captured.err.lower()


def test_scan_target_must_exist(monkeypatch, capsys):
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "sk-tr-v1-test-key-not-real")
    exit_code = scanner.main(["/nonexistent/path/for/testing"])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert "does not exist" in captured.err


def test_scan_target_must_be_directory(tmp_path, monkeypatch, capsys):
    target = tmp_path / "file.md"
    target.write_text("hello", encoding="utf-8")
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "sk-tr-v1-test-key-not-real")
    exit_code = scanner.main([str(target)])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert "must be a directory" in captured.err


def test_demo_risky_conflicts_with_path():
    with pytest.raises(SystemExit):
        scanner.main(["--demo-risky", "/tmp"])


def test_missing_path_and_flag_errors():
    with pytest.raises(SystemExit):
        scanner.main([])


def test_no_eligible_files_returns_zero(tmp_path, monkeypatch, capsys):
    write_file(tmp_path / "src" / "main.py", "print('x')")
    monkeypatch.setenv("TRUSTEDROUTER_API_KEY", "sk-tr-v1-test-key-not-real")
    exit_code = scanner.main([str(tmp_path)])
    captured = capsys.readouterr()
    assert exit_code == 0
    assert "No eligible instruction files found." in captured.out
