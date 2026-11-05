/* ------------------------------------------------------------------ *
 *  lookup.js — Number Lookup API + cache + risk assessment             *
 *  Calls GET /v2/number_lookup/{phone} with carrier, caller-name,     *
 *  and caller-identity types. Caches results for 24 h. Builds         *
 *  dynamic variables for the AI Assistant.                             *
 * ------------------------------------------------------------------ */

import { setting } from "./settings.js";

const API = "https://api.telnyx.com/v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** In-memory lookup cache: phone → { data, ts }. */
const cache = new Map();

/* ── Number Lookup API ─────────────────────────────────────────────── */

/**
 * Look up a phone number via Telnyx Number Lookup API.
 * Returns the `data` object from the response, or a minimal fallback.
 */
export async function numberLookup(phone) {
  const cached = cache.get(phone);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const key = setting("TELNYX_API_KEY");
  if (!key) throw new Error("TELNYX_API_KEY is not configured");

  const url = `${API}/number_lookup/${encodeURIComponent(phone)}?type=carrier&type=caller-name`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error(`Number Lookup failed (${resp.status}):`, body.slice(0, 200));
    return fallbackData(phone);
  }

  const json = await resp.json();
  const data = json.data || {};

  cache.set(phone, { data, ts: Date.now() });

  // Evict stale entries periodically
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL_MS) cache.delete(k);
    }
  }

  return data;
}

function fallbackData(phone) {
  return {
    phone_number: phone,
    carrier: {},
    caller_name: {},
    portability: {},
  };
}

/* ── Risk Assessment ───────────────────────────────────────────────── */

/**
 * Score a Number Lookup result. Starts at 100 and subtracts for red flags.
 * Returns { score, level, factors }.
 */
export function assessRisk(lookupData) {
  let score = 100;
  const factors = [];

  // Identity confidence
  const confidence = lookupData.caller_identity?.confidence_score;
  if (confidence != null) {
    if (confidence < 60) {
      score -= 40;
      factors.push({ signal: "Low identity confidence", value: confidence, impact: "negative" });
    } else if (confidence < 80) {
      score -= 25;
      factors.push({ signal: "Moderate identity confidence", value: confidence, impact: "neutral" });
    } else {
      factors.push({ signal: "High identity confidence", value: confidence, impact: "positive" });
    }
  } else {
    score -= 40;
    factors.push({ signal: "No identity data available", value: null, impact: "negative" });
  }

  // Caller name (CNAM)
  const cnam = lookupData.caller_name?.caller_name;
  if (cnam) {
    factors.push({ signal: "Caller name on file", value: cnam, impact: "positive" });
  } else {
    score -= 15;
    factors.push({ signal: "No caller name registered", value: null, impact: "negative" });
  }

  // Line type
  const lineType = lookupData.carrier?.type || lookupData.portability?.line_type || "";
  const lineTypeLower = lineType.toLowerCase();
  if (lineTypeLower === "voip" || lineTypeLower === "non-fixed voip") {
    score -= 20;
    factors.push({ signal: "VoIP line type", value: lineType, impact: "negative" });
  } else if (lineTypeLower === "mobile" || lineTypeLower === "wireless") {
    factors.push({ signal: "Mobile line type", value: lineType, impact: "positive" });
  } else if (lineType) {
    factors.push({ signal: "Line type", value: lineType, impact: "neutral" });
  }

  // Ported status
  const ported = lookupData.portability?.ported_status || lookupData.portability?.status || "";
  if (ported.toLowerCase() === "ported" || ported.toLowerCase() === "y") {
    score -= 10;
    factors.push({ signal: "Number has been ported", value: "ported", impact: "negative" });
  } else {
    factors.push({ signal: "Number not ported", value: "original", impact: "positive" });
  }

  // Postal address
  const address = lookupData.caller_identity?.postal_address;
  if (address && (address.city || address.state)) {
    factors.push({ signal: "Address on file", value: formatAddress(address), impact: "positive" });
  } else {
    score -= 10;
    factors.push({ signal: "No address on file", value: null, impact: "negative" });
  }

  score = Math.max(0, Math.min(100, score));

  let level;
  if (score >= 70) level = "trusted";
  else if (score >= 40) level = "standard";
  else level = "suspicious";

  return { score, level, factors };
}

function formatAddress(addr) {
  if (!addr) return "";
  const parts = [addr.city, addr.state].filter(Boolean);
  return parts.join(", ");
}

/* ── Dynamic Variables Builder ─────────────────────────────────────── */

/**
 * Build caller_context and behavior_instructions for the AI Assistant
 * dynamic variables, plus a greeting_text.
 */
export function buildDynamicVars(lookupData, risk) {
  const name = lookupData.caller_identity?.name
    || lookupData.caller_name?.caller_name
    || null;
  const carrier = lookupData.carrier?.name || "Unknown carrier";
  const lineType = lookupData.carrier?.type
    || lookupData.portability?.line_type
    || "Unknown";
  const confidence = lookupData.caller_identity?.confidence_score;
  const address = lookupData.caller_identity?.postal_address;
  const location = address ? formatAddress(address) : null;

  let callerContext;
  let behaviorInstructions;
  let greetingText;

  if (risk.level === "trusted" && name) {
    const firstName = name.split(" ")[0];
    callerContext = `Verified customer: ${name}. ${lineType}, ${carrier}. Confidence: ${confidence}. ${location || "No location"}.`;
    behaviorInstructions =
      `Greet the caller by their first name (${firstName}). They are a verified customer — skip identity verification. ` +
      `Offer direct account access and be warm and helpful. Ask how you can help them today.`;
    greetingText =
      `Hello ${firstName}! Welcome back to Apex Bank. How can I help you today?`;
  } else if (risk.level === "standard") {
    const displayName = name || "caller";
    callerContext = `Partially verified caller${name ? `: ${name}` : ""}. ${lineType}, ${carrier}. Confidence: ${confidence ?? "N/A"}. ${location || "No location data"}.`;
    behaviorInstructions =
      `Greet the caller professionally. Verify their identity by asking for their full name and date of birth before providing account access. ` +
      `Be helpful but follow standard security procedures.`;
    greetingText =
      `Thank you for calling Apex Bank. For security purposes, I'll need to verify your identity. Could you please provide your full name?`;
  } else {
    callerContext = `Unverified caller. ${lineType} line. ${carrier}. No registered name. ${lookupData.portability?.ported_status === "ported" ? "Recently ported." : ""} Confidence: ${confidence ?? "N/A"}.`;
    behaviorInstructions =
      `Use a formal greeting. This caller has low trust signals. You MUST verify their identity before ANY account access: ` +
      `ask for full name, date of birth, and last four digits of their account number. Do NOT skip any verification step. ` +
      `Be polite but firm about security requirements.`;
    greetingText =
      `Thank you for calling Apex Bank. For your security, I'll need to verify your identity before we proceed. May I have your full name please?`;
  }

  return { callerContext, behaviorInstructions, greetingText };
}

/* ── Identity Card Data (for dashboard) ────────────────────────────── */

/**
 * Build a structured identity object for the dashboard.
 */
export function buildIdentityCard(phone, lookupData, risk) {
  const name = lookupData.caller_identity?.name
    || lookupData.caller_name?.caller_name
    || null;
  const carrier = lookupData.carrier?.name || null;
  const lineType = lookupData.carrier?.type
    || lookupData.portability?.line_type
    || null;
  const confidence = lookupData.caller_identity?.confidence_score ?? null;
  const address = lookupData.caller_identity?.postal_address;
  const location = address ? formatAddress(address) : null;
  const ported = lookupData.portability?.ported_status || lookupData.portability?.status || null;
  const cnam = lookupData.caller_name?.caller_name || null;

  return {
    phone,
    name,
    carrier,
    lineType,
    confidence,
    location,
    ported,
    cnam,
    trustScore: risk.score,
    trustLevel: risk.level,
    factors: risk.factors,
  };
}
