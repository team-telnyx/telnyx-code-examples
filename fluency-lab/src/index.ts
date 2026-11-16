// SELF-REVIEW:
// \u2705 FluencyLab actor born via env.FLUENCY.idFromName(clinicId) on first staff text
// \u2705 Dictionary created with an IPA phoneme (Dr. Ng) and PATCHed with alias items
// \u2705 409 conflict retry: re-fetch + re-apply, max 3 attempts (server-side lock)
// \u2705 Greeting re-synthesized with pronunciation_dict_id (POST /v2/text-to-speech/speech)
// \u2705 dict_log table with the exact AC schema, one row per applied item
// \u2705 Nightly canary via this.schedule() with stable id verify:<clinicId>, re-arms itself
// \u2705 Resume proof: state persists; canary re-fires on wake and logs the dict version
// \u2705 Demo mode default (DEMO_MODE=true) \u2014 no live API calls, no real SMS
// \u2705 Ed25519 webhook signature verification (300s skew) on POST /webhooks/messaging
// ASSUMPTION: the PATCH body includes `version` so the server can reject stale
//   writes with 409 (code 90200). The spec says locking is server-side; we send
//   the version we read so the retry loop is meaningful. If the live API ignores
//   `version`, the retry loop still works (it just won't see a 409).
// ASSUMPTION: in DEMO_MODE the concurrent-editor race is simulated with a
//   one-shot version bump so the 409 \u2192 re-fetch \u2192 re-apply path is exercised
//   without a live key. The final dictionary still contains both items once.

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
  degraded: boolean;
  lastAppliedVersion: number;
  demoConflictDone: boolean;
}

interface DictResponse { id: string; name: string; version: number; items: DictItem[]; }

// ---- Helpers ----------------------------------------------------------------

export function clinicIdFor(to: string, env: Env): string {
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

function silentMp3(frames = 10): Uint8Array<ArrayBuffer> {
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

function secondsUntilNext(verifyAt: string, tz: string): number {
  const [hh, mm] = (verifyAt || "02:00").split(":").map(Number);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
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
    id: string, name: string, items: DictItem[], version: number,
  ): Promise<{ ok: true; data: DictResponse } | { ok: false; status: number; error: string }> {
    const res = await this.req("PATCH", `/v2/pronunciation_dicts/${encodeURIComponent(id)}`, { name, items, version });
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

const DR_NG_ITEM: DictItem = { text: "Dr. Ng", type: "phoneme", phoneme: "d\u0279.\u025b\u014b", alphabet: "ipa" };

export class FluencyLab extends Agent<Env, DictState> {
  protected initialState(): DictState {
    return {
      clinicId: "", dictId: null, version: 0, items: [], pending: [],
      lastCanaryHash: null, degraded: false, lastAppliedVersion: 0, demoConflictDone: false,
    };
  }

  private demo(): boolean { return isDemo(this.env); }

  private async api(): Promise<TelnyxApi> {
    return new TelnyxApi((await this.env.SECRETS.get("TELNYX_API_KEY")) || "");
  }

  async receive(payload: { text: string; from: string; to: string; eventId: string }): Promise<void> {
    const clinicId = clinicIdFor(payload.to, this.env);
    let state = await this.getState();
    if (!state.clinicId) { await this.setState({ clinicId }); state = await this.getState(); }
    await this.ensureDictionary();
    state = await this.getState();

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
    await this.applyEdit(payload.eventId);
  }

  async applyEdit(eventId: string): Promise<void> {
    const state = await this.getState();
    const edit = state.pending.find((p) => p.eventId === eventId);
    if (!edit) return;

    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.fetchDictionary();
      if (!current) { await this.markDegraded(state.clinicId); return; }
      if (current.items.some((i) => i.text.toLowerCase() === edit.item.text.toLowerCase())) {
        await this.finalizeEdit(eventId, current.version, edit);
        return;
      }
      if (current.items.length >= 100) {
        await this.reply(edit.appliedBy, "Dictionary is full (100 items max).");
        return;
      }
      const res = await this.patchDictionary(
        current.id, current.name, [...current.items, edit.item], current.version, edit,
      );
      if (res.ok) { await this.finalizeEdit(eventId, res.data.version, edit); return; }
      if (res.status === 409) continue;
      await this.reply(edit.appliedBy, `Could not update dictionary: ${res.error}`);
      return;
    }
    await this.reply(edit.appliedBy, "Dictionary update failed after 3 attempts.");
  }

  async canary(): Promise<void> {
    const state = await this.getState();
    if (!state.dictId) { await this.scheduleNextCanary(state.clinicId); return; }
    const dict = await this.fetchDictionary();
    if (!dict) {
      await this.markDegraded(state.clinicId);
      await this.scheduleNextCanary(state.clinicId);
      return;
    }
    const audio = await this.synthesize(this.env.CANARY_TEXT, dict.id);
    const hash = await sha256Hex(audio);
    const match = state.lastCanaryHash === hash;
    await this.setState({ lastCanaryHash: hash, version: dict.version });
    await this.logDict(
      state.clinicId, dict.version,
      match ? "__canary_match__" : "__canary_drift__", "system", "system",
    );
    await this.scheduleNextCanary(state.clinicId);
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
    id: string, name: string, items: DictItem[], version: number, _edit: PendingEdit,
  ): Promise<{ ok: true; data: DictResponse } | { ok: false; status: number; error: string }> {
    if (this.demo()) {
      const state = await this.getState();
      if (state.pending.length > 1 && !state.demoConflictDone) {
        await this.setState({ version: state.version + 1, demoConflictDone: true });
        return { ok: false, status: 409, error: "conflict (simulated concurrent editor)" };
      }
      if (version !== state.version) return { ok: false, status: 409, error: "conflict" };
      const newVersion = state.version + 1;
      await this.setState({ version: newVersion, items });
      return { ok: true, data: { id, name, version: newVersion, items } };
    }
    return await (await this.api()).patchDictionary(id, name, items, version);
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
    if (url.pathname === "/greeting-audio" && req.method === "GET") return handleGreeting(env);
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

async function handleGreeting(env: Env): Promise<Response> {
  const stub = env.FLUENCY.idFromName(clinicIdFor(env.INTAKE_NUMBER, env)) as unknown as FluencyStub;
  const audio = await stub.getGreetingAudio();
  return new Response(audio as BodyInit, { headers: { "content-type": "audio/mpeg" } });
}
