import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { messageEvents, type MessageEvent } from "@/db/schema";
import { classifyIncident } from "@/lib/classify";
import { parseSmsCommand } from "@/lib/commands";
import {
  createIncidentLinkedToMessage,
  findIncidentByNumber,
  optInPhone,
  safeJsonString,
} from "@/lib/incidents";
import {
  handleStop,
  sendAndRecordSms,
  sendHelp,
  sendOptInConfirmation,
} from "@/lib/messaging";
import { getAllowedReporterNumbers } from "@/lib/config";
import { deriveDeliveryStatus, describeDeliveryError } from "@/lib/delivery";
import { normalizeE164 } from "@/lib/phone";
import {
  incidentConfirmationText,
  reportRejectedText,
  statusNotFoundText,
  statusQueryText,
} from "@/lib/sms-copy";

/**
 * Ingestion pipeline for Telnyx messaging webhooks.
 *
 * `planIngestion` performs only the fast, side-effect-safe part synchronously
 * (signature checks are the caller's job): parse the envelope and record the
 * inbound/outbound MessageEvent row, deduplicated by idempotency key. Slow
 * work — LLM classification, incident creation, and any outbound SMS — is
 * returned as a `background` closure the caller runs after acknowledging the
 * webhook (e.g. inside `after()` on Vercel).
 */

const telnyxInboundPayloadSchema = z.object({
  id: z.string().min(1),
  from: z
    .object({ phone_number: z.string() })
    .passthrough(),
  to: z.array(z.object({ phone_number: z.string() }).passthrough()).min(1),
  text: z.string().default(""),
  received_at: z.string().optional(),
});

const telnyxEnvelopeSchema = z.object({
  data: z
    .object({
      id: z.string().optional(),
      event_type: z.string().min(1),
      payload: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
});

export type TelnyxEnvelope = z.infer<typeof telnyxEnvelopeSchema>;

export class UnknownMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownMessageError";
  }
}

export function parseWebhookEnvelope(rawBody: string): TelnyxEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new UnknownMessageError("Webhook body is not valid JSON");
  }
  const envelope = telnyxEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new UnknownMessageError("Webhook body is not a Telnyx event envelope");
  }
  return envelope.data;
}

/** Stable idempotency key for any Telnyx webhook delivery. */
export function idempotencyKeyFor(envelope: TelnyxEnvelope, rawBody: string): string {
  if (envelope.data.id) return `evt:${envelope.data.id}`;
  const payloadId = (envelope.data.payload as { id?: string }).id;
  if (payloadId) return `evt-payload:${payloadId}:${envelope.data.event_type}`;
  return `evt-hash:${sha256(rawBody)}`;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 48);
}

export interface WebhookOutcome {
  handled: "duplicate" | "inbound" | "delivery" | "ignored";
  detail: string;
  incidentNumber?: string;
}

export interface IngestionPlan {
  response: WebhookOutcome;
  /** Slow work to run after the webhook has been acknowledged. */
  background: (() => Promise<WebhookOutcome>) | null;
}

interface InboundMessageFields {
  telnyxMessageId: string;
  fromPhone: string;
  body: string;
}

export function extractInboundFields(envelope: TelnyxEnvelope): InboundMessageFields {
  const payload = telnyxInboundPayloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) {
    throw new UnknownMessageError("message.received payload is missing required fields");
  }
  return {
    telnyxMessageId: payload.data.id,
    fromPhone: payload.data.from.phone_number,
    body: payload.data.text,
  };
}

export async function planIngestion(
  envelope: TelnyxEnvelope,
  rawBody: string,
): Promise<IngestionPlan> {
  const key = idempotencyKeyFor(envelope, rawBody);

  if (envelope.data.event_type === "message.received") {
    return planInboundMessage(envelope, key);
  }

  if (envelope.data.event_type === "message.sent" || envelope.data.event_type === "message.finalized") {
    return planDeliveryUpdate(envelope, key);
  }

  return {
    response: {
      handled: "ignored",
      detail: `Unsupported event ${envelope.data.event_type}`,
    },
    background: null,
  };
}

async function planInboundMessage(
  envelope: TelnyxEnvelope,
  idempotencyKey: string,
): Promise<IngestionPlan> {
  const fields = extractInboundFields(envelope);
  const fromPhone = normalizeE164(fields.fromPhone);
  if (!fromPhone) {
    return {
      response: { handled: "ignored", detail: "Unparseable from number" },
      background: null,
    };
  }

  const command = parseSmsCommand(fields.body);
  const inserted = await recordInboundEvent(envelope, {
    telnyxMessageId: fields.telnyxMessageId,
    idempotencyKey,
    fromPhone,
  });

  if (!inserted.messageEvent) {
    return {
      response: { handled: "duplicate", detail: "Duplicate webhook delivery" },
      background: null,
    };
  }

  switch (command.type) {
    case "stop":
      return {
        response: { handled: "inbound", detail: "Opt-out received" },
        background: () => runStop(fromPhone),
      };
    case "start":
      return {
        response: { handled: "inbound", detail: "Opt-in received" },
        background: () => runStart(fromPhone),
      };
    case "help":
      return {
        response: { handled: "inbound", detail: "Help received" },
        background: () => runHelp(fromPhone),
      };
    case "status":
      return {
        response: { handled: "inbound", detail: "Status query received" },
        background: () => runStatusQuery(fromPhone, command.incidentNumber),
      };
    default:
      break;
  }

  if (fields.body.trim() === "") {
    return {
      response: { handled: "ignored", detail: "Empty message" },
      background: () =>
        runRejection(fromPhone, "we received an empty message. Send a description of what you're seeing.", "outbound.rejected_empty"),
    };
  }

  const allowlist = getAllowedReporterNumbers();
  if (allowlist && !allowlist.includes(fromPhone)) {
    return {
      response: { handled: "ignored", detail: "Reporter not in allowlist" },
      background: () =>
        runRejection(
          fromPhone,
          "this demo only accepts incident reports from an allowlisted number.",
          "outbound.rejected_allowlist",
        ),
    };
  }

  return {
    response: { handled: "inbound", detail: "Report accepted for classification" },
    background: () => classifyAndCreateIncident(inserted.messageEvent!, fields.body.trim()),
  };
}

async function recordInboundEvent(
  envelope: TelnyxEnvelope,
  fields: {
    telnyxMessageId: string;
    idempotencyKey: string;
    fromPhone: string;
  },
): Promise<{ messageEvent: MessageEvent | null }> {
  const inserted = await db
    .insert(messageEvents)
    .values({
      telnyxMessageId: fields.telnyxMessageId,
      idempotencyKey: fields.idempotencyKey,
      incidentId: null,
      direction: "inbound",
      eventType: envelope.data.event_type,
      phone: fields.fromPhone,
      body: envelope.data.payload["text"] as string | undefined ?? "",
      deliveryStatus: "received",
      raw: safeJsonString(envelope),
    })
    .onConflictDoNothing({ target: messageEvents.idempotencyKey })
    .returning();
  return { messageEvent: inserted[0] ?? null };
}

async function runStop(phone: string): Promise<WebhookOutcome> {
  await handleStop(phone);
  return { handled: "inbound", detail: "Opted out" };
}

async function runStart(phone: string): Promise<WebhookOutcome> {
  await optInPhone(phone);
  await sendOptInConfirmation(phone);
  return { handled: "inbound", detail: "Opt-in restored" };
}

async function runHelp(phone: string): Promise<WebhookOutcome> {
  await sendHelp(phone);
  return { handled: "inbound", detail: "Help sent" };
}

async function runStatusQuery(
  phone: string,
  incidentNumber: string,
): Promise<WebhookOutcome> {
  if (!incidentNumber) {
    await sendAndRecordSms({
      to: phone,
      body: statusNotFoundText("STATUS <incident number>"),
      eventType: "outbound.status_unknown",
      incidentId: null,
    });
    return { handled: "inbound", detail: "Status query missing number" };
  }
  const incident = await findIncidentByNumber(incidentNumber);
  if (!incident) {
    await sendAndRecordSms({
      to: phone,
      body: statusNotFoundText(incidentNumber),
      eventType: "outbound.status_unknown",
      incidentId: null,
    });
    return { handled: "inbound", detail: "Status query: not found" };
  }
  await sendAndRecordSms({
    to: phone,
    body: statusQueryText(incident.number, incident.status),
    eventType: "outbound.status",
    incidentId: incident.id,
  });
  return {
    handled: "inbound",
    detail: `Status query: ${incident.status}`,
    incidentNumber: incident.number,
  };
}

async function runRejection(
  phone: string,
  reason: string,
  eventType: string,
): Promise<WebhookOutcome> {
  await sendAndRecordSms({
    to: phone,
    body: reportRejectedText(reason),
    eventType,
    incidentId: null,
  });
  return { handled: "ignored", detail: "Report rejected" };
}

/**
 * Classifies the stored inbound report, creates the incident (transaction),
 * and sends the confirmation SMS. Runs after the webhook is acknowledged.
 */
export async function classifyAndCreateIncident(
  messageEvent: MessageEvent,
  reportBody: string,
): Promise<WebhookOutcome> {
  let classification;
  try {
    ({ classification } = await classifyIncident(
      reportBody,
      messageEvent.phone,
    ));
  } catch (error) {
    await db
      .update(messageEvents)
      .set({
        errorDetails: `classification_failed: ${(error as Error).message.slice(0, 200)}`,
        updatedAt: new Date(),
      })
      .where(eq(messageEvents.id, messageEvent.id));
    return { handled: "ignored", detail: "Classification failed" };
  }

  const { incident } = await createIncidentLinkedToMessage(messageEvent.id, {
    title: classification.title,
    summary: classification.summary,
    severity: classification.severity,
    affectedService: classification.affectedService,
    affectedRegion: classification.affectedRegion,
    symptoms: classification.symptoms,
    suggestedNextAction: classification.suggestedNextAction,
    confidence: classification.confidence,
    reporterPhone: messageEvent.phone,
    sourceMessageId: messageEvent.telnyxMessageId ?? "unknown",
  });

  await sendAndRecordSms({
    to: messageEvent.phone,
    body: incidentConfirmationText({
      incidentNumber: incident.number,
      title: classification.title,
      severity: classification.severity,
    }),
    eventType: "outbound.confirmation",
    incidentId: incident.id,
  });

  return {
    handled: "inbound",
    detail: "Incident created",
    incidentNumber: incident.number,
  };
}

async function planDeliveryUpdate(
  envelope: TelnyxEnvelope,
  idempotencyKey: string,
): Promise<IngestionPlan> {
  const payload = envelope.data.payload as {
    id?: string;
    to?: Array<{ phone_number?: string }>;
    from?: { phone_number?: string };
    text?: string;
    errors?: Array<{ code?: string; description?: string }>;
  };

  const telnyxMessageId = payload.id ?? null;
  const destination = payload.to?.[0]?.phone_number ?? payload.from?.phone_number ?? "";
  const normalizedTo = destination ? normalizeE164(destination) : null;

  const inserted = await db
    .insert(messageEvents)
    .values({
      telnyxMessageId,
      idempotencyKey,
      incidentId: null,
      direction: "outbound",
      eventType: envelope.data.event_type,
      phone: normalizedTo ?? "unknown",
      body: payload.text ?? "",
      deliveryStatus: deriveDeliveryStatus(envelope.data.event_type, payload),
      errorDetails: describeDeliveryError(payload),
      raw: safeJsonString(envelope),
    })
    .onConflictDoNothing({ target: messageEvents.idempotencyKey })
    .returning();

  if (inserted.length === 0) {
    return {
      response: { handled: "duplicate", detail: "Duplicate webhook delivery" },
      background: null,
    };
  }

  if (telnyxMessageId) {
    await linkDeliveryEventToOutbound(inserted[0]!.id, telnyxMessageId);
  }

  return {
    response: {
      handled: "delivery",
      detail: `${envelope.data.event_type}: ${inserted[0]!.deliveryStatus}`,
    },
    background: null,
  };
}



async function linkDeliveryEventToOutbound(
  deliveryEventId: string,
  telnyxMessageId: string,
) {
  // Inherit incident linkage from the original outbound "accepted" event so
  // the dashboard can show per-incident delivery state.
  const outbound = await db
    .select({ id: messageEvents.id, incidentId: messageEvents.incidentId })
    .from(messageEvents)
    .where(eq(messageEvents.telnyxMessageId, telnyxMessageId))
    .orderBy(messageEvents.createdAt)
    .limit(1);
  const original = outbound[0];
  if (!original) return;
  await db
    .update(messageEvents)
    .set({ incidentId: original.incidentId })
    .where(eq(messageEvents.id, deliveryEventId));
}
