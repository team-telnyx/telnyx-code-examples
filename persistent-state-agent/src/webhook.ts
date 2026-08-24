import { unwrapWebhook } from "telnyx/lib/webhooks";
import type { TelnyxMessageWebhook, Env } from "./types.js";

export async function verifyAndParseWebhook(
  body: string,
  request: Request,
  env: Env,
): Promise<TelnyxMessageWebhook> {
  const publicKey = await env.SECRETS?.get("TELNYX_PUBLIC_KEY");
  if (!publicKey) {
    throw new Error("TELNYX_PUBLIC_KEY is required when SMS_TRANSPORT is production");
  }

  const headers = Object.fromEntries(request.headers.entries());

  return unwrapWebhook<TelnyxMessageWebhook>(body, {
    headers,
    key: publicKey,
  }, null);
}

export async function parseWebhookBody(body: string): Promise<TelnyxMessageWebhook> {
  return JSON.parse(body) as TelnyxMessageWebhook;
}
