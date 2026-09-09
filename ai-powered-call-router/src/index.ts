export { RouterAgent } from "./routerAgent";
import type { RouterAgent } from "./routerAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type RouterAgentStub = ActorStub &
  Pick<
    RouterAgent,
    | "recordStart"
    | "setGreeting"
    | "setGathering"
    | "classifyAndRoute"
    | "setAnnouncing"
    | "setTransferring"
    | "onHangup"
    | "getDebugState"
  >;

interface RouterAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RouterAgentStub;
}

interface Env {
  ROUTER: RouterAgentNamespace;
  TELNYX_API_KEY: string;
  AI_MODEL: string;
  DEFAULT_DESTINATION: string;
  ROUTES: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: Array<{ name: string; sizeBytes?: number; updatedAt?: number }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  };
}

const TELNYX_API = "https://api.telnyx.com/v2";
const GREETING = "Hello, please tell me briefly how I can help you today.";
const TTS_VOICE = "female";

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function encodeClientState(state: Record<string, string>): string {
  return btoa(JSON.stringify(state));
}

function decodeClientState(clientState: unknown): Record<string, string> {
  if (typeof clientState !== "string" || !clientState) return {};
  try {
    const decoded = JSON.parse(atob(clientState));
    return decoded && typeof decoded === "object" ? decoded : {};
  } catch {
    return {};
  }
}

/** Dapr-safe actor name: RFC 1123 — no "+", no special chars. */
function actorName(callControlId: string): string {
  return callControlId.replace(/[^0-9a-zA-Z.-]/g, "");
}

function getApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
}

// ── Call Control REST helpers ─────────────────────────────────────────────
async function answerCall(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
    method: "POST",
    headers: authHeaders(apiKey),
  });
}

async function speakText(
  apiKey: string,
  callControlId: string,
  text: string,
  stage: "greeting" | "announcement",
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      payload: text,
      voice: TTS_VOICE,
      language: "en-US",
      client_state: encodeClientState({ speak_stage: stage }),
      command_id: `router-${stage}-${Date.now()}`,
    }),
  });
}

async function gatherUsingAi(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/gather_using_ai`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      parameters: {
        type: "object",
        properties: {
          utterance: {
            type: "string",
            description: "The caller's spoken response, transcribed verbatim.",
          },
        },
        required: ["utterance"],
      },
      assistant: {
        model: process.env.AI_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct",
        instructions:
          "You are a one-turn speech capture component. Capture exactly what the caller says in the utterance field. Do not ask follow-up questions or give advice.",
      },
      transcription: { language: "en" },
      user_response_timeout_ms: 15000,
    }),
  });
}

async function transferCall(
  apiKey: string,
  callControlId: string,
  destination: string,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/transfer`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      to: destination,
      timeout_secs: 30,
    }),
  });
}

// ── Entrypoint ─────────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Health ───────────────────────────────────────────────────────────
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    // ── Voice webhook ────────────────────────────────────────────────────
    if (url.pathname === "/webhook" && req.method === "POST") {
      return handleVoiceWebhook(req, env);
    }

    // ── Admin: list routes ──────────────────────────────────────────────
    if (url.pathname === "/routes" && req.method === "GET") {
      return handleListRoutes(env);
    }

    // ── Admin: set a route ──────────────────────────────────────────────
    if (url.pathname === "/routes" && req.method === "POST") {
      return handleSetRoute(req, env);
    }

    // ── Debug: actor state ──────────────────────────────────────────────
    if (url.pathname === "/debug/state" && req.method === "GET") {
      const callControlId = url.searchParams.get("call_control_id");
      if (!callControlId) {
        return Response.json({ error: "call_control_id query param is required" }, { status: 400 });
      }
      const stub = env.ROUTER.idFromName(actorName(callControlId));
      try {
        const state = await stub.getDebugState();
        return Response.json(state);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "failed to get state";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};

// ── Voice webhook handler ─────────────────────────────────────────────────
async function handleVoiceWebhook(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const event = (body as { data?: Record<string, unknown> })?.data;
  const eventType = event?.event_type as string | undefined;
  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  if (!eventType) {
    return Response.json({ error: "no event_type in payload" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (e) {
    const message = e instanceof Error ? e.message : "secrets not configured";
    return Response.json({ error: message }, { status: 500 });
  }

  const callControlId = payload.call_control_id as string;
  if (!callControlId) {
    return Response.json({ error: "no call_control_id in payload" }, { status: 400 });
  }
  const stub = env.ROUTER.idFromName(actorName(callControlId));

  // ── call.initiated (inbound only) ───────────────────────────────────
  if (eventType === "call.initiated") {
    const direction = payload.direction as string;
    if (direction !== "incoming") {
      // Outbound legs (transfer destinations) are not routed — ignore them.
      return Response.json({ action: "ignored_outbound" });
    }
    const from = (payload.from as string) || "unknown";
    const to = (payload.to as string) || "unknown";
    await stub.recordStart(callControlId, from, to);
    const answerResp = await answerCall(apiKey, callControlId);
    if (!answerResp.ok) {
      const errBody = await answerResp.text();
      return Response.json(
        { action: "error", step: "answer", status: answerResp.status, err: errBody.slice(0, 200) },
        { status: 502 },
      );
    }
    return Response.json({ action: "answering", callControlId });
  }

  // ── call.answered → play greeting ──────────────────────────────────
  if (eventType === "call.answered") {
    await stub.setGreeting();
    const speakResp = await speakText(apiKey, callControlId, GREETING, "greeting");
    if (!speakResp.ok) {
      const errBody = await speakResp.text();
      return Response.json(
        { action: "error", step: "greeting_speak", status: speakResp.status, err: errBody.slice(0, 200) },
        { status: 502 },
      );
    }
    return Response.json({ action: "greeting" });
  }

  // ── call.speak.ended → branch on stage (greeting → gather, announcement → transfer)
  if (eventType === "call.speak.ended") {
    const speakStage = decodeClientState(payload.client_state).speak_stage;
    if (speakStage === "greeting") {
      await stub.setGathering();
      const gatherResp = await gatherUsingAi(apiKey, callControlId);
      if (!gatherResp.ok) {
        const errBody = await gatherResp.text();
        return Response.json(
          { action: "error", step: "gather_using_ai", status: gatherResp.status, err: errBody.slice(0, 200) },
          { status: 502 },
        );
      }
      return Response.json({ action: "gathering" });
    }
    if (speakStage === "announcement") {
      // Announcement finished — fire the transfer to the stashed destination.
      const state = await stub.getDebugState();
      await stub.setTransferring();
      const transferResp = await transferCall(apiKey, callControlId, state.destination);
      if (!transferResp.ok) {
        const errBody = await transferResp.text();
        return Response.json(
          { action: "error", step: "transfer", status: transferResp.status, err: errBody.slice(0, 200) },
          { status: 502 },
        );
      }
      return Response.json({ action: "transferring", destination: state.destination, intent: state.intent });
    }
    return Response.json({ action: "ignored_speak_ended", speak_stage: speakStage });
  }

  // ── call.ai_gather.ended → classify + announce ──────────────────────
  if (eventType === "call.ai_gather.ended") {
    // Read the transcript: prefer payload.result.utterance, fall back to message_history.
    const result = (payload.result ?? {}) as Record<string, unknown>;
    let speech = "";
    if (result && typeof result.utterance === "string") {
      speech = result.utterance.trim();
    }
    if (!speech) {
      const history = (payload.message_history ?? []) as Array<{ role?: string; content?: string }>;
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.role === "user" && msg?.content) {
          speech = msg.content.trim();
          break;
        }
      }
    }

    // Classify (Telnyx AI Inference) + look up destination (Telnyx KV) — both zero-credential.
    const { intent, destination } = await stub.classifyAndRoute(speech);

    // Speak the announcement, then transfer on the next call.speak.ended.
    await stub.setAnnouncing(intent, destination);
    const announcement = `Got it. Transferring you to ${intent}. Please hold.`;
    const speakResp = await speakText(apiKey, callControlId, announcement, "announcement");
    if (!speakResp.ok) {
      // If the announcement can't play, transfer immediately so the caller isn't stranded.
      const transferResp = await transferCall(apiKey, callControlId, destination);
      return Response.json({
        action: "transfer_fallback",
        intent,
        destination,
        speak_status: speakResp.status,
        transfer_status: transferResp.status,
      });
    }
    return Response.json({ action: "announcing", intent, destination });
  }

  // ── call.ai_gather.failed → fallback announce + transfer ────────────
  if (eventType === "call.ai_gather.failed") {
    const destination = env.DEFAULT_DESTINATION || "+17177247292";
    const intent = "support";
    await stub.setAnnouncing(intent, destination);
    const speakResp = await speakText(
      apiKey,
      callControlId,
      "I didn't catch that. Transferring you to support. Please hold.",
      "announcement",
    );
    if (!speakResp.ok) {
      await transferCall(apiKey, callControlId, destination);
    }
    return Response.json({ action: "announce_fallback", intent, destination });
  }

  // ── call.hangup → cleanup ───────────────────────────────────────────
  if (eventType === "call.hangup") {
    await stub.onHangup();
    return Response.json({ action: "done" });
  }

  return Response.json({ action: "noop", event: eventType });
}

// ── Admin: list routes from KV ─────────────────────────────────────────────
async function handleListRoutes(env: Env): Promise<Response> {
  try {
    const page = await env.ROUTES.list({ prefix: "route/" });
    const routes: Record<string, string> = {};
    for (const key of page.keys) {
      const value = await env.ROUTES.get(key.name);
      if (value) routes[key.name] = value;
    }
    return Response.json({ routes, count: Object.keys(routes).length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed to list routes";
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ── Admin: set a route in KV ───────────────────────────────────────────────
async function handleSetRoute(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }
  const { intent, destination } = (body ?? {}) as { intent?: string; destination?: string };
  if (!intent || !destination) {
    return Response.json(
      { error: "intent and destination are required (e.g. {\"intent\":\"billing\",\"destination\":\"+17177247292\"})" },
      { status: 400 },
    );
  }
  if (!/^(billing|sales|support)$/.test(intent)) {
    return Response.json({ error: "intent must be one of: billing, sales, support" }, { status: 400 });
  }
  try {
    await env.ROUTES.put(`route/${intent}`, destination);
    return Response.json({ ok: true, key: `route/${intent}`, destination });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "failed to set route";
    return Response.json({ error: msg }, { status: 500 });
  }
}
