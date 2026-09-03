---
name: agent-state-snapshot-restore
title: "Agent State Snapshot & Restore"
description: "Snapshot agent state to BlobStore, log to SQL registry, and restore from backup using the Telnyx Agent SDK."
language: typescript
framework: edge
telnyx_products: [Agent SDK, BlobStore, StateStore, SQL, Edge Functions]
---

# Agent State Snapshot & Restore

Snapshot agent state to BlobStore, log to SQL registry, and restore from backup using the Telnyx Agent SDK.

## Why Telnyx

Telnyx provides **AI Communications Infrastructure** — a programmable edge platform that gives AI agents durable state, real-time messaging, and global low-latency compute. The Agent SDK exposes `StateStore`, `BlobStore`, and SQL primitives so your agents can persist, snapshot, and restore state across sessions without managing infrastructure.

## Telnyx API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/snapshot` | Trigger a state snapshot — reads agent state, serializes, stores in BlobStore, logs to SQL |
| `GET` | `/snapshots` | List all snapshots from the SQL registry |
| `POST` | `/restore/{id}` | Restore agent state from a snapshot by ID |
| `GET` | `/health` | Health check endpoint |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Telnyx Edge Function                      │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  HTTP Routes │    │ SnapshotAgent│    │   SQL DB     │      │
│  │  /snapshot   │───▶│  (extends    │───▶│  snapshots   │      │
│  │  /restore/{id}│    │   Agent)     │    │  registry    │      │
│  │  /snapshots  │    │              │    │              │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                          │  ▲                                   │
│                          │  │                                   │
│                    getState() replaceState()                    │
│                          │  │                                   │
│                          ▼  │                                   │
│                    ┌──────────────┐                              │
│                    │  BlobStore   │                              │
│                    │  (snapshots) │                              │
│                    └──────────────┘                              │
│                                                                  │
│  Flow: POST /snapshot → getState() → serialize → BlobStore put   │
│        → SQL log → POST /restore/{id} → SQL lookup → BlobStore   │
│        get → replaceState()                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Type | Example | Required | Description | Where to get it |
|----------|------|---------|----------|-------------|-----------------|
| `TELNYX_API_KEY` | `string` | `your_telnyx_api_key_here` | **yes** | TELNYX_API_KEY | — |

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/agent-state-snapshot-restore

# 2. Create .env file
cp .env.example .env
# Edit .env and set your TELNYX_API_KEY

# 3. Install dependencies
npm install

# 4. Run locally (demo mode by default)
npm run dev

# 5. Run smoke test
npm run smoke
```

## API Reference

See [`API.md`](./API.md) for full endpoint documentation including request/response schemas and status codes.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| `401 Unauthorized` on `/snapshot` | Missing or invalid `TELNYX_API_KEY` | Verify `.env` has a valid key; restart the dev server |
| `500 Internal Server Error` on `/restore/{id}` | Snapshot ID not found in SQL registry | Check `/snapshots` to list valid IDs; ensure the snapshot was created successfully |
| `BlobStore put failed` | BlobStore quota exceeded or key collision | Use unique blob keys (timestamp-based); check BlobStore limits in Telnyx dashboard |
| `getState() returns empty object` | Agent has no state set yet | Call `setState()` first or create an initial snapshot after setting state |
| `replaceState() throws` | Restored state is corrupted or incompatible | Verify the snapshot blob was not truncated; re-create the snapshot |

## Agent Discovery

- [Telnyx Agent Signup](https://telnyx.com/agent-signup.md)
- [Team Telnyx AI GitHub](https://github.com/team-telnyx/ai)
- [llms.txt](https://telnyx.com/llms.txt)

## Related Examples

- [agent-state-persistence](../agent-state-persistence) — Basic agent state persistence with StateStore
- [agent-blobstore-demo](../agent-blobstore-demo) — BlobStore CRUD operations
- [agent-sql-registry](../agent-sql-registry) — SQL-backed agent metadata registry
- [agent-websocket-bridge](../agent-websocket-bridge) — Agent SDK WebSocket integration

## Resources

- [Telnyx Developer Docs](https://developers.telnyx.com)
- [Telnyx API Reference](https://developers.telnyx.com/api)
- [Telnyx Edge SDK](https://github.com/team-telnyx/edge-sdk)
- [Telnyx Agent SDK](https://developers.telnyx.com/docs/agent-sdk)
- [Telnyx Pricing](https://telnyx.com/pricing)
