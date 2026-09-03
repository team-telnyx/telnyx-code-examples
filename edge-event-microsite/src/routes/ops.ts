import type { Env, Lead } from "../types";
import { id, json } from "../types";
import { completeJson, sendEmail, sendSms } from "../telnyx";
import { listRecords, listAttendees, getEvent } from "../store";
import { envVars } from "../types";

// ── Lead qualification (exhibitor booths) ──────────────────────────────────

const HOT_BUDGETS = new Set(["high", "enterprise"]);
const HOT_TIMELINES = [
  "immediate",
  "asap",
  "this month",
  "next month",
  "within 30 days",
  "this quarter",
  "q1",
  "q2",
];

export function isHotLead(budget: string, timeline: string): boolean {
  return (
    HOT_BUDGETS.has(budget.trim().toLowerCase()) &&
    HOT_TIMELINES.some((t) => timeline.trim().toLowerCase().includes(t))
  );
}

async function saveAndRouteLead(
  env: Env,
  lead: Omit<Lead, "id" | "is_hot" | "created_at">,
): Promise<Lead> {
  const isHot = isHotLead(lead.budget, lead.timeline);
  const full: Lead = {
    ...lead,
    id: id("lead"),
    is_hot: isHot,
    created_at: new Date().toISOString(),
  };
  await env.EVENTS.put(`lead/${full.id}`, JSON.stringify(full));

  if (isHot) {
    // The SMS body carries the masked phone — never the raw number.
    const masked = `***-***-${lead.phone_number.slice(-4)}`;
    const msg = `🔥 HOT LEAD: ${lead.company} (${lead.company_size}) | Budget: ${lead.budget} | Timeline: ${lead.timeline} | Phone: ${masked}`;

    // Route over both channels: SMS to the rep's phone, email to the
    // organizer inbox (EMAIL_TO). Each channel fails independently.
    const repPhone = envVars.TELNYX_SALES_REP_PHONE;
    let smsStatus = "skipped";
    if (repPhone) {
      const send = await sendSms(envVars.TELNYX_SMS_FROM, repPhone, msg);
      smsStatus = send.ok ? "sent" : `failed(${send.status})`;
    }
    const emailTo = process.env.EMAIL_TO ?? "";
    let emailStatus = "skipped";
    if (emailTo) {
      const mail = await sendEmail(
        envVars.EMAIL_FROM,
        emailTo,
        `Hot lead: ${lead.company} (${lead.budget} budget, ${lead.timeline})`,
        `New hot lead captured at ${lead.source}:\n\n${msg}\n\nNotes: ${lead.notes || "(none)"}\nCaptured: ${full.created_at}`,
      );
      emailStatus = mail.ok ? "sent" : `failed(${mail.status})`;
    }

    await env.EVENTS.put(
      `lead/${full.id}`,
      JSON.stringify({ ...full, notify: { sms: smsStatus, email: emailStatus } }),
    );
    full.notify = { sms: smsStatus, email: emailStatus };
  }
  return full;
}

/**
 * Called from the concierge: detect lead intent in a free-text message,
 * extract structured fields via Inference, store + route.
 * Returns null when the message is not a lead.
 */
export async function maybeQualifyLead(
  env: Env,
  from: string,
  text: string,
): Promise<{ lead: Lead; isHot: boolean } | null> {
  const lower = text.toLowerCase();
  const leadish =
    lower.includes("budget") ||
    lower.includes("pricing") ||
    lower.includes("demo") ||
    lower.includes("quote") ||
    lower.includes("booth");
  if (!leadish) return null;

  const extracted = await completeJson<{
    company?: string;
    company_size?: string;
    budget?: string;
    timeline?: string;
    notes?: string;
  }>(
    env,
    `Extract exhibitor lead details from the message. Fields: company, company_size, budget (low/medium/high/enterprise), timeline, notes. Use "" for unknown.`,
    text,
  );
  if (!extracted || !extracted.company) return null;

  const lead = await saveAndRouteLead(env, {
    company: extracted.company,
    company_size: extracted.company_size ?? "",
    budget: extracted.budget ?? "",
    timeline: extracted.timeline ?? "",
    phone_number: from,
    notes: extracted.notes ?? "",
    source: "sms-concierge",
  });
  return { lead, isHot: lead.is_hot };
}

// ── HTTP endpoints ──────────────────────────────────────────────────────────

/** POST /api/leads — structured lead submission (microsite form). */
export async function handleLeadSubmit(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const company = String(body.company ?? "").trim();
  const companySize = String(body.company_size ?? "").trim();
  const budget = String(body.budget ?? "").trim();
  const timeline = String(body.timeline ?? "").trim();
  const phone = String(body.phone_number ?? "").trim();

  if (!company || !companySize || !budget || !timeline || !phone) {
    return json(
      { error: "company, company_size, budget, timeline, phone_number are required" },
      400,
    );
  }

  const lead = await saveAndRouteLead(env, {
    company,
    company_size: companySize,
    budget,
    timeline,
    phone_number: phone,
    notes: String(body.notes ?? ""),
    source: "web-form",
  });
  return json(
    { status: "ok", lead_id: lead.id, is_hot: lead.is_hot, routed_to_sales: lead.is_hot },
    201,
  );
}

/** GET /api/leads — exhibitor dashboard view. */
export async function handleLeadList(env: Env): Promise<Response> {
  const leads = await listRecords<Lead>(env.EVENTS, "lead/");
  leads.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return json({ count: leads.length, hot: leads.filter((l) => l.is_hot).length, leads });
}

/** POST /api/attendees — register a phone for schedule-change broadcasts. */
export async function handleAttendeeRegister(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const phone = String(body.phone_number ?? "").trim();
  if (!/^\+\d{8,15}$/.test(phone)) {
    return json({ error: "phone_number must be E.164 (e.g. +15551234567)" }, 400);
  }
  const { upsertAttendee } = await import("../store");
  await upsertAttendee(env.EVENTS, phone, "web-form");

  // Opt-in confirmation (also good 10DLC practice — consent receipt + opt-out).
  const event = await getEvent(env.EVENTS);
  const confirmation = `You're registered for ${event.event.name} updates. Schedule changes will reach you by text message. Msg freq varies. Reply STOP to opt out, HELP for help.`;
  const send = await sendSms(envVars.TELNYX_SMS_FROM, phone, confirmation);

  return json({ ok: true, phone_number: phone, confirmation_sent: send.ok }, 201);
}

/** POST /api/broadcast — schedule change → SMS + WhatsApp to all opted-in attendees. */
export async function handleBroadcast(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const change = String(body.change ?? "").trim();
  const session = String(body.session ?? "").trim();
  if (!change) return json({ error: "change is required" }, 400);

  let message = `📢 Schedule Update: ${change}`;
  if (session) message += ` (Session: ${session})`;

  const phones = await listAttendees(env.EVENTS);
  const results: Array<{ phone: string; sms: string; whatsapp: string }> = [];
  for (const phone of phones) {
    const sms = await sendSms(envVars.TELNYX_SMS_FROM, phone, message);
    const wa = await sendSms(envVars.TELNYX_WHATSAPP_FROM, phone, message);
    results.push({
      phone: `***-***-${phone.slice(-4)}`,
      sms: sms.ok ? "sent" : `failed(${sms.status})`,
      whatsapp: wa.ok ? "sent" : `failed(${wa.status})`,
    });
  }

  return json({
    status: "ok",
    message,
    recipients: phones.length,
    results,
  });
}

// ── Post-event feedback → sponsor report ───────────────────────────────────

/** POST /api/feedback — audio upload (Whisper) or direct transcript. */
export async function handleFeedback(req: Request, env: Env): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  let transcript = "";
  let phone = "anonymous";
  let via = "text";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    phone = String(form.get("phone_number") ?? "anonymous");
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return json({ error: "audio file is required" }, 400);
    }
    if (audio.size > 24 * 1024 * 1024) {
      return json({ error: "audio too large (24MB max)" }, 413);
    }
    transcript = await transcribeAudio(env, audio);
    via = "whisper";
  } else {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    transcript = String(body.transcript ?? "").trim();
    phone = String(body.phone_number ?? "anonymous");
  }

  if (!transcript) return json({ error: "no transcript produced" }, 400);

  const summary = await summarizeTranscript(env, transcript);

  const item = {
    id: id("fb"),
    phone_number: phone === "anonymous" || phone === "browser" ? phone : `***-***-${phone.slice(-4)}`,
    transcript,
    summary,
    created_at: new Date().toISOString(),
  };
  await env.EVENTS.put(`feedback/${item.id}`, JSON.stringify(item));
  return json({ status: "ok", id: item.id, transcript, summary, via }, 201);
}

async function transcribeAudio(env: Env, audio: Blob): Promise<string> {
  const { transcribeAudio } = await import("../telnyx");
  try {
    return await transcribeAudio(audio, "feedback.webm");
  } catch (e) {
    throw new Error(`transcription failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function summarizeTranscript(env: Env, transcript: string): Promise<string> {
  try {
    const { complete } = await import("../telnyx");
    const summary = await complete(
      env,
      [
        {
          role: "system",
          content:
            "You are an event analyst. Summarize this attendee feedback into one concise sentence suitable for a sponsor report. Mention sentiment (positive/mixed/negative).",
        },
        { role: "user", content: transcript },
      ],
      { temperature: 0.3 },
    );
    return summary || "(summarization returned empty)";
  } catch {
    return "(summarization unavailable — transcript stored)";
  }
}

/** GET /api/sponsor-report — aggregate all feedback. */
export async function handleSponsorReport(env: Env): Promise<Response> {
  const items = await listRecords<{
    id: string;
    phone_number: string;
    transcript: string;
    summary: string;
    created_at: string;
  }>(env.EVENTS, "feedback/");
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const event = await getEvent(env.EVENTS);
  return json({
    event: event.event.name,
    generated_at: new Date().toISOString(),
    total_feedback_items: items.length,
    feedback: items.map((f) => ({
      id: f.id,
      phone_number: f.phone_number,
      summary: f.summary,
      created_at: f.created_at,
    })),
  });
}

/** POST /api/email-report — email the sponsor report to the organizer. */
export async function handleEmailReport(env: Env): Promise<Response> {
  const to = process.env.EMAIL_TO ?? "";
  if (!to) return json({ error: "EMAIL_TO env var not configured" }, 400);

  const items = await listRecords<{
    summary: string;
    created_at: string;
  }>(env.EVENTS, "feedback/");
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const event = await getEvent(env.EVENTS);
  const lines = items.map(
    (f, i) => `${i + 1}. [${f.created_at}] ${f.summary}`,
  );
  const leads = await listRecords<Lead>(env.EVENTS, "lead/");
  const hotLeads = leads.filter((l) => l.is_hot);

  const body = [
    `Sponsor report — ${event.event.name}`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Feedback items: ${items.length}`,
    ...lines,
    ``,
    `Leads captured: ${leads.length} (${hotLeads.length} hot)`,
    ...hotLeads.map(
      (l) => `  🔥 ${l.company} (${l.company_size}) — ${l.budget} budget, ${l.timeline}`,
    ),
  ].join("\n");

  const result = await sendEmail(
    envVars.EMAIL_FROM,
    to,
    `Sponsor report — ${event.event.name}`,
    body,
  );
  if (!result.ok) {
    return json(
      { error: `email send failed: HTTP ${result.status}`, detail: result.err },
      502,
    );
  }
  return json({ status: "ok", to, feedback_items: items.length, hot_leads: hotLeads.length });
}
