# Insurance Verification Caller — Developer Guide

This guide walks through the `insurance-verification-caller` sample: a durable, self-retrying Telnyx Edge actor that dials a carrier's IVR, drives the menu with DTMF, captures the spoken eligibility answer via STT, scores it with Jev Decision Models, and sends exactly one result SMS to the front desk.

---

## Prerequisites

- A Telnyx account with a Messaging profile and a Voice number.
- `telnyx-edge` CLI installed and authenticated (`telnyx-edge auth api-key set <KEY>`).
- Node.js 18+ and `npx tsx` for running the smoke test locally.
- The `@telnyx/edge-runtime` package (declared in `package.json`).

---

## Environment Setup

All runtime values come from environment bindings — **nothing is hardcoded**. Create a `.env` file (or set secrets via the CLI) with the following:

| Variable | Description | Example |
|---|---|---|
| `TELNYX_API_KEY` | Telnyx API key (secret) | `your_telnyx_api_key_here` |
| `CARRIER_E164` | Carrier phone number to dial (live mode) | `+1555XXXXXXXX` |
| `MOCK_CARRIER_E164` | Mock carrier number (demo mode) | `+1555XXXXXXXX` |
| `CARRIER_NUMBER_ID` | Telnyx connection ID for outbound dial | `connection-uuid` |
| `OUTBOUND_CALLER_ID` | Telnyx number ID used as caller ID | `number-uuid` |
| `FRONTDESK_E164` | Front desk SMS destination | `+1555XXXXXXXX` |
| `HOLD_MAX_MS` | Max hold time before retry (ms) | `180000` |
| `ANSWER_SILENCE_MS` | Silence gap to detect answer end (ms) | `4000` |
| `VM_KEYWORDS` | Comma-separated voicemail detection keywords | `voicemail,leave a message,after the tone` |
| `MENU_LOOP_MAX` | Max repeated-menu matches before retry | `3` |
| `MAX_ATTEMPTS` | Max retry attempts | `3` |
| `JEV_MODEL` | Jev decision model name | `telnyx/decision-flash` |
| `JEV_ENDPOINT` | Jev API endpoint | `https://api.telnyx.com/v2/ai/typesafe/v1/systemone` |
| `DEMO_MODE` | `true` (default) for simulated carrier; `false` for live dial | `true` |

Register the API key as a secret:

```bash
telnyx-edge secrets add TELNYX_API_KEY "<your_api_key>"
```

---

## Demo Mode vs Live Mode

The sample runs in **safe demo mode by default** (`DEMO_MODE=true`). In demo mode:

- No real outbound call is placed.
- No real SMS is sent.
- The carrier IVR response is simulated locally with a random eligibility outcome.
- Actions are logged to the console with a `[DEMO]` prefix.

To switch to **live mode** (real calls and SMS):

1. Set `DEMO_MODE=false` in your environment.
2. Provide real Telnyx credentials and phone numbers in the env vars above.
3. Deploy with `telnyx-edge ship`.

---

## How It Works — Step by Step

### 1. Job Creation via RPC

The flow starts when the front desk creates a verification job. The `rpc` object at the bottom of `src/index.ts` exposes an `openJob` function:

```typescript
export const rpc = {
  openJob: async (memberId, plan, provider) => {
    const actor = env.VERIFY_JOB.idFromName(`${memberId}-${Date.now()}`);
    const stub = env.VERIFY_JOB.get(actor);
    return stub.openJob(memberId, plan, provider);
  },
};
```

- `env.VERIFY_JOB.idFromName(jobId)` creates a **deterministic, durable actor ID** from the job ID. This means every call for the same job routes to the same actor instance — the actor survives pod restarts and retries.
- `env.VERIFY_JOB.get(actor)` returns a stub that proxies RPC calls to the actor's `openJob` method.

Inside `openJob`, the actor initializes its state (member ID, plan, carrier, attempt counter, verdict, sent flag) and creates the `attempts` SQL table if it doesn't exist. It then schedules the first `run` task with a 0-second delay.

### 2. Dialing and Driving the IVR

The `dialAndDriveIvr` method handles the call. In **demo mode**, it simulates the DTMF sequence and returns a random carrier response. In **live mode**, it:

1. **Dials the carrier** via `POST /v2/calls` using `dialCarrier`. The request body includes `connection_id` (the Telnyx number resource), `from` (outbound caller ID), and `to` (the carrier number). The response contains a `call_control_id` used for subsequent actions.

2. **Drives the IVR menu** using `sendDtmf` — this sends DTMF digits **to** the remote IVR. The sequence is:
   - `"2"` — select eligibility inquiry
   - The member ID digits — enter the member's ID
   - `"0"` — confirm or navigate to the eligibility tree

   > **Important:** `send_dtmf` sends digits TO the carrier. The `gather` primitive only collects digits FROM a party — it is **not** used to drive the menu, per the spec.

3. **Captures the carrier's spoken answer** via `captureTranscript`, which polls the call's transcription. In a full production implementation, `transcription-start` events would stream to a webhook handler (see the `/webhook/call` route in the default `fetch` handler).

### 3. Judging with Jev Decision Models

Once the transcript is captured, `judgeWithJev` sends it to the Jev Decision Models API (`POST /v2/ai/typesafe/v1/systemone`). The request includes:

- `model` — the Jev model name (e.g., `telnyx/decision-flash`)
- `state` — the full transcript text
- `questions` — three question types in a single shared-state call:
  - **`choice`** — "Is the member covered under the plan?" with options `covered`, `not_covered`, `needs_verification`
  - **`score`** — "How confident are you in the coverage determination (0-100)?" with min 0, max 100
  - **`noul`** — "Confidence that this is a hard no-coverage result (0-1)." with min 0, max 1

The `jevFetchWithRetry` method wraps the API call with **bounded exponential backoff** for 429 and 5xx errors, honoring the `Retry-After` header when present. After 3 failed attempts, it throws an error.

The `parseVerdict` method extracts the structured verdict (`choice`, `score`, `noul`) from the Jev response, handling both `answers` and `results` response shapes.

### 4. Decision Policy

The `notifyFrontDesk` method applies the decision policy:

- **`covered` AND `score >= 70`** → "Coverage CONFIRMED for member {memberId} ({plan}). Score: {score}."
- **`not_covered` OR `noul > 0.8`** → "NOT COVERED — verify before visit for member {memberId}."
- **`needs_verification`** → "Needs verification for member {memberId}. Flagged for front desk review."

In demo mode, the SMS body is logged with a `[DEMO]` prefix. In live mode, it's sent via `this.env.TELNYX.messages.send({ to, text })`.

### 5. Retry Ledger and Backoff

If the transcript is null (voicemail, drop, or long-hold), the actor enters the retry path:

1. It checks `this.state.attempts < maxAttempts` (default 3).
2. It inserts a row into the `attempts` SQL table with outcome `"failed"`.
3. It schedules a retry using `this.schedule(delay, "run", {}, { id: "verify:" + jobId })` with backoff delays of 10s then 30s (from the `BACKOFF_MS` array).
4. If all attempts are exhausted, it logs `"exhausted"` and stops.

The `attempts` table is created via `this.sql("CREATE TABLE IF NOT EXISTS attempts(...)")` and each attempt is recorded with `this.sql("INSERT INTO attempts(...) VALUES(?, ?, ?)", [...])`. This SQL ledger survives pod restarts — the actor's durable state and the SQL table persist independently.

### 6. Exactly-Once SMS

The `sent` flag in the actor's state ensures the result SMS is sent **exactly once**, even if the worker is killed between the Jev call and the SMS send. On restart, the actor resumes with `sent: true` and skips the notification.

### 7. Webhook Handler

The default `fetch` handler at the bottom of `src/index.ts` exposes two routes:

- `POST /webhook/call` — receives Call Control events (`call-hangup`, `transcription-start`, etc.). In a full implementation, routes events to the correct `VerifyJob` actor by `call_control_id`.
- `GET /health` — health check endpoint.

---

## Key Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent SDK** (`Agent<Env, State>`) | `VerifyJob` extends `Agent`, providing durable state, SQL ledger, and scheduled tasks. |
| **Call Control** | `POST /v2/calls` to dial; `POST /v2/calls/{id}/actions/send_dtmf` to drive the IVR; `transcription-start` for STT. |
| **Jev Decision Models** | `POST /v2/ai/typesafe/v1/systemone` with `choice`, `score`, and `noul` question types. |
| **Messaging** | `this.env.TELNYX.messages.send()` to send the result SMS. |
| **SQL (Agent SQL)** | `this.sql()` for the `attempts` audit ledger — persists across restarts. |
| **Scheduled Tasks** | `this.schedule(delay, "run", {}, { id })` for retry backoff with deterministic task IDs. |

---

## Running the Sample

### Local Smoke Test

```bash
npx tsx smoke_test.ts
```

This verifies that the `VerifyJob` class, its methods, and the env surface are correctly defined.

### Deploy

```bash
telnyx-edge ship
```

This deploys the actor and webhook handler to Telnyx Edge.

### Trigger a Verification Job

Once deployed, call the RPC endpoint:

```bash
curl -X POST https://<your-edge-url>/rpc/openJob \
  -H "Content-Type: application/json" \
  -d '{"memberId": "M12345", "plan": "PREMIUM", "provider": "ABC Health"}'
```

---

## Next Steps

- [Telnyx Agent SDK Documentation](https://developers.telnyx.com/docs/agent-sdk) — Learn about durable actors, scheduled tasks, and state management.
- [Call Control API Reference](https://developers.telnyx.com/api-reference/call-commands) — Dial, send DTMF, and manage call events.
- [Telnyx send_dtmf API Reference](https://developers.telnyx.com/api-reference/call-commands/send-dtmf)
- [Telnyx In-Call Transcription (STT)](https://developers.telnyx.com/docs/voice/stt/in-call-transcription) — Capture carrier spoken responses.
- [Telnyx Messaging API Docs](https://developers.telnyx.com/docs/messaging/messages/send-message) — Send result SMS to the front desk.
- [Telnyx AI Decision Models](https://developers.telnyx.com/docs/inference/decision-models)
- [Telnyx Edge CLI](https://developers.telnyx.com/docs/edge) — Deploy, manage secrets, and monitor actors.
- [Telnyx Pricing](https://telnyx.com/pricing)
</arg_value>
