---
name: sql-migration-agent
title: "SQL Migration Agent with Telnyx SMS Notifications"
description: "Automated SQL schema migration agent with CloudFS script storage, multi-instance queueing, rollback support, and Telnyx SMS notifications."
language: python
framework: flask
telnyx_products: [Messaging, CloudFS]
---

# SQL Migration Agent

Automated SQL schema migration agent with CloudFS script storage, multi-instance queueing, rollback support, and Telnyx SMS notifications.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** needed to build intelligent, automated migration systems that keep your team informed in real-time. This sample demonstrates how Telnyx's Messaging API handles SMS notifications for migration success/failure, while the CloudFS API provides scalable storage for migration scripts. The combination of Telnyx's reliable messaging and cloud storage creates a robust foundation for building AI-driven database operations that can automatically notify, coordinate, and recover across distributed systems.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v2/messages` | POST | Send SMS notifications for migration success/failure |
| CloudFS API | GET | Fetch migration scripts from CloudFS storage |
| Webhooks | POST | Receive SMS delivery status updates |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Flask Application                          │
│                                                                    │
│  ┌──────────────┐    ┌──────────────────┐    ┌─────────────────┐  │
│  │  POST        │    │  Migration       │    │  GET            │  │
│  │  /migrations │───▶│  Queue           │───▶│  /migrations/   │  │
│  └──────────────┘    │  (this.queue())  │    │  :id            │  │
│                      └────────┬─────────┘    └─────────────────┘  │
│                               │                                    │
│                               ▼                                    │
│  ┌──────────────────────────────────────────────┐                 │
│  │         Migration Executor                   │                 │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │                 │
│  │  │ CloudFS  │  │  SQL DB  │  │  Schema    │  │                 │
│  │  │ Fetch    │  │ Execute  │  │  Version   │  │                 │
│  │  │ Scripts  │  │ Steps    │  │  Tracking  │  │                 │
│  │  └──────────┘  └──────────┘  └────────────┘  │                 │
│  └──────────────────────┬───────────────────────┘                 │
│                         │                                          │
│                         ▼                                          │
│              ┌──────────────────────┐                             │
│              │  Rollback Handler    │                             │
│              │  (on failure)        │                             │
│              └──────────────────────┘                             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
              ┌──────────────────────┐
              │   Telnyx Messaging   │
              │   SMS Notifications  │
              │   (success/failure)  │
              └──────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `PORT` | `string` | `your_port_here` | **yes** | PORT | — |
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |
| `TELNYX_FROM_NUMBER` | `string` | `your_telnyx_from_number_here` | **yes** | TELNYX_FROM_NUMBER | — |
| `TELNYX_PUBLIC_KEY` | `string` | `your_telnyx_public_key_here` | **yes** | TELNYX_PUBLIC_KEY | — |

## Setup

1. **Clone the repository**

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sql-migration-agent
```

2. **Create and configure your `.env` file**

```bash
cp .env.example .env
```

Edit `.env` and add your Telnyx credentials:

```bash
PORT=5000
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_FROM_NUMBER=your_telnyx_from_number_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
```

3. **Install dependencies**

```bash
pip install -r requirements.txt
```

4. **Run the application**

```bash
python app.py
```

The server will start on `http://localhost:5000`.

## API Reference

### Health Check

**GET** `/health`

Returns the health status of the service.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Create Migration

**POST** `/migrations`

Creates and queues a new migration. Accepts a JSON body with migration details.

**Request Body:**
```json
{
  "migration_id": "migration_001",
  "db_name": "default",
  "notify_phone": "+15551234567"
}
```

**Parameters:**
- `migration_id` (required): Migration identifier. Use `"auto"` to generate a unique ID.
- `db_name` (optional): Database name (defaults to `"default"`).
- `notify_phone` (optional): Phone number for SMS notifications.

**Response (202 Accepted):**
```json
{
  "migration_id": "migration_001",
  "status": "queued"
}
```

**Error Responses:**
- `400`: Missing `migration_id`
- `409`: Migration already exists

### Get Migration Status

**GET** `/migrations/{migration_id}`

Returns the current status of a migration.

**Response:**
```json
{
  "id": "migration_001",
  "db_name": "default",
  "status": "completed",
  "current_step": 3,
  "total_steps": 3,
  "created_at": "2024-01-01T00:00:00.000Z",
  "schema_version": 1
}
```

### List All Migrations

**GET** `/migrations`

Returns all migrations in the system.

### Cancel Migration

**DELETE** `/migrations/{migration_id}`

Cancels a queued migration.

**Response:**
```json
{
  "status": "cancelled"
}
```

**Error Responses:**
- `400`: Cannot cancel migration in current state
- `404`: Migration not found

### Get Schema Version

**GET** `/schema/{db_name}`

Returns the current schema version for a database.

**Response:**
```json
{
  "db_name": "default",
  "schema_version": 1
}
```

### Telnyx Webhook

**POST** `/webhooks/telnyx`

Handles Telnyx webhooks (e.g., SMS delivery status). Verifies the Ed25519 signature.

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| `401 Unauthorized` | Invalid API key | Verify `TELNYX_API_KEY` in `.env` is correct |
| `403 Forbidden` | Invalid public key | Check `TELNYX_PUBLIC_KEY` matches your Telnyx account |
| SMS not sending | Invalid from number | Ensure `TELNYX_FROM_NUMBER` is a valid Telnyx number |
| Migration not found | Invalid migration ID | Use `migration_001`, `migration_002`, or `migration_003` |
| Webhook verification failed | Invalid signature | Ensure webhook URL is properly configured in Telnyx portal |
| Port already in use | Port conflict | Change `PORT` in `.env` to an available port |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub Repository](https://github.com/team-telnyx/ai)
- [Telnyx LLMs.txt](https://telnyx.com/llms.txt)

## Related Examples

- [SMS Notification Agent](https://github.com/team-telnyx/telnyx-code-examples/sms-notification-agent)
- [Webhook Receiver](https://github.com/team-telnyx/telnyx-code-examples/webhook-receiver)
- [Voice AI Assistant](https://github.com/team-telnyx/telnyx-code-examples/voice-ai-assistant)

## Resources

- [Telnyx Developer Documentation](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)
- [Telnyx Product Overview](https://telnyx.com/products)
- [Telnyx Pricing](https://telnyx.com/pricing)
