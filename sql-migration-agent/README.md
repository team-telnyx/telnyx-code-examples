---
name: sql-migration-agent
title: SQL Migration Agent with SMS Notifications
description: Agent that orchestrates SQL schema migrations across actor instances with version tracking, rollback, and SMS notifications via Telnyx.
language: typescript
framework: edge
telnyx_products: [sms, messaging]
---

# SQL Migration Agent with SMS Notifications

An Edge-native agent that orchestrates SQL schema migrations across multiple actor instances — version-tracked, rollback-capable, with SMS notification on completion or failure.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that powers reliable, programmable messaging at the edge. This sample uses Telnyx SMS to deliver real-time migration status notifications — whether your schema rollout succeeded across all instances or hit a failure requiring immediate attention. Telnyx's global low-latency network and developer-first SDK make it the ideal choice for infrastructure automation that needs to communicate with operators.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `telnyx.messages.send()` | POST | Sends SMS notification to the operator's phone number when migration completes or fails |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client / CI System                        │
│                                                                 │
│  POST /migrate                                                  │
│  { "instances": ["db-1", "db-2", "db-3"] }                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MigrationAgent (Edge App)                     │
│                                                                 │
│  this.queue()  ──►  Instance 1    Instance 2    Instance 3      │
│                     │              │              │             │
│                     ▼              ▼              ▼             │
│              ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│              │  SQL DB   │  │  SQL DB   │  │  SQL DB   │          │
│              │  (read    │  │  (read    │  │  (read    │          │
│              │   version)│  │   version)│  │   version)│          │
│              └─────┬─────┘  └─────┬─────┘  └─────┬─────┘          │
│                    │              │              │                │
│                    ▼              ▼              ▼                │
│              ┌─────────────────────────────────────────┐          │
│              │         CloudFS (shared scripts)        │          │
│              │  /migrations/V1__init.sql               │          │
│              │  /migrations/V2__add_users.sql          │          │
│              │  /migrations/V3__add_indexes.sql        │          │
│              └─────────────────────────────────────────┘          │
│                    │              │              │                │
│                    ▼              ▼              ▼                │
│              ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│              │  SQL DB   │  │  SQL DB   │  │  SQL DB   │          │
│              │  (update   │  │  (update   │  │  (update   │          │
│              │   version) │  │   version) │  │   version) │          │
│              └─────┬─────┘  └─────┬─────┘  └─────┬─────┘          │
│                    │              │              │                │
│                    └──────────────┼──────────────┘                │
│                                   │                                │
│                                   ▼                                │
│                        ┌────────────────────┐                     │
│                        │  TELNYX SMS BINDING │                     │
│                        │  this.env.TELNYX    │                     │
│                        │  .messages.send()   │                     │
│                        └────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. Client sends `POST /migrate` with a list of instance identifiers.
2. `MigrationAgent` uses `this.queue()` to distribute migration tasks across instances.
3. Each queued instance: reads its current schema version from SQL DB → fetches the next migration script from CloudFS → applies it → updates the version in SQL DB.
4. On failure, the agent rolls back the migration and logs the error.
5. When all instances complete (success or failure), the agent sends an SMS notification via `this.env.TELNYX.messages.send()`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `NOTIFICATION_PHONE_NUMBER` | `string` | `+1555XXXXXXXX` | **yes** | Destination phone number for SMS notifications | Your mobile phone number in E.164 format |
| `MIGRATION_SCRIPTS_PATH` | `string` | `/migrations` | no | CloudFS path to shared migration scripts | Default: `/migrations` |
| `DEMO_MODE` | `string` | `true` | no | When `true`, no real SMS is sent; logs are printed instead | Set to `false` for live mode |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sql-migration-agent

# Install dependencies
npm install

# Create .env file from example
cp .env.example .env
# Edit .env and fill in your TELNYX_API_KEY and NOTIFICATION_PHONE_NUMBER

# Run the smoke test
npm test

# Start the Edge app locally
npm run dev
```

The app will be available at `http://localhost:8787`.

## API Reference

### `POST /migrate`

Triggers a schema migration across all specified instances.

**Request Body:**

```json
{
  "instances": ["db-primary", "db-replica-1", "db-replica-2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `instances` | `string[]` | yes | List of instance identifiers to migrate |

**Response (200 OK):**

```json
{
  "status": "queued",
  "instances": ["db-primary", "db-replica-1", "db-replica-2"],
  "message": "Migration queued for 3 instances"
}
```

**Response (400 Bad Request):**

```json
{
  "error": "instances field is required and must be a non-empty array"
}
```

**Response (500 Internal Server Error):**

```json
{
  "error": "An internal error occurred"
}
```

### `GET /health`

Health check endpoint.

**Response (200 OK):**

```json
{
  "status": "ok"
}
```

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| SMS not received | `DEMO_MODE` is `true` | Set `DEMO_MODE=false` in `.env` to send real SMS |
| `TELNYX_API_KEY` error | API key missing or invalid | Verify `TELNYX_API_KEY` in `.env` matches your Telnyx dashboard |
| Migration script not found | CloudFS path incorrect | Check `MIGRATION_SCRIPTS_PATH` env var and verify scripts exist in CloudFS |
| Rollback fails | SQL transaction error | Check SQL DB logs for constraint violations or connection issues |
| Queue not processing | Agent SDK not initialized | Ensure `@telnyx/edge-sdk` is installed and `MigrationAgent` extends `Agent` correctly |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [call-control-forwarding-agent](../call-control-forwarding-agent/README.md) — Agent-based call forwarding with Telnyx Call Control
- [kv-stateful-actor](../kv-stateful-actor/README.md) — Stateful actor with KV store persistence
- [sms-notification-agent](../sms-notification-agent/README.md) — Agent that sends SMS notifications on events

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api-reference)
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-sdk)
- [Telnyx SMS Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
