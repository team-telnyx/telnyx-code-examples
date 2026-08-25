# API Reference

This document describes the HTTP API exposed by the `edge-cron-scheduler` sample. All endpoints return JSON responses.

**Base URL:** `http://localhost:5000` (configurable via the `PORT` environment variable)

---

## Health Check

### `GET /health`

Returns the health status of the application.

**Response Schema:**

| Status Code | Response Body |
|-------------|---------------|
| 200 | `{ "status": "healthy", "timestamp": "<ISO-8601 timestamp>" }` |

**Example Request:**

```bash
curl -X GET http://localhost:5000/health
```

**Example Response (200):**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T14:30:00.123456"
}
```

---

## Jobs

### `GET /jobs`

Lists all registered jobs.

**Response Status 200:**

| Field | Type | Description |
|-------|------|-------------|
| `jobs` | array | List of job objects |
| `jobs[].id` | string | Unique job identifier |
| `jobs[].name` | string | Human-readable job name |
| `jobs[].type` | string | Job type: `call`, `sms`, or `webhook` |
| `jobs[].interval` | integer | Scheduling interval value |
| `jobs[].unit` | string | Scheduling interval unit: `seconds`, `minutes`, `hours`, or `days` |
| `jobs[].next_run` | string (ISO-8601) | Next scheduled execution time |

**Example Request:**

```bash
curl -X GET http://localhost:5000/jobs
```

**Example Response (200):**

```json
{
  "jobs": [
    {
      "id": "job_1",
      "name": "Daily Check-in Call",
      "type": "call",
      "interval": 5,
      "unit": "minutes",
      "next_run": "2025-01-15T14:35:00.123456"
    },
    {
      "id": "job_2",
      "name": "Hourly Reminder SMS",
      "type": "sms",
      "interval": 1,
      "unit": "hours",
      "next_run": "2025-01-15T15:30:00.123456"
    }
  ]
}
```

---

### `POST /jobs`

Creates a new scheduled job.

**Request Body Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable job name |
| `type` | string | Yes | Job type: `call`, `sms`, or `webhook` |
| `interval` | integer | Yes | Interval between executions |
| `unit` | string | Yes | Interval unit: `seconds`, `minutes`, `hours`, or `days` |
| `to_number` | string | Conditional | Destination phone number (required for `call` and `sms` types) |
| `from_number` | string | No | Sender phone number (defaults to `TELNYX_FROM_NUMBER` env var) |
| `message` | string | Conditional | Message text (required for `sms` type) |
| `webhook_url` | string | Conditional | Webhook URL (required for `webhook` type) |
| `payload` | object | No | JSON payload to send to webhook (defaults to `{}`) |

**Response Status 201:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique job identifier |
| `message` | string | Success message |

**Response Status 400:**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message describing the validation failure |

**Example Request — Create a Call Job:**

```bash
curl -X POST http://localhost:5000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Follow-up Call",
    "type": "call",
    "interval": 10,
    "unit": "minutes",
    "to_number": "+15551234567",
    "from_number": "+15559876543"
  }'
```

**Example Response (201):**

```json
{
  "id": "job_3",
  "message": "Job created successfully"
}
```

**Example Request — Create an SMS Job:**

```bash
curl -X POST http://localhost:5000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Reminder",
    "type": "sms",
    "interval": 1,
    "unit": "days",
    "to_number": "+15551234567",
    "message": "Don't forget your appointment tomorrow!"
  }'
```

**Example Request — Create a Webhook Job:**

```bash
curl -X POST http://localhost:5000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Status Webhook",
    "type": "webhook",
    "interval": 30,
    "unit": "minutes",
    "webhook_url": "https://example.com/webhook",
    "payload": {"source": "edge-cron-scheduler"}
  }'
```

**Example Error Response (400):**

```json
{
  "error": "SMS jobs require to_number and message"
}
```

---

### `DELETE /jobs/{job_id}`

Deletes a registered job.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `job_id` | string | Unique job identifier |

**Response Status 200:**

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | Success message |

**Response Status 404:**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message indicating the job was not found |

**Example Request:**

```bash
curl -X DELETE http://localhost:5000/jobs/job_3
```

**Example Response (200):**

```json
{
  "message": "Job deleted successfully"
}
```

**Example Error Response (404):**

```json
{
  "error": "Job not found"
}
```

---

### `POST /jobs/{job_id}/run`

Runs a job immediately, regardless of its schedule.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `job_id` | string | Unique job identifier |

**Response Status 200:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Execution result: `success` or `failed` |
| `call_id` | string | Call SID (only for `call` type jobs on success) |
| `message_id` | string | Message SID (only for `sms` type jobs on success) |
| `status_code` | integer | HTTP status code (only for `webhook` type jobs on success) |
| `error` | string | Error message (only when `status` is `failed`) |

**Response Status 404:**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message describing the job was not found |

**Example Request:**

```bash
curl -X POST http://localhost:5000/jobs/job_1/run
```

**Example Response (200) — Success:**

```json
{
  "status": "success",
  "call_id": "c8e9f0a1-b2c3-4d5e-6f7a-8b9c0d1e2f3a"
}
```

**Example Response (200) — Failure:**

```json
{
  "status": "failed",
  "error": "Call job requires to_number and from_number"
}
```

**Example Error Response (404):**

```json
{
  "error": "Job not found"
}
```

---

## Execution Logs

### `GET /executions`

Returns the most recent 100 execution log entries, ordered by execution time (newest first).

**Response Status 200:**

| Field | Type | Description |
|-------|------|-------------|
| `executions` | array | List of execution log entries |
| `executions[].id` | integer | Log entry ID |
| `executions[].job_id` | string | Job identifier |
| `executions[].job_name` | string | Job name |
| `executions[].job_type` | string | Job type: `call`, `sms`, or `webhook` |
| `executions[].executed_at` | string (ISO-8601) | Execution timestamp |
| `executions[].status` | string | Execution result: `success` or `failed` |
| `executions[].details` | object/null | Additional execution details (e.g., call ID, message ID, error message) |

**Example Request:**

```bash
curl -X GET http://localhost:5000/executions
```

**Example Response (200):**

```json
{
  "executions": [
    {
      "id": 1,
      "job_id": "job_1",
      "job_name": "Daily Check-in Call",
      "job_type": "call",
      "executed_at": "2025-01-15T14:30:00.123456",
      "status": "success",
      "details": {
        "call_id": "c8e9f1a1-b2c3-4d5e-6f7a-8b9c0d1e2f3a"
      }
    },
    {
      "id": 2,
      "job_id": "job_2",
      "job_name": "Hourly Reminder SMS",
      "job_type": "sms",
      "executed_at": "2025-01-15T14:00:00.123456",
      "status": "failed",
      "details": "Invalid 'To' number"
    }
  ]
}
```

---

## Telnyx Webhook

### `POST /webhooks/telnyx`

Receives and processes Telnyx webhook events. The request must include a valid Telnyx Ed25519 signature in the `Telnyx-Signature-Ed25519` header and a `Telnyx-Timestamp` header.

**Request Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `Telnyx-Signature-Ed25519` | Yes | Ed25519 signature for webhook verification |
| `Telnyx-Timestamp` | Yes | Timestamp used for signature verification |

**Request Body:**

The raw request body is the Telnyx webhook payload. It is verified against the signature before processing.

**Response Status 200:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `received` |

**Response Status 400:**

| Field | Type | Description |
|-------|------|-------------|
| `error` | string | Error message indicating invalid webhook signature |

**Example Request:**

```bash
curl -X POST http://localhost:5000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <unix_timestamp>" \
  -d '{
    "data": {
      "event_type": "message.received",
      "payload": {
        "text": "Hello from Telnyx",
        "from": {
          "phone_number": "+15551234567"
        }
      }
    }
  }'
```

**Example Response (200):**

```json
{
  "status": "received"
}
```

**Example Error Response (400):**

```json
{
  "error": "Invalid webhook signature"
}
```

---

## Status Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Request succeeded |
| `201` | Resource created successfully |
| `400` | Invalid request body or missing required fields |
| `404` | Resource not found |
| `500` | Internal server error |
