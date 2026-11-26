# Guide: Send Batch Emails with the Telnyx Email API

This tutorial walks through building a Node.js application that sends up to 1,000 emails in a single API call and tracks delivery events in a real-time dashboard.

## Prerequisites

- **Node.js 22+** (required for built-in `node:sqlite`)
- A [Telnyx account](https://portal.telnyx.com) with an API key
- A verified email address on your Telnyx account (for receiving test emails)
- [ngrok](https://ngrok.com) or similar tunnel for receiving webhooks locally

## Step 1 — Project setup

Create the project and install the single dependency:

```bash
mkdir email-batch-send-nodejs && cd email-batch-send-nodejs
npm init -y
npm install express@5
```

Create a `.env` file:

```bash
TELNYX_API_KEY=KEY_your_api_key_here
FROM_EMAIL=onboarding@msgtelnyx.com
TO_EMAIL=your_verified_email@example.com
PORT=3000
```

The shared domain `onboarding@msgtelnyx.com` works with any Telnyx account but can only send to your account's verified email. If you have a verified custom sending domain, set `FROM_EMAIL` to an address on that domain and `TO_EMAIL` to any recipient.

## Step 2 — Environment loading

Node.js `process.loadEnvFile()` does not override existing shell environment variables. This is a common gotcha — if your shell has `TELNYX_API_KEY` set from another project, the wrong key gets used silently. Parse `.env` manually with override:

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const envPath = path.join(__dirname, ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
} catch { /* no .env file */ }
```

## Step 3 — SQLite schema

Node 22 ships a built-in `node:sqlite` module with a synchronous API (`DatabaseSync`). Three tables track batches, individual messages, and webhook events:

```js
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

const dataDir = path.join(__dirname, "data");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "email_batch.db"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    batch_size INTEGER NOT NULL,
    succeeded INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    subject TEXT,
    status TEXT DEFAULT 'sending',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    recipient TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT,
    batch_id TEXT,
    event_type TEXT NOT NULL,
    recipient TEXT,
    occurred_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
```

## Step 4 — Batch send endpoint

The core of the demo — build an array of up to 1,000 messages and send them in one call:

```js
app.post("/api/send-batch", async (req, res) => {
  const count = Math.max(1, Math.min(1000, Number(req.body?.count) || 10));
  const subject = req.body?.subject || "Telnyx Batch Email Demo";
  const batchId = crypto.randomUUID();

  const messages = [];
  for (let i = 1; i <= count; i++) {
    messages.push({
      from: { email: FROM_EMAIL, name: "Telnyx Email Batch Demo" },
      to: [TO_EMAIL],
      subject: `${subject} (#${i} of ${count})`,
      html_body: `<h2>${subject}</h2><p>Message #${i} of ${count}.</p>
        <p><a href="https://telnyx.com/products/email-api">View docs</a></p>`,
      text_body: `${subject} — #${i} of ${count}`,
      tracking_settings: { open_tracking: true, click_tracking: true },
      tags: ["batch-demo", `batch-${batchId}`],
    });
  }

  const response = await fetch(
    "https://api.telnyx.com/v2/email_messages/batch",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": batchId,
      },
      body: JSON.stringify({ messages }),
    }
  );

  const body = await response.json();
  // 207 Multi-Status: body.data = succeeded, body.errors = failed
  const succeeded = body.data || [];
  const errors = body.errors || [];

  // Store in SQLite...
});
```

Key points:
- The batch endpoint accepts up to 1,000 messages per call
- The `Idempotency-Key` header prevents duplicate sends on retries
- The response is 207 Multi-Status with separate `data` (succeeded) and `errors` (failed) arrays
- Each message gets `tracking_settings` for open and click tracking

## Step 5 — Webhook handler

Telnyx posts email lifecycle events to your webhook URL. The handler maps each event to its batch via the message ID stored in SQLite:

```js
app.post("/webhooks/email", (req, res) => {
  const data = req.body?.data || {};
  const eventType = (data.event_type || "").replace(/^email\./, "");
  const p = data.payload || {};
  const messageId = p.message_id || p.id || data.id || "";

  // Look up batch from message
  const msg = db.prepare(
    "SELECT batch_id FROM messages WHERE id = ?"
  ).get(messageId);

  // Insert event
  db.prepare(
    "INSERT INTO events (message_id, batch_id, event_type, recipient, occurred_at) VALUES (?, ?, ?, ?, ?)"
  ).run(messageId, msg?.batch_id, eventType, p.to || "", p.occurred_at || new Date().toISOString());

  // Push to dashboard via SSE
  ssePublish("event.received", { event_type: eventType, message_id: messageId });

  res.json({ status: "ok" });
});
```

Event types you will see:
- `delivered` — the recipient's mail server accepted the message
- `opened` — the recipient opened the email (requires open tracking)
- `clicked` — the recipient clicked a tracked link (requires click tracking)
- `bounced` — the recipient's mail server rejected the message
- `failed` — permanent delivery failure
- `complained` — the recipient marked the message as spam

## Step 6 — SSE for real-time updates

Server-Sent Events push webhook data to the browser without polling:

```js
const subscribers = [];

function ssePublish(eventType, data) {
  const payload = JSON.stringify({ type: eventType, ...data });
  for (const res of subscribers) {
    try { res.write(`data: ${payload}\n\n`); } catch { /* dead */ }
  }
}

app.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  subscribers.push(res);
  const keepalive = setInterval(
    () => { try { res.write(": keepalive\n\n"); } catch {} },
    30_000
  );
  req.on("close", () => {
    clearInterval(keepalive);
    const idx = subscribers.indexOf(res);
    if (idx !== -1) subscribers.splice(idx, 1);
  });
});
```

The browser connects with `new EventSource("/stream")` and updates KPI cards as events arrive.

## Step 7 — Run and test

1. Start the server:

   ```bash
   npm start
   ```

2. In another terminal, start ngrok:

   ```bash
   ngrok http 3000
   ```

3. Configure the ngrok HTTPS URL as your email webhook in the [Telnyx Portal](https://portal.telnyx.com) → Email Settings → Webhook URL:

   ```
   https://<id>.ngrok.io/webhooks/email
   ```

4. Open `http://localhost:3000` in your browser.

5. Set the count to 10 and click **Send Batch**.

6. Watch the KPI cards update as delivery events stream in. Open the delivered emails and click the tracked link to see open and click events appear.

## Step 8 — Scale to 1,000

Once you have confirmed the flow works with 10 messages, increase the count to 1,000. The batch API processes all messages in a single call — typical delivery starts within 5–10 seconds.

## Performance report

The `/api/report` endpoint aggregates event counts and calculates rates:

```bash
curl http://localhost:3000/api/report
```

```json
{
  "total_sent": 1000,
  "counts": {
    "delivered": 980,
    "opened": 450,
    "clicked": 120,
    "bounced": 15,
    "failed": 5,
    "complained": 0
  },
  "rates": {
    "delivery": 98.0,
    "open": 45.9,
    "click": 12.2,
    "bounce": 1.5
  }
}
```

Filter by batch with `?batch_id=<uuid>`.

## Next steps

- **Custom domain**: Verify a sending domain in the Telnyx Portal for production use — this removes the self-send restriction and enables custom DKIM/SPF.
- **Retry failed messages**: See the [`email-batch-retry-agent`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/email-batch-retry-agent/README.md) example for exponential backoff retry logic.
- **Template personalization**: Replace the HTML body with per-recipient content using template variables.
- **Webhook verification**: Add Ed25519 signature verification for production webhook security.
