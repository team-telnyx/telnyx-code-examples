// SMS messaging via Telnyx SMS API — send and receive text messages.
// Works on any phone (2G/3G/4G/5G), no app required.
import { setting } from "./settings.js";

const TELNYX_API = "https://api.telnyx.com/v2";

// ---------------------------------------------------------------------------
// Parse inbound SMS webhook into a normalized object
// ---------------------------------------------------------------------------
export function parseInbound(payload) {
  const data = payload.data || {};
  const p = data.payload || {};

  if (data.event_type !== "message.received") return null;
  if (p.direction !== "inbound") return null;

  const phone = p.from?.phone_number || "";
  if (!phone) return null;

  const text = p.text || (p.body || "");
  const msgId = p.id || data.id || "";

  return { phone, text: typeof text === "string" ? text : String(text), msgId };
}

// ---------------------------------------------------------------------------
// Send an SMS message via Telnyx
// ---------------------------------------------------------------------------
export async function sendSms(to, text) {
  const apiKey = setting("TELNYX_API_KEY");
  const from = setting("PHONE_NUMBER");
  const profileId = setting("SMS_MESSAGING_PROFILE_ID");

  if (!apiKey || !from) throw new Error("TELNYX_API_KEY and PHONE_NUMBER required for SMS");

  const body = {
    from,
    to,
    text,
    type: "SMS",
  };
  if (profileId) body.messaging_profile_id = profileId;

  const resp = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`SMS send failed (${resp.status}): ${err.errors?.[0]?.detail || "unknown"}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------------------
// Validate a phone number via Telnyx Number Lookup API
// ---------------------------------------------------------------------------
export async function lookupNumber(phone) {
  const apiKey = setting("TELNYX_API_KEY");
  if (!apiKey) return { valid: true };

  try {
    const resp = await fetch(
      `${TELNYX_API}/number_lookup/${encodeURIComponent(phone)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      }
    );
    if (!resp.ok) return { valid: true };
    const data = await resp.json();
    return {
      valid: data.data?.valid_number !== false,
      carrier: data.data?.carrier?.name || "",
      type: data.data?.carrier?.type || "",
    };
  } catch {
    return { valid: true };
  }
}
