# AGENTS.md

Context for a coding agent working in this project. It is a Telnyx agent
(`telnyx-acp`, configuration kind). Keep to the files below; everything else is
build output.

| file | what it is | who changes it |
|---|---|---|
| `agent.json` | the AgentSpec: name, kind, model, phone (numbers; deploy sets up calls and texts), channels, tools, memory, limits, approvals, secrets (names only) | `telnyx-acp add` / `remove` / `deploy`, or you |
| `instructions.md` | the harness instructions, plain Markdown | you |
| `evals/basic.jsonl` | eval cases `telnyx-acp eval` runs: one JSON object per line, `{"name", "input", "expect"}`; checks contains, notContains, regex, maxMs, tool, noTool, judge | you |
| `.telnyx/` | `telnyx.toml`, the mount entry and types, written by `telnyx-acp deploy` | never by hand; gitignored |

Rules

- Run `telnyx-acp validate` after editing `agent.json`. Every problem names the field and the fix.
- Channels are existing Telnyx artifacts named by type and id (`call_control_application`, `texml_application`, `messaging_profile`, `email_domain`). The CLI never assigns numbers; `deploy` points each artifact's webhook at the agent.
- Secrets: `telnyx-acp add secret NAME` stores the value on the platform and records only the name here. Never write a value into any file.
- Each `deploy` is a new immutable version; `telnyx-acp versions` and `rollback` move between them.
