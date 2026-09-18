import type { Env } from "./types";
import { actorNameForPhone, envVarsSnapshot, html, json, maskPhone, normalizePhone } from "./types";
import * as crypto from "node:crypto";
import { getVenue, ASSISTANT_KEY } from "./store";
import {
  availabilitySummary,
  bookSiteVisit,
  ensureSchema,
  funnelStats,
  getAvailability,
  latestInquiryForPhone,
  listInquiries,
  listSiteVisits,
  recordInquiry,
  seedAvailability,
  updateInquiryDetails,
} from "./db";
import { verifyTelnyxSignature } from "./verify";
import { sendEmail, sendSms, upsertAssistant, type AssistantTool } from "./telnyx";
import type { InquiryReport } from "./agent";
import { renderMicrosite } from "./pages/microsite";
import { renderVoicePage } from "./pages/voice";
import { renderOpsPage } from "./pages/ops";

// Re-export the actor class so it ships with the bundle — the runtime
// registers actor types from the entry point's exports.
export { ConciergeAgent } from "./agent";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // ── Health (platform probes) ───────────────────────────────────────
    if (path === "/health" || path.startsWith("/health/")) {
      return new Response("ok");
    }

    // ── Branded venue microsite (server-rendered from KV) ──────────────
    if (path === "/" && req.method === "GET") {
      return html(renderMicrosite(await getVenue(env.VENUE_KV)));
    }
    if (path === "/voice" && req.method === "GET") {
      return html(renderVoicePage(await getVenue(env.VENUE_KV)));
    }
    if (path === "/ops" && req.method === "GET") {
      await ensureSchema(env.AVAILABILITY_DB);
      await seedAvailability(env.AVAILABILITY_DB);
      const [venue, stats, inquiries, visits, availability] = await Promise.all([
        getVenue(env.VENUE_KV),
        funnelStats(env.AVAILABILITY_DB),
        listInquiries(env.AVAILABILITY_DB, 100),
        listSiteVisits(env.AVAILABILITY_DB, 50),
        getAvailability(env.AVAILABILITY_DB, availabilityWindow().start, availabilityWindow().end),
      ]);
      return html(renderOpsPage({
        venueName: venue.venue.name,
        stats,
        inquiries,
        visits,
        availability: availability.slice(0, 14),
      }));
    }

    // ── JSON APIs (read from the same KV + SQLDB as the pages) ─────────
    if (path === "/api/config" && req.method === "GET") {
      const assistantId = await env.VENUE_KV.get(ASSISTANT_KEY);
      const venue = await getVenue(env.VENUE_KV);
      return json({ assistant_id: assistantId ?? "", venue_name: venue.venue.name });
    }
    if (path === "/api/event" && req.method === "GET") {
      return json(await getVenue(env.VENUE_KV));
    }
    if (path === "/api/availability" && req.method === "GET") {
      await ensureSchema(env.AVAILABILITY_DB);
      await seedAvailability(env.AVAILABILITY_DB);
      const start = url.searchParams.get("start") || availabilityWindow().start;
      const end = url.searchParams.get("end") || availabilityWindow().end;
      const days = await getAvailability(env.AVAILABILITY_DB, start, end);
      return json({ start, end, summary: await availabilitySummary(env.AVAILABILITY_DB, start, end), days });
    }
    if (path === "/api/leads" && req.method === "GET") {
      await ensureSchema(env.AVAILABILITY_DB);
      await seedAvailability(env.AVAILABILITY_DB);
      const [stats, inquiries, visits] = await Promise.all([
        funnelStats(env.AVAILABILITY_DB),
        listInquiries(env.AVAILABILITY_DB, 100),
        listSiteVisits(env.AVAILABILITY_DB, 50),
      ]);
      return json({ stats, inquiries, visits });
    }

    // ── Site-visit booking (web form on the microsite) ─────────────────
    if (path === "/api/site-visit" && req.method === "POST") {
      await ensureSchema(env.AVAILABILITY_DB);
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      const phone = normalizePhone(String(body.phone_number ?? ""));
      const email = String(body.email ?? "").trim();
      if (!phone || !email.includes("@")) {
        return json({ error: "phone_number (E.164) and a valid email are required" }, 400);
      }
      const name = String(body.name ?? "").trim();
      const visitDate = String(body.visit_date ?? "").trim() || null;

      const visitId = await bookSiteVisit(env.AVAILABILITY_DB, {
        phone,
        name,
        email,
        visit_date: visitDate,
        status: "booked",
        source: "web-form",
      });
      const venue = await getVenue(env.VENUE_KV);
      await emailVisitConfirmation(env, venue.venue.name, name, email, visitDate);
      await smsVisitConfirmation(phone, name, visitDate, venue.venue.name);

      return json({ ok: true, visit: { id: visitId, visit_date: visitDate, email, name } });
    }

    // ── Actor ingest: the concierge reports inquiries + bookings here ──
    // (the function scope owns the shared SQLDB and all email sends)
    if (path === "/api/leads/ingest" && req.method === "POST") {
      const requiredToken = process.env.INGEST_TOKEN ?? "";
      if (requiredToken && req.headers.get("x-ingest-token") !== requiredToken) {
        return json({ error: "invalid ingest token" }, 401);
      }
      let report: InquiryReport;
      try {
        report = (await req.json()) as InquiryReport;
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      if (!report.phone) return json({ error: "phone is required" }, 400);
      return handleIngest(env, report);
    }

    // ── Browser voice assistant provisioning + webhook tool ────────────
    if (path === "/api/setup-assistant" && req.method === "POST") {
      return handleSetupAssistant(req, env);
    }
    if (path === "/tools/lookup" && req.method === "POST") {
      // Called by the Telnyx assistant platform (signed with Telnyx Ed25519
      // headers automatically). Verify before answering.
      const raw = await req.arrayBuffer();
      const verdict = verifyTelnyxSignature(req.headers, raw);
      if (verdict === 500) return json({ error: "TELNYX_PUBLIC_KEY secret not configured" }, 500);
      if (verdict !== 0) return json({ error: "invalid webhook signature" }, verdict);

      // Schema/seed are ensured on the other endpoints — keep this handler
      // fast (it sits in the assistant's tool-call latency path).
      const { start, end } = availabilityWindow();
      const venue = await getVenue(env.VENUE_KV);
      return json({
        venue,
        availability: await availabilitySummary(env.AVAILABILITY_DB, start, end),
      });
    }

    // ── Inbound SMS webhooks (Telnyx messaging profile) ────────────────
    if (path === "/webhooks/sms" && req.method === "POST") {
      const raw = await req.arrayBuffer();

      // Signature verification is cheap (crypto only) — do it inline.
      const verdict = verifyTelnyxSignature(req.headers, raw);
      if (verdict === 500) return json({ error: "TELNYX_PUBLIC_KEY secret not configured" }, 500);
      if (verdict !== 0) return json({ error: "invalid webhook signature" }, verdict);

      let body: { data?: { event_type?: string; payload?: Record<string, unknown> } };
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      const payload = body.data?.payload;
      if (!payload) return json({ error: "missing data.payload" }, 400);

      // Only handle genuinely inbound messages — outbound receipts would
      // otherwise make the concierge text itself (an infinite loop).
      const eventType = body.data?.event_type ?? "";
      if (eventType && eventType !== "message.received") return new Response("ok");
      const direction = payload.direction as string | undefined;
      if (direction && direction !== "inbound") return new Response("ok");

      const fromPhone = phoneFromPayload(payload.from);
      const text = smsText(payload);
      if (!fromPhone || !text.trim()) return json({ error: "missing from or text" }, 400);
      if (fromPhone === envVarsSnapshot().TELNYX_SMS_FROM) return new Response("ok");

      // Dedupe: Telnyx redelivers webhooks (e.g. when a handler is slow).
      // Lock on the message id so each message is processed exactly once.
      // (KV keys allow only a-z A-Z 0-9 - _ / = . — hex ids are safe.)
      const msgId =
        (typeof payload.id === "string" && payload.id) ||
        crypto.createHash("sha1").update(Buffer.from(raw)).digest("hex");
      const lockKey = `webhook-seen/${msgId}`;
      const seen = await env.VENUE_KV.get(lockKey);
      if (seen) return new Response("ok"); // duplicate delivery — no-op
      await env.VENUE_KV.put(lockKey, "1", { expirationTtl: 600 });

      // Fast-ack: acknowledge instantly, run the concierge pipeline in the
      // background so Telnyx never sees a slow webhook.
      void dispatchToPlanner(env, fromPhone, text, "sms").catch((e: unknown) => {
        console.error("background message processing failed:", e);
      });
      return new Response("ok");
    }

    // ── Call Control webhooks (inbound voice + follow-up call events) ──
    if (path === "/webhooks/voice" && req.method === "POST") {
      const raw = await req.arrayBuffer();
      const verdict = verifyTelnyxSignature(req.headers, raw);
      if (verdict === 500) return json({ error: "TELNYX_PUBLIC_KEY secret not configured" }, 500);
      if (verdict !== 0) return json({ error: "invalid webhook signature" }, verdict);

      let body: { data?: { event_type?: string; payload?: Record<string, unknown> } };
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      const payload = body.data?.payload;
      if (!payload?.call_control_id) return json({ error: "missing call_control_id" }, 400);

      // Route to the planner's actor: outgoing calls belong to `to`,
      // incoming calls belong to `from`.
      const direction = String(payload.direction ?? "incoming");
      const plannerPhone = phoneFromPayload(
        direction === "outgoing" ? payload.to : payload.from,
      );
      const rawResult = payload.result;
      const speech =
        typeof rawResult === "string" ? rawResult : ((rawResult as { result?: string } | null)?.result ?? "");

      const stub = env.CONCIERGE.idFromName(actorNameForPhone(plannerPhone ?? "unknown"));
      // Enrich with venue + availability in function scope (actor workers
      // cannot reach the KV/SQLDB bindings), then hand off.
      void (async () => {
        let venue: Awaited<ReturnType<typeof getVenue>> | undefined;
        let availability: string | undefined;
        try {
          venue = await getVenue(env.VENUE_KV);
          await ensureSchema(env.AVAILABILITY_DB);
          await seedAvailability(env.AVAILABILITY_DB);
          const win = availabilityWindow();
          availability = await availabilitySummary(env.AVAILABILITY_DB, availabilityStart(win.start), win.end);
        } catch (e) {
          console.error("voice enrichment failed:", e instanceof Error ? e.message : e);
        }
        const e = envVarsSnapshot();
        await stub.voiceEvent({
          type: (body.data?.event_type ?? "") as never,
          callControlId: String(payload.call_control_id),
          from: plannerPhone ?? undefined,
          digits: typeof payload.digits === "string" ? payload.digits : undefined,
          speech,
          venue,
          availability,
          origin: process.env.PUBLIC_ORIGIN ?? "",
          demoMode: e.DEMO_MODE,
          smsFrom: e.TELNYX_SMS_FROM,
        });
      })().catch((e: unknown) => console.error("voice event failed:", e));

      // Always 200 fast — Call Control retries slow webhooks.
      return new Response("ok");
    }

    // ── Demo entry: simulate an inbound planner SMS without a real ─────
    //    messaging profile (runs the same actor pipeline end-to-end).
    if (path === "/api/demo/message" && req.method === "POST") {
      let body: { from?: string; text?: string };
      try {
        body = (await req.json()) as { from?: string; text?: string };
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      const phone = normalizePhone(String(body.from ?? ""));
      const text = String(body.text ?? "");
      if (!phone || !text.trim()) return json({ error: "from and text are required" }, 400);
      return dispatchToPlanner(env, phone, text, "sms", req);
    }

    // ── Demo trigger: force the one-week follow-up call now ────────────
    if (path === "/api/demo/followup" && req.method === "POST") {
      let body: { from?: string; force?: boolean };
      try {
        body = (await req.json()) as { from?: string; force?: boolean };
      } catch {
        return json({ error: "invalid json body" }, 400);
      }
      const phone = normalizePhone(String(body.from ?? ""));
      if (!phone) return json({ error: "from is required" }, 400);
      const stub = env.CONCIERGE.idFromName(actorNameForPhone(phone));
      const result = await stub.followUpCall({ force: body.force ?? true });
      return json(result);
    }

    // ── Debug: inspect a planner actor's durable state ──────────────────
    if (path === "/api/debug/state" && req.method === "GET") {
      const phone = normalizePhone(url.searchParams.get("from") ?? "");
      if (!phone) return json({ error: "from query param required" }, 400);
      const stub = env.CONCIERGE.idFromName(actorNameForPhone(phone));
      return json(await stub.getDebugState());
    }

    return json({ error: "not found" }, 404);
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function availabilityWindow(): { start: string; end: string } {
  const start = new Date();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 90);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function phoneFromPayload(from: unknown): string {
  if (typeof from === "string") return from;
  const obj = from as { phone_number?: string } | null;
  return obj?.phone_number ?? "";
}

function smsText(payload: Record<string, unknown>): string {
  const raw = payload.text;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return (raw as { body?: string }).body ?? "";
  return "";
}

async function dispatchToPlanner(
  env: Env,
  phone: string,
  text: string,
  channel: string,
  req?: Request,
): Promise<Response> {
  // Enrichment runs in function scope (KV + SQLDB live here — bindings are
  // not reachable from inside actor workers): venue data, live availability,
  // and the raw inquiry row for the dashboard.
  const venue = await getVenue(env.VENUE_KV);
  let availability = "";
  try {
    await ensureSchema(env.AVAILABILITY_DB);
    await seedAvailability(env.AVAILABILITY_DB);
    const win = availabilityWindow();
    availability = await availabilitySummary(
      env.AVAILABILITY_DB,
      availabilityStart(win.start),
      win.end,
    );
  } catch (e) {
    console.error("availability lookup failed:", e instanceof Error ? e.message : e);
  }
  try {
    await ensureSchema(env.AVAILABILITY_DB);
    await recordInquiry(env.AVAILABILITY_DB, {
      phone,
      name: "",
      email: "",
      event_type: "",
      guests: null,
      budget: "",
      dates: "",
      message: text.slice(0, 500),
      channel,
      qualified: false,
    });
  } catch (e) {
    console.error("inquiry log failed:", e instanceof Error ? e.message : e);
  }

  // The function's own public URL — actors report inquiries/bookings here.
  let origin = process.env.PUBLIC_ORIGIN ?? "";
  if (!origin && req) {
    const host = req.headers.get("host");
    if (host) origin = `${process.env.PUBLIC_PROTO ?? "https"}://${host}`;
  }
  const runtime = actorRuntime(origin);

  const stub = env.CONCIERGE.idFromName(actorNameForPhone(phone));
  const result = await stub.receive({
    phone,
    text,
    channel,
    venue,
    availability,
    origin: runtime.origin,
    demoMode: runtime.demoMode,
    smsFrom: runtime.smsFrom,
  });
  return json({ queued: result.queued, phone });
}

/**
 * Text the booked site visit to the planner — the confirmation channel
 * matches how the conversation happened (SMS concierge → SMS confirm).
 */
async function smsVisitConfirmation(
  phone: string,
  name: string,
  visitDate: string | null,
  venueName: string,
): Promise<void> {
  if (envVarsSnapshot().DEMO_MODE !== "false") {
    console.log(`[DEMO] Would text site-visit confirmation to ${maskPhone(phone)}`);
    return;
  }
  const when = visitDate ? ` for ${visitDate}` : "";
  const text = `You're booked${when}! Your site visit at ${venueName} is confirmed. Reply to this number any time — our concierge can reschedule. See you soon!`;
  try {
    const result = await sendSms(envVarsSnapshot().TELNYX_SMS_FROM, phone, text);
    if (!result.ok) console.error(`visit SMS failed: ${result.status}: ${result.err}`);
  } catch (e) {
    console.error("visit SMS failed:", e instanceof Error ? e.message : e);
  }
}

async function emailVisitConfirmation(
  env: Env,
  venueName: string,
  name: string,
  email: string,
  visitDate: string | null,
): Promise<void> {
  if (envVarsSnapshot().DEMO_MODE !== "false") {
    console.log(`[DEMO] Would email site-visit confirmation to ${email}`);
    return;
  }
  const venue = await getVenue(env.VENUE_KV);
  try {
    await sendEmail(
      envVarsSnapshot().EMAIL_FROM,
      email,
      `Your site visit at ${venueName} is booked`,
      [
        `Hi ${name || "there"},`,
        ``,
        `Your site visit is booked${visitDate ? ` for ${visitDate}` : ""} at ${venueName}, ${venue.venue.location}.`,
        ``,
        `Questions? Reply to this email or text our concierge at ${envVarsSnapshot().TELNYX_SMS_FROM}.`,
        ``,
        `— The ${venueName} Concierge (powered by Telnyx)`,
      ].join("\n"),
    );
  } catch (e) {
    console.error("confirmation email failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Apply an actor report: enrich the planner's latest inquiry row in SQLDB,
 * send the brochure + venue alert on first qualification, and book site
 * visits with an emailed confirmation.
 */
async function handleIngest(env: Env, report: InquiryReport): Promise<Response> {
  await ensureSchema(env.AVAILABILITY_DB);
  await seedAvailability(env.AVAILABILITY_DB);

  if (report.type === "site_visit") {
    const visitId = await bookSiteVisit(env.AVAILABILITY_DB, {
      phone: report.phone,
      name: report.name ?? "",
      email: report.email ?? "",
      visit_date: report.visit_date ?? null,
      status: "booked",
      source: report.source ?? "concierge",
    });
    const venue = await getVenue(env.VENUE_KV);
    if (report.email) {
      await emailVisitConfirmation(env, venue.venue.name, report.name ?? "", report.email, report.visit_date ?? null);
    }
    await smsVisitConfirmation(report.phone, report.name ?? "", report.visit_date ?? null, venue.venue.name);
    return json({ ok: true, visit_id: visitId });
  }

  // inquiry_report: enrich the latest row for this phone.
  const existing = await latestInquiryForPhone(env.AVAILABILITY_DB, report.phone);
  const win = availabilityWindow();
  const patch = {
    name: report.name ?? "",
    email: report.email ?? "",
    event_type: report.event_type ?? "",
    guests: report.guests ?? null,
    budget: report.budget ?? "",
    dates: report.dates ?? "",
  };
  const qualifiedNow = report.qualified ?? false;
  if (existing) {
    await updateInquiryDetails(env.AVAILABILITY_DB, report.phone, {
      ...patch,
      qualified: qualifiedNow ? 1 : 0,
    });
  } else {
    await recordInquiry(env.AVAILABILITY_DB, {
      phone: report.phone,
      name: patch.name,
      email: patch.email,
      event_type: patch.event_type,
      guests: patch.guests,
      budget: patch.budget,
      dates: patch.dates,
      message: report.message ?? "",
      channel: report.channel ?? "unknown",
      qualified: qualifiedNow,
    });
    void win;
  }

  // First qualification → brochure to the planner + alert to the venue inbox.
  const wasQualified = existing?.qualified === 1;
  if (qualifiedNow && !wasQualified && report.email) {
    const venue = await getVenue(env.VENUE_KV);
    if (envVarsSnapshot().DEMO_MODE !== "false") {
      console.log(`[DEMO] Would email brochure to ${maskPhone(report.email)} + alert venue sales inbox`);
    } else {
      const brochure = [
        `Hi ${report.name || "there"},`,
        ``,
        `Thank you for your interest in ${venue.venue.name} — ${venue.venue.tagline}.`,
        `Here's a quick overview:`,
        ``,
        ...venue.spaces.map((s) => `• ${s.name}: seats ${s.seated} dinner / ${s.cocktail} cocktail (${s.sqft} sq ft)`),
        ``,
        `Catering from $${venue.pricing.catering_from}/person. ${venue.pricing.note}`,
        ``,
        `Browse the full gallery, menus, and AV specs on our site, or reply to this email and our sales team will follow up within one business day.`,
        ``,
        `— The ${venue.venue.name} Concierge (powered by Telnyx)`,
      ].join("\n");
      try {
        await sendEmail(envVarsSnapshot().EMAIL_FROM, report.email, `${venue.venue.name} — your venue brochure`, brochure);
      } catch (e) {
        console.error("brochure email failed:", e instanceof Error ? e.message : e);
      }
      if (envVarsSnapshot().EMAIL_TO) {
        const summary = [
          `QUALIFIED LEAD`,
          `Phone: ${maskPhone(report.phone)}`,
          report.name ? `Name: ${report.name}` : "",
          `Email: ${report.email}`,
          report.event_type ? `Event: ${report.event_type}` : "",
          report.guests ? `Guests: ${report.guests}` : "",
          report.budget ? `Budget: ${report.budget}` : "",
          report.dates ? `Dates: ${report.dates}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        try {
          await sendEmail(
            envVarsSnapshot().EMAIL_FROM,
            envVarsSnapshot().EMAIL_TO,
            `New qualified lead: ${report.name || maskPhone(report.phone)}`,
            summary,
          );
        } catch (e) {
          console.error("lead alert email failed:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  return json({ ok: true });
}

function availabilityStart(_start: string): string {
  // The concierge quotes availability from today forward.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Runtime config for actors — env vars do not reach actor scope, so the
 * function passes them with every dispatch.
 */
function actorRuntime(origin: string): { origin: string; demoMode: string; smsFrom: string } {
  const e = envVarsSnapshot();
  return {
    origin,
    demoMode: e.DEMO_MODE,
    smsFrom: e.TELNYX_SMS_FROM,
  };
}

async function handleSetupAssistant(req: Request, env: Env): Promise<Response> {
  // The function is only ever reached over public HTTPS; the internal hop
  // forwards http, so don't trust x-forwarded-proto. Override with
  // PUBLIC_PROTO if serving plain HTTP in dev.
  const proto = process.env.PUBLIC_PROTO ?? "https";
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const origin = `${proto}://${host}`;
  const venue = await getVenue(env.VENUE_KV);
  const toolUrl = `${origin}/tools/lookup`;

  // Static venue facts ride IN the instructions so capacity, catering, AV,
  // parking, accessibility, and pricing answers are instant — no tool
  // round-trip. The tool is reserved for LIVE date availability from SQLDB.
  const facts = [
    `SPACE CAPACITIES (quote exactly):`,
    ...venue.spaces.map((s) => `- ${s.name}: ${s.seated} seated / ${s.cocktail} cocktail, ${s.sqft} sq ft — ${s.features.join(", ")}`),
    ``,
    `MENUS (quote exactly):`,
    ...venue.menus.map((m) => `- ${m.name}: $${m.price_per_person}/person — ${m.description} (${m.items.join(", ")})`),
    ``,
    `AV & PRODUCTION: ${venue.av.join(" | ")}`,
    `PRICING: ${Object.entries(venue.pricing.rental).map(([space, price]) => `${space} ${price}`).join("; ")} — catering from $${venue.pricing.catering_from}/person. ${venue.pricing.note}`,
  ].join("\n");

  const instructions = [
    `You are the sales concierge for ${venue.venue.name} (${venue.venue.location}) — ${venue.venue.tagline}.`,
    `You are on a live voice call. Keep replies SHORT (1-3 sentences), warm, and natural for speech — never read lists aloud; offer to text or email the details.`,
    `Answer capacity, catering, AV, parking, accessibility, and pricing questions INSTANTLY from the facts below — do NOT call any tool for those.`,
    `ONLY call the lookup_venue_info tool when the planner asks about specific DATE AVAILABILITY.`,
    `When a planner shows interest, offer to book a site visit and collect a name, email, and preferred date.`,
    `NEVER leave silence: if a tool fails or you don't know, say so briefly and offer to have the sales team follow up.`,
    ``,
    facts,
  ].join(" ");

  const greeting = `Hi, thanks for calling ${venue.venue.name}! I can check dates, walk you through pricing and menus, and book your site visit — what can I help with?`;

  const tool: AssistantTool = {
    type: "webhook",
    webhook: {
      name: "lookup_venue_info",
      description:
        "Returns LIVE date availability from the venue's booking database. Use ONLY for date-availability questions — capacity, catering, AV, parking, accessibility, and pricing are already in your instructions.",
      url: toolUrl,
      method: "POST",
      body_parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The requested date or date range, e.g. 'first weekend of November'.",
          },
        },
      },
    },
  };

  const assistant = await upsertAssistant("venue-sales-concierge", instructions, greeting, [tool]);
  await env.VENUE_KV.put(ASSISTANT_KEY, assistant.id);
  return json({
    status: "ok",
    assistant_id: assistant.id,
    model: envVarsSnapshot().ASSISTANT_MODEL,
    webhook_tool_url: toolUrl,
    voice_page: `${origin}/voice`,
  });
}
