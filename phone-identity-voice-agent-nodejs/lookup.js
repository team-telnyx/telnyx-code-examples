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

  const url = `${API}/number_lookup/${encodeURIComponent(phone)}?type=carrier&type=caller-name&type=caller-identity`;
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
    caller_identity: {},
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
  const address = lookupData.caller_identity?.address;
  if (address && (address.city || address.state_code)) {
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
  const parts = [addr.city, addr.state_code].filter(Boolean);
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
  const address = lookupData.caller_identity?.address;
  const location = address ? formatAddress(address) : null;

  let callerContext;
  let behaviorInstructions;
  let greetingText;

  // Comprehensive demo bank profile so the AI can handle any typical banking call.
  const accountData =
    `YOU ARE AN APEX BANK AI PHONE ASSISTANT. This is a demo — use the mock data below to answer ANY banking question the caller asks. ` +
    `Always respond helpfully and confidently as if this is a real bank. Never say "I don't have access" or "I can't help with that" — ` +
    `use the data provided to give realistic answers. ` +
    `\n\nACCOUNTS: ` +
    `Everyday Checking (ending 4582): balance $3,247.89, available $3,147.89 (holds: $100 gas station pre-auth). ` +
    `High-Yield Savings (ending 9013): balance $18,420.00, APY 4.10%, interest earned this month $62.87. ` +
    `Apex Visa Signature (ending 7731): balance $612.40, credit limit $10,000, available credit $9,387.60, minimum payment $25.00 due Dec 15, autopay ON. ` +
    `\n\nRECENT CHECKING TRANSACTIONS (last 30 days): ` +
    `Direct deposit $2,450.00 (Nov 1), Whole Foods $87.32 (Oct 31), Electric bill $142.18 (Oct 29), ` +
    `Amazon $34.99 (Oct 27), Starbucks $6.45 (Oct 26), Gas station $52.10 (Oct 25), ` +
    `Netflix $15.99 (Oct 24), Transfer to savings -$500.00 (Oct 22), Rent payment -$1,800.00 (Oct 1), ` +
    `Direct deposit $2,450.00 (Oct 1). Total debits last month: $2,639.03. Total credits: $4,900.00. ` +
    `\n\nRECENT CREDIT CARD TRANSACTIONS: ` +
    `Restaurant $78.50 (Nov 2), Uber $23.40 (Oct 30), Target $156.80 (Oct 28), Pharmacy $12.50 (Oct 25). ` +
    `Rewards points: 14,820. Cash back earned this year: $187.40. ` +
    `\n\nBANKING SERVICES: ` +
    `Wire transfers: domestic $25 fee, international $45 fee, daily limit $50,000. ` +
    `Zelle: enabled, daily limit $2,500. ` +
    `Overdraft protection: linked to savings, $12 transfer fee. ` +
    `Paper checks: order at $20/box, current check range 1001-1050. ` +
    `\n\nCARD SERVICES: ` +
    `Debit card (ending 8834): active, daily ATM limit $500, daily purchase limit $5,000, contactless enabled. ` +
    `If they report a lost/stolen card, say you'll freeze it immediately and ship a replacement in 3-5 business days. ` +
    `If they want to dispute a transaction, take the details and say a provisional credit will appear within 48 hours. ` +
    `\n\nLOANS & RATES: ` +
    `No active loans. Pre-approved for personal loan up to $25,000 at 7.9% APR. ` +
    `Mortgage rates starting at 6.25% for 30-year fixed. Home equity line available. ` +
    `\n\nPROFILE & SECURITY: ` +
    `Email on file: demo@apexbank.example. Phone on file: the caller's number. ` +
    `Paperless statements: ON. Two-factor auth: ON (SMS). ` +
    `Last login: today. No suspicious activity detected. ` +
    `\n\nBRANCH & HOURS: Nearest branch: 123 Main Street, open Mon-Fri 9am-5pm, Sat 9am-1pm. ` +
    `Customer service: 24/7 by phone. ` +
    `\n\nFor any question not covered above, give a plausible and helpful answer consistent with a major US bank.`;

  if (risk.level === "trusted" && name) {
    const firstName = name.split(" ")[0];
    callerContext = `Verified customer: ${name}. ${lineType}, ${carrier}. Confidence: ${confidence}. ${location || "No location"}.`;
    behaviorInstructions =
      `Greet the caller by their first name (${firstName}). They are a verified customer — skip identity verification. ` +
      `Offer direct account access and be warm and helpful. Ask how you can help them today. ` +
      accountData;
    greetingText =
      `Hello ${firstName}! Welcome back to Apex Bank. How can I help you today?`;
  } else if (risk.level === "standard") {
    const displayName = name || "caller";
    callerContext = `Partially verified caller${name ? `: ${name}` : ""}. ${lineType}, ${carrier}. Confidence: ${confidence ?? "N/A"}. ${location || "No location data"}.`;
    behaviorInstructions =
      `Greet the caller professionally. Ask for their full name and date of birth as a security step. ` +
      `IMPORTANT: This is a demo — accept ANY answer the caller gives. Do NOT reject or question their responses. ` +
      `Once they provide name and date of birth, say "Thank you, I've verified your identity" and proceed to help them. ` +
      accountData;
    greetingText =
      `Thank you for calling Apex Bank. For security purposes, I'll need to verify your identity. Could you please provide your full name?`;
  } else {
    callerContext = `Unverified caller. ${lineType} line. ${carrier}. No registered name. ${lookupData.portability?.ported_status === "ported" ? "Recently ported." : ""} Confidence: ${confidence ?? "N/A"}.`;
    behaviorInstructions =
      `Use a formal greeting. This caller has low trust signals. Ask for their full name, date of birth, and last four digits of their account number. ` +
      `IMPORTANT: This is a demo — accept ANY answer the caller gives for each step. Do NOT validate, reject, or say you cannot find their account. ` +
      `After they provide all three, say "Thank you, your identity has been verified" and proceed to help them with whatever they need. ` +
      accountData;
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
  const address = lookupData.caller_identity?.address;
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
