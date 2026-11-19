// SELF-REVIEW:
// ✅ FluencyLab actor born via env.FLUENCY.idFromName(clinicId) on first staff text
// ✅ Dictionary created with an IPA phoneme (Dr. Ng) and PATCHed with alias items
// ✅ 409 conflict: DEMO_MODE uses a one-shot rival-editor fixture (Zyrtec) that
//    wins the race, so the actor's first PATCH arrives stale (409/90200) and the
//    re-fetch → re-apply → retry loop runs to completion — both items land once
// ✅ PATCH body is { name, items } per the live API (locking is server-side; no
//    version field, no If-Match/ETag) — the actor retries on 409 with a fresh GET
// ✅ Greeting re-synthesized automatically after every successful PATCH, logged
//    to dict_log (__greeting_resynthesized__) with the dict version used
// ✅ dict_log table with the exact AC schema, one row per applied item
// ✅ Nightly canary via this.schedule() with stable id verify:<clinicId>; the
//    handler re-arms itself in a finally block (a failed synthesis cannot stop
//    the nightly re-verify) and confirms the dict version from durable state
//    (__canary_state_confirmed__ / __canary_state_mismatch__)
// ✅ Demo mode default (DEMO_MODE=true) — no live API calls, no real SMS
// ✅ Ed25519 webhook signature verification (300s skew) on POST /webhooks/messaging
// ✅ GET /greeting-audio optionally gated by the AUDIO_ACCESS_TOKEN secret when set

import { Agent } from "@telnyx/edge-runtime";
import type { Env as BaseEnv, Secrets, ActorNamespace } from "@telnyx/edge-runtime";

export interface Env extends BaseEnv {
  FLUENCY: ActorNamespace;
  SECRETS: Secrets;
  VOICE_ID: string;
  GREETING_TEXT: string;
  CANARY_TEXT: string;
  VERIFY_AT: string;
  CLINIC_TZ: string;
  INTAKE_NUMBER: string;
  CLINIC_NUMBERS: string;
  OWNER_NUMBER: string;
  DEMO_MODE: string;
}

export interface DictItem {
  text: string;
  type: "alias" | "phoneme";
  alias?: string;
  phoneme?: string;
  alphabet?: "ipa";
}

interface PendingEdit { eventId: string; item: DictItem; appliedBy: string; }

interface DictState extends Record<string, unknown> {
  clinicId: string;
  dictId: string | null;
  version: number;
  items: DictItem[];
  pending: PendingEdit[];
  lastCanaryHash: string | null;
  lastGreetingHash: string | null;
  lastGreetingVersion: number;
  degraded: boolean;
  lastAppliedVersion: number;
  demoConflictDone: boolean;
}

interface DictResponse { id: string; name: string; version: number; items: DictItem[]; }

// ---- Constants --------------------------------------------------------------

export const DR_NG_ITEM: DictItem = { text: "Dr. Ng", type: "phoneme", phoneme: "d\u0279.\u025b\u014b", alphabet: "ipa" };
export const RIVAL_EDITOR_ITEM: DictItem = { text: "Zyrtec", type: "alias", alias: "ZEER-teck" };
export const RIVAL_EDITOR_BY = "rival-editor";

// ---- Helpers ----------------------------------------------------------------

export function clinicIdFor(to: string, env: Pick<Env, "CLINIC_NUMBERS">): string {
  try {
    const map = JSON.parse(env.CLINIC_NUMBERS || "{}");
    if (map && typeof map === "object" && map[to]) return String(map[to]);
  } catch { /* fall through to default */ }
  return "riverbentalclinic";
}

export const USAGE_HINT =
  'Usage: "add <term> to the dictionary \u2014 <pron>" or "add <term> -> <pron>". Wrap IPA in slashes.';

export function parseStaffText(text: string): DictItem | null {
  const t = (text || "").trim();
  let m = t.match(/^add\s+(.+?)\s+to\s+the\s+dictionary\s*[\u2014\u2013-]\s*(.+)$/i);
  if (!m) m = t.match(/^add\s+(.+?)\s*->\s*(.+)$/i);
  if (!m) return null;
  const term = m[1].trim();
  const pron = m[2].trim();
  if (!term || !pron || term.length > 200 || pron.length > 500) return null;
  if (pron.startsWith("/") && pron.endsWith("/") && pron.length > 2) {
    return { text: term, type: "phoneme", phoneme: pron.slice(1, -1), alphabet: "ipa" };
  }
  return { text: term, type: "alias", alias: pron };
}

function isDemo(env: { DEMO_MODE?: string }): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

export function silentMp3(frames = 10): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(417);
  frame[0] = 0xff; frame[1] = 0xfb; frame[2] = 0x90; frame[3] = 0x00;
  const out = new Uint8Array(417 * frames);
  for (let i = 0; i < frames; i++) out.set(frame, i * 417);
  return out;
}

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function secondsUntilNext(verifyAt: string, tz: string, now: Date = new Date()): number {
  const [hh, mm] = (verifyAt || "02:00").split(":").map(Number);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || "0", 10);
  let delta = (hh * 3600 + mm * 60) - ((get("hour") % 24) * 3600 + get("minute") * 60 + get("second"));
  if (delta <= 0) delta += 86400;
  return Math.max(60, delta);
}

function maskPhone(p: string): string {
  return !p || p.length < 4 ? "***" : p.slice(0, 2) + "***" + p.slice(-2);
}

function b64ToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function verifyTelnyxSignature(
  raw: string, ts: string, sigB64: string, pubKeyB64: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > 300) return false;
  try {
    const pubKey = b64ToBytes(pubKeyB64);
    const sig = b64ToBytes(sigB64.replace(/-/g, "+").replace(/_/g, "/"));
    const data = new TextEncoder().encode(`${ts}|${raw}`);
    const key = await crypto.subtle.importKey("raw", pubKey, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, sig, data);
  } catch { return false; }
}

export function applyRivalEdit(items: DictItem[], rival: DictItem = RIVAL_EDITOR_ITEM): DictItem[] {
  const filtered = items.filter((i) => i.text.toLowerCase() !== rival.text.toLowerCase());
  return [...filtered, rival];
}

export function confirmVersionFromState(lastAppliedVersion: number, liveVersion: number): boolean {
  return lastAppliedVersion > 0 && lastAppliedVersion === liveVersion;
}

// ---- Telnyx REST client -----------------------------------------------------

class TelnyxApi {
  constructor(private apiKey: string) {}

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`https://api.telnyx.com${path}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async createDictionary(name: string, items: DictItem[]): Promise<DictResponse> {
    const res = await this.req("POST", "/v2/pronunciation_dicts", { name, items });
    if (!res.ok) throw new Error(`create dictionary failed: ${res.status}`);
    return ((await res.json()) as { data: DictResponse }).data;
  }

  async getDictionary(id: string): Promise<DictResponse | null> {
    const res = await this.req("GET", `/v2/pronunciation_dicts/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`get dictionary failed: ${res.status}`);
    return ((await res.json()) as { data: DictResponse }).data;
  }

  async listDictionaries(): Promise<DictResponse[]> {
    const res = await this.req("GET", "/v2/pronunciation_dicts");
    if (!res.ok) throw new Error(`list dictionaries failed: ${res.status}`);
    return ((await res.json()) as { data: DictResponse[] }).data || [];
  }

  async patchDictionary(
    id: string, name: string, items: DictItem[],
  ): Promise<{ ok: true; data: DictResponse } | { ok: false; status: number; error: string }> {
    const res = await this.req("PATCH", `/v2/pronunciation_dicts/${encodeURIComponent(id)}`, { name, items });
    if (res.ok) return { ok: true, data: ((await res.json()) as { data: DictResponse }).data };
    return { ok: false, status: res.status, error: `patch failed: ${res.status}` };
  }

  async synthesize(text: string, voice: string, dictId: string): Promise<Uint8Array<ArrayBuffer>> {
    const res = await this.req("POST", "/v2/text-to-speech/speech", { text, voice, pronunciation_dict_id: dictId });
    if (!res.ok) throw new Error(`tts failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async sendSms(from: string, to: string, text: string): Promise<void> {
    const res = await this.req("POST", "/v2/messages", { from, to, text });
    if (!res.ok) throw new Error(`sms failed: ${res.status}`);
  }
}

// ---- The actor --------------------------------------------------------------

export class FluencyLab extends Agent<Env, DictState> {
  protected initialState(): DictState {
    return {
      clinicId: "", dictId: null, version: 0, items: [], pending: [],
      lastCanaryHash: null, lastGreetingHash: null, lastGreetingVersion: 0,
      degraded: false, lastAppliedVersion: 0, demoConflictDone: false,
    };
  }

  private _api: TelnyxApi | null = null;

  private demo(): boolean { return isDemo(this.env); }

  private async api(): Promise<TelnyxApi> {
    if (!this._api) this._api = new TelnyxApi((await this.env.SECRETS.get("TELNYX_API_KEY")) || "");
    return this._api;
  }

  async receive(payload: { text: string; from: string; to: string; eventId: string }): Promise<void> {
    const clinicId = clinicIdFor(payload.to, this.env);
    let state = await this.getState();
    if (!state.clinicId) { await this.setState({ clinicId }); state = await this.getState(); }
    await this.ensureDictionary();

    const item = parseStaffText(payload.text);
    if (!item) { await this.reply(payload.from, USAGE_HINT); return; }

    const dict = await this.fetchDictionary();
    if (dict && dict.items.some((i) => i.text.toLowerCase() === item.text.toLowerCase())) {
      await this.reply(payload.from, `"${item.text}" is already in the dictionary.`);
      return;
    }

    const pending = state.pending.some((p) => p.eventId === payload.eventId)
      ? state.pending
      : [...state.pending, { eventId: payload.eventId, item, appliedBy: payload.from }];
    await this.setState({ pending });
    await this.applyEdit(payload.eventId, dict ?? undefined);
  }

  async applyEdit(eventId: string, known?: DictResponse): Promise<void> {
    const state = await this.getState();
    const edit = state.pending.find((p) => p.eventId === eventId);
    if (!edit) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = known ?? await this.fetchDictionary();
      known = undefined;
      if (!current) { await this.markDegraded(state.clinicId); return; }
      if (current.items.some((i) => i.text.toLowerCase() === edit.item.text.toLowerCase())) {
        await this.finalizeEdit(eventId, current.version, edit);
        return;
      }
      if (current.items.length >= 100) {
        await this.reply(edit.appliedBy, "Dictionary is full (100 items max).");
        return;
      }
      const res = await this.patchDictionary(current.id, current.name, [...current.items, edit.item]);
      if (res.ok) { await this.finalizeEdit(eventId, res.data.version, edit); return; }
      if (res.status === 409) continue;
      await this.reply(edit.appliedBy, `Could not update dictionary: ${res.error}`);
      return;
    }
    await this.reply(edit.appliedBy, "Dictionary update failed after 3 attempts.");
  }

  async canary(): Promise<void> {
    try {
      const state = await this.getState();
      const clinicId = state.clinicId || clinicIdFor(this.env.INTAKE_NUMBER, this.env);
      if (!state.dictId) return;
      const dict = await this.fetchDictionary();
      if (!dict) { await this.markDegraded(clinicId); return; }
      const audio = await this.synthesize(this.env.CANARY_TEXT, dict.id);
      const hash = await sha256Hex(audio);
      const match = state.lastCanaryHash === hash;
      await this.setState({ lastCanaryHash: hash, version: dict.version });
      await this.logDict(
        clinicId, dict.version,
        match ? "__canary_match__" : "__canary_drift__", "system", "system",
      );
      if (confirmVersionFromState(state.lastAppliedVersion, dict.version)) {
        await this.logDict(clinicId, state.lastAppliedVersion, "__canary_state_confirmed__", "system", "system");
      } else {
        await this.logDict(clinicId, dict.version, "__canary_state_mismatch__", "system", "system");
      }
    } finally {
      const state = await this.getState();
      await this.scheduleNextCanary(state.clinicId || clinicIdFor(this.env.INTAKE_NUMBER, this.env));
    }
  }

  async getGreetingAudio(): Promise<Uint8Array<ArrayBuffer>> {
    let state = await this.getState();
    if (!state.clinicId) {
      await this.setState({ clinicId: clinicIdFor(this.env.INTAKE_NUMBER, this.env) });
      state = await this.getState();
    }
    await this.ensureDictionary();
    const s = await this.getState();
    return await this.synthesize(this.env.GREETING_TEXT, s.dictId || "");
  }

  private async ensureDictionary(): Promise<void> {
    const state = await this.getState();
    if (state.dictId) return;
    const name = `Fluency Lab \u2014 ${state.clinicId}`;
    if (!this.demo()) {
      const existing = await this.findDictionaryByName(name);
      if (existing) {
        await this.setState({ dictId: existing.id, version: existing.version, items: existing.items });
        await this.scheduleNextCanary(state.clinicId);
        return;
      }
    }
    const created = await this.createDictionary(name, [DR_NG_ITEM]);
    await this.setState({ dictId: created.id, version: created.version, items: created.items });
    await this.scheduleNextCanary(state.clinicId);
  }

  private async fetchDictionary(): Promise<DictResponse | null> {
    const state = await this.getState();
    if (!state.dictId) return null;
    if (this.demo()) {
      return { id: state.dictId, name: `Fluency Lab \u2014 ${state.clinicId}`, version: state.version, items: state.items };
    }
    return await (await this.api()).getDictionary(state.dictId);
  }

  private async patchDictionary(
    id: string, name: string, items: DictItem[],
  ): Promise<{ ok: true; data: DictResponse } | { ok: false; status: number; error: string }> {
    if (this.demo()) {
      const state = await this.getState();
      if (!state.demoConflictDone) {
        const rivalVersion = state.version + 1;
        await this.setState({ version: rivalVersion, items: applyRivalEdit(state.items), demoConflictDone: true });
        await this.logDict(state.clinicId, rivalVersion, RIVAL_EDITOR_ITEM.text, RIVAL_EDITOR_ITEM.type, RIVAL_EDITOR_BY);
        return { ok: false, status: 409, error: "90200 Dictionary was modified concurrently, please retry" };
      }
      const newVersion = state.version + 1;
      await this.setState({ version: newVersion, items });
      return { ok: true, data: { id, name, version: newVersion, items } };
    }
    return await (await this.api()).patchDictionary(id, name, items);
  }

  private async createDictionary(name: string, items: DictItem[]): Promise<DictResponse> {
    if (this.demo()) return { id: `demo-${name}`, name, version: 1, items };
    return await (await this.api()).createDictionary(name, items);
  }

  private async findDictionaryByName(name: string): Promise<DictResponse | null> {
    return (await (await this.api()).listDictionaries()).find((d) => d.name === name) || null;
  }

  private async synthesize(text: string, dictId: string): Promise<Uint8Array<ArrayBuffer>> {
    if (this.demo()) return silentMp3();
    return await (await this.api()).synthesize(text, this.env.VOICE_ID, dictId);
  }

  private async reply(to: string, text: string): Promise<void> {
    if (this.demo()) { console.log(`[DEMO] SMS -> ${maskPhone(to)}: ${text}`); return; }
    await (await this.api()).sendSms(this.env.INTAKE_NUMBER, to, text);
  }

  private async finalizeEdit(eventId: string, version: number, edit: PendingEdit): Promise<void> {
    const state = await this.getState();
    const pending = state.pending.filter((p) => p.eventId !== eventId);
    await this.setState({ pending, version, lastAppliedVersion: version });
    await this.logDict(state.clinicId, version, edit.item.text, edit.item.type, edit.appliedBy);
    await this.reply(edit.appliedBy, `Added ${edit.item.text} \u2014 dictionary v${version}`);
    await this.resynthesizeGreeting(version);
  }

  private async resynthesizeGreeting(version: number): Promise<void> {
    try {
      const s = await this.getState();
      const audio = await this.synthesize(this.env.GREETING_TEXT, s.dictId || "");
      const hash = await sha256Hex(audio);
      await this.setState({ lastGreetingHash: hash, lastGreetingVersion: version });
      await this.logDict(s.clinicId, version, "__greeting_resynthesized__", "system", "system");
      if (this.demo()) console.log(`[DEMO] greeting re-synthesized with dictionary v${version}`);
    } catch {
      await this.logDict((await this.getState()).clinicId, version, "__greeting_resynthesis_failed__", "system", "system");
    }
  }

  private async markDegraded(clinicId: string): Promise<void> {
    const state = await this.getState();
    await this.setState({ degraded: true });
    await this.logDict(clinicId, state.version, "__dictionary_deleted__", "system", "system");
    await this.reply(this.env.OWNER_NUMBER, `Fluency Lab: dictionary for ${clinicId} is missing (404). Marked degraded.`);
  }

  private async logDict(clinicId: string, version: number, text: string, type: string, by: string): Promise<void> {
    const sql = this.ctx.storage.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS dict_log(clinic_id TEXT, dict_version INT, item_text TEXT, item_type TEXT, applied_at TIMESTAMPTZ, applied_by TEXT)`,
    );
    sql.exec(
      `INSERT INTO dict_log (clinic_id, dict_version, item_text, item_type, applied_at, applied_by) VALUES (?, ?, ?, ?, ?, ?)`,
      clinicId, version, text, type, new Date().toISOString(), by,
    );
  }

  private async scheduleNextCanary(clinicId: string): Promise<void> {
    await this.schedule(
      secondsUntilNext(this.env.VERIFY_AT, this.env.CLINIC_TZ),
      "canary", {}, { id: `verify:${clinicId}` },
    );
  }
}

// ---- Fetch handler ----------------------------------------------------------

interface FluencyStub {
  receive(payload: { text: string; from: string; to: string; eventId: string }): Promise<void>;
  getGreetingAudio(): Promise<Uint8Array>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/webhooks/messaging" && req.method === "POST") return handleMessaging(req, env);
    if (url.pathname === "/greeting-audio" && req.method === "GET") return handleGreeting(req, env);
    return new Response("Not found", { status: 404 });
  },
};

async function handleMessaging(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  const ts = req.headers.get("telnyx-timestamp");
  const sig = req.headers.get("telnyx-signature-ed25519");
  if (!ts || !sig) return new Response("Missing signature", { status: 401 });
  const pubKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
  if (!pubKey) return new Response("Server misconfigured", { status: 500 });
  if (!(await verifyTelnyxSignature(raw, ts, sig, pubKey))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let hook: any;
  try { hook = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  const payload = hook?.data?.payload;
  const from = payload?.from?.phone_number;
  const to = payload?.to?.[0]?.phone_number;
  const text = payload?.text;
  const eventId = hook?.data?.id;
  if (!from || !to || !text || !eventId) return new Response("Bad payload", { status: 400 });

  const stub = env.FLUENCY.idFromName(clinicIdFor(to, env)) as unknown as FluencyStub;
  await stub.receive({ text, from, to, eventId });
  return new Response("OK", { status: 200 });
}

async function handleGreeting(req: Request, env: Env): Promise<Response> {
  const token = await env.SECRETS.get("AUDIO_ACCESS_TOKEN");
  if (token) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${token}`) return new Response("Unauthorized", { status: 401 });
  }
  const stub = env.FLUENCY.idFromName(clinicIdFor(env.INTAKE_NUMBER, env)) as unknown as FluencyStub;
  const audio = await stub.getGreetingAudio();
  return new Response(audio as BodyInit, { headers: { "content-type": "audio/mpeg" } });
}
