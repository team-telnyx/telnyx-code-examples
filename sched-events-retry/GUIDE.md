# Scheduled-Events Retry Campaign Desk \u2014 Developer Guide

A step-by-step walkthrough of the `sched-events-retry` sample: how to schedule a
deadline-aware outbound call campaign on Telnyx Assistant Scheduled Events, how
the retry budget actually behaves, and how to reconstruct what happened to every
single call from the `call_attempts` ledger.

This guide assumes you have read `README.md` for the high-level overview. Here we
go deep on the mechanics, the retry clock, and the forensics.

---

## 1. What you are building

Every outbound-call campaign owner asks the same three questions:

1. **How do I retry no-answers?** \u2014 the platform should retry busy / no-answer /
   failed / canceled outcomes for me, without me writing a scheduler.
2. **When exactly does the next attempt fire?** \u2014 is it `original_schedule +
   interval`, or `last_attempt + interval`? The answer changes your deadline math.
3. **How do I reconstruct what happened?** \u2014 I need a per-call ledger, not a
   single terminal status.

This sample answers all three with a runnable campaign and a forensic report. It
composes four pieces:

| Piece | File | Responsibility |
| --- | --- | --- |
| Scheduler | `create_campaign.py` | One `phone_call` scheduled event per contact, each with its own retry budget |
| Platform | Telnyx Scheduled Events service | Owns dispatch, retry scheduling, and attempt recording |
| Watcher | `watch_campaign.py` | Polls events, rebuilds the attempt ledger, verifies the retry clock |
| Report | `report.py` | Offline scorecard: reached / retry-N / dead-letter |

The **event** \u2014 not the campaign \u2014 is the unit of retry. Campaign-level
orchestration lives in the scripts, not in the platform.

---

## 2. Prerequisites

- Python 3.10+
- A Telnyx account with an **AI Assistant** already created (you need its
  `assistant_id`)
- A Telnyx phone number to use as the outbound caller (`telnyx_agent_target`)
- A Telnyx API key

Install dependencies:

```bash
pip install -r requirements.txt
```

---

## 3. Environment setup

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Purpose | Example |
| --- | --- | --- |
| `TELNYX_API_KEY` | API key for all REST calls | `KEY0123456789...` |
| `TELNYX_ASSISTANT_ID` | Assistant the events are attached to | `assistant-abc123` |
| `TELNYX_FROM_NUMBER` | Outbound caller (`telnyx_agent_target`) | `+1555XXXXXXXX` |
| `TELNYX_SIP_REGION` | Optional region pin for the outbound leg | `us-east` |
| `TELNYX_API_BASE` | API base URL (override for testing) | `https://api.telnyx.com/v2` |
| `DEMO_MODE` | `true` = print payloads, no real calls | `true` |

### Demo mode vs live mode

**Demo mode is the default** (`DEMO_MODE=true`). In demo mode:

- `create_campaign.py` prints the exact JSON payload it *would* POST and
  generates fake `demo-*` event IDs. No calls are placed, no charges incurred.
- `watch_campaign.py` prints a notice and exits the poll loop immediately \u2014
  there are no live events to observe.
- `report.py` still runs and prints a scorecard from whatever manifest and
  dead-letter file exist.

To run against the real API, set `DEMO_MODE=false` in your `.env` and make sure
`TELNYX_API_KEY` and `TELNYX_ASSISTANT_ID` are populated. `create_campaign.py`
refuses to run in live mode without both.

---

## 4. The retry semantics you are encoding

These come straight from the Scheduled Events docs and are encoded as constants
in `create_campaign.py` so the sample is self-documenting:

```python
MAX_RETRIES_MIN, MAX_RETRIES_MAX = 0, 10
RETRY_INTERVAL_MIN, RETRY_INTERVAL_MAX = 60, 86400
```

- `max_retries_client_errors: 0` \u2192 **1 total attempt**
- `max_retries_client_errors: 3` \u2192 **up to 4 total attempts**
- `max_retries_client_errors: 10` \u2192 **up to 11 total attempts**
- `retry_interval_secs` must be between **60 and 86400** seconds.
- The two fields **must move together** \u2014 setting one without the other is a
  `400`.
- Retry fields are **phone-call only**. Setting them on an `sms_chat` event is a
  `400`.

The retryable `call_status` values are `busy`, `no-answer`, `failed`, and
`canceled`. After a terminal attempt at time `T`, the retry clock **restarts**:
the next attempt fires at `T + retry_interval_secs`, *not* at
`original_schedule + retry_interval_secs`. This is the single most important
behavior the watcher verifies.

---

## 5. Step 1 \u2014 `create_campaign.py`

### 5.1 Loading and validating contacts

`load_contacts()` reads `contacts.csv` and enforces the required columns:

```csv
name,phone
Ada Lovelace,+15551230001
Grace Hopper,+15551230002
```

`validate_retry_budget()` enforces the documented bounds and the move-together
rule before any request is made \u2014 you get a clear `ValueError` instead of a
cryptic `400` from the API.

### 5.2 Building the payload

`build_payload()` assembles one scheduled event per contact:

```python
{
  "telnyx_conversation_channel": "phone_call",
  "telnyx_end_user_target": contact["phone"],
  "telnyx_agent_target": FROM_NUMBER,
  "scheduled_at_fixed_datetime": "2026-10-20T15:00:00Z",
  "text": "Hi Ada, this is a reminder from the campaign desk.",
  "conversation_metadata": {
    "campaign_id": "camp-1a2b3c4d",
    "contact_name": "Ada Lovelace"
  },
  "max_retries_client_errors": 3,
  "retry_interval_secs": 300,
  "call_settings": { "sip_region": "us-east" }
}
```

The `conversation_metadata` block is how the watcher later filters events down to
*this* campaign \u2014 the platform does not have a campaign object, so attribution
is your job.

### 5.3 The SMS guard

`demonstrate_sms_guard()` sends the same payload with
`telnyx_conversation_channel: "sms_chat"` and retry fields set. The API returns
`400`, which the script catches and prints:

```
[guard] \u2705 Got expected 400: [{'code': '...', 'detail': 'retry fields are only supported for phone_call'}]
```

This is the runnable proof of the phone-call-only constraint. In demo mode the
request is skipped and the constraint is printed instead.

### 5.4 Staggering the schedule

Contacts are spread evenly across the `--spread` window:

```python
step = timedelta(minutes=args.spread) / max(len(contacts), 1)
scheduled_at = start + step * idx
```

This matters more than it looks. If you schedule 50 contacts at the same
instant, the watcher sees a thundering herd of simultaneous attempt cycles and
the ledger output is unreadable. Spreading them interleaves the attempt cycles
so you can actually watch retries fire.

### 5.5 Running it

```bash
python create_campaign.py \
  --contacts contacts.csv \
  --start "2026-10-20T15:00:00Z" \
  --spread 45 \
  --max-retries 3 \
  --retry-interval 300
```

The script writes `campaign_manifest.json`:

```json
{
  "campaign_id": "camp-1a2b3c4d",
  "events": [
    { "event_id": "evt-...", "name": "Ada Lovelace", "phone": "+15551230001" }
  ]
}
```

That manifest is the handoff to the watcher.

---

## 6. Step 2 \u2014 `watch_campaign.py`

### 6.1 Why polling

Scheduled Events has **no webhook surface**. There is no callback to register
and no event stream to subscribe to. Polling `GET .../scheduled_events` is the
documented way to observe them. The watcher polls every 30 seconds.

If you find yourself hunting for a webhook that does not exist \u2014 stop. Poll.

### 6.2 The poll loop

Each cycle:

1. `list_events()` \u2014 `GET .../scheduled_events?page[size]=250`, then filter to
   events whose `conversation_metadata.campaign_id` matches the manifest.
2. For each event, `get_event(event_id)` \u2014 `GET .../scheduled_events/{event_id}`
   to pull the full `call_attempts` ledger.
3. Print any status transition (`pending` \u2192 dispatched \u2192 terminal).
4. Print the per-attempt ledger.
5. Verify the retry clock.
6. Dead-letter exhausted-budget events; record `conversation_id` on completion.

### 6.3 The attempt ledger

Once `call_attempts` is populated, the watcher prints each attempt:

```
  ledger for evt-abc123 (3 attempt(s)):
    #1 2026-10-20T15:00:00Z status=no-answer dur=0s ccid=v3:...
    #2 2026-10-20T15:05:12Z status=busy dur=0s ccid=v3:...
    #3 2026-10-20T15:10:31Z status=completed dur=42s ccid=v3:...
```

Each `AssistantScheduledCallAttempt` carries `attempt_number`, `attempted_at`,
`call_status`, `call_duration`, and `telnyx_call_control_id`. This array is the
forensics source \u2014 everything the report knows comes from here.

### 6.4 Verifying the retry clock

`verify_retry_clock()` is the heart of the sample:

```python
for prev, nxt in zip(attempts, attempts[1:]):
    prev_at = parse_ts(prev["attempted_at"])
    next_at = parse_ts(nxt["attempted_at"])
    earliest = prev_at.timestamp() + retry_interval
    if next_at.timestamp() < earliest:
        violations.append(...)
```

It asserts that each attempt fires at **at least** the previous attempt's time
plus `retry_interval_secs`. If the platform were using
`original_schedule + interval` semantics, attempt #2 in the ledger above would
have fired at `15:05:00` (schedule + 300s) rather than `15:05:12` (attempt #1 +
300s). The assertion catches that distinction and fails loudly:

```
  \u274c RETRY CLOCK VIOLATION: attempt 2 fired 2026-10-20T15:01:00Z before 2026-10-20T15:00:00Z + 300s
```

The watcher exits with code `1` if any violation is detected, so it is safe to
wire into CI.

### 6.5 Dead-lettering and completion

- When an event's status is `failed` **and** it carries an `errors` entry
  (retry budget exhausted), the watcher appends a row to `dead_letter.csv`:
  `event_id, contact, attempts, final_call_status`.
- When an attempt's `call_status` is `completed` and it carries a
  `conversation_id`, the watcher prints it so you can follow up with the
  transcript.

### 6.6 Running it

```bash
python watch_campaign.py --retry-interval 300
```

Use `--once` to poll a single time and exit \u2014 useful for CI and smoke runs.

---

## 7. Step 3 \u2014 `report.py`

The report is offline: it reads `campaign_manifest.json` and `dead_letter.csv`
and computes the scorecard. No API calls.

`build_scorecard()` produces:

```python
{
  "campaign_id": "camp-1a2b3c4d",
  "total_events": 50,
  "dead_lettered": 7,
  "cancelled": 43,
  "failures_by_status": {"no-answer": 5, "busy": 2},
  "attempts_observed": 21,
}
```

Note the split: **dead-lettered** events are the ones that exhausted their retry
budget; **cancelled** events are everything else that did not dead-letter
(including contacts you removed from the CSV and cancelled via `DELETE`). A
cancelled event is *not* a failure and is counted separately.

Run it:

```bash
python report.py
```

```
Campaign scorecard \u2014 camp-1a2b3c4d
====================================================
  total events          : 50
  dead-lettered         : 7
  cancelled (not failed): 43
  attempts observed     : 21
  final failures by call_status:
    busy         2
    no-answer    5
```

---

## 8. Cancelling events (teardown)

Contacts removed from the CSV after creation should be cancelled before
dispatch:

```bash
curl -X DELETE \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  "https://api.telnyx.com/v2/ai/assistants/$TELNYX_ASSISTANT_ID/scheduled_events/$EVENT_ID"
```

Cancelled events are counted as `cancelled` in the report, never as failures.
This is the documented teardown path for a campaign you no longer want to run.

---

## 9. `app.py` \u2014 the dispatcher

`app.py` is a thin help-dispatcher. It does not implement any workflow. Running
it prints the three workflow steps and their typical run order:

```bash
python app.py
```

The `WORKFLOW` list at the top of the module is the single source of truth for
which scripts exist, and `smoke_test.py` asserts that list matches the shipped
files.

---

## 10. Testing

```bash
python -m pytest smoke_test.py -v
```

The smoke tests verify:

- Every workflow module imports cleanly and exposes `_main()`.
- `app.py` advertises exactly the three workflow scripts.
- `validate_retry_budget()` enforces the 0\u201310 / 60\u201386400 bounds and the
  move-together rule.
- `verify_retry_clock()` flags attempts that fire too early and passes attempts
  that respect the interval.
- `build_scorecard()` separates dead-letters from cancelled events.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `400` on create | Retry fields on an `sms_chat` event | Use `telnyx_conversation_channel: "phone_call"` |
| `400` on create | Only one of the two retry fields set | Set both `max_retries_client_errors` and `retry_interval_secs` |
| `ValueError: max_retries_client_errors must be 0-10` | Out-of-range budget | Clamp to 0\u201310 |
| `ValueError: retry_interval_secs must be 60-86400` | Interval too short/long | Clamp to 60\u201386400 |
| Watcher never sees events | `DEMO_MODE=true` | Set `DEMO_MODE=false` |
| Watcher sees no events | `conversation_metadata.campaign_id` mismatch | Re-run `create_campaign.py`; the manifest holds the ID |
| `RETRY CLOCK VIOLATION` | Attempt fired before `prev + interval` | Investigate \u2014 this is the assertion the sample exists to make |

---

## 12. Next steps

- [Scheduled events guide](https://developers.telnyx.com/docs/inference/ai-assistants/scheduled-events)
- [Create a scheduled event](https://developers.telnyx.com/api-reference/assistants/create-a-scheduled-event)
- [List scheduled events](https://developers.telnyx.com/api-reference/assistants/list-scheduled-events)
- [Get a scheduled event](https://developers.telnyx.com/api-reference/assistants/get-a-scheduled-event)
- [Delete a scheduled event](https://developers.telnyx.com/api-reference/assistants/delete-a-scheduled-event)

Once you have the campaign running, the natural extensions are:

- **Transcript follow-up** \u2014 the watcher already prints `conversation_id` on
  completion; pipe those into your CRM.
- **Dead-letter replay** \u2014 re-schedule the contacts in `dead_letter.csv` with a
  fresh campaign ID and a larger budget.
- **Alerting** \u2014 wire the watcher's exit code into your CI or a cron job so a
  retry-clock violation pages you.
