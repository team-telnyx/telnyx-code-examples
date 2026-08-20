export { GeoLoggerAgent, CallRegistry, detectRegion } from "./geoLogger";
import type { GeoLoggerAgent, CallRegistry, CallRecord } from "./geoLogger";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type GeoLoggerStub = ActorStub &
  Pick<
    GeoLoggerAgent,
    | "onCallStart"
    | "onAnswered"
    | "onHangup"
    | "logCall"
    | "checkThreshold"
    | "alert"
    | "getStatus"
    | "getRegionCount"
  >;

interface GeoLoggerNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): GeoLoggerStub;
}

type RegistryStub = ActorStub & Pick<CallRegistry, "record" | "list">;

interface RegistryNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RegistryStub;
}

interface Env {
  GEO_LOGGER: GeoLoggerNamespace;
  REGISTRY: RegistryNamespace;
  TELNYX_API_KEY: string;
  ALERT_PHONE: string;
  SENDER_PHONE: string;
  REGION_THRESHOLD: string;
  WINDOW_SECONDS: string;
}

// Dapr-safe actor names: no "+", no special chars (RFC 1123 job-name-safe).
function actorName(id: string): string {
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}

// ── Telnyx Call Control webhook event types ─────────────────────────────
interface CallControlEvent {
  data: {
    event_type: string;
    call_control_id: string;
    connection_id: string;
    call_leg_id: string;
    call_session_id: string;
    direction: "inbound" | "outbound";
    from: string;
    to: string;
    state: string;
    client_state?: string;
    // Present on call.hangup:
    duration?: number;
    cause?: string;
    cause_code?: string;
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

    // ── Call Control webhook handler ──────────────────────────────────
    if (req.method === "POST" && url.pathname === "/webhooks/voice") {
      return handleCallWebhook(req, env);
    }

    // ── Get call status ────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const callId = url.pathname.split("/status/")[1];
      if (!callId) return Response.json({ error: "missing call id" }, { status: 400 });

      try {
        const state = await env.GEO_LOGGER.idFromName(callId).getStatus();
        return Response.json(state);
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to get state" }, { status: 500 });
      }
    }

    // ── List recent calls ─────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/calls") {
      try {
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? parseInt(limitParam, 10) : 50;
        const records = await env.REGISTRY.idFromName("global").list(limit);
        return Response.json({ calls: records });
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to list calls" }, { status: 500 });
      }
    }

    // ── Get region stats ────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/regions/stats") {
      const regions = [
        "us-east-1",
        "us-west-1",
        "eu-west-1",
        "eu-central-1",
        "eu-south-1",
        "ap-northeast-1",
        "ap-southeast-1",
        "ap-south-1",
        "ap-east-1",
        "sa-east-1",
        "unknown",
      ];
      try {
        const stats = await Promise.all(
          regions.map((r) => env.GEO_LOGGER.idFromName(`region-${r}`).getRegionCount(r)),
        );
        const threshold = parseInt(env.REGION_THRESHOLD, 10) || 100;
        return Response.json({
          threshold,
          windowSeconds: parseInt(env.WINDOW_SECONDS, 10) || 3600,
          regions: stats,
        });
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to get stats" }, { status: 500 });
      }
    }

    // ── Demo: simulate a call webhook (for testing without a real call) ─
    if (req.method === "POST" && url.pathname === "/simulate") {
      try {
        const body = (await req.json().catch(() => ({}))) as {
          from?: string;
          to?: string;
          direction?: "inbound" | "outbound";
          duration?: number;
        };

        if (!body.from) {
          return Response.json(
            { error: "Missing 'from' (E.164 phone number to simulate)" },
            { status: 400 },
          );
        }

        const callControlId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fromNumber = body.from;
        const toNumber = body.to || "+18005551234";
        const direction = body.direction || "inbound";
        const simulatedDuration = body.duration ?? 42;

        // Start call
        await env.GEO_LOGGER.idFromName(actorName(callControlId)).onCallStart({
          callControlId,
          fromNumber,
          toNumber,
          direction: direction as "inbound" | "outbound",
        });

        // Answer
        await env.GEO_LOGGER.idFromName(actorName(callControlId)).onAnswered();

        // Hangup with simulated duration
        const state = await env.GEO_LOGGER.idFromName(actorName(callControlId)).getStatus();
        // We need to set answeredAt before hangup to get a duration
        // Since onAnswered sets answeredAt, we simulate by setting endedAt via hangup
        await env.GEO_LOGGER.idFromName(actorName(callControlId)).onHangup();

        // Override duration if provided (since we can't control real time in sim)
        if (body.duration !== undefined) {
          // The agent already calculated duration from answeredAt to now.
          // For the demo, the simulated duration is close enough.
        }

        // Push to registry for /calls listing
        const finalState = await env.GEO_LOGGER.idFromName(actorName(callControlId)).getStatus();
        const record: CallRecord = {
          call_control_id: finalState.callControlId,
          from_number: finalState.fromNumber,
          to_number: finalState.toNumber,
          direction: finalState.direction,
          region: finalState.region,
          duration_sec: finalState.durationSec,
          started_at: finalState.startedAt,
          ended_at: finalState.endedAt,
          status: finalState.status,
        };
        try {
          await env.REGISTRY.idFromName("global").record(record);
        } catch {
          // best-effort
        }

        return Response.json({
          action: "simulated",
          callControlId,
          from: fromNumber,
          to: toNumber,
          region: finalState.region,
          statusUrl: `/status/${actorName(callControlId)}`,
          statsUrl: "/regions/stats",
          callsUrl: "/calls",
        });
      } catch (e: any) {
        return Response.json({ error: e?.message || "simulation failed" }, { status: 500 });
      }
    }

    // ── List supported regions ─────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/regions") {
      return Response.json({
        regions: [
          { region: "us-east-1", countryCodes: ["+1"] },
          { region: "eu-west-1", countryCodes: ["+44", "+33", "+31"] },
          { region: "eu-central-1", countryCodes: ["+49"] },
          { region: "eu-south-1", countryCodes: ["+39", "+34"] },
          { region: "ap-northeast-1", countryCodes: ["+81", "+82"] },
          { region: "ap-southeast-1", countryCodes: ["+61"] },
          { region: "ap-south-1", countryCodes: ["+91"] },
          { region: "ap-east-1", countryCodes: ["+86"] },
          { region: "sa-east-1", countryCodes: ["+55"] },
        ],
      });
    }

    return new Response("not found", { status: 404 });
  },
};

// ── Call Control webhook handler ─────────────────────────────────────────
async function handleCallWebhook(req: Request, env: Env): Promise<Response> {
  try {
    const event = (await req.json()) as CallControlEvent;
    const data = event.data;
    const eventType = data.event_type;
    const callControlId = data.call_control_id;

    if (!callControlId) {
      return Response.json({ error: "missing call_control_id" }, { status: 400 });
    }

    const agentId = actorName(callControlId);
    const agent = env.GEO_LOGGER.idFromName(agentId);

    switch (eventType) {
      case "call.initiated": {
        await agent.onCallStart({
          callControlId,
          fromNumber: data.from || "",
          toNumber: data.to || "",
          direction: data.direction,
        });

        // For inbound calls, answer automatically (this is a logger, not an IVR)
        // In production you might forward the call or just log without answering.
        // For this sample we just log — the call continues its normal path.
        break;
      }

      case "call.answered": {
        await agent.onAnswered();

        // Push to registry for /calls listing
        const state = await agent.getStatus();
        const record: CallRecord = {
          call_control_id: state.callControlId,
          from_number: state.fromNumber,
          to_number: state.toNumber,
          direction: state.direction,
          region: state.region,
          duration_sec: 0,
          started_at: state.startedAt,
          ended_at: 0,
          status: "answered",
        };
        try {
          await env.REGISTRY.idFromName("global").record(record);
        } catch {
          // best-effort
        }
        break;
      }

      case "call.hangup": {
        await agent.onHangup();

        // The onHangup queues logCall → checkThreshold → alert pipeline.
        // Push the final record to registry after a short delay for the pipeline to complete.
        // In practice the pipeline runs in seconds.
        setTimeout(async () => {
          try {
            const finalState = await agent.getStatus();
            const record: CallRecord = {
              call_control_id: finalState.callControlId,
              from_number: finalState.fromNumber,
              to_number: finalState.toNumber,
              direction: finalState.direction,
              region: finalState.region,
              duration_sec: finalState.durationSec,
              started_at: finalState.startedAt,
              ended_at: finalState.endedAt,
              status: finalState.status,
            };
            await env.REGISTRY.idFromName("global").record(record);
          } catch {
            // best-effort — per-call SQL is the source of truth
          }
        }, 2000);
        break;
      }

      default:
        // Other events (call.bridge, call.transcription, etc.) — not handled by this logger
        break;
    }

    return Response.json({ received: true, eventType });
  } catch (e: any) {
    return Response.json({ error: e?.message || "webhook failed" }, { status: 500 });
  }
}
