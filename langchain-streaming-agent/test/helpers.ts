import type { ActorContext, ActorStorage, ListOptions, SqlStorage, StorageTransaction } from "@telnyx/edge-runtime";
import { StreamingAgent } from "../src/streaming-agent.js";
import type {
  InferenceCompletionParams,
  InferenceCompletionResult,
  TelnyxInferenceClient,
} from "../src/telnyx-client.js";
import type { AgentState, Env } from "../src/types.js";

/** In-memory ActorStorage mirroring the platform KV surface (SQL throws). */
export class MemoryStorage implements ActorStorage {
  private readonly map = new Map<string, unknown>();
  private alarmTimer: NodeJS.Timeout | null = null;
  /** Wired by the test to pump the agent's task scheduler. */
  onAlarm: (() => void) | null = null;

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

  async setAlarm(when: number): Promise<void> {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    const delay = Math.max(0, when - Date.now());
    this.alarmTimer = setTimeout(() => this.onAlarm?.(), delay);
  }

  async getAlarm(): Promise<number | null> {
    return null;
  }

  async deleteAlarm(): Promise<void> {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    this.alarmTimer = null;
  }
}

/** One scripted `createCompletion` call: params in, raw SSE text out. */
export type ScriptedCall = (params: InferenceCompletionParams) => InferenceCompletionResult;

/** A scripted response: a fixed body, or a function of the request params. */
export type ScriptedResponse = string | ScriptedCall;

/** Build a raw data-only SSE body the way Telnyx Inference returns it. */
export function sse(frames: Array<Record<string, unknown>>): string {
  return (
    frames
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join("") + "\n"
  );
}

/** Content-delta frames for a plain text answer. */
export function contentSse(text: string): string {
  const frames = [
    { choices: [{ delta: { role: "assistant", content: null }, finish_reason: null }] },
    ...[...text.matchAll(/\S+\s*|\s+/g)].map((m) => ({
      choices: [{ delta: { content: m[0] }, finish_reason: null }],
    })),
    { choices: [{ delta: { content: null }, finish_reason: "stop" }] },
  ];
  return sse(frames);
}

/** Tool-call frames for one full tool call (name chunk + argument chunks). */
export function toolCallSse(name: string, argsJson: string, callId = "call_test_1"): string {
  return sse([
    { choices: [{ delta: { role: "assistant", content: null }, finish_reason: null }] },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, id: callId, function: { name, arguments: "" } }] },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, id: null, function: { name: null, arguments: argsJson } }] },
          finish_reason: "tool_calls",
        },
      ],
    },
  ]);
}

export interface RecordedCall {
  params: InferenceCompletionParams;
}

export interface AgentFixture {
  agent: StreamingAgent;
  calls: RecordedCall[];
  events: () => Promise<Array<{ seq: number; type: string; payload: unknown }>>;
  state: () => Promise<AgentState>;
}

/**
 * Build a StreamingAgent over fresh memory storage with a scripted inference
 * client. The task scheduler is pumped through the storage alarm, exactly as
 * the local dev harness does.
 */
export function makeAgent(script: ScriptedResponse[]): AgentFixture {
  const calls: RecordedCall[] = [];
  let callIndex = 0;
  const telnyx: TelnyxInferenceClient = {
    ai: {
      openai: {
        chat: {
          createCompletion: async (params): Promise<InferenceCompletionResult> => {
            calls.push({ params });
            const next = script[callIndex];
            callIndex += 1;
            if (next === undefined) {
              throw new Error(`Unexpected inference call #${callIndex}: ${JSON.stringify(params.messages.at(-1))}`);
            }
            return typeof next === "function" ? next(params) : next;
          },
        },
      },
    },
  };
  return createAgentWithEnv(
    { AGENTS: {}, TELNYX: telnyx, AI_MODEL: "test-model" } as unknown as Env,
    calls,
  );
}

/** Build a StreamingAgent over fresh memory storage with the given env. */
export function createAgentWithEnv(env: Env, calls: RecordedCall[] = []): AgentFixture {
  const storage = new MemoryStorage();
  const ctx = {
    id: "agent_test",
    storage,
    blockConcurrencyWhile: (fn: () => Promise<void>) => fn(),
    broadcast: () => 0,
    count: () => 0,
  };
  const agent = new StreamingAgent(ctx as unknown as ActorContext, env);
  storage.onAlarm = () => {
    void agent.alarm({ retryCount: 0, isRetry: false });
  };
  return {
    agent,
    calls,
    state: () => agent.currentState(),
    events: async () => {
      const log = (agent as unknown as {
        events: { read(after?: number): Promise<Array<{ seq: number; type: string; payload: unknown }>> };
      }).events;
      return log.read(0);
    },
  };
}

/** Poll until `fn()` resolves truthy, or throw after `ms`. */
export async function waitFor<T>(
  fn: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  ms = 8000,
): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor timed out");
}
