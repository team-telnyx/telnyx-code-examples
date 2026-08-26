---
name: edge-cron-scheduler
title: "Edge Cron Scheduler with Telnyx"
description: "A Flask-based cron scheduler that executes scheduled calls, SMS messages, and webhooks using Telnyx APIs, with job registry, execution logging, and failure notifications."
language: python
framework: flask
telnyx_products: [Call Control, Messaging, Webhooks]
---

# Edge Cron Scheduler with Telnyx

A Flask-based cron scheduler that executes scheduled calls, SMS messages, and webhooks using Telnyx APIs, with a job registry, execution logging, and SMS failure notifications.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build reliable, programmable communication workflows. This sample demonstrates how to schedule and automate calls, SMS messages, and webhooks with Telnyx's powerful APIs, enabling you to build intelligent, event-driven communication systems that scale with your business.

## Telnyx API Endpoints Used

- **POST /v2/calls** — Initiate outbound calls via Telnyx Call Control
- **POST /v2/messages** — Send SMS messages via Telnyx Messaging API
- **Webhooks** — Receive and verify Telnyx events (e.g., `message.received`) with Ed25519 signature verification

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Flask Application                          │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │   Cron       │    │   Job Registry   │    │  Execution Logs  │  │
│  │  Scheduler   │───▶│     (KV)         │    │   (SQLite DB)    │  │
│  │  this.every()│    │  JOB_REGISTRY    │    │  execution_logs  │  │
│  └──────────────┘    └──────────────────┘    └──────────────────┘  │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Job Executor                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │
│  │  │ Call Job │  │ SMS Job  │  │ Webhook  │  │ Failure SMS  │  │  │
│  │  │          │  │          │  │ Job      │  │ Notification │  │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                        REST API                              │  │
│  │  /health  /jobs  /jobs/<id>  /jobs/<id>/run  /executions    │  │
│  │  /webhooks/telnyx                                            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DB_PATH` | `string` | `your_db_path_here` | **yes** | DB_PATH | — |
| `FAILURE_NOTIFICATION_NUMBER` | `string` | `your_failure_notification_number_here` | **yes** | FAILURE_NOTIFICATION_NUMBER | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `SAMPLE_CALL_TO_NUMBER` | `string` | `your_sample_call_to_number_here` | **yes** | SAMPLE_CALL_TO_NUMBER | — |
| `SAMPLE_SMS_TO_NUMBER` | `string` | `your_sample_sms_to_number_here` | **yes** | SAMPLE_SMS_TO_NUMBER | — |
| `SAMPLE_WEBHOOK_URL` | `string` | `your_sample_webhook_url_here` | **yes** | SAMPLE_WEBHOOK_URL | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_CONNECTION_ID` | `string` | `your_telnyx_connection_id_here` | **yes** | TELNYX_CONNECTION_ID | — |
| `TELNYX_FROM_NUMBER` | `string` | `your_telnyx_from_number_here` | **yes** | TELNYX_FROM_NUMBER | — |

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/edge-cron-scheduler
   ```

2. **Create and configure your `.env` file**

   Copy the `.env.example` file to `.env` and fill in your credentials:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your actual values:

   ```
   TELNYX_API_KEY=your_telnyx_api_key_here
   TELNYX_CONNECTION_ID=your_telnyx_connection_id_here
   TELNYX_FROM_NUMBER=+1234567890
   FAILURE_NOTIFICATION_NUMBER=+1234567890
   SAMPLE_CALL_TO_NUMBER=+1234567890
   SAMPLE_SMS_TO_NUMBER=+1234567890
   SAMPLE_WEBHOOK_URL=https://your-webhook-endpoint.com/hook
   DB_PATH=execution_logs.db
   PORT=5000
   ```

3. **Install dependencies**

   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**

   ```bash
   python app.py
   ```

   The server will start on `http://localhost:5000` (or the port specified in your `.env`).

## API Reference

### Health Check

- **GET** `/health` — Returns the health status of the service.

### Jobs

- **GET** `/jobs` — List all registered jobs.
- **POST** `/jobs` — Create a new job.
- **DELETE** `/jobs/<job_id>` — Delete a job.
- **POST** `/jobs/<job_id>/run` — Run a job immediately.

### Executions

- **GET** `/executions` — List execution logs (last 100).

### Webhooks

- **POST** `/webhooks/telnyx` — Handle incoming Telnyx webhooks (with Ed25519 signature verification).

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| `TELNYX_API_KEY` not found | Missing environment variable | Ensure `.env` file exists and contains the key |
| Call/SMS jobs fail | Invalid phone numbers or missing connection ID | Verify `TELNYX_CONNECTION_ID` and phone numbers are in E.164 format |
| Webhook signature verification fails | Incorrect webhook secret or malformed payload | Ensure you're using the correct Telnyx webhook secret and the raw request body |
| Database errors | SQLite file permissions or path issues | Check `DB_PATH` is writable and valid |
| Scheduler not running jobs | Scheduler thread not started | Ensure `app.py` runs with `python app.py` (not a WSGI server) |

## Agent Discovery

- **Telnyx Agent Signup**: [https://telnyx.com/agent-signup.md](https://telnyx.com/agent-signup.md)
- **Telnyx AI GitHub**: [https://github.com/team-telnyx/ai](https://github.com/team-telnyx/ai)
- **LLMs.txt**: [https://telnyx.com/llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- **call-control-example** — Basic call control with Telnyx
- **sms-notifications** — SMS notification workflows
- **webhook-handler** — Webhook handling and verification

## Resources

- **Telnyx Developer Documentation**: [https://developers.telnyx.com](https://developers.telnyx.com)
- **Telnyx API Reference**: [https://developers.telnyx.com/api](https://developers.telnyx.com/api)
- **Telnyx Python SDK**: [https://github.com/team-telnyx/telnyx-python](https://github.com/team-telnyx/telnyx-python)
- **Telnyx Product Page**: [https://telnyx.com](https://telnyx.com)
- **Telnyx Pricing**: [https://telnyx.com/pricing](https://telnyx.com/pricing)
