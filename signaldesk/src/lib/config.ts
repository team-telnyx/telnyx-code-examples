/**
 * Central environment access. Everything server-side should read config
 * through this module so the requirements are checked in one place.
 * Never expose server-only config to the browser.
 */

function optionalString(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const isMockAi = () => process.env.SIGNALDESK_MOCK_AI === "true";

export const isMockSms = () => process.env.SIGNALDESK_MOCK_SMS === "true";

export const isDev = () => process.env.NODE_ENV === "development";

/** Webhook signature checks are skipped only in dev with explicit opt-in. */
export const isMockWebhooksAllowed = () =>
  isDev() && process.env.NODE_ENV !== "production";

export function getTelnyxConnectorName(): string {
  return optionalString("TELNYX_CONNECTOR_NAME") ?? "telnyx/signaldesk-telnyx";
}

export function getTelnyxApiKeyFallback(): string | undefined {
  return optionalString("TELNYX_API_KEY");
}

export function getTelnyxPublicKey(): string | undefined {
  return optionalString("TELNYX_PUBLIC_KEY");
}

export function getTelnyxFromNumber(): string | undefined {
  return optionalString("TELNYX_FROM_NUMBER");
}

export function getTelnyxMessagingProfileId(): string | undefined {
  return optionalString("TELNYX_MESSAGING_PROFILE_ID");
}

export function getAuthSecret(): string {
  const secret = optionalString("AUTH_SECRET");
  if (!secret || secret === "change_me_run_openssl_rand_base64_32") {
    throw new Error(
      "AUTH_SECRET is not configured. Generate one with: openssl rand -base64 32",
    );
  }
  return secret;
}

export function getOperatorUsername(): string {
  const value = optionalString("SIGNALDESK_OPERATOR_USERNAME");
  if (!value) {
    throw new Error("SIGNALDESK_OPERATOR_USERNAME is not configured.");
  }
  return value;
}

export function getOperatorPasswordHash(): string {
  const value = optionalString("SIGNALDESK_OPERATOR_PASSWORD_HASH");
  if (!value || value.startsWith("change_me")) {
    throw new Error(
      "SIGNALDESK_OPERATOR_PASSWORD_HASH is not configured. Run: npm run hash-password -- <password>",
    );
  }
  return value;
}

/** Comma-separated allowlist; empty/absent means "allow everyone". */
export function getAllowedReporterNumbers(): string[] | null {
  const raw = optionalString("ALLOWED_REPORTER_NUMBERS");
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return list.length > 0 ? list : null;
}
