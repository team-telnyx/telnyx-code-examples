# Production and Recording Guide

## Recording mode

1. Use a writable temporary directory for `CLOUDFS_MOUNT_PATH`.
2. Start the application with `npm start`.
3. Open the dashboard and keep **Send real Telnyx SMS** disabled.
4. Expand **Configure demo parameters** if you want to change the incident.
5. Select **Run incident demo**.

The dashboard animates detection, customer notifications, investigation, restoration, resolution, RCA generation, and recurrence scheduling. Numbers remain masked in the UI.

## Live Telnyx mode

Before enabling live mode:

- Configure a real KV namespace in `telnyx.toml`.
- Set `TELNYX_SMS_FROM_NUMBER` to an SMS-capable Telnyx number.
- Configure the `TELNYX_API_KEY` secret for Call Control.
- Enter opted-in destination numbers using E.164 format.
- Confirm your messaging profile, destination permissions, and regulatory requirements.
- Mount the intended CloudFS filesystem into all actor processes.

Live mode uses Telnyx Inference for severity classification and the `[telnyx]` binding for SMS. The Call Control webhook uses the API-key secret to answer and speak.

## Call Control setup

Configure the application's webhook as:

```text
https://YOUR_EDGE_URL/webhooks/call
```

The call must carry base64 JSON client state with the incident ID. The handler reacts only to `call.initiated`, answers once, then speaks the latest actor state. Put signature validation and operator authentication at your trusted ingress before production use.

## Durability model

- Agent state: lifecycle, severity, counts, RCA path, recurrence state.
- KV: affected customer numbers, isolated by incident ID. Local development uses the actor's durable key-value store if an external KV binding is unavailable.
- Embedded SQL: append-only incident timeline.
- CloudFS: atomic RCA JSON document.
- Scheduler: durable recurrence task with a stable per-incident ID.

## Extension ideas

- Feed real monitoring alerts into `POST /api/incident`.
- Map customers to impacted SIMs from inventory rather than accepting numbers from an operator.
- Add an authenticated operator role and signed webhook verification middleware.
- Connect recurrence checks to network telemetry and reopen the incident automatically.
- Stream agent events over the Agent SDK socket protocol instead of polling.
