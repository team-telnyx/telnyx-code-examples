import { after, type NextRequest } from "next/server";
import { unwrapWebhook, TelnyxWebhookVerificationError } from "telnyx/lib/webhooks";
import { getTelnyxPublicKey, isMockWebhooksAllowed } from "@/lib/config";
import {
  parseWebhookEnvelope,
  planIngestion,
  UnknownMessageError,
} from "@/lib/webhook-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/telnyx
 *
 * Externally reachable (no dashboard auth): secured by Telnyx Ed25519
 * signature verification instead. Reads the unmodified raw body, verifies,
 * records the message event (deduplicated), and acknowledges Telnyx
 * promptly. Slow work — classification, incident creation, outbound SMS —
 * runs after the response via `after()` (waitUntil on Vercel).
 *
 * Invalid signatures, unparsable bodies, and duplicate deliveries are
 * rejected or acked idempotently — a Telnyx retry can never create a
 * duplicate incident.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();
  const allowMock = isMockWebhooksAllowed() && request.nextUrl.searchParams.get("mock") === "1";

  if (!allowMock) {
    try {
      await verifyTelnyxSignature(rawBody, request);
    } catch {
      // Generic 401: never echo signature details or request contents.
      return Response.json({ error: "signature_verification_failed" }, { status: 401 });
    }
  }

  let envelope;
  try {
    envelope = parseWebhookEnvelope(rawBody);
  } catch (error) {
    if (error instanceof UnknownMessageError) {
      return Response.json(
        { received: true, handled: "ignored", reason: "unparsable" },
        { status: 200 },
      );
    }
    throw error;
  }

  try {
    const plan = await planIngestion(envelope, rawBody);
    if (plan.background) {
      after(async () => {
        try {
          await plan.background!();
        } catch (error) {
          console.error("webhook background work failed:", (error as Error).message);
        }
      });
    }
    return Response.json({ received: true, handled: plan.response.handled }, { status: 200 });
  } catch (error) {
    console.error("webhook ingestion failed:", (error as Error).message);
    return Response.json({ received: true, handled: "error" }, { status: 200 });
  }
}

/**
 * Verifies the Ed25519 signature over `{timestamp}|{raw_body}`.
 * Throws on any verification failure; the event must not be processed.
 */
async function verifyTelnyxSignature(rawBody: string, request: NextRequest) {
  const publicKey = getTelnyxPublicKey();
  if (!publicKey) {
    throw new TelnyxWebhookVerificationError("TELNYX_PUBLIC_KEY is not configured");
  }
  const headers = Object.fromEntries(request.headers);
  await unwrapWebhook(rawBody, { headers }, publicKey);
}
