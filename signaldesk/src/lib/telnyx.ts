import "server-only";
import Telnyx from "telnyx";
import { TelnyxWebhookVerificationError, unwrapWebhook } from "telnyx/lib/webhooks";
import {
  getTelnyxApiKeyFallback,
  getTelnyxConnectorName,
  isMockSms,
} from "@/lib/config";

export { TelnyxWebhookVerificationError };

/**
 * Server-only Telnyx access.
 *
 * Credential priority:
 *   1. Vercel Connect connector (getToken via Vercel OIDC on deployments)
 *   2. TELNYX_API_KEY environment variable (local development fallback)
 *
 * This module never logs credentials, signatures, or raw headers.
 */

let cachedClient: { apiKey: string; client: Telnyx } | null = null;

export async function getTelnyxClient(): Promise<Telnyx> {
  const apiKey = await resolveTelnyxApiKey();
  if (cachedClient?.apiKey === apiKey) return cachedClient.client;

  const client = new Telnyx({ apiKey });
  cachedClient = { apiKey, client };
  return client;
}

export async function resolveTelnyxApiKey(): Promise<string> {
  const connector = getTelnyxConnectorName();
  const runningOnVercel = process.env.VERCEL === "1";

  if (runningOnVercel && connector) {
    try {
      const { getToken } = await import("@vercel/connect");
      const token = await getToken(connector, { subject: { type: "app" } });
      if (token) return token;
    } catch {
      // Connect not installed / not configured for this deployment:
      // fall through to the environment variable.
    }
  }

  const fallback = getTelnyxApiKeyFallback();
  if (!fallback) {
    throw new Error(
      "No Telnyx credentials available. Install the Vercel Connect connector or set TELNYX_API_KEY.",
    );
  }
  return fallback;
}

export interface OutboundSmsInput {
  to: string;
  body: string;
}

export interface OutboundSmsResult {
  telnyxMessageId: string | null;
  accepted: boolean;
  deliveryStatus: string;
  errorDetails: string | null;
}

/**
 * Sends an SMS (or records it in the mock outbox) and reports whether the
 * send was *accepted* — never treated as final delivery. Delivery state
 * arrives later via `message.sent` / `message.finalized` webhooks.
 */
export async function sendSms(
  input: OutboundSmsInput,
): Promise<OutboundSmsResult> {
  if (isMockSms()) {
    return {
      telnyxMessageId: null,
      accepted: true,
      deliveryStatus: "mock_outbox",
      errorDetails: null,
    };
  }

  const client = await getTelnyxClient();
  const { getTelnyxMessagingProfileId, getTelnyxFromNumber } = await import(
    "@/lib/config"
  );
  const messagingProfileId = getTelnyxMessagingProfileId();
  const from = getTelnyxFromNumber();

  if (!messagingProfileId && !from) {
    return {
      telnyxMessageId: null,
      accepted: false,
      deliveryStatus: "config_error",
      errorDetails: "Set TELNYX_MESSAGING_PROFILE_ID or TELNYX_FROM_NUMBER",
    };
  }

  try {
    const response = await client.messages.send({
      to: input.to,
      from,
      text: input.body,
      ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
    });
    const message = response.data;
    return {
      telnyxMessageId: message?.id ?? null,
      accepted: true,
      deliveryStatus: "accepted",
      errorDetails: null,
    };
  } catch (error) {
    const handled = await describeTelnyxError(error);
    return {
      telnyxMessageId: null,
      accepted: false,
      deliveryStatus: handled.status,
      errorDetails: handled.details,
    };
  }
}

export interface TelnyxErrorDescription {
  status: string;
  details: string;
  retryAfterMs: number | null;
}

const RATE_LIMIT_MAX_RETRY_MS = 30_000;

export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.min(seconds * 1000, RATE_LIMIT_MAX_RETRY_MS);
  return Number.isFinite(ms) ? ms : null;
}

async function describeTelnyxError(
  error: unknown,
): Promise<TelnyxErrorDescription> {
  const telnyx = await import("telnyx");
  if (error instanceof telnyx.default.APIError) {
    const status = error.status ?? 500;
    const retryAfter = parseRetryAfter(extractHeader(error.headers, "retry-after"));
    const base = `Telnyx API error ${status}`;
    const details =
      status === 401
        ? `${base}: authentication failed (check credentials)`
        : status === 403
          ? `${base}: forbidden (check API key permissions)`
          : status === 422
            ? `${base}: request rejected by Telnyx`
            : status === 429
              ? `${base}: rate limited${retryAfter !== null ? `, retry after ${Math.round(retryAfter / 1000)}s` : ""}`
              : status >= 500
                ? `${base}: Telnyx server error, retry later`
                : base;
    return {
      status: status >= 500 ? "upstream_error" : status >= 400 ? "rejected" : "error",
      details,
      retryAfterMs: retryAfter,
    };
  }
  if (error instanceof Error && error.message === "fetch failed") {
    return {
      status: "network_error",
      details: "Network error contacting Telnyx",
      retryAfterMs: null,
    };
  }
  return {
    status: "error",
    details: "Unexpected error while sending message",
    retryAfterMs: null,
  };
}

function extractHeader(
  headers: unknown,
  name: string,
): string | null {
  if (headers && typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  if (headers && typeof headers === "object" && name in (headers as Record<string, string>)) {
    const value = (headers as Record<string, string>)[name];
    return typeof value === "string" ? value : null;
  }
  return null;
}

export { unwrapWebhook };
