# OpenCode Handoff: Salesforce LangGraph Demo

Use this file to start a fresh OpenCode session instead of resuming `ses_fe49cac3effe9vw1jRGO3rWa1k`. That old session exported to about 2.7 MB and reports about 17M input tokens plus 57M cached tokens, so replay/resume can fail or hang.

## Canonical Project

- Work in `/Users/anushathukral/Documents/Projects/telnyx-code-examples/customer-agent-langgraph-edge`.
- Do not use the parent repo root as the OpenCode project directory.
- Keep `langgraph-agent-on-edge` as read-only reference unless explicitly asked otherwise.
- Do not print, commit, or log API keys, Salesforce secrets, AgentMail secrets, or 1Password values.

## Prior Session Summary

- One logical project: per-customer durable actor on Telnyx Edge with LangGraph orchestration, SMS, Salesforce, Agent Mail, and a mocked voice responder for the first pass.
- Canonical Edge function should be `customer-agent-langgraph-edge`; earlier scratch functions/directories were cleaned up in the old OpenCode session.
- The old plan is preserved in `BUILD_PLAN.md`.
- Current first-pass architecture:
  - Responder/voice remains mocked via `onCall` until SMS + Salesforce + Agent Mail are green.
  - Orchestrator is the durable `CustomerAgent` actor.
  - LangGraph handles intent -> action -> response.
  - Salesforce has mock mode and real OAuth client-credentials wiring.
  - Agent Mail uses an AgentMail-style send/webhook path, not Telnyx Email beta.

## Current Local State

- `npm test` passes: 84 tests across 7 files.
- `npm run typecheck` previously failed in `src/graph.ts` because several LangGraph annotations had `default` without the required reducer `value`; that was patched in this handoff pass.
- There is a nested `customer-agent-langgraph-edge/customer-agent-langgraph-edge` scaffold directory. Treat it as suspicious scratch output. Do not delete it unless the user confirms cleanup.
- There are uncommitted edits in sibling examples too (`agent-with-tool-calling`, `langgraph-agent-on-edge`). Do not touch them unless the user asks.

## Fresh Session Prompt

Read `OPENCODE_HANDOFF.md`, `BUILD_PLAN.md`, `README.md`, and the current git diff. Continue the Salesforce + LangGraph responder demo from the canonical project directory only. First verify `npm run typecheck` and `npm test`. Then continue the next incomplete gate without replaying or resuming the old session. Do not print or expose secrets.

## Useful Commands

```bash
cd /Users/anushathukral/Documents/Projects/telnyx-code-examples/customer-agent-langgraph-edge
ulimit -n 1048575
opencode --mini --no-replay --agent "Sisyphus - ultraworker" --prompt "$(sed -n '1,220p' OPENCODE_HANDOFF.md)"
```

If you still want to try the old session:

```bash
cd /Users/anushathukral/Documents/Projects/telnyx-code-examples/customer-agent-langgraph-edge
ulimit -n 1048575
opencode --session ses_fe49cac3effe9vw1jRGO3rWa1k --mini --no-replay
```
