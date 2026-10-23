// DineNyx — AI-powered restaurant reservations via WhatsApp.
// Express entrypoint: routes, SSE, webhook, startup.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { setting } from "./settings.js";
import { openDb } from "./db.js";
import { CUISINES, fetchGoogleRestaurants, getFallbackRestaurants, cacheRestaurants, seedRestaurants } from "./restaurants.js";
import { transcribeAudio } from "./whatsapp.js";
import { processInbound, storeMessage, getReservationsForPhone, TABLES, TIME_SLOTS } from "./ai.js";

// Load .env locally (Node 22+)
try { process.loadEnvFile(); } catch { /* no .env or older Node — fine */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(setting("PORT") || 3000);

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
// NOTE: On Edge, multiple instances may run — a message could hit different
// instances. Acceptable for a demo; production would use DB-backed dedup.
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
// Database — initialized at startup, shared by all handlers
// ---------------------------------------------------------------------------
let db;

// ---------------------------------------------------------------------------
// Webhook — inbound WhatsApp messages
// ---------------------------------------------------------------------------
app.post("/webhooks/whatsapp", (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: "No payload" });

  const data = payload.data || {};
  const p = data.payload || {};

  if (data.event_type !== "message.received") return res.json({ status: "ignored" });
  if (p.direction !== "inbound") return res.json({ status: "ignored" });

  const fromNumber = p.from?.phone_number || "";
  if (!fromNumber) return res.json({ status: "ignored" });

  const waNumber = setting("WHATSAPP_NUMBER");
  if (fromNumber === waNumber) return res.json({ status: "ignored" });

  const msgId = p.id || data.id || "";
  if (isDuplicate(msgId, fromNumber)) return res.json({ status: "duplicate" });

  const body = p.body || {};
  const msgType = body.type || "text";

  // Extract text based on message type
  let text = "";
  if (msgType === "text") {
    const textObj = body.text || {};
    text = typeof textObj === "object" ? textObj.body || "" : String(textObj);
  } else if (msgType === "interactive") {
    const interactive = body.interactive || {};
    const replyType = interactive.type || "";
    if (replyType === "list_reply") {
      const reply = interactive.list_reply || {};
      text = reply.title || reply.id || "";
    } else if (replyType === "button_reply") {
      const reply = interactive.button_reply || {};
      text = reply.title || reply.id || "";
    }
  } else if (msgType === "audio") {
    // Voice notes are handled async below
    text = "__audio__";
  } else {
    const caption = body.caption || (body[msgType] || {}).caption || "";
    text = caption || `[${msgType} message received]`;
  }

  // Return 200 immediately, process in background (fire-and-forget)
  res.json({ status: "processing" });

  (async () => {
    try {
      // Handle audio transcription
      if (msgType === "audio") {
        const audioObj = body.audio || {};
        const audioUrl = typeof audioObj === "object" ? audioObj.url || "" : "";
        if (audioUrl) {
          ssePublish("agent.thinking", { content: "Transcribing voice note..." });
          const transcript = await transcribeAudio(audioUrl);
          text = transcript ? `[Voice note transcription]: ${transcript}` : "[Voice note received but could not be transcribed]";
        } else {
          text = "[Voice note received but no URL provided]";
        }
      }

      if (!text) text = "[Empty message]";

      await storeMessage(db, fromNumber, "user", text);
      ssePublish("channel.whatsapp", { direction: "inbound", from: fromNumber, text, message_type: msgType });
      await processInbound(db, ssePublish, fromNumber, text);
    } catch (err) {
      console.error("WhatsApp processing failed:", err);
      ssePublish("agent.error", { error: err.message });
    }
  })();
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    whatsapp_number: setting("WHATSAPP_NUMBER") || "",
    city: setting("DEFAULT_CITY") || "Amsterdam",
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    whatsapp_number: setting("WHATSAPP_NUMBER") || "",
    city: setting("DEFAULT_CITY") || "Amsterdam",
    cuisines: CUISINES,
  });
});

app.get("/api/cuisines", (_req, res) => {
  res.json(CUISINES);
});

app.get("/api/restaurants", async (req, res) => {
  const defaultCity = setting("DEFAULT_CITY") || "Amsterdam";
  const city = req.query.city?.trim() || defaultCity;
  const cuisine = req.query.cuisine?.trim() || "All";
  const q = req.query.q?.trim() || "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 12));

  const cityLower = city.toLowerCase().trim();
  let { results: rows } = await db.prepare(
    "SELECT * FROM restaurants WHERE city LIKE ? OR address LIKE ? ORDER BY name"
  ).bind(`%${cityLower}%`, `%${city}%`).all();

  if (!rows.length) {
    let restaurants = await fetchGoogleRestaurants(city);
    if (restaurants.length < 3) restaurants = getFallbackRestaurants(city);
    await cacheRestaurants(db, restaurants, city);
    let result = restaurants;
    // Apply filters on the fresh data
    if (cuisine && cuisine.toLowerCase() !== "all") {
      const cf = cuisine.toLowerCase();
      result = result.filter((r) => (r.cuisine || "").toLowerCase().includes(cf));
    }
    if (q) {
      const ql = q.toLowerCase();
      result = result.filter((r) => (r.name || "").toLowerCase().includes(ql) || (r.cuisine || "").toLowerCase().includes(ql));
    }
    const total = result.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * perPage;
    return res.json({ restaurants: result.slice(start, start + perPage), total, page: safePage, per_page: perPage, total_pages: totalPages });
  }

  let result = rows;

  // Apply cuisine filter
  if (cuisine && cuisine.toLowerCase() !== "all") {
    const cf = cuisine.toLowerCase();
    let filtered = result.filter((r) => (r.cuisine || "").toLowerCase().includes(cf));
    if (!filtered.length && setting("GOOGLE_PLACES_API_KEY")) {
      const fresh = await fetchGoogleRestaurants(city, cuisine);
      if (fresh.length) await cacheRestaurants(db, fresh, city);
      filtered = fresh;
    }
    result = filtered;
  }

  // Apply text search
  if (q) {
    const ql = q.toLowerCase();
    result = result.filter((r) => (r.name || "").toLowerCase().includes(ql) || (r.cuisine || "").toLowerCase().includes(ql));
  }

  const total = result.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * perPage;
  res.json({ restaurants: result.slice(start, start + perPage), total, page: safePage, per_page: perPage, total_pages: totalPages });
});

app.post("/api/restaurants/refresh", async (req, res) => {
  const defaultCity = setting("DEFAULT_CITY") || "Amsterdam";
  const city = req.body?.city?.trim() || req.query.city?.trim() || defaultCity;

  await db.prepare("DELETE FROM restaurants WHERE address LIKE ?").bind(`%${city}%`).run();

  let restaurants = await fetchGoogleRestaurants(city);
  if (restaurants.length < 3) restaurants = getFallbackRestaurants(city);
  await cacheRestaurants(db, restaurants, city);
  res.json({ status: "refreshed", count: restaurants.length, city });
});

app.get("/api/reservations", async (req, res) => {
  const dateStr = req.query.date || "";
  let rows, label;
  if (dateStr) {
    ({ results: rows } = await db.prepare(
      `SELECT r.*, rest.name as restaurant_name FROM reservations r
       LEFT JOIN restaurants rest ON r.restaurant_id = rest.id
       WHERE r.date = ? ORDER BY r.time`
    ).bind(dateStr).all());
    label = dateStr;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    ({ results: rows } = await db.prepare(
      `SELECT r.*, rest.name as restaurant_name FROM reservations r
       LEFT JOIN restaurants rest ON r.restaurant_id = rest.id
       WHERE r.date >= ? ORDER BY r.date, r.time`
    ).bind(today).all());
    label = today;
  }
  res.json({ date: label, reservations: rows });
});

app.patch("/api/reservations/:id", async (req, res) => {
  const resId = req.params.id;
  const newStatus = req.body?.status;
  if (!newStatus) return res.status(400).json({ error: "status is required" });

  const validStatuses = ["pending", "confirmed", "cancelled", "completed", "no_show"];
  if (!validStatuses.includes(newStatus)) return res.status(400).json({ error: "Invalid status" });

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?"
  ).bind(newStatus, now, resId).run();

  const row = await db.prepare(
    `SELECT r.*, rest.name as restaurant_name FROM reservations r
     LEFT JOIN restaurants rest ON r.restaurant_id = rest.id WHERE r.id = ?`
  ).bind(resId).first();

  if (!row) return res.status(404).json({ error: "Not found" });
  ssePublish("reservation.update", { reservation: row });
  res.json(row);
});

// Serve index.html for root
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
const { db: database, engine } = await openDb(path.join(__dirname, "data"));
db = database;
console.log(`Database engine: ${engine}`);

await seedRestaurants(db);

app.listen(PORT, () => {
  console.log(`DineNyx running on http://localhost:${PORT}`);
});
