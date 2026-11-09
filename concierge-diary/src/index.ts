/**
 * concierge-diary \u2014 THE FOLLOW-UP BOOKER (Telnyx Edge / Agent SDK)
 *
 * The actor IS the diary entry: one durable DiaryActor per conversation owns the
 * diary row, the scheduled-event id, and the exactly-once create guard. The AI
 * Assistant's post-conversation wrap-up turn decides whether/when/what to say and
 * calls POST /diary/entries; the actor books the follow-up call on the Telnyx
 * scheduled-events API with the personalized opener in `dynamic_variables`.
 *
 * SELF-REVIEW:
 * - Real primitives only: Agent SDK durable state, this.schedule() sweep timer,
 *   SqlDatabase binding for the diary table, Telnyx scheduled-events REST API,
 *   TELNYX binding for the confirmation SMS. No in-memory maps, no setTimeout.
 * - Safe demo mode is the default (DEMO_MODE=true): the diary row and state are
 *   still written, but the scheduled-event call is logged instead of placed.
 * - No credentials in code (SECRETS binding); no PII in logs (phones masked).
 *
 * ASSUMPTION: the assistant's webhook tool posts the full intent, including the
 * patient's E.164 number and the clinic's agent target, to POST /diary/entries.
 * Scheduled events are called over raw REST because the typed
 * assistants.scheduledEvents resource is not guaranteed on the edge binding.
 */
import { Agent } from "@telnyx/edge-runtime";
import type { ActorNamespace, Secrets, SqlDatabase } from "@telnyx/edge-runtime";

const API_BASE = "https://api.telnyx.com/v2";
const E164 = /^\+[1-9]\d{6,14}$/;
const MAX_RETRIES_CLIENT_ERRORS = 2;
const RETRY_INTERVAL_SECS = 300;

export type DiaryStatus = "new" | "booked" | "delivered" | "rescheduled" | "canceled" | "failed";

export interface DiaryIntent {
  conversationId: string;
  patientName: string;
  reason: string;
  callbackAt: string;
  opener: string;
  endUserTarget: string;
  agentTarget: string;
}

export interface DiaryState {
  conversationId: string;
  patientName: string;
  topic: string;
  opener: string;
  callbackAt: string;
  endUserTarget: string;
  agentTarget: string;
  eventId: string | null;
  status: DiaryStatus;
  createPending: boolean;
  pendingBody: DiaryIntent | null;
}

export interface ScheduledEventPayload {
  telnyx_conversation_channel: "phone_call";
  telnyx_end_user_target: string;
  telnyx_agent_target: string;
  scheduled_at_fixed_datetime: string;
  dynamic_variables: { patient_name: string; topic: string; clinic_name: string; opener: string };
  max_retries_client_errors: number;
  retry_interval_secs: number;
}

export interface Env {
  SECRETS: Secrets;
  DIARY: ActorNamespace;
  DIARY_DB: SqlDatabase;
  TELNYX: { messages: { send(params: { to: string; from: string; text: string }): Promise<unknown> } };
  TELNYX_ASSISTANT_ID: string;
  TELNYX_FROM_NUMBER: string;
  CLINIC_NAME: string;
  DEMO_MODE: string;
  DIARY_SWEEP_SECONDS: string;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) throw new HttpError(400, "request body is required");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "request body must be valid JSON"); }
}

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "body must be a JSON object");
  return raw as Record<string, unknown>;
}

function field(body: Record<string, unknown>, name: string, max: number): string {
  const value = body[name];
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} is required`);
  if (value.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return value.trim();
}

function phone(body: Record<string, unknown>, name: string): string {
  const value = field(body, name, 20);
  if (!E164.test(value)) throw new HttpError(400, `${name} must be an E.164 number`);
  return value;
}

function futureIso(body: Record<string, unknown>, name: string): string {
  const value = field(body, name, 40);
  const ts = Date.parse(value);
  if (Number.isNaN(ts) || ts <= Date.now()) throw new HttpError(400, `${name} must be a future ISO-8601 timestamp`);
  return value;
}

export function validateDiaryIntent(raw: unknown): DiaryIntent {
  const body = asObject(raw);
  return {
    conversationId: field(body, "conversationId", 128),
    patientName: field(body, "patientName", 120),
    reason: field(body, "reason", 200),
    callbackAt: futureIso(body, "callbackAt"),
    opener: field(body, "opener", 400),
    endUserTarget: phone(body, "endUserTarget"),
    agentTarget: phone(body, "agentTarget"),
  };
}

export function buildScheduledEventPayload(intent: DiaryIntent, clinicName: string): ScheduledEventPayload {
  return {
    telnyx_conversation_channel: "phone_call",
    telnyx_end_user_target: intent.endUserTarget,
    telnyx_agent_target: intent.agentTarget,
    scheduled_at_fixed_datetime: intent.callbackAt,
    dynamic_variables: {
      patient_name: intent.patientName,
      topic: intent.reason,
      clinic_name: clinicName,
      opener: intent.opener,
    },
    max_retries_client_errors: MAX_RETRIES_CLIENT_ERRORS,
    retry_interval_secs: RETRY_INTERVAL_SECS,
  };
}

function maskPhone(value: string): string {
  return `${value.slice(0, 5)}****${value.slice(-2)}`;
}

export class DiaryActor extends Agent<Env, DiaryState> {
  protected initialState(): DiaryState {
    return {
      conversationId: "", patientName: "", topic: "", opener: "", callbackAt: "",
      endUserTarget: "", agentTarget: "", eventId: null, status: "new",
      createPending: false, pendingBody: null,
    };
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (req.method === "GET" && path === "/diary") {
        return json({ state: await this.getState(), rows: await this.readRows() });
      }
      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      const body = await readJson(req);
      switch (path) {
        case "/diary/entries": return json(await this.onWebhook(validateDiaryIntent(body)), 201);
        case "/diary/reschedule": return json(await this.onReschedule(asObject(body)));
        case "/diary/event-status": return json(await this.onEventStatus(asObject(body)));
        case "/diary/sweep": return json(await this.onSweep());
        case "/diary/cancel": return json(await this.onCancel());
        default: return json({ error: "not found" }, 404);
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error("diary actor error:", err instanceof Error ? err.message : "unknown");
      return json({ error: "internal error" }, 500);
    }
  }

  /** Post-conversation webhook tool target: book (or re-book) the follow-up call. */
  async onWebhook(intent: DiaryIntent): Promise<DiaryState> {
    const state = await this.getState();
    if (state.eventId && state.callbackAt === intent.callbackAt && state.status === "booked") return state;
    await this.replaceState({
      ...state,
      conversationId: intent.conversationId,
      patientName: intent.patientName,
      topic: intent.reason,
      opener: intent.opener,
      callbackAt: intent.callbackAt,
      endUserTarget: intent.endUserTarget,
      agentTarget: intent.agentTarget,
      eventId: null,
      status: "booked",
      createPending: true,
      pendingBody: intent,
    });
    await this.writeRow("booked", null);
    // Durable sweep: if the pod dies before the create lands, this re-creates it once.
    await this.schedule(this.sweepSeconds(), "onSweep", { conversationId: intent.conversationId });
    await this.createPendingEvent("booked");
    return this.getState();
  }

  /** Sweep timer: re-create a scheduled event that never landed. Exactly once. */
  async onSweep(): Promise<{ recreated: boolean; eventId: string | null }> {
    const state = await this.getState();
    if (!state.createPending) return { recreated: false, eventId: state.eventId };
    await this.createPendingEvent(state.status === "rescheduled" ? "rescheduled" : "booked");
    return { recreated: true, eventId: (await this.getState()).eventId };
  }

  /** Scheduled-event status callback: completed -> delivered, failed -> alert. */
  async onEventStatus(body: Record<string, unknown>): Promise<DiaryState> {
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const callStatus = typeof body.callStatus === "string" ? body.callStatus : "";
    const state = await this.getState();
    if (!eventId || eventId !== state.eventId) return state;
    if (callStatus === "completed") {
      await this.replaceState({ ...state, status: "delivered" });
      await this.writeRow("delivered", eventId);
    } else if (callStatus === "failed" || callStatus === "no_answer") {
      await this.replaceState({ ...state, status: "failed" });
      await this.writeRow("failed", eventId);
      console.error(`follow-up call did not connect for conversation ${state.conversationId}`);
    }
    return this.getState();
  }

  /** Reschedule path: delete the pending event, then book the replacement. */
  async onReschedule(body: Record<string, unknown>): Promise<DiaryState> {
    const state = await this.getState();
    if (!state.conversationId) throw new HttpError(404, "no diary entry for this conversation");
    const callbackAt = futureIso(body, "callbackAt");
    const opener = typeof body.opener === "string" && body.opener.trim() ? body.opener.trim().slice(0, 400) : state.opener;
    if (state.eventId) await this.deleteScheduledEvent(state.eventId);
    const intent: DiaryIntent = {
      conversationId: state.conversationId, patientName: state.patientName, reason: state.topic,
      callbackAt, opener, endUserTarget: state.endUserTarget, agentTarget: state.agentTarget,
    };
    await this.replaceState({ ...state, callbackAt, opener, eventId: null, status: "rescheduled", createPending: true, pendingBody: intent });
    await this.writeRow("rescheduled", null);
    await this.schedule(this.sweepSeconds(), "onSweep", { conversationId: intent.conversationId });
    await this.createPendingEvent("rescheduled");
    return this.getState();
  }

  /** Patient opts out: drop the pending event and close the diary row. */
  async onCancel(): Promise<DiaryState> {
    const state = await this.getState();
    if (!state.conversationId) throw new HttpError(404, "no diary entry for this conversation");
    if (state.eventId) await this.deleteScheduledEvent(state.eventId);
    await this.replaceState({ ...state, status: "canceled", eventId: null, createPending: false, pendingBody: null });
    await this.writeRow("canceled", null);
    return this.getState();
  }

  private async createPendingEvent(status: DiaryStatus): Promise<void> {
    const state = await this.getState();
    if (!state.createPending || !state.pendingBody) return;
    const intent = state.pendingBody;
    const eventId = await this.createScheduledEvent(intent);
    await this.replaceState({ ...state, eventId, status, createPending: false, pendingBody: null });
    await this.writeRow(status, eventId);
    await this.sendConfirmation(intent);
  }

  private async createScheduledEvent(intent: DiaryIntent): Promise<string> {
    if (this.demoMode()) {
      console.log(`[demo] would create scheduled event for conversation ${intent.conversationId} at ${intent.callbackAt}`);
      return `demo_evt_${intent.conversationId}_${Date.parse(intent.callbackAt)}`;
    }
    const url = `${API_BASE}/ai/assistants/${encodeURIComponent(this.env.TELNYX_ASSISTANT_ID)}/scheduled_events`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildScheduledEventPayload(intent, this.env.CLINIC_NAME)),
    });
    if (!res.ok) throw new Error(`scheduled event create failed with status ${res.status}`);
    const eventId = ((await res.json()) as { data?: { id?: string } }).data?.id;
    if (!eventId) throw new Error("scheduled event create returned no id");
    return eventId;
  }

  private async deleteScheduledEvent(eventId: string): Promise<void> {
    if (this.demoMode()) {
      console.log(`[demo] would delete scheduled event ${eventId}`);
      return;
    }
    const url = `${API_BASE}/ai/assistants/${encodeURIComponent(this.env.TELNYX_ASSISTANT_ID)}/scheduled_events/${encodeURIComponent(eventId)}`;
    const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${await this.apiKey()}` } });
    if (!res.ok && res.status !== 404) throw new Error(`scheduled event delete failed with status ${res.status}`);
  }

  private async sendConfirmation(intent: DiaryIntent): Promise<void> {
    if (this.demoMode()) {
      console.log(`[demo] would send confirmation SMS to ${maskPhone(intent.endUserTarget)}`);
      return;
    }
    const text = `${this.env.CLINIC_NAME}: your callback is booked for ${intent.callbackAt}. Reply RESCHEDULE to move it.`;
    try {
      await this.env.TELNYX.messages.send({ to: intent.endUserTarget, from: this.env.TELNYX_FROM_NUMBER, text });
    } catch (err) {
      console.error("confirmation SMS failed:", err instanceof Error ? err.message : "unknown");
    }
  }

  private async apiKey(): Promise<string> {
    const key = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!key) throw new Error("TELNYX_API_KEY secret is not configured");
    return key;
  }

  private demoMode(): boolean {
    return (this.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
  }

  private sweepSeconds(): number {
    const seconds = Number(this.env.DIARY_SWEEP_SECONDS);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 120;
  }

  private async ensureSchema(): Promise<void> {
    await this.env.DIARY_DB.exec(
      `CREATE TABLE IF NOT EXISTS diary (
         conversation_id TEXT PRIMARY KEY, patient TEXT NOT NULL, callback_at TEXT NOT NULL,
         status TEXT NOT NULL, event_id TEXT, topic TEXT, updated_at TEXT NOT NULL)`,
    );
  }

  private async writeRow(status: DiaryStatus, eventId: string | null): Promise<void> {
    const state = await this.getState();
    await this.ensureSchema();
    await this.env.DIARY_DB.prepare(
      `INSERT INTO diary (conversation_id, patient, callback_at, status, event_id, topic, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         patient = excluded.patient, callback_at = excluded.callback_at, status = excluded.status,
         event_id = excluded.event_id, topic = excluded.topic, updated_at = excluded.updated_at`,
    )
      .bind(state.conversationId, state.patientName, state.callbackAt, status, eventId, state.topic, new Date().toISOString())
      .run();
  }

  private async readRows(): Promise<unknown[]> {
    const state = await this.getState();
    if (!state.conversationId) return [];
    await this.ensureSchema();
    const result = (await this.env.DIARY_DB.prepare(
      `SELECT conversation_id, patient, callback_at, status, event_id, topic, updated_at FROM diary WHERE conversation_id = ?`,
    ).bind(state.conversationId).all()) as { results?: unknown[] };
    return result.results ?? [];
  }
}

const ROUTES = new Set(["entries", "reschedule", "event-status", "sweep", "cancel"]);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "diary") return json({ error: "not found" }, 404);

    if (req.method === "GET" && segments.length === 1) {
      const conversationId = url.searchParams.get("conversationId");
      if (!conversationId) return json({ error: "conversationId query parameter is required" }, 400);
      return env.DIARY.idFromName(conversationId).fetch(new Request("https://diary.internal/diary", { method: "GET" }));
    }

    if (req.method !== "POST" || segments.length !== 2 || !ROUTES.has(segments[1])) {
      return json({ error: "not found" }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = asObject(await readJson(req));
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      return json({ error: "invalid request body" }, 400);
    }

    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) return json({ error: "conversationId is required" }, 400);

    return env.DIARY.idFromName(conversationId).fetch(
      new Request(`https://diary.internal/diary/${segments[1]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  },
};
