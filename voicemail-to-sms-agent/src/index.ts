// Re-export the actor class so it ships with the bundle.
export { VoicemailAgent } from "./voicemail-agent.ts";
import type { VoicemailAgent } from "./voicemail-agent.ts";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type VoicemailAgentStub = ActorStub &
  Pick<VoicemailAgent, "handleEvent" | "processVoicemail" | "listVoicemails" | "getStats" | "debugEvents">;

interface VoicemailAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): VoicemailAgentStub;
}

interface Env {
  VOICEMAIL: VoicemailAgentNamespace;
  AI_MODEL?: string;
  STT_MODEL?: string;
  MAILBOX_OWNER_NUMBER?: string;
  TELNYX_SMS_NUMBER?: string;
  STORAGE_BUCKET?: string;
  LIVE_MODE?: string;
  VOICEMAIL_GREETING?: string;
  VOICEMAIL_WEBHOOK_PUBLIC_KEY?: string;
}

const ACTOR_NAME = "voicemail-to-sms-primary";

function handlerConfig(): Record<string, string | undefined> {
  return {
    AI_MODEL: process.env.AI_MODEL,
    STT_MODEL: process.env.STT_MODEL,
    MAILBOX_OWNER_NUMBER: process.env.MAILBOX_OWNER_NUMBER,
    TELNYX_SMS_NUMBER: process.env.TELNYX_SMS_NUMBER,
    STORAGE_BUCKET: process.env.STORAGE_BUCKET,
    LIVE_MODE: process.env.LIVE_MODE,
    VOICEMAIL_GREETING: process.env.VOICEMAIL_GREETING,
    VOICEMAIL_WEBHOOK_PUBLIC_KEY: process.env.VOICEMAIL_WEBHOOK_PUBLIC_KEY,
  };
}

function base64UrlDecode(input: string): ArrayBuffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

async function verifyTelnyxSignature(
  rawBody: string,
  headers: Headers,
  publicKeyB64: string
): Promise<boolean> {
  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;

  const publicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(publicKeyB64),
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  const message = new TextEncoder().encode(`${timestamp}|${rawBody}`);
  return crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    base64UrlDecode(signature),
    message
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    const stub = env.VOICEMAIL.idFromName(ACTOR_NAME);

    // ── POST /webhook ────────────────────────────────────────────────
    if (url.pathname === "/webhook" && req.method === "POST") {
      const rawBody = await req.text();
      const config = handlerConfig();
      const publicKey = config.VOICEMAIL_WEBHOOK_PUBLIC_KEY ?? (env as any)?.VOICEMAIL_WEBHOOK_PUBLIC_KEY ?? "";

      if (publicKey) {
        const valid = await verifyTelnyxSignature(rawBody, req.headers, publicKey);
        if (!valid) {
          return Response.json({ error: "invalid webhook signature" }, { status: 401 });
        }
      } else {
        console.warn("TELNYX_PUBLIC_KEY not set; processing unverified webhook (set the key to enforce Ed25519 verification)");
      }

      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }

      try {
        const result = await stub.handleEvent(payload, config);
        return Response.json(result, { status: 200 });
      } catch (e: any) {
        console.error("webhook handling failed:", e?.message);
        return Response.json({ status: "error" }, { status: 200 });
      }
    }

    // ── GET /voicemails ──────────────────────────────────────────────
    if (url.pathname === "/voicemails" && req.method === "GET") {
      const records = await stub.listVoicemails();
      return Response.json({ voicemails: records });
    }

    // ── GET /debug/events ────────────────────────────────────────────
    if (url.pathname === "/debug/events" && req.method === "GET") {
      const events = await stub.debugEvents();
      return Response.json({ events });
    }

    // ── GET /stats ───────────────────────────────────────────────────
    if (url.pathname === "/stats" && req.method === "GET") {
      const stats = await stub.getStats();
      return Response.json(stats);
    }

    return new Response("not found", { status: 404 });
  },
};
