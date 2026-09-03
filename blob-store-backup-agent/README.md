---
name: blob-store-backup-agent
title: "BlobStore Backup Agent — Automated Cloud Storage Backups with SMS Verification"
description: "A Telnyx Edge agent that schedules 24h backups from BlobStore to Cloud Storage, verifies checksums, logs to SQL, and sends SMS notifications."
language: typescript
framework: edge
telnyx_products: [Messaging, SMS]
---

# BlobStore Backup Agent

An automated, scheduled backup agent built on the Telnyx Edge SDK that copies BlobStore data to Cloud Storage, verifies integrity via checksums, logs metadata to a SQL registry, and sends SMS notifications upon completion.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** that enables developers to build reliable, programmable agents with built-in messaging, scheduling, and state management. The Edge SDK gives this backup agent access to real primitives — `this.schedule()`, `this.blobs`, Cloud Storage, SQL DB, and SMS via `this.env.TELNYX.messages.send()` — all running at the edge with zero infrastructure overhead.

## Telnyx API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `this.env.TELNYX.messages.send()` | POST | Sends SMS notification when backup completes |
| `this.schedule('24h')` | — | Schedules the backup agent to run every 24 hours |
| `this.blobs.list()` | GET | Lists all blobs in the source BlobStore |
| `this.blobs.read(key)` | GET | Reads blob content from BlobStore |
| `this.cloudStorage.upload(key, data)` | POST | Uploads blob data to Cloud Storage |
| `this.sql.insert(table, row)` | POST | Logs backup metadata to the SQL registry |
| `this.sql.query(sql)` | GET | Queries the backup registry for verification |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BackupAgent (Edge SDK)                   │
│                                                              │
│  this.schedule('24h')                                        │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────┐            │
│  │ 1. List all blobs via this.blobs.list()     │            │
│  └─────────────────────────────────────────────┘            │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────┐            │
│  │ 2. For each blob:                           │            │
│  │    a. Read from BlobStore (this.blobs.read)│            │
│  │    b. Upload to Cloud Storage              │            │
│  │    c. Compute & verify checksum            │            │
│  └─────────────────────────────────────────────┘            │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────┐            │
│  │ 3. Log to SQL registry:                     │            │
│  │    backups(id, timestamp, size, verified)   │            │
│  └─────────────────────────────────────────────┘            │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────────────────────────────────────┐            │
│  │ 4. Send SMS via this.env.TELNYX.messages    │            │
│  │    .send() — "backup complete"              │            │
│  └─────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. The agent wakes every 24 hours via `this.schedule('24h')`.
2. It enumerates all blobs in the source BlobStore.
3. For each blob, it reads the content, uploads it to Cloud Storage, and computes a checksum.
4. It verifies the uploaded checksum matches the source.
5. It logs the backup record (timestamp, size, verified status) to the SQL registry.
6. After all blobs are processed, it sends an SMS notification via the Telnyx Messaging API.

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/blob-store-backup-agent

# Create .env file from example
cp .env.example .env
# Edit .env and add your Telnyx API key
nano .env

# Install dependencies
npm install

# Run in demo mode (no real SMS sent)
npm run dev

# Run in live mode (real SMS notifications)
npm run start
```

## API Reference

See [`API.md`](./API.md) for the full typed endpoint reference, including route definitions, request/response schemas, and status codes.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `Error: TELNYX_API_KEY not set` | Environment variable missing | Ensure `.env` file exists and contains `TELNYX_API_KEY` |
| `BlobStore read timeout` | Source blob too large or unavailable | Check BlobStore connectivity; retry with smaller batches |
| `Checksum mismatch on verify` | Data corruption during transfer | Re-upload the affected blob; check Cloud Storage integrity |
| `SMS send failed` | Invalid phone number or API key | Verify `TELNYX_API_KEY` and destination number format |
| `SQL insert failed` | Registry table not initialized | Run `npm run migrate` to create the `backups` table |
| `Schedule not triggering` | Agent not deployed to Edge runtime | Deploy via `npm run deploy` to the Telnyx Edge platform |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [Call Control IVR Agent](../call-control-ivr-agent/)
- [Real-time Transcription Agent](../realtime-transcription-agent/)
- [SMS Notification Agent](../sms-notification-agent/)
- [Queue-based Order Processor](../queue-order-processor/)

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com/)
- [Telnyx API Reference](https://developers.telnyx.com/api/)
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-sdk)
- [Telnyx Messaging Product Page](https://telnyx.com/sms)
- [Telnyx Pricing](https://telnyx.com/pricing)
