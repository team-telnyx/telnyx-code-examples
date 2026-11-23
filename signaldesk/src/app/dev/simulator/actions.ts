"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isDev } from "@/lib/config";
import {
  UnknownMessageError,
  parseWebhookEnvelope,
} from "@/lib/webhook-events";
import { normalizeE164 } from "@/lib/phone";

export interface SimulatorResult {
  ok: boolean;
  error?: string;
  handled?: string;
  detail?: string;
  incidentNumber?: string;
  incidentId?: string;
}

/**
 * Simulates an inbound SMS exactly the way the Telnyx webhook would deliver
 * it — same envelope, same processing pipeline — but only in development.
 * The signature check is bypassed because this call originates from inside
 * the app itself, never from the public internet.
 */
export async function simulateInboundSms(
  _prev: SimulatorResult | null,
  formData: FormData,
): Promise<SimulatorResult> {
  if (!isDev()) {
    return { ok: false, error: "The simulator is development-only." };
  }
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const from = String(formData.get("from") ?? "");
  const body = String(formData.get("body") ?? "");

  const fromPhone = normalizeE164(from);
  if (!fromPhone) {
    return { ok: false, error: "Enter a valid phone number (E.164 or 10 digits)." };
  }
  if (body.trim() === "") {
    return { ok: false, error: "Message body is empty." };
  }

  const event = {
    data: {
      id: `sim-${crypto.randomUUID()}`,
      event_type: "message.received",
      payload: {
        id: `sim-msg-${crypto.randomUUID().slice(0, 18)}`,
        from: { phone_number: fromPhone },
        to: [{ phone_number: process.env.TELNYX_FROM_NUMBER ?? "+10000000000" }],
        text: body,
      },
    },
  };

  const rawBody = JSON.stringify(event);

  let envelope;
  try {
    envelope = parseWebhookEnvelope(rawBody);
  } catch (error) {
    if (error instanceof UnknownMessageError) {
      return { ok: false, error: "Could not build the webhook envelope." };
    }
    throw error;
  }

  try {
    const { planIngestion } = await import("@/lib/webhook-events");
    const plan = await planIngestion(envelope, rawBody);
    let finalOutcome = plan.response;
    if (plan.background) {
      finalOutcome = await plan.background();
    }
    if (finalOutcome.incidentNumber) {
      const { findIncidentByNumber } = await import("@/lib/incidents");
      const incident = await findIncidentByNumber(finalOutcome.incidentNumber);
      return {
        ok: true,
        handled: finalOutcome.handled,
        detail: finalOutcome.detail,
        incidentNumber: finalOutcome.incidentNumber,
        incidentId: incident?.id,
      };
    }
    return {
      ok: true,
      handled: finalOutcome.handled,
      detail: finalOutcome.detail,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Pipeline error: ${(error as Error).message.slice(0, 200)}`,
    };
  }
}
