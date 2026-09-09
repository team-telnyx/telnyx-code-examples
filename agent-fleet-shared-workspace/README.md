# Agent Fleet Shared Workspace (CloudFS)

Five Telnyx Agent SDK actors collaborate through one shared Telnyx CloudFS filesystem. Each actor reads artifacts produced by the previous actor, writes its own result with standard POSIX file APIs, records fleet-wide metadata in an actor-backed SQL registry, and broadcasts state changes to connected WebSocket clients.

## Architecture

```text
CloudFS mounted at /mnt/agentfs
└── shared/
    ├── report.md       ← agent-1 (writer)
    ├── analysis.json   ← agent-2 (analyst)
    ├── review.md       ← agent-3 (reviewer)
    ├── summary.md      ← agent-4 (summarizer)
    └── manifest.json   ← agent-5 (publisher)

Every FleetAgent ──RPC──► FleetRegistry
                            ├── agents table
                            └── files table

Every FleetAgent ──WebSocket──► connected dashboards receive state patches
```

CloudFS is a POSIX filesystem mounted with JuiceFS. It is not an `env` binding and does not expose a `ctx.cloudfs` API. The application receives only the mount path and uses `node:fs/promises`, so every process mounting the same filesystem sees the same artifacts with close-to-open consistency.

## What this sample demonstrates

| Requirement | Implementation |
|---|---|
| Five agent instances | `agent-1` through `agent-5`, each a separate `FleetAgent` actor |
| Shared CloudFS reads and writes | Atomic POSIX writes and ordinary reads under one configured mount |
| SQL metadata | `FleetRegistry` stores the agent registry and file operation history in embedded SQL |
| WebSocket communication | `AgentSocketServer` broadcasts every agent state patch to connected clients |
| Safe shared paths | Traversal protection prevents artifacts from escaping the shared directory |

## Why Telnyx

Telnyx brings durable actors, embedded SQL, real-time WebSockets, and shared CloudFS storage together on its AI Communications Infrastructure. That lets a fleet coordinate close to users without operating a separate actor runtime, database, socket service, or shared filesystem.

## Prerequisites

- Node.js 22+
- Telnyx Edge CLI v0.5.0+ and an authenticated Telnyx account
- A Telnyx CloudFS filesystem
- JuiceFS Community Edition on a Linux host/container with FUSE, or an existing CloudFS mount supplied to the application

CloudFS setup follows the official guide: <https://developers.telnyx.com/docs/edge-compute/cloudfs/quickstart>.

## 1. Create and mount CloudFS

Create a filesystem. Save the returned credential-bearing `meta_url`; it is shown only on create or token rotation.

```bash
curl -X POST https://api.telnyx.com/v2/storage/cloudfs \
  -H "Authorization: Bearer $TELNYX_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"agent-fleet-workspace","region":"us-east-1"}'
```

Mount the already-formatted filesystem with JuiceFS:

```bash
export META_URL='postgres://...tokenized URL returned by create...'
export AWS_ACCESS_KEY_ID="$TELNYX_API_KEY"
export AWS_SECRET_ACCESS_KEY="cloudfs-unused"

sudo mkdir -p /mnt/agentfs
sudo chown "$(id -u):$(id -g)" /mnt/agentfs
juicefs mount --no-usage-report --background --log /tmp/juicefs.log \
  "$META_URL" /mnt/agentfs
```

Do not run `juicefs format` on a filesystem whose status is `ready`, and never edit the underlying `cloudfs-fs-*` bucket directly.

## 2. Install and configure

```bash
cd agent-fleet-shared-workspace
npm install
cp .env.example .env
```

Set `CLOUDFS_MOUNT_PATH` to the absolute mount point. `CLOUDFS_WORKSPACE_DIR` is the directory used inside that mount.

```dotenv
CLOUDFS_MOUNT_PATH=/mnt/agentfs
CLOUDFS_WORKSPACE_DIR=/shared
```

## 3. Run

```bash
npm start
```

The start script checks `TELNYX_EDGE_BIN`, then `~/bin/telnyx-edge`, then the shell `PATH`. Docker Desktop must be running, and the CLI's local actor and function runtime images must be available.

For a local recording, CloudFS-compatible filesystem behavior can be demonstrated with a writable local mount path. Create `.env` from the example and set:

```dotenv
CLOUDFS_MOUNT_PATH=/tmp/agentfs
CLOUDFS_WORKSPACE_DIR=/shared
```

Then open <http://localhost:8787>. The dashboard is designed for a 16:9 recording and runs the real actor workflow at a visible pace. A production CloudFS demonstration uses the same application code; only `CLOUDFS_MOUNT_PATH` changes to the JuiceFS mount.

## Demo

### Guided web showcase

Open the root page and select **Run agent fleet**. The UI creates a fresh run ID, then shows each actor reading and writing through the shared workspace. Agent state, SQL operation history, generated files, and artifact contents update throughout the handoff. Repeating the demo creates a separate `runs/<runId>/` workspace so every take starts cleanly without deleting earlier data.

### API

Run the complete five-agent handoff:

```bash
curl -X POST http://localhost:8787/demo
```

For a paced, isolated run, provide a run ID and delay in milliseconds:

```bash
curl -X POST http://localhost:8787/demo \
  -H 'Content-Type: application/json' \
  -d '{"runId":"recording-take-01","paceMs":1100}'
```

The response contains five registered agents and the read/write history. The resulting files remain in `/mnt/agentfs/shared` and are visible from every other host that mounts the same CloudFS filesystem.

Write an artifact as any agent:

```bash
curl -X POST http://localhost:8787/artifacts \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"agent-6","role":"researcher","path":"research/notes.md","content":"Shared notes"}'
```

Read it from a different agent:

```bash
curl 'http://localhost:8787/artifacts/research%2Fnotes.md?agent=agent-2'
```

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Open the guided recording dashboard |
| `POST` | `/demo` | Run the five-agent handoff; optionally accept `runId` and `paceMs` |
| `POST` | `/artifacts` | Initialize an agent and write an artifact |
| `GET` | `/artifacts` | List files; optionally scope results with `?runId=` |
| `GET` | `/artifacts/:path` | Read an artifact as the selected `?agent=` |
| `GET` | `/agents/:id` | Get one actor's current state |
| `GET` | `/fleet` | List registered agents and SQL history; optionally scope with `?runId=` |
| `GET` | `/health/liveness` | Liveness check |
| `GET` | `/health/readiness` | Readiness check |

Agent SDK clients can connect to an individual actor's runtime WebSocket route and subscribe to state patches. The server side is implemented with `AgentSocketServer`; connected dashboards see `idle`, `reading`, `writing`, `done`, and `error` transitions in real time.

## Agent discovery

Each request resolves an actor by its stable `agentId`. The `FleetRegistry` records that ID, its role, and its latest status in embedded SQL, so `GET /fleet` provides the fleet-wide discovery view while `GET /agents/:id` addresses one actor directly.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Readiness returns `503` | The CloudFS mount is missing or inaccessible | Mount CloudFS and verify `CLOUDFS_MOUNT_PATH` points to it |
| `ENOENT` while reading | The requested artifact has not been written | Run `POST /demo` or write the artifact first |
| A path is rejected | It is absolute or contains `..` traversal | Use a path relative to the shared workspace |
| Changes are not visible on another host | The processes mounted different filesystems or mount points | Mount the same CloudFS filesystem for every process |

## Production notes

- Mount the same CloudFS filesystem into every process that hosts fleet actors.
- Writes use temporary files plus atomic rename, avoiding readers observing partial content.
- Concurrent writes to the same file are last-writer-wins unless clients coordinate with CloudFS-supported `flock`/`fcntl` locks.
- Treat `META_URL` and `TELNYX_API_KEY` as secrets. Do not commit either value.

## Related examples

- [Edge call transcription agent](../edge-call-transcription-agent/) combines Agent SDK state with live call transcription.
- [Edge customer agent](../edge-customer-agent-typescript/) demonstrates one durable actor per customer.
- [Agent with tool calling](../agent-with-tool-calling/) shows an Agent SDK actor invoking communications tools.
