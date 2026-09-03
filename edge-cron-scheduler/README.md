---
name: edge-cron-scheduler
title: Edge Cron Scheduler with Telnyx SMS Notifications
description: A cron-like job scheduler running on the edge that triggers jobs on schedule, logs results to SQL, and sends SMS notifications via Telnyx on failure.
language: typescript
framework: edge
telnyx_products: [SMS, Messaging, Agent SDK, KV, SQL]
---

# Edge Cron Scheduler with Telnyx SMS Notifications

A cron-like job scheduler running on the edge that triggers jobs on schedule, manages dependencies, and notifies via SMS using Telnyx.

## Why Telnyx

Telnyx provides the **AI Communications Infrastructure** that powers modern edge applications. With Telnyx's Edge SDK, developers can build stateful, scheduled agents that run close to users while leveraging global telecom capabilities — including SMS, voice, and messaging — through a single, unified API. This sample demonstrates how Telnyx's Agent SDK, KV store, SQL database, and SMS messaging combine to create a resilient, distributed cron scheduler with real-time failure notifications.

## Telnyx API Endpoints Used

| Product | Endpoint / Method | Purpose |
|---------|-------------------|---------|
| **Agent SDK** | `CronAgent extends Agent` | Base class for the edge cron scheduler agent |
| **Agent SDK** | `this.every('1m')` | Schedules recurring execution of the agent's main loop |
| **Agent SDK** | `this.queue('execute', job)` | Queues a job execution for asynchronous processing |
| **KV Store** | `ctx.kv.get('jobs')` / `ctx.kv.put('jobs', ...)` | Stores the job registry (list of cron entries) |
| **SQL Database** | `ctx.sql.exec(...)` | Persists job execution logs: `jobs(id, name, last_run, status, result)` |
| **SMS / Messaging** | `this.env.TELNYX.messages.send(...)` | Sends SMS notification on job completion or failure |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Edge Cron Agent                            │
│                                                                 │
│  ┌─────────────┐     ┌──────────────┐     ┌─────────────────┐  │
│  │  this.every │────▶│  KV Job      │────▶│  Queue 'execute'│  │
│  │  ('1m')     │     │  Registry    │     │  (per job)      │  │
│  └─────────────┘     └──────────────┘     └─────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Job Execution Handler                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │  │
│  │  │  Call Job   │  │  SMS Job    │  │  Webhook Job     │  │  │
│  │  └─────────────┘  └─────────────┘  └──────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌────────────────────────┐     ┌───────────────────────────┐  │
│  │  SQL Execution Log     │     │  Telnyx SMS Notification  │  │
│  │  jobs(id, name,        │     │  this.env.TELNYX          │  │
│  │   last_run, status,    │◀────│  .messages.send()         │  │
│  │   result)              │     │  (on failure)             │  │
│  └────────────────────────┘     └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. `CronAgent.every('1m')` triggers the main scheduling loop every minute.
2. The agent reads the job registry from `ctx.kv.get('jobs')`.
3. For each job that is due (based on its cron expression and `last_run`), the agent calls `this.queue('execute', job)`.
4. The queued job is executed — one of three job types: **call**, **SMS**, or **webhook**.
5. The result is logged to the SQL database (`jobs` table).
6. If the job fails, an SMS notification is sent via `this.env.TELNYX.messages.send()`.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/edge-cron-scheduler

# Create .env file from example
cp .env.example .env
# Edit .env and add your Telnyx API key
# TELNYX_API_KEY=your_telnyx_api_key_here

# Install dependencies
npm install

# Run locally (demo mode — no real SMS or calls sent)
npm run dev

# Run smoke test
npx tsx smoke_test.ts
```

## API Reference

See [`API.md`](./API.md) for the full typed endpoint and method reference.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `TELNYX_API_KEY is not set` | Environment variable missing | Copy `.env.example` to `.env` and add your key |
| `KV get('jobs') returns null` | No jobs registered yet | Run the seed script or add jobs via the API endpoint |
| `SQL exec fails on 'jobs' table` | Database schema not initialized | Ensure the SQL binding is configured with the correct schema |
| `SMS notification not sent on failure` | Telnyx API key invalid or SMS disabled in demo mode | Verify API key and check demo mode settings in `GUIDE.md` |
| `Agent does not trigger every minute` | Edge runtime not configured for scheduled execution | Ensure the agent is deployed with proper scheduling permissions |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [edge-agent-chat](./edge-agent-chat) — Real-time chat agent with WebSocket streaming
- [edge-sms-forwarder](./edge-sms-forwarder) — SMS-to-webhook forwarder with Ed25519 verification
- [edge-call-control](./edge-call-control) — Call Control with IVR and call forwarding
- [edge-kv-cache](./edge-kv-cache) — KV-backed caching layer with TTL

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/api/)
- [Telnyx SDK (TypeScript)](https://github.com/team-telnyx/telnyx-node)
- [Telnyx SMS Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
