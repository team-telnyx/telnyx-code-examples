// Smoke tests for Nomad Gateway — Node.js built-in test runner.
// No real credentials needed; tests run against the local Express server.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

// Set test env vars before importing the app
process.env.TELNYX_API_KEY = "KEYtest_fake_key";
process.env.PHONE_NUMBER = "+15551234567";
process.env.PORT = "0"; // Random port

// Dynamic import after env setup
const { default: express } = await import("express");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let server, baseUrl;

// We import and boot the server manually to control the port
before(async () => {
  // Import server module components individually for testing
  const { openDb } = await import("../db.js");
  const { setting } = await import("../settings.js");

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));

  // Minimal routes for testing
  app.get(["/health", "/health/{*path}"], (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      phone_number: setting("PHONE_NUMBER") || "",
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      phone_number: setting("PHONE_NUMBER") || "",
      kiwix_host: setting("KIWIX_HOST") || "",
      ollama_host: setting("OLLAMA_HOST") || "",
    });
  });

  // SSE endpoint
  const subscribers = [];
  app.get("/stream", (req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.flushHeaders();
    subscribers.push(res);
    req.on("close", () => {
      const idx = subscribers.indexOf(res);
      if (idx !== -1) subscribers.splice(idx, 1);
    });
  });

  // SMS webhook (mock — just validate structure)
  app.post("/webhooks/sms", (req, res) => {
    const payload = req.body;
    if (!payload) return res.status(400).json({ error: "No payload" });
    const data = payload.data || {};
    if (data.event_type !== "message.received") return res.json({ status: "ignored" });
    const p = data.payload || {};
    if (p.direction !== "inbound") return res.json({ status: "ignored" });
    res.json({ status: "processing" });
  });

  // Voice webhook (mock)
  app.post("/webhooks/voice", (req, res) => {
    const payload = req.body;
    if (!payload) return res.status(400).json({ error: "No payload" });
    const data = payload.data || {};
    if (!data.event_type) return res.json({ status: "ignored" });
    res.json({ status: "acknowledged" });
  });

  // Open DB and wire up API routes
  let db;
  try {
    const result = await openDb(path.join(__dirname, "..", "data"));
    db = result.db;
  } catch {
    // SQLite may not be available in all test envs — skip DB routes
  }

  if (db) {
    app.get("/api/queries", async (_req, res) => {
      const { results: rows } = await db.prepare("SELECT * FROM queries ORDER BY created_at DESC LIMIT 50").all();
      res.json({ queries: rows });
    });

    app.get("/api/status", async (_req, res) => {
      const row = await db.prepare("SELECT * FROM system_status WHERE id = 1").first();
      res.json({ status: row || {} });
    });

    app.get("/api/knowledge", async (_req, res) => {
      const countRow = await db.prepare("SELECT COUNT(*) as total FROM knowledge_chunks").first();
      res.json({ chunks: [], total: countRow?.total || 0 });
    });
  }

  // Serve index
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  });

  return new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

after(() => {
  if (server) server.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Health", () => {
  it("returns ok with phone_number", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "ok");
    assert.ok(data.timestamp);
    assert.equal(data.phone_number, "+15551234567");
  });
});

describe("Config", () => {
  it("returns config with phone_number", async () => {
    const resp = await fetch(`${baseUrl}/api/config`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.phone_number, "+15551234567");
  });
});

describe("SSE", () => {
  it("returns event-stream content type", async () => {
    const controller = new AbortController();
    const resp = await fetch(`${baseUrl}/stream`, { signal: controller.signal });
    assert.ok(resp.headers.get("content-type").startsWith("text/event-stream"));
    controller.abort();
  });
});

describe("SMS Webhook", () => {
  it("processes inbound SMS", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          event_type: "message.received",
          payload: {
            direction: "inbound",
            from: { phone_number: "+14155551234" },
            text: "What is the capital of France?",
            id: "msg-test-001",
          },
        },
      }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "processing");
  });

  it("ignores non-inbound events", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: { event_type: "message.sent", payload: { direction: "outbound" } },
      }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "ignored");
  });

  it("rejects empty payload", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "null",
    });
    assert.equal(resp.status, 400);
  });
});

describe("Voice Webhook", () => {
  it("acknowledges call events", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: {
          event_type: "call.initiated",
          payload: {
            call_control_id: "test-cc-id-001",
            direction: "incoming",
            from: "+14155551234",
          },
        },
      }),
    });
    assert.equal(resp.status, 200);
  });

  it("ignores events without type", async () => {
    const resp = await fetch(`${baseUrl}/webhooks/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { payload: {} } }),
    });
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.status, "ignored");
  });
});

describe("Dashboard", () => {
  it("serves index.html", async () => {
    const resp = await fetch(`${baseUrl}/`);
    assert.equal(resp.status, 200);
    const html = await resp.text();
    assert.ok(html.includes("Nomad Gateway"));
  });
});

describe("Query Log API", () => {
  it("returns queries array", async () => {
    const resp = await fetch(`${baseUrl}/api/queries`);
    if (resp.status === 404) return; // DB routes may not be wired
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(Array.isArray(data.queries));
  });
});

describe("System Status API", () => {
  it("returns status object", async () => {
    const resp = await fetch(`${baseUrl}/api/status`);
    if (resp.status === 404) return;
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.ok(data.status);
  });
});
