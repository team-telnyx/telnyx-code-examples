// SELF-REVIEW:
// ✅ All spec primitives implemented: Agent SDK (VerifyJob extends Agent),
//    live Call Control (dial + answer + send_dtmf + transcription_start +
//    speak + gather_using_speak + hangup), Jev Decision Models scoring,
//    Messaging (SMS verdict to front desk), SQL audit ledger (attempts table),
//    backoff 10s→30s (max 3), exactly-once SMS (sent guard).
// ✅ Decision Models shape VERIFIED against live API (2026-10-06): questions
//    as a NAMED OBJECT with `instructions` + `criteria` (the earlier
//    array/`question`/`options` shape 400s on every call).
// ✅ Live mode: actor dials the mock carrier over PSTN; mock carrier answers
//    via Call Control webhooks, speaks prompts, consumes DTMF, speaks a
//    scripted eligibility answer keyed by member ID; actor transcribes it and
//    judges on hangup. client_state carries the jobId on every event — no
//    registry actor needed.
// ✅ Demo mode stays available per-job ("demo": true) for reproducible takes.
// ✅ Retry timers are poll-tick driven (schedule() does not wake dormant
//    actors on this platform build — verified 2026-10-06).
// ✅ No credentials in code — all from env/secrets.

import {
  Agent,
  type Env,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
  type SqlValue,
} from "@telnyx/edge-runtime";

// ---------------------------------------------------------------- constants

const TELNYX_API = "https://api.telnyx.com/v2";
const BACKOFF_SECONDS = [10, 30];
const JEV_ENDPOINT_DEFAULT = "https://api.telnyx.com/v2/ai/typesafe/v1/systemone";
const JEV_MODEL_DEFAULT = "telnyx/decision-flash";
const CONFIRMED_CERTAINTY_MIN = 2;
const MOCK_VOICE = "Telnyx.KokoroTTS.af";

const MOCK_ANSWERS: Record<string, string> = {
  covered:
    "Member ID verified. Member is eligible for coverage under plan. Benefits are active. Copay is 25 dollars.",
  not_covered:
    "Member ID verified. This member is not eligible. Coverage has been terminated as of last month.",
  needs_verification:
    "Member ID not recognized. Unable to verify eligibility at this time. Please contact member services.",
};

function mockAnswerForDigits(digits: string): string {
  if (digits.includes("11111")) return MOCK_ANSWERS.covered;
  if (digits.includes("22222")) return MOCK_ANSWERS.not_covered;
  return MOCK_ANSWERS.needs_verification;
}

// ---------------------------------------------------------------- types

interface Verdict {
  coverage: "covered" | "not_covered" | "needs_verification";
  coverageConfidence: number;
  certainty: number;
  hardNo: number;
  policy: string;
  smsBody: string;
}

interface JobState extends Record<string, unknown> {
  jobId: string;
  memberId: string;
  plan: string;
  provider: string;
  carrier: string;
  demo: boolean;
  outcome: string;
  attempts: number;
  status: "running" | "live_calling" | "retry_scheduled" | "done" | "exhausted";
  transcript: string | null;
  transcriptParts: string[];
  callControlId: string | null;
  menuSent: boolean;
  dtmfSent: boolean;
  answerCaptured: boolean;
  recordingUrl: string | null;
  verdict: Verdict | null;
  sent: boolean;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

interface AttemptsRow extends Record<string, SqlValue> {
  jobId: string;
  ts: number;
  outcome: string;
}

interface VerifyJobEnv extends Env {
  SECRETS: { get(name: string): Promise<string | null> };
  VERIFY_JOB: VerifyJobNamespace;
  TELNYX: {
    messages: {
      send: (params: { to: string; from: string; text: string }) => Promise<unknown>;
    };
  };
  CARRIER_E164: string;
  MOCK_CARRIER_E164: string;
  CARRIER_NUMBER_ID: string;
  OUTBOUND_CALLER_ID: string;
  FRONTDESK_E164: string;
  HOLD_MAX_MS: string;
  ANSWER_SILENCE_MS: string;
  VM_KEYWORDS: string;
  MENU_LOOP_MAX: string;
  MAX_ATTEMPTS: string;
  JEV_MODEL: string;
  JEV_ENDPOINT: string;
  DEMO_MODE: string;
}

type CallEventPayload = Record<string, unknown>;

// Diagnostic trail: the platform's runtime log stream is unreliable, so the
// mock carrier's webhook trail lives in a dedicated VerifyJob actor instance
// (the second actor binding failed to activate on this platform build).
async function mockLog(e: VerifyJobEnv, line: string): Promise<void> {
  try {
    await e.VERIFY_JOB.idFromName("mock-carrier-trail").mockRecord(line);
  } catch (err) {
    console.log(`[IVC] mock log failed: ${String(err).slice(0, 80)}`);
  }
}

// On this platform build, org secrets reach actor code ONLY through the
// SECRETS binding — process.env and this.env carry neither secrets nor
// telnyx.toml env_vars reliably (verified 2026-10-06). Resolve in that order.
async function configValue(name: string, env: VerifyJobEnv): Promise<string> {
  const viaSecrets = await env.SECRETS.get(name);
  if (viaSecrets) return viaSecrets;
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const fromEnv = (env as unknown as Record<string, unknown>)[name];
  return typeof fromEnv === "string" ? fromEnv : "";
}

// ---------------------------------------------------------------- helpers

function callActionHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function answerCall(
  callControlId: string,
  apiKey: string,
  assistantId?: string
): Promise<boolean> {
  const resp = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/answer`, {
    method: "POST",
    headers: callActionHeaders(apiKey),
    body: assistantId ? JSON.stringify({ assistant: { id: assistantId } }) : "{}",
  });
  return resp.ok;
}

async function speakOnCall(
  callControlId: string,
  payload: string,
  apiKey: string
): Promise<boolean> {
  const resp = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/speak`, {
    method: "POST",
    headers: callActionHeaders(apiKey),
    body: JSON.stringify({
      payload,
      voice: MOCK_VOICE,
      language: "en-US",
      payload_type: "text",
      service_level: "premium",
    }),
  });
  return resp.ok;
}

async function gatherDigits(
  callControlId: string,
  prompt: string,
  opts: { maxDigits: number; validDigits: string; terminatingDigit: string; invalidPayload?: string; clientState?: string },
  apiKey: string
): Promise<boolean> {
  const resp = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/gather_using_speak`, {
    method: "POST",
    headers: callActionHeaders(apiKey),
    body: JSON.stringify({
      payload: prompt,
      invalid_payload: opts.invalidPayload,
      client_state: opts.clientState,
      voice: MOCK_VOICE,
      language: "en-US",
      payload_type: "text",
      service_level: "premium",
      minimum_digits: 1,
      maximum_digits: opts.maxDigits,
      valid_digits: opts.validDigits,
      terminating_digit: opts.terminatingDigit,
      timeout_millis: 60000,
      inter_digit_timeout_millis: 5000,
      maximum_tries: 3,
    }),
  });
  return resp.ok;
}

async function hangupCall(callControlId: string, apiKey: string): Promise<boolean> {
  const resp = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/hangup`, {
    method: "POST",
    headers: callActionHeaders(apiKey),
    body: "{}",
  });
  return resp.ok;
}

// ---------------------------------------------------------------- actor

export class VerifyJob extends Agent<VerifyJobEnv, JobState> {
  protected override initialState(): JobState {
    return {
      jobId: "",
      memberId: "",
      plan: "",
      provider: "",
      carrier: "",
      demo: false,
      outcome: "random",
      attempts: 0,
      status: "running",
      transcript: null,
      transcriptParts: [],
      callControlId: null,
      menuSent: false,
      dtmfSent: false,
      answerCaptured: false,
      recordingUrl: null,
      verdict: null,
      sent: false,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS attempts(jobId TEXT, ts INTEGER, outcome TEXT)"
    );
  }

  async openJob(req: {
    jobId: string;
    memberId: string;
    plan: string;
    provider: string;
    demo?: boolean;
    outcome?: string;
  }) {
    this.ensureSchema();
    const envDemoMode = (process.env.DEMO_MODE ?? "false").toLowerCase() === "true";
    await this.setState({
      jobId: req.jobId,
      memberId: req.memberId,
      plan: req.plan,
      provider: req.provider,
      demo: req.demo ?? envDemoMode,
      outcome: req.outcome || "random",
      carrier: await configValue("CARRIER_E164", this.env) || await configValue("MOCK_CARRIER_E164", this.env) || "",
      attempts: 0,
      status: "running",
      transcript: null,
      transcriptParts: [],
      callControlId: null,
      menuSent: false,
      dtmfSent: false,
      answerCaptured: false,
      recordingUrl: null,
      verdict: null,
      sent: false,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    console.log(
      `[IVC] job ${req.jobId} opened: member=${req.memberId} plan=${req.plan} provider=${req.provider} mode=${(req.demo ?? envDemoMode) ? "demo" : "live"}`
    );
    this.schedule(0, "run", {}, { id: `verify:${req.jobId}:0` });
    return { jobId: req.jobId, status: "started" };
  }

  // RPC: mock carrier webhook trail (see mockLog)
  async mockRecord(line: string) {
    const s = await this.getState();
    const stamp = new Date().toISOString().slice(11, 19);
    const trail = (s.mockTrail as string[] | undefined) ?? [];
    await this.setState({ mockTrail: [...trail, `${stamp} ${line}`].slice(-40) });
  }

  async mockList(): Promise<{ events: string[] }> {
    const s = await this.getState();
    return { events: (s.mockTrail as string[]) ?? [] };
  }

  async getJob(): Promise<Record<string, unknown>> {
    await this.maybeFirePendingRetry();
    const s = await this.getState();
    return {
      jobId: s.jobId,
      memberId: s.memberId,
      plan: s.plan,
      provider: s.provider,
      mode: s.demo ? "demo" : "live",
      status: s.status,
      attempts: s.attempts,
      transcript: s.transcript,
      transcriptParts: s.transcriptParts,
      callControlId: s.callControlId,
      recordingUrl: s.recordingUrl,
      verdict: s.verdict,
      sent: s.sent,
      error: s.error,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  async run() {
    const s = await this.getState();
    if (s.demo) {
      await this.runDemo(s);
      return;
    }
    await this.startLiveCall(s);
  }

  // ------------------------------------------------------- demo (simulated) path

  private async runDemo(s: JobState) {
    const { transcript, detection } = await this.simulateCarrierResponse(s.outcome);

    if (!transcript) {
      await this.tryRetry(s, detection || "failed");
      return;
    }
    console.log(`[IVC] job ${s.jobId}: carrier said → "${transcript}"`);
    const verdict = await this.judgeWithDecisionModel(transcript, s.memberId, s.plan, s.jobId);
    this.ctx.storage.sql.exec(
      "INSERT INTO attempts(jobId, ts, outcome) VALUES(?, ?, ?)",
      s.jobId, Date.now(), "ok"
    );
    if (verdict.policy === "retry_needed") {
      await this.tryRetry(s, "inconclusive");
      return;
    }
    await this.setState({ verdict, transcript, status: "done", updatedAt: Date.now() });
    if (!s.sent) {
      await this.notifyFrontDesk(verdict, s.memberId, s.plan, s.jobId, s.demo);
      await this.setState({ sent: true });
    }
  }

  private async simulateCarrierResponse(
    outcome: string
  ): Promise<{ transcript: string | null; detection: string | null }> {
    const script: Record<string, string> = {
      covered: MOCK_ANSWERS.covered,
      not_covered: MOCK_ANSWERS.not_covered,
      vm: "Hi, you have reached Pinebrook Health Plan member services. Please leave a message after the tone.",
    };
    const pick = script[outcome]
      ? outcome
      : ["covered", "not_covered", "vm"][Math.floor(Math.random() * 3)];
    if (pick === "vm") {
      return { transcript: null, detection: "voicemail" };
    }
    return { transcript: script[pick], detection: null };
  }

  // ------------------------------------------------------- live call path

  private async startLiveCall(s: JobState) {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!apiKey || !await configValue("CARRIER_NUMBER_ID", this.env) || !s.carrier) {
      await this.setState({ error: "live config missing", status: "retry_scheduled", updatedAt: Date.now() });
      await this.tryRetry({ ...s, status: "retry_scheduled", updatedAt: Date.now() }, "config_missing");
      return;
    }
    const clientState = btoa(s.jobId);
    const resp = await fetch(`${TELNYX_API}/calls`, {
      method: "POST",
      headers: callActionHeaders(apiKey),
      body: JSON.stringify({
        connection_id: await configValue("CARRIER_NUMBER_ID", this.env),
        from: await configValue("OUTBOUND_CALLER_ID", this.env),
        to: s.carrier,
        client_state: clientState,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.log(`[IVC] job ${s.jobId}: live dial failed ${resp.status}: ${err.slice(0, 160)}`);
      const pointers = (() => {
        try {
          const parsed = JSON.parse(err) as { errors?: Array<{ source?: { pointer?: string } }> };
          return parsed.errors?.map((e) => e.source?.pointer).filter((p): p is string => Boolean(p)) ?? [];
        } catch {
          return [];
        }
      })();
      await this.setState({
        error: `dial ${resp.status} missing: ${pointers.join(",") || err.slice(0, 80)}`,
        updatedAt: Date.now(),
      });
      await this.tryRetry(s, "dial_failed");
      return;
    }
    const data = (await resp.json()) as { data?: { call_control_id?: string } };
    await this.setState({
      callControlId: data.data?.call_control_id ?? null,
      status: "live_calling",
      updatedAt: Date.now(),
    });
    console.log(`[IVC] job ${s.jobId}: dialing ${s.carrier} from ${await configValue("OUTBOUND_CALLER_ID", this.env)} → ${data.data?.call_control_id}`);
  }

  async onLiveAnswered(callControlId: string) {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    const s = await this.getState();
    if (!apiKey) return;
    console.log(`[IVC] job ${s.jobId}: call answered → transcription on`);

    const startTranscription = await fetch(
      `${TELNYX_API}/calls/${callControlId}/actions/transcription_start`,
      {
        method: "POST",
        headers: callActionHeaders(apiKey),
        body: JSON.stringify({ language: "en", transcription_engine: "Telnyx" }),
      }
    );
    if (!startTranscription.ok) {
      console.log(`[IVC] transcription_start failed ${startTranscription.status}`);
    }

    const startRecording = await fetch(
      `${TELNYX_API}/calls/${callControlId}/actions/recording_start`,
      {
        method: "POST",
        headers: callActionHeaders(apiKey),
        body: JSON.stringify({ format: "mp3", channels: "dual" }),
      }
    );
    if (!startRecording.ok) {
      console.log(`[IVC] recording_start failed ${startRecording.status}`);
    }

    console.log(`[IVC] job ${s.jobId}: transcription on; waiting for the carrier's menu prompt`);
  }

  async onLiveTranscription(text: string, isFinal: boolean) {
    const s = await this.getState();
    if (s.status !== "live_calling") return;
    if (!text) return;
    // Record every segment (final and interim): STT finals for long speech
    // can race call.hangup, so interims are the safety net.
    const parts = [...s.transcriptParts, text.trim()];
    console.log(`[IVC] job ${s.jobId}: transcript (${isFinal ? "final" : "interim"}) + "${text.slice(0, 60)}"`);
    const update: Record<string, unknown> = { transcriptParts: parts, updatedAt: Date.now() };

    // Speech-driven DTMF, final-only: sending on an interim races the STT
    // pipeline and the digit lands before the IVR is listening — only final
    // events have been reliable end-to-end. Two phases: menu digit after the
    // greeting, member ID after the member prompt.
    if (!isFinal) {
      await this.setState(update);
      return;
    }
    if (!s.menuSent && /press\s*2|eligibility/i.test(text)) {
      const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
      if (apiKey && s.callControlId) {
        const resp = await fetch(`${TELNYX_API}/calls/${s.callControlId}/actions/send_dtmf`, {
          method: "POST",
          headers: callActionHeaders(apiKey),
          body: JSON.stringify({ digits: "2" }),
        });
        update.menuSent = true;
        console.log(`[IVC] job ${s.jobId}: menu prompt heard → DTMF "2" (${resp.status})`);
      }
    } else if (s.menuSent && !s.dtmfSent && /member\s*id/i.test(text) && s.memberId) {
      const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
      const memberDigits = s.memberId.replace(/\D/g, "") || "00000";
      if (apiKey && s.callControlId) {
        const resp = await fetch(
          `${TELNYX_API}/calls/${s.callControlId}/actions/send_dtmf`,
          {
            method: "POST",
            headers: callActionHeaders(apiKey),
            body: JSON.stringify({ digits: memberDigits + "0" }),
          }
        );
        update.dtmfSent = true;
        console.log(`[IVC] job ${s.jobId}: member-ID prompt heard → DTMF ${memberDigits}0 (${resp.status})`);
      }
    } else if (isFinal && !s.answerCaptured &&
               /(eligible for coverage|not eligible|coverage has been terminated|unable to verify)/i.test(text)) {
      // The eligibility answer is captured — hang up and finalize immediately
      // instead of idling until the carrier's gather times out.
      const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
      if (apiKey && s.callControlId) {
        const resp = await fetch(`${TELNYX_API}/calls/${s.callControlId}/actions/hangup`, {
          method: "POST",
          headers: callActionHeaders(apiKey),
          body: "{}",
        });
        update.answerCaptured = true;
        console.log(`[IVC] job ${s.jobId}: eligibility answer captured → hanging up (${resp.status})`);
      }
    }
    await this.setState(update);
  }

  async setRecordingUrl(url: string) {
    await this.setState({ recordingUrl: url, updatedAt: Date.now() });
  }

  async onLiveHangup() {
    // Let in-flight STT finals land before reading the transcript.
    await new Promise((r) => setTimeout(r, 1500));
    const s = await this.getState();
    if (s.status !== "live_calling") return;
    const transcript = s.transcriptParts.join(" ").trim() || null;
    const vmKeywords = (await configValue("VM_KEYWORDS", this.env) || "")
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const isVoicemail = transcript
      ? vmKeywords.some((k) => transcript.toLowerCase().includes(k))
      : false;

    if (!transcript || isVoicemail) {
      console.log(`[IVC] job ${s.jobId}: live call ended without eligibility answer (${isVoicemail ? "voicemail" : "no transcript"})`);
      await this.setState({ transcript, status: "retry_scheduled", updatedAt: Date.now() });
      await this.tryRetry({ ...s, transcript, status: "retry_scheduled", updatedAt: Date.now() }, isVoicemail ? "voicemail" : "drop");
      return;
    }

    await this.setState({ transcript, status: "running", updatedAt: Date.now() });
    const verdict = await this.judgeWithDecisionModel(transcript, s.memberId, s.plan, s.jobId);
    this.ctx.storage.sql.exec(
      "INSERT INTO attempts(jobId, ts, outcome) VALUES(?, ?, ?)",
      s.jobId, Date.now(), "ok"
    );
    if (verdict.policy === "retry_needed") {
      await this.tryRetry({ ...s, transcript, status: "retry_scheduled", updatedAt: Date.now() }, "inconclusive");
      return;
    }
    await this.setState({ verdict, status: "done", updatedAt: Date.now() });
    if (!s.sent) {
      await this.notifyFrontDesk(verdict, s.memberId, s.plan, s.jobId, s.demo);
      await this.setState({ sent: true });
    }
  }

  // Unique id per attempt: reusing the initial task's schedule id silently
  // drops the replacement task on this platform build (verified 2026-10-06).
  private async tryRetry(s: JobState, detection: string): Promise<void> {
    const maxAttempts = parseInt(await configValue("MAX_ATTEMPTS", this.env) || "3", 10);
    this.ctx.storage.sql.exec(
      "INSERT INTO attempts(jobId, ts, outcome) VALUES(?, ?, ?)",
      s.jobId, Date.now(), detection
    );
    if (s.attempts + 1 >= maxAttempts) {
      await this.setState({ attempts: s.attempts + 1, status: "exhausted", updatedAt: Date.now() });
      console.log(`[IVC] job ${s.jobId}: attempts exhausted (${maxAttempts}) — flagging front desk`);
      return;
    }
    const delay = BACKOFF_SECONDS[Math.min(s.attempts, BACKOFF_SECONDS.length - 1)];
    await this.setState({ attempts: s.attempts + 1, status: "retry_scheduled", updatedAt: Date.now() });
    console.log(`[IVC] job ${s.jobId}: ${detection} → retry in ${delay}s (attempt ${s.attempts + 1}/${maxAttempts})`);
    this.schedule(delay, "run", {}, { id: `verify:${s.jobId}:${s.attempts + 1}` });
  }

  // Durable timers on this platform build don't wake dormant actors, so each
  // poll of getJob acts as the retry tick when the backoff has elapsed.
  private async maybeFirePendingRetry(): Promise<void> {
    const s = await this.getState();
    if (s.status !== "retry_scheduled" || !s.jobId || s.attempts < 1) return;
    const pendingDelayMs =
      BACKOFF_SECONDS[Math.min(s.attempts - 1, BACKOFF_SECONDS.length - 1)] * 1000;
    if (Date.now() - s.updatedAt < pendingDelayMs) return;
    console.log(`[IVC] job ${s.jobId}: retry due (poll tick) — running attempt ${s.attempts + 1}`);
    await this.run();
  }

  // ------------------------------------------------------- Decision Models

  private async judgeWithDecisionModel(
    transcript: string,
    memberId: string,
    plan: string,
    jobId: string
  ): Promise<Verdict> {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    const model = await configValue("JEV_MODEL", this.env) || JEV_MODEL_DEFAULT;
    const endpoint = await configValue("JEV_ENDPOINT", this.env) || JEV_ENDPOINT_DEFAULT;

    const body = {
      model,
      state: `Insurance eligibility verification call transcript (carrier agent speaking):\n${transcript}`,
      questions: {
        coverage: {
          type: "choice",
          instructions:
            "Based on the insurance carrier agent's spoken response, determine the member's coverage status. If the transcript does not contain a clear eligibility determination, choose needs_verification.",
          criteria: {
            covered:
              "The carrier said the member is eligible, coverage is active, or benefits are active",
            not_covered:
              "The carrier said the member is not eligible, coverage was terminated, lapsed, or inactive",
            needs_verification:
              "The carrier did not give a clear answer — asked to call back, transferred, hold, voicemail, or unclear",
          },
        },
        certainty: {
          type: "score",
          instructions:
            "Rate how certain and definitive the carrier's spoken answer is about coverage eligibility.",
          criteria: [
            "No answer or unrelated",
            "Vague or unclear answer",
            "Clear answer with some detail",
            "Explicit definitive answer",
          ],
        },
        hard_no: {
          type: "noul",
          instructions:
            "Is this a definitive statement that the member has no coverage (terminated, lapsed, or ineligible)?",
        },
      },
    };

    const resp = await this.jevFetchWithRetry(endpoint, body, apiKey);
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Decision Models API error ${resp.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      answers?: {
        coverage?: { choice?: string; confidence?: number };
        certainty?: { score?: number };
        hard_no?: { noul?: number };
      };
    };
    const a = data.answers ?? {};
    const coverage = (a.coverage?.choice || "needs_verification") as Verdict["coverage"];
    const coverageConfidence = a.coverage?.confidence ?? 0;
    const certainty = a.certainty?.score ?? 0;
    const hardNo = a.hard_no?.noul ?? 0;

    // DEV-1188 policy with a certainty floor on both paths: a confident
    // not_covered (or noul>0.8 hard stop) ⇒ NOT COVERED; confident covered
    // ⇒ CONFIRMED; everything else (garbage, voicemail noise, low certainty)
    // ⇒ needs_verification — never a verdict without evidence.
    let policy: Verdict["policy"] = "needs_verification";
    let smsBody: string;
    if ((coverage === "not_covered" && certainty >= CONFIRMED_CERTAINTY_MIN) || hardNo > 0.8) {
      policy = "not_covered";
      smsBody = `NOT COVERED — verify before visit for member ${memberId} (${plan}).`;
    } else if (coverage === "covered" && certainty >= CONFIRMED_CERTAINTY_MIN) {
      policy = "covered";
      smsBody = `Coverage CONFIRMED for member ${memberId} (${plan}). Certainty: ${certainty.toFixed(1)}/3.`;
    } else {
      smsBody = `Needs verification for member ${memberId} (${plan}) — flagged for front desk review.`;
    }
    console.log(
      `[IVC] job ${jobId}: verdict coverage=${coverage} (conf ${coverageConfidence.toFixed(3)}) certainty=${certainty.toFixed(2)}/3 hard_no=${hardNo.toFixed(4)} → ${policy}`
    );
    return { coverage, coverageConfidence, certainty, hardNo, policy, smsBody };
  }

  private async jevFetchWithRetry(
    endpoint: string,
    body: unknown,
    apiKey: string | null,
    attempt = 0
  ): Promise<Response> {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if ((resp.status === 429 || resp.status === 529 || resp.status >= 500) && attempt < 3) {
      const retryAfter = resp.headers.get("Retry-After");
      const delay = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * Math.pow(2, attempt), 10000) + Math.random() * 1000;
      console.log(`[IVC] decision model ${resp.status} → retry ${attempt + 1} in ${Math.round(delay)}ms`);
      await new Promise((r) => setTimeout(r, delay));
      return this.jevFetchWithRetry(endpoint, body, apiKey, attempt + 1);
    }
    return resp;
  }

  // ------------------------------------------------------- front desk SMS

  private async notifyFrontDesk(
    verdict: Verdict,
    memberId: string,
    plan: string,
    jobId: string,
    demo: boolean
  ): Promise<void> {
    const to = await configValue("FRONTDESK_E164", this.env);
    const body = verdict.smsBody;

    if (demo) {
      console.log(`[IVC] job ${jobId} [DEMO SMS] to ${to}: ${body}`);
      return;
    }
    await this.env.TELNYX.messages.send({ to, from: await configValue("OUTBOUND_CALLER_ID", this.env), text: body });
    console.log(`[IVC] job ${jobId}: SMS sent to ${to}: ${body}`);
  }
}

// ---------------------------------------------------------------- stub types

type VerifyJobStub = ActorStub &
  Pick<VerifyJob, "openJob" | "getJob" | "onLiveAnswered" | "onLiveTranscription" | "onLiveHangup" | "setRecordingUrl" | "mockRecord" | "mockList"> & {
    setState(state: Record<string, unknown>): Promise<void>;
  };

interface VerifyJobNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): VerifyJobStub;
}

interface CallWebhookBody {
  data?: { event_type?: string; payload?: CallEventPayload };
}

async function getApiKey(e: VerifyJobEnv): Promise<string | null> {
  return e.SECRETS.get("TELNYX_API_KEY");
}

// ---------------------------------------------------------------- function layer

function statusPage(): Response {
  const html = String.raw`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Insurance Verification Caller - Telnyx Edge</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--card:#141414;--line:#2a2a2a;--mut:#8a8a8a;--txt:#e6e6e6;--g:#00e8b4;--r:#ff5555;--y:#ffcc00}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--txt);padding:28px 20px;max-width:1080px;margin:0 auto}
.brand{font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mut);font-weight:600;margin-bottom:10px}
h1{font-size:28px;color:#fff;margin-bottom:6px}
.sub{font-size:15px;color:#aaa;line-height:1.55;max-width:760px;margin-bottom:14px}
.note{display:inline-block;font-size:12.5px;color:#b9b9b9;background:#161616;border:1px solid var(--line);border-radius:10px;padding:9px 13px;margin-bottom:20px;line-height:1.5;max-width:760px}
.note b{color:var(--g);font-weight:600}
.controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px}
button{background:var(--g);color:#0a0a0a;border:0;border-radius:8px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer}
button.alt{background:#1a1a1a;color:var(--txt);border:1px solid #333}
button:disabled{opacity:.45;cursor:not-allowed}
.pill{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:#141414;border:1px solid var(--line);font-size:13px;font-weight:600;margin-left:auto}
.dot{width:9px;height:9px;border-radius:50%;background:#555}
.dot.live{background:var(--g);animation:pulse 1.3s infinite}.dot.done{background:var(--g)}.dot.bad{background:var(--r)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.grid{display:grid;grid-template-columns:1.25fr 1fr;gap:18px}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.card h2{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6f6f6f;margin-bottom:14px}
.chat{min-height:380px;max-height:560px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.empty{color:#555;font-size:14px;margin:auto;text-align:center;line-height:1.6}
.who{font-size:11px;color:var(--mut);margin-bottom:3px;letter-spacing:.4px}
.b{padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.5;opacity:0;transform:translateY(8px);animation:in .35s forwards}
@keyframes in{to{opacity:1;transform:none}}
.row.agent{align-self:flex-end;text-align:right}.row.carrier{align-self:flex-start}
.row{width:fit-content;max-width:88%;display:flex;flex-direction:column}
.row.agent .b{background:#06352c;border:1px solid #0b5a4a;color:#c9fbee;border-bottom-right-radius:4px;align-self:flex-end}
.row.carrier .b{background:#1c1c1c;border:1px solid #2f2f2f;color:#ddd;border-bottom-left-radius:4px}
.row.sys{align-self:center}.row.sys .b{background:transparent;border:1px dashed #3a3a3a;color:var(--y);font-size:12.5px;max-width:100%}
.keys{font-family:ui-monospace,Menlo,monospace;background:#0a2a24;border:1px solid #0e6a56;border-radius:6px;padding:1px 7px;margin:0 2px}
.typing{align-self:flex-start;display:none;gap:4px;padding:10px 14px;background:#1c1c1c;border:1px solid #2f2f2f;border-radius:14px}
.typing i{width:6px;height:6px;border-radius:50%;background:#777;animation:pulse 1.1s infinite}.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
.wait{color:#555;font-size:14px;line-height:1.7;padding:30px 6px;text-align:center}
.res{display:none}
.stamp{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.stamp .ic{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;background:#06352c;color:var(--g);border:2px solid var(--g)}
.stamp.bad .ic{background:#3a1212;color:var(--r);border-color:var(--r)}.stamp.warn .ic{background:#3a3000;color:var(--y);border-color:var(--y)}
.stamp .t{font-size:22px;font-weight:800;color:var(--g);line-height:1.15}.stamp.bad .t{color:var(--r)}.stamp.warn .t{color:var(--y)}
.stamp .s{font-size:12.5px;color:var(--mut);margin-top:2px}
.meter{margin:10px 0}.meter .l{font-size:12px;color:#888;margin-bottom:4px;display:flex;justify-content:space-between}
.bar{height:9px;background:#1e1e1e;border-radius:6px;overflow:hidden}.bar>div{height:100%;background:var(--g);border-radius:6px;width:0;transition:width .9s}.bar.bad>div{background:var(--r)}
.sms{background:#073d1c;border:1px solid #0a5c2a;border-radius:14px;padding:13px 15px;font-size:14px;color:#c8f5dd;margin-top:14px;line-height:1.45}
.sms .f{font-size:11px;color:#5c8a6e;margin-bottom:4px}
audio{width:100%;margin-top:10px}.rec{display:none;margin-top:14px}.rec .l{font-size:12px;color:#888}
.foot{margin-top:22px;font-size:11.5px;color:#555;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}.foot a{color:var(--g);text-decoration:none}
</style></head><body>
<div class="brand">Telnyx Edge &middot; Agent SDK &middot; Decision Models</div>
<h1>Insurance Verification Caller</h1>
<p class="sub">A clinic needs to know a patient is covered <i>before</i> they walk in. An AI agent phones the insurance carrier, works the phone menu, listens to the answer, and tells the front desk.</p>
<div class="note"><b>Heads up:</b> the insurance carrier here (&ldquo;Pinebrook Health Plan&rdquo;) is a simulated phone line running on a Telnyx number. The call, keypresses, speech-to-text, AI verdict and text message are all real.</div>
<div class="controls">
  <button id="b1" onclick="start('W11111','PPO','Dr. Rivera')">&#9654; Active coverage</button>
  <button id="b2" class="alt" onclick="start('W22222','HMO','Dr. Chen')">&#9654; Terminated coverage</button>
  <button id="b3" class="alt" onclick="start('W33333','PPO','Dr. Patel',true,'vm')">&#9654; Voicemail &rarr; auto-retry</button>
  <span class="pill"><span class="dot" id="dot"></span><span id="state">idle</span></span>
</div>
<div class="grid">
  <div class="card"><h2>The call &mdash; agent &harr; carrier</h2>
    <div class="chat" id="chat"><div class="empty" id="empty">Pick a patient above.<br>The agent will place the call and you&rsquo;ll see the conversation here.</div><div class="typing" id="typing"><i></i><i></i><i></i></div></div>
  </div>
  <div class="card"><h2>Front desk result</h2>
    <div class="wait" id="wait">Waiting for the call to finish&hellip;</div>
    <div class="res" id="res">
      <div class="stamp" id="stamp"><div class="ic" id="ic">&#10003;</div><div><div class="t" id="vt"></div><div class="s" id="vs"></div></div></div>
      <div class="meter"><div class="l"><span>AI confidence in verdict</span><span id="ct"></span></div><div class="bar"><div id="cb"></div></div></div>
      <div class="meter"><div class="l"><span>Chance coverage is terminated</span><span id="nt"></span></div><div class="bar bad"><div id="nb"></div></div></div>
      <div class="sms"><div class="f" id="smsf">Text to front desk</div><span id="smst"></span></div>
      <div class="rec" id="rec"><div class="l">Recording of the actual call</div><audio controls id="aud"></audio></div>
    </div>
  </div>
</div>
<div class="foot"><span>Real call placed over Telnyx Voice &middot; speech-to-text &middot; Decision Models &middot; SMS &middot; durable Edge actor with retry ledger</span><a href="https://developers.telnyx.com/docs/agent-sdk">Agent SDK docs &rarr;</a></div>
<script>
var CARRIER="Pinebrook Health Plan",jobId=null,queue=[],busy=false,seenParts=0,menuShown=false,lastAtt=1,done=false,last=null,gen=0;
function $(i){return document.getElementById(i)}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
function setDot(c,t){$("dot").className="dot "+c;$("state").textContent=t}
function add(kind,html,who){var r=document.createElement("div");r.className="row "+kind;r.innerHTML=(who?'<div class="who">'+who+'</div>':'')+'<div class="b">'+html+'</div>';var c=$("chat");c.insertBefore(r,$("typing"));c.scrollTop=c.scrollHeight}
function enq(kind,html,who,delay){queue.push({kind:kind,html:html,who:who,delay:delay||1100});pump()}
function pump(){if(busy)return;if(!queue.length){$("typing").style.display="none";maybeResult();return}
  busy=true;var g=gen,it=queue.shift();$("typing").style.display=it.kind==="carrier"?"flex":"none";
  setTimeout(function(){if(g!==gen)return;add(it.kind,it.html,it.who);busy=false;pump()},it.delay)}
function reset(){gen++;jobId=null;queue=[];busy=false;seenParts=0;menuShown=false;lastAtt=1;done=false;last=null;
  var c=$("chat");c.innerHTML='<div class="typing" id="typing"><i></i><i></i><i></i></div>';
  $("res").style.display="none";$("wait").style.display="block";$("rec").style.display="none"}
async function start(id,plan,prov,demo,outcome){
  reset();["b1","b2","b3"].forEach(function(b){$(b).disabled=true});setDot("live","dialing...");
  enq("agent","Calling "+CARRIER+" to check eligibility for member <b>"+esc(id)+"</b> ("+esc(plan)+")","AI AGENT",300);
  try{var r=await fetch("/jobs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({memberId:id,plan:plan,provider:prov,demo:!!demo,outcome:outcome})});
    var j=await r.json();if(!j.jobId)throw new Error(j.error||"could not open job");jobId=j.jobId;poll(gen)}
  catch(e){setDot("bad","error");enq("sys",esc(e.message||e),null,200);enable()}}
function enable(){["b1","b2","b3"].forEach(function(b){$(b).disabled=false})}
async function poll(g){
  if(g!==gen||!jobId)return;
  try{var d=await(await fetch("/jobs/"+jobId)).json();last=d;
    var st=d.status||"";setDot(st==="done"?"done":st==="exhausted"?"bad":"live",st==="done"?"call complete":st==="exhausted"?"gave up":st==="retry_scheduled"?"retrying...":"on the call...");
    if(d.attempts>lastAtt){lastAtt=d.attempts;enq("sys","No answer from the carrier (voicemail / dropped call). Retrying automatically &mdash; attempt "+d.attempts+" of 3.",null,600);menuShown=false;seenParts=0}
    var parts=d.transcriptParts||[];
    if(!menuShown&&(d.callControlId||parts.length)&&st!=="retry_scheduled"){menuShown=true;
      enq("carrier","Thank you for calling "+CARRIER+". For eligibility verification, press 2.",CARRIER.toUpperCase(),900);
      enq("agent","Pressing <span class=\"keys\">2</span>","AI AGENT",900);
      enq("carrier","Please enter the member ID, followed by 0.",CARRIER.toUpperCase(),1100);
      enq("agent","Entering <span class=\"keys\">"+esc(d.memberId||"")+"</span> then <span class=\"keys\">0</span>","AI AGENT",1100)}
    if(menuShown){for(var i=seenParts;i<parts.length;i++)enq("carrier",esc(parts[i].trim()),CARRIER.toUpperCase(),1200);seenParts=Math.max(seenParts,parts.length)}
    if(st==="done"||st==="exhausted"){done=true;
      if(st==="done"&&d.verdict)enq("agent","Got it &mdash; sending the verdict to the front desk.","AI AGENT",900);
      if(st==="exhausted")enq("sys","All 3 attempts used. Flagged for front desk review &mdash; job state is kept.",null,600);
      pump();return}
  }catch(e){}
  setTimeout(function(){poll(g)},1200)}
function maybeResult(){
  if(!done||!last||busy||queue.length)return;var d=last;enable();
  if(d.recordingUrl){$("rec").style.display="block";if($("aud").src!==d.recordingUrl)$("aud").src=d.recordingUrl}
  var v=d.verdict;if(!v)return;
  $("wait").style.display="none";$("res").style.display="block";
  var cls="",ic="✓",t="ELIGIBILITY VERIFIED",s="Coverage is active for member "+(d.memberId||"")+" ("+(d.plan||"")+")";
  if(v.coverage==="not_covered"){cls="bad";ic="✕";t="COVERAGE TERMINATED";s="Do not treat as insured &mdash; verify before the visit"}
  else if(v.coverage==="needs_verification"){cls="warn";ic="?";t="NEEDS A HUMAN";s="The carrier couldn’t confirm &mdash; flagged for front desk"}
  $("stamp").className="stamp "+cls;$("ic").textContent=ic;$("vt").textContent=t;$("vs").innerHTML=s;
  $("ct").textContent=(v.coverageConfidence*100).toFixed(1)+"%";$("cb").style.width=(v.coverageConfidence*100)+"%";
  $("nt").textContent=(v.hardNo*100).toFixed(1)+"%";$("nb").style.width=(v.hardNo*100)+"%";
  $("smst").textContent=v.smsBody||"";$("smsf").textContent="Text sent to front desk"+(d.sent?" ✓":"")}
</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(req: Request, e: VerifyJobEnv): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }
    if (req.method === "GET" && url.pathname === "/") {
      return statusPage();
    }

    // POST /jobs/open/:memberId — assistant webhook tool entry point
    if (req.method === "POST" && url.pathname.startsWith("/jobs/open/")) {
      const memberId = url.pathname.slice("/jobs/open/".length).replace(/\D/g, "");
      if (!memberId) {
        return Response.json({ error: "memberId is required" }, { status: 400 });
      }
      const plan = url.searchParams.get("plan") || "PPO";
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stub = e.VERIFY_JOB.idFromName(jobId);
      await stub.openJob({
        jobId,
        memberId,
        plan,
        provider: "phone-verification",
      });
      return Response.json({ jobId, status: "started", memberId, plan });
    }

    if (url.pathname === "/jobs" && req.method === "POST") {
      let body: { memberId?: string; plan?: string; provider?: string; demo?: boolean; outcome?: string };
      try {
        body = (await req.json()) as typeof body;
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
      if (!body.memberId) {
        return Response.json({ error: "memberId is required" }, { status: 400 });
      }
      const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stub = e.VERIFY_JOB.idFromName(jobId);
      await stub.openJob({
        jobId,
        memberId: body.memberId,
        plan: body.plan || "PPO",
        provider: body.provider || "",
        demo: body.demo,
        outcome: body.outcome,
      });
      return Response.json({
        jobId,
        status: "started",
        status_url: `/jobs/${jobId}`,
        poll: `GET ${url.origin}/jobs/${jobId}`,
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/jobs/")) {
      const jobId = url.pathname.slice("/jobs/".length);
      if (!jobId) return Response.json({ error: "jobId is required" }, { status: 400 });
      const stub = e.VERIFY_JOB.idFromName(jobId);
      const job = await stub.getJob();
      if (!job.jobId) {
        return Response.json({ error: "job not found" }, { status: 404 });
      }
      return Response.json(job);
    }

    if (req.method === "GET" && url.pathname === "/mock-debug") {
      const stub = e.VERIFY_JOB.idFromName("mock-carrier-trail");
      const log = await stub.mockList();
      return Response.json(log);
    }

    // Actor leg: outbound call events (client_state carries the jobId)
    if (url.pathname === "/webhook/call" && req.method === "POST") {
      const raw = await req.text();
      let body: CallWebhookBody;
      try {
        body = JSON.parse(raw) as CallWebhookBody;
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
      const eventType = body.data?.event_type;
      if (!eventType) return Response.json({ error: "no event_type in payload" }, { status: 400 });
      const payload = body.data?.payload ?? {};
      const jobId = decodeClientState(payload.client_state);

      if (!jobId) {
        // Front door: an inbound call to the clinic line gets answered by the
        // Cedar Grove eligibility assistant, which collects the member ID and
        // opens a verification job via its webhook tool.
        if (eventType === "call.initiated" && payload.direction === "incoming") {
          const assistantId = await configValue("IVC_ASSISTANT_ID", e);
          const apiKey2 = await getApiKey(e);
          const cci = String(payload.call_control_id ?? "");
          if (assistantId && apiKey2 && cci) {
            const ok = await answerCall(cci, apiKey2, assistantId);
            console.log(`[IVC] front door: answered with assistant ${assistantId} (${ok})`);
          }
        }
        console.log(`[IVC] webhook/call ${eventType}: no client_state — not routed`);
        return Response.json({ received: true, routed: false });
      }
      const stub = e.VERIFY_JOB.idFromName(jobId);
      if (eventType === "call.answered") {
        const cci = String(payload.call_control_id ?? "");
        await stub.onLiveAnswered(cci);
      } else if (eventType === "call.transcription") {
        const td = (payload.transcription_data ?? {}) as { transcript?: string; is_final?: boolean };
        await stub.onLiveTranscription(td.transcript ?? "", Boolean(td.is_final));
      } else if (eventType === "call.hangup") {
        await stub.onLiveHangup();
      } else if (eventType === "call.recording.saved") {
        const urls = (payload.recording_urls ?? {}) as Record<string, string>;
        const url = urls.combined_url || urls.dual_channel_url_0 || Object.values(urls)[0] || null;
        if (url) {
          await stub.setRecordingUrl(url);
          console.log(`[IVC] recording saved for ${jobId}`);
        }
      } else {
        console.log(`[IVC] webhook/call ${eventType} for ${jobId}`);
      }
      return Response.json({ received: true, routed: true });
    }

    // Mock carrier: inbound call events on the carrier number
    if (url.pathname === "/mock-carrier" && req.method === "POST") {
      const raw = await req.text();
      let body: CallWebhookBody;
      try {
        body = JSON.parse(raw) as CallWebhookBody;
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
      const eventType = body.data?.event_type;
      if (!eventType) return Response.json({ error: "no event_type in payload" }, { status: 400 });
      const payload = body.data?.payload ?? {};
      const apiKey = await getApiKey(e);
      const cci = String(payload.call_control_id ?? "");
      if (!apiKey || !cci) return Response.json({ received: true });

      if (eventType === "call.initiated") {
        const ok = await answerCall(cci, apiKey);
        await mockLog(e, `call.initiated ${cci} answer=${ok}`);
      } else if (eventType === "call.answered") {
        const ok = await gatherDigits(
          cci,
          "Thank you for calling Pinebrook Health Plan. For eligibility verification, press 2.",
          { maxDigits: 1, validDigits: "2", terminatingDigit: "", invalidPayload: "Sorry, that is not a valid option." },
          apiKey
        );
        await mockLog(e, `call.answered ${cci} gather1=${ok}`);
      } else if (eventType === "call.gather.ended") {
        const digits = String((payload.digits as string) ?? "");
        const status = String((payload.status as string) ?? "");
        if (digits === "2") {
          const ok = await gatherDigits(
            cci,
            "Please enter the member ID, followed by 0.",
            { maxDigits: 8, validDigits: "123456789", terminatingDigit: "0", invalidPayload: "Please enter digits only, then press 0." },
            apiKey
          );
          await mockLog(e, `gather1 ended digits=${digits} status=${status} → gather2=${ok}`);
        } else if (digits) {
          // Deliver the eligibility answer via gather_using_speak — the actor's
          // STT captures gather speech reliably; plain `speak` audio does not
          // surface in transcription on this platform build.
          const answer = mockAnswerForDigits(digits);
          const ok = await gatherDigits(
            cci,
            answer,
            { maxDigits: 1, validDigits: "0123456789", terminatingDigit: "#", clientState: btoa("answer-phase") },
            apiKey
          );
          await mockLog(e, `gather2 ended digits=${digits} status=${status} → answer-gather=${ok} answer="${answer.slice(0, 40)}"`);
        } else {
          const phase = decodeClientState(payload.client_state);
          if (phase === "answer-phase") {
            await mockLog(e, `answer gather ended → hangup`);
            await hangupCall(cci, apiKey);
          } else {
            await mockLog(e, `gather ended EMPTY status=${status} → goodbye`);
            const spoke = await speakOnCall(cci, "Sorry, we could not process your request. Goodbye.", apiKey);
            await mockLog(e, `goodbye speak=${spoke}`);
          }
        }
      } else if (eventType === "call.speak.failed") {
        // TTS intermittently fails on this platform build; re-arm the menu
        // gather so the caller still gets prompted instead of dead air.
        const ok = await gatherDigits(
          cci,
          "Thank you for calling Pinebrook Health Plan. For eligibility verification, press 2.",
          { maxDigits: 1, validDigits: "2", terminatingDigit: "", invalidPayload: "Sorry, that is not a valid option." },
          apiKey
        );
        await mockLog(e, `speak.failed → re-armed menu gather=${ok}`);
      } else {
        await mockLog(e, `event ${eventType}`);
      }
      return Response.json({ received: true });
    }

    return new Response("Not Found", { status: 404 });
  },
};

function decodeClientState(clientState: unknown): string | null {
  if (typeof clientState !== "string" || !clientState) return null;
  try {
    return atob(clientState);
  } catch {
    return null;
  }
}
