---
name: recovery-caller-agent
title: "Recovery Caller Agent — Post-Discharge Follow-Up"
description: "A durable per-patient actor that schedules d1/d7/d14 recovery calls, gathers symptoms via gather-using-ai, grades red-flag symptoms with Telnyx Decision Models, and escalates to clinic + front desk via SMS."
language: typescript
framework: edge
telnyx_products: [Voice API, Call Control, Decision Models, Messaging, Agent SDK, Edge Compute]
---

# Recovery Caller Agent — Post-Discharge Follow-Up

A durable per-patient actor that schedules d1/d7/d14 recovery calls, gathers symptoms via gather-using-ai, grades red-flag symptoms with Telnyx Decision Models, and escalates to clinic + front desk via SMS.

## The Story

A cardiac surgery clinic in Cleveland discharges 80 patients per week, each needing structured follow-up on days 1, 7, and 14 to catch complications before they become emergencies. If a patient develops a fever or severe pain on day 3 and nobody calls back, sepsis or a cardiac event can go undetected — patient safety, readmission penalties, and CMS compliance all hang on whether that follow-up actually happens.

The actor IS the recovery follow-up program. Born the moment a discharge webhook fires, it owns a 14-day schedule of call windows, remembers exactly which day it's on, dials the patient, captures symptoms through AI-powered voice gathering, grades those symptoms against clinical thresholds using Telnyx Decision Models, and escalates to the clinic line plus a front-desk SMS when red flags appear. If the platform reboots mid-batch or a worker is evicted, the actor wakes up and re-arms its timers — the ledger in SQL proves the program ran, and the next scheduled call still fires. It lives until day 14 completes cleanly, then self-retires with no dangling timers.

The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the durable, programmable voice, messaging, and decision-making primitives that turn a multi-day clinical follow-up program into a stateful, self-healing actor. Call Control gives you precise dial/answer/speak/gather/transfer/hangup control over each patient call. Decision Models applies clinical-grade scoring (severity, red-flag probability, stage verification) to patient-reported symptoms in real time. Messaging delivers escalation SMS to the front desk with the flagged transcript. And the Agent SDK on Edge Compute gives you persisted timers, SQL ledger storage, and per-patient state that survives restarts — so the program never forgets which day it's on.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `https://api.telnyx.com/v2/calls` | POST | Dial patient or clinic for outbound call |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/answer` | POST | Answer inbound call |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/speak-text` | POST | Play intro speech |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/gather-using-ai` | POST | Capture symptom answers (pain, fever, drainage, meds_taken) |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/transfer` | POST | Warm handoff to clinic |
| `https://api.telnyx.com/v2/calls/{call_id}/actions/hangup` | POST | End call |
| `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | POST | Decision Model: grade symptoms (noul, score, choice) |
| `this.env.TELNYX.messages.send()` | — | Send escalation SMS to front desk |

**Callbacks received:** `call-ai-gather-ended`, `call-hangup`, `call-answered`

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Mock EHR / Discharge Webhook                    │
│                                                                         │
│   POST /openFollowUp  ──►  env.FOLLOWUPS.idFromName(patientDigits)     │
│                                                                         │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    RecoveryCall Actor (one per patient)                  │
│                                                                         │
│   schedule(d1) ──► schedule(d7) ──► schedule(d14)                       │
│        │                                                                 │
│        ▼  callDay({slot})                                                │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ 1. dialPatient() → POST /v2/calls                              │   │
│   │ 2. speak(INTRO_TEXT) → POST /actions/speak-text                │   │
│   │ 3. gatherSymptoms() → POST /actions/gather-using-ai            │   │
│   │    (pain, fever, drainage, meds_taken)                          │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│        │                                                                 │
│        ▼  call-ai-gather-ended callback                                 │
│   handleGatherEnded(answers, transcript)                                 │
│        │                                                                 │
│        ▼  Decision Model grading                                        │
│   gradeWithDecisionModel(answers) → POST /v2/ai/typesafe/v1/systemone   │
│   {model: "telnyx/decision-flash", state: {procedure, answers},         │
│    questions: {stage: choice, severity: score, redflag: noul}}          │
│        │                                                                 │
│        ├── noul > 0.8 OR score >= 3 ──► ESCALATE                        │
│        │    • dial clinic (POST /v2/calls → CLINIC_E164)               │
│        │    • SMS front desk (TELNYX.messages.send)                    │
│        │    • ledger: outcome=escalated, verdict=red_flag              │
│        │                                                                 │
│        ├── no answer / busy ──► retry (≤ RESUME_RETRY_MAX)              │
│        │    • schedule(1800s, "callDay", {slot})                        │
│        │    • ledger: outcome=no_answer                                │
│        │                                                                 │
│        ├── call-hangup mid-script ──► resumeCall                        │
│        │    • schedule(60s, "resumeCall", {slot})                       │
│        │    • resume at last unanswered question                       │
│        │                                                                 │
│        └── clean d14 ──► episodeComplete=true, clearAllSchedules()      │
│             • ledger: outcome=complete, verdict=clean                    │
│                                                                         │
│   SQL Ledger: FOLLOWUPS_DB                                              │
│   CREATE TABLE followups (                                              │
│     patient TEXT, day INTEGER, slot TEXT,                               │
│     outcome TEXT, verdict TEXT, answers TEXT,                           │
│     transcript TEXT, ts INTEGER,                                        │
│     UNIQUE(patient, day)                                                │
│   )                                                                     │
│   ─ append-only audit trail, survives restarts                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `OUTBOUND_CONNECTION_ID` | `string` | `12345678-1234-1234-1234-123456789012` | **yes** | Telnyx SIP connection ID for outbound calls | [Telnyx Portal](https://portal.telnyx.com) → Voice → Connections |
| `OUTBOUND_CALLER_ID` | `string` | `+15551234567` | **yes** | Caller ID number resource for outbound calls | [Telnyx Portal](https://portal.telnyx.com) → Voice → Numbers |
| `CLINIC_E164` | `string` | `+15559876543` | **yes** | Clinic phone number to dial for escalation | Clinic's published E.164 number |
| `FRONTDESK_E164` | `string` | `+15559876543` | **yes** | Front desk phone number for escalation SMS | Clinic's front desk SMS-enabled number |
| `D1_DELAY_H` | `string` | `24` | no | Hours until first follow-up call | Configurable — defaults to 24h |
| `D7_DELAY_H` | `string` | `168` | no | Hours until second follow-up call | Configurable — defaults to 168h (7 days) |
| `D14_DELAY_H` | `string` | `336` | no | Hours until final follow-up call | Configurable — defaults to 336h (14 days) |
| `RESUME_RETRY_MAX` | `string` | `2` | no | Max in-day retries for no-answer | Configurable — defaults to 2 |
| `RED_FLAG_NOUL` | `string` | `0.8` | no | Decision Model noul threshold for escalation | Configurable — defaults to 0.8 |
| `SEVERITY_ESCALATE` | `string` | `3` | no | Decision Model score threshold for escalation | Configurable — defaults to 3 |
| `ANSWER_SILENCE_MS` | `string` | `3000` | no | Max silence before gather times out | Configurable — defaults to 3000ms |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/recovery-caller-agent

# 2. Install dependencies
npm install

# 3. Create .env from example
cp .env.example .env
# Edit .env with your Telnyx credentials and clinic phone numbers

# 4. Authenticate with Telnyx Edge
telnyx-edge auth api-key set <your_telnyx_api_key>

# 5. Set secrets
telnyx-edge secrets add TELNYX_API_KEY "<your_telnyx_api_key>"

# 6. Generate type bindings
telnyx-edge types

# 7. Run smoke test
npx tsx smoke_test.ts

# 8. Deploy
telnyx-edge ship
```

## API Reference

### `POST /openFollowUp`

Triggers a new recovery follow-up episode for a patient.

**Request Body:**
```json
{
  "patientPhone": "+15551234567",
  "patientName": "John Doe",
  "procedure": "cardiac_ablation"
}
```

**Response:**
```json
{
  "ok": true,
  "actorId": "followup-15551234567"
}
```

### `POST /close`

Closes an active follow-up episode and clears all scheduled timers.

**Request Body:**
```json
{
  "patientPhone": "+15551234567"
}
```

**Response:**
```json
{
  "ok": true
}
```

### Webhook: `POST /webhook/gather-ended`

Receives `call-ai-gather-ended` callback from Telnyx with symptom answers and transcript.

**Payload:**
```json
{
  "data": {
    "payload": {
      "call_id": "abc123",
      "channel_data": {
        "transcript": "Patient reports pain level 3, no fever, no drainage, taking medications as prescribed.",
        "symptoms": {
          "pain": "3",
          "fever": "no",
          "drainage": "none",
          "meds_taken": "yes"
        }
      }
    }
  }
}
```

### Webhook: `POST /webhook/hangup`

Receives `call-hangup` callback — triggers resume at last unanswered question.

### Webhook: `POST /webhook/answered`

Receives `call-answered` callback — confirms call was picked up.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Actor not born on discharge | `env.FOLLOWUPS` binding not configured in `telnyx.toml` | Add `[[actors]]` section with `binding = "FOLLOWUPS"` and `type = "RecoveryCall"` |
| Calls not dialing | `OUTBOUND_CONNECTION_ID` or `OUTBOUND_CALLER_ID` missing | Set both in `.env` and `telnyx.toml` `[[secrets]]` or `[env_vars]` |
| Decision Model returning 429 | Rate limited | Backoff with jitter is built-in; check `Retry-After` header |
| Decision Model returning 422 | State shape mismatch | Verify `state` object matches `{procedure, answers}` structure |
| SQL ledger not persisting | `FOLLOWUPS_DB` binding not configured | Add `[storage.sqldb.FOLLOWUPS_DB]` to `telnyx.toml` |
| Timers not surviving restart | `schedule()` not used for timers | All timers use `this.schedule()` — verify actor state is persisted |
| SMS not sending on escalation | `TELNYX` binding not configured | Add `[telnyx]` binding to `telnyx.toml` |
| Demo mode still dialing | `DEMO_MODE` flag not set to `true` | Default is `true` — verify no env override |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **DEV-841** — SMS-only patient reminders (no outbound calls, no scoring, no ledger)
- **DEV-284** — Inbound prescription refill intake (no program, no dial-out)
- **DEV-1223** — Recovery Caller Agent (this sample — outbound program enforcement with Decision Models)

## Resources

- [Telnyx Voice API Docs](https://developers.telnyx.com/docs/voice/programmable-voice)
- [Gather Using AI](https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai)
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands)
- [Decision Models API Reference](https://developers.telnyx.com/api-reference/decision-models/evaluate-decision-models-typesafe-compatible)
- [Decision Models Docs](https://developers.telnyx.com/docs/inference/decision-models)
- [Agent SDK — Scheduled Tasks](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Agent SDK — SQL Storage](https://developers.telnyx.com/docs/agent-sdk/sql)
- [Stateful Actors — Lifecycle](https://developers.telnyx.com/docs/edge-compute/stateful-actors/concepts/lifecycle)
- [Telnyx Pricing](https://telnyx.com/pricing)
- [Edge Runtime SDK](https://www.npmjs.com/package/@telnyx/edge-runtime)
