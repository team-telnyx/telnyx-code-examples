export { TriageAgent, routeKey, getRouteFromKv, getAllRoutesFromKv, putRouteToKv } from "./triageAgent";
import type { TriageAgent } from "./triageAgent";
import { getAllRoutesFromKv, putRouteToKv } from "./triageAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type TriageAgentStub = ActorStub &
  Pick<
    TriageAgent,
    | "triage"
    | "getHistory"
    | "getDebugState"
  >;

interface TriageAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): TriageAgentStub;
}

interface Env {
  TRIAGE: TriageAgentNamespace;
  KV_NAMESPACE_ID: string;
}

function actorName(e164: string): string {
  return e164.replace(/[^0-9a-zA-Z.-]/g, "");
}

function getApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
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

    // ── POST /webhooks/sms — inbound SMS from customer ──────────────
    if (req.method === "POST" && (url.pathname === "/webhooks/sms" || url.pathname === "/")) {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const evt = body?.data;
        if (!evt || evt.event_type !== "message.received") {
          return Response.json({ error: "unexpected event_type" }, { status: 400 });
        }
        const payload = evt.payload || {};
        const from = (payload.from?.phone_number || payload.from) as string;
        const to = (payload.to?.[0]?.phone_number || payload.to?.[0] || payload.to) as string;
        const text = (payload.text || "") as string;

        if (!from || !text.trim()) {
          return Response.json({ error: "missing from or text" }, { status: 400 });
        }

        // Read routes from KV
        const routes = await getAllRoutesFromKv(kvNamespaceId, apiKey);
        const stub = env.TRIAGE.idFromName(actorName(String(to)));
        const result = await stub.triage(String(from), String(text), routes);
        return Response.json({ action: "triaged", from, to, ...result });
      } catch (e: any) {
        return Response.json({ error: e?.message || "bad request" }, { status: 500 });
      }
    }

    // ── POST /routes — update a route in KV ─────────────────────────
    if (url.pathname === "/routes" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        topic?: string;
        queue?: string;
      };

      const topic = body.topic?.trim();
      const queue = body.queue?.trim();

      if (!topic || !queue) {
        return Response.json({ error: "topic and queue are required" }, { status: 400 });
      }

      await putRouteToKv(kvNamespaceId, apiKey, topic, queue);
      return Response.json({ topic, queue, stored: "kv" });
    }

    // ── GET /routes — list the route table from KV ──────────────────
    if (url.pathname === "/routes" && req.method === "GET") {
      const routes = await getAllRoutesFromKv(kvNamespaceId, apiKey);
      return Response.json({ routes, namespace: kvNamespaceId });
    }

    // ── GET /history — get triage history ───────────────────────────
    if (url.pathname === "/history" && req.method === "GET") {
      const number = url.searchParams.get("number") || "+16282564655";
      const limit = parseInt(url.searchParams.get("limit") || "20", 10);
      const stub = env.TRIAGE.idFromName(actorName(number));
      const history = await stub.getHistory(limit);
      return Response.json({ number, ...history });
    }

    // ── POST /debug/triage — simulate an inbound SMS ────────────────
    if (url.pathname === "/debug/triage" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as {
        from?: string;
        to?: string;
        text?: string;
      };

      const from = body.from?.trim() || "+17177247292";
      const to = body.to?.trim() || "+16282564655";
      const text = body.text?.trim() || "I need help with my bill";

      const routes = await getAllRoutesFromKv(kvNamespaceId, apiKey);
      const stub = env.TRIAGE.idFromName(actorName(to));
      const result = await stub.triage(from, text, routes);
      return Response.json({ action: "triaged", from, to, text, ...result });
    }

    // ── GET /debug/state — inspect actor state + KV routes ─────────
    if (url.pathname === "/debug/state" && req.method === "GET") {
      const number = url.searchParams.get("number") || "+16282564655";
      const stub = env.TRIAGE.idFromName(actorName(number));
      try {
        const state = await stub.getDebugState();
        const routes = await getAllRoutesFromKv(kvNamespaceId, apiKey);
        return Response.json({ ...state, routes, kvNamespace: kvNamespaceId });
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to get state" }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};
