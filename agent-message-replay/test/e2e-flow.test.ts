/**
 * DEV-827 flow conformance — drives the REAL ReplayAgent, AgentSocketServer,
 * MessageLog, EventLog, and TaskScheduler in memory and asserts the exact
 * flow the Linear ticket specifies:
 *
 *   WebSocket connect → ReplayAgent reads MessageLog → stream messages with
 *   timestamps → WebSocket broadcast → optional LLM commentary on each message
 *
 * Each test maps to a ticket acceptance criterion. Only the platform
 * transport (real sockets / real inference) is faked; everything between
 * them is production code.
 */
import { describe, expect, it } from "vitest";
import type { AnyKnownFrame } from "@telnyx/edge-runtime/agent-socket";
import { DEMO_SCRIPT, demoStages } from "../src/demo-script.js";
import { SPEEDS } from "../src/types.js";
import { MemoryStorage, makeActorContext } from "./helpers/memory-storage.js";
import { FakeServerSocket } from "./helpers/fake-socket.js";
import { TestableReplayAgent } from "./helpers/testable-agent.js";
import type { ReplayEnv } from "../src/types.js";

const TOKEN = "replay-demo";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function fakeTelnyxClient() {
  const calls: Array<{
    model: string;
    messages: Array<{ role: string; content: string }>;
  }> = [];
  const client = {
    ai: {
      openai: {
        chat: {
          createCompletion: async (body: {
            model: string;
            messages: Array<{ role: string; content: string }>;
          }) => {
            calls.push(body);
            return { choices: [{ message: { content: "Annotated: billing issue resolved." } }] };
          },
        },
      },
    },
  };
  return { client, calls };
}

function makeAgent(id: string): {
  agent: TestableReplayAgent;
  storage: MemoryStorage;
  modelCalls: ReturnType<typeof fakeTelnyxClient>["calls"];
} {
  const storage = new MemoryStorage();
  const { client, calls } = fakeTelnyxClient();
  // Partial test double on purpose: only the bindings this sample reads.
  const env = { TELNYX: client, MODEL: "zai-org/GLM-5.2", REPLAY_TOKEN: TOKEN } as unknown as ReplayEnv;
  const agent = new TestableReplayAgent(makeActorContext(id, storage), env);
  return { agent, storage, modelCalls: calls };
}

async function connect(agent: TestableReplayAgent, token?: string): Promise<FakeServerSocket> {
  const socket = new FakeServerSocket();
  const attached = agent.webSocket(socket, new Request("https://replay.test/ws"));
  if (attached) await attached;
  await socket.clientSendFrame({
    v: 2,
    kind: "attach",
    token,
    subscribe: ["state", "messages", "events"],
  } as AnyKnownFrame);
  return socket;
}

function call(socket: FakeServerSocket, id: string, method: string, args: unknown[] = []): Promise<void> {
  return socket.clientSendFrame({ v: 1, kind: "call", id, method, args } as AnyKnownFrame);
}

async function runToFinished(agent: TestableReplayAgent, storage: MemoryStorage, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if ((await agent.snapshot()).status === "finished") return;
    const alarm = await storage.getAlarm();
    if (alarm === null) {
      await sleep(10);
    } else {
      const wait = alarm - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 25));
      else await agent.driveAlarm();
    }
    if (Date.now() - start > timeoutMs) throw new Error("replay did not finish in time");
  }
}

/** Pump the durable alarm chain until `predicate` holds (or timeout). */
async function driveUntil(
  agent: TestableReplayAgent,
  storage: MemoryStorage,
  predicate: () => boolean,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    const alarm = await storage.getAlarm();
    if (alarm === null) {
      await sleep(5);
    } else {
      const wait = alarm - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 20));
      else await agent.driveAlarm();
    }
    if (Date.now() - start > timeoutMs) throw new Error("driveUntil timed out");
  }
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await sleep(5);
  }
}

describe("DEV-827 flow: WebSocket connect → MessageLog → broadcast → commentary", () => {
  it("WebSocket connect: AgentSocketServer bootstraps state + messages snapshots and hello", async () => {
    const { agent } = makeAgent("boot");
    const socket = await connect(agent);
    const frames = socket.serverFrames();
    const hello = frames.find((f) => f.kind === "hello");
    const snapshot = frames.find((f) => f.kind === "state" && f.snapshot !== undefined) as
      | { kind: "state"; snapshot: Record<string, unknown> }
      | undefined;
    const messages = frames.find((f) => f.kind === "messages" && f.snapshot !== undefined) as
      | { kind: "messages"; snapshot: unknown[] }
      | undefined;
    expect(hello).toBeDefined();
    expect(snapshot?.snapshot.status).toBe("empty");
    expect(messages?.snapshot).toEqual([]);
  });

  it("claims model: REPLAY_TOKEN gets read+rpc; anonymous gets read-only (calls rejected)", async () => {
    const { agent } = makeAgent("claims");
    const authorized = await connect(agent, TOKEN);
    const attached = authorized
      .serverFrames()
      .find((f) => f.kind === "attached") as { kind: "attached"; grants: readonly string[] } | undefined;
    expect(attached?.grants).toEqual(["read", "rpc"]);

    const anonymous = new FakeServerSocket();
    await agent.webSocket(anonymous, new Request("https://replay.test/ws"));
    await anonymous.clientSendFrame({ v: 2, kind: "attach", subscribe: ["state"] } as AnyKnownFrame);
    await waitFor(() => anonymous.serverFrames().find((f) => f.kind === "attached"));
    const anonAttached = anonymous.serverFrames().find((f) => f.kind === "attached") as {
      grants: readonly string[];
    };
    expect(anonAttached.grants).toEqual(["read"]);

    await call(anonymous, "c1", "seed");
    const error = anonymous
      .serverFrames()
      .find((f) => f.kind === "error" && (f as { id?: string }).id === "c1") as
      | { code: string }
      | undefined;
    expect(error?.code).toBe("unauthorized");
  });

  it("seed(): demo recording loads, state publishes ready/total, recording_loaded event fires", async () => {
    const { agent, storage: agentStorage } = makeAgent("seed");
    const socket = await connect(agent, TOKEN);
    const before = socket.serverFrameCount;
    await call(socket, "s1", "seed");
    await waitFor(() => socket.newServerFrames(before).find((f) => f.kind === "result"));
    const frames = socket.newServerFrames(before);
    const result = frames.find((f) => f.kind === "result") as { value: { total: number } };
    expect(result.value.total).toBe(DEMO_SCRIPT.length);
    const patch = frames.find(
      (f) => f.kind === "state" && (f as { patch?: Record<string, unknown> }).patch !== undefined,
    ) as { patch: Record<string, unknown> };
    expect(patch.patch.status).toBe("ready");
    expect(patch.patch.total).toBe(DEMO_SCRIPT.length);
    const event = frames.find((f) => f.kind === "event") as
      | { type: string; payload: { conversationId: string } }
      | undefined;
    expect(event?.type).toBe("recording_loaded");
    expect(event?.payload.conversationId).toBe("billing-support-demo");
  });

  it("play(): MessageLog streams with timestamps in recorded order over the socket", async () => {
    const { agent, storage: agentStorage } = makeAgent("play");
    const socket = await connect(agent, TOKEN);
    await call(socket, "s1", "seed");
    await call(socket, "s2", "setSpeed", [SPEEDS[3]]);
    await waitFor(() => socket.serverFrames().filter((f) => f.kind === "result").length >= 2);
    await call(socket, "s3", "play");
    await runToFinished(agent, agentStorage);
    const appended = socket
      .serverFrames()
      .filter((f) => f.kind === "messages" && (f as { appended?: unknown[] }).appended !== undefined)
      .flatMap((f) => (f as unknown as { appended: Array<{ seq: number; role: string; content: string; at: string }> }).appended);
    expect(appended).toHaveLength(DEMO_SCRIPT.length);
    appended.forEach((m, i) => {
      expect(m.seq).toBe(i + 1);
      expect(m.role).toBe(DEMO_SCRIPT[i]?.role);
      expect(m.content).toBe(DEMO_SCRIPT[i]?.content);
      expect(m.at).toBeDefined();
    });
  }, 30_000);

  it("state change visualization: agentStage patches re-enact the recorded stages in order", async () => {
    const { agent, storage: agentStorage } = makeAgent("stage");
    const socket = await connect(agent, TOKEN);
    await call(socket, "s1", "seed");
    await call(socket, "s2", "setSpeed", [SPEEDS[3]]);
    await waitFor(() => socket.serverFrames().find((f) => f.kind === "result"));
    await call(socket, "s3", "play");
    await runToFinished(agent, agentStorage);
    const stages = socket
      .serverFrames()
      .filter(
        (f) =>
          f.kind === "state" &&
          (f as { patch?: { agentStage?: string } }).patch?.agentStage !== undefined,
      )
      .map((f) => (f as { patch: { agentStage: string } }).patch.agentStage)
      .filter((stage) => stage !== "");
    expect(stages).toEqual(demoStages());
    const finished = socket
      .serverFrames()
      .find((f) => f.kind === "event" && (f as { type?: string }).type === "replay_finished");
    expect(finished).toBeDefined();
  }, 30_000);

  it("pause is durable: appends stop, resume continues from the persisted playhead", async () => {
    const { agent } = makeAgent("pause");
    const storage = new MemoryStorage();
    const { client } = fakeTelnyxClient();
    const env = { TELNYX: client, MODEL: "zai-org/GLM-5.2", REPLAY_TOKEN: TOKEN } as unknown as ReplayEnv;
    const pauseAgent = new TestableReplayAgent(makeActorContext("pause-2", storage), env);
    const socket = new FakeServerSocket();
    await pauseAgent.webSocket(socket, new Request("https://replay.test/ws"));
    await socket.clientSendFrame({ v: 2, kind: "attach", token: TOKEN, subscribe: ["state", "messages", "events"] } as AnyKnownFrame);
    await call(socket, "s1", "seed");
    await call(socket, "s2", "setSpeed", [SPEEDS[3]]);
    await call(socket, "s3", "play");
    const appendedCount = () =>
      socket
        .serverFrames()
        .filter((f) => f.kind === "messages" && (f as unknown as { appended?: unknown[] }).appended !== undefined)
        .reduce((n, f) => n + ((f as unknown as { appended: unknown[] }).appended.length), 0);
    await driveUntil(pauseAgent, storage, () => appendedCount() >= 2);
    await call(socket, "s4", "pause");
    const pausedAt = (await pauseAgent.snapshot()).playhead;
    expect((await pauseAgent.snapshot()).status).toBe("paused");
    const countWhenPaused = socket.serverFrameCount;
    await pauseAgent.driveAlarm();
    await pauseAgent.driveAlarm();
    expect(socket.serverFrameCount).toBe(countWhenPaused);
    await call(socket, "s5", "play");
    await runToFinished(pauseAgent, storage);
    const final = await pauseAgent.snapshot();
    expect(final.status).toBe("finished");
    expect(final.playhead).toBe(DEMO_SCRIPT.length);
    expect(pausedAt).toBeGreaterThan(0);
  }, 30_000);

  it("optional LLM commentary: MessageLog history feeds the model, commentary events broadcast", async () => {
    const { agent, storage: agentStorage, modelCalls } = makeAgent("commentary");
    const socket = await connect(agent, TOKEN);
    await call(socket, "s1", "seed");
    await call(socket, "s2", "setCommentary", [true]);
    await call(socket, "s3", "play");
    await runToFinished(agent, agentStorage);
    const assistantSteps = DEMO_SCRIPT.filter((s) => s.role === "assistant").length;
    expect(modelCalls.length).toBe(assistantSteps);
    modelCalls.forEach((c, i) => {
      expect(c.model).toBe("zai-org/GLM-5.2");
      expect(c.messages[0]?.role).toBe("system");
      expect(c.messages.length).toBeGreaterThan(i === 0 ? 1 : modelCalls[i - 1]?.messages.length ?? 0);
    });
    const commentary = socket
      .serverFrames()
      .filter((f) => f.kind === "event" && (f as { type?: string }).type === "commentary")
      .map((f) => (f as { payload: { text: string; stepIndex: number } }).payload);
    expect(commentary).toHaveLength(assistantSteps);
    expect(commentary[0]?.text).toContain("Annotated");
    const busyOn = socket
      .serverFrames()
      .some((f) => f.kind === "state" && (f as { patch?: { commentaryBusy?: boolean } }).patch?.commentaryBusy === true);
    expect(busyOn).toBe(true);
  }, 30_000);

  it("seek clamps to [0,total] and broadcasts the playhead; bad speed is an error frame", async () => {
    const { agent } = makeAgent("seek");
    const socket = await connect(agent, TOKEN);
    await call(socket, "s1", "seed");
    await waitFor(() => socket.serverFrames().find((f) => f.kind === "result"));
    await call(socket, "s2", "seek", [999]);
    await waitFor(() => socket.newServerFrames(socket.serverFrameCount - 3).find((f) => f.kind === "result"));
    const seekResult = socket
      .serverFrames()
      .filter((f) => f.kind === "result")
      .pop() as { value: { playhead: number } };
    expect(seekResult.value.playhead).toBe(DEMO_SCRIPT.length);
    await call(socket, "s3", "setSpeed", [3]);
    const error = socket
      .serverFrames()
      .find((f) => f.kind === "error" && (f as { id?: string }).id === "s3") as
      | { code: string; message: string }
      | undefined;
    expect(error?.code).toBe("method_error");
    expect(error?.message).toContain("speed must be one of");
  });
});

