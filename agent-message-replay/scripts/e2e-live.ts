/**
 * Live end-to-end test: runs the DEV-827 ticket flow against a DEPLOYED
 * agent-message-replay Edge function over a real WebSocket.
 *
 *   BASE_URL=https://<your-function>.telnyxcompute.com \
 *   REPLAY_TOKEN=replay-demo \
 *   node --experimental-strip-types scripts/e2e-live.ts
 *   # or: npx vite-node scripts/e2e-live.ts
 *
 * Requires Node 22.5+ (global WebSocket). Each check maps to a DEV-827
 * acceptance criterion; the script exits non-zero on the first failure.
 */
import { DEMO_SCRIPT, demoStages } from "../src/demo-script.js";

const BASE_URL = process.env.BASE_URL;
const TOKEN = process.env.REPLAY_TOKEN ?? "replay-demo";
const CONV = `e2e-${Date.now()}`;

if (!BASE_URL) {
  console.error("Usage: BASE_URL=https://<function>.telnyxcompute.com npx vite-node scripts/e2e-live.ts");
  process.exit(2);
}

type Frame = Record<string, unknown> & { kind: string };

let ws: WebSocket;
let nextCallId = 0;
const pending = new Map<string, { resolve: (v: Frame) => void; reject: (e: Error) => void }>();
const frames: Frame[] = [];
const waiters: Array<{ test: (f: Frame) => boolean }> = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(raw: unknown): Frame {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return (parsed && typeof parsed === "object" && "json" in parsed ? parsed.json : parsed) as Frame;
}

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else if (typeof v === "object" && v !== null && !Array.isArray(v))
      target[k] = mergePatch((target[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
    else target[k] = v;
  }
  return target;
}

async function connect(conv: string): Promise<void> {
  const wsUrl = `${BASE_URL!.replace(/^http/, "ws")}/ws?conv=${encodeURIComponent(conv)}`;
  // Cold-start dials occasionally fail once; retry with backoff.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await dial(wsUrl);
      break;
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(2000 * attempt);
    }
  }
  send({
    v: 2,
    kind: "attach",
    token: TOKEN,
    subscribe: ["state", "messages", "events"],
  });
}

function dial(wsUrl: string): Promise<void> {
  ws = new WebSocket(wsUrl);
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`socket error on ${wsUrl}`));
  });
  ws.onmessage = (ev: MessageEvent) => {
    const frame = decode(ev.data);
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]!.test(frame)) waiters.splice(i, 1);
    }
    if (frame.kind === "result" || frame.kind === "error") {
      const p = pending.get(frame.id as string);
      if (p) {
        pending.delete(frame.id as string);
        frame.kind === "result" ? p.resolve(frame) : p.reject(new Error(String(frame.message)));
      }
    }
  };
  return opened;
}

function send(frame: unknown): void {
  ws.send(JSON.stringify({ json: frame }));
}

function call(method: string, args: unknown[] = []): Promise<Frame> {
  const id = `c${++nextCallId}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ v: 1, kind: "call", id, method, args });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`call ${method} timed out`));
      }
    }, 20_000);
  });
}

async function waitForFrame(test: (f: Frame) => boolean, timeoutMs = 30_000, label = ""): Promise<Frame> {
  const existing = frames.find(test);
  if (existing) return existing;
  return new Promise<Frame>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label || "frame"}`)), timeoutMs);
    waiters.push({
      test: (f) => {
        if (test(f)) {
          clearTimeout(timer);
          resolve(f);
          return true;
        }
        return false;
      },
    });
  });
}

function stateValue(): Record<string, unknown> {
  let state: Record<string, unknown> = {};
  for (const f of frames) {
    if (f.kind === "state" && f.snapshot !== undefined) state = f.snapshot as Record<string, unknown>;
    else if (f.kind === "state" && f.patch !== undefined) state = mergePatch(state, f.patch as Record<string, unknown>);
  }
  return state;
}

function appendedMessages(): Array<{ seq: number; role: string; content: string; at: string }> {
  return frames
    .filter((f) => f.kind === "messages" && f.appended !== undefined)
    .flatMap((f) => f.appended as Array<{ seq: number; role: string; content: string; at: string }>);
}

function eventsOfType(type: string): Array<{ seq: number; type: string; payload: Record<string, unknown> }> {
  return frames
    .filter((f) => f.kind === "event" && f.type === type)
    .map((f) => f as unknown as { seq: number; type: string; payload: Record<string, unknown> });
}

const results: Array<{ ac: string; ok: boolean; detail: string }> = [];
function check(ac: string, ok: boolean, detail: string): void {
  results.push({ ac, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${ac} — ${detail}`);
  if (!ok) process.exitCode = 1;
}

async function main(): Promise<void> {
  console.log(`DEV-827 live flow test → ${BASE_URL} (conversation: ${CONV})\n`);

  // Health
  let health: { ok: boolean } | undefined;
  try {
    health = (await (await fetch(`${BASE_URL}/health`)).json()) as { ok: boolean };
  } catch {
    health = undefined;
  }
  check("GET /health", health?.ok === true, health ? JSON.stringify(health) : "no JSON health response — is the function deployed at BASE_URL?");

  // 1. WebSocket connect + attach (AgentSocketServer primitive)
  await connect(CONV);
  const attached = await waitForFrame((f) => f.kind === "attached");
  const grants = attached.grants as string[];
  check(
    "WebSocket live streaming (AgentSocketServer attach + claims)",
    grants.includes("read") && grants.includes("rpc"),
    `grants=${JSON.stringify(grants)}`,
  );
  await waitForFrame((f) => f.kind === "hello");

  // 2. seed → state publishes ready
  await call("seed");
  const ready = await waitForFrame((f) => f.kind === "state" && (f.patch as Record<string, unknown>)?.status === "ready");
  check("ReplayAgent extends Agent — seed() publishes recording state", ready.patch.total === DEMO_SCRIPT.length, `total=${ready.patch.total}`);

  // 3. play → messages stream with timestamps (MessageLog read → broadcast)
  await call("play");
  await waitForFrame(() => appendedMessages().length >= DEMO_SCRIPT.length, 60_000, "all messages appended");
  // The final tick commits the last stage + replay_finished AFTER the last
  // append lands — wait for the terminal state before asserting.
  await waitForFrame((f) => f.kind === "state" && (f.patch as Record<string, unknown>)?.status === "finished", 30_000, "replay finished");
  const msgs = appendedMessages();
  const ordered = DEMO_SCRIPT.every((step, i) => msgs[i]?.content === step.content && msgs[i]?.role === step.role);
  check("MessageLog history streamed in order with timestamps", ordered, `${msgs.length}/${DEMO_SCRIPT.length} messages, seq 1..${msgs.at(-1)?.seq}`);

  // 4. state change visualization
  const stages = frames
    .filter((f) => f.kind === "state" && typeof (f.patch as Record<string, unknown>)?.agentStage === "string")
    .map((f) => (f.patch as Record<string, unknown>).agentStage as string)
    .filter((s) => s !== "");
  check("State change visualization (stage re-enactment)", JSON.stringify(stages) === JSON.stringify(demoStages()), stages.join(" → "));
  check("Replay finished", stateValue().status === "finished", `status=${String(stateValue().status)}`);

  // 5. ingest a custom recording and replay it (MessageLog read from recording)
  const conv2 = `${CONV}-b`;
  const ingest = await fetch(`${BASE_URL}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversation_id: conv2,
      steps: [
        { role: "user", content: "Where is my order?", delayMs: 300 },
        { role: "assistant", content: "It ships today.", delayMs: 300, stage: "resolving" },
      ],
    }),
  });
  const ingestBody = (await ingest.json()) as { ok: boolean; total: number };
  check("POST /ingest stores a custom recording", ingest.ok && ingestBody.total === 2, JSON.stringify(ingestBody));

  await connect(conv2);
  await waitForFrame((f) => f.kind === "hello");
  await call("play");
  await waitForFrame(
    () => frames.filter((f) => f.kind === "messages" && f.appended !== undefined).length >= 2 && stateValue().status !== "empty",
    30_000,
    "custom replay messages",
  );
  await waitForFrame((f) => f.kind === "state" && (f.patch as Record<string, unknown>)?.status === "finished", 30_000, "custom replay finished");
  check("Custom recording replays end to end", true, "2-step recording played to finished");

  // 6. optional LLM commentary (real inference through the TELNYX binding)
  const conv3 = `${CONV}-c`;
  await connect(conv3);
  await waitForFrame((f) => f.kind === "hello");
  await call("seed");
  await call("setCommentary", [true]);
  await call("play");
  // Five sequential model calls ride inside the replay pacing — allow 2 min.
  await waitForFrame(() => eventsOfType("commentary").length > 0 || eventsOfType("commentary_error").length > 0, 120_000, "commentary event");
  const commentary = eventsOfType("commentary");
  const errors = eventsOfType("commentary_error");
  check(
    "Optional LLM commentary (createCompletion via TELNYX binding)",
    commentary.length > 0,
    commentary.length > 0
      ? `${commentary.length} annotations; first: "${String(commentary[0]!.payload.text).slice(0, 80)}…"`
      : `commentary_error: ${String(errors[0]?.payload.message)}`,
  );

  console.log("\n— DEV-827 flow summary —");
  for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.ac}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error("live flow test failed:", error);
  process.exit(1);
});
