import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Local Edge-context substitute for the local runner.
 *
 * The real Edge runtime gives every Actor instance:
 *   - `ctx.storage.sql` — a per-actor SQLite
 *   - `ctx.kv` — a key-value store scoped to the runtime
 *   - `ctx.setState` / `ctx.getState` — actor-level durable state
 *   - `ctx.blockConcurrencyWhile(fn)` — one-shot init primitive
 *   - `ctx.setAlarm(when)` — schedule a wakeup
 *
 * This module mimics that surface using better-sqlite3 (one DB per actor
 * instance) and a plain in-memory Map for KV. The actor code doesn't know
 * whether it's running on Edge or locally — only the actor proxy in the
 * runner cares.
 */
export type LocalKv = {
  get(key: string): Promise<number | string | null>;
  set(key: string, value: number | string): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): void;
};

export class LocalKvImpl implements LocalKv {
  private store = new Map<string, number | string>();
  async get(key: string): Promise<number | string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  async set(key: string, value: number | string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

export type LocalCtx = {
  readonly id: string;
  readonly storage: {
    sql: Database.Database;
  };
  readonly kv: LocalKv;
  setState<T>(state: T): Promise<void>;
  getState<T>(): Promise<T>;
  blockConcurrencyWhile(fn: () => Promise<void>): Promise<void>;
  setAlarm(when: Date | number): Promise<void>;
};

export class LocalActorContext {
  readonly ctx: LocalCtx;
  private state: unknown = {};

  constructor(dbPath: string, initialState: unknown = {}, id: string = "local-actor") {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    const kv = new LocalKvImpl();
    this.ctx = {
      id,
      storage: { sql: db },
      kv,
      setState: async <T,>(state: T) => { this.state = state; },
      getState: async <T,>() => this.state as T,
      blockConcurrencyWhile: async (fn: () => Promise<void>) => { await fn(); },
      setAlarm: async (_when: Date | number) => { /* no-op in local runner */ },
    };
    this.state = initialState;
  }

  close(): void {
    this.ctx.storage.sql.close();
  }
}

export function actorDbPath(baseDir: string, actorName: string): string {
  return resolve(baseDir, `${actorName}.sqlite`);
}
