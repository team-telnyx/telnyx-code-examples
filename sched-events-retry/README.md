---
name: sched-events-retry
title: "Scheduled-Events Retry Campaign Desk — Deadline-Aware Call Campaigns with Attempt Forensics"
description: "Run an outbound reminder campaign on Assistant Scheduled Events with a retry budget, then rebuild every call's attempt ledger into a delivery scorecard."
language: python
framework: flask
telnyx_products: [AI Assistants, Scheduled Events, Voice]
---

# Scheduled-Events Retry Campaign Desk

Run an outbound reminder campaign on Assistant Scheduled Events with a retry budget, then rebuild every call's attempt ledger into a delivery scorecard.

## The Story

A regional clinic network runs appointment reminders for thousands of patients a week. A missed reminder is a no-show, and a no-show is a lost slot, a delayed diagnosis, and a patient who stops trusting the reminder system. The clinic's operations lead needs every reminder call to actually land — and when a patient doesn't pick up, she needs the system to try again on a schedule she can defend to compliance, not whenever a queue happens to drain.

The actor IS the campaign desk. It is born the moment the scheduler spreads one phone-call event per contact across a 45-minute window, each carrying its own retry budget. It evolves as the Telnyx Scheduled Events service dispatches calls, records each attempt in a `call_attempts` ledger, and restarts the retry clock at `now + retry_interval_secs` after every busy, no-answer, failed, or canceled outcome. It survives the things that kill naive campaigns: the watcher process is restarted mid-window and rebuilds the full attempt history from the platform, not from memory; a contact is pulled from the CSV after creation and is cancelled cleanly instead of dialed; an exhausted budget is dead-lettered with its final `call_status` instead of vanishing into a log. It completes when the last event reaches a terminal state and the report separates first-attempt reach from retry-N reach — the number the clinic actually reports upward.

The rest of this README is the API surface of that story.

## Why Telnyx

Scheduled Events is the assistant platform's built-in scheduler, and it is the only place where the retry clock, the retry budget, and the per-attempt ledger live together as first-class platform state. That matters because retry correctness is not something you can bolt on with a cron job and a hope: the platform owns dispatch, owns the clock restart after a terminal attempt, and owns the forensic record of what happened on every dial. Building this on **AI Communications Infrastructure** means the campaign desk never has to guess when the next attempt fires or reconstruct history from its own logs — it reads the ledger the platform already wrote.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/ai/assistants/{assistant_id}/scheduled_events` | Create one phone-call event per contact with `max_retries_client_errors`, `retry_interval_secs`, `scheduled_at_fixed_datetime`, `conversation_metadata`, and `call_settings.sip_region`. |
| `GET` | `/v2/ai/assistants/{assistant_id}/scheduled_events` | Paginated list — the watcher's polling surface (Scheduled Events has no webhook callback). |
| `GET` | `/v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Single-event detail including the `call_attempts` ledger. |
| `DELETE` | `/v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` | Cancel a pending event (used by teardown and by contacts removed from the CSV). |

## Architecture

Four parts, in the order data flows.

```text
  contacts.csv
       │
       ▼
┌──────────────────┐   POST .../scheduled_events    ┌──────────────────────────────┐
│   SCHEDULER      │ ─────────────────────────────▶ │  Telnyx Scheduled Events     │
│ create_campaign  │   (phone_call, retry budget,   │  service                     │
│                  │    staggered scheduled_at)     │  • dispatch                  │
│  • SMS 400 guard │                                │  • retry scheduling          │
│  • spread helper │                                │  • call_attempts ledger      │
└──────────────────┘                                └──────────────┬───────────────┘
                                                                   │
                                    GET .../scheduled_events       │
                                    GET .../scheduled_events/{id}  │
                                                                   ▼
                                                    ┌──────────────────────────────┐
                                                    │   WATCHER  (poll every 30s)  │
                                                    │  • status transitions        │
                                                    │  • per-attempt ledger        │
                                                    │  • clock-restart assertion   │
                                                    │  • dead-letter on exhausted  │
                                                    └──────────────┬───────────────┘
                                                                   │
                                                       ledger.json │ dead_letter.json
                                                                   ▼
                                                    ┌──────────────────────────────┐
                                                    │   REPORT  (offline)          │
                                                    │  reached-first / retry-N     │
                                                    │  failures by call_status     │
                                                    │  attempts vs budget          │
                                                    └──────────────────────────────┘

  TEARDOWN ── DELETE .../scheduled_events/{event_id} ──▶ cancel pending events
```

The **scheduler** creates events against a single assistant. Each event is one call with its own schedule; campaign-level orchestration lives in the app, not in the platform. The **Telnyx Scheduled Events service** owns everything time-based — dispatch, retry scheduling, attempt recording — and the event, not the campaign, is the unit of retry. The **watcher** is the observation layer: Scheduled Events has no webhook surface, so polling `GET .../scheduled_events` is the documented way to watch it. The **report** aggregates final event states into the delivery scorecard.

Retry budget semantics are encoded as constants: `max_retries_client_errors: 0` means 1 total attempt, `3` means up to 4, `10` means up to 11. Bounds are `retry_interval_secs` 60–86400 s and `max_retries_client_errors` 0–10, and the two must move together — one without the other is a 400.

## Environment Variables

| Variable | Type | Example | Required | Default | Description |
|----------|------|---------|----------|---------|-------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes (live mode)** | — | Telnyx API key. Never logged. |
| `TELNYX_ASSISTANT_ID` | `string` | `your_assistant_id_here` | **yes (live mode)** | — | Assistant that owns the scheduled events. |
| `TELNYX_FROM_NUMBER` | `string` | `+1555XXXXXXXX` | **yes (live mode)** | `+1555XXXXXXXX` | Outbound caller (`telnyx_agent_target`). |
| `TELNYX_SIP_REGION` | `string` | `us-east` | no | `us-east` | Region pin for the outbound leg (`call_settings.sip_region`). |
| `CAMPAIGN_ID` | `string` | `campaign-demo` | no | `campaign-demo` | Tag written into `conversation_metadata.campaign_id`. |
| `DEMO_MODE` | `string` | `true` | no | `true` | When `true`, no real Telnyx calls are dispatched. |
| `STATE_DIR` | `string` | `.campaign_state` | no | `.campaign_state` | Directory for `created_events.json`, `ledger.json`, `dead_letter.json`. |
| `PORT` | `string` | `5000` | no | `5000` | Flask listen port. |
| `CONFIRM_LIVE_CALLS` | `string` | `false` | **yes (live mode)** | `false` | Must be `true` before any real outbound call is placed. |
| `ALLOW_LIVE_SMS_GUARD` | `string` | `false` | no | `false` | Must be `true` before the `sms_chat` 400 probe issues a real request. |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sched-events-retry

python -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
# edit .env — set TELNYX_API_KEY, TELNYX_ASSISTANT_ID, TELNYX_FROM_NUMBER
# leave DEMO_MODE=true to run the whole campaign without placing a single call

cp contacts.csv.example contacts.csv
# edit contacts.csv with your own test contacts (never commit real numbers)

python app.py
# Flask listens on PORT (default 5000)
```

Run the smoke test before anything else — it imports the module and checks the routes load without a running server:

```bash
python smoke_test.py
```

Drive a campaign (demo mode by default — no real calls dispatched):

```bash
curl -X POST http://localhost:5000/campaign/create \
  -H 'Content-Type: application/json' \
  -d '{"contacts_csv": "id,phone,script\n1,+15550000001,Your appointment is tomorrow at 9am.", "start": "2026-10-20T15:00:00Z", "spread": 45, "max_retries": 3, "retry_interval": 300}'

curl -X POST http://localhost:5000/campaign/watch \
  -H 'Content-Type: application/json' -d '{"retry_interval":
