/**
 * In-memory ActorStorage + ActorContext for driving the real agent classes
 * (MessageLog, EventLog, StateStore, TaskScheduler) in tests without the
 * platform runtime.
 *
 * KV values are held by reference. The SQL surface is REAL SQLite via Node's
 * built-in `node:sqlite` (in-memory), so chunk storage and the SDK's SQL log
 * backing run with their actual semantics (upserts, DISTINCT, ORDER BY).
 */
import { createRequire } from "node:module";

// vitest 2.x's resolver predates node:sqlite in its builtins list, so the
// static import is rewritten to a bare "sqlite" specifier and fails. Load
// the builtin through require at runtime instead.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import type {
  ActorContext,
  ActorNamespace,
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
    // write see the tables.
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
      args.length > 0 ? stmt.all(...(args as Parameters<typeof stmt.all>)) : stmt.all()
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
  readonly sql = new SqliteStorageSurface();
  private readonly data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.has(key) ? (this.data.get(key) as T) : undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async list<T>(options?: ListOptions): Promise<Map<string, T>> {
    const entries = [...this.data.entries()].filter(([k]) =>
      options?.prefix ? k.startsWith(options.prefix) : true,
    ) as [string, T][];
    return new Map(entries);
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
  async transaction<T>(fn: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    return fn(this.txnView());
  }
  transactionSync<T>(fn: () => T): T {
    return fn();
  }
  async setAlarm(): Promise<void> {}
  async getAlarm(): Promise<number | null> {
    return null;
  }
  async deleteAlarm(): Promise<void> {}

  private txnView(): StorageTransaction {
    return {
      get: (key) => this.get(key),
      put: (key, value) => this.put(key, value),
      delete: (key) => this.delete(key),
      list: (options) => this.list(options),
    };
  }
}

export function makeActorContext(id: string, storage: ActorStorage = new MemoryStorage()): ActorContext {
  // Platform seam: the real ActorContext arrives from the Edge runtime.
  return {
    id,
    storage,
    blockConcurrencyWhile: <T,>(fn: () => Promise<T>): Promise<T> => fn(),
    setAlarm: () => Promise.resolve(),
    count: () => 0,
    broadcast: () => 0,
    sockets: () => [],
  } as unknown as ActorContext;
}

/**
 * Actor namespace stand-in: one lazily-constructed actor per name, each with
 * its own MemoryStorage, wrapped in a bound-call Proxy — the same contract
 * the platform's typed `ActorStub` provides.
 */
export function makeNamespace(
  ctor: new (ctx: ActorContext, env: unknown) => unknown,
  env: unknown,
): ActorNamespace<never> {
  const actors = new Map<string, unknown>();
  return {
    idFromName(name: string): unknown {
      let actor = actors.get(name);
      if (!actor) {
        actor = new ctor(makeActorContext(name), env);
        actors.set(name, actor);
      }
      return new Proxy(actor as Record<string, unknown>, {
        get(obj, prop) {
          const value = Reflect.get(obj, prop);
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(obj) : value;
        },
      });
    },
  } as ActorNamespace<never>;
}
