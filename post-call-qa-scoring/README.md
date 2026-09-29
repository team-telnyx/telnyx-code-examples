---
name: post-call-qa-scoring
title: "Post-Call QA Scoring with Jev Decision Models"
description: "Durable per-agent quality profiles that grade support call transcripts, track rolling trends, flag coaching needs, and text daily digests."
language: typescript
framework: edge
telnyx_products: [Agent SDK, Decision Models, Call Control, Messaging]
---

# Post-Call QA Scoring with Jev Decision Models

Durable per-agent quality profiles that grade support call transcripts, track rolling trends, flag coaching needs, and text daily digests.

## The Story

A regional bank's customer support desk handles thousands of calls each week, where a single missed compliance disclosure or poor interaction can trigger regulatory fines, customer churn, or reputational damage. Supervisors need to know not just whether an agent passed or failed a single call, but whether their performance is trending up or down over time — because coaching based on a single call is guesswork, but coaching based on a durable trend is precision.

The actor IS the agent's quality profile. When a support call ends, the QAAgent actor is born for that agent via `idFromName(agentId)`, receives the transcript, and asks the Jev Decision Models API to grade it — pass or fail with a failing category, a hard compliance breach score (noul), and a 0–5 quality score. The actor appends each result to its durable SQL history, recomputes a 5-call rolling average, and if the average dips below the coaching floor, flags the agent for coaching — auto-clearing the flag when performance recovers. If a compliance breach is detected, the call is flagged for manager review regardless of pass/fail. At 17:00 UTC each day, the actor texts its own one-liner digest to the team lead. The actor survives pod reboots, platform restarts, and weeks of calls — because a trend needs history, and history needs durability. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the real-time, programmable layer that connects voice calls, messaging, and AI inference into a single platform. Unlike generic cloud providers, Telnyx owns the telephony stack end-to-end, meaning call transcripts, agent metadata, and compliance signals are available at the exact moment they're needed, with zero-latency handoff to AI models. The Agent SDK gives each agent a durable, stateful actor that persists across restarts, while the Decision Models API delivers structured grading (choice, noul, score) in a single shared-state call. Messaging bindings let actors text digests directly — no external SMS provider, no credential management. This is infrastructure built for communications, not bolted on top of it.

## Telnyx API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /v2/ai/typesafe/v1/systemone` | Jev Decision Models — grades transcript into `choice`, `noul`, `score` |
| `call-conversation-ended` webhook | Receives ended call payload with embedded transcript |
| `transcription-saved` webhook | Fallback: fetches finalized transcript if not embedded in payload |
| `send-a-message` (via `TELNYX` binding) | Sends per-agent daily digest and breach alerts to team lead |
| Agent SDK `schedule()` | Daily digest tick (`digest:<agentId>`) + exactly-once grading guard (`grade:<callId>`) |
| Agent SDK `SQL` | Durable `scores` table (callId UNIQUE) + `breaches` table |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Telnyx Edge Runtime                          │
│                                                                     │
│  ┌──────────────────┐     ┌──────────────────┐                     │
│  │  Webhook Handler │     │  Demo Trigger    │                     │
│  │  (Edge Function) │     │  /demo/trigger   │                     │
│  │                  │     │                  │                     │
│  │  POST /webhook/  │     │  POST /demo/     │                     │
│  │  call-conversation│    │  trigger         │                     │
│  │  -ended           │     │  (synthetic)     │                     │
│  │  POST /webhook/  │     │                  │                     │
│  │  transcription-  │     │                  │                     │
│  │  saved           │     │                  │                     │
│  └────────┬─────────┘     └────────┬─────────┘                     │
│           │                        │                               │
│           │ agentId from payload   │ agentId from body              │
│           ▼                        ▼                               │
│  ┌──────────────────────────────────────────┐                      │
│  │  env.QA_AGENT.idFromName(agentId)        │                      │
│  │  → one QAAgent per agent (durable)       │                      │
│  └──────────────────┬───────────────────────┘                      │
│                     │                                              │
│                     ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  QAAgent (extends Agent<Env, AgentState>)                   │  │
│  │                                                             │  │
│  │  onCallEnded(callId, transcript, agentId)                   │  │
│  │    ├── graded(callId) → fast-path check                     │  │
│  │    ├── judgeWithJev(transcript) → POST /systemone           │  │
│  │    │     ├── 3 retries: 10s / 30s / 60s backoff             │  │
│  │    │     └── on failure → INSERT status="ungraded"          │  │
│  │    ├── insertScore() → SQL INSERT (callId UNIQUE)           │  │
│  │    ├── recomputeTrend() → 5-call rolling avg + trend        │  │
│  │    │     ├── avg < floor → flag for coaching                │  │
│  │    │     └── avg >= floor → auto-clear flag                 │  │
│  │    └── flagBreach() → if noul > 0.8 → breaches table        │  │
│  │                                                             │  │
│  │  digest() → text one-liner to TEAM_LEAD_E164                 │  │
│  │  scheduledDigest() → daily at DIGEST_HOUR_UTC                │  │
│  │                                                             │  │
│  │  State: { agent, flagged, rolling, lastDigestTs }            │  │
│  │  SQL: scores(callId UNIQUE) + breaches                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  External Services                                            │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │  │
│  │  │ Jev Decision     │  │ Telnyx Messaging │  │ SQL Store  │ │  │
│  │  │ Models API       │  │ (TELNYX binding) │  │ (QA_DB)    │ │  │
│  │  │ /systemone       │  │ send-a-message   │  │            │ │  │
│  │  └──────────────────┘  └──────────────────┘  └────────────┘ │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `AGENT_NUMBER_MAP` | `string` | `{"+15551234567":"agent-001"}` | **yes** | JSON map of phone numbers to agent IDs, used as fallback when agent ID is not in call metadata | — |
| `CALL_METADATA_AGENT_KEY` | `string` | `agentId` | **yes** | Key name in call metadata payload to extract the agent ID (default: "agentId") | — |
| `DIGEST_HOUR_UTC` | `string` | `17` | **yes** | UTC hour (0-23) at which each agent's daily digest is texted (default: 17) | — |
| `QA_COACHING_FLOOR` | `string` | `3.0` | **yes** | Rolling average score threshold below which an agent is flagged for coaching (default: 3.0) | — |
| `TEAM_LEAD_E164` | `string` | `+15551234567` | **yes** | E.164 phone number of the team lead who receives daily digest texts | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key for authenticating Jev Decision Models API calls | [Telnyx Portal](https://portal.telnyx.com/) |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/post-call-qa-scoring

# Install dependencies
npm install

# Copy the example environment file
cp .env.example .env

# Edit .env and fill in your values
# TELNYX_API_KEY — from https://portal.telnyx.com/
# TEAM_LEAD_E164 — your team lead's phone number in E.164 format
# AGENT_NUMBER_MAP — JSON mapping of phone numbers to agent IDs
# CALL_METADATA_AGENT_KEY — key in call metadata (default: "agentId")
# DIGEST_HOUR_UTC — hour of day for digest (default: 17)
# QA_COACHING_FLOOR — score threshold for coaching flag (default: 3.0)

# Authenticate with Telnyx Edge CLI
telnyx-edge auth api-key set <your_api_key>

# Generate type definitions from telnyx.toml bindings
npm run types

# Run the smoke test to verify the module loads
npx tsx smoke_test.ts

# Deploy to Telnyx Edge
npm run deploy
```

## API Reference

### Webhook Endpoints

#### `POST /webhook/call-conversation-ended`

Receives the `call-conversation-ended` callback from Telnyx. The transcript is expected to be embedded in the payload (`data.transcript`).

**Request Body:**
```json
{
  "data": {
    "event": "call.conversation.ended",
    "payload": {
      "call_control": { "id": "call_abc123" },
      "called_number": "+15551234567",
      "metadata": { "agentId": "agent-001" },
      "transcript": "Agent: Thank you for calling..."
    }
  }
}
```

**Response:**
```json
{ "status": "scored", "agentId": "agent-001", "callId": "call_abc123" }
```

#### `POST /webhook/transcription-saved`

Fallback webhook for when the transcript is not embedded in the `call-conversation-ended` payload. Fetches the finalized transcript and triggers scoring.

**Response:**
```json
{ "status": "scored", "agentId": "agent-001", "callId": "call_abc123" }
```

#### `POST /demo/trigger`

Triggers the full pipeline with a synthetic call — no real Telnyx call required. Uses a canned support transcript by default.

**Request Body (optional):**
```json
{
  "agentId": "demo-agent",
  "callId": "demo_12345",
  "transcript": "Agent: Thank you for calling Telnyx Support..."
}
```

**Response:**
```json
{ "status": "demo_scored", "agentId": "demo-agent", "callId": "demo_12345" }
```

### Actor Methods

| Method | Description |
|---|---|
| `onCallEnded(callId, transcript, agentId)` | Entry point: checks if already graded, calls Jev, inserts score, recomputes trend, flags breaches |
| `graded(callId)` | Fast-path check: returns true if callId already exists in scores table |
| `judgeWithJev(transcript, callId)` | Calls Jev Decision Models API with 3-retry backoff (10s/30s/60s); returns `JevResult` or null |
| `retryJev(payload)` | Scheduled task handler for Jev retry attempts |
| `insertScore(agentId, callId, result)` | Inserts graded result into SQL scores table (INSERT OR IGNORE for exactly-once) |
| `insertUnrated(callId, agentId, status, error)` | Inserts ungraded row when Jev fails permanently |
| `recomputeTrend(agentId)` | Recomputes 5-call rolling average; sets/clears coaching flag based on floor |
| `flagBreach(callId, agentId, result)` | Inserts breach record when noul > 0.8 |
| `digest()` | Texts one-liner digest to TEAM_LEAD_E164 with avg, coaching status, breach, ungraded alerts |
| `scheduledDigest()` | Schedules next daily digest at DIGEST_HOUR_UTC |

### JevResult Interface

```typescript
interface JevResult {
  choice: string;   // "pass" or "fail_<category>"
  noul: number;     // 0–1, hard compliance breach score
  score: number;    // 0–5, quality score
}
```

### ScoreRow Interface

```typescript
interface ScoreRow {
  agentId: string;
  callId: string;
  ts: number;
  choice: string;
  noul: number;
  score: number;
  status: string;    // "graded" or "ungraded"
  lastError?: string; // error message if status="ungraded"
}
```

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Agent not receiving digest texts | `TEAM_LEAD_E164` not set or invalid | Verify the phone number is in E.164 format (e.g., `+15551234567`) |
| All calls show as "ungraded" | `TELNYX_API_KEY` missing or invalid | Check the secret is set via `telnyx-edge secrets add TELNYX_API_KEY "value"` |
| Coaching flag never clears | Rolling average stuck below floor | Check `QA_COACHING_FLOOR` value; ensure new calls are being scored |
| Breach not flagged | `noul` value below 0.8 threshold | Verify Jev response parsing; check transcript quality |
| Duplicate scores in history | UNIQUE constraint not enforced | Ensure `scores` table is created with `callId TEXT PRIMARY KEY` |
| Agent ID not resolved | Metadata key mismatch | Set `CALL_METADATA_AGENT_KEY` to match your call metadata, or configure `AGENT_NUMBER_MAP` |
| No transcript received | Transcript not in payload | Ensure `call-conversation-ended` webhook has transcript enabled, or rely on `transcription-saved` fallback |
| Digest fires at wrong time | `DIGEST_HOUR_UTC` misconfigured | Set to desired UTC hour (0-23) |

## Agent Discovery

- [Telnyx Agent SDK Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx LLM Documentation](https://telnyx.com/llms.txt)

## Related Examples

- **call-control-transfer** — Warm transfer between agents using Call Control
- **ai-voice-agent** — Real-time AI voice assistant with speech-to-speech
- **network-quality-scoring** — DEV-834: Scores network quality metrics (distinct from this sample)
- **sms-auto-responder** — Automated SMS responses using Messaging API
- **realtime-transcription** — Live transcription of calls with confidence scoring

## Resources

- [Telnyx Decision Models Documentation](https://developers.telnyx.com/docs/inference/decision-models)
- [Telnyx Call Control API Reference](https://developers.telnyx.com/api-reference/callbacks/call-conversation-ended)
- [Telnyx Messaging API Reference](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx Agent SDK SQL Documentation](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Agent SDK Scheduled Tasks Documentation](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Edge CLI Documentation](https://developers.telnyx.com/docs/edge)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Telnyx Developer Portal](https://developers.telnyx.com)
