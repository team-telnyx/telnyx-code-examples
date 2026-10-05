```markdown
---
name: dial-in-interview-scorer
title: "Dial-in Interview Rubric Scorer"
description: "A durable Telnyx Agent that dials candidates, scores each answer mid-call with Decision Models, and streams a live scorecard to a hiring-manager dashboard."
language: typescript
framework: edge
telnyx_products: [Agent SDK, Call Control, Decision Models, Voice]
---

# Dial-in Interview Rubric Scorer

A durable Telnyx Agent that dials candidates, scores each answer mid-call with Decision Models, and streams a live scorecard to a hiring-manager dashboard.

## The Story

A clinic hiring manager needs to screen nursing candidates quickly and consistently, but phone interviews are chaotic: candidates drop off, answers are forgotten, and the scorecard is reconstructed from memory after the fact — leading to bad hires that cost the clinic thousands in turnover and, worse, risk patient safety when an unqualified nurse is brought on. The manager needs a system that survives a dropped call, never loses an answer, and lets them watch the scorecard fill in real time while the candidate is still talking.

The actor IS the interview. Born the moment a manager books a slot, the InterviewCall actor dials the candidate, walks through a rubric question by question, and scores each answer on the spot using Telnyx Decision Models — all while streaming the running scorecard to a dashboard over WebSocket. If the call drops, the actor re-dials and picks up exactly where it left off, because the scorecard lives in durable SQL state, not in memory. When the last question is answered, the actor speaks a TTS summary and writes the final write-up. Durability is the point: the interview survives platform reboots, network blips, and candidate phone switches.

The rest of this README is the API surface of that story.

## Why Telnyx

This sample is built on **AI Communications Infrastructure** — Telnyx's platform for durable, stateful voice and inference primitives that survive failures and stream state across surfaces. Unlike stateless post-call LLM summaries, the Telnyx Agent SDK gives us a durable entity per candidate line, SQL-backed scorecards, and a WebSocket fan-out that delivers live scoring to a second surface. Decision Models evaluate each answer mid-call with structured outputs (score, choice, escalation gate), and Call Control handles the dial, gather, and TTS lifecycle — all authenticated through a single `[telnyx]` binding with zero credentials in code.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `https://api.telnyx.com/v2/calls` | POST | Dial the candidate at slot time |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/answer` | POST | Answer inbound call |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/speak` | POST | TTS text-to-speech for questions and summaries |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/gather_using_ai` | POST | Capture candidate answer via AI speech recognition |
| `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | POST | Score each answer with `telnyx/decision-flash` (score 0–3, choice, noul) |
| Agent SDK WebSocket (`this.webSocket()` / `AgentSocketServer`) | WS | Stream live scorecard to dashboard |
| Agent SDK SQL (`this.env.SCORECARD_DB`) | SQL | Durable scorecard + resume pointer |
| Agent SDK `this.queue()` | Internal | Defer Decision Model calls out of the 30s inbound budget |
| Agent SDK `this.schedule()` | Internal | Recovery backoff timer after call drop |

## Architecture

```
Manager dashboard ──wss──> InterviewCall actor (Agent SDK over Stateful Actor)
  one actor per candidate line (idFromName); POST /v2/calls → dial
  answer → per Q: speak-text → gather-using-ai → call-ai-gather-ended → Decision Model
  (POST /v2/ai/typesafe/v1/systemone, shared state {question, answer, rubric})
  SQL: interviews(candidate, qIdx, answer, score, choice, notes) ← resume point
  AgentSocketServer broadcast {qIdx, answer, score, running} → live rubric view
  call-hangup → re-arm interview:resume:<phone> → re-dial → skip answered Qs
```

The actor owns the rubric, the scorecard (SQL), the resume pointer, the dial/recovery lifecycle, and the WebSocket fan-out. A per-call function can dial and STT but cannot hold the scorecard across a restart or stream it to a second surface — the durable actor can.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `OUTBOUND_CONNECTION_ID` | `string` | `1234567890123456789` | no | Call Control connection ID for outbound dialing | Telnyx Portal → Voice → Connections |
| `OUTBOUND_CALLER_ID` | `string` | `+1555XXXXXXXX` | no | Voice number resource used as caller ID | Telnyx Portal → Numbers |
| `DASHBOARD_ORIGIN` | `string` | `https://dashboard.example.com` | no | Allowed WebSocket origin for dashboard connections | Your dashboard deployment URL |
| `MAX_CALL_MINUTES` | `string` | `1800` | no | Maximum call duration in seconds | Configurable limit |
| `RESUME_RETRY_MAX` | `string` | `3` | no | Maximum recovery dial attempts after a drop | Configurable retry cap |
| `ANSWER_SILENCE_MS` | `string` | `3000` | no | Silence timeout for gather-using-ai in milliseconds | Configurable silence threshold |
| `DECISION_TIMEOUT_MS` | `string` | `8000` | no | Timeout for Decision Models API calls in milliseconds | Configurable timeout |

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/dial-in-interview-scorer

# 2. Install dependencies
npm install

# 3. Copy the example env file and fill in your values
cp .env.example .env
# Edit .env with your TELNYX_API_KEY and optional config

# 4. Authenticate the Telnyx CLI
telnyx-edge auth api-key set <your_api_key>

# 5. Set the API key as a secret
telnyx-edge secrets add TELNYX_API_KEY "<your_api_key>"

# 6. Run the smoke test
npx tsx smoke_test.ts

# 7. Deploy (when ready)
telnyx-edge ship
```

## API Reference

### `POST /open`

Starts a new interview by creating or addressing a durable `InterviewCall` actor for the candidate's phone number.

**Request Body:**
```json
{
  "candidate": "Jane Doe",
  "phone": "+15551234567",
  "questions": [
    { "text": "Tell me about your experience.", "rubric": "Experience relevance and depth" },
    { "text": "How do you handle stress?", "rubric": "Stress management and resilience" }
  ]
}
```

**Response:**
```json
{
  "status": "interview_started",
  "actorId": "15551234567"
}
```

### `GET /status` (on actor)

Returns the current interview state.

**Response:**
```json
{
  "candidate": "Jane Doe",
  "phone": "+15551234567",
  "currentQIdx": 1,
  "callId": "abc123",
  "escalated": false,
  "completed": false
}
```

### `GET /ws` (on actor)

WebSocket endpoint for the hiring-manager dashboard. Receives live scorecard updates:

```json
{
  "qIdx": 0,
  "answer": "I have 5 years of experience...",
  "score": 3,
  "choice": "continue",
  "noul": 0.1,
  "running": 3,
  "total": 2
}
```

### Callbacks

| Callback | Trigger | Handler |
|---|---|---|
| `call-ai-gather-ended` | AI speech capture completes | `handleGatherEnded` — scores the answer |
| `call-hangup` | Call drops | `handleHangup` — schedules recovery |

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| Actor not found on `/open` | `INTERVIEWS` binding not configured in `telnyx.toml` | Add `[[actors]]` binding to `telnyx.toml` |
| WebSocket connection refused | `DASHBOARD_ORIGIN` mismatch | Set `DASHBOARD_ORIGIN` to your dashboard URL |
| Decision Model returns 429 | Rate limited | Check `Retry-After` header; backoff is automatic |
| Dial fails with 403 | Missing or invalid `TELNYX_API_KEY` | Run `telnyx-edge secrets add TELNYX_API_KEY "<key>"` |
| Resume starts at wrong question | SQL table not initialized | Ensure `initScorecard()` ran (auto on `openInterview`) |
| No live scorecard on dashboard | WebSocket not connected before call starts | Connect dashboard WS before calling `/open` |
| `gather-using-ai` returns empty transcript | Candidate spoke too quietly or silence timeout too short | Increase `ANSWER_SILENCE_MS` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-804** — Per-call LLM voice loop (no scoring, no durability)
- **DEV-284** — One-shot intake collection (no scoring, no resume)
- **DEV-831** — Conference transcript streaming (no scoring state or dial+resume lifecycle)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands)
- [Decision Models API Reference](https://developers.telnyx.com/api-reference/decision-models/evaluate-decision-models-typesafe-compatible)
- [Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk)
- [Agent SDK WebSockets](https://developers.telnyx.com/docs/agent-sdk/websockets)
- [Agent SDK SQL](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Agent SDK Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Gather Using AI](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)
- [Telnyx Pricing](https://telnyx.com/pricing)
```
