# Winderval Medical — Patient Access Demo

A synthetic hospital patient-access demo for sales, running as a **Telnyx Edge
Compute function**: the patient books an appointment with their phone number
saved on file, the visit goes missed, and the AI voice agent **auto-calls the
patient** to check in — confirms identity, explains the missed visit, rebooks
from real availability, sends the SMS confirmation, and warm-transfers a
medical question to the nurse line — with the scheduling dashboard updating
live at every step.

**Product message: Telnyx builds it, then the hospital runs it.**

This example demonstrates **AI Communications Infrastructure** for a patient
access workflow.

> All patients, phone numbers, and data are fictional. Architecture and
> diagram: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (rendered:
> `docs/architecture.html`).

## Quickstart (mock mode — no Telnyx credentials needed)

Requires Node ≥ 20 and Docker running (on this Mac: `colima start`).

```bash
npm install
npm run demo        # boots the real Telnyx Edge dev stack in Docker
```

When you see `✓ Ready on http://127.0.0.1:8787`, open
**http://127.0.0.1:8787** and:

1. **Sign in** — the demo staff account is `staff@windervalmedical.health` /
   `winderval-demo` (documented here and nowhere on the login page). Account
   creation is disabled for the shared demo.
2. **Book the appointment first** — the Scheduling tab opens on the intake
   card: type the patient's full name + phone (E.164 — **saved on file with
   the booking**) and tap one of today's slots, then click **Book
   appointment**. The dashboard flips to the **Appointment on the books**
   card with the number on file. The phone field is prefilled with the last
   number saved; **Reset** keeps it so repeat takes carry the same patient.
3. **Simulate the missed visit** — one button: **Mark missed & auto-call
   now**. The AI voice agent calls that number automatically with zero staff
   involvement: identity check → missed-visit explanation → three real rebook
   slots → the patient picks → the booking is written back to the scheduling
   system → the SMS confirmation advances queued → sent → delivered → the
   medication question is refused and escalated → the warm transfer connects
   the nurse line with the full handoff context (patient, MRN, appointment,
   selected slot, the patient's question).
4. Click **Reset** any time for a fresh booking (works mid-run; settings and
   the on-file number carry over). Adjust calling hours or the nurse/staff
   number in **Settings** — slot times and the transfer target update
   immediately.
5. Switch to **Patient Record** for the full timeline: the intake booking,
   the missed visit, the call transcript, the rebooking, the SMS, and the
   escalation card with the staff handoff context.

Mock mode never places calls and never sends SMS: the dialogue, the auto-call,
the booking write-back, the SMS delivery states, and the warm transfer are all
simulated in-process by the Edge function.

## What you'll see

| Step | Screen |
|---|---|
| 1. Intake booking | Scheduling tab — the intake card (name + phone **saved on file**) with today's slots; Booking flips to the **Appointment on the books** card |
| 2. Visit missed | The missed-appointment banner + one button: **Mark missed & auto-call now** |
| 3. AI auto-calls the patient | The call activity panel streams the transcript — "Hi, this is Ava calling from Winderval Medical… Am I speaking with {patient}?" — using the number on file |
| 4. Rebook from the call | Three rebook slots offered; the patient picks; the green **Booked** card appears and the slot leaves availability |
| 5. SMS confirmation | SMS bubble advances **queued → sent → delivered** to the on-file number |
| 6. Medical question | "Can I take my medication before the appointment?" — the agent refuses to advise |
| 7. Warm transfer | The escalation card (amber) with the staff handoff context: patient, MRN, appointment, the selected slot, the question; the transfer status **connected**; the nurse line greets the patient |

A persistent banner always shows the current mode: **MOCK MODE — synthetic
data · no calls or texts will be placed** (or LIVE MODE when enabled).

## Commands

| Command | Purpose |
|---|---|
| `npm run demo` | Boot the Telnyx Edge dev stack in Docker (function + actors + Dapr + Postgres) on port 8787, with hot reload |
| `npm run ship` | Deploy the function to a public Edge URL (`telnyx-edge ship` → `https://<name>-<id>.telnyxcompute.com`) |
| `npx tsc --noEmit` | Strict TypeScript check |
| `npm test` | All Vitest suites (15 files, 74 tests) |
| `npm run test:watch` | Vitest in watch mode |

Demo pacing defaults to 9000 ms per beat; override with `DEMO_PACE_MS` in
`telnyx.toml [env_vars]` or per-run via
`POST /api/demo/missed-call {"paceMs":12000}`.

## Configuration

**Mock mode (default)** requires nothing but the `telnyx.toml` that is already
in the repo. It is fully runnable offline.

**Live mode is strictly opt-in** and fails closed. In `telnyx.toml`:

1. Set `DEMO_MODE = "live"` and fill `TELNYX_CONNECTION_ID` (a Voice
   AI–enabled Call Control application), `TELNYX_ASSISTANT_ID`, `FROM_NUMBER`,
   `STAFF_PHONE`, and `PUBLIC_BASE_URL` (the deployed HTTPS URL of this
   function) — `DEMO_TARGET_PHONE` remains optional.
2. Register the two secrets on the account (values never live in the repo):
   `telnyx-edge secrets add TELNYX_API_KEY "<key>"` and
   `telnyx-edge secrets add TELNYX_PUBLIC_KEY "<base64-key>"`.
3. Deploy with `npm run ship` and point the Call Control application's webhook
   URL at `https://<your-function-url>/api/webhooks/telnyx`.
4. Trigger live calls manually from the UI: the book-first flow marks the
   visit missed and the AI agent **dials the on-file number for real**. Live
   SMS from a US toll-free number requires Toll-Free Verification first
   (1–2 weeks) — or use a 10DLC-registered 10-digit number.

If any of the above is missing, the app refuses live features with a message
naming exactly what is missing. See `RUNBOOK.md` for the full live-mode path.

## Safety and data

- All patients, providers, and phone numbers are **synthetic and fictional**.
- No real PHI anywhere; actor state lives in `.telnyx/` (gitignored).
- The agent is instructed to **never diagnose or advise on medication**;
  medical questions trigger an escalation with handoff context by design —
  that policy is unit-tested.
- Secrets never enter the repo; only the `telnyx.toml` secret *bindings* and
  placeholders are committed. The patient numbers entered at intake live in
  the local demo state only (`.telnyx/`, gitignored) — reset or wipe freely.

## Repository layout

```
telnyx.toml           Edge manifest: function, DemoAgent + AccountsActor
                      actors, TELNYX binding, env_vars (BRAND_NAME etc.),
                      secrets (API key, webhook public key)
src/index.ts          Edge fetch handler: UI route, JSON API, webhook receiver
src/demo/             DemoAgent actor (intake + missed-call auto-start +
                      scripted flow), demo driver, state seam
src/domain/           Types, slots (intake + rebook), clinic store, escalation
                      policy, transfer payload, SMS builder, brand, settings
src/call/             CallDriver interface + mock transport + Telnyx live driver
src/server/           Env parsing (mock/live fail-closed), auth session cookie
src/ui.ts             The entire UI: one inline HTML/CSS/JS template
tests/                Vitest suites — 15 files, 74 tests
docs/                 API contract, architecture + diagram, demo script,
                      runbook
```

## API

See `docs/API.md` and `RUNBOOK.md` for the API contract and demo-day
operations.

## Why Telnyx

Telnyx provides the phone number, Voice AI assistant, call control, Edge
Compute webhook, and SMS confirmation path in one communications platform.
This example keeps the patient workflow in a single TypeScript application so
the scheduling write-back and confirmation message can be tested together.

## Agent discovery

The live assistant uses a single `reschedule_clinic_appointment` tool after
identity verification and explicit confirmation. The tool endpoint validates
the patient and matches the requested time against the currently available
runtime slots. A stale or fabricated `slot_id` is ignored when the spoken ISO
time still identifies a valid offered slot.

## Troubleshooting

- If a live call reaches the assistant but does not update the appointment,
  inspect the tool call arguments and confirm that `new_time` is one of the
  slots currently shown by the app. The webhook returns a clear 422 response
  for unavailable times.
- If the tool URL returns `not found`, verify that the assistant points to the
  deployed function URL, not an old tunnel URL, and that the path is exactly
  `/api/voice/reschedule`.
- If SMS is not delivered, verify the sender number, destination formatting,
  and messaging registration requirements in `RUNBOOK.md`.

## Related examples

- [`patient-agent`](../patient-agent/README.md) — a smaller Edge Compute
  patient workflow with an AI assistant.
- [`ai-appointment-booking-sms-flow-python`](../ai-appointment-booking-sms-flow-python/README.md)
  — appointment booking with SMS notifications.
- [`edge-voice-agent-holds-call`](../edge-voice-agent-holds-call/README.md)
  — a voice agent that coordinates a live call while work is completed.
