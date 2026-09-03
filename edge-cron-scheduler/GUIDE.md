# Edge Cron Scheduler — Developer Guide

This guide walks you through the **Edge Cron Scheduler** sample, a TypeScript project that runs a cron-like scheduler on the Telnyx Edge runtime. It uses the Telnyx Agent SDK to schedule recurring checks, a KV store for the job registry, a SQL database for execution logging, and the Telnyx SMS API for failure notifications.

---

## Prerequisites

- Node.js 18+
- A Telnyx account with an API key ([sign up](https://telnyx.com/sign-up))
- The Telnyx CLI installed (`npm install -g @telnyx/cli`) — optional, for local edge simulation
- Basic familiarity with TypeScript and the Telnyx Edge SDK

---

## Environment Setup

1. Clone the repository and navigate to the sample folder:

   ```bash
   git clone https://github.com/team-telnyx/telnyx-code-examples.git
   cd telnyx-code-examples/edge-cron-scheduler
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a `.env` file from the example:

   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and add your Telnyx API key:

   ```env
   TELNYX_API_KEY=your_telnyx_api_key_here
   ```

   > **Demo mode (default):** No real SMS will be sent. The scheduler logs what *would* happen.
   >
   > **Live mode:** Set `DEMO_MODE=false` in `.env` to enable real SMS notifications on job failure.

---

## Project Structure

```
edge-cron-scheduler/
├── src/
│   └── index.ts          # Main entry point — CronAgent + handlers
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
├── smoke_test.ts         # Verifies the module loads without error
├── README.md
├── API.md
└── GUIDE.md              # This file
```

---

## How It Works

### 1. The CronAgent Class

The core of this sample is a custom agent class defined in `src/index.ts`:

```typescript
class CronAgent extends Agent { ... }
```

This class extends the Telnyx **Agent SDK** base class. It uses two key primitives:

- **`this.every('1m')`** — Registers a recurring heartbeat that fires every minute. This is the scheduler's main loop.
- **`this.queue('execute', job)`** — Queues a job for asynchronous execution within the agent's lifecycle.

The agent is instantiated and exported as the default handler:

```typescript
export default new CronAgent();
```

### 2. Job Registry in KV

The agent reads its job definitions from a **KV store** binding named `JOBS_KV`:

```typescript
const jobsJson = await this.env.JOBS_KV.get('jobs');
const jobs: CronJob[] = jobsJson ? JSON.parse(jobsJson) : [];
```

Each job entry looks like:

```json
{
  "id": "job_1",
  "name": "daily-call",
  "type": "call",
  "cron": "0 9 * * *",
  "params": { "to": "+1555XXXXXXXX" }
}
```

The KV store is the source of truth for what jobs exist and when they should run.

### 3. Scheduling Logic

Inside the `every('1m')` handler, the agent:

1. Fetches the job list from KV.
2. For each job, checks if it's due based on its cron expression and `last_run` timestamp.
3. If due, calls `this.queue('execute', job)` to schedule execution.

### 4. Job Execution & SQL Logging

When a queued `execute` message is processed, the agent:

1. Runs the job based on its `type`:
   - **`call`** — Initiates a Telnyx Call Control call via `this.env.TELNYX.calls.create()`.
   - **`sms`** — Sends an SMS via `this.env.TELNYX.messages.send()`.
   - **`webhook`** — Dispatches an HTTP POST to a configured URL.
2. Logs the result to a **SQL database** binding named `DB`:

   ```sql
   CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     name TEXT,
     last_run TEXT,
     status TEXT,
     result TEXT
   );
   ```

   The agent uses `this.env.DB.prepare()` to insert a row after each execution.

### 5. SMS Failure Notification

If a job fails (throws an error or returns a non-success status), the agent sends an SMS notification using the Telnyx SMS API:

```typescript
await this.env.TELNYX.messages.send({
  from: '+1555XXXXXXXX',
  to: process.env.NOTIFY_PHONE_NUMBER,
  text: `Job "${job.name}" failed: ${error.message}`
});
```

> In **demo mode**, this call is intercepted and logged instead of actually sending an SMS.

---

## Job Types

The scheduler supports three job types, each mapped to a Telnyx primitive:

| Type     | Primitive Used                          | Description                              |
|----------|-----------------------------------------|------------------------------------------|
| `call`   | `telnyx.calls.create()` (Call Control)  | Places an outbound voice call            |
| `sms`    | `telnyx.messages.send()`                | Sends an SMS message                     |
| `webhook`| `fetch()` to external URL               | Triggers an HTTP callback to a 3rd party |

---

## Running the Sample

### Local Simulation

The Telnyx Edge runtime can be simulated locally using the Telnyx CLI:

```bash
telnyx dev
```

This starts a local server that emulates the Edge environment, including KV and SQL bindings.

### Deploying to Telnyx Edge

To deploy:

```bash
telnyx deploy
```

This uploads your agent to the Telnyx Edge network, where it will run on schedule.

---

## Demo Mode vs Live Mode

| Feature              | Demo Mode (default)                          | Live Mode                                   |
|----------------------|----------------------------------------------|---------------------------------------------|
| SMS notifications    | Logged to console, no real SMS sent          | Real SMS sent via Telnyx API                |
| Call jobs            | Logged, no real call placed                  | Real outbound call via Call Control         |
| Webhook jobs         | Logged, no HTTP request made                 | Real HTTP POST to target URL                |
| SQL logging          | Real (local or edge DB)                      | Real                                         |

To switch to **live mode**, set the following in your `.env`:

```env
DEMO_MODE=false
```

---

## Smoke Test

A smoke test is included to verify the module loads correctly:

```bash
npx ts-node smoke_test.ts
```

This imports the `CronAgent` class and confirms it instantiates without errors.

---

## Next Steps

- **Telnyx Edge SDK Docs:** https://docs.telnyx.com/edge
- **Agent SDK Reference:** https://docs.telnyx.com/edge/agents
- **Call Control API:** https://developers.telnyx.com/docs/call-control
- **SMS API:** https://developers.telnyx.com/docs/sms
- **KV Store Guide:** https://docs.telnyx.com/edge/kv
- **SQL Database Guide:** https://docs.telnyx.com/edge/sql
- **Scheduling & Queues:** https://docs.telnyx.com/edge/scheduling

---

## Related Examples

- `edge-agent-chatbot` — A conversational AI agent using the Agent SDK
- `edge-sms-forwarder` — Forwards inbound SMS to a webhook
- `edge-call-recorder` — Records outbound calls via Call Control

---

## Resources

- [Telnyx Developer Portal](https://developers.telnyx.com)
- [Telnyx Edge Documentation](https://docs.telnyx.com/edge)
- [GitHub: team-telnyx/telnyx-code-examples](https://github.com/team-telnyx/telnyx-code-examples)
