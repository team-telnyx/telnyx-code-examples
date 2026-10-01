# Post-Call QA Scoring — Developer Guide

A step-by-step walkthrough of the `post-call-qa-scoring` sample: how each Telnyx primitive is wired together, how to run it locally in demo mode, and how to flip it to live mode.

---

## Prerequisites

- A Telnyx account with an API key (for live mode)
- `telnyx-edge` CLI installed and authenticated (`telnyx-edge auth api-key set <KEY>`)
- Node.js 20+ (for local smoke test via `npx tsx`)
- A Telnyx phone number (live mode only)

---

## Project Layout

```
post-call-qa-scoring/
├── src/
│   ├── index.ts          # Worker entry: webhook routing + demo trigger
│   ├── agent.ts          # QAAgent — the durable quality-profile actor
│   ├── judging.ts        # Decision Models request build + response parse (pure)
│   ├── scoring.ts        # Rolling window, coaching, digest line (pure)
│   └── routing.ts        # Webhook payload → agent identity resolution (pure)
├── smoke_test.ts         # Runs the pure modules on Node (no edge-runtime import)
├── package.json
├── tsconfig.json
├── telnyx.toml           # Actor binding, Telnyx binding, secrets
├── .env.example
└── .gitignore
```

---

## Environment Variables

All configuration flows through Telnyx `[[secrets]]` (read via `this.env.SECRETS.get()`), declared in `telnyx.toml`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELNYX_API_KEY` | Yes (live) | — | Telnyx API key for Decision Models calls |
| `TELNYX_FROM_NUMBER` | Yes (live) | — | Number you own with messaging enabled; the digest/alert sender |
| `QA_COACHING_FLOOR` | No | `3.0` | 5-call rolling average below this flags an agent for coaching |
| `TEAM_LEAD_E164` | Yes (live) | — | E.164 phone number that receives daily digest SMS |
| `DIGEST_HOUR_UTC` | No | `17` | Hour of day (UTC) the daily digest fires |
| `CALL_METADATA_AGENT_KEY` | No | `agentId` | Metadata key in the webhook payload that holds the agent ID |
| `AGENT_NUMBER_MAP` | No | — | JSON map of phone number → agent ID (fallback when metadata key is absent) |

Copy `.env.example` to `.env` and fill in values for live mode. In demo mode, no real credentials are needed.

---

## How It Works — Step by Step

### 1. Webhook Entry Point (`src/index.ts`)

The Edge function exposes four routes:

- **`POST /webhook/call-conversation-ended`** — Primary trigger. Fired by Telnyx when a support call ends. The transcript is embedded in `data.payload.transcript`.
- **`POST /webhook/transcription-saved`** — Fallback. If the ended-call payload lacks a transcript, this callback delivers the finalized transcript.
- **`POST /demo/trigger`** — Offline demo trigger. Accepts a synthetic payload (agent ID, call ID, transcript) so you can exercise the full pipeline without placing a real call.
- **`GET /health/liveness`** and **`GET /health/readiness`** — platform probes.

All three POST routes resolve the agent identity, look up (or create) the durable `QAAgent` actor, and call `stub.recordCallEnded(callId, transcript, agentId, digestEnabled)`.

### 2. Agent Resolution (`env.QA_AGENT.idFromName`)

Each support agent gets exactly one durable actor. The actor ID is derived from the agent ID via `env.QA_AGENT.idFromName(agentId)`. This means:

- The actor survives pod restarts — its SQL history and in-actor state persist.
- Multiple calls for the same agent route to the same actor instance.
- The actor self-provisions on first contact — no manual setup.

Agent ID resolution order (in `src/routing.ts`):

1. `data.metadata[CALL_METADATA_AGENT_KEY]` (default key: `agentId`) — digest enabled
2. `AGENT_NUMBER_MAP` JSON lookup by called/caller number — digest enabled
3. Fallback: `data.called_number` (digest suppressed — log-only mode)

### 3. Transcript Handling

The actor does **not** accumulate per-event transcription callbacks. It reads the transcript from the webhook payload directly:

- `call-conversation-ended` → `data.payload.transcript`
- `transcription-saved` → `data.payload.transcript`

If no transcript is present, the worker logs `no_transcript` and returns without recording or scoring — no false zero scores. The `transcription-saved` fallback delivers the finalized transcript later; whichever delivery arrives first records the call, and the second is a no-op.

### 4. Telnyx Decision Models Grading (`gradeCall`)

The actor calls the Decision Models API via raw `fetch` to `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone` (see `src/judging.ts`). `questions` is an **object** keyed by question name, each with `type` + `instructions` and — for `choice` and `score` — a `criteria` block:

```json
{
  "model": "telnyx/decision-flash",
  "state": { "transcript": "..." },
  "questions": {
    "choice": {
      "type": "choice",
      "instructions": "Did the support agent pass or fail QA? If the call failed, pick the failing category that best describes why.",
      "criteria": {
        "pass": "The call met QA standards",
        "fail_compliance": "Missed a required disclosure or violated a compliance rule",
        "fail_empathy": "Rude, dismissive, or failed to acknowledge the customer's situation",
        "fail_process": "Followed the wrong procedure or gave incorrect instructions",
        "fail_resolution": "Failed to resolve or meaningfully advance the customer's issue"
      }
    },
    "noul": {
      "type": "noul",
      "instructions": "Does the transcript contain a hard compliance breach — e.g. a legally required disclosure is missing or a prohibited statement is made? 1 = yes, breach present; 0 = no breach."
    },
    "score": {
      "type": "score",
      "instructions": "Rate the overall call quality on the rubric, where lower is worse and higher is better.",
      "criteria": ["Very poor", "Poor", "Fair", "Good", "Very good", "Excellent"]
    }
  }
}
```

The response carries `answers` with one entry per question and no `data` wrapper:

- **`answers.choice.choice`** — `pass` or a `fail_<category>` key from the criteria
- **`answers.noul.noul`** — 0–1 breach score (1 = breach present)
- **`answers.score.score`** — expected index over the 6-entry rubric → a 0–5 quality score

An unknown `choice` value is coerced to `pass` — the sample never invents a failing category.

#### Retry Logic

Decision Models API failures use bounded backoff. Attempt 0 is the initial call; failures schedule the next attempt at 10s / 30s / 60s (honoring a `Retry-After` header when present). After the 3rd retry fails, the call is recorded with `status="ungraded"` and `last_error="decision_failed_after_retries"`. No infinite retries. Non-transient failures (4xx other than 429, malformed responses) go straight to `ungraded`.

### 5. Durable Score History (`scores` SQL table)

Every call is recorded in the actor's private SQL database (`this.ctx.storage.sql` — no `telnyx.toml` declaration needed):

```sql
CREATE TABLE IF NOT EXISTS scores(
  call_id     TEXT PRIMARY KEY,   -- UNIQUE constraint = exactly-once backstop
  agent_id    TEXT,
  ts          INTEGER,
  choice      TEXT,
  noul        REAL,
  score       REAL,
  status      TEXT,               -- "pending" | "graded" | "ungraded"
  transcript  TEXT,               -- kept so retries survive eviction
  last_error  TEXT
)
```

A `pending` row is written BEFORE the grading task is scheduled, so a re-delivered webhook finds the row and no-ops. Once the Decision Models API returns, the row is updated to `graded` (or `ungraded`). The `call_id` PRIMARY KEY rejects duplicates even across restarts.

### 6. Rolling Trend & Coaching Flag (`recomputeTrend`)

After each grade, the actor recomputes the 5-call rolling average from SQL:

```sql
SELECT ts, choice, noul, score, status, last_error FROM scores
WHERE status = 'graded'
ORDER BY ts DESC LIMIT 5
```

- If the average drops below `QA_COACHING_FLOOR` (default 3.0), the agent is flagged for coaching. The worst failing category (most frequent failing category in the window; ties broken by lowest average score, then recency) is surfaced in the digest.
- If the average recovers to ≥ floor, the flag **auto-clears** and the next digest shows `cleared (avg X.X)` once.
- The rolling average, trend, and flag are cached in actor state (`setState`) as a fast path, but are always recomputed from SQL on each grade — state survives evictions, SQL survives everything.

The trend compares the average of the newest half of the window against the older half: `improving`, `declining`, or `flat`.

### 7. Breach Flagging (`applyGrade`)

Independent of pass/fail, if `noul > 0.8`, the call is flagged for manager review:

```sql
CREATE TABLE IF NOT EXISTS breaches(
  agent_id TEXT,
  call_id  TEXT,
  ts       INTEGER,
  noul     REAL,
  choice   TEXT
)
```

A passing call (`choice=pass`) can still carry a breach — this two-axis read is exactly what `choice` + `noul` + `score` enables. A breach also sends an immediate alert SMS to the team lead, in addition to the daily digest.

### 8. Daily Digest (`runDigest`)

Each actor schedules its own daily digest tick on first call, then re-arms the next `DIGEST_HOUR_UTC` (default 17:00 UTC) run **before** sending — so a mid-SMS crash cannot kill the chain. The digest is a single SMS one-liner sent via `this.env.TELNYX.messages.send({ to, from, text })`:

```
[demo-agent] avg=2.4/3.0 trend=declining COACHING (worst: fail_empathy) breach (noul=0.92)
```

Or on recovery:

```
[demo-agent] avg=4.1/3.0 trend=improving cleared (avg 4.1)
```

Or if the Decision Models API failed:

```
[demo-agent] avg=n/a trend=flat ungraded: decision_http_502
```

N agents ⇒ N texts, each prefixed with the agent's identity. Actors keyed only by a fallback identity (no metadata, no number map) suppress the digest (log-only).

### 9. Exactly-Once Guarantee

Two durable layers ensure each call is graded exactly once:

1. **Stable scheduled task** — `grade:<callId>` is a stable task id (`schedule(..., { id })`). If the webhook is redelivered, the same task id is scheduled and the SDK replaces the pending task.
2. **SQL UNIQUE constraint** — the `pending` `scores` row is written before the task is queued, with `call_id` as `PRIMARY KEY`. Even if the fast path is bypassed (e.g., actor restart between check and insert), the database rejects duplicates.

The in-actor row check (`findScore`) is only a fast path — never the guarantee.

### 10. Interruption Resilience

If the Edge function is killed between the Decision Models API call and the score update:

- The `grade:<callId>` scheduled task survives the restart (it's durable).
- On re-activation the SDK re-arms pending tasks; the transcript is read from the durable `pending` row, not the task payload.
- The `call_id` PRIMARY KEY prevents duplicate rows when the task re-runs.
- History, breach flags, and coaching state are all durable in SQL and actor state.

---

## Demo Mode vs Live Mode

### Demo Mode (default)

No real calls, no real SMS, no real charges. Trigger the pipeline with a synthetic POST to the deployed function:

```bash
curl -X POST https://<edge-function-url>/demo/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "demo-agent",
    "callId": "demo_12345"
  }'
```

Omit the body entirely for the canned support transcript. The actor grades the transcript via Decision Models (using the API key from secrets), inserts the score, recomputes the trend, and — if `TEAM_LEAD_E164` and `TELNYX_FROM_NUMBER` are set — sends a digest SMS.

**Alternative demo trigger (inbound demo number):** bind a second Telnyx number to a tiny inbound Edge function that answers, plays a canned script (~20 s), and hangs up — simulating an ended call. The synthetic POST path is the network-free equivalent.

### Live Mode

1. Set `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, and `TEAM_LEAD_E164` in your Telnyx secrets.
2. Configure your Telnyx voice application to send `call-conversation-ended` webhooks to your deployed Edge URL.
3. Ensure `CALL_METADATA_AGENT_KEY` matches the metadata key you set at call start (or configure `AGENT_NUMBER_MAP`).

Deploy with:

```bash
telnyx-edge ship
```

---

## Running Locally

### Smoke Test

```bash
npm install
npm test
```

The smoke test (`smoke_test.ts`) runs on Node via `tsx` against the pure modules only — `judging.ts`, `scoring.ts`, `routing.ts` — because `@telnyx/edge-runtime` only loads inside the Edge runtime. It verifies the real Decision Models request shape, response parsing, the 10/30/60 retry-then-ungraded policy, rolling trend and coaching decisions, digest line content, the breach threshold, and webhook routing/fallbacks.

### Type Check

```bash
npm run typecheck
```

Runs `tsc --noEmit` over the agent and worker sources plus the smoke test.

### Local Development

The Edge runtime doesn't have a `telnyx-edge dev` command for local serving. To test locally:

1. Run the smoke test to verify the pure logic.
2. Run `npm run typecheck` to type-check the agent and worker.
3. For full webhook testing, deploy to a staging environment with `telnyx-edge ship`.

---

## Telnyx Primitives Used

| Primitive | How It's Used |
|---|---|
| **Agent SDK** (`Agent<Env, AgentState>`) | `QAAgent` extends `Agent`; owns per-agent score history, rolling trend, coaching/breach flags, and daily digest. Survives weeks of calls and pod restarts. |
| **Telnyx Decision Models** | `POST /v2/ai/typesafe/v1/systemone` with `{model, state, questions}` — returns `choice`, `noul`, `score` in one shared-state call. |
| **Call Control** | `call-conversation-ended` webhook (transcript embedded in payload) + `transcription-saved` (fallback). |
| **Messaging** | `this.env.TELNYX.messages.send({ to, from, text })` — per-agent daily digest line to `TEAM_LEAD_E164`; immediate breach alerts. |
| **Agent SQL** | `this.ctx.storage.sql.exec()` — private per-actor `scores` table (call_id PRIMARY KEY) and `breaches` table. |
| **Scheduled Tasks** | `digest` daily tick at DIGEST_HOUR_UTC (self-rescheduling, stable id); `grade:<callId>` stable task for exactly-once grading. |
| **Secrets** | All configuration via `this.env.SECRETS.get()` — see the Environment Variables table. |

---

## Next Steps

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk) — Learn about durable actors, SQL storage, scheduled tasks, and state management.
- [Telnyx Decision Models](https://developers.telnyx.com/docs/inference/decision-models) — Full reference for the `systemone` endpoint, question types, and response formats.
- [Call Control Webhooks](https://developers.telnyx.com/api-reference/callbacks/call-conversation-ended) — Understand the `call-conversation-ended` and `transcription-saved` payload structures.
- [Telnyx Messaging API](https://developers.telnyx.com/docs/messaging/messages/send-message) — Send SMS messages via the `TELNYX` binding.
- [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge) — Deploy, manage secrets, and monitor your Edge functions.
- [edge-customer-agent-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — The Entity Agent pattern: one durable actor per customer.
