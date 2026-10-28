import Telnyx from "telnyx";
import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
  type Secrets,
} from "@telnyx/edge-runtime";

export type DeepfakeResult = "real" | "fake" | "silence_timeout";
export type GateOutcome = "proceed" | "step_up_flashcall" | "manual_review" | "blocked_pending";

export interface AssistantPayload {
  name: string;
  instructions: string;
  greeting: string;
  voice_settings: { voice: string; expressive_mode: boolean };
  telephony_settings: { time_limit_secs: number };
  enabled_features: string[];
  tools: Array<{ type: "webhook"; webhook: { name: string; description: string; url: string; method: string } }>;
}

export interface DialPayload {
  connection_id: string;
  from: string;
  to: string;
  deepfake_detection: { enabled: boolean; timeout: number };
  time_limit_secs: number;
  client_state: string;
  webhook_url?: string;
}

export const VERIFICATION_PROMPT =
  "This call includes a voice-authenticity screen, not identity verification. Please state your name and confirm whether you requested the two thousand five hundred dollar wire transfer on this account.";

export const VERIFICATION_VOICE = "AWS.Polly.Joanna-Neural";
export const ASSISTANT_VOICE = "Telnyx.Ultra.a7a59115-2425-4192-844c-1e98ec7d6877";

export function verdictGreeting(outcome: string): string {
  if (outcome === "proceed") {
    return "The voice passed the synthetic-voice screen. This demo policy would allow the request, but that does not prove your identity. Complete the independent verification step before a real transfer.";
  }
  if (outcome === "step_up_flashcall") {
    return "For your security, we could not fully verify your voice on this call. Additional verification is required before this transfer can be completed.";
  }
  return "We were unable to verify this request automatically. A specialist will review it and follow up with you shortly.";
}

export interface FlashcallPayload {
  phone_number: string;
  verify_profile_id: string;
  type: "flashcall";
  metadata: { account_id: string; action: string; call_sid: string | null };
}

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

export interface GateState extends Record<string, unknown> {
  accountId: string | null;
  pendingAction: SensitiveAction | null;
  callSid: string | null;
  assistantId: string | null;
  ledger: LedgerRow[];
  escalations: LedgerRow[];
  status: "idle" | "listening" | "step_up" | "manual_review" | "approved";
  mirroredRows: number;
}

export interface EnvLike {
  TELNYX_API_KEY?: string;
  TELNYX_PUBLIC_KEY?: string;
  OUTBOUND_CONNECTION_ID?: string;
  OUTBOUND_CALLER_ID?: string;
  FLASHCALL_VERIFY_PROFILE_ID?: string;
  HUMAN_REVIEW_NUMBER?: string;
  RECENT_FLAG_WINDOW_MINUTES?: string;
  MAX_CALL_MINUTES?: string;
  WEBHOOK_URL?: string;
}

export interface Env extends EnvLike {
  FRAUD_GATES_V2?: FraudGateNamespace;
}

type FraudGateStub = ActorStub &
  Pick<
    VoiceFraudGateAgent,
    | "requestSensitiveAction"
    | "playVerificationPrompt"
    | "recordDeepfakeResult"
    | "recordDeepfakeError"
    | "confirmSensitiveAction"
    | "screenView"
  >;

interface FraudGateNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): FraudGateStub;
}

export interface GateDecision {
  outcome: GateOutcome;
  reason: string;
  flashcallPayload?: FlashcallPayload;
  assistantPayload?: AssistantPayload;
  dialPayload?: DialPayload;
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

export class VoiceFraudGateModel {
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
      mirroredRows: 0,
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

  buildAssistantPayload(
    action = this.requireAction(),
    confirmUrl = "https://example.com/fraud/confirm-sensitive-action",
  ): AssistantPayload {
    return {
      name: `voice fraud step-up for ${action.accountId}`,
      instructions: [
        "you are a support verification agent for a high-risk account action.",
        "keep the caller on the line while telnyx deepfake detection evaluates the remote-party audio.",
        "when you have heard the caller's response, call the confirm_sensitive_action webhook tool and relay its response exactly.",
        "never describe a real voice result as identity verification; deepfake detection checks voice authenticity, not account ownership.",
        "if the tool response is blocked, explain that extra verification is required before the action can be completed.",
        "do not complete the sensitive action until the actor confirms the policy outcome.",
      ].join("\n"),
      greeting: "Hi, this is automated fraud verification. Did you request a $2,500 wire transfer on this account?",
      voice_settings: {
        voice: ASSISTANT_VOICE,
        expressive_mode: true,
      },
      telephony_settings: {
        time_limit_secs: Number(this.env.MAX_CALL_MINUTES ?? DEFAULT_MAX_CALL_MINUTES) * 60,
      },
      enabled_features: ["telephony"],
      tools: [
        {
          type: "webhook",
          webhook: {
            name: "confirm_sensitive_action",
            description: "confirm the sensitive action once the risk gate allows proceed",
            url: confirmUrl,
            method: "POST",
          },
        },
      ],
    };
  }

  buildDialPayload(action = this.requireAction()): DialPayload {
    const payload: DialPayload = {
      connection_id: this.env.OUTBOUND_CONNECTION_ID ?? "replace-with-call-control-connection-id",
      from: this.env.OUTBOUND_CALLER_ID ?? "+15551234567",
      to: action.caller,
      deepfake_detection: {
        enabled: true,
        timeout: 30,
      },
      time_limit_secs: Number(this.env.MAX_CALL_MINUTES ?? DEFAULT_MAX_CALL_MINUTES) * 60,
      client_state: encodeClientState({ accountId: action.accountId }),
    };
    if (this.env.WEBHOOK_URL) {
      payload.webhook_url = this.env.WEBHOOK_URL;
    }
    return payload;
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
      this.state.escalations.push({ ...escalation });
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
      this.state.escalations.push({ ...escalation });
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
      reason: "human-sounding voice result and no recent flags were found; independent identity verification is outside this demo",
    };
  }

  decideFromLedger(result: DeepfakeResult, now = new Date().toISOString()): GateDecision {
    const hasRecentFlag = this.hasRecentFlag(now);
    if (result === "real" && !hasRecentFlag) {
      return { outcome: "proceed", reason: "human-sounding voice result and clean recent ledger; this is not identity proof" };
    }
    if (result === "fake" || hasRecentFlag) {
      return {
        outcome: "step_up_flashcall",
        reason: result === "fake" ? "synthetic voice detected" : "recent risky ledger event found",
      };
    }
    return { outcome: "manual_review", reason: "detection returned silence_timeout" };
  }

  buildFlashcallPayload(action = this.requireAction()): FlashcallPayload {
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
    this.state.mirroredRows = rows.length;
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
      const risky = row.deepfakeResult === "fake" || row.outcome === "manual_review";
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

interface DeepfakeWebhookBody {
  data?: { event_type?: string; id?: string; payload?: Record<string, unknown> };
  event_type?: string;
  payload?: Record<string, unknown>;
}

function encodeClientState(state: Record<string, string>): string {
  return btoa(JSON.stringify(state));
}

function decodeClientState(clientState: unknown): Record<string, string> {
  if (typeof clientState !== "string" || !clientState) return {};
  try {
    const parsed: unknown = JSON.parse(atob(clientState));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function verifyWebhook(req: Request): Promise<DeepfakeWebhookBody> {
  const body = await req.text();
  const publicKey = process.env.TELNYX_PUBLIC_KEY ?? "";
  if (!publicKey) {
    throw new Error("TELNYX_PUBLIC_KEY not configured — run `telnyx-edge secrets add TELNYX_PUBLIC_KEY <base64>`");
  }
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY ?? "verification-only" });
  return (await client.webhooks.unwrap(body, { headers, key: publicKey })) as DeepfakeWebhookBody;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, sample: "voice-fraud-step-up-agent", version: "edge-v2-sequenced" });
    }
    if (url.pathname === "/webhooks" && request.method === "POST") {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        return Response.json({ error: "unsupported media type" }, { status: 415 });
      }
      let event: DeepfakeWebhookBody;
      try {
        event = await verifyWebhook(request);
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : "webhook verification failed" },
          { status: 401 },
        );
      }
      const eventType = event.data?.event_type ?? event.event_type ?? "";
      const payload = event.data?.payload ?? event.payload ?? {};
      const accountId = decodeClientState(payload["client_state"])["accountId"] ?? "";
      if (!accountId) {
        return Response.json({ error: "missing accountId in client_state" }, { status: 400 });
      }
      if (env.FRAUD_GATES_V2 === undefined) {
        return Response.json({ error: "FRAUD_GATES_V2 binding not configured" }, { status: 500 });
      }
      const stub = env.FRAUD_GATES_V2.idFromName(actorNameForAccount(accountId));
      const callLegId = typeof payload["call_leg_id"] === "string" ? payload["call_leg_id"] : "unknown-leg";
      const callControlId = typeof payload["call_control_id"] === "string" ? payload["call_control_id"] : "";
      const eventId = typeof payload["id"] === "string" ? payload["id"] : (event.data?.id ?? "");
      if (eventType === "call.answered") {
        if (!callControlId) {
          return Response.json({ error: "missing call_control_id in webhook payload" }, { status: 400 });
        }
        await stub.playVerificationPrompt(callControlId, eventId || undefined);
        return Response.json({ ok: true, prompt: "verification prompt issued" });
      }
      if (eventType === "call.deepfake_detection.result") {
        const result = payload["result"];
        if (result !== "real" && result !== "fake" && result !== "silence_timeout") {
          return Response.json({ error: `unexpected detection result: ${String(result)}` }, { status: 400 });
        }
        const decision = await stub.recordDeepfakeResult(
          callLegId,
          result,
          callControlId || undefined,
          eventId || undefined,
        );
        return Response.json({ ok: true, decision });
      }
      if (eventType === "call.deepfake_detection.error") {
        const message = typeof payload["error_message"] === "string" ? payload["error_message"] : "unknown error";
        const decision = await stub.recordDeepfakeError(
          callLegId,
          message,
          callControlId || undefined,
          eventId || undefined,
        );
        return Response.json({ ok: true, decision });
      }
      return Response.json({ ok: true, ignored: eventType });
    }
    if (url.pathname === "/demo") {
      const action: SensitiveAction = {
        accountId: "acct_demo",
        caller: process.env.TARGET_PHONE ?? "+15558675309",
        action: "wire_transfer",
        amountCents: 250000,
        destination: "external account",
      };
      if (env.FRAUD_GATES_V2) {
        const stub = env.FRAUD_GATES_V2.idFromName(actorNameForAccount(action.accountId));
        const opened = await stub.requestSensitiveAction(action);
        if (process.env.TELNYX_API_KEY) {
          return Response.json({
            opened,
            note: "real call placed — answer on the target phone; the deepfake result arrives via webhook; check GET /demo/status",
          });
        }
        const decision = await stub.recordDeepfakeResult("call_demo", "fake");
        return Response.json({ opened, decision, view: await stub.screenView() });
      }
      const gate = new VoiceFraudGateModel(env);
      const opened = gate.requestSensitiveAction(action);
      const decision = gate.recordDeepfakeResult("call_demo", "fake");
      return Response.json({ opened, decision, view: gate.screenView() });
    }
    if (url.pathname === "/demo/status") {
      const account = url.searchParams.get("account") ?? "acct_demo";
      if (env.FRAUD_GATES_V2 === undefined) {
        return Response.json({ error: "FRAUD_GATES_V2 binding not configured" }, { status: 500 });
      }
      const stub = env.FRAUD_GATES_V2.idFromName(actorNameForAccount(account));
      return Response.json(await stub.screenView());
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};

export class VoiceFraudGateAgent extends Agent<Env, GateState> {
  protected override initialState(): GateState {
    return new VoiceFraudGateModel().state;
  }

  private async secret(name: string): Promise<string | undefined> {
    const secrets = (this.env as Record<string, unknown>)["SECRETS"];
    if (secrets && typeof (secrets as Secrets).get === "function") {
      try {
        return await (secrets as Secrets).get(name);
      } catch {
        return process.env[name];
      }
    }
    return process.env[name];
  }

  private async modelEnv(): Promise<Env> {
    return {
      ...this.env,
      TELNYX_API_KEY: await this.secret("TELNYX_API_KEY"),
      OUTBOUND_CONNECTION_ID: await this.secret("OUTBOUND_CONNECTION_ID"),
      OUTBOUND_CALLER_ID: await this.secret("OUTBOUND_CALLER_ID"),
      FLASHCALL_VERIFY_PROFILE_ID: await this.secret("FLASHCALL_VERIFY_PROFILE_ID"),
      WEBHOOK_URL: await this.secret("WEBHOOK_URL"),
    };
  }

  @rpc({ description: "Open a high-risk account action and start deepfake-gated verification" })
  async requestSensitiveAction(action: SensitiveAction): Promise<GateDecision> {
    const model = new VoiceFraudGateModel(await this.modelEnv(), await this.getState());
    const decision = model.requestSensitiveAction(action);
    const apiKey = await this.secret("TELNYX_API_KEY");
    if (apiKey) {
      const webhookUrl = await this.secret("WEBHOOK_URL");
      if (!webhookUrl) {
        throw new Error(
          "WEBHOOK_URL secret is required before real dials — set it to <this-function-url>/webhooks so deepfake webhooks route back to this actor",
        );
      }
      const assistantId = await this.ensureAssistant(model.buildAssistantPayload(action));
      model.state.assistantId = assistantId;
      const dialPayload = model.buildDialPayload(action);
      decision.dialPayload = dialPayload;
      const dialRes = await this.telnyxFetch("/v2/calls", {
        method: "POST",
        body: JSON.stringify(dialPayload),
      });
      if (!dialRes.ok) {
        throw new Error(`outbound dial failed with HTTP ${dialRes.status}`);
      }
    }
    await this.persistModel(model);
    return decision;
  }

  @rpc({ description: "Play the first verification question on the answered call while deepfake detection runs" })
  async playVerificationPrompt(callControlId: string, eventId?: string): Promise<void> {
    if (eventId && this.isDuplicateEvent(eventId)) return;
    const apiKey = await this.secret("TELNYX_API_KEY");
    if (!apiKey) return;
    const model = new VoiceFraudGateModel(await this.modelEnv(), await this.getState());
    try {
      const speakRes = await this.telnyxFetch(`/v2/calls/${encodeURIComponent(callControlId)}/actions/speak`, {
        method: "POST",
        body: JSON.stringify({ payload: VERIFICATION_PROMPT, voice: VERIFICATION_VOICE, language: "en-US" }),
      });
      if (!speakRes.ok) {
        console.error(`verification prompt failed: HTTP ${speakRes.status}: ${(await speakRes.text()).slice(0, 200)}`);
      }
      await this.setState(model.state);
    } catch (err) {
      console.error("verification prompt failed:", err instanceof Error ? err.message : err);
    }
    if (eventId) this.markEventProcessed(eventId);
  }

  @rpc({ description: "Record a Telnyx deepfake detection result webhook" })
  async recordDeepfakeResult(
    callSid: string,
    result: DeepfakeResult,
    callControlId?: string,
    eventId?: string,
  ): Promise<GateDecision> {
    const model = new VoiceFraudGateModel(await this.modelEnv(), await this.getState());
    if (eventId && this.isDuplicateEvent(eventId)) {
      const last = model.state.ledger[model.state.ledger.length - 1];
      return { outcome: last?.outcome ?? "blocked_pending", reason: `duplicate webhook event ignored (${eventId})` };
    }
    const decision = model.recordDeepfakeResult(callSid, result);
    const apiKey = await this.secret("TELNYX_API_KEY");
    const verifyProfileId = await this.secret("FLASHCALL_VERIFY_PROFILE_ID");
    if (decision.outcome === "step_up_flashcall" && decision.flashcallPayload && apiKey && verifyProfileId) {
      try {
        const flashRes = await this.telnyxFetch("/v2/verifications/flashcall", {
          method: "POST",
          body: JSON.stringify(decision.flashcallPayload),
        });
        if (!flashRes.ok) {
          console.error(
            `flashcall verification failed with HTTP ${flashRes.status} — the step-up is recorded in the ledger; retry manually`,
          );
        }
      } catch (err) {
        console.error("flashcall verification request failed:", err instanceof Error ? err.message : err);
      }
    }
    await this.persistModel(model);
    if (eventId) this.markEventProcessed(eventId);
    if (callControlId) {
      await this.deliverVerdictOnCall(callControlId, decision.outcome, model.state.assistantId);
    }
    return decision;
  }

  @rpc({ description: "Record a Telnyx deepfake detection error webhook" })
  async recordDeepfakeError(
    callSid: string,
    message: string,
    callControlId?: string,
    eventId?: string,
  ): Promise<GateDecision> {
    const model = new VoiceFraudGateModel(await this.modelEnv(), await this.getState());
    if (eventId && this.isDuplicateEvent(eventId)) {
      const last = model.state.ledger[model.state.ledger.length - 1];
      return { outcome: last?.outcome ?? "blocked_pending", reason: `duplicate webhook event ignored (${eventId})` };
    }
    const decision = model.recordDeepfakeError(callSid, message);
    await this.persistModel(model);
    if (eventId) this.markEventProcessed(eventId);
    if (callControlId) {
      await this.deliverVerdictOnCall(callControlId, decision.outcome, model.state.assistantId);
    }
    return decision;
  }

  @rpc({ description: "Confirm the sensitive action only if the stored policy decision allows it" })
  async confirmSensitiveAction(): Promise<GateDecision> {
    const model = new VoiceFraudGateModel(await this.modelEnv(), await this.getState());
    const decision = model.confirmSensitiveAction();
    await this.persistModel(model);
    return decision;
  }

  @rpc({ description: "Return the current account risk-gate ledger and decision view" })
  async screenView(): Promise<Record<string, unknown>> {
    return new VoiceFraudGateModel(await this.modelEnv(), await this.getState()).screenView();
  }

  private async telnyxFetch(path: string, init: RequestInit): Promise<Response> {
    const apiKey = await this.secret("TELNYX_API_KEY");
    if (!apiKey) {
      throw new Error("TELNYX_API_KEY secret not configured — run `telnyx-edge secrets add TELNYX_API_KEY <key>`");
    }
    return fetch(`https://api.telnyx.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
    });
  }

  private async ensureAssistant(payload: AssistantPayload): Promise<string> {
    const listRes = await this.telnyxFetch("/v2/ai/assistants", {});
    if (!listRes.ok) {
      throw new Error(`assistant list failed with HTTP ${listRes.status}`);
    }
    const list = (await listRes.json()) as { data?: Array<{ id: string; name?: string }> };
    const existing = (list.data ?? []).find((a) => a.name === payload.name);
    if (existing) {
      const updateRes = await this.telnyxFetch(`/v2/ai/assistants/${existing.id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!updateRes.ok) {
        throw new Error(`assistant update failed with HTTP ${updateRes.status}`);
      }
      return existing.id;
    }
    const createRes = await this.telnyxFetch("/v2/ai/assistants", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!createRes.ok) {
      throw new Error(`assistant create failed with HTTP ${createRes.status}`);
    }
    const created = (await createRes.json()) as { data?: { id?: string }; id?: string };
    return created.data?.id ?? created.id ?? "unknown-id";
  }

  private async deliverVerdictOnCall(callControlId: string, outcome: string, assistantId: string | null): Promise<void> {
    const apiKey = await this.secret("TELNYX_API_KEY");
    if (!apiKey || !assistantId) return;
    try {
      await this.telnyxFetch(`/v2/calls/${encodeURIComponent(callControlId)}/actions/ai_assistant_start`, {
        method: "POST",
        body: JSON.stringify({ assistant: { id: assistantId }, greeting: verdictGreeting(outcome) }),
      });
    } catch (err) {
      console.error("assistant verdict delivery failed:", err instanceof Error ? err.message : err);
    }
  }

  private isDuplicateEvent(eventId: string): boolean {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS processed_events(event_id TEXT UNIQUE, at INTEGER)");
    return this.ctx.storage.sql.exec("SELECT 1 FROM processed_events WHERE event_id = ?", eventId).toArray().length > 0;
  }

  private markEventProcessed(eventId: string): void {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO processed_events(event_id, at) VALUES (?, ?)", eventId, Date.now());
  }

  private async persistModel(model: VoiceFraudGateModel): Promise<void> {
    const state = model.state;
    await this.setState(state);
    const fresh = state.ledger.slice(state.mirroredRows);
    if (fresh.length === 0) return;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ledger(account TEXT, ts TEXT, call_sid TEXT, deepfake_result TEXT, action TEXT, outcome TEXT, source TEXT, note TEXT)",
    );
    for (const row of fresh) {
      this.ctx.storage.sql.exec(
        "INSERT INTO ledger(account, ts, call_sid, deepfake_result, action, outcome, source, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        row.accountId,
        row.ts,
        row.callSid,
        row.deepfakeResult,
        row.action,
        row.outcome,
        row.source,
        row.note,
      );
    }
    await this.setState({ mirroredRows: state.ledger.length });
  }
}
