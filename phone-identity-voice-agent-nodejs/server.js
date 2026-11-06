/* ------------------------------------------------------------------ *
 *  server.js — Apex Bank AI Contact Center                            *
 *  Inbound call → Number Lookup → Risk Assessment → AI Assistant      *
 *  with live dashboard via SSE.                                       *
 * ------------------------------------------------------------------ */

import express from "express";


import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setting, onEdge } from "./settings.js";
import {
  numberLookup,
  assessRisk,
  buildDynamicVars,
  buildIdentityCard,
} from "./lookup.js";

/* ── Load .env locally (override existing shell vars) ────────────── */
if (!onEdge()) {
  try {
    const { readFileSync } = await import("node:fs");
    const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) process.env[match[1]] = match[2];
    }
  } catch { /* no .env file — fine */ }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const API = "https://api.telnyx.com/v2";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ── Live state ────────────────────────────────────────────────────── */
let callState = freshState();
let lookupReady = null; // resolves when Number Lookup + risk assessment is done

function freshState() {
  return {
    status: "idle",          // idle | incoming | lookup | answered | ai_connected | ended
    phone: null,
    callControlId: null,
    callStartedAt: null,
    identity: null,          // from buildIdentityCard
    dynamicVars: null,       // from buildDynamicVars
    events: [],              // timeline entries
  };
}

function pushEvent(type, detail = {}) {
  const entry = { type, ts: new Date().toISOString(), ...detail };
  callState.events.push(entry);
  ssePublish(type, { ...entry, state: callState.status });
}

/* ── SSE (Server-Sent Events) ──────────────────────────────────────── */
const subscribers = [];

function ssePublish(eventType, data) {
  const payload = JSON.stringify({ type: eventType, ts: new Date().toISOString(), ...data });
  const dead = [];
  for (const res of subscribers) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const d of dead) {
    const idx = subscribers.indexOf(d);
    if (idx !== -1) subscribers.splice(idx, 1);
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
  const keepalive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch { /* closed */ }
  }, 30_000);
  req.on("close", () => {
    clearInterval(keepalive);
    const idx = subscribers.indexOf(res);
    if (idx !== -1) subscribers.splice(idx, 1);
  });
});

/* ── Webhook signature verification ───────────────────────────────── */

function verifySignature(req) {
  const publicKey = setting("TELNYX_PUBLIC_KEY");
  if (!publicKey) return true; // skip verification if no key configured (dev mode)

  const signature = req.headers["telnyx-signature-ed25519"];
  const timestamp = req.headers["telnyx-timestamp"];
  if (!signature || !timestamp) return false;

  try {
    const payload = timestamp + JSON.stringify(req.body);
    return crypto.verify(
      null,
      Buffer.from(payload),
      { key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" },
      Buffer.from(signature, "base64")
    );
  } catch (err) {
    console.error("Signature verification error:", err.message);
    return false;
  }
}

/* ── Call Control webhook handler ──────────────────────────────────── */

app.post("/webhooks/call-events", async (req, res) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  res.status(200).json({ ok: true }); // ACK immediately

  const body = req.body;
  const data = body.data || {};
  const payload = data.payload || {};
  const eventType = data.event_type || payload.event_type || "";
  const ccid = payload.call_control_id || "";

  console.log(`Webhook: ${eventType} | ccid: ${ccid} | direction: ${payload.direction || "n/a"}`);

  try {
    if (eventType === "call.initiated" && payload.direction === "incoming") {
      await handleCallInitiated(ccid, payload);
    } else if (eventType === "call.answered") {
      await handleCallAnswered(ccid, payload);
    } else if (eventType === "call.hangup") {
      handleCallHangup(ccid, payload);
    } else if (eventType === "call.ai_assistant.started" || eventType === "call.conversation.created") {
      handleAiStarted(ccid, payload);
    } else if (eventType === "call.conversation.ended") {
      await handleConversationEnded(ccid, payload);
    } else if (eventType === "call.transcription") {
      handleTranscription(payload);
    } else {
      // Log any unhandled events so we can see what Telnyx sends
      console.log(`Unhandled event: ${eventType} | payload keys: ${Object.keys(payload).join(", ")}`);
    }
  } catch (err) {
    console.error(`Error handling ${eventType}:`, err.message);
  }
});

/* ── call.initiated → lookup + answer ─────────────────────────────── */

async function handleCallInitiated(ccid, payload) {
  const from = payload.from || "";
  console.log(`Incoming call from ${from} (ccid: ${ccid})`);

  // Reset transcription alternation state
  expectedNextRole = null;

  // Reset state for new call
  callState = freshState();
  callState.status = "incoming";
  callState.phone = from;
  callState.callControlId = ccid;
  callState.callStartedAt = new Date().toISOString();

  pushEvent("call.incoming", { phone: from });

  // 1. Start Number Lookup BEFORE answering so the promise exists
  //    when handleCallAnswered fires (avoids race condition).
  callState.status = "lookup";
  pushEvent("lookup.started", { phone: from });

  lookupReady = (async () => {
    let lookupData;
    try {
      lookupData = await numberLookup(from);
    } catch (err) {
      console.error("Number Lookup failed:", err.message);
      lookupData = { phone_number: from, carrier: {}, caller_name: {}, portability: {} };
    }

    const risk = assessRisk(lookupData);
    const identity = buildIdentityCard(from, lookupData, risk);
    const dynamicVars = buildDynamicVars(lookupData, risk);

    callState.identity = identity;
    callState.dynamicVars = dynamicVars;

    pushEvent("lookup.complete", { identity });
    pushEvent("risk.assessed", {
      score: risk.score,
      level: risk.level,
      factors: risk.factors,
    });
  })();

  // 2. Answer the call (runs in parallel with lookup)
  console.log("Answering call...");
  await callControlAction(ccid, "answer");

  // 3. Wait for lookup to finish too
  await lookupReady;
}

/* ── call.answered → start AI Assistant ───────────────────────────── */

async function handleCallAnswered(ccid, _payload) {
  callState.status = "answered";
  pushEvent("call.answered");

  // Wait for Number Lookup to finish so the AI gets real identity data.
  // Without this, the AI starts with fallback "No identity data available"
  // and asks for SSN verification even when the caller is trusted.
  if (lookupReady) {
    console.log("Waiting for Number Lookup to finish before starting AI...");
    await lookupReady;
    console.log("Lookup done — dynamicVars ready:", !!callState.dynamicVars);
  }

  const assistantId = setting("TELNYX_ASSISTANT_ID");
  if (!assistantId) {
    console.error("TELNYX_ASSISTANT_ID not configured — cannot start AI Assistant");
    pushEvent("ai.error", { message: "Assistant ID not configured" });
    return;
  }

  const vars = callState.dynamicVars || {
    callerContext: "No identity data available.",
    behaviorInstructions: "Use standard verification procedures.",
    greetingText: "Thank you for calling Apex Bank. How can I help you?",
  };

  try {
    const key = setting("TELNYX_API_KEY");
    const aiBody = {
      assistant: {
        id: assistantId,
        dynamic_variables: {
          caller_context: vars.callerContext,
          behavior_instructions: vars.behaviorInstructions,
          greeting_text: vars.greetingText,
        },
      },
    };

    console.log("ai_assistant_start payload:", JSON.stringify(aiBody, null, 2));

    const resp = await fetch(`${API}/calls/${ccid}/actions/ai_assistant_start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(aiBody),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`ai_assistant_start failed (${resp.status}):`, text.slice(0, 500));
      pushEvent("ai.error", { message: `Failed to start AI (${resp.status})` });
      return;
    }

    pushEvent("ai.starting", { mode: callState.identity?.trustLevel || "standard" });
  } catch (err) {
    console.error("ai_assistant_start error:", err.message);
    pushEvent("ai.error", { message: err.message });
  }
}

/* ── call.ai_assistant.started ─────────────────────────────────────── */

function handleAiStarted(ccid, _payload) {
  callState.status = "ai_connected";
  pushEvent("ai.started", {
    mode: callState.identity?.trustLevel || "standard",
    greeting: callState.dynamicVars?.greetingText || "",
  });

  // AI speaks first (greeting), then caller, then AI, etc.
  expectedNextRole = "ai";

  // Start transcription so we get live speech events for the dashboard
  // transcription_tracks: "both" captures caller (inbound) AND AI (outbound)
  callControlAction(ccid, "transcription_start", {
    transcription_engine: "B",
    transcription_tracks: "both",
  }).catch((err) => console.error("transcription_start failed:", err.message));
}

/* ── call.conversation.ended → hang up the call ──────────────────── */

async function handleConversationEnded(ccid, _payload) {
  if (callState.status === "ended") return; // already hung up
  console.log("Conversation ended — hanging up call");
  await callControlAction(ccid, "hangup");
}

/* ── call.hangup ───────────────────────────────────────────────────── */

function handleCallHangup(ccid, payload) {
  const duration = callState.callStartedAt
    ? Math.round((Date.now() - new Date(callState.callStartedAt).getTime()) / 1000)
    : 0;

  callState.status = "ended";
  pushEvent("call.ended", {
    reason: payload.hangup_cause || "normal",
    duration,
  });
}

/* ── call.transcription → live speech for dashboard ───────────────── */

// Telnyx transcription with engine "B" does not label inbound vs outbound in the
// webhook payload (channel is always empty, leg ID is the same for both).
// We use an alternation heuristic: the AI speaks first (greeting), then caller,
// then AI, and so on. This matches the natural turn-taking of a phone call.
let expectedNextRole = null; // set to "ai" when AI Assistant starts

function handleTranscription(payload) {
  const data = payload.transcription_data || {};
  const text = (data.transcript || "").trim();

  // Only forward final transcriptions with actual text
  if (!text || data.is_final === false) return;

  // Alternation: AI speaks first after assistant starts, then they take turns
  const role = expectedNextRole || "caller";
  if (expectedNextRole) {
    expectedNextRole = role === "ai" ? "caller" : "ai";
  }

  console.log(`Transcript [${role}]: ${text.slice(0, 80)}`);
  ssePublish("transcript", { role, text });

  // Detect when the AI confirms verification is complete → unlock accounts on
  // dashboard.  We check ALL transcriptions regardless of the guessed role
  // because the alternation heuristic can mislabel speakers; the verification
  // phrase only ever comes from the AI so a false positive is extremely unlikely.
  if (/\bverif(?:ied|ication)\b/i.test(text)) {
    console.log("Verification detected in transcript — unlocking accounts");
    ssePublish("verification.complete", {});
  }
}

/* ── Call Control helper ───────────────────────────────────────────── */

async function callControlAction(ccid, action, extraBody = {}) {
  const key = setting("TELNYX_API_KEY");
  const url = `${API}/calls/${ccid}/actions/${action}`;
  console.log(`Call Control → POST ${url}`);
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(extraBody),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`Call Control ${action} failed (${resp.status}):`, text);
  }

  return resp;
}

/* ── API routes ────────────────────────────────────────────────────── */

/** Current state snapshot for dashboard initial load. */
app.get("/api/state", (_req, res) => {
  res.json(callState);
});

/** Hang up the live call (supervisor end-call button). */
app.post("/api/hangup", async (_req, res) => {
  const ccid = callState.callControlId;
  if (!ccid) return res.json({ ok: false, reason: "no active call" });
  try {
    await callControlAction(ccid, "hangup");
    res.json({ ok: true });
  } catch (err) {
    console.error("Supervisor hangup failed:", err.message);
    res.status(500).json({ ok: false, reason: err.message });
  }
});

/** Reset state (for re-recording demo). */
app.post("/api/reset", (_req, res) => {
  callState = freshState();
  lookupReady = null;
  ssePublish("state.reset", {});
  res.json({ ok: true });
});

/** Manual Number Lookup for testing. */
app.get("/lookup/:phone", async (req, res) => {
  const phone = req.params.phone;
  try {
    const lookupData = await numberLookup(phone);
    const risk = assessRisk(lookupData);
    const identity = buildIdentityCard(phone, lookupData, risk);
    const dynamicVars = buildDynamicVars(lookupData, risk);
    res.json({ identity, risk, dynamicVars, raw: lookupData });
  } catch (err) {
    console.error("Manual lookup error:", err.message);
    res.status(500).json({ error: "Lookup failed" });
  }
});

/** Health / readiness probe (Edge checks /health/readiness). */
app.get(["/health", "/health/{*path}"], (_req, res) => {
  res.json({
    status: "ok",
    edge: onEdge(),
    assistant: !!setting("TELNYX_ASSISTANT_ID"),
  });
});

/* ── Start ─────────────────────────────────────────────────────────── */

// PORT comes from the platform on Edge (not a PHONEID_ secret), so read it
// directly from process.env rather than through setting().
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  const phoneNumber = setting("TELNYX_PHONE_NUMBER") || "(not set)";
  console.log(`Apex Bank AI Contact Center listening on port ${PORT}`);
  console.log(`  Phone number: ${phoneNumber}`);
  console.log(`  AI Assistant: ${setting("TELNYX_ASSISTANT_ID") ? "configured" : "NOT configured"}`);
  console.log(`  Edge mode:    ${onEdge() ? "yes" : "no"}`);
  console.log(`  Dashboard:    http://localhost:${PORT}`);
});
