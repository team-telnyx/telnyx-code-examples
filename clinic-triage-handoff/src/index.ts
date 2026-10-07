// Clinic Triage + Warm Handoff (DEV-1187)
//
// One durable TriageRouterV3 actor per clinic. Flow:
// 1. call.initiated   → answer with the line's Telnyx AI Assistant
//                       (receptionist on the clinic line, billing desk, clinical desk)
//                       with caller history + pending misroute context injected
//                       as dynamic variables
// 2. call.answered    → receptionist greeting + gather_using_ai (one-turn capture)
// 3. call.ai_gather.ended → classify (LLM, keyword fallback) + summarize
//                        → SQL routing record → hold message → dial the caller's
//                          own phone as the specialist desk (a real phone RINGS)
// 4. call.answered (specialist leg) → specialist-persona briefing + "press 1 to accept"
// 5. call.gather.ended (specialist) → 1: conference-bridge caller + specialist
//                                    → else: decline, hang up specialist leg
// 6. call.hangup      → done
// 7. POST /log        → log intent/note from an assistant into the routing log
// 8. POST /misroute   → specialist desk flags a misroute; warm-transfers the
//                       caller to the correct desk and stashes the summary so
//                       the receiving desk sees it as dynamic context
// GET /               → Telnyx-branded status page with the live routing table

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

const INTENT_PROMPT =
  'You are a clinic triage router. Classify the caller\'s intent into exactly one of: "billing", "clinical", or "afterhours". Return ONLY the intent word.';

// ─── Deploy configuration (env-driven, empty defaults) ───────────────────
// On Telnyx Edge, every value below is injected via `telnyx-edge secrets add
// <NAME> <value>` (or via the [env_vars] block in telnyx.toml). Nothing deploy-
// specific is baked into the source — the function fails fast when a required
// constant is missing instead of silently using someone else's phone numbers.

const TELNYX_API = "https://api.telnyx.com/v2";

function envStr(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function parseStringMap(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (typeof val === "string") out[k] = val;
      }
      return out;
    }
  } catch {
    // fall through to {}
  }
  return {};
}

const CC_APP_ID = envStr("CONNECTION_ID");
const WEBHOOK_URL = envStr("WEBHOOK_URL");
const CLINIC_VOICE = envStr("CLINIC_VOICE", "Telnyx_Katie");
const SPECIALIST_VOICE = envStr("SPECIALIST_VOICE", "Telnyx_FLORA");
const STATUS_PAGE_LINE = envStr("STATUS_PAGE_LINE");

// One Telnyx AI Assistant per phone line. Keys are inbound lines (E.164),
// values are Telnyx AI Assistant IDs. The receptionist line uses the native
// transfer tool with warm-transfer acceptance; the desk lines receive
// pre-classified callers and answer with their own persona.
const ASSISTANT_ROUTES: Record<string, string> = parseStringMap(
  envStr("ASSISTANT_ROUTES_JSON")
);

// When a specialist desk flags a misroute, dial the corrected desk's line.
// Keys are the desk's line (E.164), values are the line to dial instead.
const MISROUTE_TARGETS: Record<string, string> = parseStringMap(
  envStr("MISROUTE_TARGETS_JSON")
);

function requireConfig(name: string, value: string): void {
  if (!value) throw new Error(`${name} is not configured (set it via \`telnyx-edge secrets add\`)`);
}

// ─── Telnyx REST helpers (failure logging so nothing fails silently) ──────

function apiKey(): string {
  const key = envStr("TELNYX_API_KEY");
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
async function dialSpecialist(
  from: string,
  to: string,
  clientState: Record<string, unknown>
): Promise<string | null> {
  requireConfig("CONNECTION_ID", CC_APP_ID);
  requireConfig("WEBHOOK_URL", WEBHOOK_URL);
  const res = await fetch(`${TELNYX_API}/calls`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      connection_id: CC_APP_ID,
      from,
      to,
      webhook_url: WEBHOOK_URL,
      client_state: Buffer.from(JSON.stringify(clientState)).toString("base64"),
      command_id: `warm-dial-${Date.now()}`,
    }),
  });
  if (!res.ok) {
    console.log(`[dialSpecialist] HTTP ${res.status} ${await res.text().catch(() => "")}`);
    return null;
  }
  const j = (await res.json()) as { data?: { call_control_id?: string } };
  return j.data?.call_control_id ?? null;
}

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

  async onCall(call: { callControlId: string; from: string; to: string }): Promise<void> {
    this.ensureSchema();
    const dupes = this.ctx.storage.sql
      .exec(`SELECT id FROM routing WHERE call_id = ? LIMIT 1`, call.callControlId)
      .toArray();
    if (dupes.length === 0) {
      this.ctx.storage.sql.exec(
        `INSERT INTO routing (line, caller, call_id, intent, transcript, stage, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        call.to, call.from, call.callControlId, "pending", "", "answered", Date.now()
      );
    }
  }

  async onGatherResult(input: {
    callControlId: string;
    from: string;
    to: string;
    utterance: string;
  }): Promise<{ intent: Intent; summary: string } | null> {
    this.ensureSchema();
    const existing = this.ctx.storage.sql
      .exec<RoutingRow>(`SELECT * FROM routing WHERE call_id = ? AND stage != 'pending' LIMIT 1`, input.callControlId)
      .toArray();
    if (existing.length > 0) return null; // already routed (webhook retry)

    const { intent } = await classifyIntent(this.env.TELNYX, this.env.AI_MODEL ?? "gpt-4o-mini", input.utterance);
    const summary = await this.summarize(input.utterance);
    this.ctx.storage.sql.exec(
      `UPDATE routing SET intent = ?, transcript = ?, stage = 'routed' WHERE call_id = ? AND stage = 'pending'`,
      intent, input.utterance, input.callControlId
    );
    return { intent, summary };
  }

  async markTransferred(callId: string): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `UPDATE routing SET stage = 'transferred' WHERE call_id = ? AND stage != 'transferred'`,
      callId
    );
  }

  async logIntent(input: { caller: string; intent: string; note: string }): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO routing (line, caller, call_id, intent, transcript, stage, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      "assistant-log", input.caller, "n/a", input.intent, input.note, "completed", Date.now()
    );
  }

  async lastIntentFor(caller: string): Promise<string | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec(`SELECT intent FROM routing WHERE caller = ? AND intent != 'pending' ORDER BY ts DESC LIMIT 1`, caller)
      .toArray();
    return rows.length > 0 ? String((rows[0] as Record<string, unknown>).intent ?? "") || null : null;
  }

  async setPendingMisroute(input: { deskLine: string; caller: string; summary: string }): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS misroute_pending (desk_line TEXT PRIMARY KEY, caller TEXT NOT NULL, summary TEXT NOT NULL, ts INTEGER NOT NULL)`,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO misroute_pending (desk_line, caller, summary, ts) VALUES (?, ?, ?, ?)
       ON CONFLICT(desk_line) DO UPDATE SET caller = excluded.caller, summary = excluded.summary, ts = excluded.ts`,
      input.deskLine, input.caller, input.summary, Date.now()
    );
  }

  async pendingMisrouteFor(source: string): Promise<string | null> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec(`SELECT summary FROM misroute_pending WHERE desk_line = ? OR caller = ? LIMIT 1`, source, source)
      .toArray();
    return rows.length > 0 ? String((rows[0] as Record<string, unknown>).summary ?? "") || null : null;
  }

  async clearPendingMisroute(source: string): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(`DELETE FROM misroute_pending WHERE desk_line = ? OR caller = ?`, source, source);
  }

  async routes(): Promise<Array<Record<string, unknown>>> {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec(`SELECT intent, caller, stage, ts FROM routing ORDER BY ts DESC LIMIT 10`)
      .toArray() as Array<Record<string, unknown>>;
  }

  private async summarize(transcript: string): Promise<string> {
    try {
      const res = await this.env.TELNYX.ai.openai.chat.createCompletion({
        model: this.env.AI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: "Summarize this caller's issue in one short sentence." },
          { role: "user", content: transcript },
        ],
        max_tokens: 60,
      });
      return res.choices[0]?.message?.content ?? "No summary available.";
    } catch {
      return transcript.slice(0, 80);
    }
  }
}

export async function classifyIntent(
  telnyx: Env["TELNYX"],
  model: string,
  transcript: string
): Promise<{ intent: Intent; confidence: number }> {
  try {
    const res = await telnyx.ai.openai.chat.createCompletion({
      model,
      messages: [
        { role: "system", content: INTENT_PROMPT },
        { role: "user", content: transcript },
      ],
      max_tokens: 20,
      temperature: 0,
    });
    const raw = (res.choices[0]?.message?.content ?? "").trim().toLowerCase();
    if (raw.includes("billing")) return { intent: "billing", confidence: 0.9 };
    if (raw.includes("clinical")) return { intent: "clinical", confidence: 0.9 };
    if (raw.includes("afterhours") || raw.includes("after hours")) return { intent: "afterhours", confidence: 0.9 };
  } catch {
    // LLM unavailable — keyword fallback below always returns a valid intent
  }
  const lower = transcript.toLowerCase();
  if (lower.includes("billing") || lower.includes("invoice") || lower.includes("charge") || lower.includes("payment"))
    return { intent: "billing", confidence: 0.7 };
  if (
    lower.includes("nurse") || lower.includes("doctor") || lower.includes("medication") ||
    lower.includes("symptom") || lower.includes("prescription") || lower.includes("appointment")
  )
    return { intent: "clinical", confidence: 0.7 };
  return { intent: "afterhours", confidence: 0.5 };
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

    if (req.method === "GET") {
      const seed = STATUS_PAGE_LINE || "clinic-triage-status";
      const sanitizedLine = seed.replace(/[^0-9a-zA-Z]/g, "");
      const router = env.TRIAGE_ROUTER_V3.idFromName(sanitizedLine || "clinic-triage-status");
      const routes = await router.routes();
      return new Response(statusPage(routes), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (req.method === "POST" && url.pathname === "/log") {
      const b = await safeJson<{ caller?: string; intent?: string; note?: string }>(req);
      const q = url.searchParams;
      const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v3");
      await router.logIntent({
        caller: b.caller || q.get("caller") || "",
        intent: b.intent || q.get("intent") || "unknown",
        note: b.note || q.get("note") || "",
      });
      return Response.json({ ok: true, logged: b.intent || q.get("intent") || "unknown" });
    }

    if (req.method === "POST" && url.pathname === "/misroute") {
      const b = await safeJson<{ desk_line?: string; caller?: string; summary?: string; call_control_id?: string }>(req);
      // Identifiers also arrive as dynamic variables in the query string
      const q = url.searchParams;
      const deskLine = b.desk_line || q.get("desk") || "";
      const caller = b.caller || q.get("caller") || "";
      const ccid = b.call_control_id || q.get("ccid") || "";
      const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v3");
      await router.setPendingMisroute({ deskLine, caller, summary: b.summary ?? "" });
      const target = deskLine ? MISROUTE_TARGETS[deskLine] : undefined;
      if (ccid && target) {
        await callAction(ccid, "transfer", { to: target, command_id: `misroute-${Date.now()}` });
      }
      return Response.json({ ok: true, rerouted_to: target ?? null });
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
        // One function, three assistants: each line answers with its own persona
        // (receptionist on the main clinic line, billing desk, clinical desk).
        const assistantId = ASSISTANT_ROUTES[line];
        const fromNumber = (payload.from as string) ?? "";
        const router = env.TRIAGE_ROUTER_V3.idFromName("cliniclog-v3");
        const vars: Record<string, string> = {};
        const history = await router.lastIntentFor(fromNumber);
        if (history) vars.routing_history = history;
        const misroute = await router.pendingMisrouteFor(fromNumber);
        if (misroute) {
          vars.misroute_context = misroute;
          await router.clearPendingMisroute(fromNumber);
        }
        const assistantConfig: Record<string, unknown> = { id: assistantId };
        if (Object.keys(vars).length > 0) assistantConfig.dynamic_variables = vars;
        await callAction(callControlId, "answer", { assistant: assistantConfig });
        return Response.json({
          ok: true, action: "assistant", line, assistant: assistantId ?? null, injected: vars,
        });
      }

      if (eventType === "call.answered") {
        // Specialist leg: deliver the briefing, then wait for the accept/decline DTMF
        if (cs?.role === "next_agent") {
          await callAction(callControlId, "gather_using_speak", {
            payload: `Incoming warm transfer. The caller needs help with a ${String(
              cs.intent ?? "billing"
            )} issue. Briefing: ${String(cs.briefing ?? "no details available")}. Press 1 to accept the call, or 2 to decline.`,
            voice: SPECIALIST_VOICE,
            valid_digits: "12",
            minimum_digits: 1,
            maximum_digits: 1,
            inter_digit_timeout_millis: 8000,
            terminating_digit: "",
          });
          return Response.json({ ok: true, action: "briefing_specialist" });
        }
        // Caller leg: greet + capture in ONE command (no separate flaky speak)
        await callAction(callControlId, "gather_using_ai", {
          greeting:
            "Thanks for calling Riverbend Family Practice. Tell me what you need and I'll connect you with the right specialist.",
          voice: CLINIC_VOICE,
          parameters: {
            type: "object",
            properties: {
              utterance: { type: "string", description: "The caller's spoken need, verbatim." },
            },
            required: ["utterance"],
          },
          assistant: {
            model: env.AI_MODEL ?? "gpt-4o-mini",
            instructions: "One-turn capture. No follow-ups.",
          },
          transcription: { language: "en" },
          user_response_timeout_ms: 15000,
        });
        return Response.json({ ok: true, action: "greeted" });
      }

      if (eventType === "call.ai_gather.ended") {
        const result = (payload.result ?? {}) as Record<string, unknown>;
        const utterance = String(result.utterance ?? "");
        const router = env.TRIAGE_ROUTER_V3.idFromName(line.replace(/[^0-9a-zA-Z]/g, ""));
        const decision = await router.onGatherResult({
          callControlId,
          from: (payload.from as string) ?? "",
          to: line,
          utterance,
        });
        if (!decision) return Response.json({ ok: true, action: "already_routed" });

        // Hold message, then dial the caller's own phone as the specialist desk
        await callAction(callControlId, "speak", {
          payload: "Connecting you with a specialist now. Please hold.",
          voice: CLINIC_VOICE,
          language: "en-US",
        });
        const dialId = await dialSpecialist(line, (payload.from as string) ?? "", {
          role: "next_agent",
          transferId: `w${Date.now()}`,
          callerCcid: callControlId,
          intent: decision.intent,
          briefing: decision.summary,
        });
        if (!dialId) {
          await callAction(callControlId, "speak", {
            payload: "We're having trouble connecting you right now. Please try again shortly.",
            voice: CLINIC_VOICE,
            language: "en-US",
          });
          return Response.json({ error: "warm dial failed" }, { status: 502 });
        }
        await router.markTransferred(callControlId);
        return Response.json({ ok: true, action: "warm_transfer", destination: (payload.from as string) ?? "" });
      }

      if (eventType === "call.gather.ended") {
        // Specialist's DTMF decision
        if (cs?.role === "next_agent") {
          const digits = String(
            (payload.result as Record<string, unknown> | undefined)?.digits ?? payload.digits ?? ""
          );
          if (digits === "1") {
            const conf = `warm-${String(cs.transferId ?? Date.now())}`;
            await callAction(callControlId, "join", {
              name: conf,
              start_conference_on_create: true,
              end_conference_on_exit: true,
            });
            await callAction(String(cs.callerCcid ?? ""), "join", { name: conf });
            return Response.json({ ok: true, action: "warm_accepted", conference: conf });
          }
          await callAction(callControlId, "hangup", {});
          await callAction(String(cs.callerCcid ?? ""), "speak", {
            payload: "The specialist is unavailable right now. Let me find another one for you.",
            voice: CLINIC_VOICE,
            language: "en-US",
          });
          return Response.json({ ok: true, action: "warm_declined" });
        }
        return Response.json({ ok: true, action: "gather_ended" });
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
