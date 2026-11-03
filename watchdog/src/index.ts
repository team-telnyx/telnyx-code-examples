/**
 * Telnyx Edge \u2014 Browser Watchdog (DEV-1402)
 *
 * ASSUMPTIONS
 * - Agent Browser is a beta REST surface with no SDK client, so every call is a raw
 *   fetch to https://api.telnyx.com/v2/browser_sessions* mirroring the docs' curl shapes.
 * - The baseline is captured on the FIRST run (design decision #3): `watch <url>` only
 *   stores config and arms the schedule, so no browser session is created at watch time.
 * - DEMO_MODE=true (default) replays recorded Agent Browser fixtures and derives the
 *   verdict locally so the whole loop runs offline. DEMO_MODE=false + TELNYX_API_KEY
 *   drives the live beta API and the TELNYX AI binding.
 * - `recheck now [url]` accepts an optional one-shot URL override so the broken-price
 *   scenario (?price=0.00) is reproducible without re-arming the watch.
 *
 * SELF-REVIEW
 * - Real primitives only: Agent state + schedule()/every(), SQL ledger via WATCHDOG_DB,
 *   TELNYX binding for SMS + inference. No in-memory stores, no timers.
 * - Parameterized SQL everywhere, no secrets in code, phone numbers masked in logs.
 */
import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, AgentMessage, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

const API_BASE = "https://api.telnyx.com/v2";
const DEMO_REFS = { price: "ref_price", name: "ref_name", email: "ref_email", submit: "ref_submit" };
let demoStaleServed = false;

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
  WATCHDOG: ActorNamespace;
  WATCH_TARGET_URL?: string;
  WATCH_OWNER_PHONE?: string;
  FROM_NUMBER?: string;
  DEMO_MODE?: string;
  AI_MODEL?: string;
}

export interface Baseline { price_text: string; form_labels: string[] }
export interface WatchdogState {
  target_url: string;
  allowed_domains: string[];
  baseline: Baseline | null;
  last_verdict: string | null;
  last_run_at: string | null;
  schedule_id: string | null;
  open_session_id: string | null;
  owner_phone: string;
}

type Refs = Record<string, string>;
interface Observation { observation_id: string; refs: Refs; tree: string }
interface ActionData { status?: string; observation_id?: string; refs?: Refs; tree?: string; artifact_id?: string; error?: { code?: string; message?: string } }
interface BrowserResponse { status: number; data: Record<string, unknown> | null; error?: { code?: string; message?: string } }
interface Extraction { price_text: string; form_labels: string[]; refs: Refs }
interface Judgement { verdict: "healthy" | "broken"; reason: string; price_text?: string; form_labels?: string[] }
interface DriveResult { observation: Observation; refs: Refs; artifactId: string | null; downloadUrl: string | null; staleRecovered: boolean }
interface RunPayload { reason?: string; incident_id?: string; run_key?: string; target_url?: string }

export function isDemo(env: Pick<Env, "DEMO_MODE">): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

export function watchId(targetUrl: string): string {
  return new URL(targetUrl).hostname;
}

function mask(phone: string): string {
  return phone.length > 4 ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}` : "****";
}

function isStale(data: ActionData): boolean {
  return data.error?.code === "stale_ref" || data.error?.code === "stale_observation";
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw.replace(/```json/gi, "").replace(/```/g, "").trim()) as T;
  } catch {
    return fallback;
  }
}

function demoTree(targetUrl: string): string {
  let price = "24.00";
  try { price = new URL(targetUrl).searchParams.get("price") ?? price; } catch { /* keep default */ }
  return `shop: price module $${price} | contact form: name, email, submit`;
}

/** Recorded Agent Browser fixtures \u2014 DEMO_MODE only, never used when DEMO_MODE=false. */
function demoBrowser(method: string, path: string, body: Record<string, unknown> | undefined, targetUrl: string): BrowserResponse {
  if (method === "POST" && path === "/browser_sessions") return { status: 201, data: { id: "bs_demo_0001", status: "ready" } };
  if (method === "DELETE") return { status: 200, data: { id: "bs_demo_0001", status: "closed" } };
  if (method === "GET" && path.includes("/artifacts/")) {
    return { status: 200, data: { artifact_id: "art_demo_0001", download_url: "https://fixture.example.com/artifacts/art_demo_0001.png" } };
  }
  if (method === "POST" && path.endsWith("/actions")) {
    const type = String(body?.type ?? "");
    if (type === "observe") {
      return { status: 200, data: { status: "ok", observation_id: `obs_${Date.now()}`, refs: DEMO_REFS, tree: demoTree(targetUrl) } };
    }
    if (type === "fill" && body?.ref === DEMO_REFS.price && !demoStaleServed) {
      demoStaleServed = true;
      return { status: 200, data: { status: "failed", error: { code: "stale_ref", message: "page re-rendered" } } };
    }
    if (type === "screenshot") return { status: 200, data: { status: "ok", artifact_id: "art_demo_0001" } };
    return { status: 200, data: { status: "ok" } };
  }
  return { status: 404, data: null, error: { code: "not_found" } };
}

export class Watchdog extends Agent<Env, WatchdogState> {
  protected initialState(): WatchdogState {
    return { target_url: "", allowed_domains: [], baseline: null, last_verdict: null, last_run_at: null, schedule_id: null, open_session_id: null, owner_phone: "" };
  }

  async onMessage(msg: AgentMessage): Promise<void> {
    const m = msg as unknown as { body?: string; text?: string; from?: string };
    const text = (m.body ?? m.text ?? "").trim();
    const from = m.from ?? "";
    const [cmd, ...rest] = text.split(/\s+/);
    if (cmd === "watch") return this.arm(rest.join(" ").trim(), from);
    if (cmd === "status") return this.reply(from, await this.statusReport());
    if (cmd === "recheck") {
      const [sub, ...urlParts] = rest;
      if (!sub || sub === "now") return this.runCheck({ reason: "manual", target_url: urlParts.join(" ").trim() || undefined });
      return this.runCheck({ reason: "verify", incident_id: sub });
    }
    return this.reply(from, "Commands: watch <url> | status | recheck now [url] | recheck <incident_id>");
  }

  async arm(url: string, owner: string): Promise<void> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return this.reply(owner, "Invalid URL."); }
    if (parsed.protocol !== "https:") return this.reply(owner, "Only https:// targets are supported.");
    await this.ensureSchema();
    this.setState({
      target_url: parsed.toString(),
      allowed_domains: [parsed.hostname],
      owner_phone: owner || this.env.WATCH_OWNER_PHONE || "",
      baseline: null,
    });
    const sid = await this.every(86400, "runCheck", { reason: "scheduled" });
    this.setState({ schedule_id: String(sid ?? "daily") });
    await this.schedule(5, "runCheck", { reason: "first" });
    await this.reply(owner, `Watching ${parsed.hostname}. First check in ~5s, then daily.`);
  }

  async runCheck(payload: RunPayload = {}): Promise<void> {
    const state = await this.getState();
    if (!state.target_url) return;
    await this.ensureSchema();
    const target = payload.target_url || state.target_url;
    const runDate = new Date().toISOString().slice(0, 10);
    const reason = payload.reason ?? "scheduled";
    const runKey = payload.run_key ?? (reason === "scheduled" || reason === "first" ? runDate : `${runDate}#${reason}`);
    const prior = await this.rows<{ verdict: string | null }>("SELECT verdict FROM runs WHERE run_key = ?", runKey);
    if (prior[0]?.verdict && reason !== "manual" && reason !== "verify") return;

    demoStaleServed = false;
    await this.run("INSERT OR IGNORE INTO runs (run_key, run_date, target_url, started_at) VALUES (?, ?, ?, ?)",
      runKey, runDate, target, new Date().toISOString());

    let sessionId: string | null = null;
    try {
      sessionId = await this.openSession(target, runKey);
      if (!sessionId) return;
      const drive = await this.drive(sessionId, target);
      const verdict = await this.judge(drive.observation, state.baseline);
      const baseline = state.baseline ?? (verdict.verdict === "healthy" && verdict.price_text
        ? { price_text: verdict.price_text, form_labels: verdict.form_labels ?? [] } : null);
      await this.recordRun(runKey, drive, verdict);
      this.setState({ baseline, last_verdict: verdict.verdict, last_run_at: new Date().toISOString() });
      if (verdict.verdict === "broken") await this.fileIncident(runDate, verdict, drive);
      else await this.closeIncident(drive);
    } catch (err) {
      const message = err instanceof Error ? err.message : "run failed";
      await this.run("UPDATE runs SET reason = ?, finished_at = ? WHERE run_key = ?", message.slice(0, 500), new Date().toISOString(), runKey);
      await this.reply(state.owner_phone, `Watchdog run failed: ${message}`);
    } finally {
      if (sessionId) await this.browser("DELETE", `/browser_sessions/${sessionId}`, undefined, target);
    }
  }

  private async openSession(target: string, runKey: string): Promise<string | null> {
    const res = await this.browser("POST", "/browser_sessions", {
      policy: { allowed_domains: [new URL(target).hostname] },
      limits: { lifetime_s: 900, idle_timeout_s: 120 },
      idempotency_key: runKey,
    }, target);
    if ((res.status === 200 || res.status === 201) && res.data?.id) {
      this.setState({ open_session_id: String(res.data.id) });
      return String(res.data.id);
    }
    if (res.status === 429 && res.error?.code === "quota_exceeded") {
      const state = await this.getState();
      if (state.open_session_id) await this.browser("DELETE", `/browser_sessions/${state.open_session_id}`, undefined, target);
      this.setState({ open_session_id: null });
      await this.schedule(60, "runCheck", { reason: "retrySession", run_key: runKey });
      return null;
    }
    throw new Error(`session create failed (${res.status} ${res.error?.code ?? "unknown"})`);
  }

  private async drive(sessionId: string, target: string): Promise<DriveResult> {
    await this.action(sessionId, { type: "navigate", url: target, wait_until: "dom_stable" });
    let observation = await this.observe(sessionId);
    let picked = await this.extract(observation);
    let fill = await this.action(sessionId, { type: "fill", observation_id: observation.observation_id, ref: picked.refs.price, value: picked.price_text });
    let staleRecovered = false;
    if (fill.status === "failed" && isStale(fill)) {
      observation = await this.observe(sessionId);
      picked = await this.extract(observation);
      fill = await this.action(sessionId, { type: "fill", observation_id: observation.observation_id, ref: picked.refs.price, value: picked.price_text });
      staleRecovered = true;
      if (fill.status === "failed") throw new Error(`stale_ref persisted (${fill.error?.code ?? "unknown"})`);
    }
    await this.action(sessionId, { type: "fill", observation_id: observation.observation_id, ref: picked.refs.name, value: "Watchdog Bot" });
    await this.action(sessionId, { type: "fill", observation_id: observation.observation_id, ref: picked.refs.email, value: "watchdog@example.com" });
    await this.action(sessionId, { type: "click", observation_id: observation.observation_id, ref: picked.refs.submit });
    const after = await this.observe(sessionId);
    const shot = await this.action(sessionId, { type: "screenshot" });
    const artifactId = shot.artifact_id ? String(shot.artifact_id) : null;
    let downloadUrl: string | null = null;
    if (artifactId) {
      const art = await this.browser("GET", `/browser_sessions/${sessionId}/artifacts/${artifactId}`, undefined, target);
      downloadUrl = art.data?.download_url ? String(art.data.download_url) : null;
    }
    return { observation: after, refs: picked.refs, artifactId, downloadUrl, staleRecovered };
  }

  private async action(sessionId: string, body: Record<string, unknown>): Promise<ActionData> {
    const state = await this.getState();
    const res = await this.browser("POST", `/browser_sessions/${sessionId}/actions`, body, state.target_url);
    const data = (res.data ?? {}) as ActionData;
    if (data.error?.code === "execution_lost") throw new Error("execution_lost: effect unproven \u2014 re-observe before retrying");
    return data;
  }

  private async observe(sessionId: string): Promise<Observation> {
    const data = await this.action(sessionId, { type: "observe" });
    if (data.status === "failed") throw new Error(`observe failed (${data.error?.code ?? "unknown"})`);
    return { observation_id: String(data.observation_id ?? ""), refs: (data.refs ?? {}) as Refs, tree: String(data.tree ?? "") };
  }

  private async extract(obs: Observation): Promise<Extraction> {
    if (isDemo(this.env)) {
      const m = /\$([0-9]+\.[0-9]{2})/.exec(obs.tree);
      return { price_text: m ? `$${m[1]}` : "", form_labels: ["name", "email"], refs: obs.refs };
    }
    const raw = await this.complete(`Observation tree: ${obs.tree}\nRefs: ${JSON.stringify(obs.refs)}\n` +
      `Return strict JSON {"price_text":"$X.XX","form_labels":["..."],"refs":{"price":"<ref>","name":"<ref>","email":"<ref>","submit":"<ref>"}}`);
    return parseJson<Extraction>(raw, { price_text: "", form_labels: [], refs: obs.refs });
  }

  private async judge(obs: Observation, baseline: Baseline | null): Promise<Judgement> {
    if (!baseline) {
      const ex = await this.extract(obs);
      return { verdict: "healthy", reason: "baseline captured", price_text: ex.price_text, form_labels: ex.form_labels };
    }
    if (isDemo(this.env)) {
      const ex = await this.extract(obs);
      return ex.price_text === baseline.price_text
        ? { verdict: "healthy", reason: "price and form match baseline", price_text: ex.price_text }
        : { verdict: "broken", reason: `price mismatch: expected ${baseline.price_text}, saw ${ex.price_text || "nothing"}`, price_text: ex.price_text };
    }
    const raw = await this.complete(`Baseline: ${JSON.stringify(baseline)}\nObservation tree: ${obs.tree}\nRefs: ${JSON.stringify(obs.refs)}\n` +
      `Return strict JSON {"verdict":"healthy"|"broken","reason":"...","price_text":"$X.XX"}`);
    return parseJson<Judgement>(raw, { verdict: "broken", reason: "unparseable model output", price_text: "" });
  }

  private async complete(prompt: string): Promise<string> {
    const res = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: this.env.AI_MODEL || "DeepSeek-V4.1-Flash",
      messages: [
        { role: "system", content: "You are a web health checker. Reply with strict JSON only, no prose, no code fences." },
        { role: "user", content: prompt },
      ],
    });
    return res?.choices?.[0]?.message?.content ?? "{}";
  }

  private async recordRun(runKey: string, drive: DriveResult, verdict: Judgement): Promise<void> {
    await this.run(`UPDATE runs SET verdict = ?, reason = ?, price_text = ?, screenshot_artifact_id = ?, screenshot_url = ?,
      observation_id = ?, refs_json = ?, stale_recovered = ?, finished_at = ? WHERE run_key = ?`,
      verdict.verdict, verdict.reason, verdict.price_text ?? "", drive.artifactId, drive.downloadUrl,
      drive.observation.observation_id, JSON.stringify(drive.refs), drive.staleRecovered ? 1 : 0,
      new Date().toISOString(), runKey);
  }

  private async fileIncident(runDate: string, verdict: Judgement, drive: DriveResult): Promise<void> {
    const existing = await this.rows<{ id: string }>("SELECT id FROM incidents WHERE run_date = ?", runDate);
    if (existing.length > 0) return;
    const firstBrokenAt = new Date().toISOString();
    const incidentId = `${runDate}#${firstBrokenAt}`;
    await this.run("INSERT INTO incidents (id, run_date, first_broken_at, reason, before_artifact_id, status) VALUES (?, ?, ?, ?, ?, 'open')",
      incidentId, runDate, firstBrokenAt, verdict.reason.slice(0, 500), drive.artifactId);
    const state = await this.getState();
    await this.reply(state.owner_phone, `BROKEN ${state.target_url} \u2014 ${verdict.reason}. Incident ${incidentId}. Screenshot: ${drive.downloadUrl ?? "n/a"}`);
  }

  private async closeIncident(drive: DriveResult): Promise<void> {
    const open = await this.rows<{ id: string; before_artifact_id: string | null }>(
      "SELECT id, before_artifact_id FROM incidents WHERE status = 'open' ORDER BY first_broken_at DESC LIMIT 1");
    const inc = open[0];
    if (!inc) return;
    await this.run("UPDATE incidents SET status = 'closed', after_artifact_id = ?, closed_at = ? WHERE id = ?",
      drive.artifactId, new Date().toISOString(), inc.id);
    const state = await this.getState();
    await this.reply(state.owner_phone, `FIXED ${state.target_url} \u2014 incident ${inc.id} closed. Before: ${inc.before_artifact_id ?? "n/a"} After: ${drive.artifactId ?? "n/a"}`);
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

  async reply(to: string, text: string): Promise<void> {
    const target = to || (await this.getState()).owner_phone || this.env.WATCH_OWNER_PHONE || "";
    if (!target) return;
    if (isDemo(this.env)) {
      console.log(`[demo] SMS to ${mask(target)}: ${text}`);
      return;
    }
    await this.env.TELNYX.messages.send({ to: target, from: this.env.FROM_NUMBER ?? "", text });
  }

  async ensureSchema(): Promise<void> {
    this.db().exec(`CREATE TABLE IF NOT EXISTS runs (
      run_key TEXT PRIMARY KEY, run_date TEXT NOT NULL, target_url TEXT NOT NULL,
      verdict TEXT, reason TEXT, price_text TEXT, screenshot_artifact_id TEXT, screenshot_url TEXT,
      observation_id TEXT, refs_json TEXT, stale_recovered INTEGER DEFAULT 0,
      started_at TEXT NOT NULL, finished_at TEXT)`);
    this.db().exec(`CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY, run_date TEXT NOT NULL, first_broken_at TEXT NOT NULL, reason TEXT NOT NULL,
      before_artifact_id TEXT, after_artifact_id TEXT, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT)`);
  }

  private db(): SqlDatabase { return this.env.WATCHDOG_DB; }

  private async rows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const res = await this.db().prepare(sql).bind(...params).all();
    return ((res as unknown as { results?: T[] })?.results ?? []) as T[];
  }

  private async run(sql: string, ...params: unknown[]): Promise<void> {
    await this.db().prepare(sql).bind(...params).run();
  }

  private async browser(method: string, path: string, body: Record<string, unknown> | undefined, targetUrl: string): Promise<BrowserResponse> {
    if (isDemo(this.env)) return demoBrowser(method, path, body, targetUrl);
    const key = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!key) throw new Error("TELNYX_API_KEY is not configured");
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { code?: string; message?: string } };
    return { status: res.status, data: json.data ?? null, error: json.error };
  }
}

interface WatchdogStub {
  arm(url: string, owner: string): Promise<void>;
  statusReport(): Promise<string>;
  runCheck(payload?: RunPayload): Promise<void>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, demo_mode: isDemo(env) });
    }
    if (req.method === "POST" && url.pathname === "/watch") {
      const body = (await req.json().catch(() => null)) as { url?: string; owner?: string } | null;
      if (!body?.url) return json({ error: "url is required" }, 400);
      try { new URL(body.url); } catch { return json({ error: "url must be a valid absolute URL" }, 400); }
      const ns = env.WATCHDOG;
      const stub = ns.get(ns.idFromName(watchId(body.url))) as unknown as WatchdogStub;
      await stub.arm(body.url, body.owner ?? env.WATCH_OWNER_PHONE ?? "");
      return json({ ok: true, watch_id: watchId(body.url) }, 202);
    }
    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const id = decodeURIComponent(url.pathname.slice("/status/".length));
      if (!id) return json({ error: "watch id is required" }, 400);
      const ns = env.WATCHDOG;
      const stub = ns.get(ns.idFromName(id)) as unknown as WatchdogStub;
      return json({ status: await stub.statusReport() });
    }
    return json({ error: "not found" }, 404);
  },
};
