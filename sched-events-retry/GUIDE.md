# Scheduled-Events Retry Campaign Desk — A Guided Tour

This guide walks you through `sched-events-retry`, a Flask app that runs a deadline-aware outbound reminder campaign on Telnyx Assistant **Scheduled Events**, then reconstructs exactly what happened to every call from the `call_attempts` ledger.

By the end you will understand:

- How to schedule one phone-call event per contact with a retry budget.
- Why `max_retries_client_errors` and `retry_interval_secs` must move together, and why they are phone-call-only.
- How the retry clock actually restarts (hint: `now + retry_interval_secs`, **not** original schedule + interval).
- How to rebuild a per-attempt forensic ledger from a polling watcher.
- How to turn that ledger into a delivery scorecard with first-attempt vs retry-N reach and a dead-letter list.

---

## 1. Prerequisites

- Python 3.10+
- A Telnyx account with an **AI Assistant** already created (you need its `assistant_id`).
- A Telnyx phone number you own, in E.164 format, to use as the outbound caller (`telnyx_agent_target`).
- A Telnyx API key with access to the Assistants / Scheduled Events surface.

You do **not** need a public webhook URL. Scheduled Events has no webhook surface — the watcher polls. This is documented behavior, not a shortcut.

---

## 2. Environment setup

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

The app reads these variables (all loaded via `python-dotenv` at import time, near the top of `app.py`):

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `TELNYX_API_KEY` | yes (live) | — | Telnyx API key. Never logged. |
| `TELNYX_ASSISTANT_ID` | yes (live) | — | The assistant that owns the scheduled events. |
| `TELNYX_FROM_NUMBER` | yes (live) | `+1555XXXXXXXX` | Outbound caller (`telnyx_agent_target`). |
| `TELNYX_SIP_REGION` | no | `us-east` | Region pin for the outbound leg (`call_settings.sip_region`). |
| `CAMPAIGN_ID` | no | `campaign-demo` | Tag written into `conversation_metadata` for attribution. |
| `DEMO_MODE` | no | `true` | When true, no real API calls are made. |
| `STATE_DIR` | no | `.campaign_state` | Where the created-events list, ledger, and dead-letter file are written. |
| `PORT` | no | `5000` | Flask bind port. |

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Demo mode vs live mode

**Demo mode is the default.** With `DEMO_MODE=true`:

- `create_campaign` fabricates `demo-<contact>-<n>` event IDs instead of calling the API.
- The SMS guard probe is *simulated* — it reports the 400 shape without issuing the request.
- The watcher records every event as `pending` with an empty attempt list.
- Teardown reports every event as cancelled without calling `DELETE`.

This means you can run the whole flow end-to-end, see the JSON shapes, and read the report logic without placing a single call or spending a cent.

**To go live**, set `DEMO_MODE=false` in `.env` and make sure `TELNYX_API_KEY`, `TELNYX_ASSISTANT_ID`, and `TELNYX_FROM_NUMBER` are real. From that point on:

- `POST /campaign/create` issues real `POST /v2/ai/assistants/{assistant_id}/scheduled_events` calls.
- The SMS guard probe issues a real `sms_chat` create and expects a real `400`.
- The watcher issues real `GET` calls and reads real `call_attempts`.
- Teardown issues real `DELETE` calls.

> **Live mode places real outbound calls.** Point it at a test contact list first.

---

## 4. The retry semantics, encoded as constants

Near the top of `app.py` you'll find the constants that encode the Scheduled Events retry contract:

```python
MAX_RETRIES_MIN = 0
MAX_RETRIES_MAX = 10
RETRY_INTERVAL_MIN = 60
RETRY_INTERVAL_MAX = 86400
RETRYABLE_CALL_STATUSES = {"busy", "no-answer", "failed", "canceled"}
TERMINAL_EVENT_STATUSES = {"completed", "failed", "canceled"}
```

Read them as the rules:

- `max_retries_client_errors` is **0–10 retries on top of the initial dispatch**. `0` means one total attempt; `3` means up to four; `10` means up to eleven.
- `retry_interval_secs` is **60–86400 seconds**.
- The two must be **set together**. One without the other is a `400`.
- Only `busy`, `no-answer`, `failed`, and `canceled` are retryable call outcomes.
- After a terminal attempt at time `T`, the next attempt fires at **`T + retry_interval_secs`** — the clock restarts from the attempt, not from the original schedule.

`validate_retry_fields()` (in the validation section of `app.py`) enforces the bounds and the "move together" rule before any API call is made, so you get a clean `ValueError` instead of a round-trip `400`.

---

## 5. Step 1 — Create the campaign

Route: `POST /campaign/create`
CLI equivalent: `python app.py create --contacts contacts.csv --start 2026-10-20T15:00:00Z --spread 45`

The request body takes a `contacts_csv` string (the raw CSV), a `start` ISO timestamp, a `spread` in minutes, and the retry budget:

```json
{
  "contacts_csv": "id,phone,script\nc1,+15551230001,Hi it's your reminder\nc2,+15551230002,...",
  "start": "2026-10-20T15:00:00Z",
  "spread": 45,
  "max_retries": 3,
  "retry_interval": 300
}
```

### 5a. Spreading the schedule

`spread_schedule()` (in the schedule-helper section) takes the start time, the contact count, and the spread window, and returns one ISO timestamp per contact, evenly spaced:

```python
step = timedelta(minutes=spread_minutes) / (count - 1)
```

Why spread at all? If you schedule 200 contacts at the same instant you get a thundering herd — every retry cycle fires in lockstep and the watcher can't tell you anything interesting. Spacing them across the window interleaves the attempt cycles so the ledger reads like a real campaign.

### 5b. The phone-call-only guard

Before creating any real events, `create_campaign()` fires a probe: the *same* create call, but with `telnyx_conversation_channel: "sms_chat"` and the retry fields attached. The API rejects this with a `400` because retry fields are phone-call-only. The script catches that `400` and records it in the response under `sms_guard`:

```python
except telnyx.APIStatusError as exc:  # expected 400
    sms_guard = {"status": exc.status_code, "detail": "retry fields rejected on sms_chat"}
```

In demo mode the probe is simulated so you still see the shape:

```json
"sms_guard": { "status": 400, "demo": true, "detail": "retry fields are phone-call only (simulated in demo mode)" }
```

This is the sample proving the constraint rather than just documenting it.

### 5c. Creating the events

For each contact, `create_campaign()` builds a payload and calls `telnyx.AssistantScheduledEvent.create(...)`, which maps to `POST /v2/ai/assistants/{assistant_id}/scheduled_events`:

```python
payload = {
    "telnyx_conversation_channel": "phone_call",
    "telnyx_end_user_target": contact["phone"],
    "telnyx_agent_target": FROM_NUMBER,
    "scheduled_at_fixed_datetime": when,
    "text": contact.get("script", "Hello, this is a reminder from your provider."),
    "conversation_metadata": {"campaign_id": CAMPAIGN_ID, "contact_id": contact.get("id", "")},
    "max_retries_client_errors": max_retries,
    "retry_interval_secs": retry_interval,
    "call_settings": {"sip_region": SIP_REGION},
}
```

Notes on the fields:

- `telnyx_conversation_channel: "phone_call"` is what makes the retry fields legal.
- `telnyx_end_user_target` is the contact's number; `telnyx_agent_target` is your caller ID.
- `scheduled_at_fixed_datetime` is the absolute dispatch time from `spread_schedule()`.
- `text` is the call script the assistant speaks.
- `conversation_metadata` carries your campaign attribution — this is how the report later ties events back to a campaign.
- `call_settings.sip_region` pins the outbound leg to a region.

The created event IDs are written to `STATE_DIR/created_events.json` so the watcher, report, and teardown can find them later.

---

## 6. Step 2 — Watch and build the ledger

Route: `POST /campaign/watch`
CLI equivalent: `python app.py watch`

Scheduled Events has **no webhook surface**. The documented way to observe them is to poll `GET /v2/ai/assistants/{assistant_id}/scheduled_events`. The watcher is therefore a polling loop — but exposed as a route that runs **one poll cycle per invocation**, so you can drive it from cron, a shell loop, or `curl` without a background thread.

`watch_once()` (in the watcher section) does four things per cycle:

### 6a. List and fetch

`_list_events()` walks the paginated list endpoint:

```python
page = telnyx.AssistantScheduledEvent.list(assistant_id=ASSISTANT_ID)
while True:
    events.extend(getattr(page, "data", []) or [])
    if not getattr(page, "has_next_page", False):
        break
    page = page.next_page()
```

For each event in `created_events.json`, `_get_event()` fetches the single-event detail — this is where `call_attempts` lives:

```python
telnyx.AssistantScheduledEvent.retrieve(event_id, assistant_id=ASSISTANT_ID)
```

### 6b. The attempt ledger

Each entry in `call_attempts` is an `AssistantScheduledCallAttempt` with:

- `attempt_number` — 1 for the initial dispatch, 2+ for retries.
- `attempted_at` — the wall-clock time the attempt fired.
- `call_status` — `completed`, `busy`, `no-answer`, `failed`, `canceled`, etc.
- `call_duration` — seconds.
- `telnyx_call_control_id` — the Call Control ID, useful for cross-referencing with Call Control events.

The watcher stores the whole array per event in `STATE_DIR/ledger.json`. That file *is* the forensic record.

### 6c. Asserting the clock-restart semantics

This is the part that answers "when exactly does the next attempt fire?" `_assert_clock_restart()` walks consecutive attempts and, for any attempt whose `call_status` is retryable, checks that the next attempt fired at least `retry_interval_secs` later:

```python
if t_next < t_prev + timedelta(seconds=retry_interval):
    violations.append(
        f"attempt {nxt.get('attempt_number')} fired {t_next - t_prev} after "
        f"attempt {prev.get('attempt_number')} (< {retry_interval}s)")
```

The comparison is against the **previous attempt's** `attempted_at`, not the original schedule. That is the whole point: the retry clock restarts at `now + retry_interval_secs` after each terminal attempt. If the platform ever regressed to "original schedule + interval," this assertion would fire and the watcher would log it loudly via `app.logger.error`.

Violations are returned in the response and logged. They are not swallowed.

### 6d. Dead-lettering

When an event's status is `failed` and it carries an `errors` entry (the retry-budget-exhausted signal), the watcher appends the contact to `STATE_DIR/dead_letter.json` with its final `call_status`:

```python
if event.get("status") == "failed" and event.get("errors"):
    dead_letter.append({
        "scheduled_event_id": event_id,
        "contact_id": entry.get("contact_id"),
        "final_call_status": attempts[-1].get("call_status") if attempts else None,
        "errors": event.get("errors"),
    })
```

When an event completes, the watcher records its `conversation_id` in the ledger so you can pull the transcript afterward.

---

## 7. Step 3 — The report

Route: `GET /campaign/report`
CLI equivalent: `python app.py report`

`build_report()` (in the report section) reads `ledger.json` and `created_events.json` and produces the campaign scorecard:

```json
{
  "campaign_id": "campaign-demo",
  "total_events": 200,
  "reached_first_attempt": 141,
  "reached_on_retry": 38,
  "final_failures_by_call_status": { "no-answer": 12, "busy": 6, "failed": 3 },
  "cancelled": 0,
  "total_attempts": 271
}
```

How each number is computed:

- **`reached_first_attempt`** — events whose last attempt is `completed` and whose attempt list has length 1.
- **`reached_on_retry`** — events whose last attempt is `completed` and whose attempt list has length > 1. This is the number that justifies the retry budget.
- **`final_failures_by_call_status`** — events whose last attempt is *not* `completed`, bucketed by that final `call_status`.
- **`cancelled`** — events whose status is `canceled`. These are counted separately and are **not** failures — a contact you deliberately pulled from the list is not a delivery failure.
- **`total_attempts`** — the sum of every attempt across every event. Compare this to `total_events * (max_retries + 1)` to see how much of the budget you actually spent.

---

## 8. Step 4 — Teardown

Route: `POST /campaign/teardown`
CLI equivalent: `python app.py teardown`

`teardown()` reads `created_events.json` and issues `DELETE /v2/ai/assistants/{assistant_id}/scheduled_events/{event_id}` for each event:

```python
telnyx.AssistantScheduledEvent.delete(event_id, assistant_id=ASSISTANT_ID)
```

Events that have not yet dispatched are cancelled before they fire. Events already in flight are unaffected. In demo mode the deletes are skipped and every event is reported as cancelled.

---

## 9. The contacts CSV

`contacts.csv` is a plain CSV with three columns:

```csv
id,phone,script
c1,+15551230001,"Hi, this is a reminder that your appointment is tomorrow at 10am."
c2,+15551230002,"Hi, this is a reminder that your appointment is tomorrow at 2pm."
```

- `id` — your internal contact identifier; written into `conversation_metadata.contact_id` and used in the dead-letter file.
- `phone` — E.164. Never logged in full; `_mask()` truncates to `+15***01` for any log line.
- `script` — optional; the assistant speaks this text. Falls back to a generic reminder.

Removing a contact from the CSV after creation and re-running teardown is how you exercise the `cancelled` path in the report.

---

## 10. Running the app

Start the Flask server:

```bash
python app.py
```

Then drive the four flows:

```bash
# 1. Create the campaign (demo mode by default)
curl -s -X POST http://localhost:5000/campaign/create \
  -H 'Content-Type: application/json' \
  -d "$(python -c 'import json,sys; print(json.dumps({"contacts_csv": open("contacts.csv").read(), "start": "2026-10-20T15:00:00Z", "spread": 45, "max_retries": 3, "retry_interval": 300}))')"

# 2. Poll once (run this on a loop, e.g. every 30s)
curl -s -X POST http://localhost:5000/campaign/watch \
  -H 'Content-Type: application/json' -d '{"retry_interval": 300}'

# 3. Read the scorecard
curl -s http://localhost:5000/campaign/report

# 4. Cancel everything
curl -s -X POST http://localhost:5000/campaign/teardown
```

Or run the smoke test to confirm the module loads and the routes are wired:

```bash
python smoke_test.py
```

---

## 11. What to look for in the output

- **`sms_guard.status` is 400.** That's the phone-call-only constraint, proven.
- **`violations` is empty.** That's the clock-restart semantics holding: every retry fired at least `retry_interval_secs` after the previous terminal attempt.
- **`reached_on_retry` is non-zero.** That's the retry budget earning its keep — calls that would have been lost on a single attempt.
- **`dead_letter.json` entries carry a `final_call_status`.** That's the forensic answer to "what happened to the ones we never reached."
- **`cancelled` is separate from `final_failures_by_call_status`.** A pulled contact is not a failed delivery.

---

## 12. Next steps

- [Scheduled events guide](https://developers.telnyx.com/docs/inference/ai-assistants/scheduled-events) — the retry semantics this sample encodes.
- [Create a scheduled event](https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event) — full field reference for the create payload.
- [List scheduled events](https://developers.telnyx.com/api-reference/assistants/list-scheduled-events) — pagination details for the watcher.
- [Get a scheduled event](https://developers.telnyx.com/api-reference/assistants/get-a-scheduled-event) — the `call_attempts` shape.
- [Delete a scheduled event](https://developers.telnyx.com/api-reference/assistants/delete-a-scheduled-event) — cancellation semantics.
- [AI Assistants overview](https://developers.telnyx.com/docs/inference/ai-assistants) — how assistants, conversations, and scheduled events fit together.

Once you've run the campaign, the natural extensions are: feed `dead_letter.json` back into a fresh campaign with a longer `retry_interval_secs`, pull transcripts for every `conversation_id` the watcher recorded, and wire the watcher into a cron job so the ledger stays current without you babysitting it.
