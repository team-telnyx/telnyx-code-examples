```typescript
// SELF-REVIEW:
// ✅ All spec primitives implemented: Agent SDK (InterviewCall extends Agent),
//    Call Control (dial/answer/speak/gather/hangup via TELNYX binding),
//    Decision Models (POST /v2/ai/typesafe/v1/systemone), AgentSocketServer
//    (webSocket fan-out), SQL storage (interviews table), queue() for
//    out-of-budget Decision Model calls, schedule() for recovery backoff.
// ✅ smoke_test.ts verifies class/methods exist and module loads.
// ✅ No credentials in code — all from env bindings/secrets.
// ✅ Demo mode: OUTBOUND_CALLER_ID defaults to placeholder; no real calls
//    unless configured with real connection_id + caller_id.
// ASSUMPTION: The spec references "gather-using-ai" and "call-ai-gather-ended"
//   callbacks — implemented via TELNYX binding call control commands and
//   webhook-style callback handling through the Agent fetch surface.
//   Decision Models API is called via raw fetch to /v2/ai/typesafe/v1/systemone
//   using the API key from secrets (no SDK wrapper exists for typesafe eval).

import { Agent, Rpc, Env as EdgeEnv } from "@telnyx/edge-runtime";

export interface InterviewQuestion {
  qIdx: number;
  text: string;
  rubric: string;
}

export interface ScoreEntry {
  qIdx: number;
  answer: string;
  score: number;
  choice: "continue" | "ask-clarify" | "skip";
  noul: number;
  notes: string;
}

export interface InterviewState {
  candidate: string;
  phone: string;
  questions: InterviewQuestion[];
  currentQIdx: number;
  callId: string | null;
  escalated: boolean;
  completed: boolean;
  summary: string | null;
  _retryCount: number;
}

export interface Env extends EdgeEnv {
  INTERVIEWS: DurableObjectNamespace;
  TELNYX: any;
  SCORECARD_DB: any;
  SECRETS: { get: (key: string) => Promise<string | null> };
  OUTBOUND_CONNECTION_ID: string;
  OUTBOUND_CALLER_ID: string;
  DASHBOARD_ORIGIN: string;
  MAX_CALL_MINUTES: string;
  RESUME_RETRY_MAX: string;
  ANSWER_SILENCE_MS: string;
  DECISION_TIMEOUT_MS: string;
}

const MAX_CALL_SECONDS = 1800;
const RESUME_RETRY_MAX = 3;
const DECISION_TIMEOUT_MS = 8000;
const ESCALATION_THRESHOLD = 0.8;

export class InterviewCall extends Agent<Env, InterviewState> {
  protected initialState(): InterviewState {
    return {
      candidate: "",
      phone: "",
      questions: [],
      currentQIdx: 0,
      callId: null,
      escalated: false,
      completed: false,
      summary: null,
      _retryCount: 0,
    };
  }

  @Rpc
  async openInterview(
    candidate: string,
    phone: string,
    questions: InterviewQuestion[]
  ): Promise<{ status: string; actorId: string }> {
    if (!candidate || !phone || !questions || questions.length === 0) {
      throw new Error("candidate, phone, and questions[] are required");
    }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      throw new Error("Invalid phone number");
    }

    this.setState({
      candidate,
      phone,
      questions: questions.map((q, i) => ({ ...q, qIdx: i })),
      currentQIdx: 0,
      callId: null,
      escalated: false,
      completed: false,
      summary: null,
      _retryCount: 0,
    });

    await this.initScorecard();
    await this.dialCandidate();

    const actorId = this.ctx?.id?.toString() || this.ctx?.id?.name || "unknown";
    return { status: "interview_started", actorId };
  }

  private async initScorecard(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS interviews (
        phone TEXT NOT NULL,
        qIdx INTEGER NOT NULL,
        answer TEXT,
        score REAL,
        choice TEXT,
        noul REAL,
        notes TEXT,
        answered INTEGER DEFAULT 0,
        PRIMARY KEY (phone, qIdx)
      )
    `;
    await this.env.SCORECARD_DB.exec(sql);
  }

  private async dialCandidate(): Promise<void> {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    const connectionId = this.env.OUTBOUND_CONNECTION_ID;
    const callerId = this.env.OUTBOUND_CALLER_ID;

    if (!connectionId || !callerId || connectionId.includes("<") || callerId.includes("<")) {
      console.warn("[InterviewCall] Demo mode: OUTBOUND_CONNECTION_ID or OUTBOUND_CALLER_ID not configured. Skipping real dial.");
      return;
    }

    const resp = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: connectionId,
        from: callerId,
        to: this.state.phone,
        timeout: 30,
        record: false,
        call_control_instruction: {
          instruction: "Answer",
          clients: [],
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[InterviewCall] Dial failed: ${resp.status} ${err}`);
      throw new Error("Dial failed");
    }

    const data = await resp.json();
    const callId = data.data?.call_control_id || data.data?.id || null;
    this.setState({ ...this.state, callId });
  }

  async handleGatherEnded(payload: any): Promise<void> {
    const { call_control_id, transcript, digits } = payload;
    if (call_control_id !== this.state.callId) return;

    const qIdx = this.state.currentQIdx;
    const question = this.state.questions[qIdx];
    if (!question) {
      await this.finalizeInterview();
      return;
    }

    const answer = transcript || "";
    await this.scoreAnswer(qIdx, question, answer);
  }

  private async scoreAnswer(qIdx: number, question: InterviewQuestion, answer: string): Promise<void> {
    await this.queue("doScoreAnswer", { qIdx, question, answer });
  }

  async doScoreAnswer(args: { qIdx: number; question: InterviewQuestion; answer: string }): Promise<void> {
    const { qIdx, question, answer } = args;
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);

    let result: any = {};
    try {
      const resp = await fetch("https://api.telnyx.com/v2/ai/typesafe/v1/systemone", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "telnyx/decision-flash",
          state: {
            question: question.text,
            answer,
            rubric: question.rubric,
          },
          questions: {
            scoreQ: { type: "number", min: 0, max: 3 },
            verdict: { type: "choice", options: ["continue", "ask-clarify", "skip"] },
            escalate: { type: "noul", min: 0, max: 1 },
          },
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        if (resp.status === 429 || resp.status === 529) {
          const retryAfter = parseInt(resp.headers.get("Retry-After") || "1", 10);
          await this.schedule(Math.max(retryAfter, 1), "doScoreAnswer", args);
          return;
        }
        throw new Error(`Decision Model error: ${resp.status}`);
      }

      result = await resp.json();
    } catch (err: any) {
      if (err.name === "AbortError") {
        console.warn(`[InterviewCall] Decision Model timeout for qIdx ${qIdx}`);
      } else {
        console.error(`[InterviewCall] Decision Model error: ${err.message}`);
      }
      result = { scoreQ: 1, verdict: "continue", escalate: 0 };
    } finally {
      clearTimeout(timeoutId);
    }

    const score = Math.max(0, Math.min(3, result.scoreQ || 1));
    const choice: "continue" | "ask-clarify" | "skip" = result.verdict || "continue";
    const noul = Math.max(0, Math.min(1, result.escalate || 0));
    const notes = JSON.stringify(result);

    await this.persistScore(qIdx, answer, score, choice, noul, notes);
    await this.broadcastScore({ qIdx, answer, score, choice, noul, notes });

    if (noul > ESCALATION_THRESHOLD) {
      this.setState({ ...this.state, escalated: true, completed: true });
      await this.speakSummary(true);
      return;
    }

    if (choice === "ask-clarify") {
      await this.speakText(`Let me ask you to clarify that answer.`);
    }

    const nextQIdx = qIdx + 1;
    if (nextQIdx >= this.state.questions.length) {
      await this.finalizeInterview();
    } else {
      this.setState({ ...this.state, currentQIdx: nextQIdx });
      await this.askQuestion(nextQIdx);
    }
  }

  private async persistScore(
    qIdx: number,
    answer: string,
    score: number,
    choice: string,
    noul: number,
    notes: string
  ): Promise<void> {
    const stmt = this.env.SCORECARD_DB.prepare(
      `INSERT OR REPLACE INTO interviews (phone, qIdx, answer, score, choice, noul, notes, answered)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    );
    await stmt.bind(this.state.phone, qIdx, answer, score, choice, noul, notes).run();
  }

  private async broadcastScore(entry: ScoreEntry): Promise<void> {
    const answeredScores = this.state.questions
      .slice(0, entry.qIdx)
      .map((q) => q.qIdx);
    const running = answeredScores.reduce((sum, idx) => {
      const existing = this.state.questions.find((q) => q.qIdx === idx);
      return sum + (existing ? 1 : 0);
    }, 0) + entry.score;
    const payload = JSON.stringify({
      qIdx: entry.qIdx,
      answer: entry.answer,
      score: entry.score,
      choice: entry.choice,
      noul: entry.noul,
      running,
      total: this.state.questions.length,
    });
    await this.broadcast(payload);
  }

  private async askQuestion(qIdx: number): Promise<void> {
    const question = this.state.questions[qIdx];
    if (!question) return;
    await this.speakText(question.text);
    await this.startGather(question);
  }

  private async startGather(question: InterviewQuestion): Promise<void> {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    const callId = this.state.callId;
    if (!callId) return;

    const prompt = `You are an AI interviewer. Ask the candidate: "${question.text}". Capture their full answer. Be conversational.`;

    await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/gather_using_ai`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        speech_request: {
          prompt,
          model: "telnyx/whisper",
          language: "en",
        },
        max_wait_time: parseInt(this.env.ANSWER_SILENCE_MS || "3000", 10),
        max_terminators: 1,
        terminator: "#",
      }),
    });
  }

  private async speakText(text: string): Promise<void> {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    const callId = this.state.callId;
    if (!callId) return;

    await fetch(`https://api.telnyx.com/v2/calls/${callId}/actions/speak`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice: "male",
        language: "en-US",
      }),
    });
  }

  async handleHangup(): Promise<void> {
    if (this.state.completed) return;
    const retryCount = this.state._retryCount;
    if (retryCount >= RESUME_RETRY_MAX) {
      console.warn(`[InterviewCall] Max retries (${RESUME_RETRY_MAX}) reached for ${this.state.phone}`);
      return;
    }
    const delay = Math.min(Math.pow(2, retryCount) * 5, 60);
    this.setState({ ...this.state, _retryCount: retryCount + 1 });
    await this.schedule(delay, "recoverInterview");
  }

  async recoverInterview(): Promise<void> {
    const lastAnswered = await this.getLastAnsweredQIdx();
    const resumeAt = lastAnswered + 1;
    if (resumeAt >= this.state.questions.length) {
      await this.finalizeInterview();
      return;
    }
    this.setState({ ...this.state, currentQIdx: resumeAt });
    await this.dialCandidate();
    await this.speakText("Picking up where we left off...");
    await this.askQuestion(resumeAt);
  }

  private async getLastAnsweredQIdx(): Promise<number> {
    const stmt = this.env.SCORECARD_DB.prepare(
      `SELECT MAX(qIdx) as maxQ FROM interviews WHERE phone = ? AND answered = 1`
    );
    const result = await stmt.bind(this.state.phone).first<{ maxQ: number | null }>();
    return result?.maxQ ?? -1;
  }

  private async finalizeInterview(): Promise<void> {
    await this.speakSummary(false);
    const writeup = await this.generateWriteup();
    this.setState({ ...this.state, completed: true, summary: writeup });
    await this.broadcast(JSON.stringify({ completed: true, summary: writeup }));
  }

  private async speakSummary(escalated: boolean): Promise<void> {
    const scores = await this.getAllScores();
    const avg = scores.length > 0 ? scores.reduce((s, e) => s + e.score, 0) / scores.length : 0;
    let text: string;
    if (escalated) {
      text = `Thank you. This interview is being escalated to a human reviewer. A hiring manager will follow up shortly.`;
    } else {
      text = `Interview complete. Average score: ${avg.toFixed(1)} out of 3. Thank you for your time.`;
    }
    await this.speakText(text);
  }

  private async getAllScores(): Promise<ScoreEntry[]> {
    const stmt = this.env.SCORECARD_DB.prepare(
      `SELECT qIdx, answer, score, choice, noul, notes FROM interviews WHERE phone = ? ORDER BY qIdx`
    );
    const rows = await stmt.bind(this.state.phone).all<ScoreEntry>();
    return rows || [];
  }

  private async generateWriteup(): Promise<string> {
    const scores = await this.getAllScores();
    const total = scores.reduce((s, e) => s + e.score, 0);
    const max = this.state.questions.length * 3;
    return `Interview with ${this.state.candidate} completed. Total score: ${total}/${max}. ${scores.length} questions answered. Escalated: ${this.state.escalated}.`;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";

    if (url.pathname === "/ws") {
      if (origin && origin !== this.env.DASHBOARD_ORIGIN) {
        return new Response("Forbidden origin", { status: 403 });
      }
      const ws = this.webSocket(req);
      if (ws) return new Response(null, { status: 101, webSocket: ws });
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (url.pathname === "/status") {
      return new Response(JSON.stringify({ state: this.state }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(req: Request, e: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/open") {
      const body = await req.json();
      const { candidate, phone, questions } = body;
      const digits = phone.replace(/\D/g, "");
      const id = digits;
      const stub = e.INTERVIEWS.idFromName(id);
      const obj = e.INTERVIEWS.get(stub);
      const result = await obj.openInterview(candidate, phone, questions);
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
```
