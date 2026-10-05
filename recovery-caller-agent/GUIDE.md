# Recovery Caller Agent — Developer Guide

A hands-on walkthrough of the `recovery-caller-agent` sample: a durable, per-patient post-discharge follow-up program built on the Telnyx Edge Agent SDK. This guide explains how each piece works, how to run it in safe demo mode, and how to flip it to live mode for real calls and SMS.

---

## Prerequisites

- A Telnyx account with a Voice connection (`OUTBOUND_CONNECTION_ID`) and a Messaging profile.
- Node.js 18+ (for `telnyx-edge` CLI and `tsx` smoke test).
- The `telnyx-edge` CLI installed and authenticated:
  ```bash
  npm install -g @telnyx/edge-cli
  telnyx-edge auth api-key set <your_api_key>
  ```

---

## Project Layout

```
recovery-caller-agent/
├── src/
│   └── index.ts          # RecoveryCall actor + webhook handlers
├── smoke_test.ts         # Verifies module loads and classes/methods exist
├── package.json
├── tsconfig.json
├── telnyx.toml
├── .env.example
└── .gitignore
```

---

## Environment Setup

### 1. Configure `telnyx.toml`

This file declares the actor binding, secrets, and storage. The sample uses:

- **Actor namespace**: `FOLLOWUPS` — one durable `RecoveryCall` actor per patient phone number.
- **Secret**: `TELNYX_API_KEY` — used for raw `fetch` calls to Telnyx Call Control and Decision Models APIs.
- **SQL database**: `FOLLOWUPS_DB` — the append-only contact ledger.

```toml
name = "recovery-caller-agent"
main = "src/index.ts"
compatibility_date = "2026-07-28"

[[actors]]
binding = "FOLLOWUPS"
type    = "RecoveryCall"

[[secrets]]
binding = "TELNYX_API_KEY"
name    = "TELNYX_API_KEY"

[telnyx]
binding = "TELNYX"

[storage.sqldb.FOLLOWUPS_DB]
id = "<sql-database-uuid>"
```

> Replace `<sql-database-uuid>` with a real SQL database namespace UUID from the Telnyx dashboard.

### 2. Set Environment Variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description | Example |
|---|---|---|
| `TELNYX_API_KEY` | Your Telnyx API key | `KEY_...` |
| `OUTBOUND_CONNECTION_ID` | Telnyx Voice connection ID | `12345678-...` |
| `OUTBOUND_CALLER_ID` | Caller ID phone number (E.164) | `+15551234567` |
| `CLINIC_E164` | Clinic escalation dial target | `+15559999999` |
| `FRONTDESK_E164` | Front desk SMS target | `+15558888888` |
| `D1_DELAY_H` | Hours until Day-1 call | `24` |
| `D7_DELAY_H` | Hours until Day-7 call | `168` |
| `D14_DELAY_H` | Hours until Day-14 call | `336` |
| `RESUME_RETRY_MAX` | Max in-day no-answer retries | `2` |
| `RED_FLAG_NOUL` | Decision Model noul threshold | `0.8` |
| `SEVERITY_ESCALATE` | Severity score threshold | `3` |
| `ANSWER_SILENCE_MS` | AI gather timeout | `3000` |

---

## How It Works

### 1. Actor Birth: `openFollowUp` RPC

When a discharge webhook fires, the entry-point `fetch` handler at `/openFollowUp` extracts the patient phone, normalizes to digits, and looks up (or creates) a `RecoveryCall` actor via `env.FOLLOWUPS.idFromName(digits)`.

The actor's `@rpc openFollowUp(patientPhone, patientName, procedure)` method initializes state and calls `scheduleFollowUpWindows()`, which schedules three `callDay` tasks at the d1/d7/d14 delays. Because these are **durable scheduled tasks** on the actor, they survive restarts — the actor re-arms its timers on wake.

### 2. The 14-Day Schedule: `schedule()`

```typescript
await this.schedule(d1, "callDay", { slot: "d1" });
await this.schedule(d7, "callDay", { slot: "d7" });
await this.schedule(d14, "callDay", { slot: "d14" });
```

Each `callDay` task sets `currentDay` and `currentSlot`, resets `retryCount`, initializes the SQL ledger table, and calls `dialAndGather()`.

### 3. Dial → Answer → Speak → Gather

`dialAndGather()` calls `dialPatient()` which POSTs to `https://api.telnyx.com/v2/calls` with `connection_id`, `from` (caller ID), and `to` (patient phone). On success, it speaks an intro message via `speak-text`, then initiates `gather-using-ai` with the four symptom inputs: `pain`, `fever`, `drainage`, `meds_taken`.

In **demo mode** (`DEMO_MODE = true`), all of this is logged to console — no real calls are placed.

### 4. Decision Model Grading: `gradeWithDecisionModel`

When the `call-ai-gather-ended` webhook fires, `handleGatherEnded()` receives the symptom answers and transcript, then calls `processGatherResult()` which invokes `gradeWithDecisionModel()`.

This POSTs to `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` with:
- `model`: `"telnyx/decision-flash"`
- `state`: `{ procedure, answers }`
- `questions`: `{ stage: choice, severity: score, redflag: noul }`

The response contains `noul` (red-flag probability), `score` (severity 0–3), and `choice` (stage verification). If `noul > RED_FLAG_NOUL` (0.8) or `score >= SEVERITY_ESCALATE` (3), the verdict is `"red_flag"`.

**Retry handling**: On 429/529/502/503, the method honors `Retry-After` and reschedules itself. On 422, it logs a split-state error.

### 5. Escalation: `escalate()`

On a red-flag verdict, `escalate()` does two things:
1. **Dials the clinic** (`CLINIC_E164`) via `POST /v2/calls` — a warm handoff.
2. **Sends an SMS** to the front desk (`FRONTDESK_E164`) via `this.env.TELNYX.messages.send()` with the flagged transcript.

The ledger records `outcome = "escalated"`.

### 6. No-Answer / Busy Retry: `handleNoAnswer()`

If the patient doesn't answer, `handleNoAnswer()` checks `retryCount` against `RESUME_RETRY_MAX`. If under the limit, it reschedules `callDay` in 30 minutes and increments the retry counter. If exhausted, it parks — the next scheduled day (d7 or d14) will fire naturally. Every attempt is logged to the SQL ledger.

### 7. Mid-Script Drop: `handleHangup()`

If the call drops mid-script (`call-hangup` webhook), `handleHangup()` logs the drop and reschedules `resumeCall` in 60 seconds. The actor resumes at the last unanswered question — it does **not** re-ask questions already answered, because `this.answers` is persisted in durable state.

### 8. The SQL Ledger: `appendLedger()`

Every contact — answered, no-answer, escalated, dropped — is appended to the `followups` table:

```sql
CREATE TABLE followups (
  patient TEXT NOT NULL,
  day INTEGER NOT NULL,
  slot TEXT NOT NULL,
  outcome TEXT NOT NULL,
  verdict TEXT NOT NULL,
  answers TEXT,
  transcript TEXT,
  ts INTEGER NOT NULL,
  UNIQUE(patient, day)
)
```

The `UNIQUE(patient, day)` constraint ensures one entry per day per patient — the audit trail a compliance program needs. The ledger survives restarts because it lives in durable SQL storage.

### 9. Clean Completion: Day-14

On a clean day-14 call (no red flags), `processGatherResult()` sets `episodeComplete = true`, clears all schedules, and hangs up. The actor self-retires — no dangling timers.

---

## Demo Mode vs Live Mode

The sample defaults to **demo mode** (`DEMO_MODE = true` in `src/index.ts`). In demo mode:

- No real calls are placed — `dialPatient()` logs `[DEMO] Would dial patient ...`
- No real SMS is sent — `escalate()` logs `[DEMO] Would SMS front desk ...`
- Symptom answers are simulated: `{ pain: "3", fever: "no", drainage: "none", meds_taken: "yes" }`
- The Decision Model is simulated with local logic (pain score → severity, fever/drainage → red flag)

### Switching to Live Mode

To make real calls and send real SMS:

1. Set `DEMO_MODE = false` in `src/index.ts`.
2. Ensure all environment variables are set (see table above).
3. Deploy:
   ```bash
   telnyx-edge ship
   ```

In live mode, the actor uses real `fetch` calls to Telnyx APIs with the API key from secrets, and the real Decision Models API grades each check-in.

---

## Running the Smoke Test

Before deploying, verify the module loads and all expected classes/methods exist:

```bash
npx tsx smoke_test.ts
```

This test imports `RecoveryCall` from `src/index.ts`, instantiates it, and checks that `openFollowUp`, `callDay`, `gradeWithDecisionModel`, `escalate`, `appendLedger`, and other key methods are defined. It does **not** make any network calls.

---

## Testing the Full Flow

### 1. Deploy the actor

```bash
telnyx-edge ship
```

### 2. Trigger a follow-up

```bash
curl -X POST https://<your-deployment-url>/openFollowUp \
  -H "Content-Type: application/json" \
  -d '{
    "patientPhone": "+15551234567",
    "patientName": "Jane Doe",
    "procedure": "knee_arthroscopy"
  }'
```

### 3. Simulate a discharge webhook (demo mode)

In demo mode, the actor will log all actions to the console. You can observe the d1/d7/d14 schedule, simulated gather results, and ledger appends in the Telnyx Edge logs.

### 4. Verify the ledger

Query the SQL database to see the audit trail:

```bash
telnyx-edge sql FOLLOWUPS_DB "SELECT * FROM followups WHERE patient = '+15551234567'"
```

---

## Kill-Test: Restart Survival

The acceptance criteria require that timers and the ledger survive a restart. To test:

1. Trigger a follow-up.
2. Wait for the d1 call to be scheduled.
3. Kill the actor instance (via `telnyx-edge actors kill <actor-id>` or by redeploying).
4. The actor will wake on the next scheduled task, re-arm its timers, and continue the program from where it left off — the SQL ledger preserves all history.

---

## Next Steps

- **Telnyx Agent SDK docs**: https://developers.telnyx.com/docs/edge-compute/stateful-actors
- **Scheduled tasks**: https://developers.telnyx.com/docs/agent-sdk/scheduled-tasks
- **SQL storage**: https://developers.telnyx.com/docs/agent-sdk/sql
- **Call Control API**: https://developers.telnyx.com/api-reference/call-commands
- **Gather Using AI**: https://developers.telnyx.com/docs/voice/programmable-voice/gather-using-ai
- **Decision Models**: https://developers.telnyx.com/docs/inference/decision-models
- **Messaging API**: https://developers.telnyx.com/api-reference/messaging/messages
- **Related examples**: See `sms-reminder-agent` (DEV-841) and `inbound-refill-intake` (DEV-284) for simpler patterns.
