export { ExportAgent } from "./exportAgent";
import type { ExportAgent } from "./exportAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type ExportStub = ActorStub &
  Pick<
    ExportAgent,
    | "start"
    | "countMessages"
    | "exportChunk"
    | "writeManifest"
    | "notifyComplete"
    | "getStatus"
    | "getSummary"
    | "addMessage"
    | "listMessages"
    | "getMessageCount"
  >;

interface ExportNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): ExportStub;
}

interface Env {
  EXPORT_AGENT: ExportNamespace;
  TELNYX_API_KEY: string;
  ALERT_PHONE: string;
  SENDER_PHONE: string;
  CHUNK_SIZE: string;
}

// Dapr-safe actor names: no "+", no special chars (RFC 1123 job-name-safe).
function actorName(id: string): string {
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}

// ── Telnyx Messaging webhook event types ─────────────────────────────────
interface MessagingEvent {
  data: {
    event_type: string;
    id: string;
    from: string;
    to: string;
    text: string;
    direction: "inbound" | "outbound";
    status: string;
    timestamp: string;
  };
  meta: {
    attempt: number;
    delivered_at: string;
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Health ─────────────────────────────────────────────────────────
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    // ── Messaging webhook handler (ingests SMS into SQL DB) ───────────
    if (req.method === "POST" && url.pathname === "/webhooks/messaging") {
      return handleMessagingWebhook(req, env);
    }

    // ── Start an export ────────────────────────────────────────────────
    if (req.method === "POST" && url.pathname === "/export") {
      return handleStartExport(req, env);
    }

    // ── Get export status ──────────────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/export/")) {
      const exportId = url.pathname.split("/export/")[1];
      if (!exportId) return Response.json({ error: "missing export id" }, { status: 400 });

      try {
        const summary = await env.EXPORT_AGENT.idFromName(actorName(exportId)).getSummary();
        return Response.json(summary);
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to get status" }, { status: 500 });
      }
    }

    // ── List messages in the SQL DB ────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/messages") {
      try {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const messages = await env.EXPORT_AGENT.idFromName("shared").listMessages(limit);
        return Response.json({ messages, count: messages.length });
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to list messages" }, { status: 500 });
      }
    }

    // ── Get message count ──────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/messages/count") {
      try {
        const count = await env.EXPORT_AGENT.idFromName("shared").getMessageCount();
        return Response.json({ count });
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to count" }, { status: 500 });
      }
    }

    // ── Seed sample messages (for testing) ─────────────────────────────
    if (req.method === "POST" && url.pathname === "/seed") {
      return handleSeed(req, env);
    }

    // ── Simulate a large dataset (for testing 10k+ messages) ────────────
    if (req.method === "POST" && url.pathname === "/simulate-bulk") {
      return handleSimulateBulk(req, env);
    }

    return new Response("not found", { status: 404 });
  },
};

// ── Export handler ────────────────────────────────────────────────────────
async function handleStartExport(req: Request, env: Env): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      conversationFilter?: string;
    };

    const exportId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentId = actorName(exportId);

    await env.EXPORT_AGENT.idFromName(agentId).start({
      exportId,
      conversationFilter: body.conversationFilter ?? null,
    });

    return Response.json({
      action: "export_started",
      exportId,
      statusUrl: `/export/${exportId}`,
      messagesUrl: "/messages",
      note: "The export is running in the background. Check statusUrl for progress.",
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "failed to start export" }, { status: 500 });
  }
}

// ── Messaging webhook handler ─────────────────────────────────────────────
async function handleMessagingWebhook(req: Request, env: Env): Promise<Response> {
  try {
    const event = (await req.json()) as MessagingEvent;
    const data = event.data;
    const eventType = data.event_type;

    if (eventType === "message.received" || eventType === "message.sent") {
      await env.EXPORT_AGENT.idFromName("shared").addMessage({
        fromNumber: data.from,
        toNumber: data.to,
        body: data.text,
        direction: data.direction,
      });
    }

    return Response.json({ received: true, eventType });
  } catch (e: any) {
    return Response.json({ error: e?.message || "webhook failed" }, { status: 500 });
  }
}

// ── Seed handler ──────────────────────────────────────────────────────────
async function handleSeed(req: Request, env: Env): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      from?: string;
      to?: string;
      body?: string;
      direction?: "inbound" | "outbound";
    };

    if (!body.from || !body.to || !body.body) {
      return Response.json(
        { error: "Missing fields: from, to, body, direction" },
        { status: 400 },
      );
    }

    const result = await env.EXPORT_AGENT.idFromName("shared").addMessage({
      fromNumber: body.from,
      toNumber: body.to,
      body: body.body,
      direction: body.direction || "inbound",
    });

    return Response.json({
      action: "seeded",
      messageId: result.id,
      messagesUrl: "/messages",
      countUrl: "/messages/count",
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "seed failed" }, { status: 500 });
  }
}

// ── Bulk simulate handler (for testing large datasets) ────────────────────
async function handleSimulateBulk(req: Request, env: Env): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      count?: number;
    };

    const count = body.count ?? 10000;

    if (count > 100000) {
      return Response.json({ error: "Max 100,000 messages per bulk simulate" }, { status: 400 });
    }

    // Add messages in batches to avoid blocking
    const agent = env.EXPORT_AGENT.idFromName("shared");
    const batchSize = 500;
    const batches = Math.ceil(count / batchSize);

    // Use a placeholder phone numbers — no real numbers
    const fromNum = "+18005551234";
    const toNum = "+18005559876";
    const messages = [
      "Test message from bulk simulate",
      "Conversation export pipeline test",
      "Edge Compute SQL DB performance check",
      "Chunked export verification",
      "Cloud Storage upload test",
    ];

    for (let b = 0; b < batches; b++) {
      const batchCount = Math.min(batchSize, count - b * batchSize);
      for (let i = 0; i < batchCount; i++) {
        const msg = messages[Math.floor(Math.random() * messages.length)];
        const direction: "inbound" | "outbound" = Math.random() > 0.5 ? "inbound" : "outbound";
        await agent.addMessage({
          fromNumber: direction === "outbound" ? fromNum : toNum,
          toNumber: direction === "outbound" ? toNum : fromNum,
          body: `${msg} #${b * batchSize + i + 1}`,
          direction,
        });
      }
    }

    return Response.json({
      action: "bulk_simulated",
      count,
      messagesUrl: "/messages",
      countUrl: "/messages/count",
      note: "Now POST /export to start the chunked export pipeline.",
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || "bulk simulate failed" }, { status: 500 });
  }
}
