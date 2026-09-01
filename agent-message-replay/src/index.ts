/**
 * Front door for the agent-message-replay Edge function.
 *
 * Routes:
 *   GET  /            → demo UI (when DEMO_MODE=true)
 *   GET  /health      → liveness + config summary
 *   POST /ingest      → store a conversation recording (JSON, zod-validated)
 *   WS   /ws?conv=id  → live replay stream (forwarded to the ReplayAgent)
 *
 * WebSocket upgrades are forwarded to the actor via the stub — the runtime
 * splices the 101 handshake through to the agent's webSocket() handler.
 */
import { ReplayAgent } from "./replay-agent.js";
import { demoHtml, BRAND_VERSION } from "./demo-html.js";
import { parseRecording } from "./script.js";
import { ZodError } from "zod";
import { DEMO_CONVERSATION_ID } from "./demo-script.js";
import type { ReplayEnv } from "./types.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function demoUiEnabled(env: ReplayEnv): boolean {
  return (env.DEMO_MODE ?? "true") !== "false";
}

export default {
  async fetch(request: Request, env: ReplayEnv): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        demo: demoUiEnabled(env),
        model: env.MODEL ?? "zai-org/GLM-5.2",
        brand: BRAND_VERSION,
      });
    }

    if (request.method === "GET" && url.pathname === "/" && demoUiEnabled(env)) {
      return new Response(demoHtml(env), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    // Live replay stream: hand the upgrade to the conversation's actor. The
    // runtime detects the upgrade and dials the actor's webSocket() handler.
    if (url.pathname === "/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const conversationId =
        url.searchParams.get("conv") ?? DEMO_CONVERSATION_ID;
      const stub = env.REPLAY.idFromName(conversationId);
      return stub.fetch(request);
    }

    if (request.method === "POST" && url.pathname === "/ingest") {
      return handleIngest(request, env);
    }

    return json({ error: "not found" }, 404);
  },
};

async function handleIngest(request: Request, env: ReplayEnv): Promise<Response> {
  // Optional demo gate: set INGEST_TOKEN to require `Authorization: Bearer …`.
  const ingestToken = env.INGEST_TOKEN;
  if (ingestToken) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${ingestToken}`) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "request body must be valid JSON" }, 400);
  }

  let parsed;
  try {
    parsed = parseRecording(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return json({ error: "invalid recording", issues: error.issues }, 400);
    }
    return json({ error: "invalid recording" }, 400);
  }

  const stub = env.REPLAY.idFromName(parsed.conversation_id);
  try {
    const result = await stub.ingest(parsed);
    return json({
      ok: true,
      conversation_id: parsed.conversation_id,
      total: result.total,
      ws_url: `/ws?conv=${encodeURIComponent(parsed.conversation_id)}`,
    });
  } catch {
    // Production-safe: generic failure, no internal details.
    return json({ error: "failed to store recording" }, 502);
  }
}

export { ReplayAgent };
