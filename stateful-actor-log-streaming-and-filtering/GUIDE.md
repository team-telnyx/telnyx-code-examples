# Guide: Stateful Actor Log Streaming & Filtering

This guide walks you through the **Stateful Actor Log Streaming & Filtering** sample — a Python/Flask application that simulates the Telnyx Edge Compute Stateful Actor observability workflow. You'll deploy a `Counter` actor, invoke it, and inspect both historical invocation records and live runtime logs using HTTP endpoints that mirror the `telnyx-edge actors logs` CLI commands.

---

## Prerequisites

Before you begin, ensure you have:

- **Python 3.9+** installed locally
- **pip** (Python package manager)
- **Git** (optional, for cloning)
- A terminal or command prompt

No Telnyx account or API key is required to run the sample in **demo mode** (the default). To switch to live mode later, you'll need a [Telnyx account](https://portal.telnyx.com/) and an API key.

---

## Environment Setup

### 1. Clone and Enter the Directory

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/stateful-actor-log-streaming-and-filtering
```

### 2. Create a Virtual Environment (Recommended)

```bash
python -m venv venv
source venv/bin/activate    # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure Environment Variables

Copy the example environment file and review the defaults:

```bash
cp .env.example .env
```

The `.env.example` contains:

```env
# Telnyx API Key (required for live mode; leave blank for demo mode)
TELNYX_API_KEY=your_telnyx_api_key_here

# Path to the SQLite database file (default: actor_logs.db)
DB_PATH=actor_logs.db

# Enable demo mode (true/false). When true, no real Telnyx API calls are made.
DEMO_MODE=true

# Port the Flask app listens on
PORT=8080
```

> **Demo Mode (default):** `DEMO_MODE=true` — the app runs entirely locally with no external API calls. All logs are stored in a local SQLite database.
>
> **Live Mode:** Set `DEMO_MODE=false` and provide a valid `TELNYX_API_KEY`. In this sample, live mode is reserved for future integration with the Telnyx Edge Compute API. For now, the app functions identically in both modes — the distinction is documented for when real Edge Actor deployment is supported.

---

## Running the Application

Start the Flask server:

```bash
python app.py
```

You should see output like:

```
 * Serving Flask app 'app'
 * Running on http://0.0.0.0:8080
```

Verify the server is running:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"status": "ok", "demo_mode": true}
```

---

## Step-by-Step Walkthrough

### Step 1: Understanding the Database Layer

The application uses a **real SQLite database** (file-based, not in-memory) to persist actor state and logs. This is defined in the `init_db()` function, which creates three tables:

| Table                | Purpose                                                                 |
|----------------------|-------------------------------------------------------------------------|
| `actor_instances`    | Stores the current state of each actor instance (e.g., `{"count": 5}`) |
| `invocation_logs`    | Platform-level records of each method call (timestamp, duration, etc.) |
| `runtime_logs`       | Console output generated inside actor method bodies                    |

The database path is configurable via the `DB_PATH` environment variable (default: `actor_logs.db`).

> **Why SQLite?** This simulates the persistence layer that Telnyx Edge Compute provides for Stateful Actors. In production, the Edge runtime manages durable storage automatically — here, SQLite gives us real, queryable persistence for demonstration purposes.

### Step 2: The Stateful Actor — `CounterActor`

The `CounterActor` class (defined in the "Stateful Actor: Counter" section) simulates a Telnyx Edge Stateful Actor:

```python
class CounterActor:
    def __init__(self, actor_type: str, instance_id: str) -> None:
        self.actor_type = actor_type
        self.instance_id = instance_id

    def increment(self, payload: dict[str, Any]) -> dict[str, Any]:
        ...
```

When `increment()` is called:

1. It reads the current state from the `actor_instances` table (or initializes it to `{"count": 0}` if the instance doesn't exist yet).
2. It increments the counter.
3. It writes the updated state back to the database.
4. It logs a **runtime log** entry: `"Counter incremented to {count}"` — this simulates a `console.log()` call inside the actor's method body.
5. It returns the new count and instance ID.

Each actor instance is identified by a unique `instance_id`. If you don't provide one when invoking, the app generates a UUID automatically.

### Step 3: Invoking the Actor

The `/actors/<actor_type>/invoke` endpoint (POST) simulates triggering an actor method via HTTP or RPC:

```bash
curl -X POST http://localhost:8080/actors/Counter/invoke \
  -H "Content-Type: application/json" \
  -d '{"method": "increment"}'
```

Response:

```json
{
  "result": {"count": 1, "instance_id": "a1b2c3d4-..."},
  "instance_id": "a1b2c3d4-...",
  "duration_ms": 3
}
```

Each invocation:

- Creates or retrieves the actor instance
- Calls the `increment` method
- Records an **invocation log** (platform record with timestamp, instance ID, method name, outcome, and duration)
- Returns the result

Try invoking multiple times to generate traffic:

```bash
for i in {1..5}; do
  curl -X POST http://localhost:8080/actors/Counter/invoke \
    -H "Content-Type: application/json" \
    -d '{"method": "increment"}'
done
```

### Step 4: Viewing Historical Invocation Logs

The `/actors/<actor_type>/logs` endpoint (GET) mirrors the CLI command:

```
telnyx-edge actors logs Counter --type invocations
```

```bash
curl "http://localhost:8080/actors/Counter/logs?type=invocations"
```

Response:

```json
{
  "actor_type": "Counter",
  "log_type": "invocations",
  "count": 5,
  "logs": [
    {
      "id": "...",
      "actor_type": "Counter",
      "instance_id": "a1b2c3d4-...",
      "method_name": "increment",
      "outcome": "success",
      "duration_ms": 3,
      "timestamp": "2025-01-15T12:00:00.123456+00:00",
      "payload": "{}"
    },
    ...
  ]
}
```

Each invocation log record contains:

| Field          | Description                                      |
|----------------|--------------------------------------------------|
| `timestamp`    | When the invocation occurred (ISO 8601)          |
| `instance_id`  | Which actor instance handled the call            |
| `method_name`  | The method that was invoked (`increment`)        |
| `outcome`      | `success` or `error`                             |
| `duration_ms`  | How long the method took to execute              |
| `payload`      | The input payload sent to the method             |

### Step 5: Filtering by Instance

You can filter invocation logs to a specific actor instance using the `instance` query parameter:

```bash
curl "http://localhost:8080/actors/Counter/logs?type=invocations&instance=a1b2c3d4-..."
```

This mirrors:

```
telnyx-edge actors logs Counter --type invocations --instance <id>
```

Only records matching the specified `instance_id` will be returned.

### Step 6: Viewing Runtime Logs (Console Output)

Runtime logs capture the `console.log()`-equivalent output from inside the actor's method body. Retrieve them with:

```bash
curl "http://localhost:8080/actors/Counter/logs?type=runtime"
```

Response:

```json
{
  "actor_type": "Counter",
  "log_type": "runtime",
  "count": 5,
  "logs": [
    {
      "id": "...",
      "actor_type": "Counter",
      "instance_id": "a1b2c3d4-...",
      "method_name": "increment",
      "message": "Counter incremented to 1",
      "timestamp": "2025-01-15T12:00:00.123456+00:00"
    },
    ...
  ]
}
```

### Step 7: Live Streaming Runtime Logs (`--tail`)

The `/actors/<actor_type>/logs/stream` endpoint (GET) provides **Server-Sent Events (SSE)** streaming, mirroring:

```
telnyx-edge actors logs Counter --type runtime --tail
```

Open a streaming connection in one terminal:

```bash
curl -N "http://localhost:8080/actors/Counter/logs/stream?type=runtime"
```

In another terminal, invoke the actor:

```bash
curl -X POST http://localhost:8080/actors/Counter/invoke \
  -H "Content-Type: application/json" \
  -d '{"method": "increment"}'
```

You'll see the runtime log appear in real-time in the streaming terminal:

```
data: {"id": "...", "actor_type": "Counter", "instance_id": "...", "method_name": "increment", "message": "Counter incremented to 6", "timestamp": "2025-01-15T12:00:05.678901+00:00"}
```

Press `Ctrl+C` to stop the stream.

You can also stream invocation logs:

```bash
curl -N "http://localhost:8080/actors/Counter/logs/stream?type=invocations"
```

And filter the stream by instance:

```bash
curl -N "http://localhost:8080/actors/Counter/logs/stream?type=runtime&instance=a1b2c3d4-..."
```

### Step 8: Listing Actor Instances

To see all instances of a given actor type and their current state:

```bash
curl "http://localhost:8080/actors/Counter/instances"
```

Response:

```json
{
  "actor_type": "Counter",
  "instances": [
    {
      "instance_id": "a1b2c3d4-...",
      "state": "{\"count\": 5}",
      "created_at": "2025-01-15T12:00:00.000000+00:00"
    }
  ]
}
```

### Step 9: Listing All Deployed Actor Types

```bash
curl "http://localhost:8080/actors"
```

Response:

```json
{"actors": ["Counter"]}
```

---

## Error Handling

The application follows production-safe error handling practices:

- **Invalid log type:** If you pass `type=invalid`, the API returns a `400` with a clear error message: `"Invalid log type. Use 'invocations' or 'runtime'."`
- **Unsupported method:** If you invoke a method other than `increment`, you get a `400`: `"Method 'foo' not supported"`.
- **Invocation failure:** If the actor method raises an exception, the app logs the full traceback via `app.logger.exception()` and returns a generic `500` error without leaking internal details.
- **Missing actor type:** If you query logs for an actor type that has never been invoked, you get an empty list (`count: 0`) rather than an error — this mirrors how the real CLI behaves when no data exists yet.

---

## Running the Smoke Test

A smoke test is included to verify the application loads and all routes respond correctly:

```bash
python smoke_test.py
```

Expected output:

```
✅ Module imports successfully
✅ Health check passed
✅ Actor invocation works
✅ Invocation logs query works
✅ Runtime logs query works
✅ Instance listing works
✅ Actor listing works
✅ Log streaming endpoint works
All smoke tests passed!
```

---

## How This Maps to Telnyx Edge Primitives

| Telnyx Edge Concept         | This Sample's Equivalent                              |
|-----------------------------|-------------------------------------------------------|
| **Stateful Actor**          | `CounterActor` class with persistent state in SQLite  |
| **Invocation Record**       | `invocation_logs` table — timestamp, method, duration |
| **Runtime Log**             | `runtime_logs` table — console.log-style messages     |
| **Instance ID**             | UUID per actor instance, stored in `actor_instances`  |
| **CLI: `actors logs`**      | `/actors/<type>/logs` GET endpoint                    |
| **CLI: `--type`**           | `type` query parameter (`invocations` or `runtime`)   |
| **CLI: `--tail`**           | `/actors/<type>/logs/stream` SSE endpoint             |
| **CLI: `--instance`**       | `instance` query parameter for filtering              |
| **Durable Storage**         | SQLite file (`actor_logs.db`)                         |

---

## Next Steps

- **Read the [Telnyx Edge Compute Stateful Actors documentation](https://developers.telnyx.com/docs/edge-compute/stateful-actors/observability/logs)** for the full CLI reference and live API details.
- **Explore the [Telnyx Edge Compute guides](https://developers.telnyx.com/docs/edge-compute)** to learn about deploying real Stateful Actors with the `telnyx-edge ship` command.
- **Check out related samples** in the `telnyx-code-examples` repository for more patterns: actor scheduling, KV storage, and Agent-based workflows.
- **Switch to live mode** by setting `DEMO_MODE=false` and providing a valid `TELNYX_API_KEY` in your `.env` file — then deploy a real `Counter` actor to Telnyx Edge and point this app at the Edge observability API.
- **Extend the actor** by adding more methods (e.g., `reset`, `decrement`) and observe how invocation logs and runtime logs capture each call.
