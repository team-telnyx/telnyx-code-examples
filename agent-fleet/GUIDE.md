# agent-fleet — Three Agents, One CLI

A hands-on walkthrough of the `agent-fleet` sample: three config-only ACP agents — **support** on the browser page, **sales** in the email inbox, **scheduling** on the phone — deployed and operated through the same five verbs (`status`, `logs`, `traces`, `versions`, `deploy`) typed in three directories.

This guide explains what each block of `src/index.ts` does, how the Telnyx primitives fit together, and how to run the whole fleet locally in safe demo mode before switching to live mode.

---

## Table of contents

1. [What you're building](#what-youre-building)
2. [Prerequisites](#prerequisites)
3. [Environment setup](#environment-setup)
4. [Run instructions](#run-instructions)
5. [Code walkthrough](#code-walkthrough)
   - [Types and the fleet manifest](#1-types-and-the-fleet-manifest)
   - [KV helpers — the project record and the log](#2-kv-helpers--the-project-record-and-the-log)
   - [The `FleetAgent` base class](#3-the-fleetagent-base-class)
   - [The three subclasses](#4-the-three-subclasses)
   - [The HTTP router — five verbs as routes](#5-the-http-router--five-verbs-as-routes)
   - [Deploy — the revision story](#6-deploy--the-revision-story)
   - [The webhook handler — Ed25519 and channel routing](#7-the-webhook-handler--ed25519-and-channel-routing)
6. [The demo flow, mapped to commands](#the-demo-flow-mapped-to-commands)
7. [Demo mode vs live mode](#demo-mode-vs-live-mode)
8. [Beta constraints honored on camera](#beta-constraints-honored-on-camera)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)
11. [Next steps](#next-steps)

---

## What you're building

The ACP beta ships config-only agents: a project is `agent.json` + `instructions.md`, and the `telnyx-acp` CLI deploys and operates it. The interesting question for an operator is *"if I run three agents, do I learn three tools?"* — and the answer this sample demonstrates is **no**.

Three projects, three channels, one operating surface:

| Project | Channel | Address | Instructions focus |
|---|---|---|---|
| `acp-support` | web | `/web` (public page + `embed.js`) | refunds, shipping, account questions |
| `acp-sales` | email | `sales-inbox@example.com` | reply in-thread, qualify, one next step |
| `acp-scheduling` | phone / SMS | `+1555XXXXXXXX` | greeting + intake (name, service, time) |

An Edge function cannot shell out to the `telnyx-acp` CLI, so this sample implements **the runtime the CLI deploys** — three agents, one per channel — and exposes the same five verbs as HTTP routes so the workflow is identical per project. `list` is deliberately absent (reserved for the control-plane API, not shipped in the beta) and rollback is refused — the way back is checkout + redeploy.

Every turn is the same pipeline, regardless of channel:

```
memory.read → model.call → memory.write → delivery
```

and every step is written to a trace you can walk on screen.

---

## Prerequisites

- **Node.js 20+** and npm
- A **Telnyx account** with the Agent Control Plane beta enabled
- The **`telnyx-edge` CLI** (`npm install -g @telnyx/edge-cli`) — this is the deploy tool for the Edge runtime
- The **`telnyx-acp` CLI** (`npm install -g @telnyx/acp`) — the ACP beta CLI, for reference against the real product surface
- A **Telnyx phone number** (E.164) for the scheduling agent's SMS path
- An **email inbox** you control for the sales agent (the beta finds-or-creates one on `deploy`)

> The ACP beta ships as `latest` on npm and flags move between releases. Re-check `telnyx-acp --help` against the current docs before recording.

---

## Environment setup

### 1. `telnyx.toml` — bindings

The Edge runtime reads bindings from `telnyx.toml`. This sample needs three actor namespaces, one KV namespace, the zero-credential Telnyx API binding, and two secrets.

```toml
name = "agent-fleet"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "SUPPORT"
type    = "SupportAgent"

[[actors]]
binding = "SALES"
type    = "SalesAgent"

[[actors]]
binding = "SCHEDULING"
type    = "SchedulingAgent"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[[secrets]]
binding = "TELNYX_PUBLIC_KEY"
name    = "TELNYX_PUBLIC_KEY"

[telnyx]
binding = "TELNYX"

[storage.kv.FLEET_KV]
id = "<kv-namespace-uuid>"

[env_vars]
AI_MODEL    = "meta-llama/Llama-3.3-70B-Instruct"
DEMO_MODE   = "true"
AGENT_NUMBER = "+1555XXXXXXXX"
```

- `[telnyx] binding = "TELNYX"` gives you `env.TELNYX.messages.send(...)` and `env.TELNYX.ai.openai.chat.createCompletion(...)` with **zero credentials in code** — the platform injects auth.
- `FLEET_KV` holds project records, memory profiles, traces, and log lines.
- `TELNYX_PUBLIC_KEY` is the account's webhook signing key, used to verify Ed25519 signatures on inbound events.

### 2. `.env.example` — placeholders only

```dotenv
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_webhook_public_key_here
AI_MODEL=meta-llama/Llama-3.3-70B-Instruct
DEMO_MODE=true
AGENT_NUMBER=+1555XXXXXXXX
```

Never commit real keys. `AGENT_NUMBER` stays a placeholder in the repo; you set the real one at deploy time.

### 3. Regenerate types

```bash
npm install
telnyx-edge types
```

`telnyx-edge types` writes `telnyx-env.d.ts` from your `telnyx.toml` bindings, so `interface Env` in `src/index.ts` type-checks against the real namespaces.

---

## Run instructions

```bash
# 1. Authenticate the Edge CLI
telnyx-edge auth api-key set "$TELNYX_API_KEY"

# 2. Push the webhook public key as a secret
telnyx-edge secrets add TELNYX_PUBLIC_KEY "<your-public-key>"

# 3. Regenerate bindings types
telnyx-edge types

# 4. Ship
npm run deploy          # → telnyx-edge ship
```

`telnyx-edge ship` is the deploy command — there is no `telnyx-edge deploy`.

Once shipped, the fleet answers on three project prefixes:

```
POST /acp-support/deploy
GET  /acp-support/status
GET  /acp-support/logs?since=10m
GET  /acp-support/versions
GET  /acp-support/traces/<conversation>/<run>
POST /acp-support/message
```

…and identically for `acp-sales` and `acp-scheduling`. That repetition *is* the demo.

---

## Code walkthrough

### 1. Types and the fleet manifest

**`src/index.ts`, top block — type declarations and constants**

The file opens with the shared vocabulary:

- `Channel` — `"web" | "email" | "phone"`
- `ProjectName` — `"acp-support" | "acp-sales" | "acp-scheduling"`
- `ProjectRecord` — what a deployed project *is*: `revision`, `gitSha`, `instructions`, `deployedAt`, `address`, and a `versions[]` history
- `MemoryProfile` — one profile per conversation: `{ conversation, channel, facts[], updatedAt }`
- `TraceStep` — one rung of the waterfall: `memory.read | model.call | memory.write | delivery`, with optional `tokens` and `finishReason`
- `LogLine` — one JSON line per runtime event

Then the manifest itself:

```ts
export const PROJECTS: ProjectName[] = ["acp-support", "acp-sales", "acp-scheduling"];
export const CHANNELS: Record<ProjectName, Channel> = {
  "acp-support": "web", "acp-sales": "email", "acp-scheduling": "phone",
};
export const ADDRESSES: Record<ProjectName, string> = {
  "acp-support": "/web", "acp-sales": "sales-inbox@example.com", "acp-scheduling": "+1555XXXXXXXX",
};
export const INSTRUCTIONS: Record<ProjectName, string> = { /* ... */ };
```

`INSTRUCTIONS` is the in-code mirror of each project's `instructions.md`. The support agent answers in two sentences or fewer; the sales agent replies in plain text under 120 words and never invents pricing; the scheduling agent greets warmly, collects name/service/time, and reads the booking back verbatim.

`isProject(value)` is the router's guard — anything not in `PROJECTS` gets a 404 that names the fleet.

### 2. KV helpers — the project record and the log

**`src/index.ts` — `readProject`, `appendLog`, `readLogs`, `parseSince`, `shortSha`**

These are the four functions every verb leans on.

- **`readProject(kv, name)`** reads `project:<name>` from `FLEET_KV` as JSON. Returns `null` if the project has never been deployed — which is exactly what `status` reports as `deployed: false`.
- **`appendLog(kv, project, event, conversation, detail)`** writes `log:<project>:<iso>:<rand>` with a **7-day TTL**. One JSON line per runtime event: `deploy`, `modelStream`, `voiceCall`, and so on.
- **`readLogs(kv, project, sinceMs)`** lists `log:<project>:` (limit 500), filters by `Date.parse(line.at) >= cutoff`, and sorts ascending. This is what `logs --since 10m` becomes over HTTP.
- **`parseSince(raw)`** parses `10m` / `30s` / `2h` into milliseconds, defaulting to 10 minutes. It is the only place the `--since` grammar lives.
- **`shortSha()`** generates a 7-character hex string from `crypto.getRandomValues` — the stand-in for a git short SHA when you deploy without one.

### 3. The `FleetAgent` base class

**`src/index.ts` — `abstract class FleetAgent extends Agent<Env, { turns: number }>`**

This is the heart of the sample. `Agent<E, State>` from `@telnyx/edge-runtime` gives you durable state (`getState` / `setState`) and auto-RPC-callable public methods. The base class holds everything channel-agnostic; each subclass only declares which project it is.

**`handleMessage({ conversation, text, from })`** — one turn, four traced steps:

1. **`loadProject()`** — read the deployed `ProjectRecord` from KV, or fall back to the built-in `INSTRUCTIONS` and `ADDRESSES` if the project hasn't been deployed yet. This is why the sample works on a fresh namespace.
2. **`readMemory(conversation)`** — pull `memory:<conversation>` from KV. The key is the conversation id: the browser conversation id for web, `email-<thread id>` for email, the caller's number for phone/SMS. **The person, not the message, carries across channels.**
3. **Model call** — `env.TELNYX.ai.openai.chat.createCompletion({ model, messages })` with three messages: the project's `instructions` as system, the memory facts as a second system message, and the user's text. The model defaults to `meta-llama/Llama-3.3-70B-Instruct` and is overridable via `AI_MODEL`. No provider key required.
4. **`memory.write`** — append `"<channel>: <first 120 chars of text>"` to the profile's `facts`, cap at the last 12, and write back with a **30-day TTL**.
5. **`deliver(conversation, reply, from)`** — channel-specific, see below.
6. **Trace + log** — the four `TraceStep`s are written to `trace:<project>:<conversation>:<run>` with a **7-day TTL**, and a `modelStream` log line records the model id and completion-token count.
7. **State bump** — `setState({ turns: state.turns + 1 })` so the actor's durable counter reflects the turn.

The `run` id is `<base36 timestamp>-<4 hex chars>`, generated per turn. It is what you pass to `traces <conversation> <run>`.

**`deliver(...)`** is where the channel split lives:

- `acp-support` → returns `web page <conversation>` (the reply renders in the same browser tab)
- `acp-sales` → returns `email thread <conversation>` (the reply lands in the same thread)
- `acp-scheduling` → if `DEMO_MODE !== "false"` or `AGENT_NUMBER` is unset, returns `demo: would SMS <to>`; otherwise calls `env.TELNYX.messages.send({ to, from, text })` and returns `sms <to>`

That single `if` is the entire demo/live switch for outbound SMS.

### 4. The three subclasses

**`src/index.ts` — `SupportAgent`, `SalesAgent`, `SchedulingAgent`**

Each is three lines:

```ts
export class SupportAgent extends FleetAgent {
  protected get project(): ProjectName { return "acp-support"; }
}
```

The `project` getter is the only thing that differs. Everything else — memory, model, trace, delivery — is inherited. This is the code-level expression of the ticket's claim: **the fleet is configuration, and one workflow operates all of it.**

`namespaceFor(env, project)` maps a project name to its actor namespace (`SUPPORT`, `SALES`, `SCHEDULING`) so `sendToAgent` can address the right actor.

### 5. The HTTP router — five verbs as routes

**`src/index.ts` — `export default { async fetch(request, env) }`**

The router splits the pathname into `[project, verb, ...rest]` and dispatches:

| Route | Verb | What it does |
|---|---|---|
| `GET /<project>/status` | `status` | revision, git SHA, channel, address, deployedAt, webhook health |
| `GET /<project>/versions` | `versions` | the `versions[]` array with git short SHAs |
| `GET /<project>/logs?since=10m` | `logs` | `readLogs` with `parseSince` |
| `GET /<project>/traces/<conversation>/<run>` | `traces` | the stored waterfall |
| `POST /<project>/deploy` | `deploy` | new revision, optional `instructions` + `gitSha` in the body |
| `POST /<project>/message` | — | drive one turn (used by the web page and by tests) |

`POST /webhook/telnyx` is handled **before** the project split — it is a single account-level endpoint, not a per-project one.

Unknown projects get a 404 that names the fleet. Unknown verbs get a 404 that lists the five. Errors are caught, logged with `console.error`, and returned as a generic `{ error: "request failed" }` with status 500 — no exception detail leaks to the client.

**`status(env, project)`** is worth calling out: it reads the project record, then reads the last hour of logs to compute `webhook.lastEventAt` and `webhook.healthy`. A project with no recent events reports `healthy: false` — honest, per project, exactly as the CLI does.

### 6. Deploy — the revision story

**`src/index.ts` — `deploy(env, project, body)`**

```ts
const revision = (existing?.revision ?? 0) + 1;
const gitSha = /^[0-9a-f]{7,40}$/.test(requested) ? requested.slice(0, 7) : shortSha();
const edited = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 4000) : "";
```

- Revision numbers are monotonic per project.
- `gitSha` accepts a real SHA from the body (validated against `^[0-9a-f]{7,40}$`, truncated to 7) or generates one.
- `instructions` in the body **overrides** the stored instructions — this is the "one edit to `instructions.md`, one `deploy`" moment from the demo. Cap at 4000 characters.
- The new record is written to KV and a `deploy` log line is appended: `revision N live (<sha>)`.
- The response is `201` with the full `ProjectRecord`.

`versions` then reads `record.versions` — the append-only history with git short SHAs. **Rollback is refused in the beta**; the way back is `git checkout <sha>` and redeploy, which produces a *new* revision. Say that on camera rather than hiding it.

### 7. The webhook handler — Ed25519 and channel routing

**`src/index.ts` — `verifySignature` and `handleWebhook`**

Every inbound Telnyx event hits `POST /webhook/telnyx`. Before anything else, the raw body is verified:

```ts
const signature = headers.get("telnyx-signature-ed25519");
const timestamp = headers.get("telnyx-timestamp");
if (!signature || !timestamp) return false;
if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
```

- **Replay window**: timestamps more than 300 seconds from now are rejected.
- **Key**: `await env.SECRETS.get("TELNYX_PUBLIC_KEY")`, imported as an Ed25519 key via `crypto.subtle.importKey`.
- **Signed payload**: `` `${timestamp}|${raw}` `` — the exact bytes Telnyx signed.
- Any failure returns `401 { error: "invalid signature" }`. No event is processed unverified.

Once verified, the event type routes the payload:

| `data.event_type` | Routed to | Conversation key | Notes |
|---|---|---|---|
| `email.received` | `acp-sales` | `email-<thread_id>` | reply lands in the same thread; one instance per thread |
| `message.received` | `acp-scheduling` | the sender's number | Telnyx-to-Telnyx, so no 10DLC registration needed |
| `call.initiated` | — | — | **logged only** — calls are not traced in the beta |

The `call.initiated` branch is deliberately a log line, not a turn:

```ts
await appendLog(env.FLEET_KV, "acp-scheduling", "voiceCall", caller,
  "inbound call — calls are not traced in the beta; use logs");
return json({ received: true, traced: false });
```

That `traced: false` in the response is the honest answer. When you demo the phone channel, walk the **logs**, not the waterfall.

The `str(value)` helper unwraps both `"string"` and `{ address: "string" }` shapes, because Telnyx payloads are inconsistent about whether a field is a bare string or an object.

---

## The demo flow, mapped to commands

The ticket's 9:00–9:16 script, translated to the HTTP surface this sample exposes. Run each block from a terminal against your shipped deployment.

**9:00 — deploy all three (pre-deploy before recording; first build ≈ 10 min)**

```bash
curl -X POST https://<your-worker>/acp-support/deploy    -H 'content-type: application/json' -d '{}'
curl -X POST https://<your-worker>/acp-sales/deploy      -H 'content-type: application/json' -d '{}'
curl -X POST https://<your-worker>/acp-scheduling/deploy -H 'content-type: application/json' -d '{}'
```

**9:02 — support on the web**

```bash
curl -X POST https://<your-worker>/acp-support/message \
  -H 'content-type: application/json' \
  -d '{"conversation":"web-abc123","text":"where do I send a refund?"}'
```

The reply renders in the same tab on the real `<mount>/web` page; the embed script is `<mount>/web/embed.js` for any site.

**9:04 — sales in the inbox**

Send one email from a test address to the inbox address printed by `deploy`. The `email.received` webhook fires, `acp-sales` handles it under `email-<thread id>`, and the reply lands in the same thread.

**9:06 — scheduling on the phone**

Call the number (greeting + intake), or text it:

```bash
telnyx-acp text "book me Thursday 2pm"
```

**9:10 — status in all three projects**

```bash
for p in acp-support acp-sales acp-scheduling; do
  curl -s https://<your-worker>/$p/status | jq
done
```

Each shows revision, channel, address, and webhook health.

**9:12 — revise one**

```bash
curl -X POST https://<your-worker>/acp-scheduling/deploy \
  -H 'content-type: application/json' \
  -d '{"instructions":"You are the scheduling agent. Greet warmly and by name. Collect name, service and preferred time, then read the booking back verbatim. Keep every turn under 30 words.","gitSha":"a1b2c3d"}'

curl -s https://<your-worker>/acp-scheduling/versions | jq
```

Revision builds take ≈ 4 minutes on the real CLI — cut the wait in the edit.

**9:14 — logs and traces**

```bash
for p in acp-support acp-sales acp-scheduling; do
  curl -s "https://<your-worker>/$p/logs?since=10m" | jq
done

# walk the sales run's waterfall
curl -s "https://<your-worker>/acp-sales/traces/email-<thread-id>/<run>" | jq
```

The trace shows `memory.read` → `model.call` (with `tokens` and `finishReason`) → `memory.write` → `delivery`. Traces hold **no message text** — that is a beta property, not a bug.

**9:16 — close**

> "Three specialized agents — support, sales, scheduling — deployed and operated through the same ACP workflow."

---

## Demo mode vs live mode

The sample is **safe by default**. `DEMO_MODE` defaults to anything other than `"false"`, and `AGENT_NUMBER` defaults to a placeholder — so `deliver()` returns `demo: would SMS <to>` and **no real SMS is sent**.

### Demo mode (default)

```toml
[env_vars]
DEMO_MODE    = "true"
AGENT_NUMBER = "+1555XXXXXXXX"
```

- Web and email turns run end-to-end (memory, model, trace) — only the outbound SMS is stubbed.
- `deliver()` returns a string describing what *would* have happened.
- Safe to run in CI, safe to record, safe to hand to a reviewer.

### Live mode

```toml
[env_vars]
DEMO_MODE    = "false"
AGENT_NUMBER = "+15550101200"   # your real Telnyx number, E.164
```

- `deliver()` calls `env.TELNYX.messages.send({ to, from, text })` for the scheduling agent.
- Real SMS is sent, real charges apply.
- The `TELNYX` binding injects auth — no API key in code.

Switch by editing `[env_vars]` in `telnyx.toml` and re-shipping. Nothing else changes.

> **Never** commit a real `AGENT_NUMBER`. Keep `+1555XXXXXXXX` in `.env.example` and set the live value at deploy time.

---

## Beta constraints honored on camera

The sample is deliberately honest about what the beta does **not** ship. These are not omissions — they are the demo's credibility.

| Not shown / not claimed | Why |
|---|---|
| `telnyx-acp list` | Reserved for the control-plane API; not shipped in the beta. The router has no `list` verb. |
| Fleet dashboard | Does not exist. The fleet is five verbs typed in three directories. |
| Rollback | Refused in beta. The way back is `git checkout <sha>` + redeploy → a *new* revision. |
| Staging slots / traffic split / approvals | Not in the beta. |
| `texml_application` channels | Declared but unanswered (501). |
| Phone-call traces | Calls are **not traced** in the beta — `call.initiated` logs only, and the response says `traced: false`. Use `logs` for the call side. |
| Production readiness | This is a beta sample. |

Before writing narration, re-check the [Beta Limitations](https://developers.telnyx.com/docs/agents/beta-limitations) page.

---

## Testing

`smoke_test.ts` imports the module and asserts it loads without error — no network, no credentials, no test-runner dependency:

```bash
npx tsx smoke_test.ts
```

It exercises the pure helpers that don't need a live deployment:

- `isProject("acp-support")` → `true`; `isProject("nope")` → `false`
- `parseSince("10m")` → `600000`; `parseSince("30s")` → `30000`; `parseSince(null)` → `600000`
- `PROJECTS.length === 3` and every project has a `CHANNELS` and `ADDRESSES` entry
- `INSTRUCTIONS` is non-empty for all three projects

Run it before opening a PR. It must pass.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `401 invalid signature` on every webhook | `TELNYX_PUBLIC_KEY` missing or wrong | `telnyx-edge secrets add TELNYX_PUBLIC_KEY "<key>"` and re-ship |
| `401` only sometimes | Clock skew > 300s | Sync the host clock; the replay window is ±5 minutes |
| `status` returns `deployed: false` | Project never deployed | `POST /<project>/deploy` |
| `status` returns `webhook.healthy: false` | No events in the last hour | Expected on a quiet project — send a test message |
| `traces` returns 404 | Wrong `conversation` or `run` | The `run` id comes back in the `message` response; copy it exactly |
| `traces` returns 404 for a phone call | Calls are not traced in the beta | Use `logs?since=10m` instead |
| SMS never arrives in live mode | `DEMO_MODE` still `"true"`, or `AGENT_NUMBER` unset | Set both in `[env_vars]` and re-ship |
| `versions` shows a random SHA | You deployed without `gitSha` in the body | Pass `{"gitSha":"<7-40 hex>"}` to `deploy` |
| `telnyx-edge deploy` not found | Wrong command | It's `telnyx-edge ship` |

---

## Next steps

- **[Agent Control Plane docs](https://developers.telnyx.com/docs/agents)** — the product surface this sample mirrors
- **[Getting started](https://developers.telnyx.com/docs/agents/get-started)** — scaffold your first config-only agent
- **[`telnyx-acp` CLI reference](https://developers.telnyx.com/docs/agents/cli)** — every verb, every flag
- **[`agent.json` reference](https://developers.telnyx.com/docs/agents/reference/agent-json)** — the config schema behind each project
- **[Beta Limitations](https://developers.telnyx.com/docs/agents/beta-limitations)** — read this before writing any narration
- **[LLM-ready docs](https://developers.telnyx.com/public/llms/ai-agent-control-plane-beta.txt)** — the whole beta in one text file
- **`acp-business-line`** in `telnyx-code-examples` — the shipped single-agent sample this fleet extends (DEV-1430)

### Ideas to extend

- **Cross-channel memory** — send the same person a web chat and an SMS; the `memory:<conversation>` profile is keyed by the person, so the second turn already knows the first. Try it with the same number as the conversation id.
- **A fourth agent** — add `acp-billing` on `--email`, register a fourth actor namespace, and add one entry to `PROJECTS` / `CHANNELS` / `ADDRESSES` / `INSTRUCTIONS`. The router, the verbs, and the trace pipeline need no changes. That is the point.
- **Model swap** — set `AI_MODEL` to another Telnyx-hosted id from `telnyx-acp models` and compare `finishReason` and token counts in the trace. `openai/*`-style models need your own key as a secret.
- **Trace rendering** — the waterfall is JSON today; a small HTML page that reads `traces/<conversation>/<run>` and draws the four steps is a natural companion demo.

---

*Fingerprint: `cs25:sonam:agent-fleet`*
