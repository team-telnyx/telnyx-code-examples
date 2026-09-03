# SQL Migration Agent — Developer Guide

This guide walks you through the **SQL Migration Agent**, a TypeScript Telnyx Edge project that orchestrates SQL schema migrations across multiple actor instances with version tracking, rollback support, and SMS notifications.

---

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** v18+ (with npm)
- **Telnyx Account** — [Sign up](https://portal.telnyx.com/sign-up) for a free account
- **Telnyx API Key** — Generate one in the [Telnyx Portal](https://portal.telnyx.com/api-keys)
- **Telnyx Phone Number** — A number capable of sending SMS (purchase in the [Telnyx Portal](https://portal.telnyx.com/numbers))
- **Edge-compatible SQL Database** — A database accessible from the Edge runtime (e.g., Neon, Supabase, or a managed PostgreSQL instance)

---

## Environment Setup

### 1. Clone the Repository

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sql-migration-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` to include your Telnyx API key and phone number:

```env
TELNYX_API_KEY=your_telnyx_api_key_here
TELNYX_PHONE_NUMBER=+1555XXXXXXXX
MIGRATION_SCRIPTS_PATH=/migrations
```

> **Note:** Never commit your `.env` file. It is listed in `.gitignore`.

---

## Project Structure

```
sql-migration-agent/
├── src/
│   └── index.ts          # Main entry point — defines the MigrationAgent and HTTP handler
├── smoke_test.ts         # Smoke test verifying the module loads without error
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration (strict mode, ES2022)
├── .env.example          # Placeholder environment variables
├── .gitignore
├── README.md
├── API.md
└── GUIDE.md              # This file
```

---

## How It Works

The SQL Migration Agent is built on the **Telnyx Edge SDK** and uses several primitives:

### 1. Agent SDK — `MigrationAgent`

The core of the sample is the `MigrationAgent` class, which extends the Telnyx `Agent` base class. The agent is responsible for:

- Reading the current schema version from the SQL database
- Fetching migration scripts from CloudFS
- Applying each migration script in order
- Updating the schema version table after each successful migration
- Rolling back on failure
- Sending SMS notifications via the Telnyx binding

The agent uses `this.queue()` to distribute migration tasks across multiple instances, enabling parallel rollout.

### 2. SQL Database — Schema Version Tracking

The agent maintains a `schema_versions` table in the SQL database:

```sql
CREATE TABLE IF NOT EXISTS schema_versions (
    id INTEGER PRIMARY KEY,
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL,
    script_name TEXT NOT NULL
);
```

Each migration script is associated with a version number. The agent reads the latest version, applies the next script, and records the new version.

### 3. CloudFS — Shared Migration Scripts

Migration scripts are stored in a shared CloudFS directory (e.g., `/migrations`). The agent reads scripts from this directory using the Edge SDK's CloudFS primitives, ensuring all instances use the same set of scripts.

### 4. Telnyx Binding — SMS Notification

The agent uses the `this.env.TELNYX` binding to send SMS notifications:

- **On completion:** "Migration to version X completed successfully."
- **On failure:** "Migration to version X failed. Rollback initiated."

---

## Architecture

```
POST /migrate
    │
    ▼
MigrationAgent.queue() per instance
    │
    ├── Read current version from SQL DB
    ├── Fetch migration script from CloudFS
    ├── Apply migration to SQL DB
    ├── Update schema_versions table
    ├── On failure → Rollback
    │
    └── On all instances done → SMS via this.env.TELNYX.messages.send()
```

### Data Flow

1. A client sends a `POST /migrate` request to trigger the migration process.
2. The `MigrationAgent` queues the migration task across all available instances using `this.queue()`.
3. Each instance:
   - Reads the current schema version from the SQL database.
   - Fetches the next migration script from CloudFS.
   - Applies the migration to the SQL database.
   - Updates the `schema_versions` table with the new version.
   - If any step fails, the instance rolls back the transaction and logs the error.
4. Once all instances have completed their migrations, the agent sends an SMS notification via `this.env.TELNYX.messages.send()`.

---

## Demo Mode vs Live Mode

### Demo Mode (Default)

By default, the agent runs in **demo mode**:

- No real SMS messages are sent. Instead, the agent logs what *would* be sent.
- Migration scripts are applied to the SQL database, but the SMS notification step is mocked.
- This allows you to test the full migration flow without incurring charges or sending real messages.

To verify demo mode is active, check the console output — you should see log lines like:

```
[DEMO MODE] SMS would be sent to +1555XXXXXXXX: Migration to version 3 completed successfully.
```

### Live Mode

To switch to **live mode** and send real SMS notifications:

1. Set the `DEMO_MODE` environment variable to `false` in your `.env` file:

   ```env
   DEMO_MODE=false
   ```

2. Ensure your Telnyx phone number and API key are correctly configured.

3. Restart the agent:

   ```bash
   npm run dev
   ```

In live mode, the agent will send real SMS messages via `this.env.TELNYX.messages.send()`.

---

## Running the Sample

### Start the Agent

```bash
npm run dev
```

The agent will start listening on `http://localhost:8787`.

### Trigger a Migration

Send a `POST` request to the `/migrate` endpoint:

```bash
curl -X POST http://localhost:8787/migrate
```

### View Logs

The agent logs each step of the migration process, including:

- Current schema version
- Migration script being applied
- Success or failure of each step
- SMS notification status (demo or live)

---

## Smoke Test

The project includes a smoke test that verifies the module loads without error:

```bash
npm test
```

This test imports the main module and checks that the `MigrationAgent` class and HTTP handler are properly exported.

---

## Telnyx Primitives Used

| Primitive | Usage |
|-----------|-------|
| **Agent SDK** | `MigrationAgent extends Agent` — orchestrates migration tasks |
| `this.queue()` | Distributes migration tasks across multiple instances |
| **SQL DB** | Stores schema version table and applies migration scripts |
| **CloudFS** | Shared directory for migration scripts |
| **Telnyx Binding** | `this.env.TELNYX.messages.send()` — sends SMS notifications |

---

## Next Steps

- **Telnyx Edge SDK Documentation** — [https://developers.telnyx.com/docs/edge](https://developers.telnyx.com/docs/edge)
- **Agent SDK Guide** — [https://developers.telnyx.com/docs/edge/agents](https://developers.telnyx.com/docs/edge/agents)
- **SQL Primitives** — [https://developers.telnyx.com/docs/edge/sql](https://developers.telnyx.com/docs/edge/sql)
- **CloudFS Primitives** — [https://developers.telnyx.com/docs/edge/cloudfs](https://developers.telnyx.com/docs/edge/cloudfs)
- **SMS API Reference** — [https://developers.telnyx.com/docs/sms](https://developers.telnyx.com/docs/sms)
- **Telnyx Blog** — [https://telnyx.com/blog](https://telnyx.com/blog)
- **Telnyx YouTube Channel** — [https://www.youtube.com/c/Telnyx](https://www.youtube.com/c/Telnyx)

---

## Troubleshooting

### SMS Not Sending

- Verify `TELNYX_API_KEY` is set correctly in `.env`.
- Verify `TELNYX_PHONE_NUMBER` is in E.161 format (e.g., `+1555XXXXXXXX`).
- Check that your Telnyx account has SMS credits.
- If in demo mode, confirm `DEMO_MODE=false` to send real messages.

### Migration Script Not Found

- Ensure migration scripts are uploaded to the CloudFS path specified in `MIGRATION_SCRIPTS_PATH`.
- Verify the script filenames match the expected naming convention (e.g., `001_initial_schema.sql`, `002_add_indexes.sql`).

### SQL Connection Errors

- Verify your SQL database is accessible from the Edge runtime.
- Check that the `DATABASE_URL` environment variable is set correctly.
- Ensure the `schema_versions` table has been created (the agent creates it automatically on startup if it doesn't exist).

---

## Related Examples

- [telnyx-code-examples/sql-migration-agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sql-migration-agent) — This sample
- [telnyx-code-examples/agent-sms-notifier](https://github.com/team-telnyx/telnyx-code-examples/tree/main/agent-sms-notifier) — Agent that sends SMS on schedule
- [telnyx-code-examples/cloudfs-file-processor](https://github.com/team-telnyx/telnyx-code-examples/tree/main/cloudfs-file-processor) — Agent that processes files from CloudFS
- [telnyx-code-examples/sql-query-agent](https://github.com/team-telnyx/telnyx-code-examples/tree/main/sql-query-agent) — Agent that executes SQL queries with SMS results

---

## Resources

- **Telnyx Developers Portal** — [https://developers.telnyx.com](https://developers.telnyx.com)
- **Telnyx Edge SDK** — [https://developers.telnyx.com/docs/edge](https://developers.telnyx.com/docs/edge)
- **Telnyx Community Slack** — [https://join.telnyx.com/community](https://join.telnyx.com/community)
- **Telnyx Status Page** — [https://status.telnyx.com](https://status.telnyx.com)
