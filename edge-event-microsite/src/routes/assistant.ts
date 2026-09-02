import { json, type Env } from "../types";
import { getEvent, ASSISTANT_KEY } from "../store";
import { upsertAssistant } from "../telnyx";

/**
 * GET /api/config — what the browser voice page needs (assistant id only;
 * the page never sees credentials).
 */
export async function handleConfig(env: Env): Promise<Response> {
  const assistantId = await env.EVENTS.get(ASSISTANT_KEY);
  return json({
    assistant_id: assistantId ?? "",
    event_name: (await getEvent(env.EVENTS)).event.name,
  });
}

/**
 * POST /api/setup-assistant — provision (or update) the Telnyx AI Assistant
 * used for browser voice, wired with a webhook tool that reads THIS
 * function's KV namespace. Run once after the first deploy:
 *
 *   curl -X POST https://<your-func>.telnyxcompute.com/api/setup-assistant
 */
export async function handleSetupAssistant(req: Request, env: Env): Promise<Response> {
  // The function is only ever reached over public HTTPS (telnyxcompute.com and
  // custom domains enforce TLS); the internal hop forwards http, so don't trust
  // x-forwarded-proto. Override with PUBLIC_PROTO if serving plain HTTP in dev.
  const proto = process.env.PUBLIC_PROTO ?? "https";
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const origin = `${proto}://${host}`;
  const event = await getEvent(env.EVENTS);

  const toolUrl = `${origin}/tools/lookup`;
  const instructions = [
    `You are the friendly voice concierge for ${event.event.name} (${event.event.date}, ${event.event.location}).`,
    `When asked about the schedule, speakers, venue, WiFi, parking, or sponsors, call the lookup_event_info tool and answer from its result.`,
    `Keep answers brief and natural for voice — 1-3 sentences. If the tool returns nothing relevant, say you'll check with the organizers.`,
  ].join(" ");

  const greeting = `Hi, welcome to ${event.event.name}! I can help with the schedule, speakers, venue, WiFi or parking — what do you need?`;

  const assistant = await upsertAssistant(
    "edge-event-microsite-concierge",
    instructions,
    greeting,
    [
      {
        type: "webhook",
        webhook: {
          name: "lookup_event_info",
          description:
            "Returns the live event data: schedule, speakers, venue (address, WiFi, parking), and sponsors. Use this for any event-information question.",
          url: toolUrl,
          method: "POST",
          body_parameters: {
            type: "object",
            properties: {
              topic: {
                type: "string",
                description:
                  "What the attendee asked about: schedule, speakers, venue, wifi, parking, or sponsors.",
              },
            },
          },
        },
      },
    ],
  );

  await env.EVENTS.put(ASSISTANT_KEY, assistant.id);
  return json({
    status: "ok",
    assistant_id: assistant.id,
    webhook_tool_url: toolUrl,
    voice_page: `${origin}/voice`,
  });
}

/**
 * POST /tools/lookup — the assistant's webhook tool. The assistant calls this
 * mid-conversation; it reads the same KV namespace as the website, so the
 * voice agent can never drift from what attendees see on the page.
 */
export async function handleToolLookup(env: Env): Promise<Response> {
  const data = await getEvent(env.EVENTS);
  return json(data);
}
