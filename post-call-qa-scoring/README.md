---
name: post-call-qa-scoring
title: "Post-Call QA Scoring with Telnyx Decision Models"
description: "Durable per-agent quality profiles that grade support call transcripts, track rolling trends, flag coaching needs, and text daily digests."
language: typescript
framework: edge
telnyx_products: [Agent SDK, Decision Models, Call Control, Messaging]
---

# Post-Call QA Scoring with Telnyx Decision Models

Durable per-agent quality profiles that grade support call transcripts, track rolling trends, flag coaching needs, and text daily digests.

## The Story

A regional bank's customer support desk handles thousands of calls each week, where a single missed compliance disclosure or poor interaction can trigger regulatory fines, customer churn, or reputational damage. Supervisors need to know not just whether an agent passed or failed a single call, but whether their performance is trending up or down over time — because coaching based on a single call is guesswork, but coaching based on a durable trend is precision.

The actor IS the agent's quality profile. When a support call ends, the QAAgent actor is born for that agent via `idFromName(agentId)`, receives the transcript, and asks the Telnyx Decision Models API to grade it — pass or fail with a failing category, a hard compliance breach score (noul), and a 0–5 quality score. The actor appends each result to its durable SQL history, recomputes a 5-call rolling average, and if the average dips below the coaching floor, flags the agent for coaching — auto-clearing the flag when performance recovers. If a compliance breach is detected, the call is flagged for manager review regardless of pass/fail. At 17:00 UTC each day, the actor texts its own one-liner digest to the team lead. The actor survives pod reboots, platform restarts, and weeks of calls — because a trend needs history, and history needs durability. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the real-time, programmable layer that connects voice calls, messaging, and AI inference into a single platform. Unlike generic cloud providers, Telnyx owns the telephony stack end-to-end, meaning call transcripts, agent metadata, and compliance signals are available at the exact moment they're needed, with zero-latency handoff to AI models. The Agent SDK gives each agent a durable, stateful actor that persists across restarts, while the Decision Models API delivers structured grading (choice, noul, score) in a single shared-state call. Messaging bindings let actors text digests directly — no external SMS provider, no credential management. This is infrastructure built for communications, not bolted on top of it.

## Telnyx API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /v2/ai/typesafe/v1/systemone` | Telnyx Decision Models — grades transcript into `choice`, `noul`, `score` in one shared-`state` call |
| `call-conversation-ended` webhook | Receives ended call payload with embedded transcript |
| `transcription-saved` webhook | Fallback: delivers the finalized transcript if not embedded in the ended payload |
| `send-a-message` (via `TELNYX` binding) | Sends per-agent daily digest and immediate breach alerts to the team lead |
| Agent SDK `schedule()` | Daily digest tick (stable id `digest`) + exactly-once grading guard (`grade:<callId>`) |
| Agent SDK SQL (`this.ctx.storage.sql`) | Durable `scores` table (`call_id` PRIMARY KEY) + `breaches` table, private per actor |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Telnyx Edge Runtime                          │
│                                                                     │
│  ┌──────────────────┐     ┌──────────────────┐                     │
│  │  Webhook Handler │     │  Demo Trigger    │                     │
│  │  (Worker fetch)  │     │  /demo/trigger   │                     │
│  │                  │     │  (synthetic)     │                     │
│  │  POST /webhook/  │     │                  │                     │
│  │  call-conversation│    │                  │                     │
│  │  -ended           │    │                  │                     │
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
│  │  → born on first delivery, self-provision│                      │
│  └──────────────────┬───────────────────────┘                      │
│                     │ stub.recordCallEnded(...)                    │
│                     ▼                                              │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  QAAgent (extends Agent<Env, QAAgentState>)                 │  │
│  │                                                             │  │
│  │  recordCallEnded(callId, transcript, agentId)               │  │
│  │    ├── findScore(callId) → fast-path dedup check            │  │
│  │    ├── INSERT pending row → scores (call_id PRIMARY KEY)    │  │
│  │    ├── bootstrap digest schedule (stable id "digest")       │  │
│  │    └── schedule gradeCall → stable id grade:<callId>        │  │
│  │                                                             │  │
│  │  gradeCall({callId, attempt})  [scheduled task]             │  │
│  │    ├── buildDecisionRequest(transcript) → POST /systemone        │  │
│  │    │     ├── questions object: choice + noul + score        │  │
│  │    │     ├── 429/5xx → 10s/30s/60s backoff (Retry-After)    │  │
│  │    │     └── exhausted → status="ungraded" + last_error     │  │
│  │    ├── UPDATE scores → status="graded"                      │  │
│  │    ├── recomputeTrend() → 5-call rolling avg + trend        │  │
│  │    │     ├── avg < floor → flag for coaching                │  │
│  │    │     └── avg >= floor → auto-clear flag                 │  │
│  │    └── noul > 0.8 → breaches table + immediate alert SMS    │  │
│  │                                                             │  │
│  │  runDigest()  [daily at DIGEST_HOUR_UTC]                    │  │
│  │    ├── re-arm next 17:00 UTC (chain survives crashes)       │  │
│  │    └── text one-liner to TEAM_LEAD_E164                     │  │
│  │                                                             │  │
│  │  State: setState/getState (rolling, flagged, worstCategory) │  │
│  │  SQL: scores(call_id PRIMARY KEY) + breaches (per actor)    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  External Services                                            │  │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐ │  │
│  │  │ Decision Models      │  │ Telnyx Messaging │  │ Agent SQL  │ │  │
│  │  │ Models API       │  │ (TELNYX binding) │  │ (per actor)│ │  │
│  │  │ /systemone       │  │ send-a-message   │  │            │ │  │
│  │  └──────────────────┘  └──────────────────┘  └────────────┘ │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

All configuration flows through Telnyx `[[secrets]]` (read via `this.env.SECRETS.get()`), declared in `telnyx.toml`:

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `AGENT_NUMBER_MAP` | `string` | `{"+15551234567":"agent-001"}` | no | JSON map of phone numbers to agent IDs, used as fallback when the agent ID is not in call metadata | — |
| `CALL_METADATA_AGENT_KEY` | `string` | `agentId` | no | Key name in call metadata to extract the agent ID (default: `agentId`) | — |
| `DIGEST_HOUR_UTC` | `string` | `17` | no | UTC hour (0–23) at which each agent's daily digest is texted (default: `17`) | — |
| `QA_COACHING_FLOOR` | `string` | `3.0` | no | Rolling average threshold below which an agent is flagged for coaching (default: `3.0` on the 0–5 scale) | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key for authenticating Telnyx Decision Models API calls | [Telnyx Portal](https://portal.telnyx.com/) |
| `TELNYX_FROM_NUMBER` | `string` | `+15550001001` | **yes** | Number you own with messaging enabled; sender for digest and breach-alert SMS | [Telnyx Portal](https://portal.telnyx.com/) |
| `TEAM_LEAD_E164` | `string` | `+15551234567` | **yes** | E.164 phone number of the team lead who receives daily digest texts | — |

> **Agent / CLI access:** provision the pieces this example needs from the CLI:
>
> ```bash
> # Buy a number for digest/alert sending (Telnyx CLI — human or agent)
> telnyx available-phone-numbers list --country US --features sms
> telnyx number-orders create --phone-number +15550001001
>
> # Attach a messaging profile so the TELNYX binding can send SMS
> telnyx messaging-profiles create --name qa-digests --enabled true
>
> # Set the secrets this example reads (telnyx-edge CLI)
> telnyx-edge secrets add TELNYX_API_KEY "<your_api_key>"
> telnyx-edge secrets add TELNYX_FROM_NUMBER "+15550001001"
> telnyx-edge secrets add TEAM_LEAD_E164 "+15551234567"
> telnyx-edge secrets add QA_COACHING_FLOOR "3.0"
> telnyx-edge secrets add DIGEST_HOUR_UTC "17"
> telnyx-edge secrets add CALL_METADATA_AGENT_KEY "agentId"
> telnyx-edge secrets add AGENT_NUMBER_MAP '{"+15551234567":"agent-001"}'
> ```

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
# TELNYX_FROM_NUMBER — a number you own with messaging enabled
# TEAM_LEAD_E164 — your team lead's phone number in E.164 format
# AGENT_NUMBER_MAP — JSON mapping of phone numbers to agent IDs
# CALL_METADATA_AGENT_KEY — key in call metadata (default: "agentId")
# DIGEST_HOUR_UTC — hour of day for digest (default: 17)
# QA_COACHING_FLOOR — score threshold for coaching flag (default: 3.0)

# Type-check the agent and worker sources
npm run typecheck

# Run the smoke test (pure logic: Decision Models request/response, scoring, routing)
npm test

# Deploy to Telnyx Edge
npm run deploy
```

<details>
<summary>Programmatic / CLI setup</summary>

```bash
# Install CLI — https://developers.telnyx.com/development/cli
go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest
telnyx auth login

# Provision a number with messaging for the digest/alert sender
telnyx available-phone-numbers list --country US --features sms
telnyx number-orders create --phone-number +15550001001

# Attach a messaging profile
telnyx-edge secrets add TELNYX_API_KEY "<your_api_key>"
telnyx-edge secrets add TELNYX_FROM_NUMBER "+15550001001"
```

For full API discovery, point your agent at [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt).

</details>

## API Reference

The typed endpoint reference lives in [API.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/post-call-qa-scoring/API.md); the walkthrough in [GUIDE.md](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/post-call-qa-scoring/GUIDE.md). Summary:

### Webhook Endpoints

#### `POST /webhook/call-conversation-ended`

Receives the `call-conversation-ended` callback. The transcript is read from the payload (`data.payload.transcript`); a payload without a transcript returns `{"status": "no_transcript"}` and is NOT scored.

```json
{
  "data": {
    "payload": {
      "call_control_id": "call_abc123",
      "called_number": "+15559998888",
      "metadata": { "agentId": "agent-001" },
      "transcript": "Agent: Thank you for calling..."
    }
  }
}
```

Response — grading scheduled on the actor's stable task:

```json
{ "status": "grade_scheduled", "agentId": "agent-001", "callId": "call_abc123", "digestEnabled": true }
```

#### `POST /webhook/transcription-saved`

Fallback webhook when the transcript was not embedded in the ended-call payload. Same routing; whichever delivery arrives first records the call.

#### `POST /demo/trigger`

Triggers the full pipeline with a synthetic call — no real Telnyx calls required. Body: `{"agentId": "demo-agent", "callId": "demo_12345", "transcript": "..."}` (all optional; defaults provided).

### Actor Methods (RPC on the `QAAgent` stub)

| Method | Description |
|---|---|
| `recordCallEnded(callId, transcript, agentId, digestEnabled)` | Entry point: dedup check, writes the `pending` row, bootstraps the digest schedule, schedules `grade:<callId>` |
| `gradeCall({callId, attempt})` | Scheduled task: calls the Decision Models API, applies the grade, recomputes the trend, flags breaches. Retries 10s/30s/60s, then records `ungraded` |
| `runDigest()` | Scheduled task: re-arms the next 17:00 UTC run, then texts this actor's one-liner to `TEAM_LEAD_E164` |

### Scoring Model

```typescript
interface DecisionResult {
  choice: string;   // "pass" or "fail_<category>" — e.g. fail_compliance, fail_empathy
  noul: number;     // 0–1, hard compliance breach score (>0.8 flags manager review)
  score: number;    // 0–5, quality score from the 6-entry rubric
}
```

### Durable Tables (per-actor SQL)

```sql
scores(call_id TEXT PRIMARY KEY, agent_id TEXT, ts INTEGER, choice TEXT,
       noul REAL, score REAL, status TEXT, transcript TEXT, last_error TEXT)
breaches(agent_id TEXT, call_id TEXT, ts INTEGER, noul REAL, choice TEXT)
```

`status` is `pending` (recorded, awaiting grade), `graded`, or `ungraded` (with `last_error`). The `call_id` PRIMARY KEY is the exactly-once backstop.

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Agent not receiving digest texts | `TEAM_LEAD_E164` / `TELNYX_FROM_NUMBER` not set, or the from-number lacks messaging | Verify both E.164 values and that the from-number has an active messaging profile |
| All calls show as "ungraded" | `TELNYX_API_KEY` missing or invalid | Check the secret is set via `telnyx-edge secrets add TELNYX_API_KEY "value"`; the digest surfaces the `last_error` (`missing_api_key`, `decision_http_4xx`) |
| Coaching flag never clears | Rolling average stuck below floor | Check `QA_COACHING_FLOOR` value; ensure new calls are being graded (not `ungraded`) |
| Breach not flagged | `noul` value at or below the 0.8 threshold | Verify Decision Models response parsing; check transcript quality and breach wording in the `noul` instructions |
| Duplicate scores in history | Not possible by design — but verify | The `call_id` PRIMARY KEY rejects duplicates; check that the same call isn't arriving with different IDs |
| Agent ID not resolved | Metadata key mismatch | Set `CALL_METADATA_AGENT_KEY` to match your call metadata, or configure `AGENT_NUMBER_MAP` |
| Digest suppressed unexpectedly | Actor keyed by fallback identity | The agent ID must come from call metadata or `AGENT_NUMBER_MAP`; fallback-keyed actors are log-only by design |
| No transcript received | Transcript not in payload | Ensure `call-conversation-ended` has transcript enabled, or rely on the `transcription-saved` fallback |
| Digest fires at wrong time | `DIGEST_HOUR_UTC` misconfigured | Set to the desired UTC hour (0–23); the tick re-arms daily |
| Type errors in `src/agent.ts` | Missing dependencies | Run `npm install`, then `npm run typecheck` — the `Agent` and related types ship in `@telnyx/edge-runtime` |
| Schedule not firing | Actor not deployed | Schedules survive actor evictions but need a live Edge Compute deployment to wake |

## Agent Discovery

This example is part of the [Telnyx Code Examples](https://github.com/team-telnyx/telnyx-code-examples) catalog.

- **Agent signup**: [telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md) — automated account provisioning via agent mail; get an API key with no human intervention
- **Agent CLI**: [github.com/team-telnyx/ai/tree/main/cli](https://github.com/team-telnyx/ai/tree/main/cli) — composite commands for agents ([commands reference](https://github.com/team-telnyx/ai/tree/main/cli/src/commands))
- **Agent skills**: [github.com/team-telnyx/ai/tree/main/skills](https://github.com/team-telnyx/ai/tree/main/skills)
- **Telnyx AI repo**: [github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **Agent SDK docs**: [developers.telnyx.com/docs/agent-sdk](https://developers.telnyx.com/docs/agent-sdk)
- **LLM-optimized docs**: [`llms-full.txt`](https://developers.telnyx.com/llms-full.txt)
- **Example index**: [`llms.txt`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/llms.txt)
- **Telnyx CLI (human)**: [developers.telnyx.com/development/cli](https://developers.telnyx.com/development/cli) — `go install github.com/team-telnyx/telnyx-cli/cmd/telnyx@latest`

## Related Examples

- [edge-customer-agent-typescript](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-customer-agent-typescript/README.md) — The Entity Agent pattern: one durable actor per customer
- [edge-url-summarizer](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-url-summarizer/README.md) — Cached URL summarization with Stateful Actors
- [edge-voicemail-to-action-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-voicemail-to-action-python/README.md) — Voicemail triage at the edge
- [edge-webhook-aggregator-python](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/edge-webhook-aggregator-python/README.md) — Multi-tenant webhook consolidation

## Resources

- [Telnyx Decision Models Documentation](https://developers.telnyx.com/docs/inference/decision-models)
- [Decision Models API Reference](https://developers.telnyx.com/api-reference/decision-models/evaluate-decision-models-typesafe-compatible)
- [Call Control `call-conversation-ended` Callback](https://developers.telnyx.com/api-reference/callbacks/call-conversation-ended)
- [Telnyx Messaging — Send a Message](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx Agent SDK — SQL Storage](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Telnyx Agent SDK — Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Edge CLI Documentation](https://developers.telnyx.com/docs/edge)
- [Telnyx SMS API Product](https://telnyx.com/products/sms-api)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Telnyx Developer Portal](https://developers.telnyx.com)
