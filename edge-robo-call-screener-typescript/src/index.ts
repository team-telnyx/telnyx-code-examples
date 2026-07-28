// Re-export the actor class so it ships with the bundle.
export { CallScreener } from "./callScreener";
import type { CallScreener } from "./callScreener";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type CallScreenerStub = ActorStub &
  Pick<
    CallScreener,
    | "recordCall"
    | "markForwarded"
    | "markBlocked"
    | "markHungup"
    | "setTranscript"
    | "isBlocklisted"
    | "listCalls"
    | "getCallStats"
    | "clearBlocklist"
  >;

interface CallScreenerNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): CallScreenerStub;
}

interface Env {
  CALL_SCREENER: CallScreenerNamespace;
  TELNYX_API_KEY: string;
  TELNYX_PHONE_NUMBER: string;
  FORWARD_TO_NUMBER: string;
  AI_MODEL: string;
}

const TELNYX_API = "https://api.telnyx.com/v2";
const SCREENING_QUESTION =
  "Hi, this number is screened by AI. In one sentence, who are you and why are you calling?";

// ─── Telnyx API helpers ───────────────────────────────────────────────

function authHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.TELNYX_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function answerCall(env: Env, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
    method: "POST",
    headers: authHeaders(env),
  });
}

async function gatherUsingSpeak(
  env: Env,
  callControlId: string,
  text: string,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/gather_using_speak`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({
      payload: text,
      voice: "female",
      language: "en-US",
      maximum_duration: 10000,
      timeout: 15,
    }),
  });
}

async function hangupCall(env: Env, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/hangup`, {
    method: "POST",
    headers: authHeaders(env),
  });
}

async function transferCall(
  env: Env,
  callControlId: string,
  to: string,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/transfer`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({ to }),
  });
}

async function rejectCall(env: Env, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/reject`, {
    method: "POST",
    headers: authHeaders(env),
  });
}

// ─── AI Inference ─────────────────────────────────────────────────────

async function judgeResponse(
  env: Env,
  transcript: string,
): Promise<{
  verdict: "robocall" | "legitimate" | "unknown";
  confidence: number;
  reason: string;
}> {
  const systemPrompt = `You are a robocall detection engine. Analyze the caller's spoken response to the screening question "Who are you and why are you calling?". Classify the response:
- robocall: prerecorded, generic, sales pitch, no real human engagement, robotic tone
- legitimate: a real person responding naturally, specific reason, conversational
- unknown: can't tell, too short, or ambiguous

Return JSON only: {"verdict": "robocall"|"legitimate"|"unknown", "confidence": 0.0-1.0, "reason": "one sentence"}`;

  const resp = await fetch(`${TELNYX_API}/ai/chat/completions`, {
    method: "POST",
    headers: authHeaders(env),
    body: JSON.stringify({
      model: env.AI_MODEL || "moonshotai/Kimi-K2.6",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Caller response: "${transcript}"` },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  });

  if (!resp.ok) {
    throw new Error(`inference failed: ${resp.status}`);
  }

  const data = (await resp.json()) as any;
  let content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return { verdict: "unknown", confidence: 0, reason: "no content from model" };
  }
  content = content.trim();
  if (content.startsWith("```")) {
    content = content.split("\n").slice(1).join("\n").replace(/```/g, "").trim();
  }
  try {
    return JSON.parse(content);
  } catch {
    return { verdict: "unknown", confidence: 0, reason: "unparseable response" };
  }
}

// ─── Fetch handler ───────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Health checks
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    // ── Telnyx voice webhook ─────────────────────────────────────────
    if (url.pathname === "/webhooks/voice" && req.method === "POST") {
      return handleVoiceWebhook(req, env);
    }

    // ── Stats ────────────────────────────────────────────────────────
    if (url.pathname === "/stats" && req.method === "GET") {
      const number = url.searchParams.get("number") || env.TELNYX_PHONE_NUMBER;
      const stub = env.CALL_SCREENER.idFromName(number);
      const stats = await stub.getCallStats();
      return Response.json({ number, ...stats });
    }

    // ── Recent calls ─────────────────────────────────────────────────
    if (url.pathname === "/calls" && req.method === "GET") {
      const number = url.searchParams.get("number") || env.TELNYX_PHONE_NUMBER;
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      const stub = env.CALL_SCREENER.idFromName(number);
      const calls = await stub.listCalls(limit);
      return Response.json({ calls });
    }

    // ── Clear blocklist ──────────────────────────────────────────────
    if (url.pathname === "/blocklist/clear" && req.method === "POST") {
      const number = url.searchParams.get("number") || env.TELNYX_PHONE_NUMBER;
      const stub = env.CALL_SCREENER.idFromName(number);
      const stats = await stub.clearBlocklist();
      return Response.json({ number, ...stats });
    }

    return new Response("not found", { status: 404 });
  },
};

// ─── Webhook handler ─────────────────────────────────────────────────

async function handleVoiceWebhook(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as any;
  const event = body?.data;
  const eventType = event?.event_type;
  const payload = event?.payload ?? {};

  const stub = env.CALL_SCREENER.idFromName(payload.to || env.TELNYX_PHONE_NUMBER);

  // ── call.answered ────────────────────────────────────────────────
  if (eventType === "call.answered") {
    const callControlId = payload.call_control_id;
    const from = payload.from || "unknown";
    const to = payload.to || env.TELNYX_PHONE_NUMBER;

    // Auto-reject if caller is on the blocklist
    if (await stub.isBlocklisted(from)) {
      await rejectCall(env, callControlId);
      await stub.recordCall(callControlId, from, to);
      await stub.markBlocked(callControlId, "robocall", 1.0, "blocklist match", from);
      return Response.json({ action: "rejected", reason: "blocklist" });
    }

    // Record the call and ask the screening question
    await stub.recordCall(callControlId, from, to);
    await answerCall(env, callControlId);
    await gatherUsingSpeak(env, callControlId, SCREENING_QUESTION);
    return Response.json({ action: "screening" });
  }

  // ── call.gather.ended ────────────────────────────────────────────
  if (eventType === "call.gather.ended") {
    const callControlId = payload.call_control_id;
    const from = payload.from || "unknown";
    const speech = payload.speech;
    const transcript = speech?.result || speech?.text || "";

    if (!transcript || transcript.trim().length < 2) {
      // No usable speech — hang up
      await hangupCall(env, callControlId);
      await stub.markBlocked(callControlId, "unknown", 0.5, "no speech detected", from);
      return Response.json({ action: "hungup", reason: "no speech" });
    }

    await stub.setTranscript(callControlId, transcript);

    // AI judges the response
    const judgment = await judgeResponse(env, transcript);

    if (judgment.verdict === "robocall" && judgment.confidence >= 0.7) {
      await hangupCall(env, callControlId);
      await stub.markBlocked(
        callControlId,
        judgment.verdict,
        judgment.confidence,
        judgment.reason,
        from,
      );
      return Response.json({ action: "blocked", judgment });
    }

    // Legitimate or unknown — forward to the human
    await transferCall(env, callControlId, env.FORWARD_TO_NUMBER);
    await stub.markForwarded(callControlId);
    return Response.json({ action: "forwarded", judgment });
  }

  // ── call.hangup ──────────────────────────────────────────────────
  if (eventType === "call.hangup") {
    const callControlId = payload.call_control_id;
    await stub.markHungup(callControlId);
    return Response.json({ action: "hungup" });
  }

  return Response.json({ action: "noop", event: eventType });
}
