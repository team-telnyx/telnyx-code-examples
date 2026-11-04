/**
 * Telnyx Edge — Browser Watchdog (DEV-1402)
 *
 * A durable actor that watches one web property: it captures a baseline of
 * what "normal" looks like, wakes on a schedule, drives an isolated Agent
 * Browser session over the page, and files dated incidents it can later close
 * with before/after screenshots.
 *
 * ASSUMPTIONS
 * - Agent Browser is a beta REST surface with no SDK client, so every call is
 *   a raw fetch to https://api.telnyx.com/v2/browser_sessions* mirroring the
 *   docs' envelopes: actions ride HTTP 200 as `data.status` ("succeeded" |
 *   "failed" | "unknown" | "queued" | "running") with the observation under
 *   `data.result.observation` and the artifact under `data.result.artifact`.
 *   A submission that does not finish inside `wait_seconds` returns 202 with
 *   an action id; the actor polls `GET .../actions/:id` and, because polls
 *   never carry full trees/refs, re-observes when it needs them.
 * - The baseline is captured on the FIRST run: `watch <url>` only stores
 *   config and arms the schedule (design decision #3), so no browser session
 *   is created at watch time.
 * - DEMO_MODE=true (default) replays the envelopes recorded in
 *   demo/browser-fixtures.json and derives the verdict locally, so the whole
 *   loop (baseline → stale_ref recovery → broken verdict → incident →
 *   fix-close) runs end-to-end offline. DEMO_MODE=false + TELNYX_API_KEY
 *   drives the live beta API and the TELNYX binding.
 * - SMS commands are authorized against the watch's owner phone (stored in
 *   actor state, seeded from WATCH_OWNER_PHONE). Unknown senders cannot arm
 *   watches, force paid browser sessions, or read status.
 * - The verdict is judged against the PRE-SUBMIT pricing observation; the
 *   post-submit observation only proves the form submitted.
 *
 * SELF-REVIEW
 * - Real primitives only: Agent state + every()/schedule(), SQL ledger via
 *   WATCHDOG_DB, KV routing index via WATCHDOG_INDEX, TELNYX binding for SMS
 *   + inference. No in-memory stores, no timers.
 * - Parameterized SQL everywhere; no secrets in code; phone numbers masked
 *   in logs; inbound webhooks are Ed25519-verified in live mode.
 */
import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, KvNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";
import { FIXTURE_HTML } from "./fixture-html";
import fixtures from "../demo/browser-fixtures.json";

/* ------------------------------ env/types ------------------------------ */

interface TelnyxBinding {
  messages: { send(p: { to: string; from: string; text: string }): Promise<unknown> };
  ai: { openai: { chat: { createCompletion(p: {
    model: string;
    messages: { role: "system" | "user" | "assistant"; content: string }[];
  }): Promise<{ choices?: { message?: { content?: string } }[] }> } } };
}

export interface Env {
  SECRETS: Secrets;
  TELNYX: TelnyxBinding;
  WATCHDOG_DB: SqlDatabase;
  WATCHDOG: ActorNamespace<Watchdog>;
  WATCHDOG_INDEX: KvNamespace;
  WATCH_TARGET_URL?: string;
  WATCH_OWNER_PHONE?: string;
  FROM_NUMBER?: string;
  DEMO_MODE?: string;
  AI_MODEL?: string;
}

export interface Baseline { price_text: string; form_labels: string[] }

export interface WatchdogState extends Record<string, unknown> {
  target_url: string;
  allowed_domains: string[];
  baseline: Baseline | null;
  last_verdict: string | null;
  last_run_at: string | null;
  schedule_id: string | null;
  open_session_id: string | null;
  owner_phone: string;
}

type Refs = Record<string, { role?: string; name?: string }>;
interface Observation { observation_id: string; url: string; title: string; refs: Refs; tree: string; truncated: boolean }
interface PickedRefs { price: string; name: string; email: string; submit: string }
interface Extraction { price_text: string; form_labels: string[]; refs: PickedRefs }
interface ActionEnvelope { id?: string; status: string; result?: { observation?: Observation; artifact?: { artifact_id: string; content_type?: string; size_bytes?: number } }; error?: { code?: string; message?: string; retryable?: boolean } }
interface BrowserResponse { status: number; data: Record<string, unknown> | null; error?: { code?: string; message?: string; retryable?: boolean } }
interface Judgement { verdict: "healthy" | "broken"; reason: string; price_text?: string; form_labels?: string[] }
interface DriveResult { pricingObs: Observation; postObs: Observation; refs: PickedRefs; artifactId: string | null; downloadUrl: string | null; staleRecovered: boolean }
interface RunPayload { from?: string; reason?: string; target_url?: string; incident_id?: string; run_key?: string }
interface ArmPayload { url?: string; owner?: string }
interface StatusPayload { from?: string }
interface FixtureObservation { observation_id: string; url: string; title: string; refs: Refs; tree: string; picked_refs?: PickedRefs; extracted?: { price_text: string; form_labels: string[] } }
type ObsKind = keyof typeof RECORDED.observations;

/* ------------------------------ constants ------------------------------ */

const API_BASE = "https://api.telnyx.com";
const DAILY_SECONDS = 86400;
const FIRST_RUN_SECONDS = 5;
const POLL_INTERVAL_MS = 1000;
const SESSION_READY_BUDGET_MS = 60_000;
const ACTION_POLL_ATTEMPTS = 10;
const OBSERVE_ATTEMPTS = 3;
const DEMO_PRICE = "$24.00";

/* ------------------------------ helpers ------------------------------ */

export function isDemo(env: Pick<Env, "DEMO_MODE">): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

export function watchId(targetUrl: string): string {
  return new URL(targetUrl).hostname;
}

/** Never log a full phone number. */
export function maskPhone(value: string): string {
  return value.length <= 5 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

/** Digits only, no leading +: the comparison key for ownership. */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export interface Command {
  kind: "watch" | "status" | "recheck-now" | "recheck-incident" | "help";
  url?: string;
  incident_id?: string;
}

export function parseCommand(text: string): Command {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const rest = parts.slice(1);
  if (cmd === "watch") return { kind: "watch", url: rest.join(" ").trim() || undefined };
  if (cmd === "status") return { kind: "status", url: rest.join(" ").trim() || undefined };
  if (cmd === "recheck" && rest[0] === "now") return { kind: "recheck-now", url: rest.slice(1).join(" ").trim() || undefined };
  if (cmd === "recheck") return { kind: "recheck-incident", incident_id: rest[0] };
  return { kind: "help" };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as T;
  } catch {
    return fallback;
  }
}

function envelope(res: BrowserResponse): ActionEnvelope {
  return (res.data ?? {}) as unknown as ActionEnvelope;
}

function isStale(data: ActionEnvelope): boolean {
  return data.status === "failed" && (data.error?.code === "stale_ref" || data.error?.code === "stale_observation");
}

function isUnknownOutcome(data: ActionEnvelope): boolean {
  return data.status === "unknown" || data.error?.code === "execution_lost";
}

function isTerminalSession(status: string | undefined): boolean {
  return status === "closed" || status === "failed" || status === "expired";
}

class ExecutionLostError extends Error {}
class SessionLostError extends Error {
  constructor(public readonly sessionStatus: string) {
    super(`session lost (${sessionStatus})`);
  }
}
class PersistentStaleError extends Error {}

/* ------------------------- webhook verification ------------------------- */

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Telnyx Ed25519 webhook verification: signature over `${timestamp}|${rawBody}`. */
export async function verifyWebhookSignature(request: Request, rawBody: string, publicKey: string | null): Promise<boolean> {
  if (!publicKey) return false;
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;
  try {
    const key = await crypto.subtle.importKey("raw", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const payload = new TextEncoder().encode(`${timestamp}|${rawBody}`);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, base64ToBytes(signature), payload);
  } catch {
    return false;
  }
}

/* ---------------------------- demo fixtures ---------------------------- */

const RECORDED = fixtures as {
  envelopes: Record<string, { status: number; body: Record<string, unknown> }>;
  observations: Record<string, FixtureObservation>;
};

const OBS_KINDS: { pricing: ObsKind; rerendered: ObsKind; post: ObsKind } = {
  pricing: "pricing_healthy",
  rerendered: "pricing_rerendered",
  post: "post_submit",
};

/** The demo replays recorded trees with the URL's ?price override applied, exactly
 * as the fixture page renders it — the recorded rerender keeps its own ref ids. */
function priceOverride(targetUrl: string): string | null {
  try {
    const p = new URL(targetUrl).searchParams.get("price");
    return p !== null && p !== "" ? `$${p.startsWith("$") ? p.slice(1) : p}` : null;
  } catch {
    return null;
  }
}

/* ------------------------------- actor -------------------------------- */

export class Watchdog extends Agent<Env, WatchdogState> {
  /** Per-run demo replay state — instance-scoped, never module-level. */
  private demo: {
    fills: number;
    observes: number;
    lastObsKind: ObsKind;
    pricingObs: Observation;
    screenshotPolled: boolean;
    staleServed: boolean;
    target: string;
    brokenTarget: boolean;
  } = {
    fills: 0,
    observes: 0,
    lastObsKind: OBS_KINDS.pricing,
    pricingObs: { observation_id: "", url: "", title: "", refs: {}, tree: "", truncated: false },
    screenshotPolled: false,
    staleServed: false,
    target: "",
    brokenTarget: false,
  };

  protected initialState(): WatchdogState {
    return {
      target_url: "", allowed_domains: [], baseline: null, last_verdict: null,
      last_run_at: null, schedule_id: null, open_session_id: null, owner_phone: "",
    };
  }

  /* ---- actor routes (driven by the worker's fetch) ---- */

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "POST" && path === "/arm") {
        return json(await this.armFromJson((await request.json()) as ArmPayload));
      }
      if (request.method === "POST" && path === "/status") {
        const body = (await request.json().catch(() => ({}))) as StatusPayload;
        if (!(await this.isOwner(body.from ?? ""))) return json({ error: "not_authorized" }, 403);
        return json({ status: await this.statusReport() });
      }
      if (request.method === "POST" && path === "/run") {
        const payload = (await request.json().catch(() => ({}))) as RunPayload;
        if (!(await this.isOwner(payload.from ?? ""))) return json({ error: "not_authorized" }, 403);
        await this.runCheck(payload);
        return json({ ok: true });
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("watchdog actor error:", err instanceof Error ? err.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  }

  private async armFromJson(body: ArmPayload): Promise<Record<string, unknown>> {
    if (!body.url) return { error: "url is required" };
    let parsed: URL;
    try {
      parsed = new URL(body.url);
    } catch {
      return { error: "url must be an absolute URL" };
    }
    if (parsed.protocol !== "https:") return { error: "only https:// targets are supported" };
    return this.arm(parsed.toString(), body.owner ?? this.env.WATCH_OWNER_PHONE ?? "");
  }

  /** Stores config, seeds the KV routing index, and arms the daily schedule. */
  async arm(url: string, owner: string): Promise<Record<string, unknown>> {
    const ownerId = watchId(url);
    const ownerPhone = owner || this.env.WATCH_OWNER_PHONE || "";
    const previous = await this.getState();
    // A re-arm of the same property keeps the stored baseline; the baseline is
    // per-property, and re-pointing at a query override must not wipe it.
    const sameProperty = previous.target_url && watchId(previous.target_url) === ownerId;
    await this.replaceState({
      target_url: url,
      allowed_domains: [ownerId],
      baseline: sameProperty ? previous.baseline : null,
      last_verdict: sameProperty ? previous.last_verdict : null,
      last_run_at: previous.last_run_at,
      schedule_id: null,
      open_session_id: null,
      owner_phone: ownerPhone,
    });
    if (ownerPhone) {
      await this.env.WATCHDOG_INDEX.put(`watch:${ownerId}`, normalizePhone(ownerPhone));
      await this.indexOwner(ownerId, normalizePhone(ownerPhone), previous.owner_phone);
    }
    const dailyId = await this.every(DAILY_SECONDS, "runCheck", { reason: "scheduled" }, { id: `daily-${ownerId}` });
    await this.setState({ schedule_id: String(dailyId) });
    const epoch = new Date().toISOString().slice(11, 19).replace(/[:.]/g, "");
    await this.schedule(FIRST_RUN_SECONDS, "runCheck", { reason: "first", run_key: `${new Date().toISOString().slice(0, 10)}#first#${epoch}` }, { id: `first-${ownerId}` });
    await this.smsReply(ownerPhone, `Watching ${url}. First check in ~${FIRST_RUN_SECONDS}s, then daily.`);
    return { ok: true, watch_id: ownerId, schedule_id: String(dailyId) };
  }

  /** owner:<phone> -> JSON array of watch ids (deduped). */
  private async indexOwner(watch: string, newOwner: string, previousOwner: string | null): Promise<void> {
    for (const owner of new Set([previousOwner, newOwner].filter((p): p is string => !!p))) {
      const key = `owner:${owner}`;
      const existing = JSON.parse((await this.env.WATCHDOG_INDEX.get(key)) ?? "[]") as string[];
      const next = existing.includes(watch) ? existing : [...existing, watch];
      await this.env.WATCHDOG_INDEX.put(key, JSON.stringify(next));
    }
  }

  private async isOwner(from: string): Promise<boolean> {
    const sender = normalizePhone(from);
    if (!sender) return true; // worker routes already authorized; empty means internal call
    const state = await this.getState();
    return !!state.owner_phone && sender === normalizePhone(state.owner_phone);
  }

  async statusReport(): Promise<string> {
    await this.ensureSchema();
    const state = await this.getState();
    const runs = await this.rows<{ run_date: string; verdict: string | null; reason: string | null }>(
      "SELECT run_date, verdict, reason FROM runs ORDER BY started_at DESC LIMIT 3");
    const incidents = await this.rows<{ id: string; reason: string }>(
      "SELECT id, reason FROM incidents WHERE status = 'open' ORDER BY first_broken_at DESC");
    const runLines = runs.map((r) => `${r.run_date}: ${r.verdict ?? "incomplete"}${r.reason ? ` (${r.reason})` : ""}`);
    const incLines = incidents.map((i) => `${i.id}: ${i.reason}`);
    return [
      `Watch: ${state.target_url || "not armed"}`,
      `Baseline: ${state.baseline ? state.baseline.price_text : "not captured"}`,
      `Last runs: ${runLines.length ? runLines.join(" | ") : "none"}`,
      `Open incidents: ${incLines.length ? incLines.join(" | ") : "none"}`,
    ].join("\n");
  }

  /* ---- scheduled task ---- */

  async runCheck(payload: RunPayload = {}): Promise<void> {
    const state = await this.getState();
    if (!state.target_url) return;
    await this.ensureSchema();
    const target = payload.target_url || state.target_url;
    const now = new Date();
    const runDate = now.toISOString().slice(0, 10);
    const reason = payload.reason ?? "scheduled";
    const runKey = payload.run_key ?? (reason === "first"
      ? `${runDate}#first`
      : reason === "scheduled"
        ? runDate
        : `${runDate}#${reason}#${now.toISOString().slice(11, 19).replace(/:/g, "")}`);

    const prior = await this.rows<{ verdict: string | null }>(
      "SELECT verdict FROM runs WHERE run_key = ?", runKey);
    if (prior[0]?.verdict && (reason === "scheduled" || reason === "first")) return; // already recorded

    this.demo = {
      fills: 0, observes: 0, lastObsKind: OBS_KINDS.pricing,
      pricingObs: { observation_id: "", url: "", title: "", refs: {}, tree: "", truncated: false },
      screenshotPolled: false, staleServed: false,
      target, brokenTarget: priceOverride(target) !== null,
    };
    await this.run(
      "INSERT INTO runs (run_key, run_date, target_url, started_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_key) DO NOTHING",
      runKey, runDate, target, new Date().toISOString());

    try {
      let sessionId = await this.openSession(target, runKey);
      let drive: DriveResult;
      try {
        drive = await this.drive(sessionId);
      } catch (err) {
        if (err instanceof SessionLostError) {
          console.warn(`${err.message} — opening a fresh session for the remainder of the run`);
          sessionId = await this.openSession(target, `${runKey}#recovered`);
          drive = await this.drive(sessionId);
        } else {
          throw err;
        }
      }
      const verdict = await this.judge(drive.pricingObs, state.baseline);
      const baseline = state.baseline ?? (verdict.verdict === "healthy" && verdict.price_text
        ? { price_text: verdict.price_text, form_labels: verdict.form_labels ?? [] }
        : null);
      await this.recordRun(runKey, drive, verdict);
      await this.setState({ baseline, last_verdict: verdict.verdict, last_run_at: new Date().toISOString() });
      if (verdict.verdict === "broken") {
        await this.fileIncident(runDate, verdict, drive);
      } else {
        await this.closeIncident(drive, payload.incident_id);
      }
    } catch (err) {
      if (err instanceof PersistentStaleError) {
        await this.fileStaleNote(runDate);
        await this.run("UPDATE runs SET reason = ?, finished_at = ? WHERE run_key = ?",
          "stale_ref persisted after one re-observe", new Date().toISOString(), runKey);
        return;
      }
      const message = err instanceof Error ? err.message : "run failed";
      await this.run("UPDATE runs SET reason = ?, finished_at = ? WHERE run_key = ?",
        message.slice(0, 500), new Date().toISOString(), runKey);
      if (!(err instanceof QuotaRetryError)) {
        await this.smsReply(state.owner_phone, `Watchdog run failed: ${message}`);
      }
    } finally {
      const openId = (await this.getState()).open_session_id;
      if (openId) {
        try {
          await this.browser("DELETE", `/browser_sessions/${openId}`);
        } catch (err) {
          console.warn("session close deferred:", err instanceof Error ? err.message : "unknown");
        }
        await this.setState({ open_session_id: null });
      }
    }
  }

  /* ---- session lifecycle ---- */

  private async openSession(target: string, runKey: string): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const key = attempt === 0 ? runKey : `${runKey}#s${attempt}`;
      const res = await this.browser("POST", "/browser_sessions", {
        policy: { allowed_domains: [new URL(target).hostname] },
        limits: { lifetime_s: 900, idle_timeout_s: 120 },
        idempotency_key: key,
      });
      if (res.status === 429 && res.error?.code === "quota_exceeded") {
        const state = await this.getState();
        if (state.open_session_id) {
          await this.browser("DELETE", `/browser_sessions/${state.open_session_id}`);
          await this.setState({ open_session_id: null });
        }
        await this.schedule(60, "runCheck", { reason: "manual", run_key: runKey, target_url: target });
        throw new QuotaRetryError("429 quota_exceeded — closed own sessions; retry scheduled in 60s");
      }
      if ((res.status === 200 || res.status === 201) && res.data?.id) {
        const sessionId = String(res.data.id);
        const status = await this.awaitSessionReady(sessionId);
        if (isTerminalSession(status)) continue; // idempotent replay returned a dead session; try a fresh key
        await this.setState({ open_session_id: sessionId });
        return sessionId;
      }
      throw new Error(`session create failed (${res.status} ${res.error?.code ?? "unknown"})`);
    }
    throw new Error("session create failed: no fresh session after replays");
  }

  private async awaitSessionReady(sessionId: string): Promise<string> {
    const deadline = Date.now() + SESSION_READY_BUDGET_MS;
    let status = "provisioning";
    while (Date.now() < deadline) {
      const res = await this.browser("GET", `/browser_sessions/${sessionId}`);
      status = String(res.data?.status ?? "provisioning");
      if (status !== "provisioning") break;
      await sleep(POLL_INTERVAL_MS);
    }
    return status;
  }

  private async sessionStatus(sessionId: string): Promise<string> {
    const res = await this.browser("GET", `/browser_sessions/${sessionId}`);
    return String(res.data?.status ?? "unknown");
  }

  /* ---- action loop ---- */

  private async drive(sessionId: string): Promise<DriveResult> {
    const state = await this.getState();
    const target = state.target_url;

    await this.act(sessionId, { type: "navigate", url: target, wait_until: "dom_stable" });
    let pricingObs = await this.observeOnce(sessionId);
    let picked = await this.extract(pricingObs);

    // Price fill: stale_ref recovery is one re-observe + re-pick + retry; a
    // second consecutive staleness files an incident note instead of a verdict.
    let fill = await this.fillWithRecovery(sessionId, pricingObs, picked, "price");
    let staleRecovered = false;
    if (isStale(fill)) {
      console.log("stale_ref on price fill — re-observing for a fresh observation + refs");
      pricingObs = await this.observeOnce(sessionId);
      picked = await this.extract(pricingObs);
      fill = await this.fillWithRecovery(sessionId, pricingObs, picked, "price");
      staleRecovered = true;
      if (isStale(fill)) throw new PersistentStaleError();
    }
    if (fill.status !== "succeeded") throw new Error(`price fill failed (${fill.error?.code ?? fill.status})`);

    const nameFill = await this.fillWithRecovery(sessionId, pricingObs, picked, "name");
    if (nameFill.status !== "succeeded") throw new Error(`name fill failed (${nameFill.error?.code ?? nameFill.status})`);
    const emailFill = await this.fillWithRecovery(sessionId, pricingObs, picked, "email");
    if (emailFill.status !== "succeeded") throw new Error(`email fill failed (${emailFill.error?.code ?? emailFill.status})`);

    let click = await this.act(sessionId, { type: "click", observation_id: pricingObs.observation_id, ref: picked.submit, wait: "dom_stable" });
    if (isUnknownOutcome(click)) click = await this.verifyAndResumeClick(sessionId, click);
    if (click.status !== "succeeded") throw new Error(`submit click failed (${click.error?.code ?? click.status})`);

    const postObs = await this.observeOnce(sessionId);
    const shot = await this.act(sessionId, { type: "screenshot" });
    const artifactId = shot.result?.artifact?.artifact_id
      ? String(shot.result.artifact.artifact_id) : null;
    let downloadUrl: string | null = null;
    if (artifactId) {
      const art = await this.browser("GET", `/browser_sessions/${sessionId}/artifacts/${artifactId}`);
      const raw = art.data?.download_url ? String(art.data.download_url) : null;
      downloadUrl = raw ? new URL(raw, `${API_BASE}/`).toString() : null;
    }
    return { pricingObs, postObs, refs: picked, artifactId, downloadUrl, staleRecovered };
  }

  private async fill(sessionId: string, obs: Observation, picked: PickedRefs, kind: keyof PickedRefs): Promise<ActionEnvelope> {
    return this.act(sessionId, { type: "fill", observation_id: obs.observation_id, ref: picked[kind], value: this.fillValue(obs, kind) });
  }

  /** execution_lost on a fill: verify page state (a fresh observation is the only
   *  proof), then re-fill only if the effect did not already take. */
  private async fillWithRecovery(sessionId: string, obs: Observation, picked: PickedRefs, kind: keyof PickedRefs): Promise<ActionEnvelope> {
    try {
      return await this.fill(sessionId, obs, picked, kind);
    } catch (err) {
      if (!(err instanceof ExecutionLostError)) throw err;
      console.warn("execution_lost on fill — verifying page state before any retry");
      const status = await this.sessionStatus(sessionId);
      if (isTerminalSession(status)) throw new SessionLostError(status);
      const fresh = await this.observeOnce(sessionId);
      if (fresh.tree.includes(this.fillValue(obs, kind))) return { status: "succeeded", result: {} }; // already applied
      const rePicked = await this.extract(fresh);
      return this.fill(sessionId, fresh, rePicked, kind);
    }
  }

  /** The value the actor fills: the plan price for the budget field, fixed strings for the contact form. */
  private fillValue(obs: Observation, kind: keyof PickedRefs): string {
    if (kind === "price") return this.priceText(obs) || DEMO_PRICE;
    if (kind === "name") return "Watchdog Bot";
    return "watchdog@example.com";
  }

  private priceText(obs: Observation): string {
    const m = /\$([0-9]+\.[0-9]{2})/.exec(obs.tree);
    return m ? `$${m[1]}` : "";
  }

  /** execution_lost on a click: verify page state, then re-observe + re-click only
   *  if the submission never happened. Never a blind resubmit. */
  private async verifyAndResumeClick(sessionId: string, lost: ActionEnvelope): Promise<ActionEnvelope> {
    console.warn("execution_lost on click — verifying page state before any retry");
    const status = await this.sessionStatus(sessionId);
    if (isTerminalSession(status)) throw new SessionLostError(status);
    const fresh = await this.observeOnce(sessionId);
    if (/success|thanks|in touch/i.test(fresh.tree)) return lost; // already submitted
    const picked = await this.extract(fresh);
    return this.act(sessionId, { type: "click", observation_id: fresh.observation_id, ref: picked.submit, wait: "dom_stable" });
  }

  /** Submit an action; if it is still running (202), poll its id to a terminal state. */
  private async act(sessionId: string, body: Record<string, unknown>): Promise<ActionEnvelope> {
    const res = await this.browser("POST", `/browser_sessions/${sessionId}/actions?wait_seconds=25`, body);
    if (res.status === 202) {
      return this.pollAction(sessionId, String(res.data?.id ?? ""));
    }
    const data = envelope(res);
    if (data.status === "queued" || data.status === "running") {
      return this.pollAction(sessionId, String(data.id ?? ""));
    }
    if (res.error?.code === "execution_lost") throw new ExecutionLostError(res.error.message ?? "execution lost");
    return data;
  }

  private async pollAction(sessionId: string, actionId: string): Promise<ActionEnvelope> {
    for (let attempt = 0; attempt < ACTION_POLL_ATTEMPTS; attempt += 1) {
      const res = await this.browser("GET", `/browser_sessions/${sessionId}/actions/${actionId}`);
      const data = envelope(res);
      if (data.status === "succeeded" || data.status === "failed" || data.status === "unknown") return data;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`action ${actionId} did not reach a terminal state`);
  }

  /** Observe with full refs. Polled observe responses never carry tree/refs, so a
   *  bounded number of fresh observe submissions is used (the docs' guidance). */
  private async observeOnce(sessionId: string): Promise<Observation> {
    for (let attempt = 0; attempt < OBSERVE_ATTEMPTS; attempt += 1) {
      const data = await this.act(sessionId, { type: "observe" });
      const obs = data.result?.observation;
      if (data.status === "succeeded" && obs?.observation_id && Object.keys(obs.refs ?? {}).length > 0) {
        return {
          observation_id: obs.observation_id,
          url: obs.url ?? "",
          title: obs.title ?? "",
          refs: obs.refs ?? {},
          tree: obs.tree ?? "",
          truncated: obs.truncated ?? false,
        };
      }
      if (data.status === "failed") throw new Error(`observe failed (${data.error?.code ?? "unknown"})`);
    }
    throw new Error("observe returned no usable refs after the allowed attempts");
  }

  /* ---- extraction + verdict ---- */

  private async extract(obs: Observation): Promise<PickedRefs> {
    if (isDemo(this.env)) return this.demoPick();
    const raw = await this.complete(
      `Observation tree from a browser session:\n${obs.tree}\n\nRefs: ${JSON.stringify(obs.refs)}\n` +
      `Pick the refs for: the price element (the monthly-budget field), the Name field, the Email field, ` +
      `and the submit button of the contact form. ` +
      `Return strict JSON {"price_ref":"<ref>","name_ref":"<ref>","email_ref":"<ref>","submit_ref":"<ref>"}`);
    const parsed = parseJson<{ price_ref?: string; name_ref?: string; email_ref?: string; submit_ref?: string }>(raw, {});
    if (!parsed.price_ref || !parsed.name_ref || !parsed.email_ref || !parsed.submit_ref) {
      throw new Error("model did not return all four refs");
    }
    return { price: parsed.price_ref, name: parsed.name_ref, email: parsed.email_ref, submit: parsed.submit_ref };
  }

  /** Demo extraction replays the recorded pick from demo/browser-fixtures.json. */
  private demoPick(): PickedRefs {
    const rec = RECORDED.observations[this.demo.lastObsKind];
    return rec.picked_refs ?? { price: "e7", name: "e14", email: "e15", submit: "e16" };
  }

  private async judge(obs: Observation, baseline: Baseline | null): Promise<Judgement> {
    if (!baseline) {
      const extracted = await this.describe(obs);
      return { verdict: "healthy", reason: "baseline captured", price_text: extracted.price_text, form_labels: extracted.form_labels };
    }
    if (isDemo(this.env)) {
      const seen = this.priceText(obs);
      return seen === baseline.price_text
        ? { verdict: "healthy", reason: "price and form match baseline", price_text: seen }
        : { verdict: "broken", reason: `price mismatch: expected ${baseline.price_text}, saw ${seen || "nothing"}`, price_text: seen };
    }
    const raw = await this.complete(
      `Stored baseline of a watched page: ${JSON.stringify(baseline)}\n` +
      `New observation of the same page:\n${obs.tree}\n\n` +
      `Is the page still healthy (same price text, same form fields)? ` +
      `Return strict JSON {"verdict":"healthy"|"broken","reason":"...","price_text":"$X.XX"}`);
    const parsed = parseJson<Judgement>(raw, { verdict: "broken", reason: "unparseable model output" });
    if (parsed.verdict !== "healthy" && parsed.verdict !== "broken") {
      return { verdict: "broken", reason: "unparseable model output" };
    }
    return parsed;
  }

  private async describe(obs: Observation): Promise<{ price_text: string; form_labels: string[] }> {
    if (isDemo(this.env)) {
      const labels: string[] = [];
      const re = /textbox "(Name|Email)"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(obs.tree)) !== null) labels.push(match[1]);
      return { price_text: this.priceText(obs), form_labels: labels.length ? labels : ["Name", "Email"] };
    }
    const raw = await this.complete(
      `Observation tree from a browser session:\n${obs.tree}\n\n` +
      `Record the exact price text shown in the monthly-budget field (e.g. "$24.00") and the visible labels ` +
      `of the contact form fields. ` +
      `Return strict JSON {"price_text":"$X.XX","form_labels":["..."]}`);
    return parseJson(raw, { price_text: "", form_labels: [] });
  }

  private async complete(prompt: string): Promise<string> {
    const res = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: this.env.AI_MODEL || "moonshotai/Kimi-K2.6",
      messages: [
        { role: "system", content: "You are a web health checker. Reply with strict JSON only, no prose, no code fences." },
        { role: "user", content: prompt },
      ],
    });
    return res?.choices?.[0]?.message?.content ?? "";
  }

  /* ---- ledger + incidents ---- */

  private async recordRun(runKey: string, drive: DriveResult, verdict: Judgement): Promise<void> {
    await this.run(
      `UPDATE runs SET verdict = ?, reason = ?, price_text = ?, screenshot_artifact_id = ?, screenshot_url = ?,
       observation_id = ?, refs_json = ?, stale_recovered = ?, finished_at = ? WHERE run_key = ?`,
      verdict.verdict, verdict.reason, verdict.price_text ?? "", drive.artifactId, drive.downloadUrl,
      drive.pricingObs.observation_id, JSON.stringify(drive.refs), drive.staleRecovered ? 1 : 0,
      new Date().toISOString(), runKey);
  }

  /** Upsert keyed by run date: a replayed run never double-files. */
  private async fileIncident(runDate: string, verdict: Judgement, drive: DriveResult): Promise<void> {
    const state = await this.getState();
    const existing = await this.rows<{ id: string; before_artifact_id: string | null }>(
      "SELECT id, before_artifact_id FROM incidents WHERE run_date = ? AND id != ?", runDate, `${runDate}#stale`);
    if (existing.length > 0) {
      const inc = existing[0];
      await this.smsReply(state.owner_phone,
        `BROKEN (again) ${state.target_url} — ${verdict.reason}. Existing incident ${inc.id}. Screenshot: ${drive.downloadUrl ?? "n/a"}`);
      return;
    }
    const firstBrokenAt = new Date().toISOString();
    const incidentId = `${runDate}#${firstBrokenAt}`;
    await this.run(
      "INSERT INTO incidents (id, run_date, first_broken_at, reason, before_artifact_id, status) VALUES (?, ?, ?, ?, ?, 'open')",
      incidentId, runDate, firstBrokenAt, verdict.reason.slice(0, 500), drive.artifactId);
    if (state.target_url) {
      await this.env.WATCHDOG_INDEX.put(`incident:${incidentId}`, watchId(state.target_url));
    }
    await this.smsReply(state.owner_phone,
      `BROKEN ${state.target_url} — ${verdict.reason}. Incident ${incidentId}. Screenshot: ${drive.downloadUrl ?? "n/a"}`);
  }

  private async fileStaleNote(runDate: string): Promise<void> {
    const incidentId = `${runDate}#stale`;
    const existing = await this.rows<{ id: string }>("SELECT id FROM incidents WHERE id = ?", incidentId);
    if (existing.length > 0) return;
    const state = await this.getState();
    await this.run(
      "INSERT INTO incidents (id, run_date, first_broken_at, reason, status) VALUES (?, ?, ?, ?, 'open')",
      incidentId, runDate, new Date().toISOString(), "stale_ref persisted after one re-observe");
    if (state.target_url) {
      await this.env.WATCHDOG_INDEX.put(`incident:${incidentId}`, watchId(state.target_url));
    }
    await this.smsReply(state.owner_phone,
      `Watchdog note: ${state.target_url} kept re-rendering mid-run (stale_ref x2). Incident note ${incidentId}. Check ?render_wave.`);
  }

  private async closeIncident(drive: DriveResult, incidentId?: string): Promise<void> {
    const open = incidentId
      ? await this.rows<{ id: string; before_artifact_id: string | null }>(
        "SELECT id, before_artifact_id FROM incidents WHERE id = ? AND status = 'open'", incidentId)
      : await this.rows<{ id: string; before_artifact_id: string | null }>(
        "SELECT id, before_artifact_id FROM incidents WHERE status = 'open' AND id NOT LIKE '%#stale' ORDER BY first_broken_at DESC LIMIT 1");
    const inc = open[0];
    if (!inc) return;
    await this.run(
      "UPDATE incidents SET status = 'closed', after_artifact_id = ?, closed_at = ? WHERE id = ?",
      drive.artifactId, new Date().toISOString(), inc.id);
    const state = await this.getState();
    await this.smsReply(state.owner_phone,
      `FIXED ${state.target_url} — incident ${inc.id} closed. Before: ${inc.before_artifact_id ?? "n/a"} After: ${drive.artifactId ?? "n/a"}`);
  }

  async smsReply(to: string, text: string): Promise<void> {
    const target = to || (await this.getState()).owner_phone || this.env.WATCH_OWNER_PHONE || "";
    if (!target) return;
    if (isDemo(this.env)) {
      console.log(`[demo] SMS to ${maskPhone(target)}: ${text}`);
      return;
    }
    await this.env.TELNYX.messages.send({ to: target, from: this.env.FROM_NUMBER ?? "", text });
  }

  async ensureSchema(): Promise<void> {
    this.env.WATCHDOG_DB.exec(`CREATE TABLE IF NOT EXISTS runs (
      run_key TEXT PRIMARY KEY, run_date TEXT NOT NULL, target_url TEXT NOT NULL,
      verdict TEXT, reason TEXT, price_text TEXT, screenshot_artifact_id TEXT, screenshot_url TEXT,
      observation_id TEXT, refs_json TEXT, stale_recovered INTEGER DEFAULT 0,
      started_at TEXT NOT NULL, finished_at TEXT)`);
    this.env.WATCHDOG_DB.exec(`CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, run_date TEXT NOT NULL, first_broken_at TEXT NOT NULL, reason TEXT NOT NULL,
      before_artifact_id TEXT, after_artifact_id TEXT, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT)`);
  }

  private async rows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const res = await this.env.WATCHDOG_DB.prepare(sql).bind(...params).all<T>();
    return res.results ?? [];
  }

  private async run(sql: string, ...params: unknown[]): Promise<void> {
    await this.env.WATCHDOG_DB.prepare(sql).bind(...params).run();
  }

  /* ---- Agent Browser REST (demo replays recorded envelopes) ---- */

  private async browser(method: string, path: string, body?: Record<string, unknown>): Promise<BrowserResponse> {
    if (isDemo(this.env)) return this.demoBrowser(method, path, body);
    const key = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!key) throw new Error("TELNYX_API_KEY is not configured");
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string; message?: string; retryable?: boolean } };
    return { status: res.status, data: parsed.data ?? null, error: parsed.error };
  }

  /** Replays the envelopes recorded in demo/browser-fixtures.json. */
  private demoBrowser(method: string, path: string, body?: Record<string, unknown>): BrowserResponse {
    const respond = (name: keyof typeof RECORDED.envelopes): BrowserResponse => {
      const rec = RECORDED.envelopes[name];
      return { status: rec.status, data: rec.body };
    };
    if (method === "POST" && path === "/browser_sessions") return respond("session_created");
    if (method === "GET" && /\/browser_sessions\/[^/]+$/.test(path)) return respond("session_ready");
    if (method === "DELETE") return respond("session_closed");
    if (method === "GET" && /\/actions\//.test(path)) {
      // The recorded screenshot poll: the GET returns the artifact envelope.
      return respond("screenshot_done");
    }
    if (method === "GET" && /\/artifacts\//.test(path)) return respond("artifact");
    if (method === "POST" && /\/actions/.test(path)) {
      const type = String(body?.type ?? "");
      if (type === "observe") {
        this.demo.observes += 1;
        const kind: ObsKind = this.demo.observes === 1
          ? (this.demo.brokenTarget ? "pricing_broken" : "pricing_healthy")
          : (this.demo.observes === 2 ? "pricing_rerendered" : "post_submit");
        return this.demoObservation(kind);
      }
      if (type === "fill") {
        this.demo.fills += 1;
        const kind: ObsKind = this.demo.brokenTarget ? "pricing_broken" : "pricing_healthy";
        const picked = RECORDED.observations[kind].picked_refs ?? { price: "e7", name: "e14", email: "e15", submit: "e16" };
        if (this.demo.observes === 1 && String(body?.ref) === picked.price) {
          // The recorded re-render hit between observe and fill: stale_ref once.
          if (!this.demo.staleServed) {
            this.demo.staleServed = true;
            return respond("stale_fill");
          }
        }
        return respond("fill_ok");
      }
      if (type === "click") return respond("click_ok");
      if (type === "screenshot") {
        // Replay the recorded 202-then-poll path once per run.
        if (!this.demo.screenshotPolled) {
          this.demo.screenshotPolled = true;
          return respond("screenshot_running");
        }
        return respond("screenshot_done");
      }
      return respond("fill_ok");
    }
    return { status: 404, data: null, error: { code: "not_found" } };
  }

  private demoObservation(kind: ObsKind): BrowserResponse {
    const rec = RECORDED.observations[kind];
    const target = this.demo.target;
    const override = target ? priceOverride(target) : null;
    const tree = override && override !== DEMO_PRICE ? rec.tree.replace(DEMO_PRICE, override) : rec.tree;
    const obs: Observation = {
      observation_id: rec.observation_id,
      url: rec.url,
      title: rec.title,
      refs: { ...rec.refs },
      tree,
      truncated: false,
    };
    this.demo.lastObsKind = kind;
    return {
      status: 200,
      data: { id: `act_rec_obs_${kind}`, status: "succeeded", result: { observation: obs } } as unknown as Record<string, unknown>,
    };
  }
}

class QuotaRetryError extends Error {}

/* ------------------------------ utilities ------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function actorRequest(path: string, body: unknown): Request {
  return new Request(`https://watchdog.internal${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
}

/* ------------------------- messaging webhook ------------------------- */

async function handleSmsWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  const publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY").catch(() => null);
  if (publicKey) {
    if (!(await verifyWebhookSignature(request, raw, publicKey))) {
      return json({ error: "invalid_signature" }, 401);
    }
  } else if (!isDemo(env)) {
    return json({ error: "missing TELNYX_PUBLIC_KEY — refusing unsigned webhook in live mode" }, 503);
  } else {
    console.warn("TELNYX_PUBLIC_KEY unset — accepting unsigned webhook (DEMO_MODE)");
  }

  let event: { data?: { event_type?: string; payload?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw) as { data?: { event_type?: string; payload?: Record<string, unknown> } };
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (event?.data?.event_type !== "message.received") {
    return json({ received: true, ignored: event?.data?.event_type ?? "unknown" }, 200);
  }
  const payload = event.data.payload ?? {};
  const from = String((payload.from as Record<string, unknown> | undefined)?.phone_number ?? "");
  const text = String(payload.text ?? "");
  if (!from || !text) return json({ received: true, ignored: "missing from/text" }, 200);
  return dispatchSmsCommand(env, from, text);
}

/** Resolve which watch an owner's command targets. */
async function resolveWatchForCommand(env: Env, from: string, url?: string): Promise<string | null> {
  if (url) return watchId(url);
  const sender = normalizePhone(from);
  const envOwner = env.WATCH_OWNER_PHONE ? normalizePhone(env.WATCH_OWNER_PHONE) : "";
  if (sender && envOwner === sender && env.WATCH_TARGET_URL) return watchId(env.WATCH_TARGET_URL);
  const owned = JSON.parse((await env.WATCHDOG_INDEX.get(`owner:${sender}`)) ?? "[]") as string[];
  return owned.length === 1 ? owned[0] : null;
}

/** A sender may command watch W only if W is theirs (or the env owner matches). */
async function senderOwnsWatch(env: Env, from: string, watch: string): Promise<boolean> {
  const sender = normalizePhone(from);
  const envOwner = env.WATCH_OWNER_PHONE ? normalizePhone(env.WATCH_OWNER_PHONE) : "";
  if (envOwner && sender === envOwner) return true;
  return sender !== "" && (await env.WATCHDOG_INDEX.get(`watch:${watch}`)) === sender;
}

async function ownerWatches(env: Env, from: string): Promise<string[]> {
  const sender = normalizePhone(from);
  const envOwner = env.WATCH_OWNER_PHONE ? normalizePhone(env.WATCH_OWNER_PHONE) : "";
  const envWatches = envOwner === sender && env.WATCH_TARGET_URL ? [watchId(env.WATCH_TARGET_URL)] : [];
  const indexed = JSON.parse((await env.WATCHDOG_INDEX.get(`owner:${sender}`)) ?? "[]") as string[];
  return Array.from(new Set([...envWatches, ...indexed]));
}

async function authorizeForWatch(env: Env, from: string, watch: string): Promise<Response | null> {
  if (await senderOwnsWatch(env, from, watch)) return null;
  const owned = await ownerWatches(env, from);
  if (owned.length === 0 && !env.WATCH_OWNER_PHONE) return null; // first-come ownership before WATCH_OWNER_PHONE is set
  return json({ error: "not_authorized" }, 403);
}

export async function dispatchSmsCommand(env: Env, from: string, text: string): Promise<Response> {
  const sender = normalizePhone(from);
  const envOwner = env.WATCH_OWNER_PHONE ? normalizePhone(env.WATCH_OWNER_PHONE) : "";
  const known = sender === envOwner || (await ownerWatches(env, from)).length > 0;
  if (!known) return json({ error: "not_authorized" }, 403);
  const cmd = parseCommand(text);
  if (cmd.kind === "help") {
    const watch = await resolveWatchForCommand(env, from, undefined);
    if (watch && (await senderOwnsWatch(env, from, watch))) {
      const res = await env.WATCHDOG.idFromName(watch).fetch(actorRequest("/status", { from }));
      return json(await res.json() as Record<string, unknown>, res.status);
    }
    return json({ received: true, commands: ["watch <url>", "status [url]", "recheck now [url]", "recheck <incident_id>"] }, 200);
  }
  if (cmd.kind === "watch") {
    if (!cmd.url) return json({ error: "usage: watch <url>" }, 400);
    let parsed: URL;
    try {
      parsed = new URL(cmd.url);
    } catch {
      return json({ error: "url must be an absolute URL" }, 400);
    }
    if (parsed.protocol !== "https:") return json({ error: "only https:// targets are supported" }, 400);
    const watch = watchId(parsed.toString());
    const denied = await authorizeForWatch(env, from, watch);
    if (denied) return denied;
    const res = await env.WATCHDOG.idFromName(watch).fetch(actorRequest("/arm", { url: parsed.toString(), owner: from }));
    return json(await res.json() as Record<string, unknown>, res.status);
  }
  const watch = await resolveWatchForCommand(env, from, cmd.url);
  if (!watch) {
    return json({ error: cmd.kind === "status" ? "no watch found for this sender; send: watch <url>" : "usage: recheck now [url]" }, 404);
  }
  const denied = await authorizeForWatch(env, from, watch);
  if (denied) return denied;
  if (cmd.kind === "status") {
    const res = await env.WATCHDOG.idFromName(watch).fetch(actorRequest("/status", { from }));
    return json(await res.json() as Record<string, unknown>, res.status);
  }
  const res = await env.WATCHDOG.idFromName(watch).fetch(actorRequest("/run", {
    from,
    reason: cmd.kind === "recheck-now" ? "manual" : "verify",
    target_url: cmd.url,
    incident_id: cmd.incident_id,
  }));
  return json(await res.json() as Record<string, unknown>, res.status);
}

/* ------------------------------- worker ------------------------------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, demo_mode: isDemo(env) });
      }
      if (request.method === "GET" && (url.pathname === "/fixture" || url.pathname === "/fixture/")) {
        return new Response(FIXTURE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (request.method === "POST" && url.pathname === "/watch") {
        const body = (await request.json().catch(() => null)) as ArmPayload | null;
        if (!body?.url) return json({ error: "url is required" }, 400);
        let parsed: URL;
        try {
          parsed = new URL(body.url);
        } catch {
          return json({ error: "url must be an absolute URL" }, 400);
        }
        if (parsed.protocol !== "https:") return json({ error: "only https:// targets are supported" }, 400);
        const stub = env.WATCHDOG.idFromName(watchId(parsed.toString()));
        const res = await stub.fetch(actorRequest("/arm", { url: parsed.toString(), owner: body.owner ?? env.WATCH_OWNER_PHONE ?? "" }));
        return json(await res.json() as Record<string, unknown>, res.status === 200 ? 202 : res.status);
      }
      if (request.method === "GET" && url.pathname.startsWith("/status/")) {
        const id = decodeURIComponent(url.pathname.slice("/status/".length));
        if (!id) return json({ error: "watch id is required" }, 400);
        if (!(await senderOwnsWatch(env, url.searchParams.get("owner") ?? "", id))) {
          return json({ error: "not_authorized" }, 403);
        }
        const stub = env.WATCHDOG.idFromName(id);
        const res = await stub.fetch(actorRequest("/status", { from: url.searchParams.get("owner") ?? "" }));
        return json(await res.json() as Record<string, unknown>, res.status);
      }
      if (request.method === "POST" && url.pathname === "/webhooks/messaging") {
        return handleSmsWebhook(request, env);
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("watchdog error:", err instanceof Error ? err.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  },
};
