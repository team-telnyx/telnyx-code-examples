import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { ScreenWorkflow, defaultRubric, sampleAnswers, type CandidateProfile } from "./src/workflow.js";
import { dashboardHtml } from "./src/dashboard-html.js";

type Env = Record<string, string>;

const PORT = Number(process.env.PORT ?? 4177);
const ASSISTANT_NAME = "candidate screening call agent demo";
const env = { ...process.env, ...loadDotEnv() } as Env;
let activePhone = env.CANDIDATE_PHONE ?? "+15558675309";
let activeAssistantId = env.TELNYX_ASSISTANT_ID;
let activeVoice: string | null = null;
let activeCallStartedAt: number | null = null;
let activeConversationId: string | null = null;
let liveTranscript: Array<{ role: string; text: string; at: string }> = [];
let processedMessageKeys = new Set<string>();
let pendingTurn: { key: string; parts: string[] } | null = null;
let lastDialPayload: Record<string, unknown> | null = null;
let activeScreen = buildDemoScreen(activePhone);

function sanitizeText(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
}

function loadDotEnv(): Env {
  if (!existsSync(".env")) return {};
  return Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...rest] = line.split("=");
        return [key, rest.join("=").replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function candidate(candidatePhone = activePhone): CandidateProfile {
  return {
    candidateId: "cand_demo_jordan",
    candidateName: "Jordan Lee",
    candidatePhone,
    role: "developer advocate",
    recruiterEmail: "recruiting@example.com",
    rubric: defaultRubric("developer advocate"),
  };
}

function buildDemoScreen(candidatePhone = activePhone) {
  const screen = new ScreenWorkflow();
  const opened = screen.openScreen(candidate(candidatePhone));
  if (activeAssistantId) {
    opened.dialPayload.AIAssistantId = activeAssistantId;
  }
  return { screen, opened };
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function telnyxGet(path: string): Promise<unknown> {
  if (!env.TELNYX_API_KEY) return { error: "TELNYX_API_KEY not configured" };
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    headers: {
      authorization: `Bearer ${env.TELNYX_API_KEY}`,
      accept: "application/json",
    },
  });
  if (!response.ok) return { error: response.status, body: await response.text() };
  return response.json();
}

async function telnyxPost(path: string, payload: unknown): Promise<unknown> {
  if (!env.TELNYX_API_KEY) return { error: "TELNYX_API_KEY not configured" };
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.TELNYX_API_KEY}`,
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

function redactPhone(phone?: string): string {
  if (!phone || phone.length < 8) return phone ?? "";
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

async function telnyxStatus(): Promise<Record<string, unknown>> {
  const phoneNumbers = (await telnyxGet("/phone_numbers?page[size]=100")) as { data?: Array<Record<string, unknown>> };
  const texmlApp = env.OUTBOUND_TEXML_APP_ID
    ? await telnyxGet(`/texml_applications/${encodeURIComponent(env.OUTBOUND_TEXML_APP_ID)}`)
    : { error: "OUTBOUND_TEXML_APP_ID not configured" };
  const selected = phoneNumbers.data?.find((item) => item.phone_number === env.OUTBOUND_CALLER_ID);
  return {
    connected: Boolean(env.TELNYX_API_KEY),
    callerId: redactPhone(env.OUTBOUND_CALLER_ID),
    assistantId: activeAssistantId ?? null,
    assistantVoice: activeVoice,
    selectedNumber: selected
      ? {
          id: selected.id,
          phone_number: redactPhone(String(selected.phone_number)),
          created_at: selected.created_at,
          updated_at: selected.updated_at,
          status: selected.status,
          connection_id: selected.connection_id,
        }
      : null,
    texmlApplication: "data" in (texmlApp as Record<string, unknown>) ? (texmlApp as { data: unknown }).data : texmlApp,
    numberCount: phoneNumbers.data?.length ?? 0,
  };
}

function screenState() {
  return {
    profile: candidate(activePhone),
    opened: activeScreen.opened,
    view: activeScreen.screen.screenView(),
    config: {
      callerId: redactPhone(env.OUTBOUND_CALLER_ID),
      texmlAppId: env.OUTBOUND_TEXML_APP_ID,
      assistantId: activeAssistantId ?? null,
      webhookToolUrl: env.WEBHOOK_TOOL_URL ?? `http://localhost:${PORT}/api/screen/score`,
      sentPayload: lastDialPayload,
    },
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

function liveCallInstructions(profile = candidate()): string {
  return [
    `you are conducting a short pre-interview phone screen for ${profile.candidateName.toLowerCase()} for the ${profile.role} role.`,
    "ask one rubric question at a time from the questions list below. keep each question close to its original wording.",
    "wait for the candidate to fully finish their thought before acknowledging. never interrupt an answer in progress.",
    "if the candidate pauses to think, wait patiently and do not respond until they clearly finish.",
    "questions already answered on a previous call: {{answered_questions}}. do not repeat answered questions. continue with the next unanswered question from the list.",
    "after each answer, acknowledge it briefly in one short sentence, then ask the next question.",
    "do not evaluate or score answers on the call. the recruiter dashboard handles scoring after the call.",
    "do not ask follow-up questions beyond the five listed. after the fifth question, thank the candidate and end the call.",
    "",
    "{{questions_list}}",
  ].join("\n").toLowerCase();
}

function questionsListText(): string {
  return candidate()
    .rubric.map((q) => `${q.qIdx + 1}. ${q.prompt}`)
    .join("; ").toLowerCase();
}

function answeredQuestionsText(): string {
  const answered = [...activeScreen.screen.state.answers]
    .sort((a, b) => a.qIdx - b.qIdx)
    .map((row) => String(row.qIdx + 1));
  return answered.length === 0 ? "none" : `question${answered.length === 1 ? "" : "s"} ${answered.join(" and ")}`;
}

function assistantGreeting(role: string): string {
  return `hi, this is the telnyx candidate screening assistant. i will ask five short questions for the ${role} role.`;
}

type AssistantListItem = {
  id?: unknown;
  name?: unknown;
  instructions?: unknown;
  voice_settings?: { voice?: unknown };
};

async function findAssistant(name: string): Promise<AssistantListItem | null> {
  const listed = (await telnyxGet("/ai/assistants?page%5Bsize%5D=100")) as { data?: AssistantListItem[] };
  const match = (listed.data ?? []).find((item) => item.name === name);
  return match ?? null;
}

type VoiceEntry = {
  id?: unknown;
  name?: unknown;
  gender?: unknown;
  model_id?: unknown;
  hosted?: unknown;
};

async function resolveAssistantVoice(): Promise<string> {
  if (env.TELENYX_ASSISTANT_VOICE) return env.TELENYX_ASSISTANT_VOICE;
  const listed = (await telnyxGet("/text-to-speech/voices?provider=telnyx")) as { voices?: VoiceEntry[] };
  const hosted = Array.isArray(listed.voices)
    ? listed.voices.filter(
        (voice) => voice.hosted === true && voice.model_id === "Ultra" && typeof voice.id === "string",
      )
    : [];
  const clara = hosted.find((voice) => String(voice.name ?? "").toLowerCase().startsWith("clara"));
  const female = hosted.find((voice) => voice.gender === "female");
  return clara?.id ?? female?.id ?? "Telnyx.KokoroTTS.af_heart";
}

async function ensureAssistant(): Promise<string> {
  if (activeAssistantId) return activeAssistantId;
  const existing = await findAssistant(ASSISTANT_NAME);
  if (existing && typeof existing.id === "string") {
    const voice = typeof existing.voice_settings?.voice === "string" ? existing.voice_settings.voice : "reused";
    activeVoice = voice;
    activeAssistantId = existing.id;
    activeScreen.opened.dialPayload.AIAssistantId = existing.id;
    activeScreen.screen.state.assistantId = existing.id;
    return existing.id;
  }
  if (!env.OUTBOUND_TEXML_APP_ID) throw new Error("OUTBOUND_TEXML_APP_ID is not configured");
  const voice = await resolveAssistantVoice();
  const payload = {
    name: ASSISTANT_NAME,
    model: env.TELENYX_ASSISTANT_MODEL ?? "openai/gpt-4o",
    instructions: liveCallInstructions(),
    greeting: assistantGreeting(candidate().role),
    voice_settings: {
      voice,
      expressive_mode: true,
    },
    transcription: {
      settings: {
        eot_timeout_ms: 2500,
        eager_eot_threshold: 0.6,
        min_turn_silence: 700,
        max_turn_silence: 2400,
        interim_results: false,
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
      default_texml_app_id: env.OUTBOUND_TEXML_APP_ID,
      voicemail_detection: {
        on_voicemail_detected: {
          action: "leave_message_and_stop_assistant",
          voicemail_message: {
            type: "message",
            message: `hi, this is the telnyx candidate screening assistant calling about your pre-interview phone screen for the ${candidate().role} role. i will call back shortly. thank you.`,
          },
        },
      },
    },
  };
  const created = (await telnyxPost("/ai/assistants", payload)) as { data?: { id?: string }; id?: string; error?: unknown };
  if (created.error) {
    throw new Error(`assistant create failed: ${JSON.stringify(created.error)}`);
  }
  const id = created.data?.id ?? created.id;
  if (!id) throw new Error(`assistant create response did not include an id: ${JSON.stringify(created)}`);
  activeAssistantId = id;
  activeVoice = voice;
  activeScreen.opened.dialPayload.AIAssistantId = id;
  activeScreen.screen.state.assistantId = id;
  return id;
}

function readCallSid(response: unknown): string | null {
  const outer = (response && typeof response === "object" ? response : {}) as Record<string, unknown>;
  const inner = (outer.data && typeof outer.data === "object" ? outer.data : outer) as Record<string, unknown>;
  return typeof inner.call_sid === "string" ? inner.call_sid : null;
}

async function placeScreeningCall(destination: string): Promise<Record<string, unknown>> {
  if (!env.OUTBOUND_TEXML_APP_ID) throw new Error("OUTBOUND_TEXML_APP_ID is not configured");
  if (!env.OUTBOUND_CALLER_ID) throw new Error("OUTBOUND_CALLER_ID is not configured");
  const nextPhone = normalizeE164(destination);
  if (nextPhone !== activePhone) {
    activePhone = nextPhone;
    activeScreen = buildDemoScreen(activePhone);
  } else {
    activeScreen.screen.state.status = "calling";
  }
  const assistantId = await ensureAssistant();
  const payload = {
    ...activeScreen.opened.dialPayload,
    From: env.OUTBOUND_CALLER_ID,
    To: activePhone,
    AIAssistantId: assistantId,
    AIAssistantDynamicVariables: {
      questions_list: questionsListText(),
      answered_questions: answeredQuestionsText(),
    },
  };
  const response = await telnyxPost(`/texml/ai_calls/${encodeURIComponent(env.OUTBOUND_TEXML_APP_ID)}`, payload);
  if ((response as { error?: unknown }).error) {
    throw new Error(`outbound call failed (http ${String((response as { error?: unknown }).error)}): ${JSON.stringify((response as { body?: unknown }).body ?? response)}`);
  }
  const callSid = readCallSid(response);
  lastDialPayload = payload;
  activeScreen.screen.state.status = "screening";
  activeCallStartedAt = Date.now();
  activeConversationId = null;
  processedMessageKeys = new Set();
  pendingTurn = null;
  liveTranscript = [];
  activeScreen.screen.state.events.push({
    ts: new Date().toISOString(),
    type: "call.started",
    detail: {
      to: redactPhone(activePhone),
      from: redactPhone(env.OUTBOUND_CALLER_ID),
      assistantId,
      callSid,
    },
  });
  return { assistantId, callSid, call: response, state: screenState() };
}

type ConversationMessage = { role?: unknown; text?: unknown; created_at?: unknown };

async function findConversationForCall(startedAtMs: number): Promise<string | null> {
  const listed = (await telnyxGet("/ai/conversations?page%5Bsize%5D=10")) as { data?: Array<Record<string, unknown>> };
  for (const item of Array.isArray(listed.data) ? listed.data : []) {
    const createdAt = String(item.created_at ?? "");
    if (!createdAt || typeof item.id !== "string") continue;
    if (new Date(createdAt).getTime() >= startedAtMs - 5000) return item.id;
  }
  return null;
}

async function pollLiveConversation(): Promise<void> {
  if (!activeConversationId) {
    if (activeCallStartedAt === null) return;
    activeConversationId = await findConversationForCall(activeCallStartedAt);
    if (!activeConversationId) return;
  }
  const listed = (await telnyxGet(
    `/ai/conversations/${encodeURIComponent(activeConversationId)}/messages?page%5Bsize%5D=50`,
  )) as { data?: ConversationMessage[] };
  const messages = (Array.isArray(listed.data) ? listed.data : [])
    .map((message) => ({
      role: String(message.role ?? "unknown"),
      text: sanitizeText(String(message.text ?? "")),
      at: String(message.created_at ?? ""),
    }))
    .filter((message) => message.at !== "" && message.text !== "");
  const fresh = messages.filter((message) => {
    const key = `${message.at}|${message.text}`;
    if (processedMessageKeys.has(key)) return false;
    processedMessageKeys.add(key);
    return true;
  });
  fresh.sort((a, b) => a.at.localeCompare(b.at));
  for (const message of fresh) {
    liveTranscript.push({ role: message.role, text: message.text, at: message.at });
  }
  if (liveTranscript.length > 60) liveTranscript = liveTranscript.slice(-60);

  const rubricLength = activeScreen.screen.state.profile?.rubric.length ?? 0;
  for (const message of fresh) {
    if (message.role === "assistant") {
      if (pendingTurn && pendingTurn.parts.length > 0) {
        const answer = pendingTurn.parts.join(" ").trim();
        const words = answer.split(/\s+/).filter(Boolean).length;
        const qIdx = activeScreen.screen.state.currentQIdx;
        if (words >= 8 && qIdx < rubricLength) {
          activeScreen.screen.recordAnswer(qIdx, answer);
        }
        pendingTurn = null;
      }
    } else if (message.role === "user") {
      if (!pendingTurn) pendingTurn = { key: message.at, parts: [] };
      const last = pendingTurn.parts[pendingTurn.parts.length - 1];
      if (last && (message.text.startsWith(last) || last.startsWith(message.text))) {
        pendingTurn.parts[pendingTurn.parts.length - 1] = message.text.length >= last.length ? message.text : last;
      } else {
        pendingTurn.parts.push(message.text);
      }
    }
  }
}


async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(dashboardHtml());
    return;
  }
  if (req.method === "GET" && url.pathname === "/telnyx-logo.svg") {
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" });
    res.end(readFileSync("telnyx-logo.svg"));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/state") return json(res, screenState());
  if (req.method === "GET" && url.pathname === "/api/telnyx") return json(res, await telnyxStatus());
  if (req.method === "GET" && url.pathname === "/api/live") {
    await pollLiveConversation();
    return json(res, {
      conversationId: activeConversationId,
      transcript: liveTranscript.slice(-12),
      state: screenState(),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/screen/score") {
    const body = (await readBody(req)) as { qidx?: number; qIdx?: number; answer?: string };
    const qIdx = Number(body.qIdx ?? body.qidx);
    if (Number.isNaN(qIdx) || !body.answer) {
      return json(res, { error: "qidx and answer are required" }, 400);
    }
    const score = activeScreen.screen.recordAnswer(qIdx, String(body.answer));
    return json(res, { score, state: screenState() });
  }
  if (req.method === "POST" && url.pathname === "/api/reset") {
    activeScreen = buildDemoScreen(activePhone);
    return json(res, screenState());
  }
  if (req.method === "POST" && url.pathname === "/api/call") {
    const body = (await readBody(req)) as { to?: string };
    if (!body.to && !env.CANDIDATE_PHONE) {
      return json(res, { error: "set CANDIDATE_PHONE in .env so the dashboard knows who to call" }, 400);
    }
    return json(res, await placeScreeningCall(body.to || env.CANDIDATE_PHONE || ""));
  }
  if (req.method === "POST" && url.pathname === "/api/answer") {
    const body = (await readBody(req)) as { qIdx?: number; answer?: string };
    const qIdx = Number(body.qIdx);
    const answer = body.answer || sampleAnswers[qIdx] || "short answer";
    const score = activeScreen.screen.recordAnswer(qIdx, answer);
    return json(res, { score, state: screenState() });
  }
  if (req.method === "POST" && url.pathname === "/api/autofill") {
    for (const [qIdx, answer] of sampleAnswers.entries()) {
      if (!activeScreen.screen.state.answers.some((row) => row.qIdx === qIdx)) {
        activeScreen.screen.recordAnswer(qIdx, answer);
      }
    }
    return json(res, screenState());
  }
  json(res, { error: "not found" }, 404);
}

createServer((req, res) => {
  route(req, res).catch((error) => json(res, { error: error instanceof Error ? error.message : String(error) }, 500));
}).listen(PORT, () => {
  console.log(`candidate screening dashboard: http://localhost:${PORT}`);
});
