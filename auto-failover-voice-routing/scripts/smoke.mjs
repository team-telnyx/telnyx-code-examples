// Smoke test for auto-failover-voice-routing.
//
// Builds a tiny in-process actor host (Node Map storage standing in for the
// Edge actor storage), a Map-backed FAILOVER_KV namespace, and a MOCK TELNYX
// binding (dial/speak/gather/hangup/messages.send recording calls into arrays),
// then exercises the real compiled worker fetch handler end to end:
//
//   Phase A — demo mode (DEMO_MODE=true, webhook signatures skipped):
//     1. GET  /health                     → healthy, demo on
//     2. POST /api/route                  → primary (breaker closed), no dial
//     3. POST /webhooks/call-control      → non-primary failure NOT counted
//     4. POST /webhooks/call-control ×3   → state_changed failures trip breaker
//     5. GET  /api/circuit-state          → open
//     6. POST /api/route                  → backup connection
//     7. POST /api/circuit-reset          → breaker back to closed
//     8. POST /api/route                  → primary again
//     9. Cooldown=0: failures → half-open → route probes primary again
//    10. Call flow: answered → speak (SSML fraud alert) → speak.ended → gather
//        → gather.ended "2" → confirmation speak + SMS suppressed in demo
//        → speak.ended → hangup
//
//   Phase B — live mode with SKIP_WEBHOOK_VERIFY=1 (mock API, no network):
//    11. POST /api/route                  → real dial recorded by the mock
//    12. call.hangup (TIMEOUT) ×3         → breaker trips, ops SMS recorded
//    13. POST /api/route                  → backup connection
//    14. POST /api/circuit-reset          → primary again
//
// Run `npm run build` first; this imports the compiled dist/ output.

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distIndex = join(scriptDir, "..", "dist", "src", "index.js");
if (!existsSync(distIndex)) {
  console.error("dist/src/index.js not found — run `npm run build` first");
  process.exit(1);
}

const { default: worker } = await import(distIndex);
const { FailoverAgent } = await import(join(scriptDir, "..", "dist", "src", "failoverAgent.js"));

// Local smoke only: webhook bodies arrive without Ed25519 signatures here.
process.env.SKIP_WEBHOOK_VERIFY = "1";

const PRIMARY_ID = "conn-primary-smoke";
const BACKUP_ID = "conn-backup-smoke";
const FROM_NUMBER = "+15550001000";
const SMS_FROM_NUMBER = "+15550001001";
const OPS_ALERT_NUMBER = "+15550002000";
const TTS_VOICE = "Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02";

// ── In-memory actor storage (mirrors the ActorStorage surface the SDK uses) ──

function makeStorage() {
  const map = new Map();
  let alarm = null;
  const snapshot = (value) => (value === undefined ? undefined : structuredClone(value));
  const txn = (target) => ({
    get: async (key) => snapshot(target.get(key)),
    put: async (key, value) => {
      target.set(key, snapshot(value));
    },
    delete: async (key) => target.delete(key),
    list: async (options = {}) => listMap(target, options),
  });

  function listMap(source, options) {
    const keys = [...source.keys()]
      .filter((key) => !options.prefix || key.startsWith(options.prefix))
      .filter((key) => !options.start || key >= options.start)
      .filter((key) => !options.startAfter || key > options.startAfter)
      .filter((key) => !options.end || key < options.end)
      .sort();
    if (options.reverse) keys.reverse();
    const limited = keys.slice(0, options.limit ?? 128);
    const page = new Map();
    for (const key of limited) page.set(key, snapshot(source.get(key)));
    return Promise.resolve(page);
  }

  return {
    get: async (key) => snapshot(map.get(key)),
    put: async (key, value) => {
      map.set(key, snapshot(value));
    },
    delete: async (key) => map.delete(key),
    list: async (options = {}) => listMap(map, options),
    transaction: async (fn) => fn(txn(map)),
    transactionSync: (fn) => fn(txn(map)),
    setAlarm: async (when) => {
      alarm = when;
    },
    getAlarm: async () => alarm,
    deleteAlarm: async () => {
      alarm = null;
    },
  };
}

// ── Map-backed KvNamespace (stands in for the FAILOVER_KV binding) ──────────

function makeKv() {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    put: async (key, value) => {
      map.set(key, value);
    },
    delete: async (key) => {
      map.delete(key);
    },
    list: async (options = {}) => ({
      keys: [...map.keys()]
        .filter((key) => !options.prefix || key.startsWith(options.prefix))
        .map((name) => ({ name })),
      list_complete: true,
    }),
    map,
  };
}

// ── MOCK TELNYX binding: records every call-control / messaging action ──────

function makeTelnyxMock() {
  const mock = {
    dials: [],
    speaks: [],
    gathers: [],
    answers: [],
    hangups: [],
    sent: [],
    calls: {
      async dial(params) {
        mock.dials.push(params);
        const n = mock.dials.length;
        return { data: { call_control_id: `cc-${n}`, call_leg_id: `leg-${n}`, call_session_id: `sess-${n}`, status: "queued" } };
      },
      actions: {
        async speak(callControlId, body) {
          mock.speaks.push({ callControlId, ...body });
          return { data: { status: "ok" } };
        },
        async gather(callControlId, body) {
          mock.gathers.push({ callControlId, ...body });
        },
        async answer(callControlId, body) {
          mock.answers.push({ callControlId, ...body });
        },
        async gatherUsingSpeak(callControlId, body) {
          mock.gathers.push({ callControlId, ...body });
          return { data: { status: "ok" } };
        },
        async hangup(callControlId, body) {
          mock.hangups.push({ callControlId, ...body });
          return { data: { status: "ok" } };
        },
      },
    },
    messages: {
      async send(message) {
        mock.sent.push(message);
        return { data: { id: `msg-${mock.sent.length}` } };
      },
    },
  };
  return mock;
}

// ── In-process actor namespace: real FailoverAgent instances ────────────────

function makeActorNamespace(agentEnv) {
  const instances = new Map();
  return {
    idFromName(name) {
      let instance = instances.get(name);
      if (!instance) {
        const ctx = { id: name, storage: makeStorage(), blockConcurrencyWhile: (fn) => fn(), actorType: "FailoverAgent" };
        instance = new FailoverAgent(ctx, agentEnv);
        instances.set(name, instance);
      }
      const agent = instance;
      return new Proxy({ id: name }, {
        get(_target, prop) {
          const value = agent[prop];
          return typeof value === "function" ? value.bind(agent) : value;
        },
      });
    },
    agents: instances,
  };
}

// ── Env construction ────────────────────────────────────────────────────────

function makeRuntime({ demoMode, cooldownSeconds = "300" }) {
  const kv = makeKv();
  const telnyxMock = makeTelnyxMock();
  const agentEnv = {
    TELNYX: telnyxMock,
    FAILOVER_KV: kv,
    DEMO_MODE: demoMode ? "true" : "false",
    TELNYX_PRIMARY_CONNECTION_ID: PRIMARY_ID,
    TELNYX_BACKUP_CONNECTION_ID: BACKUP_ID,
    TELNYX_FROM_NUMBER: FROM_NUMBER,
    SMS_FROM_NUMBER,
    TELNYX_OPS_ALERT_NUMBER: OPS_ALERT_NUMBER,
    FAILURE_THRESHOLD: "3",
    COOLDOWN_SECONDS: cooldownSeconds,
    TTS_VOICE,
  };
  const workerEnv = {
    FAILOVER_AGENT: makeActorNamespace(agentEnv),
    TELNYX: telnyxMock,
    FAILOVER_KV: kv,
    DEMO_MODE: demoMode ? "true" : "false",
    TELNYX_PRIMARY_CONNECTION_ID: PRIMARY_ID,
    TELNYX_BACKUP_CONNECTION_ID: BACKUP_ID,
    TELNYX_FROM_NUMBER: FROM_NUMBER,
    FAILURE_THRESHOLD: "3",
    COOLDOWN_SECONDS: cooldownSeconds,
    DIAL_TIMEOUT_SECS: "30",
  };
  return { workerEnv, agentEnv, telnyxMock, kv };
}

// ── HTTP harness around the real worker fetch handler ──────────────────────

function startServer(env) {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const request = new Request(`http://localhost${req.url}`, {
          method: req.method,
          headers: req.headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
        });
        const response = await worker.fetch(request, env);
        res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
        res.end(await response.text());
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error?.message ?? String(error) }));
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function call(port, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(json)}`);
  return json;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function webhook(port, eventType, payload) {
  return call(port, "POST", "/webhooks/call-control", { data: { event_type: eventType, payload } });
}

// ── Phase A: demo mode — breaker semantics + full call flow ───────────────

const phaseA = makeRuntime({ demoMode: true });
const { server: serverA, port: portA } = await startServer(phaseA.workerEnv);

try {
  const health = await call(portA, "GET", "/health");
  assert(health.status === "healthy" && health.demo_mode === true, `health unexpected: ${JSON.stringify(health)}`);
  console.log("ok  /health → healthy, demo_mode=true");

  const route1 = await call(portA, "POST", "/api/route", { to: "+15551234567" });
  assert(route1.demo === true && route1.connection_id === PRIMARY_ID, `closed breaker should route primary: ${JSON.stringify(route1)}`);
  assert(route1.circuit_state.failures === 0 && route1.circuit_state.tripped === false, `unexpected circuit_state: ${JSON.stringify(route1.circuit_state)}`);
  assert(route1.message === "Demo mode: no real call placed.", `unexpected demo message: ${route1.message}`);
  assert(phaseA.telnyxMock.dials.length === 0, "demo mode must not dial");
  console.log("ok  /api/route (closed) → primary, demo response, no dial");

  let state = await call(portA, "GET", "/api/circuit-state");
  assert(state.status === "closed" && state.failures === 0, `unexpected state: ${JSON.stringify(state)}`);
  console.log("ok  /api/circuit-state → closed");

  // Non-primary failure: must NOT count toward the breaker.
  await webhook(portA, "call.state_changed", { state: "failed", connection_id: BACKUP_ID, call_control_id: "cc-x" });
  state = await call(portA, "GET", "/api/circuit-state");
  assert(state.failures === 0, `non-primary failure counted: ${JSON.stringify(state)}`);
  console.log("ok  failure on backup connection ignored");

  // Three primary failures trip the breaker (state_changed path).
  await webhook(portA, "call.state_changed", { state: "failed", connection_id: PRIMARY_ID, call_control_id: "cc-1" });
  state = await call(portA, "GET", "/api/circuit-state");
  assert(state.failures === 1 && state.status === "closed", `failure 1 unexpected: ${JSON.stringify(state)}`);
  await webhook(portA, "call.state_changed", { state: "busy", connection_id: PRIMARY_ID, call_control_id: "cc-2" });
  state = await call(portA, "GET", "/api/circuit-state");
  assert(state.failures === 2 && state.status === "closed", `failure 2 unexpected: ${JSON.stringify(state)}`);
  await webhook(portA, "call.state_changed", { state: "no_answer", connection_id: PRIMARY_ID, call_control_id: "cc-3" });
  state = await call(portA, "GET", "/api/circuit-state");
  assert(state.failures === 3 && state.status === "open", `breaker should be open at threshold: ${JSON.stringify(state)}`);
  console.log("ok  3 primary failures → breaker open");

  // Demo ops SMS is suppressed (logged via agent events, not sent).
  assert(phaseA.telnyxMock.sent.length === 0, "demo mode must not send the ops SMS");

  const route2 = await call(portA, "POST", "/api/route", { to: "+15551234567" });
  assert(route2.connection_id === BACKUP_ID, `open breaker should route backup: ${JSON.stringify(route2)}`);
  console.log("ok  /api/route (open) → backup connection");

  const reset = await call(portA, "POST", "/api/circuit-reset");
  assert(reset.status === "reset" && reset.circuit_state.failures === 0 && reset.circuit_state.tripped === false, `reset unexpected: ${JSON.stringify(reset)}`);
  console.log("ok  /api/circuit-reset → closed");

  const route3 = await call(portA, "POST", "/api/route", { to: "+15551234567" });
  assert(route3.connection_id === PRIMARY_ID, `reset breaker should route primary: ${JSON.stringify(route3)}`);
  console.log("ok  /api/route (reset) → primary again");

  // Half-open: with cooldown 0, a tripped breaker probes primary again.
  phaseA.workerEnv.COOLDOWN_SECONDS = "0";
  for (const callState of ["failed", "busy", "no_answer"]) {
    await webhook(portA, "call.state_changed", { state: callState, connection_id: PRIMARY_ID, call_control_id: `cc-${callState}` });
  }
  state = await call(portA, "GET", "/api/circuit-state");
  assert(state.status === "half-open", `expected half-open after cooldown: ${JSON.stringify(state)}`);
  const route4 = await call(portA, "POST", "/api/route", { to: "+15551234567" });
  assert(route4.connection_id === PRIMARY_ID, `half-open should probe primary: ${JSON.stringify(route4)}`);
  console.log("ok  cooldown expired → half-open → primary probe");

  // ── Call flow: announce → gather → resolve → hangup ─────────────────────
  await webhook(portA, "call.answered", { call_control_id: "call-flow-1", connection_id: PRIMARY_ID });
  const announce = phaseA.telnyxMock.gathers.at(-1);
  assert(announce && announce.callControlId === "call-flow-1", `announce gather_using_speak missing: ${JSON.stringify(phaseA.telnyxMock.gathers)}`);
  assert(announce.valid_digits === "12" && announce.maximum_digits === 1 && announce.terminating_digit === "", `gather_using_speak digit params unexpected: ${JSON.stringify(announce)}`);
  assert(announce.payload.includes("Meridian Trust Bank's automated fraud alert service"), `fraud alert text missing: ${announce.payload}`);
  assert(!announce.payload.includes("<emotion"), `announcement must be plain text (no SSML tags): ${announce.payload}`);
  assert(!announce.payload.includes("backup systems"), `primary leg must not carry the backup intro: ${announce.payload}`);
  console.log("ok  call.answered → gather_using_speak speaks the fraud alert + collects 1/2");

  // Webhook redelivery must NOT re-announce (idempotency guard).
  await webhook(portA, "call.answered", { call_control_id: "call-flow-1", connection_id: PRIMARY_ID });
  assert(phaseA.telnyxMock.gathers.filter((g) => g.callControlId === "call-flow-1").length === 1, "redelivered call.answered must not double-announce");
  console.log("ok  redelivered call.answered → skipped (idempotent)");

  await webhook(portA, "call.gather.ended", { call_control_id: "call-flow-1", digits: "2" });
  const resolution = phaseA.telnyxMock.speaks.at(-1);
  assert(resolution && resolution.payload.includes("We've blocked that purchase and frozen your card"), `blocked speech missing: ${resolution?.payload}`);
  assert(!resolution.payload.includes("<emotion"), `confirmation must be plain text: ${resolution?.payload}`);
  assert(phaseA.telnyxMock.sent.length === 0, "demo mode must not send the customer SMS");
  assert(phaseA.kv.map.get("stage/call-flow-1") === "confirming", `stage should be confirming: ${phaseA.kv.map.get("stage/call-flow-1")}`);
  console.log("ok  call.gather.ended '2' → card-frozen speech (plain), SMS suppressed in demo");

  // Redelivered gather.ended must not double-resolve.
  await webhook(portA, "call.gather.ended", { call_control_id: "call-flow-1", digits: "2" });
  assert(phaseA.telnyxMock.speaks.filter((s) => s.callControlId === "call-flow-1").length === 1, "redelivered gather.ended must not double-resolve");
  console.log("ok  redelivered call.gather.ended → skipped (idempotent)");

  await webhook(portA, "call.speak.ended", { call_control_id: "call-flow-1" });
  const hangup = phaseA.telnyxMock.hangups.at(-1);
  assert(hangup && hangup.callControlId === "call-flow-1", `hangup missing: ${JSON.stringify(phaseA.telnyxMock.hangups)}`);
  console.log("ok  call.speak.ended (confirming) → hung up");

  // Backup-leg announcement carries the backup intro.
  await phaseA.kv.put("call/call-flow-2", JSON.stringify({ connection_id: BACKUP_ID, to: "+15551234567" }));
  await webhook(portA, "call.answered", { call_control_id: "call-flow-2", connection_id: BACKUP_ID });
  const backupAnnounce = phaseA.telnyxMock.gathers.at(-1);
  assert(backupAnnounce.payload.includes("we're running on our backup systems right now"), `backup intro missing: ${backupAnnounce.payload}`);
  console.log("ok  call.answered on backup leg → backup intro in the announcement");

  // ── Inbound fraud line: the caller dials the toll-free themselves ────────
  await webhook(portA, "call.initiated", {
    call_control_id: "call-flow-3",
    direction: "incoming",
    from: "+15551234567",
    to: "+18337483087",
  });
  assert(phaseA.telnyxMock.answers.some((a) => a.callControlId === "call-flow-3"), `inbound call not answered: ${JSON.stringify(phaseA.telnyxMock.answers)}`);
  assert(phaseA.kv.map.get("call/call-flow-3") === JSON.stringify({ connection_id: PRIMARY_ID, to: "+15551234567" }), `inbound call map missing: ${phaseA.kv.map.get("call/call-flow-3")}`);
  console.log("ok  inbound call.initiated → answered + caller mapped for the SMS receipt");

  await webhook(portA, "call.answered", { call_control_id: "call-flow-3", connection_id: PRIMARY_ID });
  const inboundAnnounce = phaseA.telnyxMock.gathers.at(-1);
  assert(inboundAnnounce && inboundAnnounce.callControlId === "call-flow-3", `inbound announce missing`);
  assert(inboundAnnounce.payload.includes("Meridian Trust Bank's automated fraud alert service"), `inbound announce text missing`);
  assert(!inboundAnnounce.payload.includes("backup systems"), "inbound announce must not carry the backup intro");
  console.log("ok  inbound call.answered → fraud alert announced to the caller");

  await webhook(portA, "call.gather.ended", { call_control_id: "call-flow-3", digits: "1" });
  const inboundConfirm = phaseA.telnyxMock.speaks.at(-1);
  assert(inboundConfirm && inboundConfirm.payload.includes("Thank you for confirming"), `inbound confirmation missing`);
  console.log("ok  inbound caller pressed 1 → confirmation speech (SMS goes to the caller)");

  // ── Dashboard + live events feed ─────────────────────────────────────────
  const dashResponse = await fetch(`http://127.0.0.1:${portA}/`);
  assert(dashResponse.headers.get("content-type")?.includes("text/html") === true, "GET / must serve HTML");
  const dashHtml = await dashResponse.text();
  assert(dashHtml.includes("Auto-Failover Voice Routing"), "dashboard title missing");
  const events = await call(portA, "GET", "/api/events?limit=100");
  assert(Array.isArray(events.events) && events.events.length > 0, "events feed empty");
  const kinds = new Set(events.events.map((event) => event.kind));
  for (const kind of [
    "route_decision",
    "webhook",
    "failure_counted",
    "breaker_tripped",
    "caller_response",
    "sms_sent",
    "breaker_reset",
    "call_answered",
  ]) {
    assert(kinds.has(kind), `events feed missing kind: ${kind}`);
  }
  console.log("ok  GET / serves the dashboard; /api/events covers every demo beat");
} finally {
  serverA.close();
}

// ── Phase B: live mode with SKIP_WEBHOOK_VERIFY=1 — dial, hangup trip, ops SMS ──

const phaseB = makeRuntime({ demoMode: false });
const { server: serverB, port: portB } = await startServer(phaseB.workerEnv);

try {
  const health = await call(portB, "GET", "/health");
  assert(health.status === "healthy" && health.demo_mode === false, `health unexpected: ${JSON.stringify(health)}`);

  const route1 = await call(portB, "POST", "/api/route", { to: "+15551234567" });
  assert(route1.call_id === "cc-1" && route1.connection_id === PRIMARY_ID, `live route unexpected: ${JSON.stringify(route1)}`);
  const dial = phaseB.telnyxMock.dials[0];
  assert(dial.connection_id === PRIMARY_ID && dial.from === FROM_NUMBER && dial.to === "+15551234567", `dial params unexpected: ${JSON.stringify(dial)}`);
  assert(phaseB.kv.map.get("call/cc-1") === JSON.stringify({ connection_id: PRIMARY_ID, to: "+15551234567" }), `call map not recorded: ${phaseB.kv.map.get("call/cc-1")}`);
  console.log("ok  /api/route (live) → dial recorded + call map in KV");

  // Unknown call hangs up on primary with TIMEOUT: not in the map → not counted.
  await webhook(portB, "call.hangup", { call_control_id: "cc-unknown", hangup_cause: "timeout", connection_id: PRIMARY_ID });
  let state = await call(portB, "GET", "/api/circuit-state");
  assert(state.failures === 0, `unknown call counted toward breaker: ${JSON.stringify(state)}`);
  console.log("ok  hangup on unmapped call ignored");

  // Known call hangs up with a lowercase cause (normalized to upper): counts.
  await webhook(portB, "call.hangup", { call_control_id: "cc-1", hangup_cause: "timeout", connection_id: PRIMARY_ID });
  state = await call(portB, "GET", "/api/circuit-state");
  assert(state.failures === 1 && state.status === "closed", `hangup failure 1 unexpected: ${JSON.stringify(state)}`);
  await webhook(portB, "call.hangup", { call_control_id: "cc-1", hangup_cause: "USER_BUSY", connection_id: PRIMARY_ID });
  state = await call(portB, "GET", "/api/circuit-state");
  assert(state.failures === 2, `hangup failure 2 unexpected: ${JSON.stringify(state)}`);
  // Normal hangup cause does not count.
  await webhook(portB, "call.hangup", { call_control_id: "cc-1", hangup_cause: "NORMAL_CLEARING", connection_id: PRIMARY_ID });
  state = await call(portB, "GET", "/api/circuit-state");
  assert(state.failures === 2, `normal clearing counted: ${JSON.stringify(state)}`);
  // Third failure trips the breaker and pages ops over SMS.
  await webhook(portB, "call.hangup", { call_control_id: "cc-1", hangup_cause: "no_route_destination", connection_id: PRIMARY_ID });
  state = await call(portB, "GET", "/api/circuit-state");
  assert(state.failures === 3 && state.status === "open", `breaker should trip: ${JSON.stringify(state)}`);
  const opsSms = phaseB.telnyxMock.sent.at(-1);
  assert(opsSms && opsSms.from === SMS_FROM_NUMBER && opsSms.to === OPS_ALERT_NUMBER, `ops SMS addressing unexpected: ${JSON.stringify(opsSms)}`);
  assert(opsSms.text.includes("Circuit breaker TRIPPED for primary SIP connection. Failures: 3."), `ops SMS text unexpected: ${opsSms.text}`);
  assert(opsSms.text.includes(`Auto-failover to backup connection ${BACKUP_ID}.`), `ops SMS backup line unexpected: ${opsSms.text}`);
  console.log("ok  hangup TIMEOUT/BUSY/NO_ROUTE ×3 → breaker open + ops SMS sent");

  const route2 = await call(portB, "POST", "/api/route", { to: "+15551234567" });
  assert(route2.connection_id === BACKUP_ID && route2.call_id === "cc-2", `open breaker should dial backup: ${JSON.stringify(route2)}`);
  console.log("ok  /api/route (open) → backup dialed");

  const reset = await call(portB, "POST", "/api/circuit-reset");
  assert(reset.status === "reset" && reset.circuit_state.failures === 0, `reset unexpected: ${JSON.stringify(reset)}`);

  const route3 = await call(portB, "POST", "/api/route", { to: "+15551234567" });
  assert(route3.connection_id === PRIMARY_ID, `reset breaker should dial primary: ${JSON.stringify(route3)}`);
  console.log("ok  circuit-reset → primary dialed again");

  // Missing 'to' → 400.
  let rejected = false;
  try {
    await call(portB, "POST", "/api/route", {});
  } catch (error) {
    rejected = String(error).includes("400");
  }
  assert(rejected, "missing 'to' should return 400");
  console.log("ok  /api/route without 'to' → 400");
} finally {
  serverB.close();
}

console.log("Smoke test passed for auto-failover-voice-routing");
