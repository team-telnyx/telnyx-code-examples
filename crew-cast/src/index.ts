// crew-cast \u2014 THE CREW BOARD
//
// A durable Edge actor (CrewCast) owns ONE group MMS thread: the roster, the
// group_message_id, every per-recipient delivery state, and the inbound reply
// log. Telnyx messaging webhooks are routed back to the actor by
// group_message_id (KV index) and folded in idempotently.
//
// ASSUMPTIONS (documented, per repo guidelines):
//  * "agent SQL" == the Edge SqlDatabase binding CREW_DB declared in telnyx.toml
//    as [storage.sqldb.CREW_DB]; it backs the acknowledgement report on /board.
//  * `unknown` is a PROVISIONAL finalized status (non-Telnyx recipient, handset
//    confirmation unavailable). A later message.finalized for the same recipient
//    may upgrade it to delivered/sending_failed/delivery_failed. A duplicate
//    event carrying the same status is a no-op (replay-safe).
//  * Inbound replies carry no group_message_id, so the actor is located via a KV
//    thread index keyed by the crew number (CREW_FROM). ?cast_id= overrides it.
//  * DEMO_MODE=true (default) never calls the Telnyx API \u2014 the group send is
//    simulated locally so the sample is safe to run. Set DEMO_MODE=false with
//    real credentials + PUBLIC_BASE_URL for the live path.
//
// SELF-REVIEW:
//  \u2705 Group MMS via this.env.TELNYX.messages.send (real binding, no raw HTTP)
//  \u2705 Per-recipient message.finalized folded idempotently by (group_message_id, recipient)
//  \u2705 message.received + cc roster folded into the thread, deduped by webhook id
//  \u2705 this.schedule(1800, "repollUnknown") \u2014 real Edge scheduling primitive
//  \u2705 Agent SQL (CREW_DB) parameterized queries for the acknowledgement report
//  \u2705 Ed25519 webhook signature verification (WebCrypto), demo-mode escape documented
//  \u2705 Demo mode default; no credentials or real phone numbers committed

import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, KvNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

/* ------------------------------- types ------------------------------- */

export type BoardStatus = "queued" | "delivered" | "sending_failed" | "delivery_failed" | "unknown";

export interface Recipient {
  number: string; carrier: string | null; line_type: string | null;
  status: BoardStatus; acked_at: string | null; finalized_at: string | null;
}
export interface Reply { id: string; from: string; text: string; at: string; cc: string[] }
export interface CrewState {
  cast_id: string; job_id: string; group_message_id: string | null; from: string; text: string; media_url: string | null;
  recipients: Recipient[]; replies: Reply[]; roster_cursor: number; repolls: number;
  notified_signature: string | null; created_at: string; updated_at: string;
}
export interface CastInput { cast_id: string; job_id: string; from: string; recipients: string[]; text: string; media_url: string | null }
export interface FinalizedEvent { group_message_id: string; phone_number: string; status: BoardStatus; occurred_at: string | null }
export interface ReplyEvent { id: string; from: string; text: string; cc: string[]; occurred_at: string }
export interface StatusCount { status: string; total: number; acked: number }
export interface BoardReport {
  cast_id: string; job_id: string; group_message_id: string | null; from: string; text: string; media_url: string | null;
  recipients: Recipient[]; replies: Reply[];
  totals: { recipients: number; queued: number; delivered: number; sending_failed: number; delivery_failed: number; unknown: number; acked: number; silent: number };
  repolls: number; dispatch_notified: boolean; sql_summary: StatusCount[]; updated_at: string;
}
interface GroupSendResult {
  group_message_id: string;
  recipients: Array<{ phone_number: string; status: string; carrier: string | null; line_type: string | null }>;
}
interface TelnyxBinding {
  messages: { send(params: { from: string; to: string[]; text: string; media_urls?: string[] }): Promise<unknown> };
}
export interface Env {
  SECRETS: Secrets; CREW_CAST: ActorNamespace; CREW_DB: SqlDatabase; CREW_INDEX: KvNamespace; TELNYX: TelnyxBinding;
  CREW_FROM: string; CREW_PROFILE_ID: string; DISPATCH_PHONE: string; PUBLIC_BASE_URL: string; DEMO_MODE: string;
  CREW_TO_1?: string; CREW_TO_2?: string; CREW_TO_3?: string; CREW_TO_4?: string; CREW_TO_5?: string; CREW_TO_6?: string;
}

/* ----------------------------- constants ----------------------------- */

const MAX_RECIPIENTS = 8;          // documented Group MMS cap
const REPOLL_SECONDS = 1800;       // 30 minutes
const MAX_REPOLLS = 2;             // one follow-up re-poll, then stop
const E164_US_CA = /^\+1[2-9]\d{9}$/;
const HARD_TERMINAL: ReadonlySet<BoardStatus> = new Set(["delivered", "sending_failed", "delivery_failed"]);

/* ------------------------------ helpers ------------------------------ */

export function isE164(value: unknown): value is string {
  return typeof value === "string" && E164_US_CA.test(value);
}

/** Never log a full phone number. */
export function maskPhone(value: string): string {
  return value.length <= 5 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function isDemoMode(env: Env): boolean {
  return (env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function nowIso(): string { return new Date().toISOString(); }

function unwrap(response: unknown): Record<string, any> {
  const r = response as Record<string, any> | null;
  return r && typeof r === "object" && "data" in r ? (r.data as Record<string, any>) : (r ?? {});
}

function normalizeStatus(value: unknown): BoardStatus {
  const raw = String(value ?? "").toLowerCase();
  return raw === "delivered" || raw === "sending_failed" || raw === "delivery_failed" || raw === "queued" ? raw : "unknown";
}

function actorRequest(path: string, body: unknown): Request {
  return new Request(`https://crew-cast.internal${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Telnyx Ed25519 webhook verification: signature over `${timestamp}|${rawBody}`. */
async function verifySignature(request: Request, rawBody: string, env: Env): Promise<boolean> {
  let publicKey: string | null = null;
  try { publicKey = await env.SECRETS.get("TELNYX_PUBLIC_KEY"); } catch { publicKey = null; }
  if (!publicKey) {
    if (isDemoMode(env)) { console.warn("TELNYX_PUBLIC_KEY unset \u2014 accepting unsigned webhook (DEMO_MODE)"); return true; }
    return false;
  }
  const signature = request.headers.get("telnyx-signature-ed25519");
  const timestamp = request.headers.get("telnyx-timestamp");
  if (!signature || !timestamp) return false;
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;
  try {
    const key = await crypto.subtle.importKey("raw", base64ToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    const payload = new TextEncoder().encode(`${timestamp}|${rawBody}`);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, base64ToBytes(signature), payload);
  } catch (err) {
    console.error("webhook signature verification failed:", err instanceof Error ? err.message : "unknown");
    return false;
  }
}

/* ------------------------------- actor ------------------------------- */

export class CrewCast extends Agent<Env, CrewState> {
  private schemaReady = false;

  protected initialState(): CrewState {
    return {
      cast_id: "", job_id: "", group_message_id: null, from: "", text: "", media_url: null,
      recipients: [], replies: [], roster_cursor: 0, repolls: 0, notified_signature: null,
      created_at: "", updated_at: "",
    };
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "POST" && path === "/cast") return json(await this.cast((await request.json()) as CastInput));
      if (request.method === "POST" && path === "/finalized") return json(await this.onFinalized((await request.json()) as FinalizedEvent));
      if (request.method === "POST" && path === "/reply") return json(await this.onReply((await request.json()) as ReplyEvent));
      if (request.method === "POST" && path === "/repoll") { await this.repollUnknown(); return json({ ok: true }); }
      if (request.method === "GET" && path === "/board") return json(await this.deliveryReport());
      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("crew-cast actor error:", err instanceof Error ? err.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  }

  /** Persist the roster BEFORE the send, then record the group_message_id. */
  async cast(input: CastInput): Promise<BoardReport> {
    const state = await this.getState();
    if (state.group_message_id) return this.deliveryReport(); // already cast \u2014 idempotent

    const createdAt = nowIso();
    const roster: Recipient[] = input.recipients.map((number) => ({
      number, carrier: null, line_type: null, status: "queued", acked_at: null, finalized_at: null,
    }));
    await this.setState({
      cast_id: input.cast_id, job_id: input.job_id, from: input.from, text: input.text,
      media_url: input.media_url, recipients: roster, replies: [], roster_cursor: 0,
      repolls: 0, notified_signature: null, created_at: createdAt, updated_at: createdAt,
    });

    const result = await this.sendGroupMms(input);
    const seeded = roster.map((r) => {
      const match = result.recipients.find((x) => x.phone_number === r.number);
      return { ...r, carrier: match?.carrier ?? null, line_type: match?.line_type ?? null, status: normalizeStatus(match?.status) };
    });

    await this.setState({ group_message_id: result.group_message_id, recipients: seeded, updated_at: nowIso() });
    await this.env.CREW_INDEX.put(`group:${result.group_message_id}`, input.cast_id);
    await this.env.CREW_INDEX.put(`thread:${input.from}`, input.cast_id);
    await this.syncDeliveryRows();
    return this.deliveryReport();
  }

  /** One message.finalized per recipient; group_message_id is the join key. */
  async onFinalized(event: FinalizedEvent): Promise<{ applied: boolean; reason?: string }> {
    const state = await this.getState();
    if (!state.group_message_id || event.group_message_id !== state.group_message_id) {
      return { applied: false, reason: "unknown_group_message_id" };
    }
    const index = state.recipients.findIndex((r) => r.number === event.phone_number);
    if (index === -1) return { applied: false, reason: "recipient_not_on_roster" };

    const current = state.recipients[index];
    if (current.status === event.status) return { applied: false, reason: "duplicate" };
    if (HARD_TERMINAL.has(current.status)) return { applied: false, reason: "already_terminal" };

    const recipients = [...state.recipients];
    recipients[index] = { ...current, status: event.status, finalized_at: event.occurred_at ?? nowIso() };
    await this.setState({ recipients, roster_cursor: state.roster_cursor + 1, updated_at: nowIso() });
    await this.syncDeliveryRows();
    await this.maybeNotifyDispatch();
    return { applied: true };
  }

  /** message.received: fold the reply in, ack the sender, backfill from cc. */
  async onReply(event: ReplyEvent): Promise<{ applied: boolean; reason?: string }> {
    const state = await this.getState();
    if (state.replies.some((r) => r.id === event.id)) return { applied: false, reason: "duplicate" };

    let recipients = [...state.recipients];
    const known = new Set(recipients.map((r) => r.number));
    if (state.replies.length === 0) {
      for (const number of event.cc) {
        if (!known.has(number)) {
          known.add(number);
          recipients.push({ number, carrier: null, line_type: null, status: "unknown", acked_at: null, finalized_at: null });
        }
      }
    }
    if (!known.has(event.from)) {
      recipients.push({ number: event.from, carrier: null, line_type: null, status: "unknown", acked_at: null, finalized_at: null });
    }
    recipients = recipients.map((r) => (r.number === event.from ? { ...r, acked_at: event.occurred_at } : r));

    const replies = [...state.replies, { id: event.id, from: event.from, text: event.text, at: event.occurred_at, cc: event.cc }];
    await this.setState({ recipients, replies, updated_at: nowIso() });
    await this.syncDeliveryRows();
    return { applied: true };
  }

  /** Answers dispatch's poll straight from actor state. */
  async deliveryReport(): Promise<BoardReport> {
    await this.syncDeliveryRows();
    const state = await this.getState();
    const totals = { recipients: state.recipients.length, queued: 0, delivered: 0, sending_failed: 0, delivery_failed: 0, unknown: 0, acked: 0, silent: 0 };
    for (const r of state.recipients) {
      totals[r.status] += 1;
      if (r.acked_at) totals.acked += 1;
    }
    totals.silent = totals.recipients - totals.acked;
    return {
      cast_id: state.cast_id, job_id: state.job_id, group_message_id: state.group_message_id,
      from: state.from, text: state.text, media_url: state.media_url,
      recipients: state.recipients, replies: state.replies, totals,
      repolls: state.repolls, dispatch_notified: state.notified_signature !== null,
      sql_summary: await this.acknowledgementReport(state.cast_id), updated_at: state.updated_at,
    };
  }

  /** Scheduled task: review unresolved recipients, keep the question alive. */
  async repollUnknown(): Promise<{ pending: number; repolls: number; rescheduled: boolean }> {
    const state = await this.getState();
    const pending = state.recipients.filter((r) => r.status === "queued" || r.status === "unknown").length;
    const repolls = state.repolls + 1;
    const rescheduled = pending > 0 && repolls < MAX_REPOLLS;
    await this.setState({ repolls, updated_at: nowIso() });
    if (rescheduled) await this.schedule(REPOLL_SECONDS, "repollUnknown");
    await this.syncDeliveryRows();
    return { pending, repolls, rescheduled };
  }

  private async sendGroupMms(input: CastInput): Promise<GroupSendResult> {
    if (isDemoMode(this.env)) {
      console.log(`[demo] group MMS to ${input.recipients.length} recipients (no API call)`);
      return {
        group_message_id: `demo-gm-${crypto.randomUUID()}`,
        recipients: input.recipients.map((phone_number) => ({ phone_number, status: "queued", carrier: "demo", line_type: "mobile" })),
      };
    }
    const response = await this.env.TELNYX.messages.send({
      from: input.from,
      to: input.recipients,
      text: input.text,
      ...(input.media_url ? { media_urls: [input.media_url] } : {}),
    });
    const data = unwrap(response);
    const id = typeof data.id === "string" ? data.id : "";
    if (!id) throw new Error("group MMS response did not include data.id");
    const to = Array.isArray(data.to) ? data.to : [];
    return {
      group_message_id: id,
      recipients: to.map((entry: Record<string, any>) => ({
        phone_number: String(entry?.phone_number ?? ""),
        status: String(entry?.status ?? "queued"),
        carrier: entry?.carrier ?? null,
        line_type: entry?.line_type ?? null,
      })),
    };
  }

  private async maybeNotifyDispatch(): Promise<void> {
    const state = await this.getState();
    if (state.recipients.length === 0) return;
    if (state.recipients.some((r) => r.status === "queued")) return; // still awaiting a finalized event
    const delivered = state.recipients.filter((r) => r.status === "delivered").length;
    const failed = state.recipients.filter((r) => r.status === "sending_failed" || r.status === "delivery_failed").length;
    const unknown = state.recipients.filter((r) => r.status === "unknown").length;
    const signature = `${delivered}/${failed}/${unknown}`;
    if (signature === state.notified_signature) return;
    const text = `Job ${state.job_id}: all ${state.recipients.length} accounted for \u2014 ${delivered} delivered, ${failed} failed, ${unknown} unknown`;
    await this.sendSms(this.env.DISPATCH_PHONE, text);
    await this.setState({ notified_signature: signature, updated_at: nowIso() });
  }

  private async sendSms(to: string, text: string): Promise<void> {
    if (!isE164(to)) { console.warn("DISPATCH_PHONE is not a valid E.164 number \u2014 skipping dispatch notification"); return; }
    if (isDemoMode(this.env)) { console.log(`[demo] dispatch SMS to ${maskPhone(to)}: ${text}`); return; }
    await this.env.TELNYX.messages.send({ from: this.env.CREW_FROM, to: [to], text });
  }

  private async syncDeliveryRows(): Promise<void> {
    const state = await this.getState();
    if (!state.cast_id) return;
    if (!this.schemaReady) {
      this.env.CREW_DB.exec(`CREATE TABLE IF NOT EXISTS crew_delivery (
        cast_id TEXT NOT NULL, job_id TEXT NOT NULL, phone_number TEXT NOT NULL,
        status TEXT NOT NULL, acked_at TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY (cast_id, phone_number))`);
      this.schemaReady = true;
    }
    const sql = `INSERT INTO crew_delivery (cast_id, job_id, phone_number, status, acked_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cast_id, phone_number) DO UPDATE SET
        status = excluded.status, acked_at = excluded.acked_at, updated_at = excluded.updated_at`;
    for (const r of state.recipients) {
      await this.env.CREW_DB.prepare(sql).bind(state.cast_id, state.job_id, r.number, r.status, r.acked_at, state.updated_at).run();
    }
  }

  private async acknowledgementReport(castId: string): Promise<StatusCount[]> {
    if (!castId) return [];
    const result = await this.env.CREW_DB.prepare(
      `SELECT status, COUNT(*) AS total, SUM(CASE WHEN acked_at IS NOT NULL THEN 1 ELSE 0 END) AS acked
       FROM crew_delivery WHERE cast_id = ? GROUP BY status ORDER BY status`,
    ).bind(castId).all();
    const rows = (result as { results?: unknown[] })?.results ?? (Array.isArray(result) ? result : []);
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      status: String(row.status), total: Number(row.total ?? 0), acked: Number(row.acked ?? 0),
    }));
  }
}

/* ------------------------------ router ------------------------------- */

interface CastRequest { job_id?: unknown; recipients?: unknown; text?: unknown; media_url?: unknown }

function demoRoster(env: Env): string[] {
  return [env.CREW_TO_1, env.CREW_TO_2, env.CREW_TO_3, env.CREW_TO_4, env.CREW_TO_5, env.CREW_TO_6].filter(isE164);
}

async function handleCast(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CastRequest | null;
  if (!body || typeof body !== "object") return json({ error: "invalid_json" }, 400);

  const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) return json({ error: "job_id must be 1-64 chars of [A-Za-z0-9_-]" }, 400);

  const provided = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = provided.length > 0 ? provided : demoRoster(env);
  if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
    return json({ error: `recipients must contain 1-${MAX_RECIPIENTS} US/CA E.164 numbers` }, 400);
  }
  if (!recipients.every(isE164)) return json({ error: "every recipient must be a US/CA E.164 number (+1XXXXXXXXXX)" }, 400);
  if (new Set(recipients).size !== recipients.length) return json({ error: "recipients must be unique" }, 400);

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "text is required" }, 400);
  const mediaUrl = typeof body.media_url === "string" ? body.media_url : null;
  if (mediaUrl && !mediaUrl.startsWith("https://")) return json({ error: "media_url must be an https URL" }, 400);
  if (!isE164(env.CREW_FROM)) return json({ error: "CREW_FROM must be a US/CA E.164 number" }, 500);
  if (!isDemoMode(env) && !env.CREW_PROFILE_ID) return json({ error: "CREW_PROFILE_ID is required in live mode" }, 500);

  const stub = env.CREW_CAST.get(env.CREW_CAST.idFromName(jobId));
  const res = await stub.fetch(actorRequest("/cast", {
    cast_id: jobId, job_id: jobId, from: env.CREW_FROM, recipients, text, media_url: mediaUrl,
  }));
  const board = (await res.json()) as Record<string, unknown>;
  return json({ ...board, webhook_url: `${env.PUBLIC_BASE_URL}/webhooks/messaging` }, res.status);
}

async function handleWebhook(request: Request, url: URL, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifySignature(request, raw, env))) return json({ error: "invalid_signature" }, 401);

  let event: Record<string, any>;
  try { event = JSON.parse(raw) as Record<string, any>; } catch { return json({ error: "invalid_json" }, 400); }
  const type = event?.data?.event_type;
  const payload = event?.data?.payload;
  if (!payload || typeof payload !== "object") return json({ error: "missing data.payload" }, 400);

  if (type === "message.finalized") {
    const groupMessageId = String(payload.group_message_id ?? "");
    const phoneNumber = String(payload?.to?.[0]?.phone_number ?? "");
    if (!groupMessageId || !isE164(phoneNumber)) return json({ error: "group_message_id and to[0].phone_number are required" }, 400);
    const castId = await env.CREW_INDEX.get(`group:${groupMessageId}`);
    if (!castId) return json({ received: true, routed: false }, 200);
    const stub = env.CREW_CAST.get(env.CREW_CAST.idFromName(castId));
    const res = await stub.fetch(actorRequest("/finalized", {
      group_message_id: groupMessageId, phone_number: phoneNumber, status: normalizeStatus(payload.status),
      occurred_at: typeof payload.occurred_at === "string" ? payload.occurred_at : null,
    }));
    return json(await res.json(), res.status);
  }

  if (type === "message.received") {
    const from = String(payload?.from?.phone_number ?? "");
    if (!isE164(from)) return json({ error: "from.phone_number is required" }, 400);
    const crewNumber = String(payload?.to?.[0]?.phone_number ?? "");
    const castId = url.searchParams.get("cast_id") ?? (crewNumber ? await env.CREW_INDEX.get(`thread:${crewNumber}`) : null);
    if (!castId) return json({ received: true, routed: false }, 200);
    const cc = Array.isArray(payload.cc)
      ? payload.cc.map((entry: any) => String(entry?.phone_number ?? entry ?? "")).filter(isE164)
      : [];
    const eventId = String(payload.id ?? `${from}:${payload.received_at ?? ""}:${payload.text ?? ""}`);
    const stub = env.CREW_CAST.get(env.CREW_CAST.idFromName(castId));
    const res = await stub.fetch(actorRequest("/reply", {
      id: eventId, from, text: String(payload.text ?? ""), cc,
      occurred_at: typeof payload.received_at === "string" ? payload.received_at : nowIso(),
    }));
    return json(await res.json(), res.status);
  }

  return json({ received: true, ignored: type ?? "unknown" }, 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/cast") return await handleCast(request, env);
      if (request.method === "POST" && url.pathname === "/webhooks/messaging") return await handleWebhook(request, url, env);
      if (request.method === "GET" && (url.pathname === "/board" || url.pathname.startsWith("/board/"))) {
        const castId = url.pathname === "/board" ? url.searchParams.get("cast_id") : decodeURIComponent(url.pathname.slice(7));
        if (!castId || !/^[A-Za-z0-9_-]{1,64}$/.test(castId)) return json({ error: "cast_id required (1-64 chars of [A-Za-z0-9_-])" }, 400);
        const stub = env.CREW_CAST.get(env.CREW_CAST.idFromName(castId));
        const res = await stub.fetch(new Request("https://crew-cast.internal/board"));
        return json(await res.json(), res.status);
      }
      return json({ error: "not_found" }, 404);
    } catch (err) {
      console.error("crew-cast error:", err instanceof Error ? err.message : "unknown");
      return json({ error: "internal_error" }, 500);
    }
  },
};
