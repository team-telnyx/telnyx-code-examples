// FreshCart — AI-powered grocery delivery via WhatsApp.
// Express entrypoint: routes, SSE, webhook, startup.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { setting } from "./settings.js";
import { openDb } from "./db.js";
import { CATEGORIES, searchProducts, seedProducts, getSpecials } from "./products.js";
import { transcribeAudio, sendText } from "./whatsapp.js";
import { processInbound, storeMessage } from "./ai.js";
import {
  getCart, cartTotal, getAvailableSlots,
  getAllOrders, getOrderById, advanceOrder,
  getAllSubstitutions, ORDER_STATUSES, statusLabel,
} from "./orders.js";

// Load .env with override — process.loadEnvFile() won't override existing shell
// env vars, which silently causes wrong API keys. Parse manually and force-set.
import { readFileSync } from "node:fs";
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
} catch { /* no .env — fine on Edge */ }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

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
// Database
// ---------------------------------------------------------------------------
let db;
let dbReady;
const dbPromise = new Promise((resolve) => { dbReady = resolve; });

// ---------------------------------------------------------------------------
// Webhook — inbound WhatsApp messages
// ---------------------------------------------------------------------------
app.post("/webhooks/whatsapp", (req, res) => {
  const payload = req.body;
  console.log("[webhook] Received:", JSON.stringify({ event: payload?.data?.event_type, from: payload?.data?.payload?.from?.phone_number, to: payload?.data?.payload?.to }).slice(0, 200));
  if (!payload) return res.status(400).json({ error: "No payload" });

  const data = payload.data || {};
  const p = data.payload || {};

  if (data.event_type !== "message.received") { console.log("[webhook] Ignored: event_type =", data.event_type); return res.json({ status: "ignored" }); }
  if (p.direction !== "inbound") { console.log("[webhook] Ignored: direction =", p.direction); return res.json({ status: "ignored" }); }

  const fromNumber = p.from?.phone_number || "";
  if (!fromNumber) { console.log("[webhook] Ignored: no fromNumber"); return res.json({ status: "ignored" }); }

  const waNumber = setting("WHATSAPP_NUMBER");
  if (fromNumber === waNumber) { console.log("[webhook] Ignored: message from own number"); return res.json({ status: "ignored" }); }

  const msgId = p.id || data.id || "";
  if (isDuplicate(msgId, fromNumber)) { console.log("[webhook] Ignored: duplicate"); return res.json({ status: "duplicate" }); }

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
    text = "__audio__";
  } else {
    const caption = body.caption || (body[msgType] || {}).caption || "";
    text = caption || `[${msgType} message received]`;
  }

  console.log("[webhook] Processing message from", fromNumber, "| type:", msgType, "| text:", text?.slice(0, 80));

  // Return 200 immediately, process in background
  res.json({ status: "processing" });

  (async () => {
    try {
      await dbPromise;

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
      console.log("[ai] Starting inference for", fromNumber);
      await processInbound(db, ssePublish, fromNumber, text);
      console.log("[ai] Done processing for", fromNumber);
    } catch (err) {
      console.error("[ai] WhatsApp processing failed:", err.message);
      ssePublish("agent.error", { error: err.message });
    }
  })();
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------
app.get(["/health", "/health/{*path}"], (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    whatsapp_number: setting("WHATSAPP_NUMBER") || "",
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
    whatsapp_number: setting("WHATSAPP_NUMBER") || "",
    categories: CATEGORIES,
  });
});

app.get("/api/categories", (_req, res) => {
  res.json(CATEGORIES);
});

app.get("/api/products", async (req, res) => {
  const category = req.query.category?.trim() || "";
  const q = req.query.q?.trim() || "";
  const specials = req.query.specials === "true";

  if (specials) {
    const products = await getSpecials(db);
    return res.json({ products, total: products.length });
  }

  const products = await searchProducts(db, q, category);
  res.json({ products, total: products.length });
});

app.get("/api/orders", async (req, res) => {
  const phone = req.query.phone || "";
  if (phone) {
    const { results } = await db.prepare(
      "SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at DESC LIMIT 20"
    ).bind(phone).all();
    return res.json({ orders: results });
  }
  const orders = await getAllOrders(db);
  res.json({ orders });
});

app.get("/api/orders/:id", async (req, res) => {
  const order = await getOrderById(db, req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order });
});

app.post("/api/orders/:id/advance", async (req, res) => {
  const result = await advanceOrder(db, ssePublish, req.params.id);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ order: result });

  // Send WhatsApp update to customer + store in conversation + SSE
  const phone = result.customer_phone;
  if (phone) {
    const msgs = {
      picking:          "🛒 Great news! Your order is now being picked — our team is collecting your items from the shelves.",
      packed:           "📦 Your order is all packed up and ready to go!",
      out_for_delivery: "🚗 Your order is on its way! Keep an eye out — your delivery will be there soon.",
      delivered:        "✅ Your order has been delivered! Enjoy your groceries. Thanks for shopping with FreshCart!",
    };
    const msg = msgs[result.status];
    if (msg) {
      sendText(phone, msg).catch((err) => console.error("[advance] WhatsApp notify failed:", err.message));
      storeMessage(db, phone, "assistant", msg).catch(() => {});
      ssePublish("channel.whatsapp", { direction: "outbound", text: msg, to: phone, message_type: "text" });
    }
  }
});

app.get("/api/substitutions", async (_req, res) => {
  const subs = await getAllSubstitutions(db);
  res.json({ substitutions: subs });
});

app.get("/api/delivery-slots", async (_req, res) => {
  const slots = await getAvailableSlots(db);
  res.json({ slots });
});

app.get("/api/cart/:phone", async (req, res) => {
  const items = await getCart(db, req.params.phone);
  const total = cartTotal(items);
  res.json({ items, total: total.toFixed(2) });
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

app.post("/api/customers", async (req, res) => {
  let { phone, name, address } = req.body || {};
  if (!phone || !name) return res.status(400).json({ error: "phone and name are required" });

  // Normalize phone via Telnyx Number Lookup API — returns E.164 format
  const apiKey = setting("TELNYX_API_KEY");
  let e164Phone = phone;
  if (apiKey) {
    try {
      const nlResp = await fetch(
        `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(phone)}`,
        { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
      );
      if (nlResp.ok) {
        const nlData = await nlResp.json();
        if (nlData.data && nlData.data.valid_number === false) {
          return res.status(422).json({ error: "This phone number is not valid. Please enter a real phone number with country code." });
        }
        // Use the E.164 phone returned by Number Lookup
        if (nlData.data?.phone_number) e164Phone = nlData.data.phone_number;
      }
    } catch (err) {
      console.error("Number Lookup failed (proceeding anyway):", err.message);
    }
  }

  const now = new Date().toISOString();
  await db.prepare(
    "INSERT OR REPLACE INTO customers (phone, name, address, created_at) VALUES (?,?,?,?)"
  ).bind(e164Phone, name.trim(), (address || "").trim(), now).run();
  console.log(`[customer] Registered ${name.trim()} as ${e164Phone} (input: ${phone})`);
  res.json({ customer: { phone: e164Phone, name: name.trim(), address: (address || "").trim() } });
});

app.get("/api/customers/:phone", async (req, res) => {
  const row = await db.prepare("SELECT phone, name, address FROM customers WHERE phone = ?").bind(req.params.phone).first();
  if (!row) return res.status(404).json({ error: "Customer not found" });
  res.json({ customer: row });
});

app.get("/api/conversations", async (req, res) => {
  const since = req.query.since || "";
  const phone = req.query.phone || "";
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  let rows;
  if (since && phone) {
    ({ results: rows } = await db.prepare(
      "SELECT customer_phone, role, content, timestamp FROM conversations WHERE timestamp > ? AND customer_phone = ? ORDER BY timestamp ASC LIMIT ?"
    ).bind(since, phone, limit).all());
  } else if (since) {
    ({ results: rows } = await db.prepare(
      "SELECT customer_phone, role, content, timestamp FROM conversations WHERE timestamp > ? ORDER BY timestamp ASC LIMIT ?"
    ).bind(since, limit).all());
  } else if (phone) {
    ({ results: rows } = await db.prepare(
      "SELECT customer_phone, role, content, timestamp FROM conversations WHERE customer_phone = ? ORDER BY timestamp DESC LIMIT ?"
    ).bind(phone, limit).all());
    rows = rows.reverse();
  } else {
    ({ results: rows } = await db.prepare(
      "SELECT customer_phone, role, content, timestamp FROM conversations ORDER BY timestamp DESC LIMIT ?"
    ).bind(limit).all());
    rows = rows.reverse();
  }
  res.json({ messages: rows });
});

app.delete("/api/conversations", async (req, res) => {
  const phone = req.query.phone || "";
  if (phone) {
    await db.prepare("DELETE FROM conversations WHERE customer_phone = ?").bind(phone).run();
    await db.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_phone = ?)").bind(phone).run();
    await db.prepare("DELETE FROM substitutions WHERE order_id IN (SELECT id FROM orders WHERE customer_phone = ?)").bind(phone).run();
    await db.prepare("DELETE FROM orders WHERE customer_phone = ?").bind(phone).run();
    await db.prepare("DELETE FROM cart_items WHERE customer_phone = ?").bind(phone).run();
  } else {
    await db.prepare("DELETE FROM conversations").run();
    await db.prepare("DELETE FROM ui_events").run();
    await db.prepare("DELETE FROM order_items").run();
    await db.prepare("DELETE FROM substitutions").run();
    await db.prepare("DELETE FROM orders").run();
    await db.prepare("DELETE FROM cart_items").run();
  }
  res.json({ status: "cleared" });
});

// Serve index.html for root
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`FreshCart running on http://localhost:${PORT}`);
  console.log(`WhatsApp number: ${setting("WHATSAPP_NUMBER") || "(not set)"}`);
  console.log(`Messaging profile: ${setting("WHATSAPP_MESSAGING_PROFILE_ID") || "(not set)"}`);
  console.log(`API key: ${(setting("TELNYX_API_KEY") || "").slice(0, 12)}...`);
  console.log(`WABA key: ${(setting("TELNYX_WHATSAPP_API_KEY") || "").slice(0, 12)}...`);
  openDb(path.join(__dirname, "data")).then(({ db: database, engine }) => {
    db = database;
    console.log(`Database engine: ${engine}`);
    dbReady();
    seedProducts(db).catch((err) => console.error("Seed failed:", err.message));
  }).catch((err) => {
    console.error("DB init failed:", err.message);
    dbReady();
  });
});
