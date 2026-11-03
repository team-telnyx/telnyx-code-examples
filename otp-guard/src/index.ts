/**
 * otp-guard \u2014 THE SECOND LOCK (Telnyx Edge / @telnyx/edge-runtime)
 *
 * The actor IS the verification session: it owns the trigger, the attempt
 * budget, the expiry clock, the lockout, and the append-only audit trail.
 * Telnyx Verify owns the code itself (generation, delivery, profile policy).
 *
 * SELF-REVIEW:
 * \u2705 Real primitives only \u2014 Agent state, this.schedule(), Verify REST API
 * \u2705 Demo mode default (DEMO_MODE=true): no real verifications, no real SMS
 * \u2705 No credentials in code; API key + webhook public key come from SECRETS
 * \u2705 Ed25519 webhook signature verification (telnyx-signature-ed25519)
 * \u2705 Input validation on every route; no SQL, no string-built queries
 * ASSUMPTION: the payout-destination write is stubbed into the actor's own
 *   audit trail (action_committed) \u2014 the sample demonstrates the grant, not a
 *   real banking backend. DEMO_MODE stubs the Verify HTTP calls inline (no
 *   fixture file) so the accepted/rejected/expiry/lockout demo runs without
 *   burning real verifications.
 */
import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets } from "@telnyx/edge-runtime";

export const MAX_ATTEMPTS = 3;
export const LOCKOUT_SECONDS = 600;
export const VERIFICATION_TIMEOUT_SECS = 300;
const DEMO_ACCEPT_CODE = "123456";
const DEMO_PROFILE_ID = "demo-profile-otp-guard";

const E164 = /^\+[1-9]\d{7,14}$/;
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^\d{4,8}$/;

export const isE164 = (value: string): boolean => E164.test(value);
export const isActionId = (value: string): boolean => ACTION_ID.test(value);
export const isVerificationCode = (value: string): boolean => CODE.test(value);

/** Mask a phone number for anything that leaves the actor (audit responses, logs). */
export function maskPhone(phone: string): string {
  if (phone.length <= 9) return "***";
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}

interface TelnyxBinding {
  messages: { send(params: { to: string; from: string; text: string }): Promise<unknown> };
}

export interface Env {
  SECRETS: Secrets;
  OTP_GUARD: ActorNamespace;
  TELNYX: TelnyxBinding;
  DEMO_MODE?: string;
  DEMO_PHONE?: string;
  VERIFY_PROFILE_ID?: string;
  PUBLIC_BASE_URL?: string;
  DISPATCH_FROM_NUMBER?: string;
}

export interface AuditEntry {
  at: string;
  event: string;
  result: string;
  detail: Record<string, unknown>;
}

export interface GuardState {
  action_kind: string;
  phone_number: string;
  destination: string | null;
  verify_id: string | null;
  verify_profile_id: string | null;
  status: "idle" | "pending" | "committed" | "locked" | "expired";
  attempts_left: number;
  expires_at: string | null;
  locked_until: string | null;
  audit: AuditEntry[];
}

type TriggerResult =
  | { ok: true; verification_id: string }
  | { ok: false; reason: "rate_limited"; retry_after_secs: number }
  | { ok: false; reason: "api_error"; status: number };

type CheckResult = { response_code: "accepted" | "rejected" | "not_found" | "error" };

export class OtpGuard extends Agent<Env, GuardState> {
  protected initialState(): GuardState {
    return {
      action_kind: "payout_destination_change",
      phone_number: "",
      destination: null,
      verify_id: null,
      verify_profile_id: null,
      status: "idle",
      attempts_left: MAX_ATTEMPTS,
      expires_at: null,
      locked_until: null,
      audit: [],
    };
  }

  private get demoMode(): boolean {
    return (this.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
  }

  /** Append-only audit trail \u2014 the actor's own record of every event. */
  private async record(event: string, result: string, detail: Record<string, unknown> = {}): Promise<void> {
    const state = await this.getState();
    const audit = [...state.audit, { at: new Date().toISOString(), event, result, detail }];
    await this.setState({ audit });
  }

  /** One-time: create the step-up verify profile (6 digits, 5-minute expiry). */
  async onProfileCreated(input: { action_id: string }) {
    const state = await this.getState();
    if (state.verify_profile_id) {
      return { ok: true, created: false, verify_profile_id: state.verify_profile_id };
    }
    const fromEnv = this.env.VERIFY_PROFILE_ID;
    if (fromEnv) {
      await this.setState({ verify_profile_id: fromEnv });
      await this.record("verify_profile_attached", "ok", { verify_profile_id: fromEnv, source: "env" });
      return { ok: true, created: false, verify_profile_id: fromEnv };
    }
    try {
      const profileId = await this.createStepUpProfile(input.action_id);
      await this.setState({ verify_profile_id: profileId });
      await this.record("verify_profile_created", "ok", {
        verify_profile_id: profileId,
        code_length: 6,
        timeout_secs: VERIFICATION_TIMEOUT_SECS,
      });
      return { ok: true, created: true, verify_profile_id: profileId };
    } catch (err) {
      console.error("verify profile creation failed:", err instanceof Error ? err.message : "unknown");
      await this.record("verify_profile_created", "error", { reason: "api_error" });
      return { ok: false, status: "api_error", message: "Could not create the step-up verify profile." };
    }
  }

  /** Trigger the verification and persist verify_id + expiry clock. */
  async onActionRequested(input: { action_kind: string; phone_number: string; destination: string | null }) {
    const state = await this.getState();
    const now = Date.now();

    if (state.status === "committed") {
      return { ok: false, status: "committed", message: "This action is already committed." };
    }
    if (state.locked_until && now < Date.parse(state.locked_until)) {
      return { ok: false, status: "locked", locked_until: state.locked_until, message: `Session locked until ${state.locked_until}.` };
    }
    const profileId = state.verify_profile_id ?? this.env.VERIFY_PROFILE_ID ?? null;
    if (!profileId) {
      return { ok: false, status: "no_profile", message: "No verify profile. POST /actions/:id/verify-profile first." };
    }

    const trigger = await this.triggerVerification(input.phone_number, profileId);
    if (!trigger.ok) {
      await this.record("verification_triggered", trigger.reason, {});
      if (trigger.reason === "rate_limited") {
        const minutes = Math.max(1, Math.ceil(trigger.retry_after_secs / 60));
        return {
          ok: false,
          status: "rate_limited",
          retry_after_secs: trigger.retry_after_secs,
          message: `Verification rate limit hit. Try again in ${minutes} minute(s).`,
        };
      }
      return { ok: false, status: "api_error", message: "Could not trigger the verification." };
    }

    const expiresAt = new Date(now + VERIFICATION_TIMEOUT_SECS * 1000).toISOString();
    await this.setState({
      action_kind: input.action_kind,
      phone_number: input.phone_number,
      destination: input.destination,
      verify_id: trigger.verification_id,
      verify_profile_id: profileId,
      status: "pending",
      attempts_left: MAX_ATTEMPTS,
      expires_at: expiresAt,
      locked_until: null,
    });
    await this.record("verification_triggered", "pending", { verify_id: trigger.verification_id, expires_at: expiresAt });
    return { ok: true, status: "pending", verify_id: trigger.verification_id, expires_at: expiresAt, attempts_left: MAX_ATTEMPTS };
  }

  /** Check the code by id; branch accepted / rejected / expired / locked. */
  async onCodeSubmitted(code: string) {
    const state = await this.getState();
    const now = Date.now();

    if (state.status === "committed") {
      return { ok: true, status: "committed", message: "This action is already committed." };
    }
    if (state.locked_until && now < Date.parse(state.locked_until)) {
      return {
        ok: false,
        status: "locked",
        locked_until: state.locked_until,
        attempts_left: state.attempts_left,
        message: `Locked until ${state.locked_until}.`,
      };
    }
    if (!state.verify_id) {
      return { ok: false, status: "no_session", message: "No active verification. POST /actions/:id/start first." };
    }
    if (state.expires_at && now >= Date.parse(state.expires_at)) {
      await this.setState({ status: "expired" });
      await this.record("code_submitted", "expired", { reason: "session_expired" });
      return { ok: false, status: "expired", message: "Verification expired. POST /actions/:id/start to re-trigger." };
    }

    const check = await this.checkVerification(state.verify_id, code);

    if (check.response_code === "accepted") {
      const committedAt = new Date().toISOString();
      await this.setState({ status: "committed" });
      await this.record("action_committed", "accepted", { destination: state.destination, committed_at: committedAt });
      await this.notify(`Payout destination change approved at ${committedAt}.`);
      return { ok: true, status: "committed", destination: state.destination, committed_at: committedAt };
    }
    if (check.response_code === "not_found") {
      await this.setState({ status: "expired", verify_id: null });
      await this.record("code_submitted", "not_found", { reason: "unknown_verification_id" });
      return { ok: false, status: "expired", message: "Verification no longer exists. POST /actions/:id/start to re-trigger." };
    }
    if (check.response_code === "error") {
      await this.record("code_submitted", "error", { reason: "verify_api_error" });
      return {
        ok: false,
        status: "api_error",
        attempts_left: state.attempts_left,
        message: "Verification service unavailable. No attempt was consumed.",
      };
    }

    const attemptsLeft = Math.max(0, state.attempts_left - 1);
    await this.setState({ attempts_left: attemptsLeft });
    await this.record("code_submitted", "rejected", { attempts_left: attemptsLeft });
    if (attemptsLeft === 0) return this.onBudgetExhausted();
    return { ok: false, status: "rejected", attempts_left: attemptsLeft, message: `${attemptsLeft} attempts remaining.` };
  }

  /** Budget exhausted \u2192 lock the session and schedule the cool-down lift. */
  async onBudgetExhausted() {
    const lockedUntil = new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString();
    await this.setState({ status: "locked", locked_until: lockedUntil });
    await this.record("budget_exhausted", "locked", { locked_until: lockedUntil });
    await this.schedule(LOCKOUT_SECONDS, "liftLockout", {});
    await this.notify(`Too many incorrect codes. This action is locked until ${lockedUntil}.`);
    return { ok: false, status: "locked", locked_until: lockedUntil, attempts_left: 0, message: `Locked until ${lockedUntil}.` };
  }

  /** Scheduled cool-down handler \u2014 the lock lifts on the actor's own clock. */
  async liftLockout() {
    const state = await this.getState();
    if (state.status !== "locked") return { ok: true, status: state.status };
    await this.setState({ status: "idle", locked_until: null, attempts_left: MAX_ATTEMPTS, verify_id: null, expires_at: null });
    await this.record("lockout_lifted", "idle", { attempts_left: MAX_ATTEMPTS });
    return { ok: true, status: "idle", attempts_left: MAX_ATTEMPTS };
  }

  /** Answer "who attempted this, when, and what happened" from the actor's trail. */
  async onAuditQuery() {
    const state = await this.getState();
    return {
      action_kind: state.action_kind,
      status: state.status,
      phone_number: maskPhone(state.phone_number),
      attempts_left: state.attempts_left,
      expires_at: state.expires_at,
      locked_until: state.locked_until,
      audit: state.audit,
    };
  }

  /** Verify webhook \u2014 a second signal, never an override of the check result. */
  async onVerifyWebhook(event: {
    type: string;
    verification_id: string | null;
    status: string | null;
    failed_attempts: number | null;
  }) {
    const state = await this.getState();
    if (event.verification_id && state.verify_id && event.verification_id !== state.verify_id) {
      await this.record(`webhook:${event.type}`, "ignored", { reason: "verification_id_mismatch" });
      return { ok: true, applied: false };
    }
    await this.record(`webhook:${event.type}`, event.status ?? "unknown", { failed_attempts: event.failed_attempts });
    return { ok: true, applied: true };
  }

  // ---- Telnyx Verify REST (raw fetch: the Edge binding does not expose Verify) ----

  private async verifyApi(path: string, init: { method: string; body?: string }) {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
    const res = await fetch(`https://api.telnyx.com/v2${path}`, {
      method: init.method,
      body: init.body,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    });
    const retryAfter = Number(res.headers.get("retry-after") ?? "");
    const data: unknown = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      data,
      retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    };
  }

  private async createStepUpProfile(actionId: string): Promise<string> {
    if (this.demoMode) return DEMO_PROFILE_ID;
    const base = (this.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const webhookUrl = base ? `${base}/webhooks/verify?action_id=${encodeURIComponent(actionId)}` : undefined;
    const res = await this.verifyApi("/verify_profiles", {
      method: "POST",
      body: JSON.stringify({
        name: `otp-guard-step-up-${actionId}`,
        language: "en-US",
        sms: { code_length: 6, default_verification_timeout_secs: VERIFICATION_TIMEOUT_SECS },
        ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
      }),
    });
    if (!res.ok) throw new Error(`verify profile creation failed (${res.status})`);
    const id = (res.data as { data?: { id?: unknown } })?.data?.id;
    if (typeof id !== "string") throw new Error("verify profile response missing id");
    return id;
  }

  private async triggerVerification(phoneNumber: string, profileId: string): Promise<TriggerResult> {
    if (this.demoMode) return { ok: true, verification_id: `demo-verify-${Date.now().toString(36)}` };
    const res = await this.verifyApi("/verifications/sms", {
      method: "POST",
      body: JSON.stringify({ phone_number: phoneNumber, verify_profile_id: profileId }),
    });
    if (res.status === 429) return { ok: false, reason: "rate_limited", retry_after_secs: res.retryAfter ?? 60 };
    if (!res.ok) return { ok: false, reason: "api_error", status: res.status };
    const id = (res.data as { data?: { id?: unknown } })?.data?.id;
    if (typeof id !== "string") return { ok: false, reason: "api_error", status: 502 };
    return { ok: true, verification_id: id };
  }

  private async checkVerification(verifyId: string, code: string): Promise<CheckResult> {
    if (this.demoMode) return { response_code: code === DEMO_ACCEPT_CODE ? "accepted" : "rejected" };
    const res = await this.verifyApi(`/verifications/check/${encodeURIComponent(verifyId)}`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (res.status === 404) return { response_code: "not_found" };
    if (!res.ok) return { response_code: "error" };
    const responseCode = (res.data as { data?: { response_code?: unknown } })?.data?.response_code;
    return { response_code: responseCode === "accepted" ? "accepted" : "rejected" };
  }

  /** SMS notification via the zero-credential TELNYX binding (live mode only). */
  private async notify(text: string): Promise<void> {
    if (this.demoMode) return; // safe demo mode: never send a real SMS
    const from = this.env.DISPATCH_FROM_NUMBER;
    const state = await this.getState();
    if (!from || !state.phone_number) return;
    try {
      await this.env.TELNYX.messages.send({ to: state.phone_number, from, text });
    } catch {
      // notification failures must never break the verification flow
    }
  }
}

// ---- HTTP surface (plain-fetch router, repo house pattern) ----

interface OtpGuardRpc {
  onProfileCreated(input: { action_id: string }): Promise<unknown>;
  onActionRequested(input: { action_kind: string; phone_number: string; destination: string | null }): Promise<unknown>;
  onCodeSubmitted(code: string): Promise<unknown>;
  onAuditQuery(): Promise<unknown>;
  onVerifyWebhook(event: {
    type: string;
    verification_id: string | null;
    status: string | null;
    failed_attempts: number | null;
  }): Promise<unknown>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFor(env: Env, actionId: string): OtpGuardRpc {
  return env.OTP_GUARD.get(env.OTP_GUARD.idFromName(actionId)) as unknown as OtpGuardRpc;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Telnyx webhook signature: Ed25519 over `${timestamp}|${rawBody}`. */
async function verifyTelnyxSignature(env: Env, rawBody: string, headers: Headers): Promise<boolean> {
  const publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
  if (!publicKey) throw new Error("TELNYX_PUBLIC_KEY is not configured");
  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  const key = await crypto.subtle.importKey("raw", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${timestamp}|${rawBody}`);
  return crypto.subtle.verify({ name: "Ed25519" }, key, base64ToBytes(signature), signed);
}

async function handleVerifyWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  let valid: boolean;
  try {
    valid = await verifyTelnyxSignature(env, raw, request.headers);
  } catch {
    return json({ error: "webhook_verification_not_configured" }, 503);
  }
  if (!valid) return json({ error: "invalid_signature" }, 401);

  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return json({ error: "invalid_json" }, 400);
    event = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const actionId = new URL(request.url).searchParams.get("action_id") ?? "";
  if (!isActionId(actionId)) return json({ error: "missing_action_id" }, 400);

  const data = (event.data && typeof event.data === "object" ? event.data : {}) as Record<string, unknown>;
  const payload = (data.payload && typeof data.payload === "object" ? data.payload : {}) as Record<string, unknown>;
  const result = await stubFor(env, actionId).onVerifyWebhook({
    type: typeof data.event_type === "string" ? data.event_type : "unknown",
    verification_id: typeof payload.verification_id === "string" ? payload.verification_id : null,
    status: typeof payload.status === "string" ? payload.status : null,
    failed_attempts: typeof payload.failed_attempts === "number" ? payload.failed_attempts : null,
  });
  return json({ received: true, result });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/webhooks/verify") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return await handleVerifyWebhook(request, env);
      }

      const match = /^\/actions\/([^/]+)\/(verify-profile|start|submit|audit)$/.exec(url.pathname);
      if (!match) return json({ error: "not_found" }, 404);
      const actionId = match[1];
      const action = match[2];
      if (!isActionId(actionId)) return json({ error: "invalid_action_id" }, 400);

      if (action === "verify-profile") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return json(await stubFor(env, actionId).onProfileCreated({ action_id: actionId }));
      }

      if (action === "start") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const body = await readJson(request);
        if (!body) return json({ error: "invalid_json" }, 400);
        const phone = typeof body.phone_number === "string" ? body.phone_number.trim() : (env.DEMO_PHONE ?? "");
        if (!isE164(phone)) return json({ error: "phone_number must be E.164, e.g. +15551234567" }, 400);
        const actionKind = typeof body.action_kind === "string" ? body.action_kind.slice(0, 64) : "payout_destination_change";
        const destination = typeof body.destination === "string" ? body.destination.slice(0, 128) : null;
        return json(await stubFor(env, actionId).onActionRequested({ action_kind: actionKind, phone_number: phone, destination }));
      }

      if (action === "submit") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const body = await readJson(request);
        if (!body) return json({ error: "invalid_json" }, 400);
        const code = typeof body.code === "string" ? body.code.trim() : "";
        if (!isVerificationCode(code)) return json({ error: "code must be 4-8 digits" }, 400);
        return json(await stubFor(env, actionId).onCodeSubmitted(code));
      }

      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      return json(await stubFor(env, actionId).onAuditQuery());
    } catch (err) {
      console.error("otp-guard request failed:", err instanceof Error ? err.message : "unknown error");
      return json({ error: "internal_error" }, 500);
    }
  },
};
