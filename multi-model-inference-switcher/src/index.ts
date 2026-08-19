export { SwitcherAgent } from "./switcherAgent";
import type { SwitcherAgent } from "./switcherAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";
import { ADMIN_HTML } from "./adminHtml";

type SwitcherAgentStub = ActorStub &
  Pick<
    SwitcherAgent,
    | "process"
    | "getHistory"
    | "clearHistory"
    | "getDebugState"
  >;

interface SwitcherAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): SwitcherAgentStub;
}

interface Env {
  SWITCHER: SwitcherAgentNamespace;
  KV_NAMESPACE_ID: string;
}

const TELNYX_API = "https://api.telnyx.com/v2";
const KV_KEY = "active-model";
const SESSION_ID = "default";

export const AVAILABLE_MODELS = [
  { id: "zai-org/GLM-5.2", name: "GLM-5.2", vendor: "Z.ai" },
  { id: "MiniMaxAI/MiniMax-M3-MXFP8", name: "MiniMax M3", vendor: "MiniMax" },
  { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6", vendor: "Moonshot AI" },
];

const DEFAULT_MODEL = AVAILABLE_MODELS[0].id;

function getApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
}

async function kvGet(namespaceId: string, apiKey: string, key: string): Promise<string | null> {
  const resp = await fetch(
    `${TELNYX_API}/storage/kvs/${namespaceId}/keys/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!resp.ok) return null;
  return await resp.text();
}

async function kvPut(namespaceId: string, apiKey: string, key: string, value: string): Promise<void> {
  await fetch(`${TELNYX_API}/storage/kvs/${namespaceId}/keys/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "text/plain" },
    body: value,
  });
}

async function getActiveModel(namespaceId: string, apiKey: string): Promise<string> {
  const model = await kvGet(namespaceId, apiKey, KV_KEY);
  return model || DEFAULT_MODEL;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    let apiKey: string;
    try {
      apiKey = getApiKey();
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "secrets not configured" }, { status: 500 });
    }

    const kvNamespaceId = env.KV_NAMESPACE_ID || process.env.KV_NAMESPACE_ID || "";

    // ── Admin UI (HTML) ────────────────────────────────────────────
    if (url.pathname === "/" && req.method === "GET") {
      const activeModel = await getActiveModel(kvNamespaceId, apiKey);
      const html = ADMIN_HTML
        .replace("__ACTIVE_MODEL__", activeModel)
        .replace("__MODELS_JSON__", JSON.stringify(AVAILABLE_MODELS));
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // ── GET /model — get active model ──────────────────────────────
    if (url.pathname === "/model" && req.method === "GET") {
      const activeModel = await getActiveModel(kvNamespaceId, apiKey);
      return Response.json({ model: activeModel, models: AVAILABLE_MODELS });
    }

    // ── POST /model — switch active model (writes to KV) ──────────
    if (url.pathname === "/model" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { model?: string };
      const model = body.model?.trim();
      if (!model) return Response.json({ error: "model is required" }, { status: 400 });
      const valid = AVAILABLE_MODELS.some((m) => m.id === model);
      if (!valid) return Response.json({ error: "unknown model", available: AVAILABLE_MODELS }, { status: 400 });
      await kvPut(kvNamespaceId, apiKey, KV_KEY, model);
      return Response.json({ model, stored: "kv" });
    }

    // ── POST /chat — send a message, get a reply from active model ─
    if (url.pathname === "/chat" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { text?: string };
      const text = body.text?.trim();
      if (!text) return Response.json({ error: "text is required" }, { status: 400 });

      const activeModel = await getActiveModel(kvNamespaceId, apiKey);
      const stub = env.SWITCHER.idFromName(SESSION_ID);
      const result = await stub.process(text, activeModel);
      return Response.json({ reply: result.reply, model: result.model });
    }

    // ── GET /history — conversation history + usage stats ──────────
    if (url.pathname === "/history" && req.method === "GET") {
      const stub = env.SWITCHER.idFromName(SESSION_ID);
      const history = await stub.getHistory();
      return Response.json(history);
    }

    // ── POST /clear — clear conversation ──────────────────────────
    if (url.pathname === "/clear" && req.method === "POST") {
      const stub = env.SWITCHER.idFromName(SESSION_ID);
      await stub.clearHistory();
      return Response.json({ action: "cleared" });
    }

    // ── GET /debug/state — inspect actor state ────────────────────
    if (url.pathname === "/debug/state" && req.method === "GET") {
      const stub = env.SWITCHER.idFromName(SESSION_ID);
      const state = await stub.getDebugState();
      const activeModel = await getActiveModel(kvNamespaceId, apiKey);
      return Response.json({ ...state, activeModel, kvNamespace: kvNamespaceId });
    }

    return new Response("not found", { status: 404 });
  },
};
