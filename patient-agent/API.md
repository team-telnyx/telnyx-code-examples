# API Reference — PatientAgent

The PatientAgent Edge Function exposes no public HTTP routes. It is a **stateful agent** that runs on Telnyx Edge, driven by scheduled wake-ups and inbound SMS webhooks. All interaction is asynchronous via the Telnyx Messaging API.

---

## Webhook Endpoint

### `POST /webhook`

Receives inbound SMS messages from patients. The agent unwraps the Telnyx Ed25519 signature, extracts the message payload, and routes it to the appropriate `PatientAgent` instance based on the sender's phone number.

#### Request Body Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `data` | object | Yes | Telnyx event envelope |
| `data.event_id` | string | Yes | Unique event identifier |
| `data.payload` | object | Yes | The messaging payload |
| `data.payload.from` | object | Yes | Sender info |
| `data.payload.from.phone_number` | string | Yes | Patient's phone number (E.164) |
| `data.payload.to` | object | Yes | Recipient info |
| `data.payload.to.phone_number` | string | Yes | Telnyx phone number |
| `data.payload.text` | string | Yes | Patient's reply text |
| `data.payload.message_id` | string | Yes | Unique message ID |
| `data.signature` | string | Yes | Ed25519 signature header |
| `data.timestamp` | string | Yes | ISO 8601 timestamp |

#### Example Request (curl)

```bash
curl -X POST https://<edge-function-url>/webhook \
  -H "Content-Type: application/json" \
  -H "Telnyx-Signature-Ed25519: <signature>" \
  -H "Telnyx-Timestamp: <timestamp>" \
  -d '{
    "data": {
      "event_id": "evt_123",
      "timestamp": "2024-01-15T10:30:00Z",
      "payload": {
        "message_id": "msg_abc",
        "from": { "phone_number": "+15551234567" },
        "to": { "phone_number": "+15559999999" },
        "text": "I need to reschedule my appointment"
      }
    }
  }'
```

#### Response Schema

**200 OK**

```json
{
  "status": "processed",
  "patient_id": "patient-42",
  "action": "appointment_reschedule_requested"
}
```

#### Status Codes

| Code | Description |
|---|---|
| 200 | Webhook processed successfully |
| 400 | Invalid payload or missing required fields |
| 401 | Signature verification failed |
| 500 | Internal agent error (logged, not leaked) |

---

## Scheduled Wake-Up (Internal)

The agent uses `this.schedule()` and `this.every()` to self-wake at predetermined intervals. These are **not HTTP endpoints** — they are internal Edge Function timer triggers managed by the Agent SDK.

### Wake-Up Events

| Schedule | Trigger | Agent Action |
|---|---|---|
| `every(24h)` | Daily check-in | Send "How are you feeling?" SMS |
| `schedule("2024-01-16T09:00:00Z")` | Appointment reminder | SMS 24h before appointment |
| `schedule("2024-01-17T14:00:00Z")` | Missed appointment follow-up | SMS "Need to reschedule?" |
| `schedule("2024-01-19T08:00:00Z")` | Medication reminder | SMS "Time for your prescription" |

### Wake-Up Response Schema

**200 OK** (internal)

```json
{
  "status": "wake_processed",
  "patient_id": "patient-42",
  "trigger": "daily_checkin",
  "actions_taken": ["sms_sent"]
}
```

---

## Nurse Escalation (Human-in-the-Loop)

When the agent detects a symptom escalation via LLM inference, it pauses and waits for a nurse response. This is handled via a **KV store flag** that the agent polls on each wake-up.

### Escalation Flow

1. Agent sets `KV.put("escalation:patient-42", "pending")` and sends SMS to nurse
2. Nurse replies via a separate Telnyx number → triggers `/webhook`
3. Agent reads nurse response, relays to patient, schedules follow-up

#### KV Schema

| Key Pattern | Value | TTL |
|---|---|---|
| `escalation:{patient_id}` | `"pending"` / `"resolved"` / `"nurse_response:{text}"` | 24h |
| `patient:{patient_id}:state` | JSON blob of patient state | 7d |
| `patient:{patient_id}:appointments` | JSON array of appointments | 30d |
| `patient:{patient_id}:med_schedule` | JSON array of medication times | 30d |

---

## EHR API Integration (Mock)

The agent reads/writes appointment data via a mock FHIR-compatible API. In demo mode, this is an in-memory store; in live mode, it calls the real EHR endpoint.

### Mock EHR Endpoints (Internal)

| Method | Path | Description |
|---|---|---|
| `GET` | `/ehr/appointments?patient={id}` | Fetch patient appointments |
| `POST` | `/ehr/appointments` | Create new appointment |
| `PUT` | `/ehr/appointments/{id}` | Update appointment status |

#### Appointment Object Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Appointment ID |
| `patient_id` | string | Yes | Patient identifier |
| `datetime` | string | Yes | ISO 8601 datetime |
| `status` | string | Yes | `scheduled` / `missed` / `completed` / `cancelled` |
| `provider` | string | Yes | Provider name |
| `location` | string | No | Clinic location |

---

## Outbound SMS (via Telnyx SDK)

All SMS is sent through `telnyx.messages.create()`. In demo mode, messages are logged but not sent (dry-run). In live mode, real SMS is dispatched.

### Message Creation Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `from` | string | Yes | Telnyx phone number (E.164) |
| `to` | string | Yes | Patient phone number (E.164) |
| `text` | string | Yes | Message body (max 1600 chars) |
| `status_callback` | string | No | Webhook URL for delivery status |

#### Example (SDK call, not HTTP)

```typescript
await telnyx.messages.create({
  from: "+15559999999",
  to: "+15551234567",
  text: "Your appointment is tomorrow at 2 PM. Reply YES to confirm."
});
```

---

## LLM Inference (Symptom Assessment)

The agent uses `this.env.TELNYX.ai.openai.chat.createCompletion()` to assess patient symptoms from free-text replies.

### Inference Request Schema

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | Yes | OpenAI model (e.g., `gpt-3.5-turbo`) |
| `messages` | array | Yes | Conversation history |
| `messages[].role` | string | Yes | `system` / `user` / `assistant` |
| `messages[].content` | string | Yes | Message text |
| `max_tokens` | number | No | Default 150 |
| `temperature` | number | No | Default 0.3 |

### Inference Response Schema

| Field | Type | Description |
|---|---|---|
| `choices[0].message.content` | string | LLM response (JSON: `{ "escalate": boolean, "reasoning": string }`) |
| `usage.total_tokens` | number | Token consumption |

---

## Error Handling

All errors are caught and logged via `console.error()`. HTTP responses never leak internal details.

| Scenario | HTTP Response | Logged |
|---|---|---|
| Invalid webhook signature | 401 | Yes |
| Missing payload fields | 400 | Yes |
| Agent processing error | 500 | Yes (stack trace) |
| Telnyx API failure | 500 | Yes |
| KV store unavailable | 500 | Yes |
