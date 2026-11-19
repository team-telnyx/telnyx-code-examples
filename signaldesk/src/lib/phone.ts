/**
 * Phone number handling: E.164 normalization and log-safe masking.
 *
 * Normalization accepts common US formats and treats 10-digit input as a US
 * number (the demo deployment is US-based). Numbers that already carry a `+`
 * pass through after digit stripping. Anything ambiguous is rejected rather
 * than guessed.
 */

export function normalizeE164(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;

  if (hasPlus) {
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }

  if (trimmed.startsWith("00")) {
    const rest = digits.slice(2);
    if (rest.length >= 8 && rest.length <= 15) return `+${rest}`;
    return null;
  }

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}

export function isValidE164(value: string): boolean {
  return normalizeE164(value) !== null;
}

/**
 * Mask a phone number for display/logs: keeps the country code and last four
 * digits, hides everything in between. Non-E.164 input degrades safely.
 */
export function maskPhone(input: string): string {
  const normalized = normalizeE164(input);
  if (!normalized) return "•••";
  const digits = normalized.slice(1); // strip +
  if (digits.length <= 4) return `+••${digits.slice(-2)}`;
  const last4 = digits.slice(-4);
  const countryCodeLength = Math.max(digits.length - 10, 1);
  const countryCode = digits.slice(0, countryCodeLength);
  return `+${countryCode} ••• ••• ${last4}`;
}

/** Last four digits only, for narrow UI badges. */
export function lastFour(input: string): string | null {
  const normalized = normalizeE164(input);
  if (!normalized) return null;
  return normalized.slice(-4);
}
