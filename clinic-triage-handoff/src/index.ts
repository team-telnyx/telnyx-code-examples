// Clinic Triage, Handoff & Escalation (DEV-1187)
//
// One Edge function. Three AI assistant personas behind three phone lines.
//
// The function owns call identity: every inbound call is recorded in the
// durable routing log (CALLSTART with the caller's call_control_id), so the
// assistants' webhook tools never carry identity themselves — the function
// resolves the current caller whenever a tool fires.
//
// The assistants handle conversation, intent, and warm transfers natively
// (the transfer tool with warm-transfer acceptance — an AI-to-AI consult the
// caller hears as ringback). The log_* webhook tools carry intent in the URL.
//
// The escalation path is deterministic code: the escalate_urgent tool hits
// /escalate, which sends the on-call SMS, dials the nurse live, speaks the
// briefing when she answers, and bridges the patient onto her call.
//
// Endpoints: GET / (status) · GET /escalations (care team) ·
// POST /webhooks/voice · POST /log/{caller}/{intent} · POST /escalate/{caller}

import { Agent } from "@telnyx/edge-runtime";

// ─── Types ───────────────────────────────────────────────────────────────

type Intent = "billing" | "clinical" | "afterhours";

export interface Env {
  TELNYX_API_KEY: string;
  AI_MODEL: string;
}

interface RoutingRow {
  id: number;
  line: string;
  caller: string;
  call_id: string;
  intent: string;
  transcript: string;
  stage: string;
  ts: number;
}


// ─── Deploy constants (v2 film deploy — personal account) ────────────────

const TELNYX_API = "https://api.telnyx.com/v2";
const CC_APP_ID = process.env.CONNECTION_ID ?? "";
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "";
const CLINIC_VOICE = process.env.CLINIC_VOICE ?? "Telnyx_Katie";
const SPECIALIST_VOICE = process.env.SPECIALIST_VOICE ?? "Telnyx_FLORA";
const ONCALL_NUMBER = process.env.ONCALL_NUMBER ?? "";
const SMS_SENDER_FALLBACK = "";

// ─── Telnyx REST helpers (failure logging so nothing fails silently) ──────

function apiKey(): string {
  const key = process.env.TELNYX_API_KEY ?? "";
  if (!key) throw new Error("TELNYX_API_KEY is not configured");
  return key;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" };
}

async function callAction(
  callControlId: string,
  action: string,
  body: Record<string, unknown> = {}
): Promise<boolean> {
  const res = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${action}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok)
    console.log(
      `[callAction] ${action} on ${callControlId} → HTTP ${res.status} ${await res.text().catch(() => "")}`
    );
  return res.ok;
}

function decodeClientState(raw: unknown): Record<string, unknown> | null {
  try {
    if (typeof raw !== "string" || !raw) return null;
    return JSON.parse(Buffer.from(raw, "base64").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Dial a real phone as the warm-transfer specialist desk. Returns the dial leg's ccid. */
// ─── TriageRouterV3: the durable routing brain ──────────────────────────────

export class TriageRouterV3 extends Agent<Env, Record<string, unknown>> {
  private schemaReady = false;

  private ensureSchema(): void {
    if (this.schemaReady) return;
    const sql = this.ctx.storage.sql;
    // Drop legacy routing tables from older deploys (they had a different schema)
    try {
      sql.exec(`SELECT dest FROM routing LIMIT 1`).toArray();
      sql.exec(`DROP TABLE routing`);
      console.log("[schema] dropped legacy routing table");
    } catch {
      // new schema, keep the table
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS routing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line TEXT NOT NULL,
      caller TEXT NOT NULL,
      call_id TEXT NOT NULL,
      intent TEXT NOT NULL,
      transcript TEXT NOT NULL,
      stage TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`);
    this.schemaReady = true;
  }




  async logIntent(input: { caller: string; intent: string; note: string; call_id?: string }): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO routing (line, caller, call_id, intent, transcript, stage, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "assistant-log", input.caller, input.call_id ?? "n/a", input.intent, input.note, "completed", Date.now()
    );
  }

  async lastIntentFor(caller: string): Promise<string | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec(`SELECT intent FROM routing WHERE caller = ? AND intent != 'pending' ORDER BY ts DESC LIMIT 1`, caller)
      .toArray();
    return rows.length > 0 ? String((rows[0] as Record<string, unknown>).intent ?? "") || null : null;
  }






  async routes(): Promise<Array<Record<string, unknown>>> {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(`SELECT intent, caller, call_id, transcript, stage, ts FROM routing ORDER BY ts DESC LIMIT 10`)
      .toArray() as Array<Record<string, unknown>>;
  }

}


// ─── Status page ──────────────────────────────────────────────────────────

function statusPage(routes: Array<Record<string, unknown>>): string {
  const rows = routes
    .map(
      (r) =>
        `<tr><td>${String(r.intent ?? "")}</td><td>${String(r.caller ?? "")}</td><td>${String(r.stage ?? "")}</td><td>${new Date(Number(r.ts ?? 0)).toLocaleTimeString()}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clinic Triage Handoff — Telnyx Edge</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #e7ecf5; margin: 0; padding: 48px 24px; }
  .card { max-width: 860px; margin: 0 auto; background: #131a2b; border: 1px solid #223; border-radius: 16px; padding: 40px; }
  h1 { font-size: 28px; margin: 0 0 8px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #00d46a; margin-right: 8px; }
  .sub { color: #8fa0bd; margin-bottom: 28px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #22304d; }
  th { color: #8fa0bd; text-transform: uppercase; font-size: 11px; letter-spacing: 0.08em; }
  .steps { margin: 28px 0 0; padding-left: 18px; color: #b8c6de; line-height: 1.9; font-size: 14px; }
  a { color: #4f8dff; text-decoration: none; }
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>Clinic Triage Handoff</h1>
  <div class="sub">Telnyx Edge Compute &middot; durable agent &middot; live routing</div>
  <table><thead><tr><th>Intent</th><th>Caller</th><th>Stage</th><th>Time</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="4">No calls routed yet</td></tr>'}</tbody></table>
  <ol class="steps">
    <li>Call the clinic line &mdash; the durable agent answers instantly</li>
    <li>Say <em>&ldquo;I have a question about my bill&rdquo;</em> &rarr; classified as <strong>billing</strong></li>
    <li>Say <em>&ldquo;I need to reschedule my appointment&rdquo;</em> &rarr; classified as <strong>clinical</strong></li>
    <li>The agent dials the specialist&rsquo;s real phone &mdash; it rings</li>
    <li>The specialist hears an AI briefing with the caller&rsquo;s exact context, presses <strong>1</strong> to accept, and the caller is bridged &mdash; no repeat</li>
  </ol>
</div></body></html>`;
}


async function currentCaller(env: Env): Promise<string> {
  const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
  try {
    const rows = await router.routes();
    const start = (rows as Array<Record<string, unknown>>).find(
      (r) => String(r.intent ?? "") === "CALLSTART",
    );
    if (start) return String(start.caller ?? "");
  } catch { /* fall through */ }
  return "";
}

async function safeJson<T>(req: Request): Promise<Partial<T>> {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}

// ─── Webhook entry point ──────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true, service: "clinic-triage-handoff" });
    }

        if (req.method === "GET" && url.pathname === "/escalations") {
      const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
      const rows = await router.routes();
      const esc = rows.filter((r) => String(r.intent ?? "").includes("ESCALATED"));
      const cards = esc
        .map(
          (r) => {
            const note = String(r.transcript ?? "");
            const [summary, ...ctxParts] = note.split(" :: ");
            return `<div class="card"><div class="head"><span class="pulse"></span><b>${String(r.caller ?? "unknown")}</b>
             <span class="time">${new Date(Number(r.ts ?? 0)).toLocaleTimeString()}</span></div>
             <div class="said">&ldquo;${String(summary ?? "").replace(/</g, "&lt;")}&rdquo;</div>
             <div class="ctx">${ctxParts.join(" :: ").replace(/</g, "&lt;").slice(0, 240)}</div></div>`;
          },
        )
        .join("");
      return new Response(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Riverbend Care Team — Escalations</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #e7ecf5; margin: 0; padding: 32px 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; } .sub { color: #8fa0bd; margin-bottom: 24px; font-size: 14px; }
  .card { max-width: 640px; margin: 0 auto 16px; background: #1a1030; border: 1px solid #4a1d6e; border-radius: 14px; padding: 18px 20px; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .pulse { width: 10px; height: 10px; border-radius: 50%; background: #ff3b5c; animation: p 1.2s infinite; }
  @keyframes p { 50% { opacity: .3; } }
  .time { margin-left: auto; color: #8fa0bd; font-size: 12px; }
  .said { font-size: 17px; margin-bottom: 6px; } .ctx { color: #8fa0bd; font-size: 12px; font-family: monospace; }
</style></head><body>
<h1>Care Team — Live Escalations</h1><div class="sub">flagged by the AI front desk · on-call notified by SMS</div>
${cards || '<div class="card"><div class="said">No escalations yet</div></div>'}
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (req.method === "GET") {
      const sanitizedLine = "+16282564664".replace(/[^0-9a-zA-Z]/g, "");
      const router = env.TRIAGE_ROUTER_V3.idFromName(sanitizedLine);
      const routes = await router.routes();
      return new Response(statusPage(routes), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Path-based dynamic-variable routes (query strings are NOT substituted)
    const pathMatch = url.pathname.match(/^\/log\/([^/]+)\/([^/]+)$/);
    if (req.method === "POST" && pathMatch) {
      const pathCaller = decodeURIComponent(pathMatch[1]);
      const intent = decodeURIComponent(pathMatch[2]);
      const caller = pathCaller.includes("{{") || !pathCaller ? await currentCaller(env) : pathCaller;
      const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
      await router.logIntent({ caller: caller || pathCaller, intent, note: "" });
      return Response.json({ ok: true, logged: intent, caller: caller || pathCaller });
    }

    const escMatch = url.pathname.match(/^\/escalate\/([^/]+)$/);
    if (req.method === "POST" && escMatch) {
      const pathCaller = decodeURIComponent(escMatch[1]);
      const caller = pathCaller.includes("{{") || !pathCaller ? await currentCaller(env) : pathCaller;
      const convId = url.searchParams.get("conv") || "";
      let transcript = "";
      let summary = "urgent concern reported";
      if (convId) {
        try {
          const res = await fetch(
            `${TELNYX_API}/ai/conversations/${convId}/messages?page[size]=15`,
            { headers: authHeaders() },
          );
          if (res.ok) {
            const j = (await res.json()) as { data?: Array<{ role?: string; text?: string }> };
            const msgs = (j.data ?? []).slice().reverse().filter((m) => (m.text ?? "").trim());
            transcript = msgs.map((m) => `${m.role === "user" ? "CALLER" : "AGENT"}: ${m.text}`).join(" | ").slice(0, 600);
            const lastUser = msgs.filter((m) => m.role === "user").pop();
            if (lastUser?.text) summary = String(lastUser.text).slice(0, 160);
          }
        } catch {
          // best effort — the escalation still goes out
        }
      }
      const smsText = `🚨 RIVERBEND ESCALATION\nCaller: ${caller || "unknown"}\nSaid: "${summary}"${transcript ? `\nContext: ${transcript.slice(0, 260)}` : ""}\n→ call the caller back now`;
      const smsRes = await fetch(`${TELNYX_API}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ to: ONCALL_NUMBER, from: process.env.SMS_FROM_NUMBER || SMS_SENDER_FALLBACK, text: smsText }),
      });
      const smsOk = smsRes.ok;
      if (!smsOk) console.log(`[escalate] SMS failed: HTTP ${smsRes.status} ${await smsRes.text().catch(() => "")}`);
      // Dial the on-call nurse — when she answers, the call.answered handler bridges her to the patient
      let nurseDial = false;
      try {
        const dialRes = await fetch(`${TELNYX_API}/calls`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            connection_id: CC_APP_ID,
            from: process.env.SMS_FROM_NUMBER || SMS_SENDER_FALLBACK,
            to: ONCALL_NUMBER,
            webhook_url: WEBHOOK_URL,
            command_id: `nurse-dial-${Date.now()}`,
          }),
        });
        nurseDial = dialRes.ok;
        if (!nurseDial) console.log(`[escalate] nurse dial failed: HTTP ${dialRes.status} ${await dialRes.text().catch(() => "")}`);
      } catch (e) {
        console.log(`[escalate] nurse dial error: ${e instanceof Error ? e.message : String(e)}`);
      }
      try {
        const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
        await router.logIntent({ caller: caller || "unknown", intent: "ESCALATED 🚨", note: `${summary} :: ${transcript.slice(0, 400)}` });
      } catch (e) {
        console.log(`[escalate] log failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return Response.json({ ok: true, escalated: true, sms_sent: smsOk });
    }

    if (req.method === "POST" && url.pathname === "/escalate") {
      const q = url.searchParams;
      const caller = q.get("caller") || "";
      const convId = q.get("conv") || "";
      let transcript = "";
      let summary = "urgent concern reported";
      try {
        const res = await fetch(
          `${TELNYX_API}/ai/conversations/${convId}/messages?page[size]=15`,
          { headers: authHeaders() },
        );
        if (res.ok) {
          const j = (await res.json()) as {
            data?: Array<{ role?: string; text?: string }>;
          };
          const msgs = (j.data ?? []).slice().reverse();
          const lines = msgs
            .filter((m) => (m.text ?? "").trim())
            .map((m) => `${m.role === "user" ? "CALLER" : "AGENT"}: ${m.text}`)
            .join(" | ");
          transcript = lines.slice(0, 600);
          const lastUser = msgs.filter((m) => m.role === "user").pop();
          if (lastUser?.text) summary = String(lastUser.text).slice(0, 160);
        }
      } catch {
        // transcript fetch is best-effort — the escalation still goes out
      }
      // Compose + send the on-call SMS
      const smsText = `🚨 RIVERBEND ESCALATION\nCaller: ${caller || "unknown"}\nSaid: "${summary}"\nContext: ${transcript.slice(0, 300)}`;
      const smsRes = await fetch(`${TELNYX_API}/messages`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          to: ONCALL_NUMBER,
          from: SMS_FROM_NUMBER,
          text: smsText,
        }),
      });
      const smsOk = smsRes.ok;
      if (!smsOk) console.log(`[escalate] SMS failed: HTTP ${smsRes.status} ${await smsRes.text().catch(() => "")}`);
      try {
        const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
        await router.logIntent({
          caller: caller || "unknown",
          intent: "ESCALATED 🚨",
          note: `${summary} :: ${transcript.slice(0, 400)}`,
        });
      } catch (e) {
        console.log(`[escalate] log failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return Response.json({ ok: true, escalated: true, sms_sent: smsOk });
    }


    if (req.method === "POST" && url.pathname === "/webhooks/voice") {
      const body = (await req.json()) as {
        data?: { event_type?: string; payload?: Record<string, unknown> };
      };
      const eventType = body.data?.event_type ?? "";
      const payload = body.data?.payload ?? {};
      const callControlId = String(payload.call_control_id ?? "");
      const line = String(payload.to ?? "");
      const cs = decodeClientState(payload.client_state);

      if (eventType === "call.initiated") {
        if ((payload.direction as string) !== "incoming") {
          return Response.json({ action: "ignored_outbound" });
        }
        // One function, three assistants: each line answers with its own persona.
        // assistant_id per clinic line — from env (see .env.example)
        const ASSISTANT_ROUTES: Record<string, string> = JSON.parse(process.env.ASSISTANT_ROUTES_JSON ?? "{}");
        const assistantId = ASSISTANT_ROUTES[line];
        const fromNumber = (payload.from as string) ?? "";
        const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
        // The function owns identity: record who is calling, every call
        try {
          await router.logIntent({ caller: fromNumber, intent: "CALLSTART", note: callControlId, call_id: callControlId });
        } catch { /* identity log is best-effort */ }
        const vars: Record<string, string> = {};
        // Welcome-back history: latest real intent for this caller, filtered in code
        try {
          const rows = await router.routes();
          const mine = (rows as Array<Record<string, unknown>>).filter(
            (r) => String(r.caller ?? "") === fromNumber &&
                   ["billing", "clinical", "afterhours"].includes(String(r.intent ?? "")),
          );
          if (mine.length > 0) vars.routing_history = String(mine[0].intent ?? "");
        } catch { /* history is best-effort */ }
        const assistantConfig: Record<string, unknown> = { id: assistantId };
        if (Object.keys(vars).length > 0) assistantConfig.dynamic_variables = vars;
        await callAction(callControlId, "answer", { assistant: assistantConfig });
        return Response.json({
          ok: true, action: "assistant", line, assistant: assistantId ?? null, injected: vars,
        });
      }

      if (eventType === "call.answered") {
        if (line === ONCALL_NUMBER) {
          const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v4");
          const rows = (await router.routes()) as Array<Record<string, unknown>>;
          const esc = rows.find((r) => String(r.intent ?? "").includes("ESCALATED"));
          const start = rows.find((r) => String(r.intent ?? "") === "CALLSTART");
          const patientCcid = String(start?.call_id ?? "") || String(start?.note ?? "");
          const note = String(esc?.transcript ?? "") || String(start?.transcript ?? "");
          const [summary] = (note || "urgent concern").split(" :: ");
          if (summary) {
            await callAction(callControlId, "speak", {
              payload: `You have an urgent patient on the line: ${summary.slice(0, 140)}. Connecting you now.`,
              voice: CLINIC_VOICE,
              language: "en-US",
            });
          }
          if (patientCcid) {
            await callAction(patientCcid, "transfer", { to: callControlId, command_id: `nurse-bridge-${Date.now()}` });
          }
          return Response.json({ ok: true, action: "nurse_bridged", patient: patientCcid || null });
        }
        return Response.json({ ok: true, action: "assistant_managed" });
      }

      if (eventType === "call.ai_gather.ended") {
        // Plain gather flows no longer exist — assistants own the conversations.
        return Response.json({ ok: true, action: "assistant_managed" });
      }

      if (eventType === "call.gather.ended") {
        return Response.json({ ok: true, action: "assistant_managed" });
      }

      if (eventType === "call.speak.failed") {
        console.log(`[speak.failed] ${JSON.stringify(payload).slice(0, 400)}`);
        return Response.json({ action: "ignored", eventType });
      }

      if (eventType === "call.hangup") {
        return Response.json({ action: "call_closed" });
      }

      return Response.json({ action: "ignored", eventType });
    }

    return new Response("Not found", { status: 404 });
  },
};
