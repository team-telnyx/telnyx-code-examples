import {
  Agent,
  type ActorNamespace,
  type ActorStub,
  type Env,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

// ─── Types ───────────────────────────────────────────────────────────

export type VisitRow = {
  id: number;
  at: string;
  reason: string;
  summary: string;
  next_step: string;
};

export interface DossierState extends Record<string, unknown> {
  lastVisitAt: string | null;
  lastFiledVisitId: number | null;
}

export type IntakeDossierStub = ActorStub &
  Pick<IntakeDossier, "handleInitialization" | "fileVisitSummary" | "dossierView">;

export interface DossierNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): IntakeDossierStub;
}

export interface DossierEnv extends Env {
  DOSSIERS: DossierNamespace;
}

export interface DynamicVarsResponse {
  dynamic_variables: Record<string, string>;
  encrypted_dynamic_variables: Record<string, string>;
}

export interface FilingArgs {
  visit_reason: string;
  follow_up: string;
  next_step: string;
}

export interface FilingResult {
  filed: boolean;
  visit_id: number | null;
}

export interface DossierView {
  patient_name: string;
  provider: string;
  balance_due: string;
  last_visit: string;
  visits: VisitRow[];
  lastVisitAt: string | null;
}

// ─── Base64url helpers (per-caller-credentials scheme) ───────────────

export function base64UrlEncode(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  let b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Per-caller credential encryption ────────────────────────────────
// Scheme (per Telnyx docs): base64url( nonce(12 bytes) || AES-256-GCM ciphertext+tag ).
// The key is the same base64url 32-byte value stored as the `portal_enc_key`
// integration secret; Telnyx decrypts it at the moment of tool use, and the
// plaintext never appears in the webhook payload, logs, or model context.

export async function encryptPortalToken(plaintext: string, keyB64Url: string): Promise<string> {
  const keyBytes = base64UrlDecode(keyB64Url);
  if (keyBytes.length !== 32) {
    throw new Error("PORTAL_ENC_KEY must decode to exactly 32 bytes");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(ciphertext), nonce.length);
  return base64UrlEncode(combined);
}

export async function decryptPortalToken(encryptedB64Url: string, keyB64Url: string): Promise<string> {
  const combined = base64UrlDecode(encryptedB64Url);
  if (combined.length < 12 + 16) {
    throw new Error("ciphertext too short");
  }
  const nonce = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await crypto.subtle.importKey("raw", base64UrlDecode(keyB64Url), { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ─── Ed25519 webhook signature verification ──────────────────────────
// Telnyx signs webhook deliveries with Ed25519 over "{timestamp}|{body}".
// Headers: telnyx-timestamp, telnyx-signature-ed25519 (base64). The public
// key comes from Mission Control Portal (TELNYX_PUBLIC_KEY secret).

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function verifyTelnyxSignature(
  rawBody: string,
  headers: Headers,
  publicKeyB64Url: string,
): Promise<boolean> {
  const timestamp = headers.get("telnyx-timestamp");
  const signature = headers.get("telnyx-signature-ed25519");
  if (!timestamp || !signature) return false;

  const ts = Number(timestamp) * 1000;
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) return false;

  try {
    const pubKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(publicKeyB64Url),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const sigBytes = base64UrlDecode(signature);
    const payload = new TextEncoder().encode(`${timestamp}|${rawBody}`);
    return await crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, payload);
  } catch {
    return false;
  }
}

// ─── Webhook envelope parsing ────────────────────────────────────────

export interface InitializationEvent {
  telnyx_end_user_target: string;
  telnyx_end_user_target_verified: boolean;
  call_control_id: string | null;
  assistant_id: string | null;
}

export function parseInitializationEvent(body: unknown): InitializationEvent | null {
  const envelope = body as { data?: { event_type?: string; payload?: Record<string, unknown> } };
  if (envelope?.data?.event_type !== "assistant.initialization") return null;
  const payload = envelope.data?.payload ?? {};
  const target = typeof payload.telnyx_end_user_target === "string" ? payload.telnyx_end_user_target : null;
  if (!target) return null;
  return {
    telnyx_end_user_target: target,
    telnyx_end_user_target_verified: payload.telnyx_end_user_target_verified === true,
    call_control_id: typeof payload.call_control_id === "string" ? payload.call_control_id : null,
    assistant_id: typeof payload.assistant_id === "string" ? payload.assistant_id : null,
  };
}

export function normalizePhoneDigits(target: string): string | null {
  const digits = target.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

// ─── The dossier actor ───────────────────────────────────────────────

/**
 * IntakeDossier — one durable agent per caller. `idFromName(phoneDigits)`
 * routes every call from the same number to this one instance; the instance
 * owns the patient's visit history in its private embedded SQL database and
 * survives restarts between calls.
 */
export class IntakeDossier extends Agent<DossierEnv, DossierState> {
  protected override initialState(): DossierState {
    return { lastVisitAt: null, lastFiledVisitId: null };
  }

  /**
   * Initialization webhook handler. Returns the personalized dynamic
   * variables (from the durable dossier) plus a fresh one-time portal token,
   * encrypted with the `portal_enc_key` integration secret's key.
   */
  async handleInitialization(lookbackDays: number): Promise<DynamicVarsResponse> {
    this.ensureSchema();

    const identity = this.getIdentity();
    const prefs = this.getPrefs();
    const lastVisit = this.getLastVisit();
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

    let lastVisitStr = "none";
    if (lastVisit && new Date(lastVisit.at).getTime() > cutoff) {
      lastVisitStr = new Date(lastVisit.at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }

    const rawToken = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const encKey = this.getEncKey();
    const portalToken = await encryptPortalToken(rawToken, encKey);

    return {
      dynamic_variables: {
        patient_name: identity.patient_name,
        provider: prefs.provider,
        last_visit: lastVisitStr,
        balance_due: identity.balance_due,
      },
      encrypted_dynamic_variables: {
        portal_token: portalToken,
      },
    };
  }

  /**
   * Post-conversation filing. Called by the wrap-up turn's webhook tool.
   * Idempotent: dedupes by (reason, next_step) so Telnyx's webhook-tool
   * retries never create duplicate visit rows. Retires the one-time token
   * marker implicitly — a fresh token is minted on the next initialization.
   */
  async fileVisitSummary(args: FilingArgs): Promise<FilingResult> {
    this.ensureSchema();

    const reason = (args.visit_reason || "").trim();
    const nextStep = (args.next_step || "").trim();
    if (!reason || !nextStep) {
      throw new Error("visit_reason and next_step are required");
    }

    const existing = this.ctx.storage.sql
      .exec<{ id: number }>(
        "SELECT id FROM visits WHERE reason = ? AND next_step = ? ORDER BY id DESC LIMIT 1",
        reason,
        nextStep,
      )
      .toArray();
    if (existing.length > 0) {
      return { filed: false, visit_id: existing[0].id };
    }

    const now = new Date().toISOString();
    const insert = this.ctx.storage.sql.exec<{ id: number }>(
      "INSERT INTO visits (at, reason, summary, next_step) VALUES (?, ?, ?, ?) RETURNING id",
      now,
      reason,
      args.follow_up || "",
      nextStep,
    ).toArray();
    const visitId = insert.length > 0 ? insert[0].id : null;

    await this.setState({ lastVisitAt: now, lastFiledVisitId: visitId });
    return { filed: true, visit_id: visitId };
  }

  /** Dev inspection: the full dossier view (never exposes token plaintexts). */
  async dossierView(): Promise<DossierView> {
    this.ensureSchema();
    const identity = this.getIdentity();
    const prefs = this.getPrefs();
    const lastVisit = this.getLastVisit();
    const visits = this.ctx.storage.sql
      .exec<VisitRow>(
        "SELECT id, at, reason, summary, next_step FROM visits ORDER BY id DESC LIMIT 50",
      )
      .toArray();
    const state = await this.getState();
    return {
      patient_name: identity.patient_name,
      provider: prefs.provider,
      balance_due: identity.balance_due,
      last_visit: lastVisit ? new Date(lastVisit.at).toISOString() : "none",
      visits,
      lastVisitAt: state.lastVisitAt ?? null,
    };
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, reason TEXT NOT NULL, summary TEXT, next_step TEXT)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS identity (patient_name TEXT NOT NULL, balance_due TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS prefs (provider TEXT)",
    );
  }

  /** Seeds the demo identity once; thereafter the greeting reads from SQL. */
  private getIdentity(): { patient_name: string; balance_due: string } {
    const row = this.ctx.storage.sql
      .exec<{ patient_name: string; balance_due: string }>(
        "SELECT patient_name, balance_due FROM identity LIMIT 1",
      )
      .toArray();
    if (row.length > 0) return row[0];

    this.ctx.storage.sql.exec(
      "INSERT INTO identity (patient_name, balance_due) VALUES (?, ?)",
      "Sarah",
      "$0.00",
    );
    return { patient_name: "Sarah", balance_due: "$0.00" };
  }

  private getPrefs(): { provider: string } {
    const row = this.ctx.storage.sql
      .exec<{ provider: string }>("SELECT provider FROM prefs LIMIT 1")
      .toArray();
    if (row.length > 0 && row[0].provider) return { provider: row[0].provider };

    this.ctx.storage.sql.exec("INSERT INTO prefs (provider) VALUES (?)", "Dr. Lee");
    return { provider: "Dr. Lee" };
  }

  private getLastVisit(): VisitRow | null {
    const rows = this.ctx.storage.sql
      .exec<VisitRow>(
        "SELECT id, at, reason, summary, next_step FROM visits ORDER BY id DESC LIMIT 1",
      )
      .toArray();
    return rows.length > 0 ? rows[0] : null;
  }

  private getEncKey(): string {
    const key = process.env.PORTAL_ENC_KEY;
    if (!key) {
      throw new Error("PORTAL_ENC_KEY not configured");
    }
    return key;
  }
}
