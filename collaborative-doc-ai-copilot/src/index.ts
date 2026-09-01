import docHtml from "./demo-html.js";
import { docIdFromUrl, sanitizeDocId, type Env } from "./types.js";

export { DocActor } from "./doc-actor.js";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function stubFor(env: Env, docId: string) {
  return env.DOCS.idFromName(docId);
}

/**
 * Telnyx Edge Compute worker.
 *
 * - `GET /` serves the collaborative editor page.
 * - WebSocket upgrades (`/websocket?doc=<id>`) are forwarded to the document
 *   actor; the platform completes the handshake and invokes the actor's
 *   `webSocket(ws, req)` handler.
 * - `/api/documents...` are thin REST wrappers over actor RPC calls.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade → route to the document actor.
    if ((request.headers.get("upgrade") ?? "").toLowerCase() === "websocket") {
      const docId = sanitizeDocId(docIdFromUrl(url));
      return stubFor(env, docId).fetch(request);
    }

    const path = url.pathname;

    if (path === "/" && request.method === "GET") {
      return new Response(docHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/api/documents" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { doc_id?: string };
      const docId = sanitizeDocId(body.doc_id ?? docIdFromUrl(url));
      const state = await stubFor(env, docId).touch();
      return json({ doc_id: docId, state }, { status: 201 });
    }

    // /api/documents/<id>[/suggest]
    const segments = path.split("/").filter(Boolean);
    if (segments[0] === "api" && segments[1] === "documents" && segments[2]) {
      const docId = sanitizeDocId(segments[2]);
      const stub = stubFor(env, docId);

      if (segments.length === 3 && request.method === "GET") {
        return json(await stub.snapshot());
      }

      if (segments.length === 4 && segments[3] === "suggest" && request.method === "POST") {
        const result = await stub.requestSuggestion();
        return json(result, { status: result.status === "rate_limited" ? 429 : 200 });
      }
    }

    return json({ error: "Not found" }, { status: 404 });
  },
};
