/**
 * Worker entry point — the per-connection front door.
 *
 * Routes Telnyx callbacks to the QAAgent actor for the call's agent:
 *   POST /webhook/call-conversation-ended  — transcript embedded in payload
 *   POST /webhook/transcription-saved      — fallback transcript source
 *   POST /demo/trigger                     — synthetic call, network-free demo
 *   GET  /health/liveness | /health/readiness
 *
 * The actor is born on first delivery via `env.QA_AGENT.idFromName(agentId)`;
 * one durable actor per agent. The agentId comes from
 * `data.metadata[CALL_METADATA_AGENT_KEY]` (set at call start on the agent's
 * desk number), falling back to `AGENT_NUMBER_MAP`, and finally to the called
 * number (digest suppressed in the fallback case). A payload without a
 * transcript is logged `no_transcript` and NOT scored — the
 * `transcription-saved` callback delivers the finalized transcript later.
 */

import type { QAAgentNamespace, TelnyxBinding } from "./agent";
import { DEFAULT_AGENT_KEY, resolveCall } from "./routing";

export { QAAgent } from "./agent";
export type { Env, QAAgentNamespace, QAAgentState, TelnyxBinding } from "./agent";

interface EnvShape {
  QA_AGENT: QAAgentNamespace;
  TELNYX: TelnyxBinding;
  SECRETS: { get: (handle: string) => Promise<string> };
}

const DEMO_TRANSCRIPT =
  "Agent: Thank you for calling Telnyx Support, this is Maya. How can I help you today? " +
  "Customer: I'm having trouble with my messaging deliverability. " +
  "Agent: I'd be happy to help with that. Before we make changes, I need to let you know this call may be recorded for quality purposes. " +
  "Let me check your account settings. I can see the issue — you need to verify your sender profile. I'll walk you through the steps. " +
  "Customer: Okay, sounds good. " +
  "Agent: First, go to the Telnyx Mission Control Portal and navigate to Messaging. Then select your profile and click verify. " +
  "Customer: Got it. " +
  "Agent: Great. Once verified, your messages should deliver properly. Is there anything else I can help with? " +
  "Customer: No, that's perfect. Thank you! " +
  "Agent: You're welcome. Have a great day!";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadNumberMap(
  env: EnvShape,
): Promise<Record<string, string> | null> {
  const raw = await env.SECRETS.get("AGENT_NUMBER_MAP");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, string>)
      : null;
  } catch {
    return null;
  }
}

/** Route a call transcript into the owning agent's QAAgent actor. */
async function routeToAgent(
  body: unknown,
  env: EnvShape,
  agentKey: string,
  numberMap: Record<string, string> | null,
): Promise<Response> {
  const resolved = resolveCall(body, agentKey, numberMap);
  if (!resolved) {
    // No transcript in the payload — do not score (no false zero). The
    // transcription-saved callback delivers the finalized transcript later.
    console.log("no_transcript: waiting for transcription-saved fallback");
    return json({ status: "no_transcript" });
  }

  const stub = env.QA_AGENT.idFromName(resolved.agentId);
  const outcome = await stub.recordCallEnded(
    resolved.callId,
    resolved.transcript,
    resolved.agentId,
    resolved.digestEnabled,
  );
  return json(outcome);
}

async function handleCallWebhook(req: Request, env: EnvShape): Promise<Response> {
  const body = (await req.json().catch(() => null)) as unknown;
  if (!body) return json({ error: "invalid_json" }, 400);

  const agentKey = (await env.SECRETS.get("CALL_METADATA_AGENT_KEY")) || DEFAULT_AGENT_KEY;
  const numberMap = await loadNumberMap(env);
  return routeToAgent(body, env, agentKey, numberMap);
}

async function handleDemoTrigger(req: Request, env: EnvShape): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const agentId = typeof body.agentId === "string" && body.agentId ? body.agentId : "demo-agent";
  const callId = typeof body.callId === "string" && body.callId ? body.callId : `demo_${Date.now()}`;
  const transcript =
    typeof body.transcript === "string" && body.transcript ? body.transcript : DEMO_TRANSCRIPT;

  // Synthesize a call-conversation-ended payload with the agent identity in
  // metadata so the demo actor gets digest capability.
  const agentKey = (await env.SECRETS.get("CALL_METADATA_AGENT_KEY")) || DEFAULT_AGENT_KEY;
  const synthetic = {
    data: {
      event: "call.conversation.ended",
      payload: {
        call_control_id: callId,
        called_number: "+15550000001",
        metadata: { [agentKey]: agentId },
        transcript,
      },
    },
  };
  const numberMap = await loadNumberMap(env);
  return routeToAgent(synthetic, env, agentKey, numberMap);
}

export default {
  async fetch(req: Request, env: EnvShape): Promise<Response> {
    const url = new URL(req.url);

    try {
      if (url.pathname === "/health/liveness") return new Response("ok");
      if (url.pathname === "/health/readiness") return new Response("ok");

      if (url.pathname === "/webhook/call-conversation-ended" && req.method === "POST") {
        return await handleCallWebhook(req, env);
      }
      if (url.pathname === "/webhook/transcription-saved" && req.method === "POST") {
        return await handleCallWebhook(req, env);
      }
      if (url.pathname === "/demo/trigger" && req.method === "POST") {
        return await handleDemoTrigger(req, env);
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      // Production-safe: log details server-side, return a generic message.
      console.log(`fetch_error: ${err instanceof Error ? err.message : "unknown"}`);
      return json({ error: "internal_error" }, 500);
    }
  },
};
