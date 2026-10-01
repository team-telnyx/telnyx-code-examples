export { VoiceAgent } from "./voiceAgent";
import type { VoiceAgent } from "./voiceAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type VoiceAgentStub = ActorStub &
  Pick<
    VoiceAgent,
    | "recordStart"
    | "setPhase"
    | "appendUser"
    | "respond"
    | "finishCall"
    | "getDebugState"
    | "recordEvent"
    | "isOwnSpeech"
  >;

interface VoiceAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): VoiceAgentStub;
}

interface Env {
  VOICE_AGENT: VoiceAgentNamespace;
  AI_MODEL: string;
}

const TELNYX_API = "https://api.telnyx.com/v2";
const GREETING = "Hi, this is an AI voice agent. What can I help you with today?";
const TTS_VOICE = "Telnyx.KokoroTTS.af";
const SILENCE_TIMEOUT_MS = 8_000;
const REPROMPT_TEXT = "Are you still there?";

type SpeakStage = "greeting" | "reply" | "reprompt";

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function encodeClientState(state: Record<string, string>): string {
  return btoa(JSON.stringify(state));
}

function decodeClientState(clientState: unknown): Record<string, string> {
  if (typeof clientState !== "string" || !clientState) return {};
  try {
    const decoded = JSON.parse(atob(clientState));
    return decoded && typeof decoded === "object" ? decoded : {};
  } catch {
    return {};
  }
}

function actorName(callControlId: string): string {
  return callControlId.replace(/[^0-9a-zA-Z.-]/g, "");
}

function getApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
}

async function answerCall(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
    method: "POST",
    headers: authHeaders(apiKey),
  });
}

async function speakText(
  apiKey: string,
  callControlId: string,
  text: string,
  stage: SpeakStage,
): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      payload: text,
      voice: TTS_VOICE,
      language: "en-US",
      client_state: encodeClientState({ speak_stage: stage }),
      command_id: `voice-agent-${stage}-${Date.now()}`,
    }),
  });
}

async function stopSpeaking(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/playback_stop`, {
    method: "POST",
    headers: authHeaders(apiKey),
  });
}

async function startTranscription(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/transcription_start`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      transcription_tracks: "inbound",
      transcription_engine: "Telnyx",
      command_id: `voice-agent-transcription-start-${Date.now()}`,
    }),
  });
}

async function stopTranscription(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/transcription_stop`, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: JSON.stringify({ command_id: `voice-agent-transcription-stop-${Date.now()}` }),
  });
}

async function hangupCall(apiKey: string, callControlId: string): Promise<Response> {
  return fetch(`${TELNYX_API}/calls/${callControlId}/actions/hangup`, {
    method: "POST",
    headers: authHeaders(apiKey),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    if (url.pathname === "/webhooks/voice" && req.method === "POST") {
      return handleVoiceWebhook(req, env);
    }

    if (url.pathname === "/debug/call" && req.method === "GET") {
      const callControlId = url.searchParams.get("call_control_id");
      if (!callControlId) {
        return Response.json({ error: "call_control_id query param is required" }, { status: 400 });
      }
      const stub = env.VOICE_AGENT.idFromName(actorName(callControlId));
      try {
        const result = await stub.getDebugState();
        return Response.json(result);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "failed to get state";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    if (url.pathname === "/debug/respond" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { call_control_id?: string };
      const callControlId = body.call_control_id;
      if (!callControlId) {
        return Response.json({ error: "call_control_id field is required" }, { status: 400 });
      }
      const stub = env.VOICE_AGENT.idFromName(actorName(callControlId));
      try {
        const reply = await stub.respond();
        return Response.json({ reply });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "respond failed";
        return Response.json({ error: message }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};

async function handleVoiceWebhook(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const event = (body as { data?: Record<string, unknown> })?.data;
  const eventType = event?.event_type as string | undefined;
  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  if (!eventType) {
    return Response.json({ error: "no event_type in payload" }, { status: 400 });
  }

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (e) {
    const message = e instanceof Error ? e.message : "secrets not configured";
    return Response.json({ error: message }, { status: 500 });
  }

  const callControlId = payload.call_control_id as string;
  const stub = env.VOICE_AGENT.idFromName(actorName(callControlId));

  // Log every webhook event for debugging
  const payloadSummary = JSON.stringify(payload).slice(0, 500);
  await stub.recordEvent({
    eventType: eventType,
    at: Date.now(),
    payloadSummary,
  }).catch(() => undefined);

  // ── call.initiated ──────────────────────────────────────────────
  if (eventType === "call.initiated") {
    const from = (payload.from as string) || "unknown";
    const to = (payload.to as string) || "unknown";

    await stub.recordStart(callControlId, from, to);
    const answerResp = await answerCall(apiKey, callControlId);
    if (!answerResp.ok) {
      const errBody = await answerResp.text();
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "answer_failed", error: `${answerResp.status} ${errBody.slice(0, 200)}` });
      return Response.json({ action: "error", step: "answer", status: answerResp.status, err: errBody.slice(0, 200) });
    }
    await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "answering" });
    return Response.json({ action: "answering", callControlId });
  }

  // ── call.answered ────────────────────────────────────────────────
  if (eventType === "call.answered") {
    await stub.setPhase("greeting");
    const speakResp = await speakText(apiKey, callControlId, GREETING, "greeting");
    if (!speakResp.ok) {
      const errBody = await speakResp.text();
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "greeting_speak_failed", error: `${speakResp.status} ${errBody.slice(0, 200)}` });
      return Response.json({ action: "error", step: "greeting_speak", status: speakResp.status, err: errBody.slice(0, 200) });
    }
    await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "greeting" });
    return Response.json({ action: "greeting" });
  }

  // ── call.speak.ended ────────────────────────────────────────────
  // When greeting, reply, or reprompt finishes → start listening
  if (eventType === "call.speak.ended") {
    const speakStage = decodeClientState(payload.client_state).speak_stage as
      | SpeakStage
      | undefined;

    if (speakStage === "greeting" || speakStage === "reply" || speakStage === "reprompt") {
      // Defensive: stop any in-flight transcription before listening again
      try {
        await stopTranscription(apiKey, callControlId);
        await sleep(300); // let Telnyx process the stop before re-starting
      } catch {
        // best-effort
      }
      await stub.setPhase("listening");
      const transResp = await startTranscription(apiKey, callControlId);
      if (!transResp.ok) {
        const errBody = await transResp.text();
        await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "transcription_start_failed", error: `${transResp.status} ${errBody.slice(0, 200)}` });
        return Response.json({ action: "error", step: "transcription_start", status: transResp.status, err: errBody.slice(0, 200) });
      }
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "listening" });

      // Schedule a silence timeout: if no speech for SILENCE_TIMEOUT_MS, re-prompt
      setTimeout(() => silenceTimeout(apiKey, callControlId, stub).catch(() => {}), SILENCE_TIMEOUT_MS);

      return Response.json({ action: "listening", speak_stage: speakStage });
    }

    await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "ignored_speak_ended", error: `speak_stage=${speakStage}` });
    return Response.json({ action: "ignored_speak_ended", speak_stage: speakStage });
  }

  // ── call.transcription ──────────────────────────────────────────
  if (eventType === "call.transcription") {
    const transcriptionData = (payload.transcription_data ?? {}) as {
      transcript?: string;
      is_final?: boolean;
    };
    const fragment = String(transcriptionData.transcript || "").trim();

    // Read current state to check phase and filter agent's own speech
    const stateInfo = await stub.getDebugState();
    const phase = stateInfo.state.phase;

    // BARGE-IN: if user speaks while agent is replying, stop TTS and process
    if ((phase === "replying" || phase === "greeting") && fragment.length >= 5) {
      // Check if this is the agent hearing its own TTS
      const ownSpeech = await stub.isOwnSpeech(fragment);
      if (ownSpeech) {
        await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "barge_in_filtered_own_speech", error: `phase=${phase} transcript=${fragment.slice(0, 80)}` });
        return Response.json({ action: "barge_in_filtered", phase });
      }
      // User is interrupting — stop TTS and process their speech
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "barge_in", error: `phase=${phase} transcript=${fragment.slice(0, 80)}` });
      try {
        await stopSpeaking(apiKey, callControlId);
        await stopTranscription(apiKey, callControlId);
      } catch {
        // best-effort
      }
      // Fall through to process the user's speech as a normal turn
    }

    // Ignore transcription events unless we are in the "listening" phase
    // (or barge-in just put us here)
    if (phase !== "listening" && phase !== "replying" && phase !== "greeting") {
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "ignored_transcription", error: `phase=${phase} transcript=${fragment.slice(0, 80)}` });
      return Response.json({ action: "ignored_transcription", phase });
    }

    if (!fragment) {
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "empty_transcription" });
      return Response.json({ action: "empty_transcription" });
    }

    // Filter out agent's own TTS being transcribed (defensive, even with inbound-only track)
    const ownSpeech = await stub.isOwnSpeech(fragment);
    if (ownSpeech) {
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "filtered_own_speech", error: `transcript=${fragment.slice(0, 80)}` });
      return Response.json({ action: "filtered_own_speech" });
    }

    const isFinal = transcriptionData.is_final !== false;
    if (!isFinal || fragment.length < 2) {
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "transcription_accumulated", error: `is_final=${isFinal} len=${fragment.length} text=${fragment.slice(0, 80)}` });
      return Response.json({ action: "transcription_accumulated", transcript: fragment });
    }

    // Final transcript — process the turn
    await stub.setPhase("thinking");
    await stub.appendUser(fragment);

    // Stop transcription and WAIT for it to take effect before speaking.
    // Telnyx silently drops speak commands if transcription is still active.
    try {
      await stopTranscription(apiKey, callControlId);
      await sleep(800); // critical: let Telnyx fully stop transcription before TTS
    } catch {
      // best-effort, but still wait
      await sleep(800);
    }

    let reply: string;
    try {
      reply = await stub.respond();
    } catch (e) {
      reply = "Sorry, I couldn't process that. Could you say it again?";
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "respond_failed", error: String(e instanceof Error ? e.message : e) });
    }

    await stub.setPhase("replying");
    const speakResp = await speakText(apiKey, callControlId, reply, "reply");
    if (!speakResp.ok) {
      const errBody = await speakResp.text();
      await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "reply_speak_failed", error: `${speakResp.status} ${errBody.slice(0, 200)}` });
      return Response.json({ action: "error", step: "reply_speak", status: speakResp.status, err: errBody.slice(0, 200) });
    }

    // Verify the speak was actually accepted (not just HTTP 200)
    const speakBody = await speakResp.json().catch(() => ({}));
    const speakResult = (speakBody as { data?: { result?: string } }).data?.result;
    await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "replying", error: `turn=${fragment.slice(0, 80)} reply=${reply.slice(0, 80)} speak_result=${speakResult ?? "unknown"}` });
    return Response.json({ action: "replying", turn: fragment.slice(0, 120) });
  }

  // ── call.hangup ─────────────────────────────────────────────────
  if (eventType === "call.hangup") {
    await stub.finishCall();
    await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "hungup" });
    return Response.json({ action: "hungup" });
  }

  await stub.recordEvent({ eventType, at: Date.now(), payloadSummary: "", action: "noop" });
  return Response.json({ action: "noop", event: eventType });
}

/**
 * Silence timeout: if the agent is still listening after SILENCE_TIMEOUT_MS
 * with no speech detected, speak a re-prompt. If the user still doesn't
 * respond after a second timeout, hang up.
 */
async function silenceTimeout(
  apiKey: string,
  callControlId: string,
  stub: VoiceAgentStub,
): Promise<void> {
  const stateInfo = await stub.getDebugState();
  if (stateInfo.state.phase !== "listening") return;

  const listeningSince = stateInfo.state.listeningSince ?? 0;
  const elapsed = Date.now() - listeningSince;
  if (elapsed < SILENCE_TIMEOUT_MS - 500) return;

  await stub.recordEvent({ eventType: "silence_timeout", at: Date.now(), payloadSummary: "", action: "reprompt" });
  try {
    await stopTranscription(apiKey, callControlId);
  } catch {
    // best-effort
  }
  await stub.setPhase("greeting"); // re-use greeting phase so speak.ended restarts listening
  await speakText(apiKey, callControlId, REPROMPT_TEXT, "reprompt");

  // Schedule a second timeout — hang up if still no response
  setTimeout(async () => {
    const s = await stub.getDebugState();
    if (s.state.phase !== "listening") return;
    const elapsed2 = Date.now() - (s.state.listeningSince ?? 0);
    if (elapsed2 < SILENCE_TIMEOUT_MS - 500) return;
    await stub.recordEvent({ eventType: "silence_timeout_2", at: Date.now(), payloadSummary: "", action: "hangup" });
    try {
      await hangupCall(apiKey, callControlId);
    } catch {
      // best-effort
    }
  }, SILENCE_TIMEOUT_MS + 5000);
}
