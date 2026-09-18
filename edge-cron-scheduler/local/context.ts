// Single-process development host. Production supplies ActorContext itself.
import { DatabaseSync } from "node:sqlite";
import { serialize, deserialize } from "node:v8";
import type {
  ActorContext,
  ActorStorage,
  SqlStorage,
  SqlBindValue,
  SqlValue,
  ListOptions,
} from "@telnyx/edge-runtime";
export function localContext(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS local_kv (key TEXT PRIMARY KEY,value BLOB NOT NULL)",
  );
  let serial = 0;
  const storage: ActorStorage = {
    async get<T>(key: string): Promise<T | undefined> {
      const row = db.prepare("SELECT value FROM local_kv WHERE key=?").get(key);
      return row ? (deserialize(row.value as Uint8Array) as T) : undefined;
    },
    async put(key, value) {
      db.prepare("INSERT OR REPLACE INTO local_kv VALUES (?,?)").run(
        key,
        serialize(value),
      );
    },
    async delete(key) {
      return (
        Number(
          db.prepare("DELETE FROM local_kv WHERE key=?").run(key).changes,
        ) > 0
      );
    },
    async list<T>(options: ListOptions = {}) {
      const rows = db
        .prepare("SELECT key,value FROM local_kv ORDER BY key")
        .all();
      if (options.reverse) rows.reverse();
      const selected = rows
        .filter((r) => {
          const k = String(r.key);
          return (
            (!options.prefix || k.startsWith(options.prefix)) &&
            (!options.start || k >= options.start) &&
            (!options.startAfter || k > options.startAfter) &&
            (!options.end || k < options.end)
          );
        })
        .slice(0, options.limit ?? 128);
      return new Map(
        selected.map((r) => [
          String(r.key),
          deserialize(r.value as Uint8Array) as T,
        ]),
      );
    },
    async deleteAll() {
      db.exec("DELETE FROM local_kv");
    },
    async transaction(fn) {
      const name = `tx_${serial++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = await fn(storage);
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (e) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw e;
      }
    },
    transactionSync(fn) {
      const name = `tx_${serial++}`;
      db.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        db.exec(`RELEASE ${name}`);
        return result;
      } catch (e) {
        db.exec(`ROLLBACK TO ${name}`);
        db.exec(`RELEASE ${name}`);
        throw e;
      }
    },
    sql: {
      exec<T extends Record<string, SqlValue>>(
        query: string,
        ...bindings: SqlBindValue[]
      ) {
        if (/^\s*CREATE\s/i.test(query) && bindings.length === 0) {
          db.exec(query);
          return {
            toArray: () => [],
            [Symbol.iterator]: () => [][Symbol.iterator](),
          };
        }
        const stmt = db.prepare(query);
        const args = bindings.map((v) =>
          typeof v === "boolean"
            ? Number(v)
            : v instanceof ArrayBuffer
              ? new Uint8Array(v)
              : v,
        );
        const rows = stmt.columns().length
          ? (stmt.all(...args) as T[])
          : (stmt.run(...args), [] as T[]);
        const iterator = rows[Symbol.iterator]();
        return {
          [Symbol.iterator]: () => iterator,
          toArray: () => Array.from(iterator),
        };
      },
    } as SqlStorage,
    async setAlarm(when) {
      await storage.put("local_alarm", when);
    },
    async getAlarm() {
      return (await storage.get<number>("local_alarm")) ?? null;
    },
    async deleteAlarm() {
      await storage.delete("local_alarm");
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx: ActorContext = {
    id: "scheduler",
    storage,
    blockConcurrencyWhile(fn) {
      const result = fn();
      pending.push(result);
      return result;
    },
    setAlarm: (when) => storage.setAlarm(when),
    count: () => 0,
    broadcast: () => 0,
    sockets: () => [],
  };
  return { ctx, ready: () => Promise.all(pending), close: () => db.close() };
}
