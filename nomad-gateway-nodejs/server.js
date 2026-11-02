// Nomad Gateway — SMS/Voice to Offline AI + Wikipedia.
// Express entrypoint: routes, SSE, webhooks, system health checker.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { setting } from "./settings.js";
import { openDb } from "./db.js";
import { parseInbound } from "./messaging.js";
import { processInbound, storeMessage } from "./ai.js";
import { handleVoiceEvent } from "./voice.js";
import { checkKiwix, checkOllama, checkInternet } from "./knowledge.js";

// Load .env locally (Node 22+)
try { process.loadEnvFile(); } catch { /* no .env or older Node — fine */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// SSE — real-time event streaming to browser clients
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

function remove(res) {
  const idx = subscribers.indexOf(res);
  if (idx !== -1) subscribers.splice(idx, 1);
}

app.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  subscribers.push(res);
  const keepalive = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* ignore */ } }, 30_000);
  req.on("close", () => { clearInterval(keepalive); remove(res); });
});

// ---------------------------------------------------------------------------
// Webhook deduplication (in-memory)
// ---------------------------------------------------------------------------
const processedMsgIds = new Map();
const phoneCooldown = new Map();
const COOLDOWN_MS = 3000;

function isDuplicate(msgId, fromNumber) {
  const now = Date.now();
  if (msgId && processedMsgIds.has(msgId)) return true;
  const last = phoneCooldown.get(fromNumber) || 0;
  if (now - last < COOLDOWN_MS) return true;
  if (msgId) {
    processedMsgIds.set(msgId, now);
    if (processedMsgIds.size > 1000) processedMsgIds.clear();
  }
  phoneCooldown.set(fromNumber, now);
  return false;
}

// ---------------------------------------------------------------------------
// Database — initialized asynchronously after listen()
// ---------------------------------------------------------------------------
let db;
let dbReady;
const dbPromise = new Promise((resolve) => { dbReady = resolve; });

// ---------------------------------------------------------------------------
// Webhook — inbound SMS
// ---------------------------------------------------------------------------
app.post("/webhooks/sms", (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: "No payload" });

  const parsed = parseInbound(payload);
  if (!parsed) return res.json({ status: "ignored" });

  const { phone, text, msgId } = parsed;

  const myNumber = setting("PHONE_NUMBER");
  if (phone === myNumber) return res.json({ status: "ignored" });
  if (isDuplicate(msgId, phone)) return res.json({ status: "duplicate" });

  // Return 200 immediately, process in background
  res.json({ status: "processing" });

  (async () => {
    try {
      await dbPromise;
      if (!text) return;
      await storeMessage(db, phone, "user", text, "sms");
      ssePublish("channel.sms", { direction: "inbound", from: phone, text });
      await processInbound(db, ssePublish, phone, text, "sms");
    } catch (err) {
      console.error("SMS processing failed:", err);
      ssePublish("agent.error", { error: err.message });
    }
  })();
});

// ---------------------------------------------------------------------------
// Webhook — inbound voice calls
// ---------------------------------------------------------------------------
app.post("/webhooks/voice", async (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: "No payload" });

  await dbPromise;
  const result = await handleVoiceEvent(payload, db, ssePublish, processInbound);
  res.json(result);
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
app.get(["/health", "/health/{*path}"], (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    phone_number: setting("PHONE_NUMBER") || "",
  });
});

// All routes below need the database
app.use(async (_req, _res, next) => {
  await dbPromise;
  if (!db) return _res.status(503).json({ error: "Database unavailable" });
  next();
});

app.get("/api/config", (_req, res) => {
  res.json({
    phone_number: setting("PHONE_NUMBER") || "",
    kiwix_host: setting("KIWIX_HOST") || "",
    ollama_host: setting("OLLAMA_HOST") || "",
  });
});

app.get("/api/queries", async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const { results: rows } = await db.prepare(
    "SELECT * FROM queries ORDER BY created_at DESC LIMIT ?"
  ).bind(limit).all();
  res.json({ queries: rows.reverse() });
});

app.get("/api/status", async (_req, res) => {
  const row = await db.prepare("SELECT * FROM system_status WHERE id = 1").first();
  res.json({ status: row || {} });
});

app.get("/api/knowledge", async (_req, res) => {
  const { results: chunks } = await db.prepare(
    "SELECT id, title, source, created_at FROM knowledge_chunks ORDER BY created_at DESC LIMIT 50"
  ).all();
  const countRow = await db.prepare("SELECT COUNT(*) as total FROM knowledge_chunks").first();
  res.json({ chunks, total: countRow?.total || 0 });
});

app.get("/api/conversations", async (req, res) => {
  const since = req.query.since || "";
  const phone = req.query.phone || "";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  let rows;
  if (since && phone) {
    ({ results: rows } = await db.prepare(
      "SELECT phone, role, content, channel, timestamp FROM conversations WHERE timestamp > ? AND phone = ? ORDER BY timestamp ASC LIMIT ?"
    ).bind(since, phone, limit).all());
  } else if (since) {
    ({ results: rows } = await db.prepare(
      "SELECT phone, role, content, channel, timestamp FROM conversations WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?"
    ).bind(since, limit).all());
  } else if (phone) {
    ({ results: rows } = await db.prepare(
      "SELECT phone, role, content, channel, timestamp FROM conversations WHERE phone = ? ORDER BY timestamp DESC LIMIT ?"
    ).bind(phone, limit).all());
    rows = rows.reverse();
  } else {
    ({ results: rows } = await db.prepare(
      "SELECT phone, role, content, channel, timestamp FROM conversations ORDER BY timestamp DESC LIMIT ?"
    ).bind(limit).all());
    rows = rows.reverse();
  }
  res.json({ messages: rows });
});

app.get("/api/ui-events", async (req, res) => {
  const since = req.query.since || "";
  let rows;
  if (since) {
    ({ results: rows } = await db.prepare(
      "SELECT id, type, payload, created_at FROM ui_events WHERE created_at > ? ORDER BY created_at ASC LIMIT 50"
    ).bind(since).all());
  } else {
    ({ results: rows } = await db.prepare(
      "SELECT id, type, payload, created_at FROM ui_events ORDER BY created_at DESC LIMIT 10"
    ).all());
    rows = rows.reverse();
  }
  res.json({ events: rows });
});

app.delete("/api/conversations", async (req, res) => {
  const phone = req.query.phone || "";
  if (phone) {
    await db.prepare("DELETE FROM conversations WHERE phone = ?").bind(phone).run();
  } else {
    await db.prepare("DELETE FROM conversations").run();
    await db.prepare("DELETE FROM ui_events").run();
  }
  res.json({ status: "cleared" });
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// System health checker — pings Kiwix, Ollama, Maps, internet every 30s
// ---------------------------------------------------------------------------
async function updateSystemStatus() {
  if (!db) return;
  const [internet, kiwix, ollama] = await Promise.all([
    checkInternet(),
    checkKiwix(),
    checkOllama(),
  ]);

  const mapsUp = internet; // Maps requires internet (Nominatim is online)
  const now = new Date().toISOString();

  await db.prepare(
    "UPDATE system_status SET internet_up=?, kiwix_up=?, ollama_up=?, maps_up=?, updated_at=? WHERE id=1"
  ).bind(internet ? 1 : 0, kiwix ? 1 : 0, ollama ? 1 : 0, mapsUp ? 1 : 0, now).run();

  const status = { internet, kiwix, ollama, maps: mapsUp };
  ssePublish("system.status", status);
}

// ---------------------------------------------------------------------------
// Startup — listen FIRST so the platform readiness probe passes, then open
// the database and start health checker in the background.
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Nomad Gateway running on http://localhost:${PORT}`);
  openDb(path.join(__dirname, "data")).then(({ db: database, engine }) => {
    db = database;
    console.log(`Database engine: ${engine}`);
    dbReady();

    // Initial status check, then every 30s
    updateSystemStatus();
    setInterval(updateSystemStatus, 30_000);
  }).catch((err) => {
    console.error("DB init failed:", err.message);
    dbReady();
  });
});
