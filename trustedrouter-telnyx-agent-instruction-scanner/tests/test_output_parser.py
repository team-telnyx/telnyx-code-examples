import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prompts import Finding, parse_model_output  # noqa: E402

CLEAN = '{"findings": [], "summary": "No significant instruction risks found."}'

RISKY = """{
  "findings": [
    {
      "file": "AGENTS.md",
      "severity": "high",
      "category": "Bypasses repository rules",
      "evidence": "Ignore the repository's existing conventions.",
      "explanation": "An agent told to ignore conventions may rewrite unrelated code.",
      "recommendation": "Follow the repository's established conventions."
    },
    {
      "file": "AGENTS.md",
      "severity": "medium",
      "category": "Skips validation",
      "evidence": "Skip tests and linting to save time.",
      "explanation": "Skipping validation lets regressions reach the repository.",
      "recommendation": "Run tests and linting before submitting."
    },
    {
      "file": "AGENTS.md",
      "severity": "medium",
      "category": "Unsafe dependency changes",
      "evidence": "Replace dependencies without checking compatibility.",
      "explanation": "Un-checked dependency swaps can break the build.",
      "recommendation": "Check compatibility before replacing dependencies."
    }
  ],
  "summary": "Three instructions would push an AI agent to ignore conventions and validation."
}"""


def test_plain_json_clean():
    result = parse_model_output(CLEAN)
    assert result.parse_ok
    assert result.findings == []
    assert result.is_clean
    assert result.summary == "No significant instruction risks found."


def test_plain_json_risky():
    result = parse_model_output(RISKY)
    assert result.parse_ok
    assert len(result.findings) == 3
    assert result.findings[0].severity == "high"
    assert result.findings[0].evidence == "Ignore the repository's existing conventions."


def test_markdown_wrapped_json():
    result = parse_model_output(f"```json\n{RISKY}\n```")
    assert result.parse_ok
    assert len(result.findings) == 3


def test_markdown_wrapped_clean_json():
    result = parse_model_output(f"Here is the result:\n\n```json\n{CLEAN}\n```\n")
    assert result.parse_ok
    assert result.is_clean


def test_prose_around_json():
    result = parse_model_output(f"Sure! My analysis:\n{RISKY}\nHope that helps.")
    assert result.parse_ok
    assert len(result.findings) == 3


def test_bare_list_finding():
    result = parse_model_output(
        '[{"file": "CLAUDE.md", "severity": "low", "category": "Style",'
        ' "evidence": "e", "explanation": "x", "recommendation": "r"}]'
    )
    assert result.parse_ok
    assert len(result.findings) == 1
    assert result.findings[0].file == "CLAUDE.md"


def test_alternative_keys_risks_and_issues():
    risks = parse_model_output('{"risks": [{"severity": "low"}], "summary": "s"}')
    issues = parse_model_output('{"issues": [{"severity": "low"}], "summary": "s"}')
    assert len(risks.findings) == 1
    assert len(issues.findings) == 1


def test_garbage_falls_back_to_readable_text():
    result = parse_model_output("I reviewed the files but could not format JSON.")
    assert not result.parse_ok
    assert result.findings == []
    assert "could not format JSON" in result.summary
    assert result.raw_response.startswith("I reviewed")


def test_empty_string_falls_back():
    result = parse_model_output("")
    assert not result.parse_ok
    assert result.findings == []


def test_severity_normalization():
    result = parse_model_output(
        '{"findings": [{"severity": "CRITICAL"}, {"severity": "HIGH"},'
        ' {"severity": "low"}], "summary": ""}'
    )
    severities = [f.severity for f in result.findings]
    assert severities == ["medium", "high", "low"]


def test_missing_fields_get_defaults():
    result = parse_model_output('{"findings": [{}], "summary": ""}')
    finding = result.findings[0]
    assert finding.file == "unknown"
    assert finding.severity == "medium"
    assert finding.category == "Uncategorized"


def test_evidence_is_truncated():
    long_text = "x" * 2000
    result = parse_model_output(f'{{"findings": [{{"evidence": "{long_text}"}}]}}')
    assert len(result.findings[0].evidence) == 300


def test_findings_sorted_by_severity():
    result = parse_model_output(RISKY)
    ordered = [f.severity for f in result.sorted_findings()]
    assert ordered == ["high", "medium", "medium"]


def test_finding_fields_match_contract():
    finding = Finding(
        file="AGENTS.md",
        severity="low",
        category="cat",
        evidence="e",
        explanation="x",
        recommendation="r",
    )
    assert set(finding.to_dict()) == {
        "file",
        "severity",
        "category",
        "evidence",
        "explanation",
        "recommendation",
    }


def test_json_followed_by_reasoning_text():
    result = parse_model_output(f'{CLEAN}\n\nThat completes the audit.')
    assert result.parse_ok
    assert result.is_clean
