---
name: sched-events-retry
title: "Scheduled-Events Retry Campaign Desk — Deadline-Aware Call Campaigns with Attempt Forensics"
description: "Run an outbound reminder campaign on Assistant Scheduled Events with a retry budget, then rebuild every call's attempt history into a delivery scorecard."
language: python
telnyx_products: [AI Assistants, Scheduled Events, Voice, Call Control]
---

# Scheduled-Events Retry Campaign Desk

Schedule one phone-call event per contact with a retry budget, watch the attempt ledger rebuild itself, and print a delivery scorecard that separates reached-on-first-attempt from reached-on-retry-N.

## The Story

A regional outpatient clinic runs a reminder desk: every appointment in the next 48 hours gets a confirmation call, and a no-answer is not a "no" — it is a "try again in five minutes, up to three more times." If the desk misses a patient, the slot goes empty, the clinic eats the cost of an idle provider, and a patient who needed care slips through the cracks. The stakes are money and patient safety, in that order.

The actor IS the retry campaign. It is born when the scheduler stamps one phone-call event per contact across a 45-minute window, each carrying its own retry budget. It evolves as the platform dispatches, gets a busy signal, waits exactly `retry_interval_secs`, and fires again — the clock restarting at `now + interval`, never at the original schedule plus interval. It survives the watcher process dying and being restarted, because the attempt ledger lives on the event, not in memory. It completes when a call is answered and a `conversation_id` is recorded for transcript follow-up, or it terminates when the retry budget is exhausted and the contact is dead-lettered with its final `call_status`. The rest of this README is the API surface of that story.

## Why Telnyx

Scheduled Events is the assistant platform's built-in scheduler, and it is the rare piece of **AI Communications Infrastructure** that owns the hard part of outbound calling: dispatch timing, retry scheduling, and attempt recording. The retry fields (`max_retries_client_errors`, `retry_interval_secs`) travel with the event itself — the retry semantics you encode (per-event budget, clock restarting per attempt, full stop on answered) are enforced by the platform, not hand-rolled in poller code. One create call stamps the deadline; the dispatch, retry timing, and per-attempt forensics are the infrastructure's problem. Phone-call events are the only event type that accepts retry fields — the guide demonstrates the deliberate 400 you get when sending retry fields on an `sms_chat` event, so operators can recognize the guard immediately.

## Telnyx API Endpoints Used

- `POST /v2/ai/assistants/{assistant_id}/scheduled_events` — create one `phone_call` scheduled event per contact, each carrying `max_retries_client_errors` and `retry_interval_secs`
- `GET /v2/ai/assistants/{assistant_id}/scheduled_events` — list campaign events, filter to the campaign window
- `GET /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` — poll a single event; response embeds the full `call_attempts[]` ledger
- `DELETE /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` — cancel a pending event before dispatch; counted as cancelled, never a failure

Each event carries its own retry budget; each attempt appends to the per-event `call_attempts[]` array (attempt number, attempted-at timestamp, call status, conversation id where captured).

## Architecture

This is a script suite: four standalone CLI scripts, in workflow order, plus a thin `app.py` dispatcher (`python app.py` prints the menu explained below).

```
contacts.csv ──▶ create_campaign.py ──▶ campaign_manifest.json
                        │                       │
                        ▼                       ▼
              (Telnyx Scheduled Events)  watch_campaign.py ⇄ polls GET .../{event_id}
                        │                       │            rebuilds call_attempts ledger,
                        ▼                       │            asserts the retry clock (T+interval
              retry during the window           │            per attempt, not schedule+interval)
                        │                       ▼
                        └────────────▶ report.py ──▶ delivery scorecard
                                                │   (reached-on-first vs reached-on-retry-N,
                                                │    dead-letter details, cancelled count)
                                                ▼
                                        teardown.py ──▶ DELETE remaining events
                                                        (written back to the manifest)
```

| File | Role | Generated artifacts |
|------|------|----------------------|
| `create_campaign.py` | Step 1 — schedule one `phone_call` event per contact; E.164 validation, name sanitization, `--spread` staggering (default 45 min), retry budget, SMS-guard 400 probe | `campaign_manifest.json` |
| `watch_campaign.py` | Step 2 — poll events every 30 s, rebuild the per-attempt ledger, assert the retry clock restarts at each failed attempt, dead-letter exhausted budgets once per event | `dead_letter.csv`, manifest `attempt_summaries` |
| `report.py` | Step 3 — offline scorecard from manifest + dead-letter CSV: totals, reached-on-first-attempt vs reached-on-retry-N, failures by final `call_status`, explicit cancelled count | stdout delivery report |
| `teardown.py` | Step 4 — cancel every manifest event via DELETE before it dispatches; cancelled ids recorded so report counts them as cancelled | manifest `cancelled_ids` |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TELNYX_API_KEY` | Telnyx account API key (never in code) | none — required |
| `TELNYX_ASSISTANT_ID` | The single assistant the campaign's events are attached to | none — required |
| `TELNYX_FROM_NUMBER` | Caller ID for the campaign calls (E.164) | none — required |
| `TELNYX_SIP_REGION` | SIP region for outbound calls | `us-east` |
| `TELNYX_API_BASE` | Optional override of the API base URL | `https://api.telnyx.com/v2` |
| `DEMO_MODE` | `true` (default): all API calls are printed, nothing dispatched. `false`: live calls | `true` |

## Setup

```bash
# 1. Clone this folder out of the repo (or run in place — requirements are minimal)
cd sched-events-retry

# 2. Install dependencies
pip install -r requirements.txt

# 3. Copy the env template and fill in your credentials
cp .env.example .env
#    TELNYX_API_KEY      your account API key
#    TELNYX_ASSISTANT_ID an assistant with a telephone access policy (see below)
#    TELNYX_FROM_NUMBER  a number you own on your Telnyx account

# 4. Edit contacts.csv (name,phone E.164) — demo ships with safe placeholders
```

Your assistant must have a *telephone access policy* allowing it to make calls from `TELNYX_FROM_NUMBER`, and the from-number must be an emergency-verified, SMS-capable (voice) number you own.

### Demo mode vs live mode

- **Demo mode** (`DEMO_MODE=true`, default) prints every API request it would send (create / list / get / delete) without dispatching any live traffic. The SMS guard probe intentionally hits the API even in demo mode because it demonstrates the phone-call-only 400; it uses a non-routable placeholder number.
- **Live mode** (`DEMO_MODE=false`) delivers the campaign for real: scheduled events are created on the platform, the watcher polls until every event reaches a terminal status, and `report.py` prints the scorecard.

### Run the campaign (live mode)

```bash
# 1. Schedule the campaign: one phone-call event per contact, staggered across a window
python create_campaign.py --contacts contacts.csv --start 2026-10-20T15:00:00Z --spread 45
#    defaults: --max-retries 3, --retry-interval 300 (seconds)

# 2. Watch it: poll every 30 s, rebuild the attempt ledger, assert the retry clock
python watch_campaign.py            # add --once for a single poll (CI), --max-polls N to bound it

# 3. Score it: reached-on-first vs reached-on-retry-N, dead-letter details
python report.py

# 4. Cancel any not-yet-dispatched events (counted as cancelled, not failed)
python teardown.py
```

## API Reference

Full request/response schemas, `call_attempts[]` field table, event status table, retry clock semantics, and per-endpoint status-code handling live in [API.md](API.md). A deeper walkthrough of the retry semantics you are encoding (per-event budgets, the SMS 400 guard, clock restarts) is in [GUIDE.md](GUIDE.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `400` creating retry-bearing events | Retry fields sent on an `sms_chat` (or other non-phone-call) event type | Retry fields are phone-call-only — keep `type: "phone_call"`; the guide's guard probe reproduces this 400 deliberately |
| `400` on create | Malformed payload: bad E.164 phone, non-ISO `--start`, retry fields out of range (`max_retries_client_errors` 0–10, `retry_interval_secs` 60–86400) | Fix the payload with the API.md request table; `create_campaign.py` pre-validates phones and start times |
| Campaign created but nothing dispatches | Window hasn't opened yet, or all events are `pending` | `--start` is a fixed UTC datetime; verify the window with `watch_campaign.py --once` |
| Watcher reports no events | Wrong manifest — no eligible events in the campaign window | Re-run `create_campaign.py`, use the manifest it wrote (`campaign_manifest.json`) |
| Watcher exits with lots of dead-letters | Retry budgets exhausted (no-answer every attempt) | Expected whenever nobody answers: budget N × `--retry-interval` s of dead air, then dead-letter. Re-schedule dead-lettered contacts manually if needed |
| Ledger shows attempts firing at schedule+N, not attempt-N+interval | Not a platform bug — attempts restart the clock | `verify_retry_clock()` flags this precisely because it would be wrong behavior; if you see it, report it (see API.md) |
| `report.py` prints zero everything | No terminal statuses yet — campaigns take real time | Run `watch_campaign.py` to completion first (or `--max-polls`), then report |
| `python report.py` says manifest not found | `create_campaign.py` hasn't run | Run step 1; the manifest is written next to the scripts |
| `401` on any call | `TELNYX_API_KEY` missing/wrong | Check `.env` against your account's API keys page |
| Assistant calls fail immediately (`failed` status, `conversation_id` null) | Assistant has no telephone access policy, or `TELNYX_FROM_NUMBER` isn't owned/voice-capable | Attach a telephone access policy to the assistant and use one of your numbers |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [AI Call Campaign Orchestrator (DEV-808)](https://linear.app/telnyx/issue/DEV-808/sprint-2-ai-call-campaign-orchestrator) — the call-campaign side of this pattern without the Scheduled Events retry budget.
- [scheduled-reminder-agent](../../scheduled-reminder-agent/README.md) — event-driven reminders on the scheduling plane.
- [email-batch-retry-agent](../../email-batch-retry-agent/README.md) — the same retry ledger / dead-letter discipline for an email batch.
- Telnyx Scheduled Events docs ([docs](https://developers.telnyx.com/docs/ai-assistants/schedule-api)) — the scheduled_events API reference.

## Resources

- [API.md](API.md) — full per-endpoint schemas, attempt-ledger semantics, event statuses
- [GUIDE.md](GUIDE.md) — developer walkthrough of the retry semantics you are encoding
- [Telnyx documentation](https://developers.telnyx.com) — product home
