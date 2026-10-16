import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, ActorStub, IdFromNameOptions } from "@telnyx/edge-runtime";
import Telnyx from "telnyx";
import {
  type CandidateProfile,
  type OpenScreenResult,
  type RubricQuestion,
  type ScoreRow,
  type ScreenState,
  ScreenWorkflow,
  actorNameForPhone,
  defaultRubric,
  questionsListText,
  sampleAnswers,
  sanitizeText,
  screenCallInstructions,
} from "./workflow.js";
import { dashboardHtml } from "./dashboard-html.js";

/**
 * Candidate Screening Call Agent — Telnyx Edge Compute sample.
 *
 * Architecture:
 *  - `CandidateScreen` is a durable Edge actor (one instance per candidate
 *    phone). It owns the screening workflow: opened state, answer ledger,
 *    scores, retries, and resume-after-drop.
 *  - The function handler routes recruiter requests and the assistant's
 *    score_answer webhook tool to the right actor via `env.SCREENS.idFromName`.
 *  - The outbound AI call is placed through the TeXML application with the AI
 *    assistant id and per-call dynamic variables (question list, already
 *    answered list), so the call always matches the code.
 */

// ── Bindings ─────────────────────────────────────────────────────────────

export type CandidateScreenStub = ActorStub &
  Pick<
    CandidateScreen,
    | "openScreen"
    | "recordAnswer"
    | "screenView"
    | "resumeAfterDrop"
    | "dialVariables"
    | "setAssistantRef"
    | "resetScreen"
  > & {
    setState(state: Record<string, unknown>): Promise<void>;
  };

export interface ScreenNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): CandidateScreenStub;
}

export interface ScreenFunctionEnv {
  SCREENS: ScreenNamespace;
}

export interface ScreenActorEnv {
  WEBHOOK_TOOL_URL?: string;
}

// ── Durable actor: one per candidate phone ───────────────────────────────

export class CandidateScreen extends Agent<ScreenActorEnv, ScreenState> {
  protected override initialState(): ScreenState {
    return {
      profile: null,
      assistantId: null,
      callControlId: null,
      currentQIdx: 0,
      answers: [],
      scores: [],
      retries: 0,
      status: "idle",
      events: [],
    };
  }

  private async load(): Promise<ScreenWorkflow> {
    const state = (await this.getState()) as unknown as ScreenState | null;
    return new ScreenWorkflow(state ?? undefined);
  }

  private async commit(screen: ScreenWorkflow): Promise<void> {
    await this.replaceState(screen.state);
  }

  /** Opens (or resumes) the screen for this actor's candidate. */
  async openScreen(profile: CandidateProfile): Promise<OpenScreenResult> {
    const screen = await this.load();
    const result = screen.openScreen(profile);
    await this.commit(screen);
    return result;
  }

  /** Stores the live assistant id and call reference after dialing. */
  async setAssistantRef(assistantId: string, callControlId: string | null): Promise<void> {
    const screen = await this.load();
    screen.state.assistantId = assistantId;
    screen.state.callControlId = callControlId;
    if (screen.state.status === "calling" || screen.state.status === "idle") {
      screen.state.status = "screening";
    }
    screen.state.events.push({
      ts: new Date().toISOString(),
      type: "call.started",
      detail: { assistantId, callControlId },
    });
    await this.commit(screen);
  }

  /** Records + scores one answer (the score_answer tool webhook target). */
  async recordAnswer(qIdx: number, answer: string): Promise<ScoreRow> {
    const screen = await this.load();
    const score = screen.recordAnswer(qIdx, sanitizeText(answer));
    await this.commit(screen);
    return score;
  }

  /** Per-call dynamic variables for the AI assistant dial payload. */
  async dialVariables(): Promise<{ questions_list: string; answered_questions: string; candidate_phone: string }> {
    const screen = await this.load();
    const profile = screen.state.profile;
    if (!profile) throw new Error("openScreen must run before dialVariables");
    const answered = [...screen.state.answers]
      .sort((a, b) => a.qIdx - b.qIdx)
      .map((row) => String(row.qIdx + 1));
    return {
      questions_list: questionsListText(profile),
      answered_questions:
        answered.length === 0 ? "none" : `question${answered.length === 1 ? "" : "s"} ${answered.join(" and ")}`,
      candidate_phone: profile.candidatePhone,
    };
  }

  async screenView(): Promise<Record<string, unknown>> {
    const screen = await this.load();
    return screen.screenView();
  }

  /** Durable retry decision after a dropped call. */
  async resumeAfterDrop(): Promise<{ shouldRetry: boolean; nextQuestion: RubricQuestion | null; retries: number }> {
    const screen = await this.load();
    const result = screen.resumeAfterDrop();
    await this.commit(screen);
    return result;
  }

  /** Clears the screen back to idle (dashboard Reset Demo). */
  async resetScreen(): Promise<void> {
    await this.replaceState(this.initialState());
  }
}

// ── Telnyx API helpers (function side) ───────────────────────────────────

const ASSISTANT_NAME = "candidate screening call agent demo";

const telnyxVerifyClient = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY ?? "unused-webhook-verification-only",
});

function requireApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
}

async function telnyxGet(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    headers: { authorization: `Bearer ${requireApiKey()}`, accept: "application/json" },
  });
  if (!response.ok) return { error: response.status, body: await response.text() };
  return (await response.json()) as Record<string, unknown>;
}

async function telnyxPost(path: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireApiKey()}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) return { error: response.status, body };
  return body;
}

type VoiceEntry = { id?: unknown; name?: unknown; gender?: unknown; model_id?: unknown; hosted?: unknown };

async function resolveAssistantVoice(): Promise<string> {
  const listed = (await telnyxGet("/text-to-speech/voices?provider=telnyx")) as { voices?: VoiceEntry[] };
  const hosted = Array.isArray(listed.voices)
    ? listed.voices.filter(
        (voice) => voice.hosted === true && voice.model_id === "Ultra" && typeof voice.id === "string",
      )
    : [];
  const clara = hosted.find((voice) => String(voice.name ?? "").toLowerCase().startsWith("clara"));
  const female = hosted.find((voice) => voice.gender === "female");
  const claraId = typeof clara?.id === "string" ? clara.id : null;
  const femaleId = typeof female?.id === "string" ? female.id : null;
  return claraId ?? femaleId ?? "Telnyx.KokoroTTS.af_heart";
}

type AssistantListItem = { id?: unknown; name?: unknown; voice_settings?: { voice?: unknown } };

async function findAssistant(name: string): Promise<AssistantListItem | null> {
  const listed = (await telnyxGet("/ai/assistants?page%5Bsize%5D=100")) as { data?: AssistantListItem[] };
  const match = (listed.data ?? []).find((item) => item.name === name);
  return match ?? null;
}

function toolUrl(): string {
  return process.env.WEBHOOK_TOOL_URL ?? "";
}

function toolAttached(): boolean {
  const url = toolUrl();
  return Boolean(url) && !/localhost|127\.0\.0\.1/.test(url);
}

function assistantGreeting(role: string): string {
  return `hi, this is the telnyx candidate screening assistant. i will ask five short questions for the ${role} role.`;
}

/**
 * Creates (once per account, reused thereafter) the live screening assistant.
 * The score_answer webhook tool is only attached when WEBHOOK_TOOL_URL points
 * at a reachable (non-localhost) URL — the deployed Edge function URL.
 */
async function ensureAssistant(profile: CandidateProfile): Promise<string> {
  const existing = await findAssistant(ASSISTANT_NAME);
  if (existing && typeof existing.id === "string") {
    return existing.id;
  }
  const app = process.env.OUTBOUND_TEXML_APP_ID ?? "";
  if (!app) throw new Error("OUTBOUND_TEXML_APP_ID is not configured");
  const withTool = toolAttached();
  const voice = await resolveAssistantVoice();
  const payload: Record<string, unknown> = {
    name: ASSISTANT_NAME,
    model: process.env.TELNYX_ASSISTANT_MODEL ?? "openai/gpt-4o",
    instructions: screenCallInstructions(profile, { withTool, answeredQuestions: "none" }),
    greeting: assistantGreeting(profile.role),
    voice_settings: { voice, expressive_mode: true },
    transcription: {
      settings: {
        eot_timeout_ms: 2500,
        eager_eot_threshold: 0.6,
        min_turn_silence: 700,
        max_turn_silence: 2400,
      },
    },
    interruption_settings: {
      enable: true,
      start_speaking_plan: {
        wait_seconds: 0.9,
        transcription_endpointing_plan: {
          on_punctuation_seconds: 0.4,
          on_no_punctuation_seconds: 2.5,
          on_number_seconds: 1,
        },
      },
    },
    telephony_settings: {
      default_texml_app_id: app,
      voicemail_detection: {
        on_voicemail_detected: {
          action: "leave_message_and_stop_assistant",
          voicemail_message: {
            type: "message",
            message: `hi, this is the telnyx candidate screening assistant calling about your pre-interview phone screen for the ${profile.role} role. i will call back shortly. thank you.`,
          },
        },
      },
    },
  };
  if (withTool) {
    payload.tools = [
      {
        type: "webhook",
        webhook: {
          name: "score_answer",
          description: "records and scores one candidate answer for the recruiter dashboard",
          url: toolUrl(),
          method: "POST",
        },
      },
    ];
  }
  const created = (await telnyxPost("/ai/assistants", payload)) as {
    data?: { id?: string };
    id?: string;
    error?: unknown;
  };
  if (created.error) {
    throw new Error(`assistant create failed: ${JSON.stringify(created.error)}`);
  }
  const id = created.data?.id ?? created.id;
  if (!id) throw new Error(`assistant create response did not include an id: ${JSON.stringify(created)}`);
  return id;
}

function readCallSid(response: Record<string, unknown>): string | null {
  const inner = (response.data && typeof response.data === "object" ? response.data : response) as Record<string, unknown>;
  return typeof inner.call_sid === "string" ? inner.call_sid : null;
}

function demoProfile(phone: string): CandidateProfile {
  return {
    candidateId: "cand_demo_jordan",
    candidateName: "Jordan Lee",
    candidatePhone: phone,
    role: "developer advocate",
    recruiterEmail: "recruiting@example.com",
    rubric: [],
  };
}

function normalizeE164(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) throw new Error("enter the candidate's phone number");
  if (!trimmed.startsWith("+")) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    throw new Error("enter a phone number with country code, for example +13125550123, or a 10-digit us number");
  }
  if (!/^\+\d{8,15}$/.test(trimmed)) {
    throw new Error("enter a destination phone number in e.164 format, for example +13125550123");
  }
  return trimmed;
}

/** Places the outbound AI screening call through the configured TeXML app. */
async function placeScreeningCall(
  env: ScreenFunctionEnv,
  phone: string,
): Promise<{ assistantId: string; callSid: string | null }> {
  const app = process.env.OUTBOUND_TEXML_APP_ID ?? "";
  const callerId = process.env.OUTBOUND_CALLER_ID ?? "";
  if (!app) throw new Error("OUTBOUND_TEXML_APP_ID is not configured");
  if (!callerId) throw new Error("OUTBOUND_CALLER_ID is not configured");
  const destination = normalizeE164(phone);

  const stub = env.SCREENS.idFromName(actorNameForPhone(destination));
  const profile: CandidateProfile = { ...demoProfile(destination), rubric: defaultRubric(demoProfile(destination).role) };
  const opened = await stub.openScreen(profile);

  const assistantId = await ensureAssistant(profile);
  const variables = await stub.dialVariables();
  const payload = {
    From: callerId,
    To: destination,
    AIAssistantId: assistantId,
    MachineDetection: "Enable",
    AsyncAmd: true,
    DetectionMode: "Premium",
    AIAssistantDynamicVariables: variables,
  };
  const response = await telnyxPost(`/texml/ai_calls/${encodeURIComponent(app)}`, payload);
  if (response.error) {
    throw new Error(
      `outbound call failed (http ${String(response.error)}): ${JSON.stringify(response.body ?? response)}`,
    );
  }
  const callSid = readCallSid(response);
  await stub.setAssistantRef(assistantId, callSid);
  return { assistantId, callSid };
}

function redactPhone(phone?: string): string {
  if (!phone || phone.length < 8) return phone ?? "";
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

function demoPhone(): string {
  return process.env.CANDIDATE_PHONE ?? "";
}

function idleView(phone: string): Record<string, unknown> {
  return {
    candidate: "Jordan Lee",
    phone,
    role: "developer advocate",
    status: "idle",
    currentQIdx: 0,
    answers: [],
    scores: [],
    summary: { complete: false, averageScore: 0, recommendedNextStep: "pending" },
    events: [],
  };
}

async function edgeState(env: ScreenFunctionEnv): Promise<Record<string, unknown>> {
  const phone = demoPhone();
  const profile: CandidateProfile = { ...demoProfile(phone), rubric: defaultRubric("developer advocate") };
  let view: Record<string, unknown> | null = null;
  if (phone) {
    try {
      const stub = env.SCREENS.idFromName(actorNameForPhone(phone));
      view = await stub.screenView();
    } catch {
      view = null;
    }
  }
  return {
    profile,
    view: view ?? idleView(phone),
    config: { callerId: redactPhone(process.env.OUTBOUND_CALLER_ID), texmlAppId: process.env.OUTBOUND_TEXML_APP_ID ?? null },
  };
}

async function liveTranscript(): Promise<{ conversationId: string | null; transcript: Array<{ role: string; text: string; at: string }> }> {
  const listed = (await telnyxGet("/ai/conversations?page%5Bsize%5D=10")) as { data?: Array<Record<string, unknown>> };
  const ours = (listed.data ?? []).find(
    (item) => typeof item.system_prompt === "string" && String(item.system_prompt).includes("pre-interview phone screen"),
  );
  if (!ours || typeof ours.id !== "string") return { conversationId: null, transcript: [] };
  const msgs = (await telnyxGet(`/ai/conversations/${encodeURIComponent(ours.id)}/messages?page%5Bsize%5D=50`)) as {
    data?: Array<Record<string, unknown>>;
  };
  const transcript = (msgs.data ?? [])
    .map((message) => ({
      role: String(message.role ?? "unknown"),
      text: sanitizeText(String(message.text ?? "")),
      at: String(message.created_at ?? ""),
    }))
    .filter((message) => message.at !== "" && message.text !== "")
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-12);
  return { conversationId: ours.id, transcript };
}

async function telnyxStatus(): Promise<Record<string, unknown>> {
  const phoneNumbers = (await telnyxGet("/phone_numbers?page%5Bsize%5D=100")) as {
    data?: Array<Record<string, unknown>>;
  };
  const callerId = process.env.OUTBOUND_CALLER_ID ?? "";
  const selected = (phoneNumbers.data ?? []).find((item) => item.phone_number === callerId);
  return {
    connected: Boolean(process.env.TELNYX_API_KEY),
    callerId: redactPhone(callerId),
    texmlApplication: { id: process.env.OUTBOUND_TEXML_APP_ID ?? null },
    numberCount: phoneNumbers.data?.length ?? 0,
    selectedNumber: selected ? { status: selected.status, connection_id: selected.connection_id } : null,
  };
}

// ── Function handler ─────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: ScreenFunctionEnv): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/healthz") {
        return Response.json({ ok: true, sample: "candidate-screening-call-agent" });
      }

      // recruiter dashboard (same UI as the local demo)
      if (url.pathname === "/" && req.method === "GET") {
        return new Response(dashboardHtml(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        });
      }
      if (url.pathname === "/api/state" && req.method === "GET") {
        return Response.json(await edgeState(env));
      }
      if (url.pathname === "/api/live" && req.method === "GET") {
        return Response.json(await liveTranscript());
      }
      if (url.pathname === "/api/telnyx" && req.method === "GET") {
        return Response.json(await telnyxStatus());
      }
      if (url.pathname === "/api/call" && req.method === "POST") {
        const body = (await req.json()) as { phone?: string };
        const result = await placeScreeningCall(env, body.phone ?? demoPhone());
        return Response.json(result);
      }
      if (url.pathname === "/api/reset" && req.method === "POST") {
        const phone = demoPhone();
        if (!phone) return Response.json({ error: "CANDIDATE_PHONE is not configured" }, { status: 400 });
        const stub = env.SCREENS.idFromName(actorNameForPhone(phone));
        await stub.resetScreen();
        return Response.json(await edgeState(env));
      }
      if (url.pathname === "/api/answer" && req.method === "POST") {
        const body = (await req.json()) as { qIdx?: number; answer?: string };
        const phone = demoPhone();
        if (!phone) return Response.json({ error: "CANDIDATE_PHONE is not configured" }, { status: 400 });
        const qIdx = Number(body.qIdx);
        if (Number.isNaN(qIdx)) return Response.json({ error: "qIdx is required" }, { status: 400 });
        const stub = env.SCREENS.idFromName(actorNameForPhone(phone));
        const score = await stub.recordAnswer(qIdx, body.answer || sampleAnswers[qIdx] || "short answer");
        return Response.json({ score, state: await edgeState(env) });
      }
      if (url.pathname === "/api/autofill" && req.method === "POST") {
        const phone = demoPhone();
        if (!phone) return Response.json({ error: "CANDIDATE_PHONE is not configured" }, { status: 400 });
        const stub = env.SCREENS.idFromName(actorNameForPhone(phone));
        const view = await stub.screenView();
        const answered = new Set(((view.answers as Array<{ qIdx: number }>) ?? []).map((row) => row.qIdx));
        for (const [qIdx, answer] of sampleAnswers.entries()) {
          if (!answered.has(qIdx)) await stub.recordAnswer(qIdx, answer);
        }
        return Response.json(await edgeState(env));
      }

      // score_answer webhook tool from the AI assistant
      if (url.pathname === "/screen/score" && req.method === "POST") {
        const raw = await req.text();
        let body: { qidx?: number; qIdx?: number; answer?: string; phone?: string };
        const publicKey = process.env.TELNYX_PUBLIC_KEY ?? "";
        const hasSignature = [...req.headers.keys()].some((key) => key.toLowerCase().includes("telnyx-signature"));
        if (publicKey && hasSignature) {
          const headers: Record<string, string> = {};
          req.headers.forEach((value, key) => {
            headers[key] = value;
          });
          body = (await telnyxVerifyClient.webhooks.unwrap(raw, { headers, key: publicKey })) as typeof body;
        } else {
          body = JSON.parse(raw);
        }
        const phone = String(body.phone ?? "");
        const qIdx = Number(body.qIdx ?? body.qidx);
        const answer = String(body.answer ?? "");
        if (!phone || Number.isNaN(qIdx) || !answer) {
          return Response.json({ error: "phone, qidx and answer are required" }, { status: 400 });
        }
        const stub = env.SCREENS.idFromName(actorNameForPhone(phone));
        const score = await stub.recordAnswer(qIdx, answer);
        return Response.json({ ok: true, score });
      }

      if (url.pathname === "/screen/open" && req.method === "POST") {
        const body = (await req.json()) as { profile?: CandidateProfile; phone?: string };
        const profile = body.profile ?? demoProfile(body.phone ?? "");
        if (!profile.candidatePhone) {
          return Response.json({ error: "profile.candidatePhone is required" }, { status: 400 });
        }
        const stub = env.SCREENS.idFromName(actorNameForPhone(profile.candidatePhone));
        const opened = await stub.openScreen(profile);
        return Response.json({ ok: true, opened });
      }

      if (url.pathname === "/screen/call" && req.method === "POST") {
        const body = (await req.json()) as { phone?: string };
        const phone = body.phone ?? process.env.CANDIDATE_PHONE ?? "";
        const result = await placeScreeningCall(env, phone);
        return Response.json({ ok: true, ...result });
      }

      if (url.pathname === "/screen/view" && req.method === "GET") {
        const phone = url.searchParams.get("phone") ?? process.env.CANDIDATE_PHONE ?? "";
        if (!phone) return Response.json({ error: "phone query param or CANDIDATE_PHONE required" }, { status: 400 });
        const stub = env.SCREENS.idFromName(actorNameForPhone(normalizeE164(phone)));
        const view = await stub.screenView();
        return Response.json({ ok: true, view });
      }

      if (url.pathname === "/screen/redial" && req.method === "POST") {
        const body = (await req.json()) as { phone?: string };
        const phone = body.phone ?? process.env.CANDIDATE_PHONE ?? "";
        if (!phone) return Response.json({ error: "phone or CANDIDATE_PHONE required" }, { status: 400 });
        const destination = normalizeE164(phone);
        const stub = env.SCREENS.idFromName(actorNameForPhone(destination));
        const retry = await stub.resumeAfterDrop();
        if (!retry.shouldRetry) {
          return Response.json({ ok: true, retry });
        }
        const result = await placeScreeningCall(env, destination);
        return Response.json({ ok: true, retry, ...result });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }
  },
};
