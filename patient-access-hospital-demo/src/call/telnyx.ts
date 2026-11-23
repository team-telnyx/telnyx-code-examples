import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { z } from "zod";
import { brandName } from "@/domain/brand";
import { slotSpeakLabel } from "@/domain/slots";
import type { CallEvent, CallEventKind, CallStatus, Slot } from "@/domain/types";
import type { TransferToolConfig } from "@/domain/transfer";
import type { RescheduleToolConfig } from "@/domain/voiceTools";
import type { CallDriver } from "@/call/driver";

// Telnyx live-mode call driver: a real POST to https://api.telnyx.com/v2/calls.

export type AssistantConfig = {
  id: string;
  instructions: string;
  dynamic_variables: Record<string, string>;
  tools: Array<TransferToolConfig | RescheduleToolConfig>;
  greeting: string;
};

export const NO_MEDICAL_ADVICE_HANDOFF_LINE =
  "That's an important question for your care team. I'm not able to give medical advice, but let me connect you with our nurse line right now.";

export type AssistantConfigInput = {
  assistantId: string;
  patientName: string;
  patientDobIso?: string;
  missedAppointmentSummary: string;
  slotOptions: Slot[];
  transferTool: TransferToolConfig;
  rescheduleTool?: RescheduleToolConfig;
  greeting?: string;
};

/** Builds the assistant payload for POST /v2/calls. Pure; exported for tests. */
export function buildAssistantConfig(input: AssistantConfigInput): AssistantConfig {
  const now = new Date();
  const spoken = (slot: Slot): string => `${slotSpeakLabel(slot, now)} with ${slot.clinicianName}`;
  const first = input.slotOptions[0];
  const second = input.slotOptions[1];
  const offerLine =
    first && second
      ? `The first openings are: ${spoken(first)}, or ${spoken(second)}.`
      : first
        ? `The first opening is ${spoken(first)}.`
        : "There are no openings right now.";
  const opening =
    `Hi ${input.patientName}, this is Ava from ${brandName()}. I see you missed your appointment — ${input.missedAppointmentSummary}. ` +
    "I can help you reschedule. Would you like to do that now?";
  const instructions =
    `You are Ava, a patient-access assistant at ${brandName()}, calling ${input.patientName} about a missed appointment. ` +
    `Your first spoken response MUST be exactly: "${opening}" Do not open with "How can I help?", "What can I help you with?", or a generic greeting. ` +
    (input.patientDobIso ? `After the patient agrees to continue, verify their identity by asking them to state their date of birth. The stored date of birth is ${input.patientDobIso}; never reveal it or hint at it. Do not discuss appointment details until the caller's answer matches. ` : "") +
    `After the patient agrees to reschedule, say: "${offerLine}" Offer these two options conversationally in one short sentence — never read the full list, never list more than two, never invent times, never give medical advice. ` +
    `When the patient picks a time (or says anything close to one of the two times), confirm it with the full day, exact time, and clinician name exactly as listed. ` +
    `Only after the patient explicitly confirms, call the reschedule_clinic_appointment tool with patient_name, date_of_birth, new_time, slot_id when available, and call_control_id when available. Do not claim success unless the tool returns success. ` +
    `STRICT RULE: if the patient asks anything medical, respond exactly "${NO_MEDICAL_ADVICE_HANDOFF_LINE}" — then immediately warm-transfer to the staff target using the transfer tool.`;
  return {
    id: input.assistantId,
    instructions,
    dynamic_variables: {
      patient_name: input.patientName,
      patient_dob_iso: input.patientDobIso ?? "",
      missed_appointment_summary: input.missedAppointmentSummary,
      slot_options_json: JSON.stringify(input.slotOptions),
    },
    tools: [input.transferTool, ...(input.rescheduleTool ? [input.rescheduleTool] : [])],
    greeting: input.greeting ?? opening,
  };
}

const callResponseSchema = z.object({ data: z.object({ call_control_id: z.string().min(1), id: z.string().min(1).optional() }) });

export class TelnyxCallDriver implements CallDriver {
  private readonly apiKey: string;
  private readonly connectionId: string;
  private readonly assistantConfig: () => AssistantConfig | Promise<AssistantConfig>;

  constructor(deps: {
    apiKey: string;
    connectionId: string;
    /** Produces the assistant payload at call time (patient/slots may change). */
    assistantConfig: () => AssistantConfig | Promise<AssistantConfig>;
  }) {
    this.apiKey = deps.apiKey;
    this.connectionId = deps.connectionId;
    this.assistantConfig = deps.assistantConfig;
  }

  async start(req: { to: string; from: string }, emit: (e: CallEvent) => void): Promise<{ callId: string }> {
    const assistant = await this.assistantConfig();
    const res = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: this.connectionId, to: req.to, from: req.from, assistant }),
    });
    if (!res.ok) throw new Error(`Telnyx call create failed: HTTP ${res.status}`);
    const parsed = callResponseSchema.parse(await res.json());
    const callId = parsed.data.call_control_id;
    await emit({
      id: `evt-${crypto.randomUUID()}`,
      callId,
      atIso: new Date().toISOString(),
      kind: "call.initiated",
      data: { to: req.to, from: req.from },
    });
    return { callId };
  }

  async cancel(callId: string): Promise<void> {
    const res = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callId)}/actions/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`Telnyx hangup failed: HTTP ${res.status}`);
  }
}

// ---- Webhook envelope mapping + Ed25519 signature verification (live mode) ----

const webhookEnvelopeSchema = z.object({
  data: z.object({
    event_type: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
});

const KIND_MAP: Record<string, CallEvent["kind"]> = {
  "call.initiated": "call.initiated",
  "call.answered": "call.answered",
  "conversation.created": "call.answered",
  "conversation.ended": "call.ended",
  hangup: "call.ended",
  "call.hangup": "call.ended",
};

const STATUS_BY_KIND: Partial<Record<CallEventKind, CallStatus>> = {
  "call.initiated": "dialing",
  "call.answered": "in_progress",
  "call.ended": "ended",
};

const callIdFrom = (payload: Record<string, unknown>): string => {
  for (const key of ["call_control_id", "call_leg_id", "conversation_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
};

const phoneOf = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "phone_number" in value) {
    const phone = (value as { phone_number?: unknown }).phone_number;
    return typeof phone === "string" ? phone : undefined;
  }
  return undefined;
};

/** Map a Telnyx webhook envelope into a CallEvent, or null for unknown types. */
export function mapTelnyxWebhookToCallEvent(rawBody: string): {
  callId: string;
  event: CallEvent;
  status?: CallStatus;
  from?: string;
  to?: string;
} | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const envelope = webhookEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) return null;
  const { event_type: eventType, payload = {} } = envelope.data.data;
  const kind = KIND_MAP[eventType];
  const callId = callIdFrom(payload);
  if (!kind || !callId) return null;
  return {
    callId,
    status: STATUS_BY_KIND[kind],
    from: phoneOf(payload.from),
    to: phoneOf(payload.to),
    event: {
      id: `evt-${crypto.randomUUID()}`,
      callId,
      atIso: new Date().toISOString(),
      kind,
      data: { event_type: eventType },
    },
  };
}

const transcriptUtteranceSchema = z.object({
  role: z.string().optional(),
  text: z.string().optional(),
  content: z.string().optional(),
  segments: z
    .array(z.object({ text: z.string().optional(), content: z.string().optional() }).passthrough())
    .optional(),
});

const utteranceText = (item: {
  text?: string;
  content?: string;
  segments?: Array<{ text?: string; content?: string }>;
}): string =>
  item.text ??
  item.content ??
  (item.segments ?? []).map((seg) => seg.text ?? seg.content ?? "").filter(Boolean).join(" ");

const isPatientRole = (role: string | undefined): boolean =>
  typeof role === "string" && /^(user|customer|patient|human)/i.test(role);

interface TranscriptionDataCarrier {
  transcription_data?: { transcript?: string; is_final?: boolean; transcription_track?: string };
}

const transcriptionDataItem = (payload: unknown): { text: string; speaker: "agent" | "patient" } | null => {
  const carrier = payload as TranscriptionDataCarrier;
  const data = carrier?.transcription_data;
  if (!data || typeof data.transcript !== "string" || data.is_final === false) return null;
  const speaker: "agent" | "patient" = data.transcription_track === "inbound" ? "patient" : "agent";
  return { text: data.transcript, speaker };
};

/**
 * Pulls transcript utterances out of a live transcript webhook envelope
 * (payload shape varies across Telnyx AI call events: a single utterance or
 * a `transcripts` array with role/text-or-content-or-segments). This handles
 * exactly those shapes; anything else returns []. The on-the-wire variants
 * are the reason the helper exists.
 */
export function extractTranscriptEvents(rawBody: string): CallEvent[] {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const envelope = webhookEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) return [];
  const { event_type: eventType, payload = {} } = envelope.data.data;
  if (!eventType.toLowerCase().includes("transcript")) return [];
  const callId = callIdFrom(payload);

  const transcriptionShape = transcriptionDataItem(payload);
  if (transcriptionShape) {
    return [
      {
        id: `evt-${crypto.randomUUID()}`,
        callId,
        atIso: new Date().toISOString(),
        kind: transcriptionShape.speaker === "patient" ? "transcript.patient" : "transcript.agent",
        speaker: transcriptionShape.speaker,
        text: transcriptionShape.text,
        data: { event_type: eventType },
      },
    ];
  }

  const rawItems: unknown[] = Array.isArray(payload.transcripts) ? payload.transcripts : [payload];
  return rawItems.flatMap((item): CallEvent[] => {
    const utterance = transcriptUtteranceSchema.safeParse(item);
    const text = utterance.success ? utteranceText(utterance.data) : "";
    if (!text) return [];
    const speaker: "agent" | "patient" = isPatientRole(utterance.data?.role) ? "patient" : "agent";
    return [
      {
        id: `evt-${crypto.randomUUID()}`,
        callId,
        atIso: new Date().toISOString(),
        kind: speaker === "patient" ? "transcript.patient" : "transcript.agent",
        speaker,
        text,
        data: { event_type: eventType },
      },
    ];
  });
}

/**
 * Ed25519 verification matched exactly to the official Telnyx SDK contract:
 * headers `Telnyx-Timestamp` + `Telnyx-Signature-Ed25519`, signature base64
 * 32-byte key / 64-byte signature, and the signed payload is
 * `${timestamp}|${payload}` (bar separator). TELNYX_PUBLIC_KEY is the base64
 * 32-byte key from /v2/public_key.
 */
export function verifyTelnyxSignature(input: {
  publicKeyBase64: string;
  timestamp: string;
  signatureBase64: string;
  rawBody: string;
}): boolean {
  try {
    if (!/^\d+$/.test(input.timestamp)) return false;
    const t = Number(input.timestamp);
    if (!Number.isSafeInteger(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return false;
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(input.publicKeyBase64, "base64").toString("base64url") },
      format: "jwk",
    });
    const signature = Buffer.from(input.signatureBase64, "base64");
    return cryptoVerify(null, Buffer.from(`${input.timestamp}|${input.rawBody}`, "utf8"), publicKey, signature);
  } catch (error) {
    console.warn(`[telnyx] signature verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
