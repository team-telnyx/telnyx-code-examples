# Edge Cron Scheduler API

Base URL for local development: `http://127.0.0.1:8787`. All routes require `Authorization: Bearer <SCHEDULER_TOKEN>` except the dashboard shell and liveness probe. Bodies and responses are JSON unless stated otherwise.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/` | 200 HTML dashboard shell; API data still requires authentication |
| GET | `/health/liveness` | 200 `{status:"ok"}`; process probe only |
| GET | `/health` | 200 `{status, demoMode, jobs, schedules}` or 503 for a task overdue by more than 60 seconds; initializes the durable poller |
| GET | `/jobs` | 200 array of stored jobs |
| POST | `/jobs` | 201 stored job; initializes polling |
| GET | `/jobs/:id` | 200 job or 404 |
| DELETE | `/jobs/:id` | 204 empty response or 404; cancels pending tasks for this job |
| POST | `/jobs/:id/run` | 202 `{runId}`; queued asynchronous manual execution |
| GET | `/logs?limit=100` | 200 newest execution rows; integer limit 1–100 |

## Creating a job

```json
{
  "id": "webhook-check",
  "name": "Five-minute webhook",
  "cron": "*/5 * * * *",
  "type": "webhook",
  "target": "https://example.com/events",
  "payload": {"message": "ping"},
  "dependsOn": [],
  "demoFailure": false
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | Required; 1–64 letters, digits, hyphens or underscores; unique |
| `name` | string | Required; nonempty, at most 120 characters |
| `cron` | string | Required; five-field expression, UTC |
| `type` | `call` / `sms` / `webhook` | Required |
| `target` | string | E.164 phone number for call/SMS; HTTPS URL without credentials for webhook |
| `payload` | object | Optional; `text` supplies SMS content; whole object becomes webhook JSON; call jobs use environment connection/sender |
| `dependsOn` | string[] | Optional; existing job IDs using the identical normalized cron expression |
| `demoFailure` | boolean | Optional; simulates failure in demo mode only |
| `nextRun` | string | Output only; server computes the first future matching UTC time |

Maximum body size is 16 KB and maximum registry size is 100 jobs. A duplicate job ID returns 400; replacement is explicit delete/create. A dependency parent cannot be deleted while referenced. Manual dispatch of a dependent returns 400.

## Execution rows

`run_id` uniquely identifies an occurrence. `job_id` identifies the definition. `scheduled_at`, `started_at` and nullable `finished_at` are ISO UTC strings.

`status` is `running`, `success`, `failure` or `skipped`. Success records API acceptance or simulated execution. `result` describes the outcome. `notification` is `not_needed`, `simulated`, `sent` or `failed`. A `running` row left after interruption is uncertain and is not automatically resent.

## Errors

Errors are `{ "error": "message" }`: 400 validation error, 401 missing/incorrect token, 404 unknown route or missing job, 413 body too large, 500 storage/runtime failure, or 503 missing server token configuration. Unexpected internal errors are logged by the server and omitted from HTTP responses.

No inbound Telnyx webhook route is implemented: the sample records request acceptance, not final delivery. Webhook jobs send outbound HTTPS POSTs with JSON and an `Idempotency-Key` equal to the run ID, a 10-second timeout, exact hostname allowlisting, and redirects disabled.
