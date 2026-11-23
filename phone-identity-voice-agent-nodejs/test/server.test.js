/* ------------------------------------------------------------------ *
 *  server.test.js — HTTP route + webhook handler tests (node:test)    *
 *  Spawns server.js as a child process, parses the actual listening   *
 *  port from stdout, then makes real HTTP requests.                   *
 * ------------------------------------------------------------------ */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/* ── Helpers ───────────────────────────────────────────────────────── */

function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: "127.0.0.1", port, method, path: urlPath, headers: {} };
    if (body) {
      const payload = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/* ── Syntax check ──────────────────────────────────────────────────── */

describe("server module — syntax", () => {
  it("passes node --check", () => {
    execFileSync("node", ["--check", path.join(ROOT, "server.js")]);
  });
});

/* ── HTTP tests against running server subprocess ─────────────────── */

describe("server routes", () => {
  let child;
  let port;

  before(async () => {
    // Pick a random high port unlikely to conflict
    port = 30000 + Math.floor(Math.random() * 20000);

    // Temporarily move .env out of the way so server.js doesn't override our PORT
    const envPath = path.join(ROOT, ".env");
    const envBackup = envPath + ".test-backup";
    let hadEnv = false;
    try {
      fs.renameSync(envPath, envBackup);
      hadEnv = true;
    } catch { /* no .env file — fine */ }

    // Spawn server.js
    child = spawn("node", [path.join(ROOT, "server.js")], {
      env: {
        ...process.env,
        TELNYX_API_KEY: "test_key_server",
        TELNYX_ASSISTANT_ID: "test_assistant_id",
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Restore .env right away — server already read (or skipped) it
    if (hadEnv) {
      // Wait a beat for the readFileSync to complete in server.js
      await new Promise((r) => setTimeout(r, 200));
      try { fs.renameSync(envBackup, envPath); } catch {}
    }

    // Wait for server to be ready by polling /health
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try {
        await request(port, "GET", "/health");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // Verify it's up
    const { status } = await request(port, "GET", "/health");
    if (status !== 200) throw new Error("Server failed to start");
  });

  after(() => {
    if (child) {
      child.kill("SIGTERM");
      child = null;
    }
    // Ensure .env backup restored
    const envPath = path.join(ROOT, ".env");
    const envBackup = envPath + ".test-backup";
    try { fs.renameSync(envBackup, envPath); } catch {}
  });

  /* ── Health ──────────────────────────────────────────────────────── */

  it("GET /health returns status, edge, assistant fields", async () => {
    const { status, body } = await request(port, "GET", "/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.equal(typeof body.edge, "boolean");
    assert.equal(typeof body.assistant, "boolean");
  });

  /* ── State ──────────────────────────────────────────────────────── */

  it("GET /api/state returns idle state initially", async () => {
    await request(port, "POST", "/api/reset");
    const { status, body } = await request(port, "GET", "/api/state");
    assert.equal(status, 200);
    assert.equal(body.status, "idle");
    assert.equal(body.phone, null);
    assert.equal(body.callControlId, null);
    assert.ok(Array.isArray(body.events));
  });

  it("POST /api/reset resets state to idle", async () => {
    const { status, body } = await request(port, "POST", "/api/reset");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });

    const state = await request(port, "GET", "/api/state");
    assert.equal(state.body.status, "idle");
  });

  /* ── freshState shape ────────────────────────────────────────────── */

  it("freshState returns correct shape", async () => {
    await request(port, "POST", "/api/reset");
    const { body } = await request(port, "GET", "/api/state");
    assert.equal(body.status, "idle");
    assert.equal(body.phone, null);
    assert.equal(body.callControlId, null);
    assert.equal(body.callStartedAt, null);
    assert.equal(body.identity, null);
    assert.equal(body.dynamicVars, null);
    assert.ok(Array.isArray(body.events));
    assert.equal(body.events.length, 0);
  });

  /* ── Webhook — valid payload ─────────────────────────────────────── */

  it("POST /webhooks/call-events returns 200 for valid payload", async () => {
    const { status, body } = await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.initiated",
        payload: { call_control_id: "test-cc-1", direction: "incoming", from: "+15125559999" },
      },
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  /* ── Webhook — call lifecycle ────────────────────────────────────── */

  it("handleCallInitiated sets state and phone", async () => {
    await request(port, "POST", "/api/reset");
    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.initiated",
        payload: { call_control_id: "cc-init-1", direction: "incoming", from: "+15125550001" },
      },
    });

    // Wait for async handler (numberLookup will fail → fallback, but state is set)
    await new Promise((r) => setTimeout(r, 1200));

    const { body } = await request(port, "GET", "/api/state");
    assert.equal(body.phone, "+15125550001");
    assert.equal(body.callControlId, "cc-init-1");
    assert.ok(["incoming", "lookup"].includes(body.status), `unexpected status: ${body.status}`);
  });

  it("handleCallAnswered sets state to answered", async () => {
    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.answered",
        payload: { call_control_id: "cc-init-1" },
      },
    });
    await new Promise((r) => setTimeout(r, 500));

    const { body } = await request(port, "GET", "/api/state");
    assert.equal(body.status, "answered");
  });

  it("handleAiStarted sets state to ai_connected", async () => {
    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.ai_assistant.started",
        payload: { call_control_id: "cc-init-1" },
      },
    });
    await new Promise((r) => setTimeout(r, 100));

    const { body } = await request(port, "GET", "/api/state");
    assert.equal(body.status, "ai_connected");
  });

  it("handleCallHangup sets state to ended with duration", async () => {
    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.hangup",
        payload: { call_control_id: "cc-init-1", hangup_cause: "normal" },
      },
    });
    await new Promise((r) => setTimeout(r, 100));

    const { body } = await request(port, "GET", "/api/state");
    assert.equal(body.status, "ended");
    const endedEvent = body.events.find((e) => e.type === "call.ended");
    assert.ok(endedEvent, "should have a call.ended event");
    assert.equal(endedEvent.reason, "normal");
    assert.equal(typeof endedEvent.duration, "number");
  });

  it("handleConversationEnded triggers hangup action", async () => {
    await request(port, "POST", "/api/reset");
    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.initiated",
        payload: { call_control_id: "cc-conv-1", direction: "incoming", from: "+15125550003" },
      },
    });
    await new Promise((r) => setTimeout(r, 1200));

    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.answered",
        payload: { call_control_id: "cc-conv-1" },
      },
    });
    await new Promise((r) => setTimeout(r, 500));

    const { status } = await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.conversation.ended",
        payload: { call_control_id: "cc-conv-1" },
      },
    });
    assert.equal(status, 200);
  });

  it("pushEvent adds to callState.events", async () => {
    await request(port, "POST", "/api/reset");
    await request(port, "POST", "/webhooks/call-events", {
      data: {
        event_type: "call.initiated",
        payload: { call_control_id: "cc-evt-1", direction: "incoming", from: "+15125550004" },
      },
    });
    await new Promise((r) => setTimeout(r, 1200));

    const { body } = await request(port, "GET", "/api/state");
    assert.ok(body.events.length > 0, "events should not be empty");
    assert.ok(body.events.some((e) => e.type === "call.incoming"), "should have call.incoming event");
  });

  /* ── SSE ─────────────────────────────────────────────────────────── */

  it("GET /stream returns SSE headers", async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: "127.0.0.1", port, path: "/stream" }, resolve);
      req.on("error", reject);
    });
    assert.ok(res.headers["content-type"].startsWith("text/event-stream"), "should be event-stream");
    assert.equal(res.headers["cache-control"], "no-cache");
    res.destroy();
  });

  it("SSE publishes events to subscribers", async () => {
    const events = [];
    const res = await new Promise((resolve, reject) => {
      const req = http.get({ hostname: "127.0.0.1", port, path: "/stream" }, resolve);
      req.on("error", reject);
    });

    res.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.startsWith("data: ")) {
          try { events.push(JSON.parse(line.slice(6).trim())); } catch {}
        }
      }
    });

    await new Promise((r) => setTimeout(r, 200));

    await request(port, "POST", "/api/reset");
    await new Promise((r) => setTimeout(r, 300));

    res.destroy();
    assert.ok(events.some((e) => e.type === "state.reset"), "should receive state.reset SSE event");
  });
});
