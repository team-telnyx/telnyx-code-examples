---
name: email-schedule-rescheduler
title: "Email Schedule Rescheduler"
description: "Schedule an email, reschedule it to a new future time, and verify invalid reschedule attempts are rejected with a 422 error."
language: python
framework: flask
telnyx_products: [Email]
---

# Email Schedule Rescheduler

Schedule an email, reschedule it to a new future time, and verify that invalid reschedule attempts are rejected with a 422 error.

## The Story

A hospital's patient communications coordinator needs to send appointment reminders and lab result notifications at precise times. Sometimes a patient reschedules, or a clinic session runs late, and the coordinator must push a scheduled email to a later time without cancelling and recreating it — a mistake here could mean a patient misses a critical follow-up appointment. The actor IS the email schedule rescheduler. It is born when a new email is scheduled with a future delivery timestamp, evolves when the coordinator adjusts the delivery time to a new future moment, and survives the rejection of invalid attempts to reschedule to the past — the platform refuses to send an email that was meant to go out hours ago. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides the AI Communications Infrastructure that powers this email scheduling workflow, giving developers a reliable API to create, reschedule, and verify scheduled emails with confidence.

## Telnyx API Endpoints Used

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/email_messages` | Create a scheduled email with a future `scheduled_at` timestamp |
| PATCH | `/v2/email_messages/{id}/schedule` | Reschedule an email to a new future time |
| GET | `/v2/email_messages/{id}` | Retrieve the email to confirm the updated `scheduled_at` value |
| DELETE | `/v2/email_messages/{id}/schedule` | Cancel the scheduled email (cleanup only) |

## Architecture

The sample is a single Python script that runs the four demo steps sequentially. It uses the Telnyx Python SDK for creating and retrieving email messages, and raw HTTP PATCH for the reschedule call (the SDK does not expose a patch-schedule method). The script supports a safe demo mode (default) that logs requests without hitting the API, and a live mode that makes real API calls.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        email-schedule-rescheduler                    │
│                                                                     │
│  ┌─────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │  Step 1     │    │  Step 2          │    │  Step 3           │  │
│  │  Schedule   │───▶│  Reschedule      │───▶│  Invalid          │  │
│  │  Email      │    │  (PATCH)         │    │  Reschedule (422) │  │
│  └─────────────┘    └──────────────────┘    └───────────────────┘  │
│         │                     │                     │              │
│         ▼                     ▼                     ▼              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Step 4: Verify scheduled_at via GET                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                          │
│         ▼                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Cleanup: DELETE schedule (cancel the email)                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Telnyx Email API (api.telnyx.com/v2)                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_EMAIL_FROM` | `string` | `your_telnyx_email_from_here` | **yes** | TELNYX_EMAIL_FROM | — |
| `TELNYX_EMAIL_TO` | `string` | `your_telnyx_email_to_here` | **yes** | TELNYX_EMAIL_TO | — |

## Setup

1. **Clone the repository** (if you haven't already):

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/email-schedule-rescheduler
   ```

2. **Create a `.env` file** from the example:

   ```bash
   cp .env.example .env
   ```

3. **Edit `.env`** and fill in your values:

   ```bash
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_EMAIL_FROM=your_telnyx_email_from_here
   TELNYX_EMAIL_TO=your_telnyx_email_to_here
   DEMO_MODE=true
   ```

4. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

5. **Run the sample**:

   ```bash
   python app.py
   ```

   By default, the sample runs in demo mode (`DEMO_MODE=true`) and prints the requests it would make without hitting the API. To run against the live Telnyx API, set `DEMO_MODE=false` in your `.env` file.

## API Reference

### `POST /v2/email_messages`

Creates a scheduled email message.

**Request body:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | `string` | Sender email address |
| `to` | `string` | Recipient email address |
| `subject` | `string` | Email subject |
| `text_body` | `string` | Plain-text email body |
| `scheduled_at` | `string` | ISO 8601 UTC timestamp for the future delivery time |

**Response:** `202 Accepted` with a message ID.

### `PATCH /v2/email_messages/{id}/schedule`

Reschedules an email to a new future time.

**Request body:**

| Field | Type | Description |
|-----------|------|-------------|
| `scheduled_at` | `string` | ISO 8601 UTC timestamp for the new delivery time |

**Response:** `200 OK` with the updated message data.

### `GET /v2/email_messages/{id}`

Retrieves an email message by ID.

**Response:** `200 OK` with the message data, including the current `scheduled_at` value.

### `DELETE /v2/email_messages/{id}/schedule`

Cancels a scheduled email message.

**Response:** `200 OK` on success.

## Troubleshooting

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| `TELNYX_API_KEY is required when DEMO_MODE=false` | The API key is not set in the environment | Set `TELNYX_API_KEY` in your `.env` file |
| `TELNYX_EMAIL_FROM and TELNYX_EMAIL_TO are required in live mode` | Sender/recipient addresses are missing | Set `TELNYX_EMAIL_FROM` and `TELNYX_EMAIL_TO` in your `.env` file |
| `ERROR: Failed to schedule email` | Invalid API key or invalid email addresses | Verify your credentials and email addresses |
| `ERROR: reschedule failed with status 422` | Attempted to reschedule to a past or invalid timestamp | Use a future timestamp for rescheduling |
| `FAIL: expected 422, got <status>` | The API did not reject the invalid timestamp | Verify the timestamp is in the past and the request format is correct |

## Agent Discovery

- [Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI on GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Email Sender](https://github.com/team-telnyx/telnyx-code-examples/tree/main/email-sender)
- [Email Webhook Handler](https://github.com/team-telnyx/telnyx-code-examples/tree/main/email-webhook-handler)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx Email API Reference](https://developers.telnyx.com/docs/messaging/email/send-email)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Product Page](https://telnyx.com)
- [Telnyx Pricing](https://telnyx.com/pricing)
