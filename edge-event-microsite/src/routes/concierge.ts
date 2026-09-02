import type { Env } from "../types";
import { complete } from "../telnyx";
import { getEvent, upsertAttendee } from "../store";

/** Build the grounding prompt from the live KV event data. */
async function conciergeSystemPrompt(env: Env): Promise<string> {
  const data = await getEvent(env.EVENTS);
  return [
    `You are ${data.event.name}'s AI concierge. Today is ${data.event.date}, at ${data.event.location}.`,
    `Answer attendee questions about ONLY this event using ONLY the data below.`,
    `Be brief (1-3 sentences), friendly, and concrete. If the answer is not in the data, say you'll check with the organizers — do not invent details.`,
    ``,
    `EVENT DATA (live from the same KV store that renders the website):`,
    JSON.stringify(data),
  ].join("\n");
}

/**
 * Handle an inbound SMS or WhatsApp message.
 * Shapes differ slightly: SMS text is payload.text, WhatsApp text is payload.text.body.
 */
export async function handleInboundMessage(
  env: Env,
  channel: "sms" | "whatsapp",
  payload: Record<string, unknown>,
): Promise<Response> {
  const fromObj = payload.from as { phone_number?: string } | undefined;
  const from = fromObj?.phone_number ?? "";

  let text = "";
  const rawText = payload.text;
  if (typeof rawText === "string") text = rawText;
  else if (rawText && typeof rawText === "object") {
    text = (rawText as { body?: string }).body ?? "";
  }

  if (!from || !text.trim()) {
    return Response.json({ error: "missing from or text" }, { status: 400 });
  }

  // Opt-in: attendees who message the concierge are registered for broadcasts.
  await upsertAttendee(env.EVENTS, from, `inbound-${channel}`);

  // Concierge reply — grounded in the same KV data as the website.
  let reply: string;
  try {
    reply = await complete(
      env,
      [
        { role: "system", content: await conciergeSystemPrompt(env) },
        { role: "user", content: text },
      ],
      { maxTokens: 300, temperature: 0.3 },
    );
  } catch (e) {
    reply =
      "Sorry — I'm having trouble right now. Please try again in a moment.";
  }
  if (!reply) reply = "Sorry — I didn't catch that. Could you rephrase?";

  // Lead intent? The concierge qualifies on the spot (see ops.ts).
  const { maybeQualifyLead } = await import("./ops");
  const leadHandled = await maybeQualifyLead(env, from, text);

  if (leadHandled) {
    reply = `${reply}\n\n📋 Got it — I saved your booth interest and our team will follow up.${leadHandled.isHot ? " A rep is being paged right now." : ""}`;
  }

  // Reply on the same channel.
  const { sendSms } = await import("../telnyx");
  const fromNumber =
    channel === "whatsapp"
      ? process.env.TELNYX_WHATSAPP_FROM ?? ""
      : process.env.TELNYX_SMS_FROM ?? "";
  const send = await sendSms(fromNumber, from, reply);

  return Response.json({
    status: "ok",
    channel,
    delivered: send.ok,
    reply_chars: reply.length,
    lead_captured: Boolean(leadHandled),
    lead_hot: leadHandled?.isHot ?? false,
  });
}
