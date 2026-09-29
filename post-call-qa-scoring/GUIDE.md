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
│   └── index.ts          # Main Edge entry: webhook handler + QAAgent class
├── smoke_test.ts         # Verifies module loads and key methods exist
├── package.json
├── tsconfig.json
├── telnyx.toml           # Actor binding, secrets, storage declarations
├── .env.example
└── .gitignore
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELNYX_API_KEY` | Yes (live) | — | Telnyx API key for Jev Decision Models calls |
| `QA_COACHING_FLOOR` | No | `3.0` | 5-call rolling average below this flags an agent for coaching |
| `TEAM_LEAD_E164` | Yes | — | E.164 phone number that receives daily digest SMS |
| `DIGEST_HOUR_UTC` | No | `17` | Hour of day (UTC) the daily digest fires |
| `CALL_METADATA_AGENT_KEY` | No | `agentId` | Metadata key in the webhook payload that holds the agent ID |
| `AGENT_NUMBER_MAP` | No | — | JSON map of phone number → agent ID (fallback when metadata key is absent) |

Copy `.env.example` to `.env` and fill in values for live mode. In demo mode, no real credentials are needed.

---

## How It Works — Step by Step

### 1. Webhook Entry Point (`handleWebhook`)

The Edge function exposes three routes:

- **`POST /webhook/call-conversation-ended`** — Primary trigger. Fired by Telnyx when a support call ends. The transcript is embedded in `data.transcript`.
- **`POST /webhook/transcription-saved`** — Fallback. If the ended-call payload lacks a transcript, this callback delivers the finalized transcript.
- **`POST /demo/trigger`** — Offline demo trigger. Accepts a synthetic payload (agent ID, call ID, transcript) so you can exercise the full pipeline without placing a real call.

All three routes resolve the agent ID, look up (or create) the durable `QAAgent` actor, and call `actor.onCallEnded(callId, transcript, agentId)`.

### 2. Agent Resolution (`env.QA_AGENT.idFromName`)

Each support agent gets exactly one durable actor. The actor ID is derived from the agent ID via `env.QA_AGENT.idFromName(agentId)`. This means:

- The actor survives pod restarts — its SQL history and in-actor state persist.
- Multiple calls for the same agent route to the same actor instance.
- The actor self-provisions on first contact — no manual setup.

Agent ID resolution order:

1. `data.metadata[CALL_METADATA_AGENT_KEY]` (default key: `agentId`)
2. `AGENT_NUMBER_MAP` JSON lookup by caller/called number
3. Fallback: `data.called_number` (digest suppressed — log-only mode)

### 3. Transcript Handling

The actor does **not** accumulate per-event transcription callbacks. It reads the transcript from the webhook payload directly:

- `call-conversation-ended` → `data.transcript`
- `transcription-saved` → `data.transcript`

If no transcript is present, the actor logs `no_transcript` and returns without scoring — no false zero scores.

### 4. Jev Decision Models Grading (`judgeWithJev`)

The actor calls Jev via raw `fetch` to `POST https://api.telnyx.com/v2/ai/typesafe/v1/systemone` with:

```json
{
  "model": "telnyx/decision-flash",
  "state": { "transcript": "..." },
  "questions": [
    { "id": "choice", "type": "choice", "prompt": "Did the agent pass or fail? If fail, which category?" },
    { "id": "noul", "type": "number", "prompt": "Was there a hard compliance breach (0-1)?" },
    { "id": "score", "type": "number", "prompt": "Quality score 0-5." }
  ]
}
```

Jev returns three values in a single shared-state call:

- **`choice`** — `pass` or `fail_<category>` (e.g., `fail_disclosure`)
- **`noul`** — 0–1 compliance breach severity
- **`score`** — 0–5 quality score

#### Retry Logic

Jev failures use bounded backoff:

- Attempt 1 → 10s delay
- Attempt 2 → 30s delay
- Attempt 3 → 60s delay

If all three attempts fail, the call is recorded with `status="ungraded"` and `lastError="jev_failed"`. No infinite retries.

HTTP 429 and 5xx responses honor `Retry-After` header if present, otherwise use the backoff schedule.

### 5. Durable Score History (`scores` SQL table)

Every graded call appends a row to the `scores` table:

```sql
CREATE TABLE scores(
  agentId TEXT,
  callId TEXT PRIMARY KEY,   -- UNIQUE constraint = exactly-once backstop
  ts INTEGER,
  choice TEXT,
  noul REAL,
  score REAL,
  status TEXT,               -- "graded" or "ungraded"
  lastError TEXT
)
```

The `callId` PRIMARY KEY ensures exactly-once insertion even if the webhook is redelivered. The in-actor `graded(callId)` check is a fast path — the SQL constraint is the durable guarantee.

### 6. Rolling Trend & Coaching Flag (`recomputeTrend`)

After each score insert, the actor recomputes the 5-call rolling average from SQL:

```sql
SELECT score, choice FROM scores
WHERE agentId = ? AND status = 'graded'
ORDER BY ts DESC LIMIT 5
```

- If the average drops below `QA_COACHING_FLOOR` (default 3.0), the agent is flagged for coaching. The worst failing category is surfaced in the digest.
- If the average recovers to ≥ floor, the flag **auto-clears** and the digest shows `cleared (avg X.X)`.
- The rolling average is stored in actor state (`state.rolling`) as a fast-path cache, but is always recomputed from SQL on each call.

### 7. Breach Flagging (`flagBreach`)

Independent of pass/fail, if `noul > 0.8`, the call is flagged for manager review:

```sql
CREATE TABLE breaches(
  agentId TEXT,
  callId TEXT,
  ts INTEGER,
  noul REAL,
  choice TEXT
)
```

A passing call (`choice=pass`) can still carry a breach — this two-axis read is exactly what `choice` + `noul` + `score` enables.

### 8. Daily Digest (`digest` + `scheduledDigest`)

Each actor schedules its own daily digest at `DIGEST_HOUR_UTC` (default 17:00 UTC). The digest is a single SMS one-liner sent to `TEAM_LEAD_E164`:

```
[demo-agent] avg=3.2 ⚠️ COACHING (worst: fail_disclosure) 🚨 breach (noul=0.9)
```

Or on recovery:

```
[demo-agent] avg=4.1 ✓ cleared (avg 4.1)
```

Or if Jev failed:

```
[demo-agent] avg=n/a ⚠️ ungraded: jev_failed
```

N agents ⇒ N texts, each prefixed with the agent's name/ID.

### 9. Exactly-Once Guarantee

Two layers ensure each call is scored exactly once:

1. **Stable scheduled task** — `grade:<callId>` is a stable task ID. If the webhook is redelivered, the same task ID is scheduled, and the actor's `graded(callId)` fast-path check returns early.
2. **SQL UNIQUE constraint** — `scores.callId` is `PRIMARY KEY`, so even if the in-actor check is bypassed (e.g., actor restart between check and insert), the database rejects duplicates via `INSERT OR IGNORE`.

### 10. Interruption Resilience

If the Edge function is killed between the Jev call and the score insert:

- The `grade:<callId>` scheduled task survives the restart (it's durable).
- On restart, the task re-runs `judgeWithJev` and `insertScore`.
- The `INSERT OR IGNORE` on `scores.callId` prevents duplicate rows.
- History, breach flags, and coaching state are all durable in SQL.

---

## Demo Mode vs Live Mode

### Demo Mode (default)

No real calls, no real SMS, no real charges. Trigger the pipeline with a synthetic POST:

```bash
curl -X POST http://localhost:8787/demo/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "demo-agent",
    "callId": "demo_12345",
    "transcript": "Agent: Thank you for calling Telnyx Support..."
  }'
```

The actor grades the transcript via Jev (using the API key from secrets), inserts the score, recomputes the trend, and — if `TEAM_LEAD_E164` is set — sends a digest SMS.

### Live Mode

1. Set `TELNYX_API_KEY` in your Telnyx secrets.
2. Set `TEAM_LEAD_E164` to a real E.164 number.
3. Configure your Telnyx voice application to send `call-conversation-ended` webhooks to your deployed Edge URL.
4. Ensure `CALL_METADATA_AGENT_KEY` matches the metadata key you set at call start (or configure `AGENT_NUMBER_MAP`).

Deploy with:

```bash
telnyx-edge ship
```

---

## Running Locally

### Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that the `QAAgent` class loads, key methods exist, and the module has no import errors.

### Local Development

The Edge runtime doesn't have a `telnyx-edge dev` command for local serving. To test locally:

1. Run the smoke test to verify the module loads.
2. Use the `/demo/trigger` endpoint pattern by calling `handleDemoTrigger` directly in a test script.
3. For full webhook testing, deploy to a staging environment with `telnyx-edge ship`.

---

## Telnyx Primitives Used

| Primitive | How It's Used |
|---|---|
| **Agent SDK** (`Agent<Env, AgentState>`) | `QAAgent` extends `Agent`; owns per-agent score history, rolling trend, coaching/breach flags, and daily digest. Survives weeks of calls and pod restarts. |
| **Jev Decision Models** | `POST /v2/ai/typesafe/v1/systemone` with `{model, state, questions}` — returns `choice`, `noul`, `score` in one shared-state call. |
| **Call Control** | `call-conversation-ended` webhook (transcript embedded in payload) + `transcription-saved` (fallback fetch). |
| **Messaging** | `this.env.TELNYX.messages.send({ to, text })` — per-agent daily digest line to `TEAM_LEAD_E164`; breach alerts. |
| **SQL** | `scores` table (callId UNIQUE) for durable exactly-once backstop; `breaches` table for compliance flags. |
| **Scheduled Tasks** | `digest:<agentId>` daily tick at 17:00 UTC; `grade:<callId>` stable task for exactly-once grading. |
| **Secrets** | `TELNYX_API_KEY`, `QA_COACHING_FLOOR`, `TEAM_LEAD_E164`, `DIGEST_HOUR_UTC`, `CALL_METADATA_AGENT_KEY`, `AGENT_NUMBER_MAP` — all via `this.env.SECRETS.get()`. |

---

## Next Steps

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk) — Learn about durable actors, SQL storage, scheduled tasks, and state management.
- [Jev Decision Models](https://developers.telnyx.com/docs/inference/decision-models) — Full reference for the `systemone` endpoint, question types, and response formats.
- [Call Control Webhooks](https://developers.telnyx.com/api-reference/callbacks/call-conversation-ended) — Understand the `call-conversation-ended` and `transcription-saved` payload structures.
- [Telnyx Messaging API](https://developers.telnyx.com/docs/messaging/messages/send-message) — Send SMS messages via the `TELNYX` binding.
- [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge) — Deploy, manage secrets, and monitor your Edge functions.
- [Post-Call QA Scoring Sample (Python)](https://github.com/team-telnyx/telnyx-code-examples/tree/main/post-call-qa-scoring-python) — Compare with the Python Flask implementation for the same use case.
