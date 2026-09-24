# Email Schedule Rescheduler — Telnyx Code Sample Guide

## Overview

This guide walks you through the `email-schedule-rescheduler` sample, a Python utility that demonstrates how to schedule an email, reschedule it to a new future time, and verify that invalid reschedule attempts are rejected with a 422 error.

The sample is built around the Telnyx Email API and shows how you can dynamically adjust the delivery time of already-scheduled emails without cancelling and recreating them — improving flexibility for time-sensitive notifications.

---

## Prerequisites

Before running this sample, you'll need:

- **Python 3.8+** installed on your machine
- A **Telnyx account** with an API key (for live mode)
- A **verified sender email address** in your Telnyx account (for live mode)
- A **recipient email address** to receive the scheduled email (for live mode)

---

## Environment Setup

### 1. Clone the repository and navigate to the sample

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/email-schedule-rescheduler
```

### 2. Create a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure environment variables

Copy the `.env.example` file to `.env` and fill in your values:

```bash
cp .env.example .env
```

The sample reads the following environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `TELNYX_API_KEY` | Your Telnyx API key | Yes (live mode) |
| `TELNYX_EMAIL_FROM` | Verified sender email address | Yes (live mode) |
| `TELNYX_EMAIL_TO` | Recipient email address | Yes (live mode) |
| `DEMO_MODE` | Set to `true` (default) for safe demo mode, `false` for live mode | No |

---

## Demo Mode vs Live Mode

### Demo Mode (default — safe)

By default, the sample runs in **demo mode** (`DEMO_MODE=true`). In this mode:

- **No API calls are made** — no emails are scheduled, rescheduled, or cancelled
- The script prints what requests it *would* make, showing the exact HTTP method, URL, and payload
- No Telnyx credentials are required
- No charges are incurred

This is the safest way to explore the sample and understand the flow.

### Live Mode

To run against the real Telnyx API, set `DEMO_MODE=false` in your `.env` file:

```
DEMO_MODE=false
TELNYX_API_KEY=your_real_api_key
TELNYX_EMAIL_FROM=sender@example.com
TELNYX_EMAIL_TO=recipient@example.com
```

**Important:** In live mode, the sample will actually schedule an email, reschedule it, and then cancel it during cleanup. Make sure you're using valid addresses and understand that the email will be scheduled (though cancelled before delivery).

---

## How the Sample Works

The sample is a single runnable script (`app.py`) that executes four sequential demo steps, plus a cleanup step. Let's walk through each part.

### Configuration and Initialization

The script begins by loading environment variables and configuring the Telnyx SDK:

- `TELNYX_API_KEY` — authenticates all Telnyx API calls
- `TELNYX_EMAIL_FROM` / `TELNYX_EMAIL_TO` — sender and recipient addresses
- `DEMO_MODE` — controls whether the script makes real API calls or just logs them

The SDK is configured with:

```python
telnyx.api_key = TELNYX_API_KEY
```

### Helper Functions

The script includes several helper functions:

- **`_iso_future(minutes)`** — generates an ISO 8601 UTC timestamp `minutes` in the future
- **`_iso_past(minutes)`** — generates an ISO 8601 UTC timestamp `minutes` in the past
- **`_demo_log(message)`** — prints a demo-mode message
- **`_auth_headers()`** — returns the `Authorization: Bearer` header for raw HTTP calls

---

## The Four Demo Steps

### Step 1: Schedule an Email

**Function:** `schedule_email()`

The first step creates a scheduled email using `POST /v2/email_messages` with a future `scheduled_at` timestamp (30 minutes from now).

```python
message = telnyx.EmailMessage.create(
    from_=TELNYX_EMAIL_FROM,
    to=TELNYX_EMAIL_TO,
    subject="Scheduled Email Demo",
    text_body="This email was scheduled and then rescheduled.",
    scheduled_at=scheduled_at,
)
```

The API returns a `202` status with a message ID, which is used in subsequent steps.

**Telnyx primitive used:** Email Sender

---

### Step 2: Reschedule the Email

**Function:** `reschedule_email(message_id, new_scheduled_at)`

The second step reschedules the email to a new future time (60 minutes from now) using `PATCH /v2/email_messages/{id}/schedule`.

**Note:** The Telnyx Python SDK (v4.181.0) exposes `create`, `retrieve`, and `delete_schedule` methods for email messages, but **does not** include a patch-schedule method. The reschedule call is therefore implemented as a raw HTTP PATCH to the documented API endpoint:

```python
url = f"{TELNYX_API_BASE}/email_messages/{message_id}/schedule"
payload = {"scheduled_at": new_scheduled_at}
response = requests.patch(url, json=payload, headers=_auth_headers(), timeout=30)
```

The request body is exactly:

```json
{
  "scheduled_at": "<future ISO 8601 UTC timestamp>"
}
```

A successful reschedule returns a `200` status and updates the message's `scheduled_at` value.

**Telnyx primitive used:** Schedule Manager

---

### Step 3: Attempt an Invalid Reschedule

**Function:** `attempt_invalid_reschedule(message_id)`

The third step attempts to reschedule the email to a **past** timestamp (5 minutes ago) and verifies the API correctly rejects it.

The script makes a PATCH request with the invalid timestamp and asserts:

1. The API returns a **422 status code**
2. The response body contains a **non-empty `errors` array**
3. The **first error entry references the invalid timestamp** (confirming the API explains *why* `scheduled_at` was rejected)

```python
if resp.status_code != 422:
    print(f"FAIL: expected 422, got {resp.status_code}")
    sys.exit(1)

errors = body.get("errors", [])
if not errors:
    print("FAIL: expected non-empty errors array")
    sys.exit(1)

first_error = errors[0]
error_text = str(first_error)
if past_time not in error_text:
    print("FAIL: first error entry does not reference the invalid timestamp")
    sys.exit(1)
```

This explicit 422 rejection prevents accidental immediate sends, enhancing reliability.

**Telnyx primitive used:** Error Validator

---

### Step 4: Verify the Updated Schedule

**Function:** `verify_scheduled_at(message_id, expected_scheduled_at)`

The final step retrieves the message using `GET /v2/email_messages/{id}` and confirms the `scheduled_at` value reflects the successful reschedule from Step 2.

```python
message = telnyx.EmailMessage.retrieve(message_id)
actual = message.scheduled_at
if actual != expected_scheduled_at:
    print(f"FAIL: expected scheduled_at={expected_scheduled_at}, got {actual}")
    sys.exit(1)
```

**Telnyx primitive used:** Email Sender (retrieve)

---

## Cleanup

**Function:** `cleanup_schedule(message_id)`

After the four demo steps complete, the sample cancels the scheduled message so the demo doesn't leave a scheduled email behind:

```python
telnyx.EmailMessage.delete_schedule(message_id)
```

This uses `DELETE /v2/email_messages/{id}/schedule` and is cleanup only — not one of the four demo steps.

---

## Running the Sample

### Demo Mode

```bash
python app.py
```

Expected output:

```
============================================================
Email Schedule Rescheduler Demo
Mode: DEMO (no API calls)
============================================================
Step 1: Scheduling email for 2026-07-28T12:30:00+00:00
[DEMO] POST /v2/email_messages from=sender@example.com to=recipient@example.com scheduled_at=2026-07-28T12:30:00+00:00
[2] Rescheduling email demo-message-id-12345 to 2026-07-28T13:00:00+00:00
[DEMO] PATCH /v2/email_messages/demo-message-id-12345/schedule body={'scheduled_at': '2026-07-28T13:00:00+00:00'}
[3] Attempting invalid reschedule to 2026-07-28T11:55:00+00:00 (expect 422)
[DEMO] PATCH /v2/email_messages/demo-message-id-12345/schedule body={'scheduled_at': '2026-07-28T11:55:00+00:00'} -> would return 422
[4] Verifying scheduled_at for message demo-message-id-12345
[DEMO] GET /v2/email_messages/demo-message-id-12345 -> scheduled_at=2026-07-28T13:00:00+00:00
[cleanup] Cancelling scheduled email demo-message-id-12345
[DEMO] DELETE /v2/email_messages/demo-message-id-12345/schedule

Demo completed successfully.
```

### Live Mode

```bash
DEMO_MODE=false python app.py
```

This will make real API calls. You'll see output like:

```
Step 1: Scheduling email for 2026-07-28T12:30:00+00:00
  -> Scheduled email created with ID: 3fa85f64-5717-4562-b3fc-2c963f66afa6
[2] Rescheduling email 3fa85f64-5717-4562-b3fc-2c963f66afa6 to 2026-07-28T13:00:00+00:00
OK -> Rescheduled. New scheduled_at: 2026-07-28T13:00:00+00:00
[3] Attempting invalid reschedule to 2026-07-28T11:55:00+00:00 (expect 422)
OK: 422 received. Error: scheduled_at must be in the future
[4] Verifying scheduled_at for message 3fa85f64-5717-4562-b3fc-2c963f66afa6
OK: scheduled_at confirmed as 2026-07-28T13:00:00+00:00
[cleanup] Cancelling scheduled email 3fa85f64-5717-4562-b3fc-2c963f66afa6
OK: scheduled email cancelled

Demo completed successfully.
```

---

## Running the Smoke Test

The sample includes a `smoke_test.py` that verifies the module loads correctly:

```bash
python smoke_test.py
```

This test imports `app.py` and verifies it loads without error.

---

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/v2/email_messages` | Create a scheduled email |
| `PATCH` | `/v2/email_messages/{id}/schedule` | Reschedule an email |
| `GET` | `/v2/email_messages/{id}` | Retrieve email details |
| `DELETE` | `/v2/email_messages/{id}/schedule` | Cancel a scheduled email (cleanup) |

---

## Key Design Decisions

1. **Raw HTTP for reschedule:** The Telnyx Python SDK v4.181.0 doesn't expose a patch-schedule method, so the reschedule call uses `requests.patch()` to the documented API endpoint.

2. **Demo mode safety:** The sample defaults to demo mode, which logs the requests it would make without hitting the API. This prevents accidental charges and lets you explore the flow safely.

3. **Environment variables:** All credentials and addresses come from environment variables — never hardcoded.

4. **Error validation:** The invalid-reschedule step asserts both the 422 status code *and* that the error body references the invalid timestamp, confirming the API explains the rejection.

---

## Next Steps

Now that you understand how to schedule and reschedule emails, here are some next steps:

- **Explore the Email API docs:** [Send Email Documentation](https://developers.telnyx.com/docs/messaging/email/send-email)
- **Learn about other messaging primitives:** Check out the Telnyx SMS and MMS APIs for transactional messaging
- **Build a notification system:** Combine scheduled emails with webhooks to create time-sensitive notification workflows
- **Integrate with your stack:** Use the Telnyx SDK in your existing Python applications to add email scheduling capabilities

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `TELNYX_API_KEY is required` | Set `DEMO_MODE=false` and provide a valid API key in `.env` |
| `TELNYX_EMAIL_FROM and TELNYX_EMAIL_TO are required` | Provide valid sender/recipient addresses in `.env` |
| 401 Unauthorized in live mode | Verify your API key is correct and active |
| 422 on valid reschedule | Ensure the `scheduled_at` timestamp is in the future and in ISO 8601 UTC format |
| Email not received | Verify the sender address is verified in your Telnyx account |
