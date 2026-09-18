// Smoke test for multi-agent-debate.
//
// Builds a tiny in-process actor host (Node Map storage standing in for the
// Edge actor storage, including a minimal embedded-SQL shim for the votes
// ledger) plus an HTTP server around the compiled worker, then exercises the
// full demo-mode debate flow end to end:
//
//   1. GET  /health
//   2. POST /debate            — start a debate (demo mode: canned arguments)
//   3. POST /debate/{id}/vote  — audience votes, incl. same-voter vote switch
//   4. GET  /debate/{id}       — transcript + live tally
//   5. POST /debate/{id}/end   — finalize, winner declared
//   6. POST /debate/{id}/vote  — refused after the debate ended
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
const { DebateRoom } = await import(join(scriptDir, "..", "dist", "src", "debateRoom.js"));
const { DebateAgent } = await import(join(scriptDir, "..", "dist", "src", "debateAgent.js"));

// ── In-memory actor storage (mirrors the ActorStorage surface the SDK uses) ──
// KV/state rides a Node Map; embedded SQL rides a real in-memory SQLite DB
// (node:sqlite), so both the SDK's internal SQL backing and the sample's own
// votes ledger behave exactly as they do on the edge runtime.

import { DatabaseSync } from "node:sqlite";

function makeStorage() {
  const map = new Map();
  const db = new DatabaseSync(":memory:");
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

  function execSql(query, ...bindings) {
    if (bindings.length === 0 && /;\s*\S/.test(query)) {
      db.exec(query);
      return { toArray: () => [], [Symbol.iterator]: function* () {} };
    }
    const statement = db.prepare(query);
    const isRead = /^\s*(SELECT|WITH|PRAGMA)/i.test(query);
    const rows = isRead ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { toArray: () => rows, [Symbol.iterator]: function* () { yield* rows; } };
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
    sql: { exec: execSql },
  };
}

// ── In-process actor namespaces: real agent instances, direct dispatch ──────

function makeActorNamespace(agentEnv, AgentClass, actorType) {
  const instances = new Map();
  return {
    idFromName(name) {
      let instance = instances.get(name);
      if (!instance) {
        const ctx = { id: name, storage: makeStorage(), blockConcurrencyWhile: (fn) => fn(), actorType };
        instance = new AgentClass(ctx, agentEnv);
        instances.set(name, instance);
      }
      return new Proxy({ id: name }, {
        get(_target, prop) {
          const value = instance[prop];
          return typeof value === "function" ? value.bind(instance) : value;
        },
      });
    },
  };
}

// ── Demo-mode env: debate agents run on canned arguments, no inference ──────

function makeEnv() {
  const demoInference = {
    ai: {
      openai: {
        chat: {
          async createCompletion({ messages }) {
            const userMessage = messages[messages.length - 1]?.content ?? "";
            return { choices: [{ message: { content: `Demo inference reply for: ${userMessage.slice(0, 60)}` } }] };
          },
        },
      },
    },
  };
  const debaterNs = makeActorNamespace({ TELNYX: demoInference }, DebateAgent, "DebateAgent");
  return {
    DEBATE_ROOM: makeActorNamespace({ DEBATER: debaterNs }, DebateRoom, "DebateRoom"),
    DEBATER: debaterNs,
  };
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
  return { ok: response.ok, status: response.status, body: json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ── Scenario ───────────────────────────────────────────────────────────────

const workerEnv = makeEnv();
const { server, port } = await startServer(workerEnv);
const topic = `Smoke debate ${Date.now()}`;
const requestedDebateId = `smoke-${Date.now()}`;

try {
  const health = await call(port, "GET", "/health");
  assert(health.body.status === "ok", `health check unexpected: ${JSON.stringify(health.body)}`);
  console.log("ok  GET  /health");

  const started = await call(port, "POST", "/debate", { topic, debateId: requestedDebateId });
  assert(started.ok, `POST /debate failed: ${JSON.stringify(started.body)}`);
  assert(started.body.debateId, "start did not return a debateId");
  assert(started.body.debateId === requestedDebateId, `expected caller-supplied debateId "${requestedDebateId}", got "${started.body.debateId}"`);
  assert(started.body.status === "voting", `expected phase "voting", got "${started.body.status}"`);
  const debateId = started.body.debateId;
  console.log(`ok  POST /debate  → ${debateId} (voting)`);

  const snapshot = await call(port, "GET", `/debate/${debateId}`);
  assert(snapshot.ok, `GET /debate/{id} failed: ${JSON.stringify(snapshot.body)}`);
  assert(snapshot.body.topic === topic, "snapshot topic mismatch");
  assert(Array.isArray(snapshot.body.args) && snapshot.body.args.length === 2, `expected 2 arguments, got ${snapshot.body.args?.length}`);
  console.log("ok  GET  /debate/{id}  → 2 opening arguments present");

  await call(port, "POST", `/debate/${debateId}/vote`, { voterId: "smoke-pro", choice: "pro" });
  await call(port, "POST", `/debate/${debateId}/vote`, { voterId: "smoke-con", choice: "con" });
  const switched = await call(port, "POST", `/debate/${debateId}/vote`, { voterId: "smoke-pro", choice: "con" });
  assert(switched.ok, `vote switch failed: ${JSON.stringify(switched.body)}`);
  const afterVotes = await call(port, "GET", `/debate/${debateId}`);
  assert(afterVotes.body.tally?.pro === 0 && afterVotes.body.tally?.con === 2, `tally unexpected: ${JSON.stringify(afterVotes.body.tally)} (vote switch should dedupe)`);
  console.log("ok  POST /debate/{id}/vote  → same-voter switch deduped, tally pro=0 con=2");

  const result = await call(port, "POST", `/debate/${debateId}/end`);
  assert(result.ok, `end failed: ${JSON.stringify(result.body)}`);
  assert(result.body.winner === "con", `expected winner "con", got "${result.body.winner}"`);
  assert(result.body.finalVotes?.pro === 0 && result.body.finalVotes?.con === 2, `finalVotes unexpected: ${JSON.stringify(result.body.finalVotes)}`);
  assert(result.body.totalArguments === 2, `expected 2 totalArguments, got ${result.body.totalArguments}`);
  console.log("ok  POST /debate/{id}/end  → winner con");

  const lateVote = await call(port, "POST", `/debate/${debateId}/vote`, { voterId: "smoke-late", choice: "pro" });
  assert(!lateVote.ok, "voting should be refused after the debate ended");
  console.log("ok  POST /debate/{id}/vote after end  → refused");

  console.log("\nSmoke test passed for multi-agent-debate");
} finally {
  server.close();
}
