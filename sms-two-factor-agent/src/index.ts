/**
 * TwoFactorAgent — manages the full lifecycle of an SMS two-factor auth code:
 * generate, send, verify, and expire.
 *
 * Telnyx Edge primitives used (per DEV-830):
 *  - Agent SDK (Stateful Actors) -> class extends Agent, this.schedule() for expiry
 *  - [telnyx] binding            -> this.env.TELNYX.messages.send() (zero-credential)
 *  - KV ([storage.kv.KV])        -> this.env.KV.put(key, code, { expirationTtl: 300 })
 *  - Durable agent state         -> per-phone attempt / failure tracking + rate limiting
 *
 * Addressing: one actor instance per phone number, keyed by E.164 via
 * `idFromName("+13125550100")` (sanitized for the actor name). The actor is
 * durable — attempt counters survive evictions — and calls are serialized
 * per instance, so per-phone rate limiting is race-free.
 */

import {
  Agent,
  type ActorContext,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

// ── Env bindings (resolved from telnyx.toml) ──────────────────────────────

interface Env {
  AGENT: AgentNamespace;
  TELNYX: {
    messages: {
      send(req: { from: string; to: string; text: string }): Promise<unknown>;
    };
  };
  KV: {
    get(key: string): Promise<string | null>;
    put(
      key: string,
      value: string,
      options?: { expirationTtl?: number },
    ): Promise<void>;
    delete(key: string): Promise<void>;
  };
}

type TwoFactorStub = ActorStub &
  Pick<TwoFactorAgent, "sendCode" | "verifyCode">;

interface AgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): TwoFactorStub;
}

// ── Config + durable state shape ──────────────────────────────────────────

const MAX_ATTEMPTS = 5; // per phone number
const CODE_TTL_SECONDS = 300; // 5 minutes

export interface TwoFactorState extends Record<string, unknown> {
  /** Send-code attempts in the current window (rate-limited). */
  attempts: number;
  /** Failed verifications in the current code's lifetime. */
  fails: number;
  /** Epoch ms of the last send-code attempt — anchors the rate-limit window. */
  last_send_at: number;
}

// ── The agent ─────────────────────────────────────────────────────────────

export class TwoFactorAgent extends Agent<Env, TwoFactorState> {
  constructor(ctx: ActorContext, env: Env) {
    super(ctx, env);
  }

  protected initialState(): TwoFactorState {
    return { attempts: 0, fails: 0, last_send_at: 0 };
  }

  /**
   * Generate a 6-digit code, store it in KV with a 5-minute TTL, deliver it,
   * and schedule a cleanup task as a safety net.
   *
   * `opts` comes from the function runtime's process.env — the actor runtime
   * has its own (empty) process.env, so [env_vars] must be passed in, not
   * read here.
   */
  async sendCode(
    phone: string,
    opts?: { demoMode?: boolean; fromNumber?: string },
  ): Promise<
    | {
        status: "sent";
        message_id?: string;
        demo?: boolean;
      }
    | { status: "rate_limited" }
  > {
    // --- Rate limit via durable per-phone state (window = code TTL) ---
    const state = await this.getState();
    const windowExpired =
      Date.now() - (state.last_send_at ?? 0) > CODE_TTL_SECONDS * 1000;
    const attempts = windowExpired ? 0 : (state.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS) {
      return { status: "rate_limited" };
    }
    await this.setState({ attempts: attempts + 1, last_send_at: Date.now() });

    // --- Generate code ---
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // --- Store code with 5-minute TTL (KV primary, actor storage fallback) ---
    await this.putCode(phone, code);

    // --- Deliver: demo mode logs, live mode sends via the [telnyx] binding ---
    const demoMode =
      opts?.demoMode ?? ((process.env.DEMO_MODE ?? "true") !== "false");
    const messageText = `Your verification code is ${code}. It expires in 5 minutes.`;
    if (demoMode) {
      console.log(`[demo] SMS to ${phone}: ${messageText}`);
      await this.schedule(CODE_TTL_SECONDS, "expireCode", { phone });
      return { status: "sent", demo: true };
    }

    const from = opts?.fromNumber ?? process.env.TELNYX_FROM_NUMBER ?? "+1555XXXXXXXX";
    const res = (await this.env.TELNYX.messages.send({
      from,
      to: phone,
      text: messageText,
    })) as { data?: { id?: string }; id?: string };

    // --- Agent SDK: schedule expiry as a safety net (KV TTL is primary) ---
    await this.schedule(CODE_TTL_SECONDS, "expireCode", { phone });

    return {
      status: "sent",
      demo: false,
      message_id: res?.data?.id ?? res?.id,
    };
  }

  /**
   * Verify a submitted code against KV. Successful verification clears the
   * code and the per-phone counters.
   */
  async verifyCode(
    phone: string,
    code: string,
  ): Promise<
    | { status: "verified" }
    | { status: "no_code" }
    | { status: "invalid"; fails_remaining: number }
  > {
    const storedCode = await this.getCode(phone);
    if (!storedCode) {
      return { status: "no_code" };
    }

    if (storedCode !== code) {
      const state = await this.getState();
      const fails = (state.fails ?? 0) + 1;
      await this.setState({ fails });
      return {
        status: "invalid",
        fails_remaining: Math.max(0, MAX_ATTEMPTS - fails),
      };
    }

    // Success: clean up KV + per-phone state
    await this.deleteCode(phone);
    await this.replaceState({ attempts: 0, fails: 0, last_send_at: 0 });
    return { status: "verified" };
  }

  /**
   * Scheduled handler — dispatched by this.schedule() to clean up expired
   * codes even if KV TTL expiry is missed.
   */
  async expireCode(payload: unknown): Promise<void> {
    const p = payload as { phone?: string };
    if (!p?.phone) return;
    await this.deleteCode(p.phone);
    // Reset the send-attempt window along with the code.
    await this.replaceState({ attempts: 0, fails: 0, last_send_at: 0 });
    console.log(`[scheduled] Cleaned up 2FA code for ${p.phone}`);
  }

  // ── Code store: KV primary, actor storage fallback ────────────────────
  // The KV write path can fail independently of reads (seen live: HTTP 500
  // on writes while reads stayed healthy). Store to KV when it works, keep
  // a durable copy in this actor's storage, and prefer KV on read.

  private async putCode(phone: string, code: string): Promise<void> {
    const key = kvKey(phone);
    try {
      await this.env.KV.put(key, code, { expirationTtl: CODE_TTL_SECONDS });
      return;
    } catch (err) {
      console.warn(
        `[kv] put failed, falling back to actor storage: ${(err as Error).message}`,
      );
    }
    await this.ctx.storage.put(`code:${key}`, {
      code,
      expires_at: Date.now() + CODE_TTL_SECONDS * 1000,
    } satisfies StoredCode);
  }

  private async getCode(phone: string): Promise<string | null> {
    const key = kvKey(phone);
    try {
      const fromKv = await this.env.KV.get(key);
      if (fromKv) return fromKv;
    } catch (err) {
      console.warn(
        `[kv] get failed, checking actor storage: ${(err as Error).message}`,
      );
    }
    const stored = await this.ctx.storage.get<StoredCode>(`code:${key}`);
    if (!stored) return null;
    if (Date.now() > stored.expires_at) {
      await this.ctx.storage.delete(`code:${key}`);
      return null;
    }
    return stored.code;
  }

  private async deleteCode(phone: string): Promise<void> {
    const key = kvKey(phone);
    try {
      await this.env.KV.delete(key);
    } catch {
      // best-effort — the scheduled cleanup and storage delete still run
    }
    await this.ctx.storage.delete(`code:${key}`);
  }
}

function kvKey(phone: string): string {
  // Telnyx KV keys allow only a-z A-Z 0-9 - _ / = . — strip the E.164 "+"
  // and use "/" as the namespace separator (":" is not allowed).
  return `2fa/${phone.replace(/[^A-Za-z0-9]/g, '')}`;
}

// Fallback store shape (actor storage has no native TTL, so track expiry).
interface StoredCode {
  code: string;
  expires_at: number;
}

// ── HTTP front door ───────────────────────────────────────────────────────

const PHONE_RE = /^\+\d{10,15}$/;

/**
 * Sanitize an E.164 phone number for use as an actor name (RFC 1123:
 * lowercase alphanumeric, hyphens, dots — strip the leading "+").
 */
function actorNameFromPhone(phone: string): string {
  return phone.replace(/^\+/, "").toLowerCase();
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ status: "ok", agent: "TwoFactorAgent" });
    }

    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }

    let body: { phone?: string; code?: string };
    try {
      body = (await req.json()) as { phone?: string; code?: string };
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (url.pathname === "/verify") {
      const phone = body?.phone;
      if (!phone || !PHONE_RE.test(phone)) {
        return json(
          { error: "A valid E.164 phone number is required (e.g. +15551234567)" },
          400,
        );
      }
      const stub = env.AGENT.idFromName(actorNameFromPhone(phone));
      // [env_vars] live in the function runtime's process.env — pass them
      // explicitly; the actor runtime has its own (empty) process.env.
      const result = await stub.sendCode(phone, {
        demoMode: (process.env.DEMO_MODE ?? "true") !== "false",
        fromNumber: process.env.TELNYX_FROM_NUMBER,
      });
      if (result.status === "rate_limited") {
        return json(
          { error: "Too many attempts. Please try again later." },
          429,
        );
      }
      return json({
        ok: true,
        message: "Verification code sent. Check your phone.",
        demo_mode: result.demo ?? true,
        message_id: result.message_id,
      });
    }

    if (url.pathname === "/check" || url.pathname === "/verify/code") {
      const { phone, code } = body ?? {};
      if (!phone || !code) {
        return json({ error: "phone and code are required" }, 400);
      }
      const stub = env.AGENT.idFromName(actorNameFromPhone(phone));
      const result = await stub.verifyCode(phone, code);
      switch (result.status) {
        case "verified":
          return json({ verified: true, message: "Phone number verified." });
        case "no_code":
          return json(
            { error: "No active verification code. Request a new one." },
            404,
          );
        case "invalid":
          return json(
            { verified: false, error: "Invalid code", ...result },
            401,
          );
      }
    }

    return json({ error: "not found" }, 404);
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
