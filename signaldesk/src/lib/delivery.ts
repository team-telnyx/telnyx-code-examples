import "server-only";

/**
 * Pure delivery-state derivation for Telnyx messaging webhooks.
 * Keeping these pure makes them unit-testable without touching the database.
 */

export function deriveDeliveryStatus(
  eventType: string,
  payload: { errors?: Array<{ code?: string; description?: string }> },
): string {
  if (eventType === "message.finalized") {
    const failed = Array.isArray(payload.errors) && payload.errors.length > 0;
    return failed ? "failed" : "delivered";
  }
  return "sent";
}

export function describeDeliveryError(payload: {
  errors?: Array<{ code?: string; description?: string }>;
}): string | null {
  const first = payload.errors?.[0];
  if (!first) return null;
  return [first.code, first.description].filter(Boolean).join(": ");
}
