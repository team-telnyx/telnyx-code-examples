#!/usr/bin/env node
/**
 * AI Appointment Recovery Autocaller
 *
 * Books appointments with the patient's number saved on file. When a visit
 * goes missed, the AI receptionist calls the patient, offers real rebooking
 * slots, books the one the patient picks (via a webhook tool call), and sends
 * the SMS confirmation. The front desk never touches the phone.
 */
require("dotenv").config();
const express = require("express");
const { createPublicKey, verify: edVerify } = require("crypto");

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const PORT = process.env.PORT || 3000;
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const CLINIC_NUMBER = process.env.TELNYX_NUMBER;
const CLINIC_NAME = process.env.CLINIC_NAME || "Winderval Medical";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const ASSISTANT_NAME = "Appointment Recovery Autocaller (Demo)";
const API = "https://api.telnyx.com/v2";
const JSON_HEADERS = { Authorization: `Bearer ${TELNYX_API_KEY}`, "Content-Type": "application/json" };

const appointments = new Map(); // id -> appointment record
let assistantId = process.env.TELNYX_ASSISTANT_ID || null;

const INSTRUCTIONS = [
  "You are Ava, the AI receptionist for {{clinic_name}}, calling {{patient_name}} about a missed appointment: {{missed_summary}}.",
  "Confirm you are speaking with {{patient_name}}, apologize for the miss, then offer these openings: {{rebook_options}}.",
  "When the patient picks one, call the book_appointment tool with requested_time set to the exact option label (including the day) and appointment_id \"{{appointment_id}}\".",
  "After the tool confirms, state the confirmation: the day, the time, and the clinician. Then close the call politely.",
  "Never give medical advice. If asked anything medical, say: \"That's a great question for your care team — let me connect you with our nurse line.\" and end the call.",
].join(" ");

/* ─── Telnyx API helper ─────────────────────────────────────────────── */

async function telnyx(method, path, body) {
  const res = await fetch(`${API}${path}`, { method, headers: JSON_HEADERS, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = JSON.stringify(json.errors || json).slice(0, 240);
    throw new Error(`Telnyx ${method} ${path} -> HTTP ${res.status}: ${detail}`);
  }
  return json;
}

/* ─── Availability + booking ────────────────────────────────────────── */

function rebookOptions(now = new Date()) {
  const at = (days, hours, minutes, clinician, kind) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hours, minutes, 0, 0);
    const day = days === 1 ? "tomorrow" : d.toLocaleDateString("en-US", { weekday: "long" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return { startsAtIso: d.toISOString(), label: `${day} at ${time}`, clinician, kind };
  };
  return [
    at(1, 9, 0, "Dr. A. Chen", "follow-up"),
    at(1, 14, 0, "Dr. A. Chen", "follow-up"),
    at(2, 10, 0, "Dr. M. Okafor", "new-patient"),
  ];
}

function findOption(appointment, requested) {
  const q = String(requested || "").toLowerCase();
  return appointment.rebookOptions.find((o) => {
    const label = o.label.toLowerCase();
    const hour = (label.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)/) || [])[1];
    const meridiem = (label.match(/(am|pm)/) || [])[1];
    return q.includes(label) || (hour && q.includes(hour) && q.includes(meridiem));
  });
}

function sendSms(appointment, option) {
  return telnyx("POST", "/messages", {
    to: appointment.phone,
    from: CLINIC_NUMBER,
    text: `Hi ${appointment.name} — this is ${CLINIC_NAME} confirming your appointment ${option.label} with ${option.clinician}. Reply CALL with any questions.`,
  }).catch((error) => console.error(`[sms] send failed: ${error.message}`));
}

/* ─── Signature verification (Telnyx SDK contract) ──────────────────── */

function verifySignature(req) {
  const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY;
  if (!publicKeyB64) return true; // demo mode: verification off unless configured
  const ts = req.get("Telnyx-Timestamp");
  const sig = req.get("Telnyx-Signature-Ed25519");
  if (!ts || !sig || Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) return false;
  try {
    const key = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKeyB64, "base64").toString("base64url") },
      format: "jwk",
    });
    return edVerify(null, Buffer.from(`${ts}|${req.rawBody}`), key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

function findDeep(obj, key) {
  if (obj === null || typeof obj !== "object") return null;
  if (key in obj) return obj[key];
  for (const value of Object.values(obj)) {
    const found = findDeep(value, key);
    if (found !== null) return found;
  }
  return null;
}

/* ─── Assistant bootstrap ───────────────────────────────────────────── */

async function ensureAssistant() {
  if (assistantId) return assistantId;
  const list = await telnyx("GET", "/ai/assistants");
  const found = (list.data || []).find((a) => a.name === ASSISTANT_NAME);
  if (found) {
    assistantId = found.id;
    return assistantId;
  }
  const created = await telnyx("POST", "/ai/assistants", {
    name: ASSISTANT_NAME,
    instructions: INSTRUCTIONS,
    voice: "Telnyx.KokoroTTS.af_heart",
  });
  assistantId = created.data.id;
  console.log(`[assistant] created ${assistantId}`);
  return assistantId;
}

/* ─── Routes ────────────────────────────────────────────────────────── */

app.get("/", (_req, res) => {
  res.json({
    app: "AI Appointment Recovery Autocaller",
    usage: [
      "POST /appointments {name, phone} → books a follow-up, number saved on file",
      "POST /appointments/:id/no-show → marks the visit missed and auto-calls the patient",
      "POST /webhooks/voice → Telnyx webhook (signature-verified)",
      "POST /tools/book → the book_appointment tool the AI calls during the call",
      "GET /appointments → current state",
    ],
  });
});

app.post("/appointments", (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || typeof name !== "string" || name.trim().length < 2) {
    return res.status(422).json({ error: "Enter the patient's full name." });
  }
  if (!/^\+[1-9]\d{7,14}$/.test(phone || "")) {
    return res.status(422).json({ error: "Enter a valid phone number in E.164 format, e.g. +15555550123." });
  }
  const [option] = rebookOptions();
  const id = `apt-${Math.random().toString(36).slice(2, 8)}`;
  const appointment = {
    id,
    name: name.trim(),
    phone,
    status: "booked",
    scheduledFor: option.startsAtIso,
    rebookOptions: rebookOptions(),
    call: null,
  };
  appointments.set(id, appointment);
  res.status(201).json({ ok: true, id, appointment: { id, name: appointment.name, phone, scheduledFor: appointment.scheduledFor } });
});

app.post("/appointments/:id/no-show", async (req, res) => {
  const appointment = appointments.get(req.params.id);
  if (!appointment) return res.status(404).json({ error: "Appointment not found." });
  appointment.status = "missed";
  appointment.rebookOptions = rebookOptions();
  appointment.call = null;

  try {
    const assistant = await ensureAssistant();
    appointment.call = { id: null, status: "dialing" };
    const call = await telnyx("POST", "/calls", {
      connection_id: TELNYX_CONNECTION_ID,
      to: appointment.phone,
      from: CLINIC_NUMBER,
      assistant: {
        id: assistant,
        dynamic_variables: {
          patient_name: appointment.name,
          clinic_name: CLINIC_NAME,
          missed_summary: `your ${appointment.scheduledFor ? "visit" : "appointment"} on file`,
          rebook_options: appointment.rebookOptions.map((o) => o.label).join(", or "),
          appointment_id: appointment.id,
        },
        tools: [{ type: "webhook", webhook: { url: `${PUBLIC_BASE_URL}/tools/book`, method: "POST" } }],
      },
    });
    appointment.call = { id: call.data.call_control_id, status: "dialing" };
    res.json({ ok: true, callId: call.data.call_control_id, status: "dialing" });
  } catch (error) {
    appointment.status = "missed (call failed)";
    appointment.call = { id: null, status: "failed" };
    res.status(502).json({ error: `Call failed: ${error.message}` });
  }
});

app.post("/webhooks/voice", (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: "invalid signature" });
  const eventType = (req.body || {}).data?.event_type;
  if (eventType) console.log(`[webhook] ${eventType}`);
  res.json({ received: true });
});

app.post("/tools/book", (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: "invalid signature" });
  const appointmentId = findDeep(req.body, "appointment_id");
  const requestedTime = findDeep(req.body, "requested_time");
  const appointment = appointments.get(appointmentId);
  if (!appointment) return res.status(200).json({ status: "error", message: "I could not find that appointment." });

  const option = findOption(appointment, requestedTime);
  if (!option) {
    const labels = appointment.rebookOptions.map((o) => o.label).join(", or ");
    return res.status(200).json({ status: "unavailable", message: `That time isn't available. I have ${labels}.` });
  }
  option.booked = true;
  appointment.status = "booked";
  appointment.bookedFor = option;

  sendSms(appointment, option);

  res.status(200).json({
    status: "booked",
    message: `You're rebooked for ${option.label} with ${option.clinician}.`,
  });
});

app.get("/appointments", (_req, res) => {
  res.json({
    appointments: [...appointments.values()].map((a) => ({
      id: a.id,
      name: a.name,
      phone: a.phone.replace(/\d(?=\d{4})/g, "•"),
      status: a.status,
      call: a.call,
      bookedFor: a.bookedFor ? a.bookedFor.label : null,
    })),
  });
});

/* ─── Boot ──────────────────────────────────────────────────────────── */

app.listen(PORT, () => {
  const missing = [
    ["TELNYX_API_KEY", TELNYX_API_KEY],
    ["TELNYX_CONNECTION_ID", TELNYX_CONNECTION_ID],
    ["TELNYX_NUMBER", CLINIC_NUMBER],
    ["PUBLIC_BASE_URL", process.env.PUBLIC_BASE_URL],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Missing required env vars: ${missing.join(", ")} — check .env`);
    process.exit(1);
  }
  console.log(`Appointment Recovery Autocaller listening on :${PORT}`);
  console.log(`Book a visit: POST /appointments {"name": "...", "phone": "+1..."} `);
  console.log(`Then trigger: POST /appointments/:id/no-show → the AI calls the patient.`);
});
