export { NetworkIncidentAgent } from "./incidentAgent";
import { demoHtml } from "./demoHtml";
import type { NetworkIncidentAgent, IncidentStatus } from "./incidentAgent";
import type { ActorNamespace, ActorStub, IdFromNameOptions } from "@telnyx/edge-runtime";

type IncidentStub = ActorStub & Pick<NetworkIncidentAgent,
  "initialize" | "transition" | "notify" | "generateRca" | "scheduleRecurrenceCheck" | "callContext" | "handleInboundCall" | "snapshot"
>;

interface IncidentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): IncidentStub;
}

interface Env {
  INCIDENT_AGENT: IncidentNamespace;
  TELNYX_API_KEY: string;
}

const TELNYX_API = "https://api.telnyx.com/v2";
const INCIDENT_ID = /^[A-Z0-9][A-Z0-9_-]{2,63}$/i;

function incident(env: Env, incidentId: string): IncidentStub {
  if (!INCIDENT_ID.test(incidentId)) throw new Error("incidentId must contain 3-64 letters, numbers, underscores, or hyphens");
  return env.INCIDENT_AGENT.idFromName(incidentId);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/") {
      return new Response(demoHtml(), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/health/liveness" || url.pathname === "/health/readiness") return new Response("ok");

    try {
      if (req.method === "POST" && url.pathname === "/api/demo") return runDemo(req, env);
      if (req.method === "GET" && url.pathname === "/api/incident") {
        const incidentId = requiredIncidentId(url.searchParams.get("incidentId"));
        return Response.json(await incident(env, incidentId).snapshot());
      }
      if (req.method === "POST" && url.pathname === "/api/incident") {
        const body = await jsonBody(req);
        const incidentId = requiredIncidentId(stringValue(body.incidentId));
        const result = await incident(env, incidentId).initialize({
          incidentId,
          title: stringValue(body.title) || "Regional packet loss",
          description: stringValue(body.description),
          affectedServices: stringArray(body.affectedServices),
          affectedCustomers: stringArray(body.affectedCustomers),
          liveMode: body.liveMode === true,
        });
        return Response.json(result, { status: 201 });
      }
      if (req.method === "POST" && url.pathname === "/api/transition") {
        const body = await jsonBody(req);
        const incidentId = requiredIncidentId(stringValue(body.incidentId));
        const status = stringValue(body.status) as IncidentStatus;
        if (!["detected", "investigating", "restoring", "resolved", "closed"].includes(status)) throw new Error("invalid incident status");
        return Response.json(await incident(env, incidentId).transition({
          status,
          description: stringValue(body.description) || undefined,
          notify: body.notify !== false,
        }));
      }
      if (req.method === "POST" && url.pathname === "/api/notify") {
        const body = await jsonBody(req);
        const incidentId = requiredIncidentId(stringValue(body.incidentId));
        return Response.json(await incident(env, incidentId).notify({ message: stringValue(body.message) }));
      }
      if (req.method === "POST" && url.pathname === "/api/rca") {
        const body = await jsonBody(req);
        const incidentId = requiredIncidentId(stringValue(body.incidentId));
        return Response.json(await incident(env, incidentId).generateRca({ rootCause: stringValue(body.rootCause) }));
      }
      if (req.method === "GET" && url.pathname === "/api/call-preview") {
        const incidentId = requiredIncidentId(url.searchParams.get("incidentId"));
        return Response.json(await incident(env, incidentId).callContext());
      }
      if (req.method === "POST" && url.pathname === "/webhooks/call") return handleCallWebhook(req, env);
    } catch (error: unknown) {
      return errorResponse(error);
    }

    return Response.json({
      name: "network-incident-agent",
      endpoints: ["POST /api/demo", "POST|GET /api/incident", "POST /api/transition", "POST /api/notify", "POST /api/rca", "GET /api/call-preview", "POST /webhooks/call"],
    }, { status: 404 });
  },
};

async function runDemo(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const incidentId = requiredIncidentId(stringValue(body.incidentId) || `INC-${Date.now().toString().slice(-6)}`);
  const paceMs = Math.max(0, Math.min(Number(body.paceMs ?? 900), 3000));
  const stub = incident(env, incidentId);
  await stub.initialize({
    incidentId,
    title: stringValue(body.title) || "Amsterdam edge packet loss",
    description: stringValue(body.description) || "Elevated packet loss is affecting voice and messaging traffic in the Amsterdam edge region.",
    affectedServices: stringArray(body.affectedServices).length ? stringArray(body.affectedServices) : ["Voice", "Messaging"],
    affectedCustomers: stringArray(body.affectedCustomers),
    liveMode: body.liveMode === true,
  });
  await pause(paceMs);
  await stub.notify({ message: `[Incident detected] ${incidentId}: We are investigating regional service degradation.` });
  await pause(paceMs);
  await stub.transition({ status: "investigating", description: "Operations isolated the fault to an edge routing path.", notify: true });
  await pause(paceMs);
  await stub.transition({ status: "restoring", description: "Traffic has been rerouted and service is recovering.", notify: true });
  await pause(paceMs);
  await stub.transition({ status: "resolved", description: "Traffic is stable on the redundant path.", notify: true });
  await pause(paceMs);
  const rca = await stub.generateRca({ rootCause: "A failed routing policy propagated an invalid next hop; automated rollback restored the last known-good policy." });
  const recurrenceTaskId = await stub.scheduleRecurrenceCheck(body.liveMode === true ? undefined : 30);
  return Response.json({ status: "complete", incidentId, rca, recurrenceTaskId, snapshot: await stub.snapshot() });
}

async function handleCallWebhook(req: Request, env: Env): Promise<Response> {
  const body = await jsonBody(req);
  const data = objectValue(body.data);
  const eventType = stringValue(data.event_type);
  if (eventType !== "call.initiated") return Response.json({ status: "ignored", eventType });
  const payload = objectValue(data.payload);
  const callControlId = stringValue(payload.call_control_id);
  const clientState = decodeClientState(stringValue(payload.client_state));
  const incidentId = requiredIncidentId(clientState.incidentId);
  if (!callControlId) throw new Error("call_control_id is required");
  if (!env.TELNYX_API_KEY) throw new Error("TELNYX_API_KEY is not configured");
  const context = await incident(env, incidentId).handleInboundCall();
  await telnyxAction(env.TELNYX_API_KEY, callControlId, "answer", {});
  await telnyxAction(env.TELNYX_API_KEY, callControlId, "speak", {
    payload: context.message,
    voice: "Telnyx.KokoroTTS.af",
    language: "en-US",
    command_id: `incident-${incidentId}-${Date.now()}`,
  });
  return Response.json({ status: "answered", incidentId });
}

async function telnyxAction(apiKey: string, callControlId: string, action: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${TELNYX_API}/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Telnyx ${action} failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
}

function decodeClientState(value: string): Record<string, string> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await req.json().catch(() => ({}));
  return objectValue(parsed);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function requiredIncidentId(value: string | null): string {
  const incidentId = (value || "").trim();
  if (!INCIDENT_ID.test(incidentId)) throw new Error("incidentId must contain 3-64 letters, numbers, underscores, or hyphens");
  return incidentId;
}

function pause(ms: number): Promise<void> {
  return ms ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const clientError = /required|invalid|must|not initialized|transition|live mode/.test(message);
  return Response.json({ error: message }, { status: clientError ? 400 : 500 });
}
