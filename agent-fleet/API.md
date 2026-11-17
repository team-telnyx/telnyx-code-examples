# API Reference — `agent-fleet`

Typed HTTP contract for the three-agent fleet runtime. Every route is scoped to a
project directory (`acp-support`, `acp-sales`, `acp-scheduling`) and mirrors one
`telnyx-acp` verb, so the operating surface is identical per project.

**Base URL (local):** `http://localhost:8787`
**Base URL (deployed):** `https://<your-worker>.<account>.workers.dev`
**Content type:** `application/json` on every response.

## Verb → Route Map

| `telnyx-acp` verb | HTTP route | Notes |
|---|---|---|
| `deploy` | `POST /{project}/deploy` | Creates a new revision |
| `status` | `GET /{project}/status` | Revision, channel, webhook health |
| `logs --since 10m` | `GET /{project}/logs?since=10m` | One JSON line per runtime event |
| `traces <conversation> <run>` | `GET /{project}/traces/{conversation}/{run}` | Run waterfall |
| `versions <agent>` | `GET /{project}/versions` | Revisions with git short SHAs |
| `text "..."` | `POST /{project}/message` | One turn through the agent |
| `list` | — | **Not implemented.** Reserved for the control-plane API; not shipped in the beta. Returns `404`. |
| `rollback` | — | **Not implemented.** Refused in beta — the way back is checkout + redeploy. |

### Path parameters

| Parameter | Type | Required | Allowed values | Description |
|---|---|---|---|---|
| `project` | string | yes | `acp-support`, `acp-sales`, `acp-scheduling` | The project directory. Anything else returns `404`. |

---

## `GET /{project}/status`

Returns the live revision, the channel wiring, and webhook health for one project.

### Request

No body, no query parameters.

```bash
curl -s http://localhost:8787/acp-support/status
```

### Response — `200 OK` (deployed)

```json
{
  "project": "acp-support",
  "deployed": true,
  "revision": 3,
  "gitSha": "a1b2c3d",
  "channel": "web",
  "address": "/web",
  "deployedAt": "2025-06-09T09:02:11.004Z",
  "webhook": {
    "lastEventAt": "2025-06-09T09:04:52.881Z",
    "healthy": true
  }
}
```

| Field | Type | Description |
|---|---|---|
| `project` | string | Project name |
| `deployed` | boolean | `false` when no revision exists yet |
| `revision` | number | Monotonic revision counter |
| `gitSha` | string | 7-char git short SHA recorded at deploy |
| `channel` | string | `web` \| `email` \| `phone` |
| `address` | string | `/web`, the inbox address, or the E.164 number |
| `deployedAt` | string | ISO-8601 timestamp of the last deploy |
| `webhook.lastEventAt` | string \| null | Timestamp of the most recent log line in the last hour |
| `webhook.healthy` | boolean | `true` when at least one event landed in the last hour |

### Response — `200 OK` (not yet deployed)

```json
{
  "project": "acp-sales",
  "deployed": false,
  "hint": "run deploy in acp-sales/"
}
```

---

## `GET /{project}/versions`

Lists every revision of one project with its git short SHA.

### Request

```bash
curl -s http://localhost:8787/acp-scheduling/versions
```

### Response — `200 OK`

```json
{
  "project": "acp-scheduling",
  "versions": [
    { "revision": 1, "gitSha": "9f3c0aa", "deployedAt": "2025-06-08T21:14:02.117Z" },
    { "revision": 2, "gitSha": "4d81be2", "deployedAt": "2025-06-09T09:12:44.530Z" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `project` | string | Project name |
| `versions` | array | Ordered oldest → newest; empty array if never deployed |
| `versions[].revision` | number | Revision number |
| `versions[].gitSha` | string | 7-char git short SHA |
| `versions[].deployedAt` | string | ISO-8601 deploy timestamp |

> There is no rollback route. Reverting means checking out the earlier SHA and
> calling `POST /{project}/deploy` again — which produces a **new** revision.

---

## `GET /{project}/logs`

Returns runtime events for one project, newest last.

### Query parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `since` | string | no | `10m` | Window as `<number><unit>` where unit is `s`, `m`, or `h`. Unparseable values fall back to `10m`. |

### Request

```bash
curl -s "http://localhost:8787/acp-sales/logs?since=10m"
```

### Response — `200 OK`

```json
[
  {
    "at": "2025-06-09T09:04:51.220Z",
    "project": "acp-sales",
    "event": "deploy",
    "conversation": "-",
    "detail": "revision 1 live (9f3c0aa)"
  },
  {
    "at": "2025-06-09T09:04:52.881Z",
    "project": "acp-sales",
    "event": "modelStream",
    "conversation": "email-7c1f...",
    "detail": "meta-llama/Llama-3.3-70B-Instruct · 96 completion tokens"
  }
]
```

| Field | Type | Description |
|---|---|---|
| `at` | string | ISO-8601 event timestamp |
| `project` | string | Project name |
| `event` | string | `deploy`, `modelStream`, `voiceCall`, `voiceTurn`, `voiceFiller`, … |
| `conversation` | string | Conversation id, or `-` for project-level events |
| `detail` | string | Human-readable event detail |

Log lines expire after 7 days. At most 500 keys are scanned per call.

> Phone calls are **not traced** in the beta. The call side is observable through
> `voiceCall` / `voiceTurn` log lines only.

---

## `GET /{project}/traces/{conversation}/{run}`

Returns the run waterfall for one conversation turn: memory read → model call →
memory write → delivery.

### Path parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `conversation` | string | yes | Conversation id — the browser conversation id, `email-<thread id>`, or the caller's number |
| `run` | string | yes | Run id returned by `POST /{project}/message` |

### Request

```bash
curl -s "http://localhost:8787/acp-sales/traces/email-7c1f9a2b/m1x8k2p-4d81"
```

### Response — `200 OK`

```json
{
  "project": "acp-sales",
  "conversation": "email-7c1f9a2b",
  "run": "m1x8k2p-4d81",
  "steps": [
    { "step": "memory.read", "detail": "0 fact(s) on file", "at": "2025-06-09T09:04:52.101Z" },
    {
      "step": "model.call",
      "detail": "meta-llama/Llama-3.3-70B-Instruct",
      "at": "2025-06-09T09:04:52.640Z",
      "tokens": { "prompt": 412, "completion": 96 },
      "finishReason": "stop"
    },
    { "step": "memory.write", "detail": "1 fact(s) stored", "at": "2025-06-09T09:04:52.702Z" },
    { "step": "delivery", "detail": "email thread email-7c1f9a2b", "at": "2025-06-09T09:04:52.881Z" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `project` | string | Project name |
| `conversation` | string | Conversation id |
| `run` | string | Run id |
| `steps` | array | Ordered waterfall |
| `steps[].step` | string | `memory.read` \| `model.call` \| `memory.write` \| `delivery` |
| `steps[].detail` | string | Step-specific detail (fact count, model id, delivery target) |
| `steps[].at` | string | ISO-8601 step timestamp |
| `steps[].tokens` | object | Present on `model.call` only — `prompt` and `completion` counts |
| `steps[].finishReason` | string | Present on `model.call` only — e.g. `stop` |

Traces hold **no message text** — only step metadata. Traces expire after 7 days.

### Response — `400 Bad Request`

```json
{ "error": "usage: traces <conversation> <run>" }
```

### Response — `404 Not Found`

```json
{ "error": "no trace for that conversation and run" }
```

---

## `POST /{project}/deploy`

Creates a new revision for one project. This is the only write route that
mutates the project record.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `instructions` | string | no | Replacement `instructions.md` body. Trimmed and capped at 4000 chars. Omitted or empty → the previous instructions are kept, falling back to the built-in default. |
| `gitSha` | string | no | 7–40 lowercase hex chars. Truncated to 7. Invalid values are replaced with a generated short SHA. |

```bash
curl -s -X POST http://localhost:8787/acp-scheduling/deploy \
  -H 'content-type: application/json' \
  -d '{
    "instructions": "You are the scheduling agent on the phone and over SMS. Greet warmly, collect name, service and preferred time, then read the booking back verbatim. Keep every turn under 30 words.",
    "gitSha": "4d81be2"
  }'
```

### Response — `201 Created`

```json
{
  "name": "acp-scheduling",
  "channel": "phone",
  "revision": 2,
  "gitSha": "4d81be2",
  "deployedAt": "2025-06-09T09:12:44.530Z",
  "instructions": "You are the scheduling agent on the phone and over SMS. Greet warmly, …",
  "address": "+1555XXXXXXXX",
  "versions": [
    { "revision": 1, "gitSha": "9f3c0aa", "deployedAt": "2025-06-08T21:14:02.117Z" },
    { "revision": 2, "gitSha": "4d81be2", "deployedAt": "2025-06-09T09:12:44.530Z" }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `name` | string | Project name |
| `channel` | string | `web` \| `email` \| `phone` |
| `revision` | number | New revision number (`previous + 1`) |
| `gitSha` | string | 7-char git short SHA for this revision |
| `deployedAt` | string | ISO-8601 deploy timestamp |
| `instructions` | string | Instructions in force for this revision |
| `address` | string | Channel address (`/web`, inbox, or E.164) |
| `versions` | array | Full revision history, oldest → newest |

---

## `POST /{project}/message`

Sends one turn to a project's agent: memory read → model call → memory write →
delivery. This is the route behind `telnyx-acp text "..."` and the web chat page.

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `conversation` | string | yes | Conversation id. Web: the page's conversation id. Email: `email-<thread id>`. Phone/SMS: the caller's E.164 number. |
| `text` | string | yes | Inbound message text |
| `from` | string | no | Sender address. Used as the SMS destination on the `phone` channel; defaults to `conversation`. |

```bash
curl -s -X POST http://localhost:8787/acp-scheduling/message \
  -H 'content-type: application/json' \
  -d '{ "conversation": "+15550101200", "text": "book me Thursday 2pm" }'
```

### Response — `200 OK`

```json
{
  "project": "acp-scheduling",
  "conversation": "+15550101200",
  "reply": "Happy to book that — Thursday at 2pm. Can I get your name and the service you need?",
  "run": "m1x8k2p-4d81"
}
```

| Field | Type | Description |
|---|---|---|
| `project` | string | Project name |
| `conversation` | string | Conversation id echoed back |
| `reply` | string | The agent's reply text |
| `run` | string | Run id — pass to `GET /{project}/traces/{conversation}/{run}` |

### Response — `200 OK` (validation failure)

Validation errors are returned with a `200` status and an `error` field:

```json
{ "error": "conversation and text are required" }
```

### Delivery behavior per channel

| Project | Delivery |
|---|---|
| `acp-support` | Rendered on the web page (`web page <conversation>`) |
| `acp-sales` | Reply lands in the same email thread (`email thread <conversation>`) |
| `acp-scheduling` | SMS via the `TELNYX` binding when `DEMO_MODE=false` and `AGENT_NUMBER` is set; otherwise `demo: would SMS <to>` |

---

## `POST /webhook/telnyx`

Inbound Telnyx webhook receiver. Verifies the Ed25519 signature before reading
any field, then dispatches by `data.event_type`.

### Headers

| Header | Type | Required | Description |
|---|---|---|---|
| `telnyx-signature-ed25519` | string | yes | Base64 Ed25519 signature over `<timestamp>\|<raw body>` |
| `telnyx-timestamp` | string | yes | Unix seconds. Rejected if more than 300s from now. |
| `content-type` | string | yes | `application/json` |

The public key is read from the `TELNYX_PUBLIC_KEY` secret.

### Request

```bash
curl -s -X POST http://localhost:8787/webhook/telnyx \
  -H 'content-type: application/json' \
  -H 'telnyx-signature-ed25519: <base64-signature>' \
  -H 'telnyx-timestamp: 1749459892' \
  -d '{
    "data": {
      "event_type": "email.received",
      "payload": {
        "thread_id": "7c1f9a2b",
        "from": "customer@example.com",
        "text": "Do you offer annual billing?"
      }
    }
  }'
```

### Handled event types

| `data.event_type` | Routed to | Conversation key |
|---|---|---|
| `email.received` | `acp-sales` | `email-<thread_id>` (falls back to `id`) |
| `message.received` | `acp-scheduling` | The sender's number |
| `call.initiated` | `acp-scheduling` (log only) | The caller's number |

`call.initiated` writes a `voiceCall` log line and returns `traced: false` —
phone calls are not traced in the beta.

### Response — `200 OK` (email / SMS turn)

```json
{
  "received": true,
  "project": "acp-sales",
  "conversation": "email-7c1f9a2b",
  "reply": "Yes — annual billing is available. I'll have a teammate send the exact terms today.",
  "run": "m1x8k2p-4d81"
}
```

### Response — `200 OK` (call, not traced)

```json
{ "received": true, "traced": false }
```

### Response — `200 OK` (ignored)

```json
{ "received": true, "ignored": "missing thread or body" }
```

### Response — `401 Unauthorized`

```json
{ "error": "invalid signature" }
```

Returned when either header is missing, the timestamp is outside the 300s
window, `TELNYX_PUBLIC_KEY` is unset, or verification fails.

---

## Status Codes

| Code | Route(s) | Meaning | Body |
|---|---|---|---|
| `200` | `status`, `versions`, `logs`, `traces`, `message`, `webhook` | Success | Route-specific JSON (see above) |
| `201` | `deploy` | New revision created | `ProjectRecord` |
| `400` | `traces` | Missing `conversation` or `run` path segment | `{ "error": "usage: traces <conversation> <run>" }` |
| `401` | `webhook` | Ed25519 signature missing, stale, or invalid | `{ "error": "invalid signature" }` |
| `404` | any | Unknown `project` segment | `{ "error": "unknown project; the fleet is acp-support, acp-sales, acp-scheduling" }` |
| `404` | any | Unknown verb segment (including `list` and `rollback`) | `{ "error": "verbs: status, logs, traces, versions, deploy, message" }` |
| `404` | `traces` | No stored trace for that conversation + run | `{ "error": "no trace for that conversation and run" }` |
| `500` | any | Unhandled failure; details are logged, never returned | `{ "error": "request failed" }` |

---

## Error Envelope

Every non-2xx response (and the `message` validation failure) uses the same
shape:

```json
{ "error": "<human-readable message>" }
```

Internal failure details are written to `console.error` with the project and verb
and are never included in the HTTP response.

---

## Storage & Retention

| Key prefix | Contents | TTL |
|---|---|---|
| `project:<name>` | `ProjectRecord` — revision, gitSha, instructions, versions | none |
| `memory:<conversation>` | `MemoryProfile` — facts carried across channels | 30 days |
| `trace:<project>:<conversation>:<run>` | Run waterfall | 7 days |
| `log:<project>:<at>:<rand>` | One `LogLine` per runtime event | 7 days |

Agent Memory is keyed by conversation, not by message — the same person's page
chat, email, and text share one profile.
