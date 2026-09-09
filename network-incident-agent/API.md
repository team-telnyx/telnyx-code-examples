# API Reference

Base URL: the URL printed by `telnyx-edge dev`, normally `http://localhost:8787`.

## Run the safe demo

```bash
curl -X POST http://localhost:8787/api/demo \
  -H 'content-type: application/json' \
  -d '{
    "incidentId": "INC-EDGE-042",
    "title": "Amsterdam edge packet loss",
    "description": "Elevated packet loss is affecting voice and messaging.",
    "affectedServices": ["Voice", "Messaging"],
    "affectedCustomers": ["+15555550101", "+15555550102"],
    "liveMode": false,
    "paceMs": 0
  }'
```

`liveMode: false` simulates SMS while still exercising actor state, KV, embedded SQL, CloudFS, and scheduling.

## Initialize an incident

`POST /api/incident` accepts the same incident fields as `/api/demo`. It returns the initial durable actor state.

## Read a snapshot

```bash
curl 'http://localhost:8787/api/incident?incidentId=INC-EDGE-042'
```

Customer numbers are masked in the response. Raw numbers remain in KV and are only read inside the actor when sending notifications.

## Transition the incident

```bash
curl -X POST http://localhost:8787/api/transition \
  -H 'content-type: application/json' \
  -d '{
    "incidentId": "INC-EDGE-042",
    "status": "investigating",
    "description": "Operations isolated the faulty route.",
    "notify": true
  }'
```

Allowed paths are `detected → investigating → restoring → resolved → closed`, with controlled rollback from restoring/resolved/closed to investigating.

## Send a notification

```bash
curl -X POST http://localhost:8787/api/notify \
  -H 'content-type: application/json' \
  -d '{"incidentId":"INC-EDGE-042","message":"We are investigating the incident."}'
```

In live mode, a non-2xx Telnyx operation is counted and returned as an error.

## Generate an RCA

```bash
curl -X POST http://localhost:8787/api/rca \
  -H 'content-type: application/json' \
  -d '{"incidentId":"INC-EDGE-042","rootCause":"A routing policy propagated an invalid next hop."}'
```

The response contains the relative CloudFS path and generated JSON.

## Inbound call webhook

Point a Telnyx Call Control application's webhook URL to `/webhooks/call`. Include a base64-encoded client state containing the incident ID when initiating or routing the call:

```json
{"incidentId":"INC-EDGE-042"}
```

On `call.initiated`, the handler answers the call and speaks current durable incident context. Validate Telnyx signatures at the ingress or gateway in production.
