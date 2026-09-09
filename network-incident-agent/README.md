---
name: network-incident-agent
title: "Network Incident Agent on Telnyx Edge"
description: "A durable incident actor that assesses severity, proactively sends SMS, answers calls with incident context, writes an RCA to CloudFS, and checks for recurrence."
language: typescript
framework: telnyx-edge
telnyx_products: [Edge Compute, Agent SDK, Messaging, Voice, Inference, KV, CloudFS]
---

# Network Incident Agent

The actor **is the outage**. One durable Telnyx Edge Agent owns an incident from detection through customer communication, recovery, RCA generation, and a delayed recurrence check.

The included web dashboard runs a paced, recording-friendly flow. It defaults to safe demo mode and can send real SMS when explicitly enabled.

## Why Telnyx

Telnyx **AI Communications Infrastructure** combines durable Edge actors, inference, messaging, voice, and storage in one application. The incident remains close to the communications path while its state and scheduled work survive process restarts.

## What is real

- `NetworkIncidentAgent extends Agent` with durable incident state.
- Affected customer numbers live in a Telnyx KV namespace in deployment. Local actor development falls back to the actor's durable key-value store when the CLI does not inject external KV bindings into actor processes.
- Every lifecycle event is written to the actor's embedded SQL database.
- Severity can be assessed through Telnyx Inference in live mode.
- SMS uses the zero-credential `[telnyx]` binding.
- Inbound Call Control webhooks are answered and spoken through the Telnyx API.
- RCA JSON is written atomically to a mounted CloudFS filesystem.
- `this.schedule()` creates a durable, delayed recurrence check.

Demo mode exercises the same state, KV, SQL, scheduling, and CloudFS paths, but simulates SMS delivery. Live mode makes real Telnyx Inference and Messaging calls.

## Prerequisites

- Node.js 20+
- `telnyx-edge` CLI v0.5.0+
- A Telnyx account and API key
- For live SMS: an SMS-capable Telnyx number and verified destination numbers
- A KV namespace and CloudFS filesystem configured for Edge Compute

## Configure

```bash
cp .env.example .env
npm install
```

Update these placeholders before using live mode:

1. Replace the development UUID at `[storage.kv.INCIDENT_KV].id` in `telnyx.toml` with your KV namespace UUID.
2. Set `TELNYX_SMS_FROM_NUMBER` to your SMS-capable Telnyx number.
3. Set `TELNYX_API_KEY` in `.env`; deploy it as the `TELNYX_API_KEY` secret.
4. Mount CloudFS at `CLOUDFS_MOUNT_PATH`. For local development, use a writable temporary directory.

Never put real credentials or customer phone numbers in committed files.

## Run locally

For a safe local recording demo:

```bash
npm install
npm run build
mkdir -p /tmp/network-incident-cloudfs
CLOUDFS_MOUNT_PATH=/tmp/network-incident-cloudfs \
  TELNYX_EDGE_BIN=$HOME/bin/telnyx-edge \
  TELNYX_EDGE_PORT=8787 \
  npm start
```

Open the URL printed by `telnyx-edge` (normally `http://localhost:8787`). Leave **Send real Telnyx SMS** unchecked.

With the stack running, execute the repeatable API smoke test:

```bash
DEMO_BASE_URL=http://localhost:8787 npm run smoke
```

For live SMS, configure the real KV namespace and Telnyx number, provide the API-key secret, enter real opted-in destination numbers in the dashboard, and explicitly enable live mode.

## Demo flow

1. Create `NetworkIncidentAgent("INC-EDGE-042")`.
2. Store affected customers in KV and assess severity.
3. Notify affected customers when the incident is detected.
4. Transition through investigating and restoring, sending each update.
5. Expose incident-aware text for an inbound Call Control response.
6. Resolve the incident and write the full RCA to CloudFS.
7. Schedule a durable recurrence check; the recording demo uses 30 seconds.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/demo` | Run the complete paced demo |
| `POST` | `/api/incident` | Initialize an incident actor |
| `GET` | `/api/incident?incidentId=...` | Read durable state, SQL timeline, and masked customers |
| `POST` | `/api/transition` | Validate and apply a lifecycle transition |
| `POST` | `/api/notify` | Send or simulate a customer notification |
| `POST` | `/api/rca` | Write an RCA document to CloudFS |
| `GET` | `/api/call-preview?incidentId=...` | Preview the incident-aware voice response |
| `POST` | `/webhooks/call` | Handle a Telnyx `call.initiated` event |
| `GET` | `/health/readiness` | Readiness probe |

See [API.md](./API.md) for request examples and [GUIDE.md](./GUIDE.md) for production setup.

## Production notes

- Protect operator endpoints with your authentication layer before exposing them publicly.
- Validate Telnyx webhook signatures at your ingress or gateway.
- Telnyx webhook delivery and scheduled tasks are at-least-once; use stable command and task IDs when extending the sample.
- The sample masks phone numbers in all browser responses and timeline messages.
- A failed live SMS or Call Control request produces a visible error; the application does not report false success.

## Troubleshooting

- `telnyx-edge was not found`: install CLI v0.5.0+ or set `TELNYX_EDGE_BIN`.
- Port 8787 is busy: set `TELNYX_EDGE_PORT=8788` before `npm start`.
- KV UUID is rejected: replace the development UUID with the value returned by `telnyx-edge storage kv create`.
- RCA write fails: ensure `CLOUDFS_MOUNT_PATH` exists in the actor container and is writable.
- Live SMS fails: verify the API key, sender number, messaging profile, destination permissions, and E.164 formatting.

## Agent Discovery

The Edge runtime discovers `NetworkIncidentAgent` through the `[[actors]]` declaration in `telnyx.toml`. The function handler obtains the durable actor with `env.INCIDENT_AGENT.idFromName(incidentId)`; using the same incident ID always routes back to the same durable entity.

## Related Examples

- [Agent Fleet Shared Workspace](../agent-fleet-shared-workspace/) — durable agents collaborating through CloudFS.
- [KV-Backed Rate Limiter](../kv-backed-rate-limiter/) — Agent SDK state combined with a KV namespace.
- [Edge Call Transcription Agent](../edge-call-transcription-agent/) — Telnyx Call Control actions from Edge Compute.
