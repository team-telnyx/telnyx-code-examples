// Storage with the D1-style API (prepare -> bind -> all/first/run, batch), on:
//   - "sqldb-api": a Telnyx Edge SQL database over the REST API, when SQLDB_ID
//     is set (no binding, so the function deploys to every Edge site);
//   - "sqlite": a local node:sqlite file.
import fs from "node:fs";
import path from "node:path";

import { onEdge, setting } from "./settings.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  emoji       TEXT DEFAULT '',
  sort_order  INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  category_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  price         REAL NOT NULL,
  unit          TEXT DEFAULT 'each',
  image_url     TEXT DEFAULT '',
  in_stock      INTEGER DEFAULT 1,
  on_sale       INTEGER DEFAULT 0,
  sale_price    REAL DEFAULT 0,
  dietary_tags  TEXT DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prod_cat ON products (category_id);
CREATE TABLE IF NOT EXISTS customers (
  phone       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cart_items (
  id              TEXT PRIMARY KEY,
  customer_phone  TEXT NOT NULL,
  product_id      TEXT NOT NULL,
  product_name    TEXT NOT NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      REAL NOT NULL,
  added_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cart_phone ON cart_items (customer_phone);
CREATE TABLE IF NOT EXISTS delivery_slots (
  id          TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  date        TEXT NOT NULL,
  time_start  TEXT NOT NULL,
  time_end    TEXT NOT NULL,
  capacity    INTEGER DEFAULT 5,
  booked      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_slot_date ON delivery_slots (date);
CREATE TABLE IF NOT EXISTS orders (
  id              TEXT PRIMARY KEY,
  customer_phone  TEXT NOT NULL,
  customer_name   TEXT DEFAULT '',
  slot_id         TEXT,
  slot_label      TEXT DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'confirmed',
  subtotal        REAL DEFAULT 0,
  item_count      INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_phone ON orders (customer_phone);
CREATE INDEX IF NOT EXISTS idx_order_status ON orders (status);
CREATE TABLE IF NOT EXISTS order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  unit_price  REAL NOT NULL,
  subtotal    REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oi_order ON order_items (order_id);
CREATE TABLE IF NOT EXISTS substitutions (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL,
  original_item     TEXT NOT NULL,
  original_product_id TEXT DEFAULT '',
  suggested_item    TEXT NOT NULL,
  suggested_product_id TEXT DEFAULT '',
  price_diff        REAL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TEXT NOT NULL,
  resolved_at       TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sub_order ON substitutions (order_id);
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  customer_phone  TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  timestamp       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_phone ON conversations (customer_phone);
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
    throw new Error("FRESHCART_SQLDB_ID is not set");
  } else {
    db = await openLocal(path.join(dataDir, "freshcart.db"));
    engine = "sqlite";
  }
  for (const sql of statements(SCHEMA)) await db.prepare(sql).run();
  return { db, engine };
}
