// Email Batch Send — send up to 1,000 emails in one API call and track
// delivery events in a real-time dashboard.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import express from "express";

// ---------------------------------------------------------------------------
// .env loader with override (process.loadEnvFile won't override shell vars)
// ---------------------------------------------------------------------------
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
} catch { /* no .env — fine */ }

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@msgtelnyx.com";
const TO_EMAIL = process.env.TO_EMAIL || FROM_EMAIL;
const PORT = Number(process.env.PORT || 3000);
const API = "https://api.telnyx.com/v2";

if (!TELNYX_API_KEY) {
  console.error("Missing TELNYX_API_KEY — add it to .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// SQLite (Node 22 built-in node:sqlite — synchronous API)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mask(email) {
  const [local = "", domain = ""] = String(email).split("@");
  const parts = domain.split(".");
  const tld = parts.length > 1 ? parts.pop() : "";
  return `${local[0] || ""}***@${(parts.join(".")[0] || "")}***${tld ? "." + tld : ""}`;
}

// Status priority for message state machine — higher wins, terminal states always win.
const STATUS_PRIORITY = {
  queued: 0, sent: 1, delivered: 2, opened: 3, clicked: 4,
  bounced: 99, failed: 99, complained: 99,
};

function shouldUpdateStatus(current, incoming) {
  const cur = STATUS_PRIORITY[current] ?? -1;
  const inc = STATUS_PRIORITY[incoming] ?? -1;
  if (cur >= 99) return false; // terminal — no further updates
  return inc > cur;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, _res, next) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// SSE — real-time event streaming to browser
// ---------------------------------------------------------------------------
const subscribers = [];

function ssePublish(eventType, data) {
  const payload = JSON.stringify({ type: eventType, ts: new Date().toISOString(), ...data });
  const dead = [];
  for (const res of subscribers) {
    try { res.write(`data: ${payload}\n\n`); } catch { dead.push(res); }
  }
  for (const res of dead) {
    const idx = subscribers.indexOf(res);
    if (idx !== -1) subscribers.splice(idx, 1);
  }
}

app.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  subscribers.push(res);
  const keepalive = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* ignore */ } }, 30_000);
  req.on("close", () => { clearInterval(keepalive); const idx = subscribers.indexOf(res); if (idx !== -1) subscribers.splice(idx, 1); });
});

// ---------------------------------------------------------------------------
// Routes — config & health
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/config", (_req, res) => {
  res.json({ from: mask(FROM_EMAIL), to: mask(TO_EMAIL) });
});

// ---------------------------------------------------------------------------
// Route — batch send
// ---------------------------------------------------------------------------
app.post("/api/send-batch", async (req, res) => {
  const count = Math.max(1, Math.min(1000, Number(req.body?.count) || 10));
  const subject = req.body?.subject || "Telnyx Batch Email Demo";
  const scenario = req.body?.scenario || "success";
  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Build messages array — all messages go to TO_EMAIL (account's verified email).
  // The shared domain (onboarding@msgtelnyx.com) can only send to verified addresses.
  // In "failure" scenario, the first message goes to an invalid address to trigger a bounce.
  const BOUNCE_ADDR = "bounce-test@invalid.example";
  const messages = [];
  for (let i = 1; i <= count; i++) {
    const recipient = (scenario === "failure" && i === 1) ? BOUNCE_ADDR : TO_EMAIL;
    messages.push({
      from: { email: FROM_EMAIL, name: "Telnyx Email Batch Demo" },
      to: [{ email: recipient }],
      subject: `${subject} (#${i} of ${count})`,
      html_body: `<h2>${subject}</h2>
<p>Message <strong>#${i}</strong> of <strong>${count}</strong>, sent at ${now}.</p>
<p><a href="https://telnyx.com/products/email-api">View Email API docs</a></p>`,
      text_body: `${subject} — Message #${i} of ${count}, sent at ${now}. Link: https://telnyx.com/products/email-api`,
      tracking_settings: { open_tracking: true, click_tracking: true },
      tags: ["batch-demo", `batch-${batchId}`],
    });
  }

  try {
    const response = await fetch(`${API}/email_messages/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": batchId,
      },
      body: JSON.stringify({ messages }),
    });

    const rawText = await response.text();
    let body;
    try { body = JSON.parse(rawText); } catch { body = { raw: rawText }; }

    console.log(`[batch] scenario=${scenario}, first_recipient=${messages[0].to[0].email}`);
    console.log(`[batch] API response ${response.status}:`, JSON.stringify(body).slice(0, 500));

    // Non-207 means a batch-level failure
    if (!response.ok && response.status !== 207) {
      const detail = body.errors?.[0]?.detail || body.errors?.[0]?.message || rawText.slice(0, 200);
      console.error(`[batch] API error ${response.status}: ${detail}`);
      return res.status(502).json({ error: "Batch API error", detail });
    }

    // 207 Multi-Status: body.data = succeeded, body.errors = failed
    const succeeded = body.data || [];
    const errors = body.errors || [];

    // Insert batch record
    db.prepare(
      "INSERT INTO batches (id, batch_size, succeeded, failed, subject, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(batchId, count, succeeded.length, errors.length, subject, errors.length === count ? "failed" : "sending", now);

    // Store succeeded message IDs
    const insertMsg = db.prepare(
      "INSERT OR IGNORE INTO messages (id, batch_id, recipient, status, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const msg of succeeded) {
      const id = msg.id || msg.message_id;
      if (id) {
        const recipient = msg.to?.[0]?.email || TO_EMAIL;
        insertMsg.run(id, batchId, recipient, "queued", now);
      }
    }

    // Record API-rejected messages as failed events so they appear in the dashboard
    for (const err of errors) {
      const fakeId = `rejected-${batchId}-${err.index ?? crypto.randomUUID()}`;
      const rejectedRecipient = messages[err.index]?.to?.[0]?.email || "unknown";
      insertMsg.run(fakeId, batchId, rejectedRecipient, "failed", now);
      db.prepare(
        "INSERT INTO events (message_id, batch_id, event_type, recipient, occurred_at) VALUES (?, ?, ?, ?, ?)"
      ).run(fakeId, batchId, "failed", rejectedRecipient, now);
      ssePublish("event.received", {
        event_type: "failed",
        message_id: fakeId,
        batch_id: batchId,
        recipient: rejectedRecipient,
        occurred_at: now,
        progress: null,
      });
    }

    ssePublish("batch.started", {
      batch_id: batchId,
      count,
      succeeded: succeeded.length,
      failed: errors.length,
    });

    console.log(`[batch] ${batchId} — ${succeeded.length} accepted, ${errors.length} failed`);
    if (errors.length > 0) {
      console.log(`[batch] First errors:`, JSON.stringify(errors.slice(0, 3)));
    }

    res.json({
      batch_id: batchId,
      count,
      succeeded: succeeded.length,
      failed: errors.length,
      errors: errors.slice(0, 5),
    });
  } catch (err) {
    console.error("[batch] Send failed:", err.message);
    res.status(502).json({ error: "Batch send failed", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// Route — list batches
// ---------------------------------------------------------------------------
app.get("/api/batches", (_req, res) => {
  const rows = db.prepare(
    "SELECT b.*, (SELECT COUNT(*) FROM events e WHERE e.batch_id = b.id) as event_count FROM batches b ORDER BY b.created_at DESC LIMIT 50"
  ).all();
  res.json({ batches: rows });
});

// ---------------------------------------------------------------------------
// Route — single batch detail
// ---------------------------------------------------------------------------
app.get("/api/batches/:id", (req, res) => {
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(req.params.id);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  const messages = db.prepare("SELECT * FROM messages WHERE batch_id = ? ORDER BY created_at").all(req.params.id);
  res.json({ batch, messages });
});

// ---------------------------------------------------------------------------
// Route — events for a batch
// ---------------------------------------------------------------------------
app.get("/api/batches/:id/events", (req, res) => {
  const events = db.prepare(
    "SELECT * FROM events WHERE batch_id = ? ORDER BY created_at DESC LIMIT 500"
  ).all(req.params.id);
  res.json({ events });
});

// ---------------------------------------------------------------------------
// Route — aggregate performance report
// ---------------------------------------------------------------------------
app.get("/api/report", (req, res) => {
  const batchFilter = req.query.batch_id;

  let totalSent, eventRows;
  if (batchFilter) {
    const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(batchFilter);
    totalSent = batch ? batch.succeeded : 0;
    eventRows = db.prepare(
      "SELECT event_type, COUNT(*) as cnt FROM events WHERE batch_id = ? GROUP BY event_type"
    ).all(batchFilter);
  } else {
    const agg = db.prepare("SELECT COALESCE(SUM(succeeded), 0) as total FROM batches").get();
    totalSent = agg.total;
    eventRows = db.prepare(
      "SELECT event_type, COUNT(*) as cnt FROM events GROUP BY event_type"
    ).all();
  }

  const counts = {};
  for (const row of eventRows) {
    counts[row.event_type] = row.cnt;
  }

  const delivered = counts.delivered || 0;
  const pct = (num, den) => den > 0 ? +(100 * num / den).toFixed(1) : 0;

  res.json({
    total_sent: totalSent,
    counts: {
      delivered,
      opened: counts.opened || 0,
      clicked: counts.clicked || 0,
      bounced: counts.bounced || 0,
      failed: counts.failed || 0,
      complained: counts.complained || 0,
    },
    rates: {
      delivery: pct(delivered, totalSent),
      open: pct(counts.opened || 0, delivered),
      click: pct(counts.clicked || 0, delivered),
      bounce: pct(counts.bounced || 0, totalSent),
    },
  });
});

// ---------------------------------------------------------------------------
// Shared event processor — used by both webhook and poller
// ---------------------------------------------------------------------------
function processEvent(eventType, messageId, recipient, occurredAt) {
  // Look up batch from message
  let batchId = null;
  if (messageId) {
    const msg = db.prepare("SELECT batch_id FROM messages WHERE id = ?").get(messageId);
    if (msg) {
      batchId = msg.batch_id;

      // Update message status if the new event has higher priority
      const current = db.prepare("SELECT status FROM messages WHERE id = ?").get(messageId);
      if (current && shouldUpdateStatus(current.status, eventType)) {
        db.prepare("UPDATE messages SET status = ? WHERE id = ?").run(eventType, messageId);
      }
    }
  }

  // Insert event
  db.prepare(
    "INSERT INTO events (message_id, batch_id, event_type, recipient, occurred_at) VALUES (?, ?, ?, ?, ?)"
  ).run(messageId, batchId, eventType, recipient, occurredAt);

  // Compute batch progress for SSE
  let progress = null;
  if (batchId) {
    const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(batchId);
    if (batch) {
      const delivered = db.prepare(
        "SELECT COUNT(*) as cnt FROM messages WHERE batch_id = ? AND status = 'delivered'"
      ).get(batchId).cnt;
      progress = {
        batch_id: batchId,
        batch_size: batch.batch_size,
        delivered,
        pct: batch.succeeded > 0 ? +(100 * delivered / batch.succeeded).toFixed(1) : 0,
      };
    }
  }

  ssePublish("event.received", {
    event_type: eventType,
    message_id: messageId,
    batch_id: batchId,
    recipient,
    occurred_at: occurredAt,
    progress,
  });
}

// ---------------------------------------------------------------------------
// Webhook — Telnyx email events (if webhook URL is configured in Portal)
// ---------------------------------------------------------------------------
app.post("/webhooks/email", (req, res) => {
  const payload = req.body || {};
  const data = payload.data || {};
  const eventType = (data.event_type || "").replace(/^email\./, "");
  const p = data.payload || {};

  if (!eventType) return res.json({ status: "ignored" });

  const messageId = p.message_id || p.id || data.id || "";
  const recipient = p.to?.email || p.cc?.email || p.bcc?.email || "";
  const occurredAt = p.occurred_at || data.occurred_at || new Date().toISOString();

  console.log(`[webhook] ${eventType} — msg=${messageId.slice(0, 12)}…`);
  try {
    processEvent(eventType, messageId, recipient, occurredAt);
  } catch (err) {
    console.error("[webhook] processEvent error:", err.message);
  }
  res.json({ status: "ok" });
});

// ---------------------------------------------------------------------------
// Event poller — polls message events from GET /v2/email_messages/:id/events
// Works without webhook configuration — the Telnyx API tracks all events.
// ---------------------------------------------------------------------------
async function pollMessageStatuses() {
  try {
    // Find messages that haven't reached a terminal state
    const pending = db.prepare(
      "SELECT id, status FROM messages WHERE status NOT IN ('delivered','bounced','failed','complained') LIMIT 50"
    ).all();

    if (pending.length === 0) return;

    let newEvents = 0;
    for (const msg of pending) {
      try {
        const resp = await fetch(`${API}/email_messages/${msg.id}/events`, {
          headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
        });
        if (!resp.ok) {
          if (resp.status === 429) return; // rate limited — back off
          continue;
        }

        const body = await resp.json();
        const events = body.data || [];

        for (const evt of events) {
          const eventType = (evt.type || "").replace(/^email\./, "");
          if (!eventType || eventType === "queued" || eventType === "sending") continue;

          // Skip if we already recorded this event
          const existing = db.prepare(
            "SELECT 1 FROM events WHERE message_id = ? AND event_type = ?"
          ).get(msg.id, eventType);
          if (existing) continue;

          const recipient = evt.payload?.to?.email || TO_EMAIL;
          const occurredAt = evt.occurred_at || new Date().toISOString();

          console.log(`[poller] ${eventType} — msg=${msg.id.slice(0, 12)}…`);
          processEvent(eventType, msg.id, recipient, occurredAt);
          newEvents++;
        }
      } catch (err) {
        console.error(`[poller] Error checking ${msg.id.slice(0, 12)}:`, err.message);
      }
    }

    if (newEvents > 0) console.log(`[poller] Processed ${newEvents} new events`);
  } catch (err) {
    console.error("[poller] Top-level error:", err.message);
  }
}

// Poll every 5 seconds
setInterval(pollMessageStatuses, 5_000);

// ---------------------------------------------------------------------------
// Sync — import historical events from Telnyx GET /v2/email_events API
// Populates the dashboard with events that occurred before the server started.
// ---------------------------------------------------------------------------
app.post("/api/sync", async (_req, res) => {
  console.log("[sync] Starting event sync from Telnyx API…");
  let pageNum = 1;
  let imported = 0;
  let pages = 0;

  try {
    while (pages < 20) {
      const url = new URL(`${API}/email_events`);
      url.searchParams.set("page[number]", String(pageNum));

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
      });

      if (resp.status === 429) {
        console.log("[sync] Rate limited — pausing 2s");
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!resp.ok) break;

      const body = await resp.json();
      const events = body.data || [];
      const totalPages = body.meta?.total_pages || 1;
      pages++;

      for (const evt of events) {
        const eventType = (evt.event_type || "").replace(/^email\./, "");
        if (!eventType || eventType === "queued" || eventType === "sending") continue;

        const p = evt.payload || {};
        const messageId = p.id || "";
        if (!messageId) continue;

        const recipient = p.to?.email || TO_EMAIL;
        const occurredAt = evt.occurred_at || new Date().toISOString();
        const subject = p.subject || "";

        // Auto-create batch + message records if we don't have them
        if (!db.prepare("SELECT 1 FROM messages WHERE id = ?").get(messageId)) {
          // Find or create a synthetic batch for this message's subject group
          let batch = db.prepare("SELECT * FROM batches WHERE subject = ? LIMIT 1").get(
            subject.replace(/\s*\(#\d+ of \d+\)$/, "").trim() || "Synced"
          );
          if (!batch) {
            const batchId = crypto.randomUUID();
            db.prepare(
              "INSERT INTO batches (id, batch_size, succeeded, failed, subject, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(batchId, 0, 0, 0, subject.replace(/\s*\(#\d+ of \d+\)$/, "").trim() || "Synced", "synced", occurredAt);
            batch = { id: batchId };
          }
          db.prepare("INSERT OR IGNORE INTO messages (id, batch_id, recipient, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
            messageId, batch.id, recipient, "queued", occurredAt
          );
          // Increment batch count
          db.prepare("UPDATE batches SET batch_size = batch_size + 1, succeeded = succeeded + 1 WHERE id = ?").run(batch.id);
        }

        // Skip if already recorded
        const existing = db.prepare("SELECT 1 FROM events WHERE message_id = ? AND event_type = ?").get(messageId, eventType);
        if (existing) continue;

        processEvent(eventType, messageId, recipient, occurredAt);
        imported++;
      }

      if (pageNum >= totalPages) break;
      pageNum++;
    }

    console.log(`[sync] Done — imported ${imported} events across ${pages} pages`);
    res.json({ imported, pages });
  } catch (err) {
    console.error("[sync] Error:", err.message);
    res.status(500).json({ error: err.message, imported });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Email Batch Demo running on http://localhost:${PORT}`);
  console.log(`From: ${FROM_EMAIL}`);
  console.log(`To:   ${TO_EMAIL}`);
  console.log(`Key:  ${TELNYX_API_KEY.slice(0, 12)}…`);
});
