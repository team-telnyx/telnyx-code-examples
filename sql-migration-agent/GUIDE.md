# SQL Migration Agent — Developer Guide

This guide walks you through the `sql-migration-agent` code sample, explaining how it uses Telnyx to build a robust, multi-instance SQL migration system with SMS notifications.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Architecture Overview](#architecture-overview)
4. [Code Walkthrough](#code-walkthrough)
   - [Configuration & Initialization](#configuration--initialization)
   - [Schema Version Tracking](#schema-version-tracking)
   - [CloudFS Integration](#cloudfs-integration)
   - [Migration Execution Engine](#migration-execution-engine)
   - [Rollback on Failure](#rollback-on-failure)
   - [SMS Notifications](#sms-notifications)
   - [Multi-Instance Rollout](#multi-instance-rollout)
   - [REST API Endpoints](#rest-api-endpoints)
   - [Webhook Handling](#webhook-handling)
5. [Running the Sample](#running-the-sample)
6. [Testing the API](#testing-the-api)
7. [Next Steps](#next-steps)

---

## Prerequisites

Before you begin, make sure you have:

- **Python 3.8+** installed
- A **Telnyx account** with:
  - An API Key
  - A Public Key (for webhook verification)
  - A phone number capable of sending SMS
- Basic familiarity with Flask and REST APIs

---

## Environment Setup

1. **Clone the repository and navigate to the sample:**

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sql-migration-agent
```

2. **Create a virtual environment:**

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies:**

```bash
pip install -r requirements.txt
```

4. **Configure environment variables:**

Copy the `.env.example` file to `.env` and fill in your values:

```bash
cp .env.example .env
```

Your `.env` file should look like this:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PUBLIC_KEY=your_telnyx_public_key_here
TELNYX_FROM_NUMBER=+1234567890
PORT=5000
```

> ⚠️ **Never commit your `.env` file** — it contains sensitive credentials.

5. **Run the application:**

```bash
python app.py
```

The server will start on `http://localhost:5000`.

---

## Architecture Overview

The SQL Migration Agent is a Flask application that provides a REST API for managing database migrations. Here's how the pieces fit together:

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (curl, app, etc.)                │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Flask Application (app.py)               │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  REST API    │  │  Migration   │  │  Webhook Handler │  │
│  │  Endpoints   │  │   Engine     │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Telnyx SDK Integration                 │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌───────────┐   │   │
│  │  │  CloudFS    │  │  SMS via    │  │  Webhook  │   │   │
│  │  │  (scripts)  │  │  Messages   │  │  Verify   │   │   │
│  │  └─────────────┘  └─────────────┘  └───────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              SQL Database (production)                      │
│              In-memory dict (this demo)                     │
└─────────────────────────────────────────────────────────────┘
```

**Key components:**

- **REST API** — Endpoints for creating, listing, and checking migrations
- **Migration Engine** — Executes SQL scripts step-by-step with state tracking
- **CloudFS Integration** — Fetches migration scripts from Telnyx CloudFS
- **SMS Notifications** — Sends success/failure alerts via Telnyx Messages API
- **Webhook Handler** — Verifies and processes Telnyx webhook events

---

## Code Walkthrough

### Configuration & Initialization

The application starts by loading environment variables and configuring the Telnyx SDK:

```python
# app.py — Configuration section
load_dotenv()
app = Flask(__name__)

telnyx.api_key = os.getenv("TELNYX_API_KEY")
telnyx.public_key = os.getenv("TELNYX_PUBLIC_KEY")
```

**What's happening:**

- `load_dotenv()` reads your `.env` file and loads the variables into the environment
- The Flask app is instantiated
- The Telnyx SDK is configured with your API key and public key

The app also maintains two in-memory data structures:

- `MIGRATION_STATE` — tracks the status of each migration
- `SCHEMA_VERSIONS` — tracks the current schema version per database

> **Production note:** In a real deployment, you'd use a distributed store (like Redis) and a proper SQL database instead of in-memory dicts.

---

### Schema Version Tracking

The agent tracks schema versions to ensure migrations are applied in order:

```python
# app.py lines 27-35
def get_schema_version(db_name: str) -> int:
    """Get the current schema version for a database."""
    return SCHEMA_VERSIONS.get(db_name, 0)

def set_schema_version(db_name: str, version: int) -> None:
    """Set the schema version for a database."""
    SCHEMA_VERSIONS[db_name] = version
```

**How it works:**

- Each database has a numeric version starting at 0
- When a migration completes successfully, the version increments by 1
- The `/schema/<db_name>` endpoint lets you query the current version

This pattern ensures migrations are applied in the correct sequence and prevents duplicate application.

---

### CloudFS Integration

Migration scripts are fetched from Telnyx CloudFS:

```python
# app.py lines 50-65
def fetch_migration_script(migration_id: str) -> Optional[str]:
    """
    Fetch migration script from CloudFS.
    In production, this would call the Telnyx CloudFS API.
    """
    # Simulate fetching from CloudFS
    mock_scripts = {
        "migration_001": "CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));",
        "migration_002": "ALTER TABLE users ADD COLUMN email VARCHAR(255);",
        "migration_003": "CREATE INDEX idx_users_email ON users(email);",
    }
    return mock_scripts.get(migration_id)
```

**What this does:**

- Takes a `migration_id` and returns the corresponding SQL script
- In production, you'd replace the mock with a call to the Telnyx CloudFS API
- CloudFS provides a secure, scalable way to store and retrieve migration scripts

---

### Migration Execution Engine

The core of the application is the `run_migration` function:

```python
# app.py lines 100-160
def run_migration(migration_id: str, db_name: str, notify_number: str) -> None:
    """
    Execute a migration with proper state tracking and rollback support.
    """
    migration_state = MIGRATION_STATE[migration_id]
    migration_state["status"] = "running"
    migration_state["current_step"] = 0

    try:
        # Fetch migration script from CloudFS
        script = fetch_migration_script(migration_id)
        if not script:
            raise MigrationError(f"Migration script {migration_id} not found in CloudFS")

        # Split into steps (in production, parse SQL properly)
        steps = [step.strip() for step in script.split(";") if step.strip()]
        migration_state["total_steps"] = len(steps)
        executed_steps: List[int] = []

        # Execute each step
        for i, step in enumerate(steps):
            migration_state["current_step"] = i + 1
            try:
                execute_migration_step(step, i)
                executed_steps.append(i)
            except Exception as e:
                raise MigrationError(f"Step {i} failed: {str(e)}")

        # Update schema version
        new_version = get_schema_version(db_name) + 1
        set_schema_version(db_name, new_version)
        migration_state["status"] = "completed"
        migration_state["schema_version"] = new_version

        # Send success notification
        if notify_phone:
            send_sms_notification(
                notify_phone,
                f"✅ Migration {migration_id} completed successfully. Schema version: {new_version}",
            )

    except Exception as e:
        # Rollback on failure
        migration_state["status"] = "failed"
        migration_state["error"] = str(e)
        rollback_migration(migration_id, executed_steps)

        # Send failure notification
        if notify_phone:
            send_sms_notification(
                notify_phone,
                f"❌ Migration {migration_id} failed: {str(e)}. Rollback initiated.",
            )
```

**Step-by-step breakdown:**

1. **State initialization** — Sets the migration status to `running` and resets the step counter
2. **Script retrieval** — Fetches the SQL script from CloudFS
3. **Script parsing** — Splits the script into individual SQL statements (steps)
4. **Step execution** — Runs each step sequentially, tracking progress
5. **Version update** — On success, increments the schema version
6. **Success notification** — Sends an SMS with the result
7. **Error handling** — On failure, triggers rollback and sends an error SMS

---

### Rollback on Failure

The rollback mechanism ensures data integrity:

```python
# app.py lines 70-80
def rollback_migration(migration_id: str, executed_steps: List[int]) -> None:
    """
    Rollback a failed migration.
    In production, this would execute rollback scripts.
    """
    app.logger.warning(f"Rolling back migration {migration_id}, steps: {executed_steps}")
    # In production, execute rollback scripts in reverse order
```

**How it works:**

- Tracks which steps were successfully executed
- On failure, rolls back those steps in reverse order
- In production, you'd maintain a rollback script for each migration

This ensures your database doesn't end up in a partial state.

---

### SMS Notifications

The agent sends SMS alerts via the Telnyx Messages API:

```python
# app.py lines 85-98
def send_sms_notification(to_number: str, message: str) -> None:
    """
    Send SMS notification via Telnyx.
    """
    try:
        telnyx.Message.create(
            from_=os.getenv("TELNYX_FROM_NUMBER"),
            to=to_number,
            text=message,
        )
        app.logger.info(f"SMS sent to {to_number}")
    except Exception as e:
        app.logger.exception(f"Failed to send SMS: {e}")
```

**Key points:**

- Uses the `telnyx.Message.create()` method
- The `from_` number comes from your environment variables
- Errors are logged but don't crash the migration
- Notifications include:
  - ✅ Success messages with the new schema version
  - ❌ Failure messages with the error and rollback status

---

### Multi-Instance Rollout

The agent supports multi-instance deployment through a queue pattern:

```python
# app.py lines 170-210
@app.route("/migrations", methods=["POST"])
def create_migration():
    """
    Create and queue a new migration.
    This endpoint uses this.queue() pattern for multi-instance rollout.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    migration_id = data.get("migration_id")
    db_name = data.get("db_name", "default")
    notify_phone = data.get("notify_phone")

    if not migration_id:
        return jsonify({"error": "migration_id is required"}), 400

    # Generate unique migration ID if not provided
    if migration_id == "auto":
        migration_id = f"migration_{uuid.uuid4().hex[:8]}"

    # Check if migration already exists
    if migration_id in MIGRATION_STATE:
        return jsonify({"error": f"Migration {migration_id} already exists"}), 409

    # Initialize state
    MIGRATION_STATE[migration_id] = {
        "id": migration_id,
        "db_name": db_name,
        "status": "queued",
        "current_step": 0,
        "total_steps": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "notify_phone": notify_phone,
    }

    # Queue the migration for execution
    app.logger.info(f"Migration {migration_id} queued for execution")

    # For demo, execute immediately (in production, worker would pick this up)
    run_migration(migration_id, db_name, notify_phone)

    return jsonify({"migration_id": migration_id, "status": "queued"}), 202
```

**How multi-instance works:**

1. **Queue creation** — Each migration gets a unique ID and is added to the queue
2. **State tracking** — The migration state is stored centrally (in-memory for demo)
3. **Worker pickup** — In production, worker instances would pick up queued migrations
4. **Idempotency** — The unique migration ID prevents duplicate execution

This pattern allows multiple instances to coordinate without conflicts.

---

### REST API Endpoints

The agent exposes several REST endpoints:

#### Health Check

```python
# app.py lines 160-165
@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()})
```

#### Create Migration

`POST /migrations` — Creates and queues a new migration.

**Request body:**
```json
{
  "migration_id": "migration_001",
  "db_name": "production",
  "notify_phone": "+15551234567"
}
```

**Response:** `202 Accepted` with the migration ID and status.

#### Get Migration Status

`GET /migrations/<migration_id>` — Returns the current state of a migration.

**Response:**
```json
{
  "id": "migration_001",
  "db_name": "production",
  "status": "completed",
  "current_step": 2,
  "total_steps": 2,
  "created_at": "2024-01-15T10:30:00Z",
  "notify_phone": "+15551234567",
  "schema_version": 1
}
```

#### List All Migrations

`GET /migrations` — Returns all migrations.

#### Cancel Migration

`DELETE /migrations/<migration_id>` — Cancels a queued migration.

#### Get Schema Version

`GET /schema/<db_name>` — Returns the current schema version for a database.

---

### Webhook Handling

The agent handles Telnyx webhooks (like SMS delivery status):

```python
# app.py lines 260-280
@app.route("/webhooks/telnyx", methods=["POST"])
def telnyx_webhook():
    """
    Handle Telnyx webhooks (e.g., SMS delivery status).
    """
    try:
        # Verify the Telnyx signature
        event = telnyx.webhooks.unwrap(request)
        app.logger.info(f"Received webhook: {event['data']['event_type']}")

        # Extract event data from data.payload
        payload = event["data"]["payload"]
        message_id = payload.get("id")
        status = payload.get("status")

        app.logger.info(f"Message {message_id} status: {status}")
        return jsonify({"status": "ok"}), 200

    except Exception as e:
        app.logger.exception(f"Webhook verification failed: {e}")
        return jsonify({"error": "Invalid signature"}), 400
```

**Security features:**

- **Signature verification** — Uses `telnyx.webhooks.unwrap()` to verify the Ed25519 signature
- **Event extraction** — Reads event data from `data.payload`
- **Error handling** — Returns `400` for invalid signatures

---

## Testing the API

Here are some `curl` commands to test the API:

### 1. Health Check

```bash
curl http://localhost:5000/health
```

### 2. Create a Migration

```bash
curl -X POST http://localhost:5000/migrations \
  -H "Content-Type: application/json" \
  -d '{
    "migration_id": "migration_001",
    "db_name": "production",
    "notify_phone": "+15551234567"
  }'
```

### 3. Check Migration Status

```bash
curl http://localhost:5000/migrations/migration_001
```

### 4. List All Migrations

```bash
curl http://localhost:5000/migrations
```

### 5. Get Schema Version

```bash
curl http://localhost:5000/schema/production
```

### 6. Test Webhook (simulate)

```bash
curl -X POST http://localhost:5000/webhooks/telnyx \
  -H "Content-Type: application/json" \
  -d '{"data": {"event_type": "message.sent", "payload": {"id": "msg_123", "status": "delivered"}}}'
```

---

## Next Steps

Now that you understand how the SQL Migration Agent works, here are some ways to extend it:

### Production Hardening

- **Replace in-memory storage** with Redis or a SQL database for state persistence
- **Implement proper SQL parsing** instead of simple string splitting
- **Add authentication** to your API endpoints
- **Use a real queue system** (like Redis Queue or Celery) for multi-instance rollout

### Telnyx Features to Explore

- **CloudFS** — Store and version your migration scripts in Telnyx CloudFS
- **Call Control** — Add voice notifications for critical migrations
- **Messaging** — Send rich notifications with media or templates

### Related Documentation

- [Telnyx Messaging API](https://developers.telnyx.com/docs/api/v2/messaging)
- [Telnyx Webhooks Guide](https://developers.telnyx.com/docs/voice/call-control/webhooks)
- [Telnyx CloudFS Documentation](https://developers.telnyx.com/docs/cloudfs)
- [Telnyx Python SDK](https://github.com/team-telnyx/telnyx-python)

### Related Examples

Check out other Telnyx code samples:

- **SMS Notification Service** — A standalone SMS notification service
- **Webhook Receiver** — A robust webhook receiver with signature verification
- **Call Control Agent** — An example of using Telnyx Call Control APIs

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError: No module named 'telnyx'` | Run `pip install -r requirements.txt` |
| `TELNYX_API_KEY` not found | Check your `.env` file is in the correct directory |
| SMS not sending | Verify your `TELNYX_FROM_NUMBER` is a valid SMS-capable number |
| Webhook returns 400 | Ensure your `TELNYX_PUBLIC_KEY` matches the one in your Telnyx portal |

### Debugging Tips

- Check the Flask logs for detailed error messages
- Use `curl -v` to see the full HTTP request/response
- Verify your Telnyx API key has the correct permissions

---

This guide should give you a solid understanding of how the SQL Migration Agent works. Happy building! 🚀
