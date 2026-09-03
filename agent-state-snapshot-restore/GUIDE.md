# Agent State Snapshot & Restore — Developer Guide

This guide walks you through the `agent-state-snapshot-restore` sample, a TypeScript Telnyx Edge project that demonstrates how to snapshot an agent's state, persist it to a BlobStore, log metadata to a SQL registry, and restore the agent to a previously saved state.

---

## Prerequisites

Before you begin, ensure you have the following:

- **Node.js 18+** (LTS)
- **npm** or **yarn**
- A **Telnyx API key** — sign up at [telnyx.com](https://telnyx.com) and create a key in the Mission Control Portal
- Basic familiarity with TypeScript and the Telnyx Edge SDK

---

## Environment Setup

### 1. Clone the repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/agent-state-snapshot-restore
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file and fill in your Telnyx API key:

```bash
cp .env.example .env
```

Edit `.env` and replace the placeholder:

```
TELNYX_API_KEY=your_telnyx_api_key_here
```

> **Never commit your real `.env` file.** The `.gitignore` is pre-configured to exclude it.

### 4. Run in demo mode (default)

```bash
npm run dev
```

The server starts on `http://localhost:8080`.

---

## Demo Mode vs Live Mode

This sample runs in **demo mode** by default. In demo mode:

- No real Telnyx API calls are made for SMS or Call Control.
- Snapshot and restore operations are fully functional but use mock data paths.
- All actions are logged to the console for inspection.

To switch to **live mode** (real Telnyx API calls), set the following in your `.env`:

```
DEMO_MODE=false
```

In live mode, the agent will use real Telnyx SDK calls for any Call Control or SMS operations triggered during state transitions. Snapshot/restore logic remains the same — only the underlying communication primitives change.

---

## How It Works — Step by Step

### 1. The SnapshotAgent Class

The core of this sample is the `SnapshotAgent` class, defined in `src/index.ts`. It extends the Telnyx Edge SDK's `Agent` class and uses a `StateStore` to manage internal state.

The agent's state includes fields like `callStatus`, `lastEvent`, `contactInfo`, and any custom data you choose to track. The `StateStore` provides three key methods:

- **`this.getState()`** — Returns the current serialized state object.
- **`this.setState(patch)`** — Merges a partial update into the existing state.
- **`this.replaceState(newState)`** — Replaces the entire state with a new object.

These methods are used in the snapshot and restore endpoints respectively.

### 2. BlobStore for Snapshot Storage

The agent uses `this.blobs` (a `BlobStore` instance provided by the Edge SDK) to store serialized state snapshots. When a snapshot is created:

1. `this.getState()` retrieves the full state.
2. The state is serialized to JSON.
3. `this.blobs.put(key, serializedState)` stores it with a unique blob key.
4. The blob key is returned for later retrieval.

The BlobStore handles chunking, deduplication, and persistence automatically — you never interact with raw storage.

### 3. SQL Snapshot Registry

Every snapshot is logged in a SQL database via the Edge SDK's built-in SQL primitive. The registry table schema is:

```sql
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  timestamp INTEGER,
  blob_key TEXT,
  description TEXT
);
```

When a snapshot is created, a row is inserted with the snapshot ID, timestamp, blob key, and a human-readable description. This allows you to list all snapshots, look up a specific one by ID, and retrieve the associated blob key for restore.

### 4. POST /snapshot — Create a Snapshot

**Endpoint:** `POST /snapshot`

**Request body:**
```json
{
  "description": "State before outbound call"
}
```

**Flow:**
1. The handler calls `agent.getState()` to retrieve the current state.
2. The state is serialized to a JSON string.
3. A unique blob key is generated (e.g., `snapshot-<timestamp>`).
4. `agent.blobs.put(blobKey, serializedState)` stores the snapshot.
5. A SQL `INSERT` logs the snapshot metadata (id, timestamp, blob_key, description).
6. The response returns the snapshot ID and blob key.

**Response:**
```json
{
  "snapshotId": "snap_1719000000000",
  "blobKey": "snapshot-1719000000000",
  "description": "State before outbound call"
}
```

### 5. POST /restore/{id} — Restore from a Snapshot

**Endpoint:** `POST /restore/{id}`

**Flow:**
1. The handler queries the SQL registry: `SELECT blob_key FROM snapshots WHERE id = ?`.
2. If found, `agent.blobs.get(blobKey)` retrieves the serialized state.
3. The JSON is parsed back into a state object.
4. `agent.replaceState(restoredState)` replaces the agent's entire state.
5. The response confirms the restore and includes the restored state.

**Response:**
```json
{
  "restored": true,
  "snapshotId": "snap_1719000000000",
  "state": { "callStatus": "idle", "lastEvent": "call_ended", ... }
}
```

### 6. GET /snapshots — List All Snapshots

**Endpoint:** `GET /snapshots`

**Flow:**
1. Queries the SQL registry: `SELECT id, timestamp, description FROM snapshots ORDER BY timestamp DESC`.
2. Returns a list of all snapshots with their metadata.

**Response:**
```json
[
  { "id": "snap_1719000000000", "timestamp": 1719000000000, "description": "Before call" },
  { "id": "snap_1719000000500", "timestamp": 1719000000500, "description": "After call" }
]
```

### 7. Restore Verification

After a restore, the handler calls `agent.getState()` again to verify the state matches what was restored. This ensures the `replaceState()` call took effect and the agent is operating from the correct state.

---

## Telnyx Primitives Used

| Primitive | Usage |
|---|---|
| **Agent SDK** | `SnapshotAgent extends Agent` — the base class providing state management, blob storage, and SQL access |
| **StateStore** | `this.getState()`, `this.setState()`, `this.replaceState()` — state lifecycle methods |
| **BlobStore** | `this.blobs.put()` / `this.blobs.get()` — durable binary storage for serialized state |
| **SQL DB** | `this.sql.exec()` — snapshot registry with `INSERT` and `SELECT` queries |
| **Call Control** | Referenced in state (e.g., `callStatus`, `lastEvent`) — used in live mode for real call operations |
| **SMS** | Referenced in state (e.g., `contactInfo`) — used in live mode for real SMS operations |

---

## Running the Smoke Test

A smoke test is included to verify the module loads correctly:

```bash
npm run test
```

This test imports the main module, instantiates the `SnapshotAgent`, and verifies that the `getState()`, `setState()`, and `replaceState()` methods are available. It also confirms the SQL table schema is initialized.

---

## API Reference

See `API.md` for the full typed endpoint reference, including request/response schemas and status codes.

---

## Next Steps

- **Telnyx Edge SDK Docs**: https://docs.telnyx.com/edge
- **Agent SDK Guide**: https://docs.telnyx.com/edge/agent-sdk
- **StateStore API**: https://docs.telnyx.com/edge/state-store
- **BlobStore API**: https://docs.telnyx.com/edge/blob-store
- **SQL in Edge**: https://docs.telnyx.com/edge/sql
- **Call Control API**: https://developers.telnyx.com/api/call-control
- **SMS API**: https://developers.telnyx.com/api/sms

Explore related examples in the `telnyx-code-examples` repository:
- `agent-state-machine` — Finite state machine patterns with the Agent SDK
- `agent-call-router` — Dynamic call routing using agent state
- `agent-sms-responder` — Automated SMS responses with state tracking
