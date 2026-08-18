export { VoicemailAgent } from "./voicemailAgent";
import type { VoicemailAgent } from "./voicemailAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type VoicemailAgentStub = ActorStub &
  Pick<
    VoicemailAgent,
    "start" | "transcribe" | "summarize" | "notify" | "getStatus"
  >;

interface VoicemailAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): VoicemailAgentStub;
}

interface Env {
  VOICEMAIL: VoicemailAgentNamespace;
  TELNYX_API_KEY: string;
  STORAGE_BUCKET: string;
  STORAGE_REGION: string;
  AI_MODEL: string;
  SENDER_PHONE: string;
}

// Dapr-safe actor names: no "+", no special chars (RFC 1123 job-name-safe).
function actorName(id: string): string {
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Health ─────────────────────────────────────────────────────────
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    // ── Upload audio + trigger pipeline ─────────────────────────────────
    if (req.method === "POST" && url.pathname === "/upload") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const recipientPhone = formData.get("recipient_phone") as string | null;

        if (!file || !recipientPhone) {
          return Response.json(
            { error: "Missing 'file' (audio) or 'recipient_phone' (SMS destination)" },
            { status: 400 },
          );
        }

        if (!env.TELNYX_API_KEY || !env.STORAGE_BUCKET) {
          return Response.json(
            { error: "Server missing TELNYX_API_KEY or STORAGE_BUCKET" },
            { status: 500 },
          );
        }

        const region = env.STORAGE_REGION || "us-central-1";
        const audioKey = `voicemails/${Date.now()}-${file.name || "audio.wav"}`;
        const audioBytes = await file.arrayBuffer();

        // Upload to Cloud Storage
        await VoicemailAgent.uploadToStorage(
          env.TELNYX_API_KEY,
          env.STORAGE_BUCKET,
          audioKey,
          audioBytes,
          file.type || "audio/wav",
          region,
        );

        // Start the agent pipeline
        const agentId = actorName(audioKey.replace(/\//g, "-"));
        await env.VOICEMAIL.idFromName(agentId).start({
          audioKey,
          bucket: env.STORAGE_BUCKET,
          recipientPhone,
          senderPhone: env.SENDER_PHONE,
        });

        return Response.json({
          action: "queued",
          audioKey,
          agentId,
          recipientPhone,
          statusUrl: `/status/${agentId}`,
        });
      } catch (e: any) {
        return Response.json({ error: e?.message || "upload failed" }, { status: 500 });
      }
    }

    // ── Check pipeline status ───────────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const agentId = url.pathname.split("/status/")[1];
      if (!agentId) return Response.json({ error: "missing agent id" }, { status: 400 });

      try {
        const state = await env.VOICEMAIL.idFromName(agentId).getStatus();
        return Response.json(state);
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to get state" }, { status: 500 });
      }
    }

    // ── Debug: simulate pipeline without uploading a real file ─────────
    if (req.method === "POST" && url.pathname === "/debug/simulate") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const recipientPhone = String(body.recipient_phone || "+17177247292");
        const audioKey = `debug/${Date.now()}-test.wav`;

        // Skip storage — just run the STT on a pre-existing file
        const agentId = actorName(`debug-${Date.now()}`);
        await env.VOICEMAIL.idFromName(agentId).start({
          audioKey: body.audio_key || audioKey,
          bucket: env.STORAGE_BUCKET || "test-bucket",
          recipientPhone,
          senderPhone: env.SENDER_PHONE || "+16282564655",
        });

        return Response.json({ action: "queued", agentId, recipientPhone });
      } catch (e: any) {
        return Response.json({ error: e?.message || "simulation failed" }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};
