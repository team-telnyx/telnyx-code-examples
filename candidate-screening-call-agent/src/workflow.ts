export type ScreenChoice = "pass" | "clarify" | "fail";
export type HumanReview = "yes" | "no" | "unknown";

export interface RubricQuestion {
  qIdx: number;
  prompt: string;
  dimension: string;
  idealSignals: string[];
}

export interface CandidateProfile {
  candidateId: string;
  candidateName: string;
  candidatePhone: string;
  role: string;
  recruiterEmail: string;
  rubric: RubricQuestion[];
}

export interface ScreenAnswer {
  qIdx: number;
  question: string;
  answer: string;
  answeredAt: string;
}

export interface ScoreRow {
  qIdx: number;
  score: 0 | 1 | 2 | 3;
  choice: ScreenChoice;
  noul: HumanReview;
  reason: string;
}

export interface ScreenState extends Record<string, unknown> {
  profile: CandidateProfile | null;
  assistantId: string | null;
  callControlId: string | null;
  currentQIdx: number;
  answers: ScreenAnswer[];
  scores: ScoreRow[];
  retries: number;
  status: "idle" | "calling" | "screening" | "scoring" | "complete" | "needs_human_review";
  events: LedgerEvent[];
}

export interface LedgerEvent {
  ts: string;
  type: string;
  detail: Record<string, unknown>;
}

export interface OpenScreenResult {
  actorName: string;
  assistantPayload: Record<string, unknown>;
  dialPayload: Record<string, unknown>;
  nextQuestion: RubricQuestion;
}

const DEFAULT_MAX_CALL_MINUTES = 12;
const DEFAULT_RETRY_MAX = 2;

export function actorNameForPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) {
    throw new Error("candidate phone must include at least seven digits");
  }
  return `candidate-screen-${digits}`;
}

export function defaultRubric(role = "developer advocate"): RubricQuestion[] {
  return [
    {
      qIdx: 0,
      prompt: `What interests you about this ${role} role?`,
      dimension: "motivation",
      idealSignals: ["developer", "excited", "love", "company", "product"],
    },
    {
      qIdx: 1,
      prompt: "Tell me about a technical concept you explained to developers recently.",
      dimension: "technical communication",
      idealSignals: ["explain", "example", "concept", "showed", "taught", "walked", "audience", "webhook", "architecture"],
    },
    {
      qIdx: 2,
      prompt: "Describe a time you debugged a production or customer-facing issue.",
      dimension: "problem solving",
      idealSignals: ["debug", "issue", "problem", "customer", "fix", "solved", "root", "incident", "production"],
    },
    {
      qIdx: 3,
      prompt: "How would you measure whether a code sample is successful?",
      dimension: "product judgment",
      idealSignals: ["test", "usage", "activation", "measure", "metric", "feedback", "success", "adopt", "deploy"],
    },
    {
      qIdx: 4,
      prompt: "What excites you about this role?",
      dimension: "role fit",
      idealSignals: ["excite", "role", "interest", "enthusiasm", "responsib"],
    },
  ];
}

/**
 * Instructions for the live screening assistant. The question list and the
 * already-answered list are injected per call as dynamic variables, so the
 * same assistant always asks exactly what the code says and resumes at the
 * next unanswered question after a dropped call.
 */
export function screenCallInstructions(
  profile: CandidateProfile,
  opts: { withTool: boolean; answeredQuestions?: string } = { withTool: false },
): string {
  const lines = [
    `you are conducting a short pre-interview phone screen for ${profile.candidateName.toLowerCase()} for the ${profile.role} role.`,
    "ask one rubric question at a time from the questions list below. keep each question close to its original wording.",
    "wait for the candidate to fully finish their thought before acknowledging. never interrupt an answer in progress.",
    "if the candidate pauses to think, wait patiently and do not respond until they clearly finish.",
  ];
  if (opts.withTool) {
    lines.push(
      "after each completed answer, call the score_answer tool with qidx, answer, and phone set to {{candidate_phone}}. then ask the next question.",
    );
  }
  lines.push(
    `questions already answered on a previous call: ${opts.answeredQuestions ?? "{{answered_questions}}"}. do not repeat answered questions. continue with the next unanswered question from the list.`,
    "after each answer, acknowledge it briefly in one short sentence, then ask the next question.",
    "do not evaluate or score answers on the call beyond calling the tool.",
    "do not ask follow-up questions beyond the five listed. after the fifth question, thank the candidate and end the call.",
    "",
    "{{questions_list}}",
  );
  return lines.join("\n").toLowerCase();
}

export function questionsListText(profile: CandidateProfile): string {
  return profile.rubric.map((q) => `${q.qIdx + 1}. ${q.prompt}`).join("; ").toLowerCase();
}

export function sanitizeText(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
}

/**
 * ScreenWorkflow — the pure, framework-free state machine for one candidate
 * screen. The Edge actor (CandidateScreen) delegates to it; the local demo
 * dashboard uses it directly.
 */
export class ScreenWorkflow {
  readonly state: ScreenState;

  constructor(initial?: Partial<ScreenState>) {
    this.state = {
      profile: null,
      assistantId: null,
      callControlId: null,
      currentQIdx: 0,
      answers: [],
      scores: [],
      retries: 0,
      status: "idle",
      events: [],
      ...initial,
    };
  }

  openScreen(profile: CandidateProfile): OpenScreenResult {
    const normalized = normalizeProfile(profile);
    const actorName = actorNameForPhone(normalized.candidatePhone);
    this.state.profile = normalized;
    this.state.assistantId = `asst_${normalized.candidateId}`;
    this.state.currentQIdx = this.nextUnansweredQuestion()?.qIdx ?? 0;
    this.state.status = "calling";
    this.append("screen.opened", { actorName, role: normalized.role });

    return {
      actorName,
      assistantPayload: this.buildAssistantPayload(normalized),
      dialPayload: this.buildDialPayload(normalized),
      nextQuestion: this.nextUnansweredQuestion() ?? normalized.rubric[0],
    };
  }

  buildAssistantPayload(profile = this.requireProfile()): Record<string, unknown> {
    return {
      name: `screen ${profile.candidateName} for ${profile.role}`,
      instructions: this.assistantInstructions(profile),
      voice_settings: {
        voice: "Telnyx.Ultra.Clara",
        expressive_mode: true,
      },
      telephony_settings: {
        voicemail_detection: "premium",
      },
      websocket_settings: {
        enabled: true,
        url: "https://example.com/screen/events",
        auth_ref: "screen-webhook-auth",
      },
      post_conversation_settings: {
        enabled: true,
      },
      memory: {
        enabled: true,
      },
      enabled_features: ["telephony"],
      tools: [
        {
          type: "webhook",
          webhook: {
            name: "score_answer",
            description: "records and scores one candidate answer for the recruiter dashboard",
            url: "https://example.com/screen/score",
            method: "POST",
          },
        },
      ],
    };
  }

  buildDialPayload(profile = this.requireProfile()): Record<string, unknown> {
    return {
      From: "+15551234567",
      To: profile.candidatePhone,
      AIAssistantId: this.state.assistantId ?? `asst_${profile.candidateId}`,
      MachineDetection: "Enable",
      AsyncAmd: true,
      DetectionMode: "Premium",
      MaxCallDuration: DEFAULT_MAX_CALL_MINUTES * 60,
    };
  }

  recordAnswer(qIdx: number, answer: string, now = new Date().toISOString()): ScoreRow {
    const profile = this.requireProfile();
    const question = profile.rubric.find((item) => item.qIdx === qIdx);
    if (!question) {
      throw new Error(`unknown qIdx ${qIdx}`);
    }
    const existing = this.state.answers.findIndex((row) => row.qIdx === qIdx);
    const row = { qIdx, question: question.prompt, answer, answeredAt: now };
    if (existing >= 0) {
      this.state.answers[existing] = row;
    } else {
      this.state.answers.push(row);
    }
    const score = scoreWithDecisionModelShape(question, answer);
    this.upsertScore(score);
    this.state.currentQIdx = this.nextUnansweredQuestion()?.qIdx ?? profile.rubric.length;
    this.state.status = this.isComplete() ? this.finalStatus() : "screening";
    this.append("answer.scored", { qIdx, score: score.score, choice: score.choice, noul: score.noul });
    return score;
  }

  resumeAfterDrop(): { shouldRetry: boolean; nextQuestion: RubricQuestion | null; retries: number } {
    const retryMax = DEFAULT_RETRY_MAX;
    if (this.isComplete() || this.state.retries >= retryMax) {
      this.append("screen.retry_skipped", { retries: this.state.retries, retryMax });
      return { shouldRetry: false, nextQuestion: null, retries: this.state.retries };
    }
    this.state.retries += 1;
    const nextQuestion = this.nextUnansweredQuestion();
    this.state.status = "calling";
    this.append("screen.retry_scheduled", { retries: this.state.retries, nextQIdx: nextQuestion?.qIdx ?? null });
    return { shouldRetry: true, nextQuestion, retries: this.state.retries };
  }

  nextUnansweredQuestion(): RubricQuestion | null {
    const profile = this.requireProfile();
    const answered = new Set(this.state.answers.map((row) => row.qIdx));
    return profile.rubric.find((question) => !answered.has(question.qIdx)) ?? null;
  }

  buildDecisionPayload(qIdx: number): Record<string, unknown> {
    const profile = this.requireProfile();
    const question = profile.rubric.find((row) => row.qIdx === qIdx);
    const answer = this.state.answers.find((row) => row.qIdx === qIdx);
    if (!question || !answer) {
      throw new Error(`question ${qIdx} must be answered before scoring`);
    }
    return {
      model: "telnyx/decision-flash",
      input: {
        role: profile.role,
        dimension: question.dimension,
        prompt: question.prompt,
        answer: answer.answer,
        ideal_signals: question.idealSignals,
      },
      output_schema: {
        score: "integer 0..3",
        choice: "pass | clarify | fail",
        noul: "yes | no | unknown",
      },
    };
  }

  screenView(): Record<string, unknown> {
    const profile = this.requireProfile();
    return {
      candidate: profile.candidateName,
      phone: profile.candidatePhone,
      role: profile.role,
      status: this.state.status,
      currentQIdx: this.state.currentQIdx,
      answers: [...this.state.answers].sort((a, b) => a.qIdx - b.qIdx),
      scores: [...this.state.scores].sort((a, b) => a.qIdx - b.qIdx),
      summary: this.summary(),
      events: this.state.events.slice(-10),
    };
  }

  summary(): Record<string, unknown> {
    const complete = this.isComplete();
    const average =
      this.state.scores.length === 0
        ? 0
        : this.state.scores.reduce((sum, row) => sum + row.score, 0) / this.state.scores.length;
    const needsReview = this.state.scores.some((row) => row.noul !== "no");
    const fails = this.state.scores.filter((row) => row.choice === "fail").length;
    return {
      complete,
      averageScore: Number(average.toFixed(2)),
      recommendedNextStep: needsReview ? "human_review" : average >= 2.2 && fails === 0 ? "advance" : "review_or_decline",
    };
  }

  private assistantInstructions(profile: CandidateProfile): string {
    return screenCallInstructions(profile, { withTool: true, answeredQuestions: "none" });
  }

  private isComplete(): boolean {
    const profile = this.requireProfile();
    return profile.rubric.every((question) => this.state.answers.some((answer) => answer.qIdx === question.qIdx));
  }

  private finalStatus(): ScreenState["status"] {
    return this.state.scores.some((row) => row.noul !== "no") ? "needs_human_review" : "complete";
  }

  private upsertScore(score: ScoreRow): void {
    const existing = this.state.scores.findIndex((row) => row.qIdx === score.qIdx);
    if (existing >= 0) {
      this.state.scores[existing] = score;
    } else {
      this.state.scores.push(score);
    }
  }

  private requireProfile(): CandidateProfile {
    if (!this.state.profile) {
      throw new Error("openScreen must run before this operation");
    }
    return this.state.profile;
  }

  private append(type: string, detail: Record<string, unknown>): void {
    this.state.events.push({ ts: new Date().toISOString(), type, detail });
  }
}

export function scoreWithDecisionModelShape(question: RubricQuestion, answer: string): ScoreRow {
  const normalized = answer.toLowerCase().trim();
  const hits = question.idealSignals.filter((signal) => normalized.includes(signal.toLowerCase())).length;
  const hasExample = /\b(example|when|built|shipped|measured|debugged|because)\b/.test(normalized);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const thin = wordCount < 8;
  let score: 0 | 1 | 2 | 3;
  if (thin) {
    score = 0;
  } else if (hits === 0) {
    score = wordCount >= 15 ? 1 : 0;
  } else {
    score = Math.min(3, hits + (wordCount >= 40 ? 1 : 0)) as 0 | 1 | 2 | 3;
  }
  const choice: ScreenChoice = score >= 2 ? "pass" : score === 1 ? "clarify" : "fail";
  const noul: HumanReview = thin || normalized.includes("visa") || normalized.includes("accommodation") ? "yes" : "no";
  const reason =
    hits === 0
      ? wordCount >= 15
        ? `no rubric signals but substantive, ${wordCount} words`
        : `no rubric signals, ${wordCount} words${thin ? ", too short" : ""}`
      : `${hits} rubric signal(s), ${wordCount} words, ${hasExample ? "specific example" : "no specific example"}`;
  return {
    qIdx: question.qIdx,
    score,
    choice,
    noul,
    reason,
  };
}

function normalizeProfile(profile: CandidateProfile): CandidateProfile {
  const source = profile.rubric.length > 0 ? profile.rubric : defaultRubric(profile.role);
  const rubric = source.map((question, index) => ({ ...question, qIdx: index }));
  if (rubric.length !== 5) {
    throw new Error("this sample expects exactly five screening questions");
  }
  return { ...profile, rubric };
}
