import demoHtml from "./demo-html.js";
import { StreamingAgent } from "./streaming-agent.js";

export { StreamingAgent };

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function sessionIdFromUrl(url: URL): string {
  const raw = url.searchParams.get("session") ?? "demo";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "demo";
}

/**
 * Telnyx Edge Compute worker.
 *
 * - `GET /` serves the streaming chat demo page.
 * - WebSocket upgrades (`/websocket?session=<id>`) are routed to that
 *   session's `StreamingAgent`; the platform completes the upgrade and the
 *   agent's built-in connection surface speaks the agent protocol
 *   (state / messages / events streams + `stub.send()` RPC).
 * - `POST /api/agents` creates-or-gets a session and returns its state.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if ((request.headers.get("upgrade") ?? "").toLowerCase() === "websocket") {
      const sessionId = sessionIdFromUrl(url);
      return env.AGENTS.idFromName(sessionId).fetch(request);
    }

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(demoHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/agents" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { session?: string };
      const sessionId = sessionIdFromUrl(new URL(`http://x/?session=${encodeURIComponent(body.session ?? "demo")}`));
      const stub = env.AGENTS.idFromName(sessionId);
      const state = await stub.currentState();
      return json({ session: sessionId, state }, { status: 201 });
    }

    return json({ error: "Not found" }, { status: 404 });
  },
};
