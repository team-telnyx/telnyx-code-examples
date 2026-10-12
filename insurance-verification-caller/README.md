---
name: insurance-verification-caller
title: Insurance Verification Caller — Durable Voice Actor with Jev Decision Models
description: A durable Telnyx Edge actor that dials a carrier IVR, drives the menu via send_dtmf, captures the spoken eligibility result via STT, scores it with Jev Decision Models, and sends a one-line SMS verdict to the front desk — surviving voicemail, drops, and pod restarts.
language: typescript
framework: edge
telnyx_products: [Voice, Call Control, Messaging, AI Decision Models, Agent SDK]
---

# insurance-verification-caller

A durable Telnyx Edge actor that dials a carrier IVR, drives the menu via `send_dtmf`, captures the spoken eligibility result via STT, scores it with Jev Decision Models, and sends a one-line SMS verdict to the front desk — surviving voicemail, drops, and pod restarts.

## The Story

A regional urgent-care clinic needs to verify patient insurance eligibility before they walk in the door. If the clinic treats a patient whose coverage was terminated, the clinic absorbs the cost — potentially thousands of dollars — and the patient faces surprise billing. The front desk staff can't call every carrier manually; they need an automated system that dials the carrier's IVR, navigates the menu, listens to the spoken result, and reports back a clear yes/no.

The actor IS the insurance-eligibility verification job. Born when the front desk opens a job, it dials the carrier's line itself, drives the IVR by sending DTMF digits, captures the carrier's spoken response through speech-to-text, and asks Jev Decision Models to score the result into a structured verdict. If the carrier hits voicemail, drops the call, or puts the actor on hold too long, the actor re-arms itself with a backoff schedule and retries — up to three times. If the platform reboots mid-call, the actor's state, attempt ledger, and exactly-once SMS guard survive in durable storage. When the verdict is final, it sends one SMS to the front desk and marks itself done. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — the programmable voice, messaging, and decision-model primitives that let applications reason about and act on real-world communication. Unlike generic cloud providers, Telnyx owns the telecom stack: calls route over Telnyx's own global network, DTMF and transcription events stream back in real time, and the AI Decision Models API is purpose-built for extracting structured verdicts from messy carrier transcripts. The Agent SDK ties it all together with durable, stateful actors that survive infrastructure failures — so a verification job never loses its place in the retry ledger, even if the pod restarts between the Jev call and the result SMS.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `https://api.telnyx.com/v2/calls` | POST | Dial the carrier's IVR line (outbound call) |
| `https://api.telnyx.com/v2/calls/{call_control_id}/actions/send_dtmf` | POST | Send DTMF digits to drive the carrier's IVR menu (eligibility → member ID → confirm) |
| `https://api.telnyx.com/v2/calls/{call_control_id}` | GET | Poll for `transcription-start` STT results from the carrier's spoken answer |
| `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | POST | Jev Decision Models — score transcript into `choice`, `score`, `noul` |
| `https://api.telnyx.com/v2/messages` | POST | Send one-line SMS verdict to the front desk |
| Agent SDK `schedule()` | — | Re-arm `verify:<jobId>` with 10s → 30s backoff (max 3 attempts) |
| Agent SDK `sql()` | — | Persist attempt ledger rows in `attempts(jobId, ts, outcome)` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Front Desk (RPC)                                │
│   openJob(memberId, plan, provider)                                     │
│         │                                                               │
│         ▼                                                               │
│  ┌──────────────────────────────────────────┐                           │
│  │  VerifyJob Actor (durable, per jobId)    │                           │
│  │  env.JOBS.idFromName(jobId)              │                           │
│  │                                          │                           │
│  │  run()                                   │                           │
│  │   ├── dialAndDriveIvr()                  │                           │
│  │   │    ├── dial(CARRIER_E164)            │                           │
│  │   │    ├── send_dtmf("2")  → eligibility │                           │
│  │   │    ├── send_dtmf(memberId)           │                           │
│  │   │    ├── send_dtmf("0")  → confirm     │                           │
│  │   │    └── transcription-start (STT)     │                           │
│  │   │                                          │                       │
│  │   ├── if no transcript:                    │                           │
│  │   │    ├── INSERT attempts(..., "failed")  │                           │
│  │   │    └── schedule(10s→30s, "run")        │                           │
│  │   │                                          │                           │
│  │   ├── judgeWithJev(transcript)             │                           │
│  │   │    └── POST /systemone {choice,score,noul}                        │
│  │   │                                          │                           │
│  │   ├── INSERT attempts(..., "ok")           │                           │
│  │   ├── setState({verdict, transcript})      │                           │
│  │   └── if !sent: notifyFrontDesk(verdict)   │                           │
│  │        └── send-a-message (SMS)            │                           │
│  └──────────────────────────────────────────┘                           │
│         │                                                               │
│         ▼                                                               │
│  ┌──────────────────────────────────────────┐                           │
│  │  Mock Carrier IVR (demo mode)            │                           │
│  │  MOCK_CARRIER_E164 → plays prompts,      │                           │
│  │  consumes DTMF, speaks scripted answer   │                           │
│  └──────────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | Telnyx API key (secret) | Telnyx Mission Control → API Keys |
| `CARRIER_E164` | `string` | `+1555XXXXXXXX` | **yes** | Carrier IVR phone number to dial (mock in demo) | Telnyx Mission Control → Numbers |
| `MOCK_CARRIER_E164` | `string` | `+1555XXXXXXXX` | no | Fallback mock carrier number for demo mode | Telnyx Mission Control |
| `CARRIER_NUMBER_ID` | `string` | `connection-uuid` | **yes** | Telnyx connection ID (voice number resource) for outbound dial | Telnyx Mission Control → Numbers |
| `OUTBOUND_CALLER_ID` | `string` | `+1555XXXXXXXX` | **yes** | Telnyx voice number ID used as outbound caller ID | Telnyx Mission Control → Numbers |
| `FRONTDESK_E164` | `string` | `+1555XXXXXXXX` | **yes** | Front desk SMS destination number | Telnyx Mission Control → Numbers |
| `HOLD_MAX_MS` | `string` | `180000` | no | Max hold time before retry (3 minutes) | — |
| `ANSWER_SILENCE_MS` | `string` | `4000` | no | Silence gap to detect answer end (4s) | — |
| `VM_KEYWORDS` | `string` | `voicemail,leave a message,after the tone` | no | Keywords to detect voicemail in transcript | — |
| `MENU_LOOP_MAX` | `string` | `3` | no | Max repeated-menu matches before retry | — |
| `MAX_ATTEMPTS` | `string` | `3` | no | Max retry attempts | — |
| `JEV_MODEL` | `string` | `telnyx/decision-flash` | no | Jev decision model name | Telnyx AI docs |
| `JEV_ENDPOINT` | `string` | `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` | no | Jev API endpoint | Telnyx AI docs |
| `DEMO_MODE` | `string` | `true` | no | If `true` (default), simulates carrier response instead of placing real calls | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/insurance-verification-caller

# 2. Install dependencies
npm install

# 3. Copy the example env file and fill in your values
cp .env.example .env
# Edit .env with your Telnyx API key and phone numbers

# 4. Authenticate with Telnyx Edge CLI
telnyx-edge auth api-key set <your_api_key>

# 5. Add your API key as a secret
telnyx-edge secrets add TELNYX_API_KEY "<your_api_key>"

# 6. Run the smoke test to verify everything loads
npx tsx smoke_test.ts

# 7. Deploy (when ready for live mode)
telnyx-edge ship
```

## API Reference

### `openJob(memberId, plan, provider)`

**RPC entry point** — creates a new `VerifyJob` actor for a single insurance-eligibility verification.

| Parameter | Type | Description |
|---|---|---|
| `memberId` | `string` | Patient/member ID to verify |
| `plan` | `string` | Insurance plan name |
| `provider` | `string` | Healthcare provider name |

**Returns:** `{ jobId: string, status: "started" }`

The actor is born via `env.VERIFY_JOB.idFromName(jobId)` — one durable actor per job. It immediately schedules its first `run()` cycle.

### `VerifyJob.run()`

The main actor lifecycle method. Orchestrates the full verification flow:

1. **Dial + drive IVR** — calls `dialAndDriveIvr()` to place the outbound call, send DTMF digits, and capture STT.
2. **Retry on failure** — if no transcript (voicemail/drop/hold), inserts a `failed` row into the `attempts` ledger and re-arms `verify:<jobId>` with backoff (10s → 30s, max 3 attempts).
3. **Judge with Jev** — calls `judgeWithJev()` to POST the transcript to Jev Decision Models and parse `choice`, `score`, `noul`.
4. **Notify front desk** — inserts an `ok` row into the ledger, persists the verdict, and sends exactly one SMS (guarded by `sent` flag).

### `dialAndDriveIvr(carrier, demoMode)`

Dials the carrier IVR and drives the menu. In demo mode, simulates the carrier response locally. In live mode:

- `POST /v2/calls` — dials `CARRIER_E164` using `CARRIER_NUMBER_ID` as the connection and `OUTBOUND_CALLER_ID` as caller ID.
- `POST /v2/calls/{id}/actions/send_dtmf` — sends `"2"` (eligibility), then the member ID digits, then `"0"` (confirm).
- Polls `GET /v2/calls/{id}` for `transcription-start` STT results.

### `judgeWithJev(transcript)`

POSTs the transcript to `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` with three question types in a single shared-state call:

| Question ID | Type | Description |
|---|---|---|
| `choice` | `choice` | Is the member covered? Options: `covered`, `not_covered`, `needs_verification` |
| `score` | `score` | Confidence in the determination (0–100) |
| `noul` | `noul` | Confidence this is a hard no-coverage result (0–1) |

Implements 429/502-class bounded backoff with jitter and honors `Retry-After`.

### `notifyFrontDesk(verdict)`

Sends a one-line SMS to `FRONTDESK_E164` based on the verdict:

| Condition | SMS Body |
|---|---|
| `covered` & `score >= 70` | `Coverage CONFIRMED for member <memberId> (<plan>). Score: <score>.` |
| `not_covered` or `noul > 0.8` | `NOT COVERED — verify before visit for member <memberId>.` |
| `needs_verification` | `Needs verification for member <memberId>. Flagged for front desk review.` |

### Webhook Handler

`POST /webhook/call` — receives Call Control events (`call-hangup`, `transcription-start`, etc.). In a full deployment, routes events to the correct `VerifyJob` actor by `call_control_id`.

### Decision Policy

| Verdict | Action |
|---|---|
| `covered` & `score >= 70` | Send CONFIRMED SMS |
| `not_covered` or `noul > 0.8` | Send NOT COVERED SMS |
| `needs_verification` | Flag for front desk review (no SMS) |

## Troubleshooting

| Issue | Cause | Fix |
|---|---|---|
| No transcript captured | Carrier IVR didn't speak or STT didn't trigger | Check `ANSWER_SILENCE_MS`; ensure carrier speaks clearly |
| Voicemail detected | Carrier sent to voicemail | Verify `VM_KEYWORDS` match; actor auto-retries |
| Call dropped before answer | Carrier hung up or line busy | Actor auto-retries with backoff; check `MAX_ATTEMPTS` |
| Jev API returns 429 | Rate limited | Retry with backoff (built-in); check model quota |
| Jev API returns 502 | Service unavailable | Retry with backoff (built-in); check Telnyx status page |
| SMS not sent | `sent` flag already true | Actor is exactly-once; check `attempts` ledger for prior success |
| Actor not found | Job ID mismatch | Ensure `openJob` uses `idFromName(jobId)` consistently |
| Pod restart loses state | Using in-memory storage | All state is in durable SQL/KV; verify `telnyx.toml` bindings |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [Telnyx LLMS.txt](https://telnyx.com/llms.txt)

## Related Examples

- [call-control-forwarding](https://github.com/team-telnyx/telnyx-code-examples/tree/main/call-control-forwarding) — Durable call forwarding with Agent SDK
- [ai-decision-models](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ai-decision-models) — Using Jev Decision Models for structured extraction
- [sms-notification-service](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sms-notification-service) — Exactly-once SMS with durable actors
- [ivr-menu-driver](https://github.com/team-telnyx/telnyx-code-examples/tree/main/ivr-menu-driver) — Driving IVR menus with send_dtmf

## Resources

- [Telnyx Voice API Docs](https://developers.telnyx.com/api-reference/call-commands/dial)
- [Telnyx Call Control Docs](https://developers.telnyx.com/docs/voice/call-control)
- [Telnyx send_dtmf API Reference](https://developers.telnyx.com/api-reference/call-commands/send-dtmf)
- [Telnyx In-Call Transcription (STT)](https://developers.telnyx.com/docs/voice/stt/in-call-transcription)
- [Telnyx Messaging API Docs](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Telnyx AI Decision Models](https://developers.telnyx.com/docs/inference/decision-models)
- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks)
- [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge)
- [Telnyx Pricing](https://telnyx.com/pricing)
</arg_value>
