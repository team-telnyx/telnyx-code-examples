# API Reference

## `GET /healthz`

Returns `{"status":"ok"}`.

## `POST /webhooks/voice`

Receives Telnyx Call Control webhooks for the inbound caller and the specialist
call leg. The app expects `data.payload.call_control_id` in the standard Telnyx
webhook envelope.
