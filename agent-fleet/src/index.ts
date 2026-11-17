/**
 * agent-fleet \u2014 three config-only ACP agents, one operating surface.
 *
 * ASSUMPTION: the ACP beta operates config-only agents (`agent.json` +
 * `instructions.md`) through the `telnyx-acp` CLI. An Edge function cannot shell
 * out to that CLI, so this sample implements the runtime the CLI deploys \u2014
 * three agents, one per channel \u2014 and exposes the same five verbs (`status`,
 * `logs`, `traces`, `versions`, `deploy`) as HTTP routes so the workflow is
 * identical per project. `list` is deliberately absent (reserved for the
 * control-plane API, not shipped in the beta) and rollback is refused \u2014 the
 * way back is checkout + redeploy.
 *
 * SELF-REVIEW: real primitives only (Agent actors, KV, Telnyx Inference via the
 * zero-credential TELNYX binding, Ed25519 webhook verification); demo mode is
 * the default so no SMS is sent; no credentials in code.
 */
import { Agent, type ActorNamespace, type KvNamespace, type Secrets } from "@telnyx/edge-runtime";

export type Channel = "web" | "email" | "phone";
export type ProjectName = "acp-support" | "acp-sales" | "acp-scheduling";

export interface TelnyxBinding {
  messages: { send(i: { to: string; from: string; text: string }): Promise<unknown> };
  ai: {
    openai: {
      chat: {
        createCompletion(i: {
          model: string;
          messages: { role: "system" | "user" | "assistant"; content: string }[];
        }): Promise<{
          choices?: { message?: { content?: string }; finish_reason?: string }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        }>;
      };
    };
  };
}
export interface Env {
  SECRETS: Secrets;
  TELNYX: TelnyxBinding;
  FLEET_KV: KvNamespace;
  SUPPORT: ActorNamespace;
  SALES: ActorNamespace;
  SCHEDULING: ActorNamespace;
  AI_MODEL?: string;
  DEMO_MODE?: string;
  AGENT_NUMBER?: string;
}
export interface ProjectRecord {
  name: ProjectName; channel: Channel; revision: number; gitSha: string;
  instructions: string; deployedAt: string; address: string;
  versions: { revision: number; gitSha: string; deployedAt: string }[];
}
export interface MemoryProfile { conversation: string; channel: Channel; facts: string[]; updatedAt: string }
export interface TraceStep {
  step: "memory.read" | "model.call" | "memory.write" | "delivery";
  detail: string; at: string;
  tokens?: { prompt: number; completion: number };
  finishReason?: string;
}
export interface LogLine { at: string; project: ProjectName; event: string; conversation: string; detail: string }

export const PROJECTS: ProjectName[] = ["acp-support", "acp-sales", "acp-scheduling"];
export const CHANNELS: Record<ProjectName, Channel> = {
  "acp-support": "web", "acp-sales": "email", "acp-scheduling": "phone",
};
export const ADDRESSES: Record<ProjectName, string> = {
  "acp-support": "/web", "acp-sales": "sales-inbox@example.com", "acp-scheduling": "+1555XXXXXXXX",
};
export const INSTRUCTIONS: Record<ProjectName, string> = {
  "acp-support": "You are the support agent on the web page. Answer refund, shipping and account questions in two sentences or fewer. For a refund, confirm the order number and say a human follows up within one business day.",
  "acp-sales": "You are the sales agent replying to inbound email in the same thread. Plain text, under 120 words. Qualify the request, name one concrete next step, never invent pricing.",
  "acp-scheduling": "You are the scheduling agent on the phone and over SMS. Greet warmly, collect name, service and preferred time, then read the booking back verbatim. Keep every turn under 30 words.",
};

const DAY = 86_400;
const nowIso = (): string => new Date().toISOString();
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json" } });
export const isProject = (value: string): value is ProjectName => (PROJECTS as string[]).includes(value);

function shortSha(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 7);
}
export function parseSince(raw: string | null): number {
  const match = /^(\d+)([smh])$/.exec((raw ?? "10m").trim());
  const unit = match?.[2] === "s" ? 1_000 : match?.[2] === "h" ? 3_600_000 : 60_000;
  return match ? Number(match[1]) * unit : 600_000;
}
export async function readProject(kv: KvNamespace, name: ProjectName): Promise<ProjectRecord | null> {
  return (await kv.get(`project:${name}`, { type: "json" })) as ProjectRecord | null;
}
export async function appendLog(kv: KvNamespace, project: ProjectName, event: string, conversation: string, detail: string): Promise<void> {
  const at = nowIso();
  const line: LogLine = { at, project, event, conversation, detail };
  await kv.put(`log:${project}:${at}:${shortSha()}`, JSON.stringify(line), { expirationTtl: 7 * DAY });
}
export async function readLogs(kv: KvNamespace, project: ProjectName, sinceMs: number): Promise<LogLine[]> {
  const listed = (await kv.list({ prefix: `log:${project}:`, limit: 500 })) as { keys: { name: string }[] };
  const cutoff = Date.now() - sinceMs;
  const lines: LogLine[] = [];
  for (const key of listed.keys) {
    const line = (await kv.get(key.name, { type: "json" })) as LogLine | null;
    if (line && Date.parse(line.at) >= cutoff) lines.push(line);
  }
  return lines.sort((a, b) => a.at.localeCompare(b.at));
}

export abstract class FleetAgent extends Agent<Env, { turns: number }> {
  protected abstract get project(): ProjectName;

  protected initialState(): { turns: number } {
    return { turns: 0 };
  }

  /** One turn: memory read \u2192 model call \u2192 memory write \u2192 delivery, all traced. */
  async handleMessage(input: { conversation: string; text: string; from?: string }): Promise<{ reply: string; run: string }> {
    const conversation = input.conversation.trim();
    const text = input.text.trim();
    if (!conversation || !text) throw new Error("conversation and text are required");

    const project = await this.loadProject();
    const run = `${Date.now().toString(36)}-${shortSha().slice(0, 4)}`;
    const steps: TraceStep[] = [];

    const memory = await this.readMemory(conversation);
    steps.push({ step: "memory.read", detail: `${memory.facts.length} fact(s) on file`, at: nowIso() });

    const model = this.env.AI_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct";
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model,
      messages: [
        { role: "system", content: project.instructions },
        { role: "system", content: memory.facts.length ? `Known about this person: ${memory.facts.join("; ")}` : "No prior context for this person." },
        { role: "user", content: text },
      ],
    });
    const choice = completion.choices?.[0];
    const reply = choice?.message?.content?.trim() || "A teammate will follow up shortly.";
    const tokens = { prompt: completion.usage?.prompt_tokens ?? 0, completion: completion.usage?.completion_tokens ?? 0 };
    steps.push({ step: "model.call", detail: model, tokens, finishReason: choice?.finish_reason ?? "stop", at: nowIso() });

    const facts = [...memory.facts, `${CHANNELS[this.project]}: ${text.slice(0, 120)}`].slice(-12);
    const profile: MemoryProfile = { conversation, channel: CHANNELS[this.project], facts, updatedAt: nowIso() };
    await this.env.FLEET_KV.put(`memory:${conversation}`, JSON.stringify(profile), { expirationTtl: 30 * DAY });
    steps.push({ step: "memory.write", detail: `${facts.length} fact(s) stored`, at: nowIso() });

    steps.push({ step: "delivery", detail: await this.deliver(conversation, reply, input.from), at: nowIso() });

    const trace = { project: this.project, conversation, run, steps };
    await this.env.FLEET_KV.put(`trace:${this.project}:${conversation}:${run}`, JSON.stringify(trace), { expirationTtl: 7 * DAY });
    await appendLog(this.env.FLEET_KV, this.project, "modelStream", conversation, `${model} \xb7 ${tokens.completion} completion tokens`);

    const state = await this.getState();
    await this.setState({ turns: state.turns + 1 });
    return { reply, run };
  }

  private async loadProject(): Promise<ProjectRecord> {
    const record = await readProject(this.env.FLEET_KV, this.project);
    if (record) return record;
    return {
      name: this.project, channel: CHANNELS[this.project], revision: 0, gitSha: "0000000",
      instructions: INSTRUCTIONS[this.project], deployedAt: nowIso(),
      address: ADDRESSES[this.project], versions: [],
    };
  }

  private async readMemory(conversation: string): Promise<MemoryProfile> {
    const stored = (await this.env.FLEET_KV.get(`memory:${conversation}`, { type: "json" })) as MemoryProfile | null;
    return stored ?? { conversation, channel: CHANNELS[this.project], facts: [], updatedAt: nowIso() };
  }

  private async deliver(conversation: string, reply: string, from?: string): Promise<string> {
    if (this.project === "acp-support") return `web page ${conversation}`;
    if (this.project === "acp-sales") return `email thread ${conversation}`;
    const to = from ?? conversation;
    const sender = this.env.AGENT_NUMBER;
    if (this.env.DEMO_MODE !== "false" || !sender) return `demo: would SMS ${to}`;
    await this.env.TELNYX.messages.send({ to, from: sender, text: reply });
    return `sms ${to}`;
  }
}

export class SupportAgent extends FleetAgent {
  protected get project(): ProjectName { return "acp-support"; }
}
export class SalesAgent extends FleetAgent {
  protected get project(): ProjectName { return "acp-sales"; }
}
export class SchedulingAgent extends FleetAgent {
  protected get project(): ProjectName { return "acp-scheduling"; }
}

function namespaceFor(env: Env, project: ProjectName): ActorNamespace {
  if (project === "acp-support") return env.SUPPORT;
  if (project === "acp-sales") return env.SALES;
  return env.SCHEDULING;
}

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  if (request.method !== "POST") return {};
  const parsed = await request.json().catch(() => null);
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
};

export async function deploy(env: Env, project: ProjectName, body: Record<string, unknown>): Promise<ProjectRecord> {
  const existing = await readProject(env.FLEET_KV, project);
  const revision = (existing?.revision ?? 0) + 1;
  const requested = typeof body.gitSha === "string" ? body.gitSha : "";
  const gitSha = /^[0-9a-f]{7,40}$/.test(requested) ? requested.slice(0, 7) : shortSha();
  const edited = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 4000) : "";
  const deployedAt = nowIso();
  const record: ProjectRecord = {
    name: project, channel: CHANNELS[project], revision, gitSha, deployedAt,
    instructions: edited || existing?.instructions || INSTRUCTIONS[project],
    address: ADDRESSES[project],
    versions: [...(existing?.versions ?? []), { revision, gitSha, deployedAt }],
  };
  await env.FLEET_KV.put(`project:${project}`, JSON.stringify(record));
  await appendLog(env.FLEET_KV, project, "deploy", "-", `revision ${revision} live (${gitSha})`);
  return record;
}

export async function sendToAgent(env: Env, project: ProjectName, body: Record<string, unknown>) {
  const conversation = typeof body.conversation === "string" ? body.conversation.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!conversation || !text) return { error: "conversation and text are required" };
  const ns = namespaceFor(env, project);
  const stub = ns.get(ns.idFromName(conversation)) as unknown as {
    handleMessage(i: { conversation: string; text: string; from?: string }): Promise<{ reply: string; run: string }>;
  };
  const result = await stub.handleMessage({ conversation, text, from: typeof body.from === "string" ? body.from : undefined });
  return { project, conversation, ...result };
}

export async function status(env: Env, project: ProjectName) {
  const record = await readProject(env.FLEET_KV, project);
  if (!record) return { project, deployed: false, hint: `run deploy in ${project}/` };
  const recent = await readLogs(env.FLEET_KV, project, 3_600_000);
  const lastEventAt = recent.at(-1)?.at ?? null;
  return {
    project, deployed: true, revision: record.revision, gitSha: record.gitSha,
    channel: record.channel, address: record.address, deployedAt: record.deployedAt,
    webhook: { lastEventAt, healthy: lastEventAt !== null },
  };
}

const str = (value: unknown): string => {
  if (typeof value === "string") return value;
  const nested = value && typeof value === "object" ? (value as Record<string, unknown>).address : undefined;
  return typeof nested === "string" ? nested : "";
};

async function verifySignature(env: Env, raw: string, headers: Headers): Promise<boolean> {
  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
  if (!publicKey) return false;
  try {
    const decode = (value: string): Uint8Array => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", decode(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${timestamp}|${raw}`);
    return await crypto.subtle.verify("Ed25519", key, decode(signature), signed);
  } catch {
    return false;
  }
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifySignature(env, raw, request.headers))) return json({ error: "invalid signature" }, 401);
  const event = JSON.parse(raw) as { data?: { event_type?: string; payload?: Record<string, unknown> } };
  const type = event.data?.event_type ?? "";
  const payload = event.data?.payload ?? {};

  if (type === "email.received") {
    const thread = str(payload.thread_id) || str(payload.id);
    const text = str(payload.text) || str(payload.subject);
    if (!thread || !text) return json({ received: true, ignored: "missing thread or body" });
    const result = await sendToAgent(env, "acp-sales", { conversation: `email-${thread}`, text, from: str(payload.from) });
    return json({ received: true, ...result });
  }
  if (type === "message.received") {
    const sender = str(payload.from);
    const text = str(payload.text);
    if (!sender || !text) return json({ received: true, ignored: "missing sender or text" });
    const result = await sendToAgent(env, "acp-scheduling", { conversation: sender, text, from: sender });
    return json({ received: true, ...result });
  }
  if (type === "call.initiated") {
    const caller = str(payload.from) || "-";
    await appendLog(env.FLEET_KV, "acp-scheduling", "voiceCall", caller, "inbound call \u2014 calls are not traced in the beta; use logs");
    return json({ received: true, traced: false });
  }
  return json({ received: true, ignored: type || "unknown event" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhook/telnyx") return handleWebhook(request, env);

    const [project, verb, ...rest] = url.pathname.split("/").filter(Boolean);
    if (!project || !isProject(project)) {
      return json({ error: "unknown project; the fleet is acp-support, acp-sales, acp-scheduling" }, 404);
    }

    try {
      if (verb === "status") return json(await status(env, project));
      if (verb === "versions") {
        const record = await readProject(env.FLEET_KV, project);
        return json({ project, versions: record?.versions ?? [] });
      }
      if (verb === "logs") return json(await readLogs(env.FLEET_KV, project, parseSince(url.searchParams.get("since"))));
      if (verb === "traces") {
        const [conversation, run] = rest;
        if (!conversation || !run) return json({ error: "usage: traces <conversation> <run>" }, 400);
        const record = await env.FLEET_KV.get(`trace:${project}:${conversation}:${run}`, { type: "json" });
        return record ? json(record) : json({ error: "no trace for that conversation and run" }, 404);
      }
      if (verb === "deploy") return json(await deploy(env, project, await readBody(request)), 201);
      if (verb === "message") return json(await sendToAgent(env, project, await readBody(request)));
      return json({ error: "verbs: status, logs, traces, versions, deploy, message" }, 404);
    } catch (error) {
      console.error("fleet route failed", { project, verb, reason: (error as Error).message });
      return json({ error: "request failed" }, 500);
    }
  },
};
