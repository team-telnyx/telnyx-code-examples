---
name: stateful-actor-log-streaming-and-filtering
title: "Stateful Actor Log Streaming & Filtering"
description: "A Python/Flask sample that simulates a Telnyx Edge Stateful Actor (Counter) with CLI-style observability endpoints for invocation logs, runtime logs, live streaming, and instance filtering."
language: python
framework: flask
telnyx_products: [Edge Compute, Stateful Actors, CLI]
---

# Stateful Actor Log Streaming & Filtering

A Python/Flask sample that simulates a Telnyx Edge Stateful Actor (`Counter`) with CLI-style observability endpoints for invocation logs, runtime logs, live streaming, and instance filtering.

## The Story

A regional logistics firm operates a fleet of delivery trucks that must report package counts at each stop. If a truck's counter resets or loses state mid-route, packages go unaccounted for, leading to customer disputes, compliance violations, and lost revenue. The firm needs a durable, stateful component that survives platform reboots and can be inspected in real-time to verify correctness.

The actor IS the delivery truck's onboard counter. It is born when a truck begins its route, evolves with each package scanned at every stop, and terminates when the route is complete. Its state persists across reboots, ensuring no package is ever lost. The rest of this README is the API surface of that story.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** that powers real-time, stateful interactions at global scale. Edge Compute Stateful Actors give developers durable, low-latency components that persist state across invocations and survive platform disruptions. The integrated CLI observability tools let operators inspect historical invocation records and stream live runtime logs without external logging infrastructure.

## Telnyx API Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/actors/<actor_type>/invoke` | POST | Invokes a method on a Stateful Actor instance |
| `/actors/<actor_type>/logs` | GET | Queries historical invocation or runtime logs |
| `/actors/<actor_type>/logs/stream` | GET | Live-streams runtime or invocation logs (SSE) |
| `/actors/<actor_type>/instances` | GET | Lists all instances of an actor type |
| `/actors` | GET | Lists all deployed actor types |
| `/health` | GET | Health check endpoint |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client / CLI                        │
│                                                             │
│  POST /actors/Counter/invoke                                │
│  GET  /actors/Counter/logs?type=invocations                 │
│  GET  /actors/Counter/logs?type=runtime&instance=<id>       │
│  GET  /actors/Counter/logs/stream?type=runtime&--tail       │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Flask Application                        │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ CounterActor │───▶│ Invocation   │───▶│ SQLite DB    │  │
│  │ (Stateful    │    │ Logs Table   │    │ (file-based) │  │
│  │  Actor)      │    │              │    │              │  │
│  └──────────────┘    └──────────────┘    │  runtime_    │  │
│                                           │  logs        │  │
│                                           │  actor_      │  │
│                                           │  instances   │  │
│                                           └──────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

The Flask app simulates the Telnyx Edge Stateful Actor lifecycle. The `CounterActor` class maintains durable state in a SQLite database. Every invocation generates both a runtime log (console output equivalent) and an invocation record (platform metadata). The CLI-style endpoints mirror `telnyx-edge actors logs` commands, supporting historical queries, live streaming via Server-Sent Events, and filtering by instance ID.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `DB_PATH` | `string` | `your_db_path_here` | **yes** | DB_PATH | — |
| `DEMO_MODE` | `string` | `your_demo_mode_here` | **yes** | DEMO_MODE | — |
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/stateful-actor-log-streaming-and-filtering

# Create .env file
cp .env.example .env

# Install dependencies
pip install -r requirements.txt

# Run the application
python app.py
```

The server starts on `http://0.0.0.0:8080` by default. Set `PORT` in `.env` to change the port.

## API Reference

### POST `/actors/<actor_type>/invoke`

Invokes a method on a Stateful Actor instance.

**Request Body:**
```json
{
  "method": "increment",
  "instance_id": "optional-uuid",
  "payload": {}
}
```

**Response (200):**
```json
{
  "result": {"count": 1, "instance_id": "uuid"},
  "instance_id": "uuid",
  "duration_ms": 5
}
```

**Response (400):** Method not supported.

**Response (500):** Invocation failed.

---

### GET `/actors/<actor_type>/logs`

Queries historical logs. Mirrors `telnyx-edge actors logs <type>`.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | `invocations` | Log type: `invocations` or `runtime` |
| `instance` | string | — | Filter by instance ID |
| `limit` | integer | `100` | Maximum records to return |

**Response (200):**
```json
{
  "actor_type": "Counter",
  "log_type": "invocations",
  "count": 2,
  "logs": [
    {
      "id": "uuid",
      "actor_type": "Counter",
      "instance_id": "uuid",
      "method_name": "increment",
      "outcome": "success",
      "duration_ms": 5,
      "timestamp": "2024-01-01T00:00:00Z",
      "payload": "{}"
    }
  ]
}
```

**Response (400):** Invalid log type.

---

### GET `/actors/<actor_type>/logs/stream`

Live-streams logs via Server-Sent Events. Mirrors `telnyx-edge actors logs <type> --tail`.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | string | `runtime` | Log type: `invocations` or `runtime` |
| `instance` | string | — | Filter by instance ID |

**Response (200):** `text/event-stream` with `data:` events containing log records as JSON.

---

### GET `/actors/<actor_type>/instances`

Lists all instances of an actor type.

**Response (200):**
```json
{
  "actor_type": "Counter",
  "instances": [
    {
      "instance_id": "uuid",
      "state": "{\"count\": 3}",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### GET `/actors`

Lists all deployed actor types.

**Response (200):**
```json
{
  "actors": ["Counter"]
}
```

---

### GET `/health`

Health check endpoint.

**Response (200):**
```json
{
  "status": "ok",
  "demo_mode": true
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `sqlite3.OperationalError: no such table` | Database not initialized | Restart the app; `init_db()` runs on startup |
| `400 Invalid log type` | Wrong `type` query parameter | Use `invocations` or `runtime` |
| `400 Method not supported` | Unsupported method in invoke payload | Use `increment` as the method name |
| Stream endpoint returns no data | No new logs since connection | Invoke the actor to generate logs |
| Port already in use | Another process on `PORT` | Set a different `PORT` in `.env` |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Stateful Actor with KV Storage](../stateful-actor-kv-storage)
- [Stateful Actor with Scheduled Tasks](../stateful-actor-scheduled-tasks)
- [Agent with Tool Calling](../agent-tool-calling)

## Resources

- [Telnyx Edge Compute Documentation](https://developers.telnyx.com/docs/edge-compute)
- [Stateful Actors Observability Guide](https://developers.telnyx.com/docs/edge-compute/stateful-actors/observability/logs)
- [Telnyx Python SDK](https://developers.telnyx.com/docs/sdk/python)
- [Telnyx Edge Product Page](https://telnyx.com/edge-compute)
- [Telnyx Pricing](https://telnyx.com/pricing)
