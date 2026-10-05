# API Reference — After-Hours Answering Line

This document describes the HTTP webhook endpoints exposed by the `after-hours-answering` sample. The application is a **Telnyx Edge Agent** (`AfterHoursLine`) that acts as a durable, cross-night after-hours presence for a healthcare clinic. It answers inbound calls, captures caller needs via AI speech-to-text, sends SMS confirmations, and schedules next-business-morning callbacks.

---

## Table of Contents

- [POST /webhook/call-initiated](#post-webhookcall-initiated)
- [POST /webhook/inbound-message](#post-webhookinbound-message)
- [GET /health](#get-health)

---

## POST /webhook/call-initiated

Handles an inbound after-hours call. The request is dispatched to the `AfterHoursLine` actor identified by the clinic line E.164 number (`call.to`). The actor answers the call, captures the caller's need via AI inference, logs the caller in the SQL `afterhours` table, and sends an SMS confirmation with callback options.

### Request

**Content-Type:** `application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | Telnyx webhook envelope. |
| `data.payload` | object | Yes | The event payload. |
| `data.payload.call` | object | Yes | The call object. |
| `data.payload.call.from` | string | Yes | Caller's phone number in E.164 format. |
| `data.payload.call.to` | string | Yes | The clinic's phone number (E.164) that was dialed. |
| `data.payload.call.call_control_id` | string | Yes | Telnyx Call Control ID for the call. |

### Example Request

```bash
curl -X POST https://<your-edge-endpoint>/webhook/call-initiated \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "call": {
          "from": "+13125550199",
          "to": "+1555XXXXXXXX",
          "call_control_id": "V2:abc123def456"
        }
      }
    }
  }'
```

### Response

**Status Code:** `200 OK`

```json
{
  "received": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Webhook received and dispatched to the actor successfully. |
| `400` | Malformed JSON body or missing required fields. |
| `404` | Route not found. |
| `500` | Internal server error during dispatch or actor processing. |

---

## POST /webhook/inbound-message

Handles an inbound SMS reply from a caller. The request is dispatched to the `AfterHoursLine` actor identified by the clinic line number (`to`). If the reply is `"1"` or `"confirm"`, the actor arms a `schedule()` for the next business morning to trigger the callback. If the reply is `"2"`, the actor sends a portal link via SMS.

### Request

**Content-Type:** `application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | object | Yes | Telnyx webhook envelope. |
| `data.payload` | object | Yes | The event payload. |
| `data.payload.from` | string | Yes | The sender's phone number in E.164 format. |
| `data.payload.to` | string | Yes | The clinic's phone number (E.164) that received the SMS. |
| `data.payload.text` | string | Yes | The body of the inbound SMS message. |

### Example Request

```bash
curl -X POST https://<your-edge-endpoint>/webhook/inbound-message \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "payload": {
        "from": "+13125550199",
        "to": "+1555XXXXXXXX",
        "text": "1"
      }
    }
  }'
```

### Response

**Status Code:** `200 OK`

```json
{
  "received": true
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Webhook received and dispatched to the actor successfully. |
| `400` | Malformed JSON body or missing required fields. |
| `404` | Route not found. |
| `500` | Internal server error during dispatch or actor processing. |

---

## GET /health

A simple health-check endpoint used to verify the Edge Function is running and responsive.

### Request

No parameters or body.

### Example Request

```bash
curl https://<your-edge-endpoint>/health
```

### Response

**Status Code:** `200 OK`

```json
{
  "status": "ok"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| `200` | Service is healthy and running. |
| `404` | Route not found. |
| `500` | Internal server error. |