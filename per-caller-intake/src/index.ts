// Re-export the agent class and helpers so they ship with the bundle.
export { IntakeDossier } from "./dossier";
export * from "./dossier";
export type { DossierEnv, DossierNamespace } from "./dossier";

import type { DossierEnv, InitializationEvent } from "./dossier";
import {
  normalizePhoneDigits,
  parseInitializationEvent,
  verifyTelnyxSignature,
} from "./dossier";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function readJsonBody(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: DossierEnv): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/webhook/initialization" && req.method === "POST") {
      return handleInitializationWebhook(req, env);
    }

    if (url.pathname === "/webhook/post-conversation" && req.method === "POST") {
      return handlePostConversationWebhook(req, env);
    }

    const dossierMatch = url.pathname.match(/^\/dossier\/(\d{10,15})$/);
    if (dossierMatch && req.method === "GET") {
      const stub = env.DOSSIERS.idFromName(dossierMatch[1]);
      return json(await stub.dossierView());
    }

    return errorResponse("not found", 404);
  },
};

// ─── POST /webhook/initialization ────────────────────────────────────
// Telnyx AI Assistants POSTs here at conversation start when the assistant
// has `dynamic_variables_webhook_url` set. The delivery is Ed25519-signed;
// a missing or tampered signature is rejected (fail closed).

async function handleInitializationWebhook(req: Request, env: DossierEnv): Promise<Response> {
  const publicKey = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKey) {
    // Misconfiguration is not a reason to skip verification: fail closed and
    // let the assistant fall back to its defaults, never to an unverified body.
    return errorResponse("server not configured for webhook verification", 500);
  }

  const rawBody = await req.text();
  const signatureOk = await verifyTelnyxSignature(rawBody, req.headers, publicKey);
  if (!signatureOk) {
    return errorResponse("invalid webhook signature", 401);
  }

  const body = JSON.parse(rawBody) as unknown;
  const event: InitializationEvent | null = parseInitializationEvent(body);
  if (!event) {
    return errorResponse("expected an assistant.initialization event", 400);
  }

  const phoneDigits = normalizePhoneDigits(event.telnyx_end_user_target);
  if (!phoneDigits) {
    return errorResponse("missing or invalid telnyx_end_user_target", 400);
  }

  const lookbackDays = Math.max(1, parseInt(process.env.VISIT_LOOKBACK_DAYS || "365", 10) || 365);

  const stub = env.DOSSIERS.idFromName(phoneDigits);
  const vars = await stub.handleInitialization(lookbackDays);
  return json(vars);
}

// ─── POST /webhook/post-conversation ─────────────────────────────────
// The assistant's post-conversation wrap-up turn files the visit summary
// here via its webhook tool. Authenticates with the DOSSIER_WEBHOOK_AUTH
// secret (referenced in the assistant tool header as
// `Bearer {{#integration_secret}}dossier_webhook_auth{{/integration_secret}}`).
// A missing secret fails closed — the tool call never succeeds unauthenticated.

async function handlePostConversationWebhook(req: Request, env: DossierEnv): Promise<Response> {
  const expectedToken = process.env.DOSSIER_WEBHOOK_AUTH;
  if (!expectedToken) {
    return errorResponse("server not configured for webhook authentication", 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader !== `Bearer ${expectedToken}`) {
    return errorResponse("unauthorized", 401);
  }

  const body = await readJsonBody(req);
  const payload = (body ?? {}) as Record<string, unknown>;

  const target = typeof payload.telnyx_end_user_target === "string" ? payload.telnyx_end_user_target : "";
  const phoneDigits = normalizePhoneDigits(target);
  if (!phoneDigits) {
    return errorResponse("missing or invalid telnyx_end_user_target", 400);
  }

  const visitReason = typeof payload.visit_reason === "string" ? payload.visit_reason : "";
  const followUp = typeof payload.follow_up === "string" ? payload.follow_up : "";
  const nextStep = typeof payload.next_step === "string" ? payload.next_step : "";
  if (!visitReason || !nextStep) {
    return errorResponse("visit_reason and next_step are required", 400);
  }

  const stub = env.DOSSIERS.idFromName(phoneDigits);
  const result = await stub.fileVisitSummary({
    visit_reason: visitReason,
    follow_up: followUp,
    next_step: nextStep,
  });
  return json(result);
}
