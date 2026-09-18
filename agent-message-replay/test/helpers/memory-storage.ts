/**
 * In-memory ActorStorage + ActorContext for driving the real agent classes
 * (MessageLog, EventLog, StateStore, TaskScheduler) in tests without the
 * platform runtime.
 *
 * KV values are held by reference — Dates and other codec-supported types
 * keep full fidelity. The SQL surface is REAL SQLite via Node's built-in
 * `node:sqlite` (in-memory), so the SDK's SQL log backing works with its
 * actual semantics (upserts, sqlite_master lookups, ORDER BY ... LIMIT).
 */
import { createRequire } from "node:module";

// vitest 2.x's resolver predates node:sqlite in its builtins list, so the
// static import is rewritten to a bare "sqlite" specifier and fails. Load
// the builtin through require at runtime instead.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import type {
  ActorContext,
  ActorStorage,
  ListOptions,
  SqlBindValue,
  SqlValue,
  StorageTransaction,
} from "@telnyx/edge-runtime";

class SqliteCursor<T extends Record<string, SqlValue>> {
  constructor(private readonly rows: T[]) {}
  toArray(): T[] {
    return this.rows;
  }
  [Symbol.iterator](): Iterator<T> {
    return this.rows[Symbol.iterator]();
  }
}

class SqliteStorageSurface {
  private readonly db = new DatabaseSync(":memory:");

  constructor() {
    // The platform creates the SDK's SQL log/task tables at actor activation
    // (sql-backing SCHEMA). Replicate that DDL so log reads before the first
    // write (e.g. TaskScheduler.rearm → earliestDue) see the tables.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _a_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _a_seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS _a_messages (seq INTEGER PRIMARY KEY, role TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _a_events (seq INTEGER PRIMARY KEY, type TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _a_state (id INTEGER PRIMARY KEY CHECK (id = 0), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _a_tasks (id TEXT PRIMARY KEY, due INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS _a_tasks_by_due ON _a_tasks(due, id);
    `);
  }

  exec<T extends Record<string, SqlValue> = Record<string, SqlValue>>(
    query: string,
    ...bindings: SqlBindValue[]
  ): SqliteCursor<T> {
    const stmt = this.db.prepare(query);
    const args = bindings.map((b) => (typeof b === "boolean" ? (b ? 1 : 0) : b));
    const rows = (
      args.length > 0
        ? stmt.all(...(args as Parameters<typeof stmt.all>))
        : stmt.all()
    ) as unknown as T[];
    return new SqliteCursor<T>(rows);
  }

  runTransactionSync<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export class MemoryStorage implements ActorStorage {
  readonly sql: SqliteStorageSurface;
  private data = new Map<string, unknown>();
  private alarm: number | null = null;

  constructor() {
    this.sql = new SqliteStorageSurface();
  }

  get<T = unknown>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.data.has(key) ? (this.data.get(key) as T) : undefined);
  }
  put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.data.delete(key));
  }
  list<T>(options?: ListOptions): Promise<Map<string, T>> {
    const opts = options ?? {};
    const sorted = [...this.data.entries()]
      .map(([k, v]) => [k, v] as [string, T])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out = new Map<string, T>();
    for (const [k, v] of sorted) {
      if (opts.prefix && !k.startsWith(opts.prefix)) continue;
      if (opts.start !== undefined && k < opts.start) continue;
      if (opts.startAfter !== undefined && k <= opts.startAfter) continue;
      if (opts.end !== undefined && k >= opts.end) continue;
      out.set(k, v);
      if (opts.limit !== undefined && out.size >= opts.limit) break;
    }
    if (opts.reverse) return Promise.resolve(new Map([...out].reverse()));
    return Promise.resolve(out);
  }
  deleteAll(): Promise<void> {
    this.data.clear();
    return Promise.resolve();
  }
  transaction<T>(fn: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    return fn(this.txnView());
  }
  transactionSync<T>(fn: () => T): T {
    return this.sql.runTransactionSync(fn);
  }
  setAlarm(when: number): Promise<void> {
    this.alarm = when;
    return Promise.resolve();
  }
  getAlarm(): Promise<number | null> {
    return Promise.resolve(this.alarm);
  }
  deleteAlarm(): Promise<void> {
    this.alarm = null;
    return Promise.resolve();
  }

  private txnView(): StorageTransaction {
    const staged = new Map<string, { value?: unknown; deleted: boolean }>();
    return {
      get: <T,>(key: string): Promise<T | undefined> => {
        const entry = staged.get(key);
        if (entry?.deleted) return Promise.resolve(undefined);
        if (entry) return Promise.resolve(entry.value as T);
        return this.get<T>(key);
      },
      put: (key, value) => {
        staged.set(key, { value, deleted: false });
        return Promise.resolve();
      },
      delete: (key) => {
        staged.set(key, { deleted: true });
        return Promise.resolve(this.data.has(key));
      },
      list: (options) => this.list(options),
    };
  }
}

export function makeActorContext(id: string, storage: MemoryStorage): ActorContext {
  return {
    id,
    storage,
    blockConcurrencyWhile: <T,>(fn: () => Promise<T>) => fn(),
    setAlarm: (when: number) => storage.setAlarm(when),
    count: () => 0,
    broadcast: () => 0,
    sockets: () => [],
  };
}
