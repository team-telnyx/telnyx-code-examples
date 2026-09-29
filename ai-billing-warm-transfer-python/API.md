# API Reference

## `GET /healthz`

Returns `{"status":"ok"}` when the Flask process is running.

## `POST /webhooks/voice`

Receives Telnyx Call Control webhooks for the inbound call, structured AI
gather results, the specialist call leg, and hangup cleanup.

The endpoint expects the standard Telnyx event envelope with the call control
ID under `data.payload.call_control_id`.
