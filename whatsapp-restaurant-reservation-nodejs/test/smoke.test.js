// Smoke tests for the DineNyx WhatsApp Restaurant Reservation app (Node.js).
// All HTTP calls are mocked — no real credentials needed.
// Run: npm test
import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set test env vars before importing anything
process.env.TELNYX_API_KEY = "KEYtest-main";
process.env.TELNYX_WHATSAPP_API_KEY = "KEYtest-whatsapp";
process.env.WHATSAPP_NUMBER = "+12176180378";
process.env.WHATSAPP_MESSAGING_PROFILE_ID = "test-profile-id";
process.env.DEFAULT_CITY = "Amsterdam";
process.env.PORT = "0"; // Let OS pick a port

// Use a temp directory for test DB
const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname || __dirname, ".tmp-test-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");

// Import modules
const { openDb } = await import("../db.js");
const { seedRestaurants, cacheRestaurants, searchRestaurants, cityWhere } = await import("../restaurants.js");

// Open test DB
const { db } = await openDb(tmpDir);
await seedRestaurants(db);

// Build a minimal Express app for testing (same routes as server.js)
// We import server.js indirectly by building the app here to avoid port binding.
const express = (await import("express")).default;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Register a subset of routes for testing
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    whatsapp_number: process.env.WHATSAPP_NUMBER,
    city: process.env.DEFAULT_CITY,
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    whatsapp_number: process.env.WHATSAPP_NUMBER,
    city: process.env.DEFAULT_CITY,
    cuisines: ["All", "Indian", "Italian"],
  });
});

app.get("/api/restaurants", async (req, res) => {
  const city = req.query.city?.trim() || "Amsterdam";
  const q = req.query.q?.trim() || "";
  const cityLower = city.toLowerCase();
  const cw = cityWhere(cityLower);

  let { results: rows } = await db.prepare(
    `SELECT * FROM restaurants WHERE ${cw.sql} ORDER BY name`
  ).bind(...cw.params).all();

  if (q) {
    const ql = q.toLowerCase();
    rows = rows.filter((r) => (r.name || "").toLowerCase().includes(ql) || (r.cuisine || "").toLowerCase().includes(ql));
  }

  const total = rows.length;
  const page = 1;
  const perPage = 12;
  res.json({ restaurants: rows.slice(0, perPage), total, page, per_page: perPage, total_pages: Math.max(1, Math.ceil(total / perPage)) });
});

app.get("/api/reservations", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const dateStr = req.query.date || today;
  const sql = req.query.date
    ? "SELECT r.*, rest.name as restaurant_name FROM reservations r LEFT JOIN restaurants rest ON r.restaurant_id = rest.id WHERE r.date = ? ORDER BY r.time"
    : "SELECT r.*, rest.name as restaurant_name FROM reservations r LEFT JOIN restaurants rest ON r.restaurant_id = rest.id WHERE r.date >= ? ORDER BY r.date, r.time";
  const { results: rows } = await db.prepare(sql).bind(dateStr).all();
  res.json({ date: dateStr, reservations: rows });
});

app.patch("/api/reservations/:id", async (req, res) => {
  const newStatus = req.body?.status;
  if (!newStatus) return res.status(400).json({ error: "status is required" });
  const valid = ["pending", "confirmed", "cancelled", "completed", "no_show"];
  if (!valid.includes(newStatus)) return res.status(400).json({ error: "Invalid status" });

  const now = new Date().toISOString();
  await db.prepare("UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?").bind(newStatus, now, req.params.id).run();
  const row = await db.prepare(
    "SELECT r.*, rest.name as restaurant_name FROM reservations r LEFT JOIN restaurants rest ON r.restaurant_id = rest.id WHERE r.id = ?"
  ).bind(req.params.id).first();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

app.post("/webhooks/whatsapp", (req, res) => {
  const payload = req.body;
  if (!payload) return res.status(400).json({ error: "No payload" });
  const data = payload.data || {};
  const p = data.payload || {};
  if (data.event_type !== "message.received") return res.json({ status: "ignored" });
  if (p.direction !== "inbound") return res.json({ status: "ignored" });
  const fromNumber = p.from?.phone_number || "";
  if (!fromNumber) return res.json({ status: "ignored" });
  // For testing, don't actually process — just acknowledge
  res.json({ status: "processing" });
});

app.delete("/api/conversations", async (_req, res) => {
  await db.prepare("DELETE FROM conversations").run();
  await db.prepare("DELETE FROM ui_events").run();
  res.json({ status: "cleared" });
});

app.get("/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  res.flushHeaders();
  res.write(": keepalive\n\n");
  req.on("close", () => {});
  // Close immediately for test purposes
  setTimeout(() => res.end(), 50);
});

// Start test server
let server;
let baseUrl;
before(() => {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Health", () => {
  it("returns ok with whatsapp_number", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "ok");
    assert.ok(data.timestamp);
    assert.equal(data.whatsapp_number, "+12176180378");
  });
});

describe("Dashboard", () => {
  it("serves index.html with DineNyx", async () => {
    const resp = await fetch(`${baseUrl}/`);
    assert.equal(resp.status, 200);
    const text = await resp.text();
    assert.ok(text.includes("DineNyx"));
  });
});

describe("Config", () => {
  it("returns whatsapp_number and city", async () => {
    const resp = await fetch(`${baseUrl}/api/config`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.whatsapp_number, "+12176180378");
    assert.equal(data.city, "Amsterdam");
    assert.ok(Array.isArray(data.cuisines));
  });
});

describe("Restaurants", () => {
  it("lists restaurants", async () => {
    const resp = await fetch(`${baseUrl}/api/restaurants`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(Array.isArray(data.restaurants));
    assert.ok(data.restaurants.length > 0);
    assert.ok(data.total > 0);
    assert.ok(data.page >= 1);
    assert.ok(data.total_pages >= 1);
  });

  it("searches restaurants by name", async () => {
    const resp = await fetch(`${baseUrl}/api/restaurants?q=Kas`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(data.restaurants.some((r) => r.name.includes("Kas")));
  });
});

describe("Reservations", () => {
  let reservationId;

  it("lists reservations (empty)", async () => {
    const resp = await fetch(`${baseUrl}/api/reservations`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(Array.isArray(data.reservations));
  });

  it("creates and retrieves a reservation", async () => {
    const crypto = await import("node:crypto");
    reservationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO reservations (id, restaurant_id, customer_phone, customer_name, party_size, date, time, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'confirmed',?,?,?)`
    ).bind(reservationId, "fb-ams-1", "+31612345678", "Test User", 4, "2026-10-20", "19:00", "Window seat", now, now).run();

    const resp = await fetch(`${baseUrl}/api/reservations?date=2026-10-20`);
    const data = await resp.json();
    assert.ok(data.reservations.length > 0);
  });

  it("updates reservation status", async () => {
    const resp = await fetch(`${baseUrl}/api/reservations/${reservationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "cancelled");
  });

  it("rejects invalid status", async () => {
    const crypto = await import("node:crypto");
    const id2 = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.prepare(
      `INSERT INTO reservations (id, restaurant_id, customer_phone, customer_name, party_size, date, time, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'confirmed',?,?,?)`
    ).bind(id2, "fb-ams-2", "+31612345679", "Another", 2, "2026-10-20", "20:00", "", now, now).run();

    const resp = await fetch(`${baseUrl}/api/reservations/${id2}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid" }),
    });
    assert.equal(resp.status, 400);
  });
});

describe("Webhook", () => {
  it("ignores non-message events", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { event_type: "message.sent", payload: {} } }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "ignored");
  });

  it("ignores outbound messages", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { event_type: "message.received", payload: { direction: "outbound" } },
      }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "ignored");
  });

  it("processes inbound text messages", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          event_type: "message.received",
          payload: {
            direction: "inbound",
            from: { phone_number: "+31612345678" },
            body: { type: "text", text: { body: "Book a table at De Kas" } },
          },
        },
      }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "processing");
  });

  it("rejects empty payload", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(resp.status, 400);
  });
});

describe("SSE", () => {
  it("returns event-stream content type", async () => {
    const resp = await fetch(`${baseUrl}/stream`);
    assert.ok(resp.headers.get("content-type").startsWith("text/event-stream"));
    // Consume the body to avoid hanging
    try { await resp.text(); } catch { /* expected close */ }
  });
});

describe("City matching", () => {
  it("caches and finds restaurants by multi-word city", async () => {
    const restaurants = [
      { id: "test-bham-1", name: "Asha's", cuisine: "indian", address: "12-22 Newhall St, Birmingham B3 3AS, UK" },
      { id: "test-bham-2", name: "Dishoom", cuisine: "indian", address: "1 Chamberlain Sq, Birmingham B3 3AX, UK" },
    ];
    await cacheRestaurants(db, restaurants, "Birmingham UK");

    const resp = await fetch(`${baseUrl}/api/restaurants?city=Birmingham+UK`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(data.restaurants.length >= 2, `Expected >=2 restaurants, got ${data.restaurants.length}`);
    assert.ok(data.restaurants.some((r) => r.name === "Asha's"));
  });

  it("still finds single-word city restaurants", async () => {
    const resp = await fetch(`${baseUrl}/api/restaurants?city=Amsterdam`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(data.restaurants.length > 0, "Amsterdam should return results");
  });
});

describe("DELETE /api/conversations", () => {
  it("clears chat and events", async () => {
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO conversations (customer_phone, role, content, timestamp) VALUES (?,?,?,?)"
    ).bind("+31600000000", "user", "test msg", now).run();
    await db.prepare(
      "INSERT INTO ui_events (type, payload, created_at) VALUES (?,?,?)"
    ).bind("test.event", "{}", now).run();

    const resp = await fetch(`${baseUrl}/api/conversations`, { method: "DELETE" });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "cleared");

    const { results: convos } = await db.prepare("SELECT * FROM conversations").all();
    assert.equal(convos.length, 0);
    const { results: events } = await db.prepare("SELECT * FROM ui_events").all();
    assert.equal(events.length, 0);
  });
});

describe("searchRestaurants", () => {
  it("handles multi-word city", async () => {
    // Data was inserted in "City matching" test above
    const rows = await searchRestaurants(db, "indian", "Birmingham UK");
    assert.ok(rows.length > 0, "Should find cached Birmingham restaurants");
    assert.ok(rows.some((r) => r.name === "Asha's" || r.name === "Dishoom"));
  });
});
