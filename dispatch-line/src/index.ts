/**
 * The Dispatch Line — a shift log that writes itself mid-call.
 *
 * One durable actor per shift (`shift-YYYY-MM-DD`) rides Telnyx in-call
 * transcription: every job spoken on the line is filed into the shift_log
 * table and read back over the same leg before the call ends.
 *
 * Assumptions (documented, not hidden):
 * 1. @telnyx/edge-runtime exposes SQL through an env binding
 *    (`[storage.sqldb.SHIFT_DB]`), not agent-local SQL. shift_log lives there.
 * 2. `call.transcription` segments (verified against the current docs):
 *    transcript text is `payload.transcription_data.transcript` (with
 *    `payload.transcript` tolerated); `transcription_data.is_final` gates the
 *    write; there is NO sequence field on the Voice API callback, so `seq` is
 *    a stable FNV-1a hash of the webhook event id — a redelivered webhook
 *    maps to the same seq and the insert is a true no-op (idempotent on seq).
 * 3. `transcription_start` body (verified against the current docs):
 *    `transcription_engine` + `transcription_engine_config` — NOT the legacy
 *    `transcriptions[]` array shown in older examples.
 * 4. Job-bearing final segments append a shift_log row; every final segment
 *    (job or not) is also appended to the actor's durable message history, so
 *    each transcription webhook yields exactly one durable entry, idempotent
 *    on `seq` — the shift_log stays a job log, and the tally counts jobs.
 * 5. A later note that references an open job by keyword is linked to it
 *    (status `linked`); if the note carries a completion cue ("done",
 *    "finished", …) the linked job is closed (status `closed`).
 */
import { Agent, rpc, rpcSurface } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

export interface Env {
  SECRETS: Secrets;
  DISPATCH: ActorNamespace;
  SHIFT_DB: SqlDatabase;
  DEMO_MODE?: string;
}

export interface ShiftState extends Record<string, unknown> {
  shiftId: string;
  openJobs: number;
  closedJobs: number;
  linkedJobs: number;
  lastSeq: number;
  activeCalls: string[];
}

export interface TranscriptionSegment {
  callId: string;
  shiftId: string;
  transcript: string;
  isFinal: boolean;
  seq: number;
}

export interface ParsedJob {
  jobText: string;
  site: string;
}

export interface JobRow {
  shiftId: string;
  seq: number;
  jobText: string;
  site: string;
  status: "open" | "closed" | "linked";
  sourceCallId: string;
}

export interface Tally {
  shiftId: string;
  open: number;
  closed: number;
  linked: number;
  total: number;
}

const JOB_VERB = /\b(swap|replace|install|repair|fix|service|inspect|deliver|adjust|rebuild|order)\b/i;
const SITE_WORD = /\b(north|south|east|west|main|rear|front)\s+(yard|gate|dock|warehouse|lot|depot|bay)\b/i;
const DOOR_WORD = /\bdoor\s+([0-9]{1,3}|[a-z])\b/i;
const REFERENCE_CUE =
  /\b(that|same|earlier|this morning|before|yesterday|the one|done|finished|complete|completed|all set|wrapped|closed)\b/i;
const DONE_CUE = /\b(done|finished|complete|completed|all set|wrapped|closed)\b/i;
const STOPWORDS = new Set([
  "that", "this", "from", "with", "the", "and", "for", "came", "order", "morning",
  "earlier", "before", "yesterday", "same", "about", "have", "been", "just", "said", "one",
]);

/** Ed25519 signatures older than this are rejected as replays (seconds). */
const SIGNATURE_MAX_AGE_SECONDS = 300;

/** Extract a job line ("swap the actuator on north yard door 3") or null. */
export function parseJob(text: string): ParsedJob | null {
  const verb = JOB_VERB.exec(text);
  if (!verb) return null;
  const siteMatch = SITE_WORD.exec(text);
  const doorMatch = DOOR_WORD.exec(text);
  if (!siteMatch && !doorMatch) return null;
  const object = objectAfterVerb(text, verb.index + verb[0].length);
  const site = [siteMatch?.[0], doorMatch?.[0]].filter(Boolean).join(" ").toLowerCase();
  return { jobText: object ? `${object} ${verb[1].toLowerCase()}` : verb[1].toLowerCase(), site };
}

function objectAfterVerb(text: string, from: number): string {
  const tail = text.slice(from);
  const match = /^\s*(?:the|a|an)?\s*([a-z0-9][a-z0-9\s-]{1,40}?)\s*(?=\b(?:on|at|in|for|from)\b|[,.;]|$)/i.exec(tail);
  return (match?.[1] ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** "north yard door 3" + "actuator swap" -> "North yard, door 3, actuator swap — logged." */
export function confirmationLine(job: ParsedJob): string {
  const site = job.site.replace(/\s+door\s+/i, ", door ");
  const spoken = site ? `${site.charAt(0).toUpperCase()}${site.slice(1)}` : "Shift log";
  return `${spoken}, ${job.jobText} — logged.`;
}

export function keywordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));
}

/** Deterministic segment sequence — redelivered webhooks resolve to the same seq. */
export function segmentSeq(payload: Record<string, unknown>, eventId: string): number {
  const data = (payload.transcription_data ?? {}) as Record<string, unknown>;
  const explicit = data.sequence ?? payload.sequence;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return Math.trunc(explicit);
  return fnv1a(eventId || `${payload.call_control_id ?? ""}|${payload.transcript ?? ""}`);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 2147483647;
}

export function shiftIdFor(occurredAt?: string): string {
  const date = occurredAt ? new Date(occurredAt) : new Date();
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return `shift-${iso.slice(0, 10)}`;
}

export function toSegment(payload: Record<string, unknown>, eventId: string, shiftId: string): TranscriptionSegment {
  const data = (payload.transcription_data ?? {}) as Record<string, unknown>;
  return {
    callId: String(payload.call_control_id ?? ""),
    shiftId,
    transcript: String(payload.transcript ?? data.transcript ?? ""),
    isFinal: data.is_final !== false,
    seq: segmentSeq(payload, eventId),
  };
}

function demoMode(env: Env): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

/** Single Telnyx REST surface used by both the fetch handler and the actor. */
async function telnyxPost(env: Env, path: string, body: unknown): Promise<string> {
  if (demoMode(env)) {
    console.log(`[dispatch-line][demo] POST /v2${path} ${JSON.stringify(body)}`);
    return "demo";
  }
  const apiKey = await env.SECRETS.get("TELNYX_API_KEY");
  if (!apiKey) throw new Error("TELNYX_API_KEY is not configured");
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`[dispatch-line] Telnyx ${path} failed ${res.status}: ${detail.slice(0, 200)}`);
    return `error:${res.status}`;
  }
  return "ok";
}

const ED25519_SPKI_PREFIX = new Uint8Array([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

/** Backed by a dedicated ArrayBuffer, so the result is assignable to BufferSource. */
function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Telnyx Ed25519 webhook verification: signature over `${timestamp}|${rawBody}`.
 * When the public key is configured, both the signature and a ±5-minute
 * freshness window on `telnyx-timestamp` are enforced; a stale or unsigned
 * webhook is rejected so a captured one cannot be replayed later.
 */
async function verifySignature(raw: string, headers: Headers, env: Env): Promise<boolean> {
  let publicKey: string | undefined;
  try {
    publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY");
  } catch (error) {
    // Declared but not provisioned (or a secrets backend hiccup): treat
    // exactly like an unset key — demo mode skips verification with a
    // warning, live mode rejects so an unprovisioned deployment can never
    // accept unsigned webhooks.
    if (!demoMode(env)) {
      console.error("[dispatch-line] TELNYX_PUBLIC_KEY secret unavailable — rejecting in live mode");
      return false;
    }
    console.warn("[dispatch-line] TELNYX_PUBLIC_KEY secret unavailable — skipping verification:",
      error instanceof Error ? error.message : "unknown");
  }
  if (!publicKey) {
    if (demoMode(env)) {
      console.warn("[dispatch-line][demo] TELNYX_PUBLIC_KEY unset — skipping signature verification");
      return true;
    }
    return false;
  }
  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    console.warn("[dispatch-line] webhook timestamp outside the replay window — rejecting");
    return false;
  }
  try {
    const rawKey = base64ToBytes(publicKey);
    const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + rawKey.length);
    spki.set(ED25519_SPKI_PREFIX, 0);
    spki.set(rawKey, ED25519_SPKI_PREFIX.length);
    const key = await crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${timestamp}|${raw}`);
    return await crypto.subtle.verify("Ed25519", key, base64ToBytes(signature), signed);
  } catch (error) {
    console.error("[dispatch-line] signature verification error:", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

export class DispatchLine extends Agent<Env, ShiftState> {
  protected override initialState(): ShiftState {
    return { shiftId: "", openJobs: 0, closedJobs: 0, linkedJobs: 0, lastSeq: 0, activeCalls: [] };
  }

  /** Answer the leg, start in-call transcription, birth the day's actor. */
  @rpc({ description: "Answer the leg, start in-call transcription, register the active call." })
  async onCallStart(callId: string, shiftId: string): Promise<{ shiftId: string; transcription: string }> {
    await this.ensureSchema();
    const state = await this.getState();
    const activeCalls = state.activeCalls.includes(callId) ? state.activeCalls : [...state.activeCalls, callId];
    await this.setState({ shiftId, activeCalls });
    const transcription = await telnyxPost(this.env, `/calls/${encodeURIComponent(callId)}/actions/transcription_start`, {
      transcription_engine: "Telnyx",
      transcription_engine_config: {
        transcription_engine: "Telnyx",
        language: "en",
        transcription_model: "openai/whisper-large-v3-turbo",
      },
    });
    return { shiftId, transcription };
  }

  /**
   * call.transcription → one durable entry per segment (idempotent on seq):
   * a job-bearing segment files one shift_log row and speaks the read-back;
   * a reference note links to (and may close) an open job; anything else is
   * recorded in the actor's durable message history only.
   */
  @rpc({ description: "File one shift_log entry per final segment; parse jobs, link references." })
  async onTranscription(segment: TranscriptionSegment): Promise<{ filed: boolean; linked: boolean; closed?: boolean; seq: number }> {
    await this.ensureSchema();
    let state = await this.getState();
    const shiftId = segment.shiftId || state.shiftId;
    if (shiftId !== state.shiftId) {
      await this.setState({ shiftId });
      state = await this.getState();
    }

    const text = segment.transcript.trim();
    if (!text || !segment.isFinal) return { filed: false, linked: false, seq: segment.seq };

    // Durable message history for EVERY final segment — keyed by seq, so a
    // redelivered webhook overwrites in place instead of duplicating.
    await this.ctx.storage.put(`transcript:${segment.seq}`, {
      text,
      callId: segment.callId,
      at: new Date().toISOString(),
    });

    // Reference notes link (and may close) an open job before a new job files.
    const note = await this.onJobReference(text, segment.callId, segment.seq);
    if (note) return { filed: false, linked: true, closed: note.closed === true, seq: segment.seq };

    const job = parseJob(text);
    if (job) {
      const row: JobRow = {
        shiftId, seq: segment.seq, jobText: job.jobText, site: job.site, status: "open", sourceCallId: segment.callId,
      };
      if (!(await this.insertRow(row))) return { filed: false, linked: false, seq: segment.seq };
      await this.setState({ openJobs: state.openJobs + 1, lastSeq: Math.max(state.lastSeq, segment.seq) });
      await this.confirmOverCall(segment.callId, job);
      return { filed: true, linked: false, seq: segment.seq };
    }

    return { filed: false, linked: false, seq: segment.seq };
  }

  /** Speak the confirmation line on the active leg. */
  @rpc({ description: "Read the logged job back over the same leg." })
  async confirmOverCall(callId: string, job: ParsedJob): Promise<{ line: string; status: string }> {
    const line = confirmationLine(job);
    const status = await telnyxPost(this.env, `/calls/${encodeURIComponent(callId)}/actions/speak`, {
      payload: line,
      payload_type: "text",
      voice: "female",
      language: "en-US",
    });
    return { line, status };
  }

  /** call.hangup -> transcription_stop (skipped if the leg is already gone) -> tally. */
  @rpc({ description: "Stop transcription on hangup (skipped if the leg is gone); return the tally." })
  async onCallHangup(callId: string): Promise<{ stopped: string; tally: Tally }> {
    await this.ensureSchema();
    const state = await this.getState();
    const wasActive = state.activeCalls.includes(callId);
    const stopped = wasActive
      ? await telnyxPost(this.env, `/calls/${encodeURIComponent(callId)}/actions/transcription_stop`, {})
      : "skipped";
    if (wasActive) await this.setState({ activeCalls: state.activeCalls.filter((id) => id !== callId) });
    return { stopped, tally: await this.tally() };
  }

  /**
   * Cross-call memory: link a later note to the morning's open job by keyword
   * (matched against the job text and its site). A note with a completion cue
   * ("done", "finished", …) closes the linked job; the note itself is filed as
   * a `linked` row so the link is visible in the tally.
   */
  @rpc({ description: "Link a later note to an open job by keyword; a completion cue closes it." })
  async onJobReference(text: string, callId: string, seq: number): Promise<(JobRow & { closed?: boolean }) | null> {
    if (!REFERENCE_CUE.test(text)) return null;
    await this.ensureSchema();
    const state = await this.getState();
    const open = await this.env.SHIFT_DB.prepare(
      `SELECT seq, job_text, site FROM shift_log WHERE shift_id = ? AND status = 'open'`,
    ).bind(state.shiftId).all();
    const keywords = keywordsOf(text);
    const rows = (open.results ?? []) as Array<{ seq: number; job_text: string; site: string | null }>;
    const match = rows.find((row) =>
      keywords.some(
        (word) =>
          row.job_text.toLowerCase().includes(word) ||
          (row.site ?? "").toLowerCase().includes(word),
      ));
    if (!match) return null;

    const closes = DONE_CUE.test(text);
    const row: JobRow = {
      shiftId: state.shiftId, seq, jobText: text, site: match.site ?? "", status: "linked", sourceCallId: callId,
    };
    // Insert first: a replayed note must not re-close (or re-count) anything.
    if (!(await this.insertRow(row))) return null;
    if (closes) {
      await this.env.SHIFT_DB.prepare(
        `UPDATE shift_log SET status = 'closed' WHERE shift_id = ? AND seq = ?`,
      ).bind(state.shiftId, match.seq).run();
      await this.setState({
        closedJobs: state.closedJobs + 1,
        openJobs: Math.max(0, state.openJobs - 1),
        linkedJobs: state.linkedJobs + 1,
      });
      return { ...row, closed: true };
    }
    await this.setState({ linkedJobs: state.linkedJobs + 1 });
    return row;
  }

  /** Dispatcher surface — counts straight from SQL, not from a transcript archive. */
  @rpc({ description: "Open/closed/linked counts for the shift, straight from SQL." })
  async tally(shiftId?: string): Promise<Tally> {
    await this.ensureSchema();
    const state = await this.getState();
    const id = shiftId ?? state.shiftId;
    const result = await this.env.SHIFT_DB.prepare(
      `SELECT status, COUNT(*) AS count FROM shift_log WHERE shift_id = ? GROUP BY status`,
    ).bind(id).all();
    const counts: Record<string, number> = { open: 0, closed: 0, linked: 0 };
    for (const row of (result.results ?? []) as Array<{ status: string; count: number }>) {
      counts[row.status] = Number(row.count) || 0;
    }
    return {
      shiftId: id,
      open: counts.open,
      closed: counts.closed,
      linked: counts.linked,
      total: counts.open + counts.closed + counts.linked,
    };
  }

  /** Actor counters, read back with the SQL tally — proof the durable state is intact. */
  @rpc({ description: "Durable actor state (counters, active calls) — resume proof surface." })
  async shiftState(): Promise<ShiftState> {
    return this.getState();
  }

  private async ensureSchema(): Promise<void> {
    await this.env.SHIFT_DB.exec(
      `CREATE TABLE IF NOT EXISTS shift_log (
        shift_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        job_text TEXT NOT NULL,
        site TEXT,
        status TEXT NOT NULL CHECK (status IN ('open','closed','linked')),
        created_at TIMESTAMPTZ NOT NULL,
        source_call_id TEXT,
        PRIMARY KEY (shift_id, seq)
      )`,
    );
  }

  /** Idempotent on (shift_id, seq): a replayed webhook never duplicates a job row. */
  private async insertRow(row: JobRow): Promise<boolean> {
    const result = await this.env.SHIFT_DB.prepare(
      `INSERT OR IGNORE INTO shift_log (shift_id, seq, job_text, site, status, created_at, source_call_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.shiftId, row.seq, row.jobText, row.site, row.status, new Date().toISOString(), row.sourceCallId).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}

/**
 * The stub the runtime hands back for `idFromName` — its methods ARE the RPC
 * surface. `telnyx-edge types` narrows `env.DISPATCH` to
 * `ActorNamespace<DispatchLine>`; the hand-rolled `Env` here keeps the bare
 * namespace and narrows at the call site.
 */
export type DispatchLineStub = ReturnType<ActorNamespace<DispatchLine>["idFromName"]>;

export function dispatchLine(env: Env, shiftId: string): DispatchLineStub {
  return (env.DISPATCH as ActorNamespace<DispatchLine>).idFromName(shiftId);
}

/**
 * The actor's callable RPC names, from the runtime's own `rpcSurface()`.
 * `rpcSurface()` inspects a constructed instance — the `@rpc()` decorator's
 * per-instance initializer registers the names at construction — so a
 * throwaway probe actor with a stub context is built when no live instance is
 * in hand. Falls back to the static surface list if the runtime refuses the
 * probe.
 */
export function rpcSurfaceNames(): string[] {
  const staticSurface = [
    "tally",
    "onCallStart",
    "onTranscription",
    "confirmOverCall",
    "onCallHangup",
    "onJobReference",
    "shiftState",
  ];
  try {
    const noopKV = {
      get: async () => undefined,
      put: async () => undefined,
      delete: async () => undefined,
    };
    const probeStorage = {
      list: async () => [],
      ...noopKV,
      deleteAll: async () => undefined,
      transaction: async (fn: (t: unknown) => unknown) => fn(noopKV),
      transactionSync: (fn: (t: unknown) => unknown) => fn(noopKV),
      setAlarm: async () => undefined,
      getAlarm: async () => undefined,
      deleteAlarm: async () => undefined,
      sync: async () => undefined,
      flush: async () => undefined,
    };
    const probeCtx = { storage: probeStorage, blockConcurrencyWhile: async (fn: () => unknown) => fn() };
    const probeEnv: Env = {
      SECRETS: { get: async () => "" },
      DISPATCH: undefined as never,
      SHIFT_DB: undefined as never,
      DEMO_MODE: "true",
    };
    const names = [...rpcSurface(new DispatchLine(probeCtx as never, probeEnv)).keys()];
    return names.length > 0 ? names : staticSurface;
  } catch (error) {
    console.warn("[dispatch-line] rpcSurface probe failed:", error instanceof Error ? error.message : "unknown");
    return staticSurface;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface TelnyxEvent {
  data?: { id?: string; event_type?: string; occurred_at?: string; payload?: Record<string, unknown> };
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifySignature(raw, request.headers, env))) return json({ error: "invalid_signature" }, 401);

  let event: TelnyxEvent;
  try {
    event = JSON.parse(raw) as TelnyxEvent;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const payload = event.data?.payload ?? {};
  const callId = typeof payload.call_control_id === "string" ? payload.call_control_id : "";
  if (!callId) return json({ error: "missing_call_control_id" }, 400);

  const shiftId = shiftIdFor(event.data?.occurred_at);
  const line = dispatchLine(env, shiftId);
  const type = event.data?.event_type ?? "";

  if (type === "call.initiated") {
    // Inbound legs need the `answer` command; outbound legs are answered by
    // the callee (Telnyx fires `call.answered` for those).
    const answer =
      payload.direction === "outgoing" ? "skipped" : await telnyxPost(env, `/calls/${encodeURIComponent(callId)}/actions/answer`, {});
    return json({ ok: true, answer, ...(await line.onCallStart(callId, shiftId)) });
  }
  if (type === "call.answered") {
    // Outbound legs reach the actor here; also re-arms transcription for
    // inbound legs whose first transcription_start raced the answer.
    return json({ ok: true, ...(await line.onCallStart(callId, shiftId)) });
  }
  if (type === "call.transcription") {
    const segment = toSegment(payload, event.data?.id ?? "", shiftId);
    return json({ ok: true, shiftId, ...(await line.onTranscription(segment)) });
  }
  if (type === "call.hangup") {
    return json({ ok: true, shiftId, ...(await line.onCallHangup(callId)) });
  }
  return json({ ok: true, shiftId, ignored: type });
}

async function handleTally(url: URL, env: Env): Promise<Response> {
  const shiftId = url.searchParams.get("shift") ?? shiftIdFor();
  if (!/^shift-\d{4}-\d{2}-\d{2}$/.test(shiftId)) return json({ error: "invalid_shift_id" }, 400);
  const line = dispatchLine(env, shiftId);
  const tally = await line.tally(shiftId);
  const surface = rpcSurfaceNames();
  console.log(`[dispatch-line] stub.tally(${shiftId}) via env.DISPATCH.idFromName ->`, tally);
  console.log(`[dispatch-line] rpcSurface ->`, surface);
  return json({ ok: true, shiftId, tally, rpcSurface: surface });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/webhooks/telnyx") return await handleWebhook(request, env);
      if (request.method === "GET" && url.pathname === "/tally") return await handleTally(url, env);
      return json({ error: "not_found" }, 404);
    } catch (error) {
      console.error("[dispatch-line] request failed:", error instanceof Error ? error.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  },
};
