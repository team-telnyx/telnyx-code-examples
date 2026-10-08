export type DeepfakeResult = "human" | "ai_generated" | "inconclusive";
export type GateOutcome = "proceed" | "step_up_flashcall" | "manual_review" | "blocked_pending";

export interface SensitiveAction {
  accountId: string;
  caller: string;
  action: "wire_transfer" | "password_reset" | "address_change" | "device_enrollment";
  amountCents?: number;
  destination?: string;
}

export interface LedgerRow {
  accountId: string;
  ts: string;
  callSid: string;
  deepfakeResult: DeepfakeResult | "error" | "not_started";
  action: SensitiveAction["action"];
  outcome: GateOutcome;
  source: "request" | "deepfake_webhook" | "policy" | "flashcall" | "human_review";
  note: string;
}

export interface GateState {
  accountId: string | null;
  pendingAction: SensitiveAction | null;
  callSid: string | null;
  assistantId: string | null;
  ledger: LedgerRow[];
  escalations: LedgerRow[];
  status: "idle" | "listening" | "step_up" | "manual_review" | "approved";
}

export interface EnvLike {
  OUTBOUND_TEXML_APP_ID?: string;
  OUTBOUND_CALLER_ID?: string;
  FLASHCALL_VERIFY_PROFILE_ID?: string;
  HUMAN_REVIEW_NUMBER?: string;
  RECENT_FLAG_WINDOW_MINUTES?: string;
  MAX_CALL_MINUTES?: string;
}

export interface GateDecision {
  outcome: GateOutcome;
  reason: string;
  flashcallPayload?: Record<string, unknown>;
  assistantPayload?: Record<string, unknown>;
  dialPayload?: Record<string, unknown>;
}

const DEFAULT_RECENT_FLAG_WINDOW_MINUTES = 1440;
const DEFAULT_MAX_CALL_MINUTES = 10;

export function actorNameForAccount(accountId: string): string {
  const clean = accountId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!clean) {
    throw new Error("accountId is required");
  }
  return `voice-fraud-gate-${clean}`;
}

export class VoiceFraudGate {
  readonly state: GateState;

  constructor(private readonly env: EnvLike = {}, initial?: Partial<GateState>) {
    this.state = {
      accountId: null,
      pendingAction: null,
      callSid: null,
      assistantId: null,
      ledger: [],
      escalations: [],
      status: "idle",
      ...initial,
    };
  }

  requestSensitiveAction(action: SensitiveAction): GateDecision {
    const actorName = actorNameForAccount(action.accountId);
    this.state.accountId = action.accountId;
    this.state.pendingAction = action;
    this.state.assistantId = `asst_fraud_${action.accountId}`;
    this.state.callSid = `call_${action.accountId}_${this.state.ledger.length + 1}`;
    this.state.status = "listening";
    this.append("not_started", "blocked_pending", "request", `request opened on ${actorName}`);

    return {
      outcome: "blocked_pending",
      reason: "waiting for Telnyx deepfake detection result",
      assistantPayload: this.buildAssistantPayload(action),
      dialPayload: this.buildDialPayload(action),
    };
  }

  buildAssistantPayload(action = this.requireAction()): Record<string, unknown> {
    return {
      name: `voice fraud step-up for ${action.accountId}`,
      instructions: [
        "You are a support verification agent for a high-risk account action.",
        "Keep the caller on the line while Telnyx Deepfake Detection evaluates the remote-party audio.",
        "If the policy result is risky or inconclusive, explain that extra verification is required.",
        "Do not complete the sensitive action until the actor confirms the policy outcome.",
      ].join("\n"),
      voice_settings: {
        voice: "Telnyx.Ultra.Clara",
        expressive_mode: true,
      },
      telephony_settings: {
        deepfake_detection: true,
      },
      enabled_features: ["telephony"],
      tools: [
        {
          type: "webhook",
          name: "confirm_sensitive_action",
          url: "https://example.com/fraud/confirm-sensitive-action",
        },
      ],
    };
  }

  buildDialPayload(action = this.requireAction()): Record<string, unknown> {
    return {
      From: this.env.OUTBOUND_CALLER_ID ?? "+15551234567",
      To: action.caller,
      AIAssistantId: this.state.assistantId ?? `asst_fraud_${action.accountId}`,
      texml_app_id: this.env.OUTBOUND_TEXML_APP_ID ?? "replace-with-texml-app-id",
      MaxCallDuration: Number(this.env.MAX_CALL_MINUTES ?? DEFAULT_MAX_CALL_MINUTES) * 60,
    };
  }

  recordDeepfakeResult(callSid: string, result: DeepfakeResult, now = new Date().toISOString()): GateDecision {
    this.state.callSid = callSid;
    const action = this.requireAction();
    const decision = this.decideFromLedger(result, now);
    this.append(result, decision.outcome, "deepfake_webhook", decision.reason, now);
    if (decision.outcome === "proceed") {
      this.state.status = "approved";
      return decision;
    }
    this.state.status = decision.outcome === "manual_review" ? "manual_review" : "step_up";
    const escalation = this.state.ledger[this.state.ledger.length - 1];
    if (escalation) {
      this.state.escalations.push(escalation);
    }
    return {
      ...decision,
      flashcallPayload: decision.outcome === "step_up_flashcall" ? this.buildFlashcallPayload(action) : undefined,
    };
  }

  recordDeepfakeError(callSid: string, message: string, now = new Date().toISOString()): GateDecision {
    this.state.callSid = callSid;
    const action = this.requireAction();
    this.append("error", "manual_review", "deepfake_webhook", message, now);
    const escalation = this.state.ledger[this.state.ledger.length - 1];
    if (escalation) {
      this.state.escalations.push(escalation);
    }
    this.state.status = "manual_review";
    return {
      outcome: "manual_review",
      reason: `deepfake detection error for ${action.accountId}: ${message}`,
    };
  }

  confirmSensitiveAction(): GateDecision {
    const last = this.lastDecision();
    if (!last || last.outcome !== "proceed") {
      return {
        outcome: "blocked_pending",
        reason: "sensitive action cannot be confirmed until policy allows proceed",
      };
    }
    this.state.status = "approved";
    return {
      outcome: "proceed",
      reason: "deepfake result was human and no recent flags were found",
    };
  }

  decideFromLedger(result: DeepfakeResult, now = new Date().toISOString()): GateDecision {
    const hasRecentFlag = this.hasRecentFlag(now);
    if (result === "human" && !hasRecentFlag) {
      return { outcome: "proceed", reason: "human voice result and clean recent ledger" };
    }
    if (result === "ai_generated" || hasRecentFlag) {
      return {
        outcome: "step_up_flashcall",
        reason: result === "ai_generated" ? "synthetic voice detected" : "recent risky ledger event found",
      };
    }
    return { outcome: "manual_review", reason: "deepfake result was inconclusive" };
  }

  buildFlashcallPayload(action = this.requireAction()): Record<string, unknown> {
    return {
      phone_number: action.caller,
      verify_profile_id: this.env.FLASHCALL_VERIFY_PROFILE_ID ?? "replace-with-verify-profile-id",
      type: "flashcall",
      metadata: {
        account_id: action.accountId,
        action: action.action,
        call_sid: this.state.callSid,
      },
    };
  }

  screenView(): Record<string, unknown> {
    return {
      accountId: this.state.accountId,
      status: this.state.status,
      pendingAction: this.state.pendingAction,
      callSid: this.state.callSid,
      latestDecision: this.lastDecision(),
      ledger: [...this.state.ledger],
      escalations: [...this.state.escalations],
    };
  }

  rehydrateFromLedger(rows: LedgerRow[]): void {
    this.state.ledger = [...rows];
    const latest = rows[rows.length - 1];
    if (!latest) {
      this.state.status = "idle";
      return;
    }
    this.state.accountId = latest.accountId;
    this.state.callSid = latest.callSid;
    this.state.status =
      latest.outcome === "proceed"
        ? "approved"
        : latest.outcome === "manual_review"
          ? "manual_review"
          : latest.outcome === "step_up_flashcall"
            ? "step_up"
            : "listening";
  }

  private hasRecentFlag(now: string): boolean {
    const windowMs = Number(this.env.RECENT_FLAG_WINDOW_MINUTES ?? DEFAULT_RECENT_FLAG_WINDOW_MINUTES) * 60 * 1000;
    const nowMs = Date.parse(now);
    return this.state.ledger.some((row) => {
      const ageMs = nowMs - Date.parse(row.ts);
      const risky = row.deepfakeResult === "ai_generated" || row.outcome === "manual_review";
      return risky && ageMs >= 0 && ageMs <= windowMs;
    });
  }

  private lastDecision(): LedgerRow | null {
    return this.state.ledger[this.state.ledger.length - 1] ?? null;
  }

  private requireAction(): SensitiveAction {
    if (!this.state.pendingAction) {
      throw new Error("requestSensitiveAction must run before this operation");
    }
    return this.state.pendingAction;
  }

  private append(
    deepfakeResult: LedgerRow["deepfakeResult"],
    outcome: GateOutcome,
    source: LedgerRow["source"],
    note: string,
    ts = new Date().toISOString()
  ): void {
    const action = this.requireAction();
    this.state.ledger.push({
      accountId: action.accountId,
      ts,
      callSid: this.state.callSid ?? "pending",
      deepfakeResult,
      action: action.action,
      outcome,
      source,
      note,
    });
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, sample: "voice-fraud-step-up-agent" });
    }
    if (url.pathname === "/demo") {
      const gate = new VoiceFraudGate();
      const opened = gate.requestSensitiveAction({
        accountId: "acct_demo",
        caller: "+15558675309",
        action: "wire_transfer",
        amountCents: 250000,
        destination: "external account",
      });
      const decision = gate.recordDeepfakeResult("call_demo", "ai_generated");
      return Response.json({ opened, decision, view: gate.screenView() });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};
