import unittest

from pr_body import GATE_MARKER, inject_gate_status, render_code_sample_body, render_syndication_body


HEADINGS = (
    "## Summary", "## Source / Tracking", "## Changes", "## Validation",
    "## Review Checklist", "## Merge Readiness",
)


class PullRequestBodyTests(unittest.TestCase):
    def assert_standard(self, body: str) -> None:
        for heading in HEADINGS:
            self.assertEqual(body.count(heading), 1)

    def test_code_sample_body_and_passing_gates(self) -> None:
        body = render_code_sample_body(
            issue_id="DEV-123", issue_url="https://linear.app/telnyx/issue/DEV-123",
            ticket_title="Build sample", sample_name="example-sample", summary="Generated sample.",
        )
        self.assert_standard(body)
        rendered = inject_gate_status(body, [])
        self.assertNotIn(GATE_MARKER, rendered)
        self.assertIn("All pre-PR gates passed", rendered)

    def test_gate_failures_are_rendered_without_changing_structure(self) -> None:
        body = render_code_sample_body(
            issue_id="DEV-123", issue_url="https://linear.app/telnyx/issue/DEV-123",
            ticket_title="Build sample", sample_name="example-sample", summary="Generated sample.",
        )
        rendered = inject_gate_status(body, ["verify.py", "llms.txt"])
        self.assert_standard(rendered)
        self.assertIn("verify.py", rendered)

    def test_legacy_body_fallback_is_preserved(self) -> None:
        rendered = inject_gate_status("Legacy caller body", [])
        self.assertTrue(rendered.startswith("Legacy caller body"))

    def test_syndication_body_lists_actual_files(self) -> None:
        body = render_syndication_body(
            sample_name="example-sample", assignee="sonam",
            source_url="https://github.com/team-telnyx/telnyx-code-examples/tree/main/example-sample",
            generated_files=["README.md", "blog-post.md"],
        )
        self.assert_standard(body)
        self.assertIn("`blog-post.md`", body)


if __name__ == "__main__":
    unittest.main()
