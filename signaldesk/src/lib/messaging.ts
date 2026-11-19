import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { messageEvents, subscribers, type MessageEvent } from "@/db/schema";
import { optOutPhone } from "@/lib/incidents";
import { normalizeE164 } from "@/lib/phone";
import { safeJsonString } from "@/lib/incidents";
import {
  HELP_TEXT,
  OPT_IN_CONFIRMATION,
  OPT_OUT_CONFIRMATION,
  resolutionText,
  statusUpdateText,
} from "@/lib/sms-copy";
import { sendSms } from "@/lib/telnyx";
import type { Status } from "@/lib/status";

export interface RecordedSms {
  messageEvent: MessageEvent | null;
  accepted: boolean;
  telnyxMessageId: string | null;
}

/**
 * Sends an outbound SMS and records it as a MessageEvent.
 *
 * In mock mode the message is only persisted (visible in /dev/outbox).
 * Acceptance by the Telnyx API is NOT delivery — later `message.sent` and
 * `message.finalized` webhooks update the recorded state.
 */
export async function sendAndRecordSms(input: {
  to: string;
  body: string;
  eventType: string;
  incidentId: string | null;
  raw?: unknown;
}): Promise<RecordedSms> {
  const result = await sendSms({ to: input.to, body: input.body });

  const idempotencyKey = result.telnyxMessageId
    ? `outbound:${result.telnyxMessageId}`
    : `outbox:${crypto.randomUUID()}`;

  const inserted = await db
    .insert(messageEvents)
    .values({
      telnyxMessageId: result.telnyxMessageId,
      idempotencyKey,
      incidentId: input.incidentId,
      direction: "outbound",
      eventType: input.eventType,
      phone: input.to,
      body: input.body,
      deliveryStatus: result.deliveryStatus,
      errorDetails: result.errorDetails,
      raw: safeJsonString(
        input.raw ?? {
          queued: true,
          mock: result.deliveryStatus === "mock_outbox",
        },
      ),
    })
    .onConflictDoNothing({ target: messageEvents.idempotencyKey })
    .returning();

  return {
    messageEvent: inserted[0] ?? null,
    accepted: result.accepted,
    telnyxMessageId: result.telnyxMessageId,
  };
}

/** Sends HELP text (always allowed — transactional, not marketing). */
export async function sendHelp(to: string): Promise<RecordedSms> {
  return sendAndRecordSms({
    to,
    body: HELP_TEXT,
    eventType: "outbound.help",
    incidentId: null,
  });
}

export async function sendOptOutConfirmation(
  to: string,
  optedOut: boolean,
): Promise<RecordedSms | null> {
  if (!optedOut) return null;
  return sendAndRecordSms({
    to,
    body: OPT_OUT_CONFIRMATION,
    eventType: "outbound.opt_out",
    incidentId: null,
  });
}

export async function sendOptInConfirmation(to: string): Promise<RecordedSms> {
  return sendAndRecordSms({
    to,
    body: OPT_IN_CONFIRMATION,
    eventType: "outbound.opt_in",
    incidentId: null,
  });
}

/**
 * Stops the phone and confirms opt-out. Opt-out itself is honored even in
 * mock mode (the confirmation is recorded, never sent for real unless
 * SIGNALDESK_MOCK_SMS=false).
 */
export async function handleStop(phone: string): Promise<void> {
  await optOutPhone(phone);
  await sendOptOutConfirmation(phone, true);
}

export { optOutPhone };

/**
 * Active subscribers of an incident: rows where active is true and the
 * number has not opted out. Only these receive status updates.
 */
export async function listActiveSubscribers(incidentId: string) {
  return db
    .select({ phone: subscribers.phone })
    .from(subscribers)
    .where(and(eq(subscribers.incidentId, incidentId), eq(subscribers.active, true)));
}

/**
 * Sends a status-change SMS to every active subscriber of the incident.
 * Opted-out numbers are skipped; the copy differs for resolutions.
 */
export async function notifyStatusChange(input: {
  incidentNumber: string;
  incidentId: string;
  previousStatus: Status;
  newStatus: Status;
  operatorNote: string | null;
}): Promise<{ sent: number; skipped: number }> {
  const body =
    input.newStatus === "RESOLVED"
      ? resolutionText({
          incidentNumber: input.incidentNumber,
          operatorNote: input.operatorNote,
        })
      : statusUpdateText({
          incidentNumber: input.incidentNumber,
          previousStatus: input.previousStatus,
          newStatus: input.newStatus,
          operatorNote: input.operatorNote,
        });

  const recipients = await listActiveSubscribers(input.incidentId);
  let sent = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const normalized = normalizeE164(recipient.phone);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    const result = await sendAndRecordSms({
      to: normalized,
      body,
      eventType: "outbound.status_update",
      incidentId: input.incidentId,
    });
    if (result.accepted) sent += 1;
    else skipped += 1;
  }

  return { sent, skipped };
}
