## `POST /tools/create-claim-intake`

Creates a mock auto first notice of loss intake record. Telnyx invokes this endpoint from a Conversational Workflow tool node after the workflow collects the minimum required fields.

### Request

Headers:

```txt
x-tool-secret: dev-secret
content-type: application/json
```

```json
{
  "caller_name": "jane sample",
  "caller_phone": "+15551234567",
  "caller_email": "jane@example.com",
  "policy_number": "pa1234567",
  "loss_type": "auto",
  "loss_date": "2026-06-15",
  "loss_location": "mission street and 5th street, san francisco",
  "loss_description": "rear-ended while stopped",
  "vehicle_year_make_model": "2021 toyota camry",
  "vehicle_drivable": "yes",
  "priority_flag": false,
  "consent_to_continue": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `caller_name` | `string` | **yes** | Caller name captured by the workflow |
| `caller_phone` | `string` | **yes** | Callback number in E.164 format when possible |
| `loss_type` | `string` | **yes** | `auto` for this example |
| `loss_date` | `string` | **yes** | Date or caller-provided approximation |
| `loss_location` | `string` | **yes** | Where the loss happened |
| `loss_description` | `string` | **yes** | Short description of what happened |
| `priority_flag` | `boolean` | **yes** | Set by safety and vehicle-drivable branches |
| `consent_to_continue` | `boolean` | **yes** | Caller confirmed they can safely continue |

### Response `200`

```json
{
  "success": true,
  "claim_intake_id": "aci_123",
  "priority_flag": false,
  "next_step": "claims team follow-up"
}
```

### Response `422`

```json
{
  "success": false,
  "error": "missing_required_fields",
  "missing_fields": ["caller_phone", "loss_location"]
}
```

**Try it:**

```bash
curl -X POST http://localhost:8787/tools/create-claim-intake \
  -H "content-type: application/json" \
  -H "x-tool-secret: dev-secret" \
  -d '{
    "caller_name": "jane sample",
    "caller_phone": "+15551234567",
    "loss_type": "auto",
    "loss_date": "2026-06-15",
    "loss_location": "mission street and 5th street, san francisco",
    "loss_description": "rear-ended while stopped",
    "priority_flag": false,
    "consent_to_continue": true
  }'
```

---

## `POST /tools/log-claim-intake-fallback`

Records a fallback when the caller is not reporting an auto claim, information is too incomplete, the caller asks for a person, or the primary claim tool cannot be used.

### Request

```json
{
  "reason": "missing_required_fields",
  "summary": "caller started an auto claim but could not provide the loss location",
  "caller_name": "jane sample",
  "caller_phone": "+15551234567"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | `string` | **yes** | Why the fallback path was used |
| `summary` | `string` | **yes** | Human-readable summary for review |
| `caller_name` | `string` | no | Caller name if collected |
| `caller_phone` | `string` | no | Callback number if collected |

### Response `200`

```json
{
  "success": true,
  "fallback_reference_id": "acf_123",
  "next_step": "claims team manual review"
}
```

---

## `POST /tools/flag-priority-follow-up`

Creates a mock priority follow-up task for urgent cases after an intake or fallback reference exists.

### Request

```json
{
  "claim_intake_id": "aci_123",
  "caller_phone": "+15551234567",
  "priority_reasons": ["injury_reported"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `claim_intake_id` | `string` | conditional | Required unless `fallback_reference_id` is present |
| `fallback_reference_id` | `string` | conditional | Required unless `claim_intake_id` is present |
| `caller_phone` | `string` | **yes** | Callback number for follow-up |
| `priority_reasons` | `array` | no | Reasons set by workflow branches |

### Response `200`

```json
{
  "success": true,
  "priority_task_id": "apt_123",
  "priority_status": "queued",
  "priority_reasons": ["injury_reported"]
}
```

---

## `GET /health`

Liveness check for local development and tunnel testing.

### Response `200`

```json
{
  "status": "ok",
  "service": "claim_intake_tools"
}
```
