# API Reference — Edge Cron Scheduler

This document describes the HTTP endpoints exposed by the Telnyx Edge Cron Scheduler sample. The scheduler runs as a Telnyx Edge Agent, using `this.every()` for periodic polling, KV for the job registry, SQL for execution logging, and the Telnyx SMS API for failure notifications.

---

## Endpoints

### `GET /health`

Health check endpoint. Returns the current status of the scheduler agent, including the number of registered jobs and the last poll timestamp.

#### Request

No request body.

#### Example Request

```bash
curl -X GET https://<your-edge-app>.telnyx.run/health
```

#### Response — `200 OK`

| Field             | Type    | Description                                      |
|-------------------|---------|--------------------------------------------------|
| `status`          | string  | Always `"ok"`                                    |
| `agent`           | string  | Agent identifier                                 |
| `job_count`       | number  | Number of jobs currently registered in KV        |
| `last_poll`       | string  | ISO 8601 timestamp of the last scheduler poll    |
| `demo_mode`       | boolean | Whether the scheduler is running in demo mode    |

```json
{
  "status": "ok",
  "agent": "edge-cron-scheduler",
  "job_count": 3,
  "last_poll": "2025-01-15T10:30:00.000Z",
  "demo_mode": true
}
```

---

### `GET /jobs`

Lists all jobs currently registered in the KV job registry.

#### Request

No request body.

#### Example Request

```bash
curl -X GET https://<your-edge-app>.telnyx.run/jobs
```

#### Response — `200 OK`

| Field  | Type     | Description                              |
|--------|----------|------------------------------------------|
| `jobs` | array    | Array of job objects (see below)         |

Each job object:

| Field           | Type    | Description                                                        |
|-----------------|---------|--------------------------------------------------------------------|
| `id`            | string  | Unique job identifier                                              |
| `name`          | string  | Human-readable job name                                            |
| `type`          | string  | Job type: `"call"`, `"sms"`, or `"webhook"`                        |
| `cron`          | string  | Cron expression (e.g., `"*/5 * * * *"`)                            |
| `enabled`       | boolean | Whether the job is active                                          |
| `last_run`      | string  | ISO 8601 timestamp of the last execution (or `null`)               |
| `next_run`      | string  | ISO 8601 timestamp of the next scheduled run                       |
| `config`        | object  | Job-specific configuration (e.g., phone numbers, URLs)             |

```json
{
  "jobs": [
    {
      "id": "job_001",
      "name": "Daily SMS Reminder",
      "type": "sms",
      "cron": "0 9 * * *",
      "enabled": true,
      "last_run": "2025-01-15T09:00:00.000Z",
      "next_run": "2025-01-16T09:00:00.000Z",
      "config": {
        "to": "+1555XXXXXXXX",
        "message": "This is a scheduled reminder."
      }
    }
  ]
}
```

---

### `POST /jobs`

Creates a new job in the KV registry.

#### Request Body

| Field     | Type    | Required | Description                                                        |
|-----------|---------|----------|--------------------------------------------------------------------|
| `name`    | string  | Yes      | Human-readable job name                                            |
| `type`    | string  | Yes      | Job type: `"call"`, `"sms"`, or `"webhook"`                        |
| `cron`    | string  | Yes      | Cron expression (5-field format)                                   |
| `enabled` | boolean | No       | Whether the job is active (default: `true`)                        |
| `config`  | object  | Yes      | Job-specific configuration                                         |

**Job type `config` schemas:**

- **`sms`**: `{ "to": "+1555XXXXXXXX", "message": "string" }`
- **`call`**: `{ "to": "+1555XXXXXXXX", "from": "+1555XXXXXXXX" }`
- **`webhook`**: `{ "url": "https://example.com/webhook", "method": "POST", "payload": "object" }`

#### Example Request

```bash
curl -X POST https://<your-edge-app>.telnyx.run/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hourly Webhook Ping",
    "type": "webhook",
    "cron": "0 * * * *",
    "enabled": true,
    "config": {
      "url": "https://example.com/webhook",
      "method": "POST",
      "payload": { "event": "ping" }
    }
  }'
```

#### Response — `201 Created`

| Field     | Type    | Description                              |
|-----------|---------|------------------------------------------|
| `id`      | string  | Unique job identifier                    |
| `name`    | string  | Job name                                 |
| `type`    | string  | Job type                                 |
| `cron`    | string  | Cron expression                          |
| `enabled` | boolean | Whether the job is active                |
| `config`  | object  | Job configuration                        |
| `created` | string  | ISO 8601 creation timestamp              |

```json
{
  "id": "job_002",
  "name": "Hourly Webhook Ping",
  "type": "webhook",
  "cron": "0 * * * *",
  "enabled": true,
  "config": {
    "url": "https://example.com/webhook",
    "method": "POST",
    "payload": { "event": "ping" }
  },
  "created": "2025-01-15T10:30:00.000Z"
}
```

#### Response — `400 Bad Request`

| Field     | Type   | Description                              |
|-----------|--------|------------------------------------------|
| `error`   | string | Error message                            |
| `details` | string | Additional validation details            |

```json
{
  "error": "Invalid job configuration",
  "details": "Missing required field: config.to"
}
```

---

### `GET /jobs/{id}`

Retrieves a single job by its ID.

#### Request

No request body.

#### Path Parameters

| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `id`      | string | Yes      | Job identifier           |

#### Example Request

```bash
curl -X GET https://<your-edge-app>.telnyx.run/jobs/job_001
```

#### Response — `200 OK`

Same schema as a single job object in `GET /jobs`.

#### Response — `404 Not Found`

| Field   | Type   | Description                              |
|---------|--------|------------------------------------------|
| `error` | string | `"Job not found"`                        |

```json
{
  "error": "Job not found"
}
```

---

### `DELETE /jobs/{id}`

Deletes a job from the KV registry.

#### Request

No request body.

#### Path Parameters

| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `id`      | string | Yes      | Job identifier           |

#### Example Request

```bash
curl -X DELETE https://<your-edge-app>.telnyx.run/jobs/job_001
```

#### Response — `204 No Content`

No response body.

#### Response — `404 Not Found`

| Field   | Type   | Description                              |
|---------|--------|------------------------------------------|
| `error` | string | `"Job not found"`                        |

```json
{
  "error": "Job not found"
}
```

---

### `GET /logs`

Retrieves the execution log from the SQL database.

#### Request

No request body.

#### Query Parameters

| Parameter | Type   | Required | Description                                      |
|-----------|--------|----------|--------------------------------------------------|
| `limit`   | number | No       | Maximum number of log entries to return (default: 50, max: 200) |
| `status`  | string | No       | Filter by status: `"success"`, `"failure"`, or `"pending"` |

#### Example Request

```bash
curl -X GET "https://<your-edge-app>.telnyx.run/logs?limit=10&status=failure"
```

#### Response — `200 OK`

| Field  | Type   | Description                              |
|--------|--------|------------------------------------------|
| `logs` | array  | Array of log entry objects (see below)   |

Each log entry:

| Field       | Type    | Description                                      |
|-------------|---------|--------------------------------------------------|
| `id`        | string  | Log entry identifier                             |
| `job_id`    | string  | Associated job identifier                        |
| `job_name`  | string  | Job name at time of execution                    |
| `job_type`  | string  | Job type: `"call"`, `"sms"`, or `"webhook"`      |
| `started_at`| string  | ISO 8601 timestamp when execution started        |
| `completed_at`| string | ISO 8601 timestamp when execution completed      |
| `status`    | string  | `"success"`, `"failure"`, or `"pending"`         |
| `result`    | string  | Execution result summary or error message        |
| `sms_sent`  | boolean | Whether an SMS notification was sent             |

```json
{
  "logs": [
    {
      "id": "log_001",
      "job_id": "job_001",
      "job_name": "Daily SMS Reminder",
      "job_type": "sms",
      "started_at": "2025-01-15T09:00:00.000Z",
      "completed_at": "2025-01-15T09:00:02.000Z",
      "status": "success",
      "result": "SMS sent to +1555XXXXXXXX",
      "sms_sent": false
    }
  ]
}
```

---

### `POST /webhooks/telnyx`

Inbound webhook handler for Telnyx events (e.g., SMS delivery status, call events). Verifies the Ed25519 signature using `client.webhooks.unwrap`.

#### Request

No request body (payload is provided by Telnyx).

#### Headers

| Header                     | Type   | Required | Description                              |
|----------------------------|--------|----------|------------------------------------------|
| `Telnyx-Signature-Ed25519` | string | Yes      | Ed25519 signature header                 |
| `Telnyx-Timestamp`         | string | Yes      | Unix timestamp of the event              |
| `Content-Type`             | string | Yes      | Must be `application/json`               |

#### Example Request

```bash
curl -X POST https://<your-edge-app>.telnyx.run/webhooks/telnyx \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: 1705312200" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "id": "msg_001",
        "event_type": "message.sent",
        "to": "+1555XXXXXXXX",
        "from": "+1555XXXXXXXX"
      }
    }
  }'
```

#### Response — `200 OK`

| Field    | Type   | Description                              |
|----------|--------|------------------------------------------|
| `status` | string | Always `"received"`                      |

```json
{
  "status": "received"
}
```

#### Response — `401 Unauthorized`

| Field   | Type   | Description                              |
|---------|--------|------------------------------------------|
| `error` | string | `"Invalid signature"`                    |

```json
{
  "error": "Invalid signature"
}
```

---

## Status Codes Summary

| Status Code | Description                                      |
|-------------|--------------------------------------------------|
| `200`       | Successful request with response body            |
| `201`       | Resource created successfully                    |
| `204`       | Resource deleted successfully (no body)          |
| `400`       | Bad request — invalid input or validation error  |
| `401`       | Unauthorized — invalid webhook signature         |
| `404`       | Resource not found                               |
| `500`       | Internal server error                            |

---

## Scheduler Behavior

The scheduler agent polls the KV job registry every 60 seconds via `this.every('1m')`. For each job whose `cron` expression indicates it is due, the agent queues an `execute` task using `this.queue('execute', job)`. Upon completion, the result is logged to the SQL database. If a job fails and `demo_mode` is `false`, an SMS notification is sent via `this.env.TELNYX.messages.send()`.

In demo mode (default), no real SMS or calls are placed — the scheduler logs what would happen. To switch to live mode, set `DEMO_MODE=false` in the environment.
