import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

export type ReminderOutcome = "confirmed" | "reschedule-requested" | "cancelled" | "no-answer";
export type ReminderStatus = "queued" | "calling" | "confirmed" | "reschedule-requested" | "cancelled" | "no-answer" | "exhausted";

export interface Appointment {
  patientId: string;
  patientFirstName: string;
  patientLastName: string;
  patientPhone: string;
  appointmentKind: string;
  appointmentTime: string;
  providerName: string;
  address: string;
}

export interface PronunciationItem {
  text: string;
  type: "phoneme" | "alias";
  phoneme?: string;
  alias?: string;
  alphabet?: "ipa";
}

export interface ReminderRecord extends Appointment {
  status: ReminderStatus;
  attempts: number;
  lastCallAt: string | null;
  callControlId: string | null;
  nextRetryAt: string | null;
  outcomeDetail: string | null;
}

export interface ReminderState extends Record<string, unknown> {
  clinicId: string;
  cursor: number;
  dictionaryId: string | null;
  generation: number;
  records: ReminderRecord[];
  pronunciationLog: Array<{ patientId: string; dictionaryId: string; items: PronunciationItem[] }>;
  events: Array<{ ts: string; type: string; detail: Record<string, unknown> }>;
}

export interface Env {
  REMINDERS?: ReminderNamespace;
  TELNYX_API_KEY?: string;
  OUTBOUND_TEXML_APP_ID?: string;
  OUTBOUND_CALLER_ID?: string;
  CLINIC_TIMEZONE?: string;
  RETRY_MAX?: string;
  RETRY_BACKOFF_BASE_MS?: string;
  MAX_CALL_MINUTES?: string;
}

type ReminderStub = ActorStub &
  Pick<ReminderQueue, "enqueue" | "recordOutcome" | "repeatAddress" | "retryNoAnswer" | "snapshot">;

interface ReminderNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): ReminderStub;
}

const DEFAULT_RETRY_MAX = 3;
const DEFAULT_RETRY_BACKOFF_BASE_MS = 60_000;
const DEFAULT_MAX_CALL_SECONDS = 300;
const VOICE = "Telnyx.Ultra.Clara";

export function actorNameForClinic(clinicId: string): string {
  const safe = clinicId.trim().toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "");
  if (!safe) throw new Error("clinicId is required");
  return `reminder-queue-${safe}`;
}

export function samplePronunciationItems(): PronunciationItem[] {
  return [
    { text: "Nguyen", type: "phoneme", phoneme: "ɪnˈwɛn", alphabet: "ipa" },
    { text: "OCR", type: "alias", alias: "O C R" },
  ];
}

export function buildPronunciationDictionaryPayload(clinicId: string, items = samplePronunciationItems()): Record<string, unknown> {
  return {
    name: `${clinicId}-pronunciation`,
    items,
  };
}

export function buildAssistantPayload(clinicId: string, dictionaryId: string, webhookUrl: string): Record<string, unknown> {
  return {
    name: `reminder assistant ${clinicId}`,
    instructions: [
      "voice: voice ultra katie",
      "you are a clinic reminder assistant.",
      "use the patient's first name, appointment kind, provider name, appointment time, and address from dynamic variables.",
      "speak the warm reminder first, then listen for confirm, reschedule, cancel, or no answer.",
      "after the call, send the structured outcome to the record_outcome webhook.",
    ].join("\n"),
    voice_settings: {
      voice: VOICE,
      expressive_mode: true,
      pronunciation_dict_id: dictionaryId,
    },
    telephony_settings: {
      voicemail_detection: "premium",
    },
    post_conversation_settings: {
      enabled: true,
    },
    enabled_features: ["telephony"],
    dynamic_variables: {
      pronunciation_dict_id: dictionaryId,
    },
    tools: [
      {
        type: "webhook",
        name: "record_outcome",
        url: webhookUrl,
      },
    ],
  };
}

export function reminderScript(appt: Appointment, tone: "warm" | "concerned" = "warm"): string {
  const prefix = tone === "warm" ? "<emotion value='warm' />" : "<emotion value='concerned' />";
  return `${prefix}hi ${appt.patientFirstName}, this is a reminder for your ${appt.appointmentKind} with dr. ${appt.providerName} tomorrow at ${appt.appointmentTime}.`;
}

export function buildDialPayload(env: Env, appt: Appointment, assistantId: string, dictionaryId: string): Record<string, unknown> {
  return {
    texml_app_id: env.OUTBOUND_TEXML_APP_ID ?? "replace-with-texml-app-id",
    From: env.OUTBOUND_CALLER_ID ?? "+15551234567",
    To: appt.patientPhone,
    AIAssistantId: assistantId,
    MaxCallDuration: Number(env.MAX_CALL_MINUTES ?? DEFAULT_MAX_CALL_SECONDS),
    dynamic_variables: {
      patient_first_name: appt.patientFirstName,
      appointment_kind: appt.appointmentKind,
      provider_name: appt.providerName,
      appointment_time: appt.appointmentTime,
      address: appt.address,
      pronunciation_dict_id: dictionaryId,
    },
  };
}

export function buildSpeakPayload(appt: Appointment, dictionaryId: string): Record<string, unknown> {
  return {
    payload: `<emotion value='warm' />the clinic address is ${appt.address}. ${appt.patientLastName} is pronounced using this call's pronunciation dictionary.`,
    voice: VOICE,
    pronunciation_dict_id: dictionaryId,
  };
}

export class ReminderQueueModel {
  state: ReminderState;

  constructor(private readonly env: Env = {}, initial?: Partial<ReminderState>) {
    this.state = {
      clinicId: "",
      cursor: 0,
      dictionaryId: null,
      generation: 0,
      records: [],
      pronunciationLog: [],
      events: [],
      ...initial,
    };
  }

  enqueue(clinicId: string, appointments: Appointment[]): Record<string, unknown> {
    const dictionaryPayload = buildPronunciationDictionaryPayload(clinicId);
    const dictionaryId = this.state.dictionaryId ?? `dict_${clinicId}`;
    this.state = {
      ...this.state,
      clinicId,
      dictionaryId,
      generation: this.state.generation + 1,
      records: appointments.map((appt) => ({
        ...appt,
        status: "queued",
        attempts: 0,
        lastCallAt: null,
        callControlId: null,
        nextRetryAt: null,
        outcomeDetail: null,
      })),
      pronunciationLog: appointments.map((appt) => ({
        patientId: appt.patientId,
        dictionaryId,
        items: dictionaryPayload.items as PronunciationItem[],
      })),
    };
    this.append("queue.enqueued", { clinicId, count: appointments.length, dictionaryId });
    return {
      actorName: actorNameForClinic(clinicId),
      dictionaryPayload,
      assistantPayload: buildAssistantPayload(clinicId, dictionaryId, "https://example.com/reminders/outcome"),
      next: this.nextDial(),
    };
  }

  nextDial(now = new Date().toISOString()): Record<string, unknown> | null {
    const record = this.state.records[this.state.cursor];
    if (!record || this.isTerminal(record.status)) return null;
    record.status = "calling";
    record.attempts += 1;
    record.lastCallAt = now;
    record.callControlId = `call_${record.patientId}_${record.attempts}`;
    this.append("call.started", { patientId: record.patientId, attempts: record.attempts });
    return {
      patientId: record.patientId,
      script: reminderScript(record),
      alternateScript: reminderScript(record, "concerned"),
      dialPayload: buildDialPayload(this.env, record, `reminder-assistant-${this.state.clinicId}`, this.requireDictionary()),
    };
  }

  recordOutcome(patientId: string, outcome: ReminderOutcome, detail = "", now = new Date()): ReminderRecord {
    const record = this.find(patientId);
    record.status = outcome;
    record.outcomeDetail = detail;
    record.nextRetryAt = null;
    this.append("outcome.recorded", { patientId, outcome });
    if (outcome === "no-answer") {
      this.scheduleRetry(record, now);
    } else {
      this.advanceCursorPastTerminal();
    }
    return record;
  }

  repeatAddress(patientId: string): Record<string, unknown> {
    const record = this.find(patientId);
    const payload = buildSpeakPayload(record, this.requireDictionary());
    this.append("call.speak", { patientId, pronunciation_dict_id: this.requireDictionary() });
    return payload;
  }

  retryDue(now = new Date()): Record<string, unknown> | null {
    const record = this.state.records.find((item) => item.status === "no-answer" && item.nextRetryAt && Date.parse(item.nextRetryAt) <= now.getTime());
    if (!record || record.attempts >= retryMax(this.env)) {
      if (record) record.status = "exhausted";
      this.advanceCursorPastTerminal();
      return this.nextDial(now.toISOString());
    }
    this.state.cursor = this.state.records.findIndex((item) => item.patientId === record.patientId);
    return this.nextDial(now.toISOString());
  }

  snapshot(): Record<string, unknown> {
    return {
      clinicId: this.state.clinicId,
      cursor: this.state.cursor,
      dictionaryId: this.state.dictionaryId,
      generation: this.state.generation,
      records: this.state.records,
      pronunciationLog: this.state.pronunciationLog,
      events: this.state.events.slice(-12),
    };
  }

  private scheduleRetry(record: ReminderRecord, now: Date): void {
    if (record.attempts >= retryMax(this.env)) {
      record.status = "exhausted";
      this.advanceCursorPastTerminal();
      return;
    }
    const delay = retryDelayMs(this.env, record.attempts);
    record.nextRetryAt = new Date(now.getTime() + delay).toISOString();
    this.append("retry.scheduled", { patientId: record.patientId, attempts: record.attempts, nextRetryAt: record.nextRetryAt });
  }

  private advanceCursorPastTerminal(): void {
    while (this.state.cursor < this.state.records.length && this.isTerminal(this.state.records[this.state.cursor].status)) {
      this.state.cursor += 1;
    }
  }

  private isTerminal(status: ReminderStatus): boolean {
    return status === "confirmed" || status === "reschedule-requested" || status === "cancelled" || status === "exhausted";
  }

  private find(patientId: string): ReminderRecord {
    const record = this.state.records.find((item) => item.patientId === patientId);
    if (!record) throw new Error(`unknown patient ${patientId}`);
    return record;
  }

  private requireDictionary(): string {
    if (!this.state.dictionaryId) throw new Error("enqueue must run before dialing");
    return this.state.dictionaryId;
  }

  private append(type: string, detail: Record<string, unknown>): void {
    this.state.events.push({ ts: new Date().toISOString(), type, detail });
  }
}

export class ReminderQueue extends Agent<Env, ReminderState> {
  protected override initialState(): ReminderState {
    return new ReminderQueueModel().state;
  }

  @rpc({ description: "enqueue a clinic day of synthetic appointments" })
  async enqueue(clinicId: string, appointments: Appointment[]): Promise<Record<string, unknown>> {
    const model = new ReminderQueueModel(this.env, await this.getState());
    const result = model.enqueue(clinicId, appointments);
    await this.setState(model.state);
    await this.schedule(0, "retryNoAnswer", { generation: model.state.generation }, { id: `queue-${model.state.generation}` });
    return result;
  }

  @rpc({ description: "record the post-conversation outcome for a reminder call" })
  async recordOutcome(patientId: string, outcome: ReminderOutcome, detail = ""): Promise<ReminderRecord> {
    const model = new ReminderQueueModel(this.env, await this.getState());
    const record = model.recordOutcome(patientId, outcome, detail);
    await this.setState(model.state);
    if (record.nextRetryAt) {
      const delaySeconds = Math.max(0, Math.ceil((Date.parse(record.nextRetryAt) - Date.now()) / 1000));
      await this.schedule(delaySeconds, "retryNoAnswer", { generation: model.state.generation }, { id: `retry-${patientId}-${record.attempts}` });
    }
    return record;
  }

  @rpc({ description: "play the clinic address in-call using the active pronunciation dictionary" })
  async repeatAddress(patientId: string): Promise<Record<string, unknown>> {
    const model = new ReminderQueueModel(this.env, await this.getState());
    const payload = model.repeatAddress(patientId);
    await this.setState(model.state);
    return payload;
  }

  async retryNoAnswer(data: { generation: number }): Promise<Record<string, unknown> | null> {
    const model = new ReminderQueueModel(this.env, await this.getState());
    if (data.generation !== model.state.generation) return null;
    const next = model.retryDue();
    await this.setState(model.state);
    return next;
  }

  @rpc({ description: "return the durable reminder queue view" })
  async snapshot(): Promise<Record<string, unknown>> {
    return new ReminderQueueModel(this.env, await this.getState()).snapshot();
  }
}

function retryMax(env: Env): number {
  const parsed = Number(env.RETRY_MAX ?? DEFAULT_RETRY_MAX);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_MAX;
}

function retryDelayMs(env: Env, attempt: number): number {
  const base = Number(env.RETRY_BACKOFF_BASE_MS ?? DEFAULT_RETRY_BACKOFF_BASE_MS);
  const jitter = 137 * attempt;
  return Math.max(1, base * 2 ** Math.max(0, attempt - 1) + jitter);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, sample: "expressive-voice-reminder" });
    if (url.pathname === "/demo" && request.method === "POST") {
      if (!env.REMINDERS) return Response.json({ error: "REMINDERS binding is not configured" }, { status: 503 });
      const body = (await request.json().catch(() => ({}))) as { clinicId?: string; appointments?: Appointment[] };
      const clinicId = body.clinicId ?? "clinic-42";
      const stub = env.REMINDERS.idFromName(actorNameForClinic(clinicId));
      return Response.json(await stub.enqueue(clinicId, body.appointments ?? demoAppointments()));
    }
    return Response.json({ error: "not found" }, { status: 404 });
  },
};

export function demoAppointments(): Appointment[] {
  return [
    {
      patientId: "p-nguyen",
      patientFirstName: "linh",
      patientLastName: "Nguyen",
      patientPhone: "+15558675309",
      appointmentKind: "follow-up visit",
      appointmentTime: "9:30 am",
      providerName: "patel",
      address: "212 oak street, suite 400",
    },
    {
      patientId: "p-ocr",
      patientFirstName: "marco",
      patientLastName: "diaz",
      patientPhone: "+15555550199",
      appointmentKind: "OCR review",
      appointmentTime: "2:15 pm",
      providerName: "singh",
      address: "212 oak street, suite 400",
    },
  ];
}
