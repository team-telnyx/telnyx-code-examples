# RUNBOOK — Demo-day operations

This runbook covers mock-mode demo runs (the default and the safe path — the
one to film) and the opt-in live mode. Read the safety section before enabling
live mode.

## Pre-flight (do this before filming or presenting)

1. Node ≥ 20: `node --version`
2. Docker running — on this Mac Docker is backed by colima:
   `colima start` (wait for "done"), verify with
   `docker info --format '{{.ServerVersion}}'`.
3. `npm install` (first time only)
4. Boot the stack: `npm run demo` — starts the real Telnyx Edge dev stack
   (function runtime + DemoAgent/AccountsActor actor runtimes + Dapr
   sidecars + scheduler + Postgres). First run pulls ~1 GB of images; later
   runs are fast. Wait for `✓ Ready on http://127.0.0.1:8787`.
   NOTE: manifest changes ([env_vars], e.g. `BRAND_NAME`) apply on the
   NEXT boot of the watcher — restart `npm run demo` after editing
   `telnyx.toml`.
5. Open **http://127.0.0.1:8787** — the portal shows the sign-in page. Sign in
   with the seeded staff account (mock demo credentials:
   staff@windervalmedical.health / winderval-demo — documented in the repository
   README only, never on the login page), or use **Create account**.
6. Optional pacing: default is 9000 ms per beat (≈ 2:10 of the AI call).
   For a slower take,
   `curl -X POST localhost:8787/api/demo/missed-call -H 'content-type: application/json' -d '{"paceMs":12000}'`.

## Controls (the book-first flow)

- **Sign in / Create account** (login page) — the gate. The seeded staff
  account is documented in the README; new staff register inline and are
  signed straight in. Sessions live in the ACCOUNTS actor (8-hour TTL,
  HttpOnly cookie).
- **Intake card** (Scheduling tab) — the first thing on screen after sign-in:
  Patient full name + Phone (E.164 — **saved on file with the booking**) +
  today's selectable slots → **Book appointment**. The dashboard flips to the
  "Appointment on the books" card. The phone field is prefilled with the last
  number saved ("on file"), so repeat takes reuse the same patient.
- **Mark missed & auto-call now** — one button after booking. Marks the visit
  missed and AUTO-STARTS the AI call to the on-file number. In MOCK MODE the
  call is simulated end-to-end; nothing dials.
- **Stop** — halts a running script; phase → stopped.
- **Reset** — stops a running script (if any, waits for a clean exit) and
  returns to the FRESH INTAKE state: the on-file number stays in Settings
  (the prefill), so the next booking repeats the patient.
- **Settings** — calling hours, staff/nurse (warm-transfer) number, live-mode
  numbers. Saving regenerates slot times immediately and retargets the
  transfer. This is the "hospital runs it" handover beat.
- **Sign out** — ends the session; back to the login page.

## The demo beat map (what to watch)

| Beat | On screen |
|---|---|
| Intake booking | The intake card → fill name + phone → tap a slot → **Book appointment** → the **on-the-books** card appears with the number noted |
| Visits missed | The missed-appointment banner appears + it is one button press to trigger the agent |
| AI auto-call | The call activity panel: phase → Preparing → Calling; the chip shows the dialed number; the transcript streams the identity check |
| Missed explanation | "I'm calling because you missed your appointment — your {visit} was scheduled for {when}…" |
| Rebook | Three future slots offered; "Tomorrow at 2 PM works for me."; the green **Booked** card appears; the slot leaves availability |
| SMS confirmation | The SMS bubble advances queued → sent → delivered to the on-file number |
| Medical question | "Can I take my medication before the appointment?" — the agent refuses |
| Escalation | The amber escalation card (Patient Record tab) with the staff handoff context |
| Warm transfer | "Warm transfer started" → "Connected to staff" — the nurse greets the patient by first name with the question |
| Handover | The Settings beat: call-flow settings change on screen with instant effect |

## Between takes

**Reset** stops any run and returns to the fresh intake state — the on-file
number carries over in the prefill, so the next booking repeats the same
patient. A take lost mid-call: Reset → re-book → Mark missed again.

## LIVE MODE — opt-in only

Live mode places a **real AI phone call** through Telnyx (Voice AI + Call
Control) and can send real SMS. Only enable it with explicit permission for
the destination number — per policy, this demo dials **only the number the
operator enters at intake (your own mobile)**.

1. Edit `telnyx.toml [env_vars]`: set `DEMO_MODE = "live"` and fill
   `TELNYX_CONNECTION_ID` (a Voice AI–enabled Call Control application),
   `TELNYX_ASSISTANT_ID`, `FROM_NUMBER`, `DEMO_TARGET_PHONE`, `STAFF_PHONE`,
   and `PUBLIC_BASE_URL` (the deployed HTTPS function URL).
   Missing any value → live features fail closed with a message listing what
   is missing.
2. Register the secrets (once):
   `telnyx-edge secrets add TELNYX_API_KEY "<key>"` and
   `telnyx-edge secrets add TELNYX_PUBLIC_KEY "<base64 public key>"`.
3. Deploy: `npm run ship` → note the printed public URL
   (`https://patient-access-hospital-demo-<id>.telnyxcompute.com`).
4. Point the Call Control app's webhook URL at
   `https://<function-url>/api/webhooks/telnyx`.
5. Open the deployed URL, sign in, book the patient (= your mobile), click
   **Mark missed & auto-call now** — the AI assistant dials your phone for
   real; the call transcript streams from webhooks; the transfer tool bridges
   to `STAFF_PHONE` live.
6. Messaging prerequisite (US): a toll-free `FROM_NUMBER` must complete
   Toll-Free Verification (1–2 weeks) before carriers deliver its SMS — or
   use a 10DLC-registered 10-digit number. Verify before enabling SMS.
7. Signature verification: with `TELNYX_PUBLIC_KEY` set, webhook requests
   without a valid Ed25519 signature get a 401.

Notes: `telnyx-edge dev` (local) has no secrets/TELNYX bindings — live mode
belongs to the deployed function. The mock demo is deliberately offline.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `npm run demo` fails to reach docker | colima/Docker not running → `colima start` |
| Port 8787 already bound | an old stack is up → `docker compose -f .telnyx/dev/compose.yaml down` (or kill `telnyx-edge dev`) |
| Page shows "Connecting to Winderval Medical…" forever | the Edge stack isn't up yet (or restarts mid-save) — wait for `✓ Ready`, then refresh the page once |
| Page shows the OLD brand name | [env_vars] apply on the next `npm run demo` boot — restart the watcher after editing telnyx.toml |
| "Book an appointment first" on any start action | the book-first flow requires a visit: use the intake card (a visit is REQUIRED — this error is by design) |
| Intake card: "Clinic is booked up for today" | the container clock is UTC; today's capacity is exhausted at (UTC) calling-time — widen calling hours in Settings (e.g. 00:00–23:59 for previewing) or accept tomorrow labels |
| Slots missing / odd times | the actor container runs UTC — slot labels follow it; widen calling hours or shoot the intake beat with hours that fit (RUNBOOK note) |
| "Demo in progress — Reset first" | a run is active — Reset (waits for a clean exit) then re-book |
| Live refused at startup | a requireal live env var is missing — the error lists exactly which |
| Webhook 401 | signature verification enabled and the public key mismatches — re-copy the base64 key |
| SMS not delivered | Toll-Free Verification / 10DLC missing on `FROM_NUMBER` (US carriers) |
| Assistant doesn't dial | check `TELNYX_CONNECTION_ID` is Voice AI–enabled and the number is assigned to it |

## Safety reminders

- Synthetic patients only; never load real PHI. The phone entered at intake
  lives in the local actor state only (.telnyx/, gitignored).
- The agent never diagnoses or advises on medication — medical questions
  escalate to staff by design (unit-tested).
- Never commit secret values; only telnyx.toml bindings live in the repo.
