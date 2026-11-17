# API Reference — `agent-fleet`

This example ships configuration, not code. The "API surface" is what the Agent Control Plane (beta) puts on the air when you run `telnyx-acp deploy`: three deployed agents, three channels, one CLI. This document is the typed reference for those surfaces.

**CLI session:** `telnyx-acp login` (OAuth through telnyx-edge), or set `TELNYX_API_KEY` for scripts/CI.
**Deployed mount URL:** `https://<function>.telnyxcompute.com` — printed by `deploy`.

## Deployed Surfaces

| Agent | Channel | Address after deploy | Notes |
|-------|---------|----------------------|-------|
| `acp-support` | web | chat page `<mount>/web` · embed script `<mount>/web/embed.js` | page is public once deployed; anyone with the URL can chat |
| `acp-sales` | email | inbox address printed by `deploy` | inbox found-or-created on the account's shared inbound subdomain, or `{ "address": … }` on a verified domain |
| `acp-scheduling` | phone + SMS | the attached number, E.164 | answers calls (greeting → intake) and texts |

`deploy` wires each channel itself: it creates a Call Control application and a messaging profile for the phone number, subscribes the email domain to `email.received`, and serves the web page from the deployed function. It also prints what it set up, so `delete` can undo it.

## Conversation Naming

One conversation is one instance. Every call to the same conversation name — from any channel — reaches the same instance with the same message history, state, and scheduled work.

| Channel | Conversation key |
|---------|------------------|
| web | the id the page keeps for the browser channel |
| email | `email-<thread id>` — one instance per thread |
| phone / SMS | the caller's number (E.164) |

Agent Memory profiles are keyed by the same person — browser id, sender's address, or caller's number — read when the instance activates and written after each turn, so the same person's page chat, email, and text remember each other.

## CLI Verbs (`telnyx-acp`)

| Group | Verb | Signature | What it does |
|-------|------|-----------|--------------|
| Lifecycle | `create` | `telnyx-acp create [--name n] [--kind configuration] [--model id] [--phone E.164] [--email [address]] [--web] [--channel artifact:id]` | Scaffold a project (`agent.json` + `instructions.md` + `README.md` + `AGENTS.md` + `.gitignore`). No flags opens the wizard. |
| | `dev` | `telnyx-acp dev` | Run the agent on this machine at `http://127.0.0.1:8787/agents/<name>/<conversation>`; reloads on save |
| | `deploy` | `telnyx-acp deploy` / `telnyx-acp deploy --dry-run` | Generate `.telnyx/`, ship it, wire the channels, print the addresses. First build ≈ 10 min (waits up to 25); revision builds ≈ 4 min |
| | `invoke` | `telnyx-acp invoke <agent> --conversation <id> [--local] "text"` | One turn against the local (`--local`) or deployed agent |
| | `chat` | `telnyx-acp chat [--local]` | A conversation that stays open in the terminal |
| | `eval` | `telnyx-acp eval [--local]` | Run the saved test conversations in `evals/` and score each reply |
| | `text` | `telnyx-acp text "message"` | One SMS to the agent's number from one of the account's, the reply printed — Telnyx-to-Telnyx, so no 10DLC registration is needed |
| Resources | `add` | `telnyx-acp add phone E.164` · `add email [address]` · `add web [--title t]` · `add channel artifact:id` · `add tool` · `add secret NAME` | Attach a channel or resource (edits `agent.json`) |
| | `remove` | `telnyx-acp remove phone E.164` (etc.) | Remove one of those; the next `deploy` restores the prior webhooks |
| | `set` / `unset` | `telnyx-acp set voice.greeting "Hi…"` | Change one field of `agent.json` |
| Observe | `status` | `telnyx-acp status` | The revision, every channel, the address, webhook health |
| | `logs` | `telnyx-acp logs --since 10m` / `logs --tail` | One JSON line per runtime event (`voiceCall`, `voiceTurn`, `modelStream`, `voiceFiller`, …) |
| | `traces` | `telnyx-acp traces <conversation> [run]` | Run waterfall: model calls with tokens and finish reasons, tool calls, delivery, timings |
| | `versions` | `telnyx-acp versions <agent>` | Every shipped revision with its git short SHA and timestamp |
| Cleanup | `delete` | `telnyx-acp delete <agent>` | Remove the function, actor type, and created artifacts; removes every conversation with it |
| Auth | `login` / `models` | `telnyx-acp login` · `telnyx-acp models` | Session; list Telnyx-hosted model ids |
| Update | `update` / `export` | `telnyx-acp update` · `telnyx-acp export` | Upgrade the CLI; export a config project to Agent SDK code |

## `POST /v2/ai/chat/completions` (wired by `deploy`)

Every agent calls the hosted model through the control plane — no key management in this example:

| Field | Value |
|-------|-------|
| `model` | `zai-org/GLM-5.3-Flash` (as declared; `telnyx-acp models` lists alternatives) |
| `messages` | system (`instructions.md`), history, user turn |
| Memory | Agent Memory profile per conversation, keyed `{{conversation}}` |

`openai/*`, `anthropic/*`, `google/*` or `groq/*` model ids need the user's own provider key as a secret.

## Revision Semantics

- Every `deploy` is a new immutable revision. `versions <agent>` lists them with their git short SHAs.
- **`rollback` is refused in the beta** for CLI-deployed agents (each owns its actor type). The way back is the project checked out at the earlier commit — which `versions` names — deployed again.
- One address per project: the active revision is the only one addressable. There is no staging slot or traffic split.

## Not Available in the Beta (do not claim)

| Surface | Status |
|---------|--------|
| `telnyx-acp list` | Reserved for the control-plane API; not shipped. Run `status` inside each project directory. |
| Fleet dashboard / control-plane API | Does not exist in the beta. |
| `rollback` | Refused; see Revision Semantics. |
| Staging slots / traffic split / approvals on deployed agents | Not in the beta (`ask` approvals work under `dev` only). |
| `texml_application` channels | Declared and wired, but the handler is not implemented — a webhook to it answers 501. |
| Phone-call traces | Calls are **not traced**; use `logs` (`voiceCall` / `voiceTurn`) for the call side. Text and web conversations are traced. |
| Trace contents | Traces hold no message text — they show what the agent did, not what was said. |

Full list: [Beta Limitations](https://developers.telnyx.com/docs/agents/beta-limitations).

## Errors

| Code | Meaning | Where |
|------|---------|-------|
| exit 4 | `You are not signed in.` — no CLI session and no `TELNYX_API_KEY` | every platform verb |
| exit 3 | `telnyx-edge is not installed or not on PATH` — need `telnyx-edge` ≥ 0.5.7 | `dev`, `deploy` |
| `40010` | Agent's number not 10DLC-registered; the personal-phone text was not delivered | inbound SMS from a US handset |
| deploy stop | A number in `phone` not in the account / not active; a secret missing from the platform | `deploy` preflight names each with the fix |
| `501` | `texml_application` channel webhook reached but unimplemented | TeXML applications |
