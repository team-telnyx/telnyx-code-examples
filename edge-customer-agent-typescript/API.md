# API Reference

Typed endpoint reference for the Customer Agent Edge Compute function.

All `POST /webhooks/*` endpoints receive Telnyx webhook payloads (or Salesforce webhook payloads for `/webhooks/salesforce`). The fetch handler routes by URL path, resolves the actor via `env.AGENT.idFromName(customerPhone)`, and calls the matching actor method.

## Base URL

```
https://<your-edge-function>.telnyx.app
```

## Health

### `GET /health/liveness`

Liveness probe. Returns `200` if the function process is running.

**Response**

```json
{ "status": "ok" }
```

### `GET /health/readiness`

Readiness probe. Returns `200` when the function is ready to serve webhooks.

**Response**

```json
{ "status": "ok" }
```

## API Descriptor

### `GET /`

Returns a JSON descriptor of all endpoints. Useful for agent/CLI discovery.

**Response**

```json
{
  "name": "customer-agent",
  "description": "Entity Agent — the actor IS the customer. Durable across days, channels, and interactions.",
  "endpoints": {
    "POST /webhooks/voice": "Telnyx voice webhook — inbound call → TeXML response",
    "POST /webhooks/call-ended": "Telnyx call-ended webhook — triggers follow-up SMS",
    "POST /webhooks/messaging": "Telnyx messaging webhook — inbound SMS → AI reply",
    "POST /webhooks/salesforce": "Salesforce status change → proactive customer outreach",
    "POST /hitl/reply": "Human-in-the-loop reply → resume agent",
    "GET /health/liveness": "Liveness probe",
    "GET /health/readiness": "Readiness probe"
  }
}
```

## Voice

### `POST /webhooks/voice`

Telnyx Call Control inbound call webhook. The fetch handler extracts `data.payload.from`, resolves the customer's actor, and calls `handleCall()`. Returns TeXML with an `<AIAssistant>` element so the AI Assistant answers the call.

**Request** (Telnyx webhook envelope)

```json
{
  "data": {
    "payload": {
      "call_control_id": "ccc-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "from": "+13125550100",
      "to": "+18005551234",
      "event_type": "call.initiated"
    }
  }
}
```

**Response** — `200 OK` (`Content-Type: application/xml`)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <AIAssistant id="assistant-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" voice="ian">
    Hi Ian, how can I help you today?
  </AIAssistant>
</Response>
```

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "missing 'from' in webhook"}` | `data.payload.from` absent |

**Actor method**: `CustomerAgent.handleCall(callControlId, from, to)`

---

### `POST /webhooks/call-ended`

Telnyx Call Control call-ended webhook. Calls `onCallEnded()` which records the interaction and queues `sendFollowupSMS()` to send a follow-up message.

**Request** (Telnyx webhook envelope)

```json
{
  "data": {
    "payload": {
      "call_control_id": "ccc-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "from": "+13125550100",
      "to": "+18005551234",
      "duration": 142
    }
  }
}
```

**Response**

```json
{ "ok": true }
```

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "missing 'from' in webhook"}` | `data.payload.from` absent |

**Actor methods**: `CustomerAgent.onCallEnded(callControlId, duration)` → `CustomerAgent.sendFollowupSMS()`

## Messaging

### `POST /webhooks/messaging`

Telnyx messaging webhook for inbound SMS. Calls `handleSMS()` which classifies intent, appends to `this.messages`, drafts an LLM reply, sends it back via `this.env.TELNYX.messages.send()`, and records the interaction.

**Request** (Telnyx webhook envelope)

```json
{
  "data": {
    "payload": {
      "from": "+13125550100",
      "to": "+18005551234",
      "text": "Where is my order?",
      "message_type": "MoText"
    }
  }
}
```

**Response**

```json
{ "ok": true }
```

The agent sends the SMS reply asynchronously via the Telnyx Messaging API. The webhook returns `200 OK` immediately so Telnyx does not retry.

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "missing payload"}` | `data.payload` absent |
| `400` | `{"error": "missing 'from' or 'text'"}` | Required fields absent |

**Actor method**: `CustomerAgent.handleSMS(from, to, text)`

If the LLM classifies the SMS as an escalation request, the agent calls `escalateToHuman()` instead of replying directly. See [HITL](#post-hitlreply).

## Salesforce

### `POST /webhooks/salesforce`

Salesforce status-change webhook. Calls `ingestSalesforceUpdate()` which updates the shipment record in agent state, optionally sends a proactive SMS to the customer, and records the interaction.

**Request**

```json
{
  "customer_phone_e164": "+13125550100",
  "salesforce_id": "SF-001",
  "status": "shipped",
  "tracking_number": "1Z999AA10123456784",
  "estimated_delivery": "2026-08-13"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `customer_phone_e164` | `string` | **yes** | E.164 phone number — used to resolve the actor |
| `salesforce_id` | `string` | **yes** | Salesforce shipment ID |
| `status` | `string` | **yes** | New status (e.g. `shipped`, `delayed`, `delivered`) |
| `tracking_number` | `string` | no | Carrier tracking number |
| `estimated_delivery` | `string` | no | ISO date of estimated delivery |

**Response**

```json
{ "ok": true }
```

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "missing customer_phone_e164"}` | Required field absent |

**Actor method**: `CustomerAgent.ingestSalesforceUpdate({ salesforce_id, status, tracking_number?, estimated_delivery? })`

If `state.proactive_consent` is `true`, the agent drafts a proactive SMS via the LLM and sends it to `state.phone_e164`.

## Human-in-the-Loop

### `POST /hitl/reply`

Human reply to an escalated conversation. Calls `resumeEscalation()` which clears `escalation_pending`, appends the human reply to `this.messages`, and forwards the reply to the customer on their preferred channel.

**Request**

```json
{
  "phone_e164": "+13125550100",
  "reply_text": "I authorized the refund. You should see it in 3-5 business days."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `phone_e164` | `string` | **yes** | Customer E.164 — resolves the actor |
| `reply_text` | `string` | **yes** | Human agent's reply text |

**Response**

```json
{ "ok": true }
```

**Errors**

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{"error": "missing phone_e164 or reply_text"}` | Required field absent |

**Actor method**: `CustomerAgent.resumeEscalation(replyText)`

If `state.escalation_pending` is `false` the call is a no-op. If `state.preferred_channel === "sms"` the reply is sent to the customer via `this.env.TELNYX.messages.send()`.

## Actor Methods (internal)

These methods are called by the fetch handler via `env.AGENT.idFromName(phone).<method>()`. They are not directly HTTP-exposed — the fetch handler is the only caller.

| Method | Called From | Purpose |
|--------|-------------|---------|
| `handleCall(callControlId, from, to)` | `POST /webhooks/voice` | Returns TeXML with AI Assistant; records interaction (AC2) |
| `onCallEnded(callControlId, duration)` | `POST /webhooks/call-ended` | Records interaction; queues follow-up SMS (AC3) |
| `sendFollowupSMS()` | `onCallEnded` via `queue()` | Drafts LLM follow-up; sends SMS |
| `handleSMS(from, to, text)` | `POST /webhooks/messaging` | Classifies intent, drafts reply, sends SMS (AC4) |
| `escalateToHuman(reason)` | `handleSMS` (if escalation intent) | Sets `escalation_pending` (AC5) |
| `resumeEscalation(replyText)` | `POST /hitl/reply` | Clears escalation, forwards reply (AC5) |
| `watchShipment(salesforceId)` | External caller | Schedules 3-day `checkShipmentStatus` (AC6) |
| `checkShipmentStatus(payload)` | `schedule()` self-wake | Pulls shipments, sends proactive SMS, re-schedules (AC6) |
| `ingestSalesforceUpdate(update)` | `POST /webhooks/salesforce` | Updates state, sends proactive SMS (AC7) |
| `getCustomerContext()` | External caller | Returns full `CustomerState` (AC8) |

## Error Conventions

All error responses are JSON with an `error` field:

```json
{ "error": "human-readable message" }
```

Validation errors return `400`. Unknown routes return `404`. Wrong method returns `405`.

The actor itself never throws to the client — internal actor errors surface as `500` with a generic message and the error is logged to Edge Compute observability.
