// SELF-REVIEW:
// \u2705 Real primitives only: Agent (durable state, this.schedule, this.every),
//    agent SQL via the CLINIC_DB SqlDatabase binding, the TELNYX binding for
//    SMS, the Assistant Chat API over REST, Ed25519 webhook verification.
// \u2705 Page-once guard (state.pageSent) is durable \u2014 survives a pod kill.
// \u2705 Safe demo mode default (DEMO_MODE=true): SMS is logged, never sent.
// \u2705 Parameterized SQL everywhere; phone numbers masked in logs and rows.
// ASSUMPTION: env.NURSES.idFromName(handle) returns a callable actor stub and
//   public async methods are auto-RPC-callable (Agent SDK contract).
// ASSUMPTION: the Assistant Chat API is called over REST because a typed
//   ai.assistants.chat surface is not guaranteed on the TELNYX binding.
import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

export type Triage = "self-care" | "appointment" | "page-on-call";

export interface TelnyxBinding {
  messages: { send(input: { to: string; from: string; text: string }): Promise<{ id?: string }> };
}

export interface Env {
  SECRETS: Secrets;
  NURSES: ActorNamespace;
  ROTAS: ActorNamespace;
  CLINIC: ActorNamespace;
  CLINIC_DB: SqlDatabase;
  TELNYX: TelnyxBinding;
  NIGHT_NURSE_ASSISTANT_ID?: string;
  ONCALL_E164?: string;
  DAY_TEAM_E164?: string;
  FROM_E164?: string;
  DEMO_MODE?: string;
}

export interface NurseState extends Record<string, unknown> {
  patientId: string;
  conversationId: string | null;
  symptoms: string[];
  meds: string[];
  allergies: string[];
  redFlag: boolean;
  pageSent: boolean;
  chats: number;
  pages: number;
  selfCare: number;
  lastSeen: string | null;
  lastVerdict: Triage | null;
  ingestedConversationId: string | null;
  ingestedCount: number;
}

export interface RotaState extends Record<string, unknown> { number: string; updatedBy: string; updatedAt: string }
export interface ClinicState extends Record<string, unknown> { armed: boolean; lastHandoff: string | null }
export interface ChatInput { patientId: string; text: string; conversationId?: string | null }
export interface ChatResult {
  patientId: string; content: string; conversationId: string | null;
  triage: Triage; pageSent: boolean; officeHours: boolean; redFlag: boolean;
}
export interface TranscriptMessage { role: "user" | "assistant" | "tool"; text: string }
export interface IngestInput { patientId: string; conversationId: string }
export interface IngestResult {
  patientId: string; conversationId: string; ingested: number;
  triage: Triage; pageSent: boolean;
}
export interface PatientReport {
  patientId: string; day: string; chats: number; pages: number;
  selfCare: number; appointments: number; pageOnCall: number;
}
export interface ClinicReport {
  day: string; chats: number; pages: number;
  selfCare: number; appointments: number; pageOnCall: number;
}

interface NurseStub { chat(input: ChatInput): Promise<ChatResult>; ingestConversation(input: IngestInput): Promise<IngestResult>; report(day: string): Promise<PatientReport> }
interface RotaStub { current(): Promise<string>; setNumber(input: { number: string; updatedBy: string }): Promise<RotaState> }
interface ClinicStub { arm(): Promise<void>; report(day: string): Promise<ClinicReport>; dailyHandoff(): Promise<ClinicReport> }

const PATIENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const E164_RE = /^\+[1-9]\d{7,14}$/;
const TRIAGE_RE = /TRIAGE:\s*(self-care|appointment|page-on-call)\s*$/i;
const FRONT_DESK_REPLY = "The front desk will follow up with you when the clinic opens at 9am PT.";

const DDL = [
  "CREATE TABLE IF NOT EXISTS patient_chart (patient_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (patient_id, field))",
  "CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, day TEXT NOT NULL, verdict TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS pages (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, day TEXT NOT NULL, to_number TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rota (id INTEGER PRIMARY KEY CHECK (id = 1), number TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)",
];

let schemaReady: Promise<void> | null = null;
function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => { for (const stmt of DDL) await env.CLINIC_DB.exec(stmt); })()
      .catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

async function query<T>(db: SqlDatabase, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = (await db.prepare(sql).bind(...params).all()) as unknown;
  if (Array.isArray(res)) return res as T[];
  return (res as { results?: T[] }).results ?? [];
}

async function write(db: SqlDatabase, sql: string, ...params: unknown[]): Promise<void> {
  await db.prepare(sql).bind(...params).run();
}

async function secret(env: Env, name: string): Promise<string | null> {
  try {
    const value = await env.SECRETS.get(name);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

function isDemo(env: Env): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

function maskPhone(value: string): string {
  return value.length <= 4 ? "****" : `${value.slice(0, 2)}******${value.slice(-4)}`;
}

function normalizeE164(input: string): string {
  const digits = input.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

function todayPT(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function isOfficeHours(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return weekday !== "Sat" && weekday !== "Sun" && hour >= 9 && hour < 17;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function splitTriage(content: string): { text: string; triage: Triage } {
  const match = content.match(TRIAGE_RE);
  if (!match) return { text: content.trim(), triage: "appointment" };
  return { text: content.slice(0, match.index).trim(), triage: match[1].toLowerCase() as Triage };
}

interface Facts { symptoms: string[]; meds: string[]; allergies: string[]; redFlag: boolean; pregnancyWeeks: number | null }

const RED_FLAGS: Array<[RegExp, string]> = [
  [/chest\s+(tightness|pain|pressure)/i, "chest tightness"],
  [/short(ness)?\s+of\s+breath|can'?t\s+breathe/i, "shortness of breath"],
  [/bleed(ing)?/i, "bleeding"],
  [/severe\s+headache|blurred\s+vision/i, "neuro warning sign"],
  [/contractions?/i, "contractions"],
];

export function extractFacts(text: string): Facts {
  const symptoms: string[] = [];
  let redFlag = false;
  for (const [pattern, label] of RED_FLAGS) {
    if (pattern.test(text)) { symptoms.push(label); redFlag = true; }
  }
  const meds = [...text.matchAll(/\b(?:i'?m\s+taking|taking|started|prescribed)\s+([a-z][a-z0-9-]{2,}(?:\s+[a-z][a-z0-9-]{2,})?)/gi)]
    .map((m) => m[1].trim().toLowerCase());
  const allergies = [...text.matchAll(/allergic\s+to\s+([a-z][a-z0-9\s-]{2,30})/gi)]
    .map((m) => m[1].trim().toLowerCase());
  const weeks = text.match(/(\d{1,2})\s*weeks?\s+pregnan/i);
  return { symptoms, meds, allergies, redFlag, pregnancyWeeks: weeks ? Number(weeks[1]) : null };
}

async function writeChart(env: Env, patientId: string, facts: Facts): Promise<void> {
  const now = new Date().toISOString();
  const rows: Array<[string, string]> = [];
  for (const s of facts.symptoms) rows.push([`symptom:${s.replace(/\s+/g, "_")}`, s]);
  for (const m of facts.meds) rows.push([`med:${m.replace(/\s+/g, "_")}`, m]);
  for (const a of facts.allergies) rows.push([`allergy:${a.replace(/\s+/g, "_")}`, a]);
  if (facts.redFlag) rows.push(["redflag", "1"]);
  if (facts.pregnancyWeeks !== null) rows.push(["pregnancy_weeks", String(facts.pregnancyWeeks)]);
  for (const [field, value] of rows) {
    await write(env.CLINIC_DB,
      "INSERT INTO patient_chart (patient_id, field, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(patient_id, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      patientId, field, value, now);
  }
}

function buildPageSummary(patientId: string, text: string, facts: Facts): string {
  const bits: string[] = [facts.symptoms.join(", ") || text.slice(0, 80)];
  if (facts.pregnancyWeeks !== null) bits.push(`${facts.pregnancyWeeks}w pregnant`);
  if (facts.meds.length) bits.push(`meds: ${facts.meds.join(", ")}`);
  if (facts.allergies.length) bits.push(`allergies: ${facts.allergies.join(", ")}`);
  return `${patientId}, ${bits.join(", ")}`;
}

async function assistantChat(
  env: Env,
  input: { assistantId: string; content: string; name: string; conversationId: string | null },
): Promise<{ content: string; conversationId: string | null }> {
  const apiKey = await secret(env, "TELNYX_API_KEY");
  if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
  const res = await fetch(`https://api.telnyx.com/v2/ai/assistants/${encodeURIComponent(input.assistantId)}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      content: input.content,
      name: input.name,
      ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`assistant chat failed with status ${res.status}`);
  const body = (await res.json()) as { data?: { content?: string; conversation_id?: string } };
  const data = body.data ?? {};
  return { content: String(data.content ?? ""), conversationId: data.conversation_id ?? input.conversationId };
}

export function triageFromTranscript(messages: TranscriptMessage[]): Triage {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant" || !message.text) continue;
    return splitTriage(message.text).triage;
  }
  return "appointment";
}

async function fetchConversationTail(
  env: Env,
  conversationId: string,
): Promise<{ messages: TranscriptMessage[]; offset: number }> {
  const apiKey = await secret(env, "TELNYX_API_KEY");
  if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
  const base = `https://api.telnyx.com/v2/ai/conversations/${encodeURIComponent(conversationId)}/messages`;
  const first = await fetch(`${base}?page[size]=100`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!first.ok) throw new Error(`conversation readback failed with status ${first.status}`);
  const firstBody = (await first.json()) as {
    data?: TranscriptMessage[];
    meta?: { total_pages?: number; total_results?: number };
  };
  const totalPages = Number(firstBody.meta?.total_pages ?? 1);
  const totalResults = Number(firstBody.meta?.total_results ?? 0);
  let messages = firstBody.data ?? [];
  let offset = 0;
  if (totalPages > 1) {
    const last = await fetch(`${base}?page[size]=100&page[number]=${totalPages}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (last.ok) {
      const lastBody = (await last.json()) as { data?: TranscriptMessage[] };
      if (Array.isArray(lastBody.data)) {
        messages = lastBody.data;
        offset = Math.max(0, totalResults - messages.length);
      }
    }
  }
  return { messages, offset };
}

async function sendSms(env: Env, to: string, text: string): Promise<{ id: string; demo: boolean }> {
  if (!E164_RE.test(to)) throw new Error("destination must be an E.164 number");
  if (isDemo(env)) {
    console.log(`[demo] SMS to ${maskPhone(to)}: ${text.slice(0, 120)}`);
    return { id: `demo-${Date.now()}`, demo: true };
  }
  const from = env.FROM_E164 ?? "";
  if (!E164_RE.test(from)) throw new Error("FROM_E164 must be an E.164 number in live mode");
  const res = await env.TELNYX.messages.send({ to, from, text });
  return { id: String(res?.id ?? ""), demo: false };
}

export class NightNurse extends Agent<Env, NurseState> {
  protected initialState(): NurseState {
    return {
      patientId: "", conversationId: null, symptoms: [], meds: [], allergies: [],
      redFlag: false, pageSent: false, chats: 0, pages: 0, selfCare: 0,
      lastSeen: null, lastVerdict: null, ingestedConversationId: null, ingestedCount: 0,
    };
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    await ensureSchema(this.env);
    const state = await this.getState();
    const patientId = state.patientId || input.patientId;
    if (!PATIENT_ID_RE.test(patientId)) throw new Error("invalid patient handle");
    const assistantId = this.env.NIGHT_NURSE_ASSISTANT_ID ?? "";
    if (!assistantId) throw new Error("NIGHT_NURSE_ASSISTANT_ID is not configured");

    const conversationId = state.conversationId ?? input.conversationId ?? null;
    const reply = await assistantChat(this.env, { assistantId, content: input.text, name: patientId, conversationId });
    const parsed = splitTriage(reply.content);
    const facts = extractFacts(input.text);
    await writeChart(this.env, patientId, facts);

    const officeHours = isOfficeHours();
    const redFlag = parsed.triage === "page-on-call";
    const content = officeHours && !redFlag ? FRONT_DESK_REPLY : parsed.text;

    let pageSent = state.pageSent;
    if (redFlag && !state.pageSent) {
      pageSent = true;
      await this.schedule(0, "pageOnCall", { patientId, summary: buildPageSummary(patientId, input.text, facts) });
    }

    await write(this.env.CLINIC_DB,
      "INSERT INTO sessions (patient_id, day, verdict, created_at) VALUES (?, ?, ?, ?)",
      patientId, todayPT(), parsed.triage, new Date().toISOString());

    await this.setState({
      patientId,
      conversationId: reply.conversationId,
      symptoms: [...state.symptoms, ...facts.symptoms].slice(-20),
      meds: uniq([...state.meds, ...facts.meds]),
      allergies: uniq([...state.allergies, ...facts.allergies]),
      redFlag: state.redFlag || facts.redFlag,
      pageSent,
      chats: state.chats + 1,
      selfCare: state.selfCare + (parsed.triage === "self-care" ? 1 : 0),
      lastSeen: new Date().toISOString(),
      lastVerdict: parsed.triage,
    });

    return { patientId, content, conversationId: reply.conversationId, triage: parsed.triage, pageSent, officeHours, redFlag };
  }

  async ingestConversation(input: IngestInput): Promise<IngestResult> {
    await ensureSchema(this.env);
    const state = await this.getState();
    const patientId = state.patientId || input.patientId;
    if (!PATIENT_ID_RE.test(patientId)) throw new Error("invalid patient handle");

    const { messages, offset } = await fetchConversationTail(this.env, input.conversationId);
    const sameConversation = state.ingestedConversationId === input.conversationId;
    const start = sameConversation ? Math.max(0, state.ingestedCount - offset) : 0;

    let pageSent = state.pageSent;
    let chats = 0;
    let selfCare = state.selfCare;
    let symptoms = state.symptoms;
    let meds = state.meds;
    let allergies = state.allergies;
    let redFlag = state.redFlag;
    let lastVerdict: Triage | null = null;
    let lastUserText = "";

    for (let i = start; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role === "user" && message.text) {
        lastUserText = message.text;
        const facts = extractFacts(message.text);
        await writeChart(this.env, patientId, facts);
        symptoms = [...symptoms, ...facts.symptoms].slice(-20);
        meds = uniq([...meds, ...facts.meds]);
        allergies = uniq([...allergies, ...facts.allergies]);
        redFlag = redFlag || facts.redFlag;
        continue;
      }
      if (message.role === "assistant" && message.text) {
        const parsed = splitTriage(message.text);
        chats += 1;
        lastVerdict = parsed.triage;
        await write(this.env.CLINIC_DB,
          "INSERT INTO sessions (patient_id, day, verdict, created_at) VALUES (?, ?, ?, ?)",
          patientId, todayPT(), parsed.triage, new Date().toISOString());
        if (parsed.triage === "page-on-call" && !pageSent) {
          pageSent = true;
          const userText = lastUserText || message.text.slice(0, 80);
          await this.schedule(0, "pageOnCall", { patientId, summary: buildPageSummary(patientId, userText, extractFacts(userText)) });
        }
        if (parsed.triage === "self-care") {
          selfCare += 1;
        }
      }
    }

    await this.setState({
      patientId,
      conversationId: input.conversationId,
      symptoms, meds, allergies,
      redFlag,
      pageSent,
      chats: state.chats + chats,
      selfCare,
      lastSeen: new Date().toISOString(),
      lastVerdict: lastVerdict ?? state.lastVerdict,
      ingestedConversationId: input.conversationId,
      ingestedCount: offset + messages.length,
    });

    return {
      patientId,
      conversationId: input.conversationId,
      ingested: messages.length - start,
      triage: lastVerdict ?? "appointment",
      pageSent,
    };
  }

  async pageOnCall(payload: { patientId: string; summary: string }): Promise<void> {
    await ensureSchema(this.env);
    const desk = this.env.ROTAS.idFromName("oncall") as unknown as RotaStub;
    const number = await desk.current();
    const sent = await sendSms(this.env, number, `Night Nurse page: ${payload.summary}`);
    await write(this.env.CLINIC_DB,
      "INSERT INTO pages (patient_id, day, to_number, summary, created_at) VALUES (?, ?, ?, ?, ?)",
      payload.patientId, todayPT(), maskPhone(number), payload.summary, new Date().toISOString());
    const state = await this.getState();
    await this.setState({ pages: state.pages + 1 });
    console.log(`on-call page dispatched id=${sent.id} demo=${sent.demo}`);
  }

  async report(day: string): Promise<PatientReport> {
    await ensureSchema(this.env);
    const state = await this.getState();
    const patientId = state.patientId;
    const rows = await query<{ verdict: string; n: number }>(this.env.CLINIC_DB,
      "SELECT verdict, COUNT(*) AS n FROM sessions WHERE patient_id = ? AND day = ? GROUP BY verdict", patientId, day);
    const pageRows = await query<{ n: number }>(this.env.CLINIC_DB,
      "SELECT COUNT(*) AS n FROM pages WHERE patient_id = ? AND day = ?", patientId, day);
    const count = (verdict: Triage) => Number(rows.find((r) => r.verdict === verdict)?.n ?? 0);
    return {
      patientId, day,
      chats: rows.reduce((sum, r) => sum + Number(r.n), 0),
      pages: Number(pageRows[0]?.n ?? 0),
      selfCare: count("self-care"),
      appointments: count("appointment"),
      pageOnCall: count("page-on-call"),
    };
  }
}

export class RotaDesk extends Agent<Env, RotaState> {
  protected initialState(): RotaState {
    return { number: "", updatedBy: "", updatedAt: "" };
  }

  async current(): Promise<string> {
    await ensureSchema(this.env);
    const rows = await query<{ number: string }>(this.env.CLINIC_DB, "SELECT number FROM rota WHERE id = 1");
    if (rows.length) return rows[0].number;
    const seed = this.env.ONCALL_E164 ?? "";
    if (!E164_RE.test(seed)) throw new Error("ONCALL_E164 is not a valid E.164 number");
    await this.setNumber({ number: seed, updatedBy: "env-seed" });
    return seed;
  }

  async setNumber(input: { number: string; updatedBy: string }): Promise<RotaState> {
    await ensureSchema(this.env);
    const number = normalizeE164(input.number);
    if (!E164_RE.test(number)) throw new Error("on-call number must be E.164");
    const updatedAt = new Date().toISOString();
    await write(this.env.CLINIC_DB,
      "INSERT INTO rota (id, number, updated_by, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET number = excluded.number, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      number, input.updatedBy, updatedAt);
    const next: RotaState = { number, updatedBy: input.updatedBy, updatedAt };
    await this.replaceState(next);
    return next;
  }
}

export class ClinicDesk extends Agent<Env, ClinicState> {
  protected initialState(): ClinicState {
    return { armed: false, lastHandoff: null };
  }

  async arm(): Promise<void> {
    const state = await this.getState();
    if (state.armed) return;
    await this.every(86400, "dailyHandoff");
    await this.setState({ armed: true });
  }

  async report(day: string): Promise<ClinicReport> {
    await this.arm();
    await ensureSchema(this.env);
    const rows = await query<{ verdict: string; n: number }>(this.env.CLINIC_DB,
      "SELECT verdict, COUNT(*) AS n FROM sessions WHERE day = ? GROUP BY verdict", day);
    const pageRows = await query<{ n: number }>(this.env.CLINIC_DB,
      "SELECT COUNT(*) AS n FROM pages WHERE day = ?", day);
    const count = (verdict: Triage) => Number(rows.find((r) => r.verdict === verdict)?.n ?? 0);
    return {
      day,
      chats: rows.reduce((sum, r) => sum + Number(r.n), 0),
      pages: Number(pageRows[0]?.n ?? 0),
      selfCare: count("self-care"),
      appointments: count("appointment"),
      pageOnCall: count("page-on-call"),
    };
  }

  async dailyHandoff(): Promise<ClinicReport> {
    const day = todayPT();
    const report = await this.report(day);
    const to = this.env.DAY_TEAM_E164 ?? "";
    if (E164_RE.test(to)) {
      await sendSms(this.env, to,
        `Night Nurse handoff ${day}: ${report.chats} chats, ${report.pages} pages, ${report.selfCare} self-care.`);
    } else {
      console.warn("DAY_TEAM_E164 is not configured \u2014 skipping the daily handoff SMS");
    }
    await this.setState({ lastHandoff: day });
    return report;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifySignature(req: Request, raw: string, env: Env): Promise<boolean> {
  const publicKey = await secret(env, "TELNYX_PUBLIC_KEY");
  if (!publicKey) {
    if (isDemo(env)) {
      console.warn("TELNYX_PUBLIC_KEY not configured \u2014 accepting webhook in demo mode only");
      return true;
    }
    return false;
  }
  const signature = req.headers.get("telnyx-signature-ed25519");
  const timestamp = req.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  try {
    const key = await crypto.subtle.importKey("raw", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify(
      { name: "Ed25519" }, key, base64ToBytes(signature), new TextEncoder().encode(`${timestamp}|${raw}`),
    );
  } catch (err) {
    console.error("webhook signature verification failed:", (err as Error).message);
    return false;
  }
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    { patientId?: string; text?: string; conversationId?: string } | null;
  const patientId = String(body?.patientId ?? "").trim().toLowerCase();
  const text = String(body?.text ?? "").trim();
  if (!PATIENT_ID_RE.test(patientId)) return json({ error: "patientId must match ^[a-z0-9][a-z0-9-]{1,63}$" }, 400);
  if (!text || text.length > 2000) return json({ error: "text is required (max 2000 chars)" }, 400);
  const nurse = env.NURSES.idFromName(patientId) as unknown as NurseStub;
  const result = await nurse.chat({ patientId, text, conversationId: body?.conversationId ?? null });
  return json(result, 200);
}

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

async function handleConversation(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    { patientId?: string; conversationId?: string } | null;
  const patientId = String(body?.patientId ?? "").trim().toLowerCase();
  const conversationId = String(body?.conversationId ?? "").trim();
  if (!PATIENT_ID_RE.test(patientId)) return json({ error: "patientId must match ^[a-z0-9][a-z0-9-]{1,63}$" }, 400);
  if (!CONVERSATION_ID_RE.test(conversationId)) return json({ error: "conversationId must match ^[A-Za-z0-9_-]{1,128}$" }, 400);
  const nurse = env.NURSES.idFromName(patientId) as unknown as NurseStub;
  const result = await nurse.ingestConversation({ patientId, conversationId });
  return json(result, 200);
}

async function handleSms(req: Request, env: Env): Promise<Response> {
  const raw = await req.text();
  if (!(await verifySignature(req, raw, env))) return json({ error: "invalid signature" }, 401);
  let event: { data?: { event_type?: string; payload?: { from?: { phone_number?: string }; text?: string } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (event.data?.event_type !== "message.received") return json({ received: true, ignored: true }, 200);
  const from = String(event.data?.payload?.from?.phone_number ?? "");
  const text = String(event.data?.payload?.text ?? "").trim();
  if (!text) return json({ received: true, ignored: true }, 200);

  const rota = text.match(/^ONCALL\s+(\+?[\d\s().-]{7,20})$/i);
  if (rota) {
    const desk = env.ROTAS.idFromName("oncall") as unknown as RotaStub;
    const state = await desk.setNumber({ number: normalizeE164(rota[1]), updatedBy: maskPhone(from) });
    return json({ received: true, rota: maskPhone(state.number) }, 200);
  }

  // Deterministic split (no backtracking on uncontrolled SMS text — CodeQL ReDoS):
  // "PATIENT <handle> <message…>" where handle is 2-64 chars [a-z0-9-].
  if (/^PATIENT(\s|$)/i.test(text)) {
    const rest = text.replace(/^PATIENT\s+/i, "");
    const sp = rest.indexOf(" ");
    const handle = sp > 0 ? rest.slice(0, sp).toLowerCase() : "";
    if (sp > 0 && /^[a-z0-9][a-z0-9-]{1,63}$/.test(handle) && E164_RE.test(from)) {
      const nurse = env.NURSES.idFromName(handle) as unknown as NurseStub;
      const reply = await nurse.chat({ patientId: handle, text: rest.slice(sp + 1).trim() });
      await sendSms(env, from, reply.content);
      return json({ received: true, replied: true }, 200);
    }
  }
  return json({ received: true, ignored: true }, 200);
}

async function handleReport(url: URL, env: Env): Promise<Response> {
  const day = url.searchParams.get("day") ?? todayPT();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: "day must be YYYY-MM-DD" }, 400);
  const clinic = env.CLINIC.idFromName("clinic") as unknown as ClinicStub;
  return json(await clinic.report(day), 200);
}

const RELAY_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Night Nurse Line</title>
<style>body{font:15px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px}pre{white-space:pre-wrap;border:1px solid #ddd;border-radius:8px;padding:12px;min-height:180px}input{width:78%;padding:6px}</style>
</head><body>
<h1>Night Nurse Line</h1>
<p>Relay path (Path B): the browser posts each turn to <code>/chat</code>; the actor owns the chart.</p>
<pre id="log"></pre>
<form id="f"><input id="t" placeholder="Describe your symptoms" autocomplete="off"><button>Send</button></form>
<script>
const log=document.getElementById('log');
const handle=new URLSearchParams(location.search).get('patient')||'maya-481';
let conversationId=null;
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();
  const input=document.getElementById('t'),text=input.value.trim();
  if(!text)return;
  input.value='';log.textContent+='You: '+text+'\\n';
  const res=await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({patientId:handle,text,conversationId})});
  const data=await res.json();
  if(data.conversationId)conversationId=data.conversationId;
  log.textContent+='Night Nurse: '+(data.content||data.error)+'\\n';
  if(data.triage==='page-on-call')log.textContent+='[on-call paged]\\n';
  log.scrollTop=log.scrollHeight;
});
</script></body></html>`;

function widgetPage(assistantId: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Night Nurse Line \u2014 widget</title></head><body>
<h1>Night Nurse Line</h1>
<p>Path A: the Telnyx web-chat widget (text-only) talks to the assistant directly; the bridge forwards the conversation id to the actor, which reads the transcript back and updates the chart.</p>
<telnyx-ai-agent agent-id="${assistantId}" text-only data-patient-handle="maya-481"></telnyx-ai-agent>
<script type="module" src="https://esm.sh/@telnyx/ai-agent-widget"></script>
<script>
const widget=document.querySelector('telnyx-ai-agent');
const handle=new URLSearchParams(location.search).get('patient')||'maya-481';
let conversationId=null;
const sync=()=>{if(!conversationId)return;fetch('/conversation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({patientId:handle,conversationId})});};
widget.addEventListener('agent.connected',e=>{if(e.detail&&e.detail.conversationId)conversationId=e.detail.conversationId;sync();});
widget.addEventListener('transcript.item',()=>sync());
</script>
</body></html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") return html(RELAY_PAGE);
      if (request.method === "GET" && url.pathname === "/widget") {
        const assistantId = env.NIGHT_NURSE_ASSISTANT_ID ?? "";
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(assistantId)) return json({ error: "NIGHT_NURSE_ASSISTANT_ID is not configured" }, 500);
        return html(widgetPage(assistantId));
      }
      if (request.method === "POST" && url.pathname === "/chat") return await handleChat(request, env);
      if (request.method === "POST" && url.pathname === "/conversation") return await handleConversation(request, env);
      if (request.method === "POST" && url.pathname === "/sms") return await handleSms(request, env);
      if (request.method === "GET" && url.pathname === "/report") return await handleReport(url, env);
      if (request.method === "POST" && url.pathname === "/handoff") {
        const clinic = env.CLINIC.idFromName("clinic") as unknown as ClinicStub;
        return json(await clinic.dailyHandoff(), 200);
      }
      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error("request failed:", (err as Error).message);
      return json({ error: "internal error" }, 500);
    }
  },
};
