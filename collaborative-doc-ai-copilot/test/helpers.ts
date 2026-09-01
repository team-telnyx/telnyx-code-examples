import type { ActorContext, ActorStorage, ListOptions, SqlStorage, StorageTransaction } from "@telnyx/edge-runtime";
import { DocActor } from "../src/doc-actor.js";
import type { DocState, Env } from "../src/types.js";

/** In-memory ActorStorage mirroring the platform KV surface (SQL throws). */
export class MemoryStorage implements ActorStorage {
  private readonly map = new Map<string, unknown>();

  get sql(): SqlStorage {
    throw new Error("MemoryStorage: SQL storage is not configured");
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list<T>(options?: ListOptions): Promise<Map<string, T>> {
    let entries = [...this.map.entries()] as [string, T][];
    if (options?.prefix) entries = entries.filter(([k]) => k.startsWith(options.prefix!));
    return new Map(entries);
  }
  async deleteAll(): Promise<void> {
    this.map.clear();
  }
  async transaction<T>(fn: (txn: StorageTransaction) => Promise<T>): Promise<T> {
    return fn({
      get: (key) => this.get(key),
      put: (key, value) => this.put(key, value),
      delete: (key) => this.delete(key),
      list: (options) => this.list(options),
    });
  }
  transactionSync<T>(fn: () => T): T {
    return fn();
  }
  async setAlarm(): Promise<void> {}
  async getAlarm(): Promise<number | null> {
    return null;
  }
  async deleteAlarm(): Promise<void> {}
}

export interface MockInferenceCall {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

/** Build a DocActor over fresh memory storage with a scripted inference mock. */
export function makeActor(
  reply: string | null,
  calls: MockInferenceCall[] = [],
  envOverrides: Partial<Env> = {},
): DocActor {
  const telnyx = {
    ai: {
      openai: {
        chat: {
          createCompletion: async (params: MockInferenceCall) => {
            calls.push(params);
            return {
              choices: [{ message: { content: reply } }],
            };
          },
        },
      },
    },
  };
  const ctx = {
    id: "doc_test",
    storage: new MemoryStorage(),
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    broadcast: () => 0,
    count: () => 0,
  };
  const env = {
    DOCS: {},
    TELNYX: telnyx,
    ...envOverrides,
  };
  // Test seam: the platform provides the real ActorContext and Telnyx client.
  return new DocActor(ctx as unknown as ActorContext, env as unknown as Env);
}

export async function stateOf(actor: DocActor): Promise<DocState> {
  return actor.snapshot();
}
