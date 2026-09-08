// Smoke test for sim-agent.
//
// Builds a tiny in-process actor host (Node Map storage standing in for the
// Edge actor storage) plus an HTTP server around the compiled worker, then
// exercises the real fetch handler with demo-mode requests end to end:
//
//   1. GET  /health
//   2. POST /api/demo      — usage past 80%, proactive alert, plan Q&A, upgrade
//   3. GET  /api/sim       — snapshot consistency
//   4. POST /webhooks/usage — Telnyx-shaped usage webhook ingest
//   5. POST /webhooks/sms  — message.received → usage summary reply
//   6. POST /webhooks/call — call.initiated answered (demo, no REST calls)
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
const { SIMAgent } = await import(join(scriptDir, "..", "dist", "src", "simAgent.js"));

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

// ── In-process actor namespace: real SIMAgent instances, direct dispatch ────

function makeActorNamespace(agentEnv) {
  const instances = new Map();
  return {
    idFromName(name) {
      let instance = instances.get(name);
      if (!instance) {
        const ctx = { id: name, storage: makeStorage(), blockConcurrencyWhile: (fn) => fn(), actorType: "SIMAgent" };
        instance = new SIMAgent(ctx, agentEnv);
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

// ── Demo-mode env: [telnyx] binding and env_vars, no external calls ────────

function makeEnv() {
  const simBinding = {
    messages: {
      async send(message) {
        simBinding.sent.push(message);
        return { data: { id: `demo-${simBinding.sent.length}` } };
      },
    },
    sent: [],
  };
  simBinding.ai = {
    openai: {
      chat: {
        async createCompletion({ messages }) {
          const userMessage = messages[messages.length - 1]?.content ?? "";
          return { choices: [{ message: { content: `Demo inference reply for: ${userMessage.slice(0, 60)}` } }] };
        },
      },
    },
  };
  simBinding.simCards = {
    async update(simId, params) {
      simBinding.simUpdates.push({ simId, params });
      return { data: { sim_card_id: simId } };
    },
  };
  simBinding.simUpdates = [];

  const agentEnv = {
    TELNYX: simBinding,
    TELNYX_SMS_FROM_NUMBER: "+15557654321",
    DEMO_MODE: "true",
    USAGE_CHECK_SECONDS: "3600",
    BILLING_CYCLE_SECONDS: "2592000",
  };
  const workerEnv = {
    SIM_AGENT: makeActorNamespace(agentEnv),
    TELNYX_API_KEY: "demo-key-unused",
    DEMO_MODE: "true",
  };
  return { workerEnv, agentEnv };
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

// ── Scenario ───────────────────────────────────────────────────────────────

const { workerEnv, agentEnv } = makeEnv();
const { server, port } = await startServer(workerEnv);
const simId = `sim-smoke-${Date.now()}`;
const customer = "+15551234567";

try {
  const health = await call(port, "GET", "/health");
  assert(health.ok === true && health.demo === true, `health check unexpected: ${JSON.stringify(health)}`);

  const demo = await call(port, "POST", "/api/demo", { simId, phoneNumber: customer });
  assert(demo.status === "complete", `demo flow did not complete: ${JSON.stringify(demo)}`);
  assert(demo.initializedPlan === "1GB Starter", `unexpected initial plan: ${demo.initializedPlan}`);

  const state = demo.snapshot.state;
  assert(state.usageMB === 900, `expected 900MB usage after demo feed, got ${state.usageMB}`);
  assert(state.alerts[0].sent === false, "alert was not reset after the plan upgrade");
  assert(state.plan.name === "10GB" && state.plan.dataLimitMB === 10240, `upgrade did not apply: ${JSON.stringify(state.plan)}`);
  assert(state.history.some((event) => event.event === "demo_feed"), "usage history missing demo feed events");
  assert(state.history.some((event) => event.event === "upgrade_to_10gb"), "upgrade event missing from history");
  assert(demo.snapshot.schedules.some((task) => task.id === "usage-check"), "usage-check schedule missing");
  assert(demo.snapshot.schedules.some((task) => task.id === "billing-cycle"), "billing-cycle schedule missing");

  const agent = workerEnv.SIM_AGENT.agents.get(`sim-${simId}`);
  const messages = await agent.messages.all();
  assert(messages.some((m) => m.content.includes("% of your data")), "threshold alert SMS missing from conversation log");
  assert(messages.some((m) => m.content.includes("Upgrade to 10GB complete")), "upgrade confirmation SMS missing");
  const events = await agent.events.read();
  assert(events.some((e) => e.type === "threshold.alert"), "threshold.alert event missing");
  assert(events.some((e) => e.type === "plan.upgraded"), "plan.upgraded event missing");

  const snapshot = await call(port, "GET", `/api/sim?simId=${simId}`);
  assert(snapshot.state.usageMB === 900, `snapshot usage drifted: ${snapshot.state.usageMB}`);

  const usageHook = await call(port, "POST", "/webhooks/usage", {
    data: { event_type: "wireless.usage.updated", payload: { sim_card_id: simId, usage_mb: 50 } },
  });
  assert(usageHook.status === "processed", `usage webhook rejected: ${JSON.stringify(usageHook)}`);
  const afterHook = await call(port, "GET", `/api/sim?simId=${simId}`);
  assert(afterHook.state.usageMB === 950, `webhook usage not applied: ${afterHook.state.usageMB}`);
  assert(afterHook.state.history.some((event) => event.event === "webhook"), "webhook usage not recorded in history");

  await call(port, "POST", "/webhooks/sms", {
    data: { event_type: "message.received", payload: { sim_card_id: simId, from: customer, to: "+15557654321", text: "usage" } },
  });
  const messagesAfterSms = await agent.messages.all();
  assert(
    messagesAfterSms.some((m) => m.content.includes("Usage: 950MB / 10240MB")),
    "SMS webhook did not produce an updated usage summary",
  );

  const callHook = await call(port, "POST", "/webhooks/call", {
    data: {
      event_type: "call.initiated",
      payload: { sim_card_id: simId, call_control_id: `demo-${simId}`, from: customer, to: "+15557654321" },
    },
  });
  assert(callHook.status === "answered" && callHook.demo === true, `call webhook unexpected: ${JSON.stringify(callHook)}`);
  assert(callHook.message.includes("SIM "), `call context message unexpected: ${callHook.message}`);
  assert(agentEnv.TELNYX.sent.length === 0, "demo mode must not send real SMS");

  console.log(`Smoke test passed for ${simId}`);
} finally {
  server.close();
}
