These endpoints are optional backend extension points. The direct assistant demo can run with a Telnyx phone number assigned to the AI Assistant and does not require a local webhook.

## `POST /webhooks/voice`

Receives Telnyx Call Control webhooks. On inbound calls, the app answers and starts the configured Telnyx AI Assistant.

### Events Handled

| Event | Action |
|---|---|
| `call.initiated` | Answers an incoming call |
| `call.answered` | Starts the AI Assistant |
| `call.hangup` | Clears in-memory call state |
| `call.conversation.ended` | Clears in-memory call state |

## `POST /tools/verify_patient_identity`

Verifies full name and date of birth against `data/patients.json`.

### Request

```json
{
  "full_name": "maya rivera",
  "date_of_birth": "1984-11-22",
  "caller_phone": "+15555550101"
}
```

### Response `200`

```json
{
  "verified": true,
  "patient_id": "pat_1002",
  "patient_display_name": "M*** R***",
  "caller_phone": "+15555550101"
}
```

## `POST /tools/get_latest_lab_result`

Returns the latest mock result for a verified patient.

### Request

```json
{
  "patient_id": "pat_1002"
}
```

### Response `200`

```json
{
  "patient_id": "pat_1002",
  "result_id": "res_cbc_003",
  "panel": "complete blood count",
  "date": "2026-04-02",
  "urgency": "normal",
  "plain_language_summary": "your complete blood count from april 2 is back and within the expected range.",
  "provider_note": "no follow-up needed.",
  "business_hours": true
}
```

## `POST /tools/send_secure_results_link`

Sends an SMS containing only a secure portal link and expiry notice.

## `POST /tools/warm_transfer_to_nurse`

Returns nurse transfer metadata and records a minimum necessary audit event.

## `POST /tools/queue_after_hours_callback`

Queues a 30-minute after-hours nurse callback for abnormal results.

## `POST /tools/transfer_to_front_desk`

Returns front desk transfer metadata when verification fails or routing is ambiguous.

## `POST /dynamic-variables`

Returns clinic-specific assistant variables.

## `GET /results/audit`

Returns recent masked workflow audit events.

## `GET /results/callbacks`

Returns recent after-hours callback queue items.

## `GET /health`

Returns service status.
