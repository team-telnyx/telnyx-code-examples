import { Agent, type KvNamespace } from "@telnyx/edge-runtime";
import type Telnyx from "telnyx";
import {
  incrementFailures,
  readBreaker,
  resetBreaker,
  setLastFail,
  tripBreaker,
  type BreakerSnapshot,
  type KvLike,
} from "./breaker.js";
import { recordEvent, kvSafeId, demoModeEnabled, configValue } from "./events.js";


/**
 * FailoverAgent — the durable actor that owns the circuit breaker and the
 * fraud-alert call flow. One instance (named "failover") serializes every
 * webhook event, so breaker mutations and per-call stages never race.
 */

/** Telnyx Call Control webhook: `{ data: { event_type, payload } }`. */
export interface CallControlEvent {
  data: {
    event_type: string;
    payload: Record<string, unknown>;
  };
}

/** Where a call leg was dialed, recorded by the worker after `calls.dial`. */
export interface CallRoutingMap {
  connection_id: string;
  to: string;
}

export type CallStage = "announced" | "confirming";

export interface FailureOutcome {
  snapshot: BreakerSnapshot;
  trippedNow: boolean;
}

export interface FailoverState extends Record<string, unknown> {
  failuresHandled: number;
  breakerTrips: number;
  callsAnnounced: number;
  responsesResolved: number;
  lastFailureAt: number;
  updatedAt: number;
}

/**
 * Bindings visible inside the actor. `[telnyx]` exposes the real Telnyx API
 * client (Call Control + Messaging); the rest come from `[env_vars]` and the
 * `[storage.kv]` binding in telnyx.toml.
 */
export interface FailoverEnv {
  TELNYX: Pick<Telnyx, "calls" | "messages">;
  FAILOVER_KV?: KvNamespace;
  DEMO_MODE?: string;
  TELNYX_PRIMARY_CONNECTION_ID?: string;
  TELNYX_BACKUP_CONNECTION_ID?: string;
  TELNYX_FROM_NUMBER?: string;
  SMS_FROM_NUMBER?: string;
  TELNYX_OPS_ALERT_NUMBER?: string;
  FAILURE_THRESHOLD?: string;
  COOLDOWN_SECONDS?: string;
  TTS_VOICE?: string;
}

const FAILURE_HANGUP_CAUSES = new Set([
  "NO_ANSWER",
  "USER_BUSY",
  "CALL_REJECTED",
  "DESTINATION_OUT_OF_ORDER",
  "NETWORK_OUT_OF_ORDER",
  "NO_ROUTE_DESTINATION",
  "SERVICE_UNAVAILABLE",
  "TIMEOUT",
]);

/** Call routing maps and stages are call-scoped; a day bounds KV growth. */
const CALL_MAP_TTL_SECONDS = 86400;

function isFailureHangupCause(hangupCause: string): boolean {
  return FAILURE_HANGUP_CAUSES.has(hangupCause.toUpperCase());
}



function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class FailoverAgent extends Agent<FailoverEnv, FailoverState> {
  protected override initialState(): FailoverState {
    return {
      failuresHandled: 0,
      breakerTrips: 0,
      callsAnnounced: 0,
      responsesResolved: 0,
      lastFailureAt: 0,
      updatedAt: 0,
    };
  }

  /**
   * Record one failure signal for the primary connection: increment the KV
   * counter, timestamp it, and trip the breaker (with an ops SMS) once the
   * threshold is crossed. Non-primary connections are never counted.
   */
  async recordOutcome(event: CallControlEvent): Promise<FailureOutcome> {
    const payload = event.data?.payload ?? {};
    const connectionId = stringValue(payload.connection_id);
    const primary = this.env.TELNYX_PRIMARY_CONNECTION_ID ?? "";
    if (connectionId !== primary) {
      this.log(`Failure on non-primary connection: ${connectionId}`);
      return { snapshot: await readBreaker(this.kvStore()), trippedNow: false };
    }

    const kv = this.kvStore();
    const failures = await incrementFailures(kv);
    const nowSeconds = Date.now() / 1000;
    await setLastFail(kv, nowSeconds);
    this.log(`Primary connection failure count: ${failures}`);

    const state = await this.setState({
      failuresHandled: (await this.getState()).failuresHandled + 1,
      lastFailureAt: Math.round(nowSeconds * 1000),
      updatedAt: Date.now(),
    });

    let trippedNow = false;
    if (failures >= intEnv(this.env.FAILURE_THRESHOLD, 3)) {
      const snapshot = await readBreaker(kv);
      if (!snapshot.tripped) {
        await this.tripBreakerWithAlert(kv, failures, nowSeconds, state.breakerTrips);
        trippedNow = true;
      } else {
        this.log("Circuit breaker already tripped.");
      }
    }
    return { snapshot: await readBreaker(kv), trippedNow };
  }

  /**
   * Call-flow dispatch for non-failure events: call.answered announces the
   * fraud alert, call.speak.ended drives the greeting/confirming stage
   * machine, and call.gather.ended resolves the caller's 1/2 response.
   */
  async handleCallEvent(event: CallControlEvent): Promise<{ action: string }> {
    const eventType = stringValue(event.data?.event_type);
    const payload = event.data?.payload ?? {};
    const callControlId = stringValue(payload.call_control_id);

    if (eventType === "call.answered") {
      await this.announceRouting(callControlId);
      return { action: "announced" };
    }
    if (eventType === "call.speak.ended") {
      return this.onSpeakEnded(callControlId);
    }
    if (eventType === "call.speak.failed") {
      const reason = stringValue((payload as Record<string, unknown>).reason);
      this.log(`TTS playback failed${reason ? ` (${reason})` : ""} — trying next variant`);
      await recordEvent(
        this.kvStore(),
        "webhook",
        `call.speak.failed${reason ? `: ${reason}` : ""}`,
      );
      return this.onSpeakFailed(callControlId);
    }
    if (eventType === "call.gather.ended") {
      const digits = stringValue(payload.digits);
      this.log(`Caller pressed: ${digits || "(nothing)"}`);
      await this.resolveCardNotification(callControlId, digits);
      return { action: "resolved" };
    }
    return { action: "ignored" };
  }

  /** Reset the breaker to CLOSED. */
  async resetBreaker(): Promise<BreakerSnapshot> {
    const snapshot = await resetBreaker(this.kvStore());
    this.log("Circuit breaker reset to CLOSED state.");
    await recordEvent(this.kvStore(), "breaker_reset", "breaker reset to closed", "primary");
    return snapshot;
  }

  /** Current breaker state for worker-side reads when no KV binding reaches the fetch env. */
  async snapshot(): Promise<BreakerSnapshot> {
    return readBreaker(this.kvStore());
  }

  /** Register a dialed call's connection mapping (worker fallback when KV is absent there). */
  async noteCall(callControlId: string, connectionId: string, to: string): Promise<void> {
    await this.putCallMap(callControlId, { connection_id: connectionId, to });
  }

  /** Connection that carried a call (empty when unknown). */
  async connectionFor(callControlId: string): Promise<string> {
    const map = await this.getCallMap(callControlId);
    return map?.connection_id ?? "";
  }

  // ── Breaker internals ─────────────────────────────────────────────────────

  private async demoMode(): Promise<boolean> {
    return demoModeEnabled(this.env.FAILOVER_KV, this.env.DEMO_MODE);
  }

  private async tripBreakerWithAlert(
    kv: KvLike,
    failures: number,
    nowSeconds: number,
    previousTrips: number,
  ): Promise<void> {
    await tripBreaker(kv, nowSeconds);
    await recordEvent(
      kv,
      "breaker_tripped",
      `failures: ${failures} — auto-failover to backup connection`,
      "primary",
    );
    const backupId = this.env.TELNYX_BACKUP_CONNECTION_ID ?? "";
    const alertMsg =
      `[${new Date().toISOString()}] ` +
      "Circuit breaker TRIPPED for primary SIP connection. " +
      `Failures: ${failures}. ` +
      `Auto-failover to backup connection ${backupId}.`;
    const opsNumber =
      (await configValue(this.env.FAILOVER_KV, "ops-alert-number", this.env.TELNYX_OPS_ALERT_NUMBER)) ?? "";
    if (await this.demoMode()) {
      this.log(`[DEMO MODE] SMS alert (not sent): ${alertMsg}`);
      await this.events.emit("ops.sms.demo", { to: opsNumber, text: alertMsg });
      await recordEvent(kv, "sms_sent", "ops alert SMS (demo — not sent)", "primary");
    } else {
      try {
        await this.sendSms(opsNumber, alertMsg);
        this.log("SMS alert sent to ops.");
        await recordEvent(kv, "sms_sent", "ops alert SMS sent", "primary");
      } catch (error: unknown) {
        this.log(`Failed to send SMS alert: ${this.errorMessage(error)}`);
        await recordEvent(kv, "sms_sent", `ops alert SMS FAILED: ${this.errorMessage(error).slice(0, 120)}`, "primary");
      }
    }
    await this.setState({
      breakerTrips: previousTrips + 1,
      updatedAt: Date.now(),
    });
  }

  // ── Call flow ─────────────────────────────────────────────────────────────

  /** Deliver the plain-language fraud alert on call.answered. */
  /**
   * TTS variants, most-preferred first: SSML+Ultra → plain+Ultra → plain+NaturalHD.
   * call.speak.failed advances through them; the API accepts the command but the
   * playback can fail, so the retry rides the webhook rather than the exception.
   */
  /**
   * TTS safety net: the API accepted the speak but playback failed. For the
   * announcement, re-issue gather_using_speak with the fallback voice; for the
   * confirmation, just hang up so the caller is not stranded in silence.
   */
  private async onSpeakFailed(callControlId: string): Promise<{ action: string }> {
    const stage = await this.getStage(callControlId);
    if (stage === "confirming") {
      await this.actionsHangup(callControlId);
      return { action: "hangup-after-failed-confirmation" };
    }
    if (stage === "announced") {
      await this.announceRouting(callControlId, true);
      return { action: "retried-with-fallback-voice" };
    }
    this.log("TTS retries exhausted — hanging up.");
    await this.actionsHangup(callControlId);
    return { action: "tts-exhausted" };
  }

  /**
   * The announcement: one `gather_using_speak` command speaks the fraud alert
   * AND collects the 1/2 keypress — digits work DURING the announcement, so
   * the caller never waits for a gather window. Plain text, production-proven
   * speak shape (no payload_type).
   */
  private async announceRouting(callControlId: string, isRetry = false): Promise<void> {
    if (!callControlId) return;
    const existingStage = await this.getStage(callControlId);
    if (!isRetry && existingStage) {
      this.log(`Webhook redelivery — announcement already in progress (stage: ${existingStage}). Skipping.`);
      return;
    }
    const map = await this.getCallMap(callControlId);
    const primary = this.env.TELNYX_PRIMARY_CONNECTION_ID ?? "";
    const backup = this.env.TELNYX_BACKUP_CONNECTION_ID ?? "";
    const connectionId = map?.connection_id || primary;
    const label = connectionId === backup ? "backup" : "primary";
    let intro = "Good afternoon. This is Meridian Trust Bank's automated fraud alert service.";
    if (label === "backup") {
      intro +=
        " Heads up: we're running on our backup systems right now after a brief " +
        "technical issue, so this call may sound different. Everything is fully operational.";
    }
    const text =
      `${intro} ` +
      "This is an urgent notification about your card ending in 4-8-2-1. " +
      "About an hour ago, we detected a purchase of one thousand, two hundred and forty " +
      "dollars and fifty cents at an electronics retailer in Miami, Florida. " +
      "If this purchase was you, press 1. " +
      "If you don't recognize it, press 2, and we'll block your card immediately.";
    await this.putStage(callControlId, "announced");
    const voice =
      (await configValue(this.env.FAILOVER_KV, "tts-voice", this.env.TTS_VOICE)) ||
      "Telnyx.NaturalHD.Alloy";
    try {
      await this.env.TELNYX.calls.actions.gatherUsingSpeak(callControlId, {
        payload: text,
        voice,
        language: "en-US",
        valid_digits: "12",
        maximum_digits: 1,
        terminating_digit: "",
        timeout_millis: 15000,
        inter_digit_timeout_millis: 5000,
        command_id: `failover-announce-${Date.now()}`,
      });
      this.log(`Fraud alert announced (gather_using_speak) via ${label} connection using ${voice}.`);
      await recordEvent(
        this.kvStore(),
        "call_answered",
        `fraud alert announced via ${label} connection (${voice})`,
        label,
      );
    } catch (error: unknown) {
      if (!isRetry) {
        this.log(`gather_using_speak rejected (${this.errorMessage(error)}) — retrying with the fallback voice.`);
        await this.announceRouting(callControlId, true);
        return;
      }
      this.log(`Announcement failed on both voices: ${this.errorMessage(error)}`);
      await recordEvent(this.kvStore(), "webhook", "announcement failed on both voices");
    }
  }

  /** Stage machine: announced (gather active) → confirming (resolution spoken) → hangup. */
  private async onSpeakEnded(callControlId: string): Promise<{ action: string }> {
    const stage = await this.getStage(callControlId);
    if (stage === "confirming") {
      await this.actionsHangup(callControlId);
      return { action: "hangup-after-confirmation" };
    }
    return { action: "gather-active" };
  }

  /** Resolve the caller's 1/2 response: confirmation speech + SMS receipt. */
  private async resolveCardNotification(callControlId: string, digits: string): Promise<void> {
    const stage = await this.getStage(callControlId);
    if (stage === "confirming") {
      this.log("Webhook redelivery — resolution already in progress. Skipping.");
      return;
    }
    const map = await this.getCallMap(callControlId);
    const caller = map?.to ?? "";
    const ref = `MTB-${(Math.floor(Date.now() / 1000) % 100000).toString().padStart(5, "0")}`;
    let confirmation: string;
    let sms: string;
    let outcome: string;
    if (digits === "1") {
      confirmation =
        "Thank you for confirming. That purchase was yours, so nothing more is needed. " +
        "A confirmation text is on its way to this phone. Goodbye.";
      sms =
        "Meridian Trust: You confirmed the $1,240.50 purchase " +
        "(card ...4821). Nothing more is needed. Ref: " + ref;
      outcome = "transaction confirmed";
      this.log("Caller confirmed the transaction.");
    } else if (digits === "2") {
      confirmation =
        "Understood. We've blocked that purchase and frozen your card ending in 4-8-2-1 " +
        "effective immediately. A fraud specialist will contact you shortly, " +
        "and a confirmation text is on its way. Goodbye.";
      sms =
        "Meridian Trust: The $1,240.50 purchase (card ...4821) was BLOCKED " +
        "and your card frozen. A specialist will contact you. Ref: " + ref;
      outcome = "fraud reported — card frozen";
      this.log("Caller reported fraud — card frozen.");
    } else {
      confirmation =
        "We didn't catch your response, so to keep you safe we've frozen your card " +
        "ending in 4-8-2-1 and flagged the purchase for review. " +
        "A confirmation text is on its way. Goodbye.";
      sms =
        "Meridian Trust: No response received — card ...4821 frozen and the " +
        "$1,240.50 purchase flagged for review. Ref: " + ref;
      outcome = "no response — card frozen (safe default)";
      this.log("No response received — safe-default froze the card.");
    }
    await recordEvent(this.kvStore(), "caller_response", `pressed ${digits || "(nothing)"} — ${outcome}`);
    if (caller) {
      try {
        await this.sendCustomerSms(caller, sms);
        await recordEvent(this.kvStore(), "sms_sent", `customer receipt SMS (${outcome})`);
      } catch (error: unknown) {
        await recordEvent(
          this.kvStore(),
          "sms_sent",
          `customer receipt SMS FAILED: ${this.errorMessage(error).slice(0, 120)}`,
        );
      }
    }
    await this.putStage(callControlId, "confirming");
    await this.speakConfirmation(callControlId, confirmation);
  }

  /** Confirmation speech: plain text, Ultra voice with NaturalHD fallback. */
  private async speakConfirmation(callControlId: string, text: string): Promise<void> {
    const voice =
      (await configValue(this.env.FAILOVER_KV, "tts-voice", this.env.TTS_VOICE)) ||
      "Telnyx.NaturalHD.Alloy";
    try {
      await this.env.TELNYX.calls.actions.speak(callControlId, {
        payload: text,
        voice,
        language: "en-US",
        command_id: `failover-confirm-${Date.now()}`,
      });
      return;
    } catch (error: unknown) {
      this.log(`Confirmation speak rejected (${this.errorMessage(error)}) — trying the fallback voice.`);
    }
    try {
      await this.env.TELNYX.calls.actions.speak(callControlId, {
        payload: text,
        voice: "Telnyx.NaturalHD.Alloy",
        language: "en-US",
        command_id: `failover-confirm-fb-${Date.now()}`,
      });
    } catch (error: unknown) {
      this.log(`Fallback confirmation also failed: ${this.errorMessage(error)}`);
      await this.actionsHangup(callControlId);
    }
  }

  private async actionsHangup(callControlId: string): Promise<void> {
    try {
      await this.env.TELNYX.calls.actions.hangup(callControlId, {});
    } catch (error: unknown) {
      this.log(`Hangup failed: ${this.errorMessage(error)}`);
    }
  }

  private async sendCustomerSms(toNumber: string, text: string): Promise<void> {
    if (await this.demoMode()) {
      this.log(`[DEMO MODE] SMS to ${toNumber} (not sent): ${text}`);
      await this.events.emit("customer.sms.demo", { to: toNumber, text });
      return;
    }
    await this.sendSms(toNumber, text);
    this.log(`Customer SMS sent to ${toNumber.slice(0, 6)}...`);
  }

  /**
   * SMS sender. The from number is KV-first (`config/sms-from`) because env
   * vars are captured at function creation — vars added later never reach the
   * runtime, and silently falling back to the unverified toll-free fails at
   * the carrier. Failures propagate so the caller records the true outcome.
   */
  private async sendSms(to: string, text: string): Promise<void> {
    const from =
      (await configValue(this.env.FAILOVER_KV, "sms-from", this.env.SMS_FROM_NUMBER)) ||
      this.env.TELNYX_FROM_NUMBER ||
      "";
    await this.env.TELNYX.messages.send({ from, to, text });
  }

  // ── KV helpers ────────────────────────────────────────────────────────────

  /**
   * Prefer the FAILOVER_KV binding (shared with the worker so both sides see
   * the same breaker state). Current local Edge stacks expose the actor's
   * durable key-value storage even when an external KV binding is not injected
   * into actor processes.
   */
  private kvStore(): KvLike {
    const binding = this.env.FAILOVER_KV;
    if (binding) return binding;
    return {
      get: async (key) => {
        const value = await this.ctx.storage.get<string>(key);
        return value === undefined || value === null ? null : String(value);
      },
      put: async (key, value) => {
        await this.ctx.storage.put(key, value);
      },
    };
  }

  private callMapKey(callControlId: string): string {
    return `call/${kvSafeId(callControlId)}`;
  }

  private stageKey(callControlId: string): string {
    return `stage/${kvSafeId(callControlId)}`;
  }

  private async putCallMap(callControlId: string, map: CallRoutingMap): Promise<void> {
    await this.kvStore().put(
      this.callMapKey(callControlId),
      JSON.stringify(map),
      { expirationTtl: CALL_MAP_TTL_SECONDS },
    );
  }

  private async getCallMap(callControlId: string): Promise<CallRoutingMap | null> {
    const raw = await this.kvStore().get(this.callMapKey(callControlId));
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const record = parsed as Record<string, unknown>;
      return {
        connection_id: stringValue(record.connection_id),
        to: stringValue(record.to),
      };
    } catch {
      return null;
    }
  }

  private async getStage(callControlId: string): Promise<CallStage | null> {
    const raw = await this.kvStore().get(this.stageKey(callControlId));
    return raw === "announced" || raw === "confirming" ? raw : null;
  }

  private async putStage(callControlId: string, stage: CallStage): Promise<void> {
    await this.kvStore().put(this.stageKey(callControlId), stage, { expirationTtl: CALL_MAP_TTL_SECONDS });
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  private log(message: string): void {
    console.log(`[failover] ${message}`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
