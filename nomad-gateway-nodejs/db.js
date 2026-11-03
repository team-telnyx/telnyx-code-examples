// Storage with the D1-style API (prepare -> bind -> all/first/run, batch), on:
//   - "sqldb-api": a Telnyx Edge SQL database over the REST API, when SQLDB_ID
//     is set (no binding, so the function deploys to every Edge site);
//   - "sqlite": a local node:sqlite file.
import fs from "node:fs";
import path from "node:path";

import { onEdge, setting } from "./settings.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS queries (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'sms',
  question        TEXT NOT NULL,
  answer          TEXT,
  source          TEXT DEFAULT 'telnyx-ai',
  inference_mode  TEXT DEFAULT 'online',
  latency_ms      INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queries_phone ON queries (phone);
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'sms',
  timestamp       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_phone ON conversations (phone);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  embedding       TEXT,
  source          TEXT DEFAULT 'kiwix',
  created_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_status (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  internet_up     INTEGER DEFAULT 1,
  kiwix_up        INTEGER DEFAULT 0,
  ollama_up       INTEGER DEFAULT 0,
  maps_up         INTEGER DEFAULT 0,
  iot_sim_status  TEXT DEFAULT 'unknown',
  updated_at      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ui_events (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  payload         TEXT NOT NULL,
  created_at      TEXT NOT NULL
)`;

const statements = (sql) => sql.split(";").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Local engine — node:sqlite (DatabaseSync)
// ---------------------------------------------------------------------------
class LocalStatement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new LocalStatement(this.db, this.sql, params); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params), meta: {} }; }
  async first(col) {
    const row = this.db.prepare(this.sql).get(...this.params) ?? null;
    return col ? (row?.[col] ?? null) : row;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { results: [], meta: { changes: Number(r.changes) } };
  }
}

class LocalDb {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) { return new LocalStatement(this.sqlite, sql); }
  async batch(stmts) {
    this.sqlite.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.sqlite.exec("COMMIT");
      return out;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Edge engine — Telnyx Edge SQL database over REST API
// ---------------------------------------------------------------------------
const SQLDB_API = () => process.env.SQLDB_API_BASE || "https://api.telnyx.com/v2";

class RestStatement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new RestStatement(this.db, this.sql, params); }
  async all() {
    const r = await this.db.query(this.sql, this.params);
    return { results: r.results ?? [], meta: r.meta ?? {} };
  }
  async first(col) {
    const row = (await this.all()).results[0] ?? null;
    return col ? (row?.[col] ?? null) : row;
  }
  async run() {
    const { meta } = await this.all();
    return { results: [], meta };
  }
}

class RestDb {
  constructor(id, apiKey) { this.id = id; this.apiKey = apiKey; }
  prepare(sql) { return new RestStatement(this, sql); }
  async query(sql, params) {
    const res = await fetch(`${SQLDB_API()}/storage/sqldbs/${encodeURIComponent(this.id)}/actions/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(params.length ? { sql, params } : { sql }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = body.errors?.[0] || {};
      throw new Error(`SQL database ${res.status}: ${e.detail || e.title || "query failed"}`);
    }
    return Array.isArray(body.data) ? body.data[0] ?? {} : body.data ?? {};
  }
  async batch(stmts) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
}

// ---------------------------------------------------------------------------
// Open the database (local or Edge) and run schema migrations
// ---------------------------------------------------------------------------
async function openLocal(file) {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  return new LocalDb(sqlite);
}

export async function openDb(dataDir) {
  let db, engine;
  if (setting("SQLDB_ID")) {
    db = new RestDb(setting("SQLDB_ID"), setting("TELNYX_API_KEY"));
    engine = "sqldb-api";
  } else if (onEdge()) {
    throw new Error("NOMAD_SQLDB_ID is not set");
  } else {
    db = await openLocal(path.join(dataDir, "nomad.db"));
    engine = "sqlite";
  }
  for (const sql of statements(SCHEMA)) await db.prepare(sql).run();

  // Seed singleton system_status row if missing (INSERT OR IGNORE handles
  // the race when multiple Edge instances start simultaneously)
  await db.prepare(
    "INSERT OR IGNORE INTO system_status (id, internet_up, kiwix_up, ollama_up, maps_up, iot_sim_status, updated_at) VALUES (1,1,0,0,0,'unknown',?)"
  ).bind(new Date().toISOString()).run();

  return { db, engine };
}
