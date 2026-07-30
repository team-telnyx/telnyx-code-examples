# API Reference

## `POST /webhooks/voice`

Receives Telnyx Voice API webhooks and starts the configured Telnyx AI Assistant on answered inbound calls.

The endpoint validates Telnyx webhook signatures when `TELNYX_PUBLIC_KEY` is set.

### Important Events

| Event | Behavior |
|---|---|
| `call.initiated` | Stores sanitized call state and answers inbound calls. |
| `call.answered` | Starts the configured AI Assistant with `ai_assistant_start`. |
| `call.conversation.messages_added` | Records high-level assistant progress for the dashboard. |
| `call.payment.progress` / `call_payment_progress` | Records Pay over Voice progress with masked payment fields only. |
| `call.payment.completed` / `call_payment_completed` | Records payment completion with masked payment fields only. |
| `call.hangup` | Cleans up active call state. |

## `POST /tools/start-secure-payment`

Assistant webhook tool that starts Telnyx Pay over Voice on the active call.

The endpoint accepts the optional `X-Demo-Tool-Secret` header when `TOOL_SECRET` is configured.

### Response

```json
{
  "ok": true,
  "secure_payment_event": "started",
  "pci_scope": "telnyx pay over voice is now collecting payment details by keypad outside the assistant transcript.",
  "amount_now": "40.00"
}
```

## `POST /tools/record-payment-complete`

Assistant webhook tool that records a sanitized completion marker for Conversation Analysis and the local dashboard. This endpoint returns `409` until Telnyx has sent a `call.payment.completed` or `call_payment_completed` event for the call.

### Response

```json
{
  "ok": true,
  "secure_payment_event": "completed",
  "pci_scope": "payment completion was recorded without card number, expiration date, cvv, zip, or raw dtmf."
}
```

## `POST /webhooks/payment-processor`

Mock Pay Connector processor endpoint.

### Response

```json
{
  "charge_id": "ch_demo_1760000000",
  "amount": "40.00",
  "error_code": null,
  "error_message": null
}
```

Cards ending in `0002` simulate a decline:

```json
{
  "error_code": "card_declined",
  "error_message": "the card was declined."
}
```

## `GET /health`

Returns runtime configuration state.

## `GET /events`

Returns sanitized local audit events.

## `GET /sessions`

Returns completed payment session summaries.
