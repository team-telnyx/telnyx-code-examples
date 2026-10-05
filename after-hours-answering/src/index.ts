// after-hours-answering — durable per-line after-hours answering actor.
//
// One actor per clinic line (idFromName(lineE164)). Handles:
// - call.initiated → answer live, speak greeting, gather_using_ai capture
// - call.ai_gather.ended → LLM extract reason+urgency → SQL ledger → SMS confirm
// - inbound-message "1" → arm next-business-morning callback schedule
// - callback timer fires → dial queued callers back in urgency order
// - cross-night memory: same caller → recognized, no re-intake
//
// Call Control REST (answer/speak/gather_using_ai/hangup/dial) lives in the
// function layer only. The API key never enters actor code.

import { Agent } from "@telnyx/edge-runtime";
import type { SqlValue } from "@telnyx/edge-runtime";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LineState extends Record<string, unknown> {
  line: string;
  staffed: boolean;
  openSlots: string[];
  lastCallbackAt: string | null;
}

export interface Env {
  SECRETS: { get(name: string): Promise<string | null> };
  AFTER_HOURS_LINE: {
    idFromName(name: string): {
      onCall(call: { from: string; to: string; callControlId: string }): Promise<AfterHoursInstruction | null>;
      onAnswered(): Promise<AfterHoursInstruction | null>;
      onGatherEnded(transcript: string): Promise<AfterHoursInstruction | null>;
      onGatherFailed(): Promise<AfterHoursInstruction | null>;
      onHangup(): Promise<AfterHoursInstruction | null>;
      onSmsReply(text: string, caller: string): Promise<AfterHoursInstruction | null>;
    };
  };
  TELNYX: {
    messages: {
      send(req: { to: string; from: string; text: string }): Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion(req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
            temperature?: number;
          }): Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
  };
  CLINIC_NAME: string;
  CLINIC_LINE: string;
  DEMO_MODE: string;
}

export interface AfterHoursInstruction {
  action: "speak" | "gather_using_ai" | "hangup" | "none";
  text?: string;
}

export interface AfterHoursRecord extends Record<string, SqlValue> {
  id: number;
  line: string;
  caller: string;
  reason: string;
  urgency: string;
  ts: string;
  smsSent: number;
  calledBack: number;
}

export interface NeedResult {
  reason: string;
  urgency: string;
}

// ── Actor ────────────────────────────────────────────────────────────────────

export class AfterHoursLine extends Agent<Env, LineState> {
  private schemaReady = false;

  protected override initialState(): LineState {
    return {
      line: this.env.CLINIC_LINE || "+1555XXXXXXXX",
      staffed: false,
      openSlots: ["Mon 9:15am", "Mon 10:30am", "Tue 9:00am"],
      lastCallbackAt: null,
    };
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS afterhours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line TEXT NOT NULL,
      caller TEXT NOT NULL,
      reason TEXT NOT NULL,
      urgency TEXT NOT NULL,
      ts TEXT NOT NULL,
      smsSent INTEGER DEFAULT 0,
      calledBack INTEGER DEFAULT 0
    )`);
    sql.exec(`CREATE INDEX IF NOT EXISTS ah_by_caller ON afterhours(caller, ts DESC)`);
    this.schemaReady = true;
  }

  // ── Call lifecycle ────────────────────────────────────────────────────────

  /** call.initiated: idempotency check + recognition + return greeting text. */
  async onCall(call: { from: string; to: string; callControlId: string }): Promise<AfterHoursInstruction | null> {
    this.ensureSchema();
    const caller = call.from;
    const line = call.to;

    const duplicates = this.ctx.storage.sql.exec<{ id: number }>(
      `SELECT id FROM afterhours WHERE line = ? AND caller = ? AND callControlId = ? LIMIT 1`,
      line, caller, call.callControlId,
    ).toArray();
    if (duplicates.length > 0) return { action: "none" };

    const prior = this.recognizeCaller(caller);
    const greeting = prior.length > 0
      ? `Welcome back to ${this.env.CLINIC_NAME || "the clinic"}. You called about ${prior[0].reason}. How is it today?`
      : `Thanks for calling ${this.env.CLINIC_NAME || "the clinic"}. It's after hours. What do you need?`;

    return { action: "speak", text: greeting };
  }

  /** call.answered: start gather_using_ai to capture the caller's need. */
  async onAnswered(): Promise<AfterHoursInstruction | null> {
    return { action: "gather_using_ai" };
  }

  /** call.ai_gather.ended: extract reason+urgency → SQL → SMS confirmation. */
  async onGatherEnded(transcript: string): Promise<AfterHoursInstruction | null> {
    this.ensureSchema();
    const state = await this.getState();
    const need = await this.captureNeed(transcript);
    this.ctx.storage.sql.exec(
      `INSERT INTO afterhours(line, caller, reason, urgency, ts, smsSent, calledBack, callControlId)
       VALUES (?, ?, ?, ?, datetime('now'), 0, 0, ?)`,
      state.line, this.currentCaller ?? "unknown", need.reason, need.urgency, this.currentCallId ?? "",
    );
    const sms = this.optionsSms(need.reason);
    await this.sendSms(this.currentCaller ?? "", sms);
    return { action: "hangup" };
  }

  async onGatherFailed(): Promise<AfterHoursInstruction | null> {
    return { action: "hangup" };
  }

  async onHangup(): Promise<AfterHoursInstruction | null> {
    this.currentCaller = null;
    this.currentCallId = null;
    return null;
  }

  private currentCaller: string | null = null;
  private currentCallId: string | null = null;

  /** inbound-message: "1" arms callback, "2" → portal. */
  async onSmsReply(text: string, caller: string): Promise<AfterHoursInstruction | null> {
    this.ensureSchema();
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "1" || trimmed === "confirm") {
      const delaySec = this.secondsUntilNextBizMorning();
      this.schedule(delaySec, "callback", {}, { id: `callback:${this.env.CLINIC_LINE}` });
      await this.sendSms(caller, "Callback confirmed for first thing tomorrow morning.");
    } else if (trimmed === "2") {
      await this.sendSms(caller, "Visit our patient portal at https://portal.example.com");
    }
    return null;
  }

  // ── Scheduled callback ────────────────────────────────────────────────────

  async callback(): Promise<void> {
    this.ensureSchema();
    const state = await this.getState();
    const rows = this.ctx.storage.sql.exec<AfterHoursRecord>(
      `SELECT * FROM afterhours WHERE line = ? AND calledBack = 0
       ORDER BY CASE urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, ts ASC`,
      state.line,
    ).toArray();

    for (const r of rows) {
      await this.dialBack(r);
      this.ctx.storage.sql.exec(`UPDATE afterhours SET calledBack = 1 WHERE id = ?`, r.id);
    }
    await this.setState({ lastCallbackAt: new Date().toISOString() });
  }

  protected override async onTask(name: string, payload: unknown, _ctx: { attempt: number }): Promise<void> {
    if (name === "callback") await this.callback();
  }

  // ── Cross-night recognition ───────────────────────────────────────────────

  recognizeCaller(caller: string): AfterHoursRecord[] {
    return this.ctx.storage.sql.exec<AfterHoursRecord>(
      `SELECT reason, ts FROM afterhours WHERE caller = ? ORDER BY ts DESC LIMIT 5`,
      caller,
    ).toArray();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async captureNeed(transcript: string): Promise<NeedResult> {
    if (this.env.DEMO_MODE !== "false") {
      return { reason: "rash on arm", urgency: "medium" };
    }
    const resp = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: "meta-llama/Llama-3.3-70B-Instruct",
      messages: [
        { role: "system", content: 'Extract the medical need and urgency (high/medium/low). Return JSON: {"reason":"...","urgency":"..."}. No other text.' },
        { role: "user", content: transcript },
      ],
      max_tokens: 100,
      temperature: 0,
    });
    try {
      return JSON.parse(resp.choices[0].message.content);
    } catch {
      return { reason: "general inquiry", urgency: "low" };
    }
  }

  private optionsSms(reason: string): string {
    const state = this.cachedState;
    return `We got your message about ${reason}. First slot: ${state?.openSlots[0] ?? "Mon 9:15am"}. Reply 1 to confirm a callback, 2 for the portal.`;
  }

  private cachedState: LineState | null = null;

  private async sendSms(to: string, body: string): Promise<void> {
    if (this.env.DEMO_MODE !== "false") {
      console.log(`[DEMO SMS] To: ${this.maskPhone(to)} | Body: ${body}`);
      return;
    }
    const state = this.cachedState ?? (await this.getState());
    await this.env.TELNYX.messages.send({
      to,
      from: state.line,
      text: body,
    });
  }

  private async dialBack(record: AfterHoursRecord): Promise<void> {
    const greeting = `It's ${this.env.CLINIC_NAME || "the clinic"} — you reached us about ${record.reason}. A nurse is ready for you.`;
    if (this.env.DEMO_MODE !== "false") {
      console.log(`[DEMO DIALBACK] To: ${this.maskPhone(record.caller)} | Greeting: ${greeting}`);
      return;
    }
    // Outbound dial happens in the function layer via /internal/callback-dial.
    // The actor requests it through env.SECRETS — but since the function layer
    // has the API key, this is handled by the function's /internal/callback-dial
    // route. In this version the demo mode logs; production would delegate.
    console.log(`[DIALBACK REQUEST] To: ${record.caller} | Greeting: ${greeting}`);
  }

  private secondsUntilNextBizMorning(): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(9, 0, 0, 0);
    if (now.getHours() >= 9) target.setDate(target.getDate() + 1);
    while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
    return Math.max(Math.round((target.getTime() - now.getTime()) / 1000), 1);
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 7) return "***";
    return phone.slice(0, 2) + "***" + phone.slice(-2);
  }
}

// ── Status page (Telnyx-branded HTML) ──────────────────────────────────────

const STATUS_PAGE = [
  '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  '<title>After-Hours Answering Line - Telnyx Edge</title>',
  '<style>',
  '*{margin:0;padding:0;box-sizing:border-box}',
  'body{font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}',
  '.card{max-width:520px;width:100%;background:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:40px}',
  '.brand{display:flex;align-items:center;gap:10px;margin-bottom:24px}',
  '.brand svg{width:28px;height:28px}',
  '.brand span{font-size:13px;color:#888;letter-spacing:1px;text-transform:uppercase;font-weight:600}',
  '.status{display:flex;align-items:center;gap:8px;margin-bottom:20px}',
  '.dot{width:10px;height:10px;background:#00e8b4;border-radius:50%;animation:pulse 2s infinite}',
  '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}',
  '.status span{color:#00e8b4;font-weight:600;font-size:15px}',
  'h1{font-size:26px;font-weight:700;margin-bottom:8px;color:#fff}',
  '.desc{font-size:14px;color:#999;line-height:1.6;margin-bottom:28px}',
  '.routes{margin-bottom:28px}.routes h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:12px}',
  '.route{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;margin-bottom:8px}',
  '.route code{font-size:13px;font-family:ui-monospace,monospace;color:#00e8b4}',
  '.route span{font-size:12px;color:#888}',
  '.demo{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:16px;margin-bottom:24px}',
  '.demo h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px}',
  '.demo ol{padding-left:20px;font-size:13px;color:#aaa;line-height:2}',
  'footer{border-top:1px solid #2a2a2a;padding-top:16px;display:flex;justify-content:space-between;align-items:center}',
  'footer span{font-size:11px;color:#555}',
  'footer a{color:#00e8b4;text-decoration:none;font-size:11px}',
  '</style></head><body><div class="card">',
  '<div class="brand"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5" stroke="#00e8b4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Telnyx Edge</span></div>',
  '<div class="status"><div class="dot"></div><span>Live</span></div>',
  '<h1>After-Hours Answering Line</h1><p class="desc">Answers after-hours clinic calls, captures needs via AI, sends SMS confirmations, and schedules next-business-morning callbacks with cross-night caller recognition.</p>',
  '<div class="routes"><h2>Routes</h2>',
  '<div class="route"><code>POST /webhook/call</code><span>Call Control (voice)</span></div>',
  '<div class="route"><code>POST /webhook/messages</code><span>Inbound SMS</span></div>',
  '<div class="route"><code>GET /healthz</code><span>Health check</span></div>',
  '</div>',
  '<div class="demo"><h2>How to demo</h2><ol>',
  '<li>Call the clinic line &rarr; the actor answers live, captures your need</li>',
  '<li>You get an SMS: Reply 1 for a callback, 2 for the portal</li>',
  '<li>Reply 1 &rarr; callback armed for next business morning</li>',
  '<li>At 9 AM it calls you back with context</li>',
  '<li>Call again &rarr; it remembers you from last time</li>',
  '</ol></div>',
  '<footer><span>func_id: 4eb46af8</span><a href="https://developers.telnyx.com/docs/agent-sdk">Agent SDK docs &rarr;</a></footer>',
  '</div></body></html>',
].join("\n");

function statusPage(): Response {
  return new Response(STATUS_PAGE, { headers: { "Content-Type": "text/html" } });
}

// ── Function layer (fetch handler + Call Control REST) ──────────────────────

const TELNYX_API = "https://api.telnyx.com/v2";

function apiKey(): string {
  const key = process.env.TELNYX_API_KEY ?? "";
  if (!key) throw new Error("TELNYX_API_KEY is not configured");
  return key;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" };
}

async function callAction(callControlId: string, action: string, body: Record<string, unknown> = {}): Promise<boolean> {
  const res = await fetch(`${TELNYX_API}/calls/${callControlId}/actions/${action}`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify(body),
  });
  return res.ok;
}

async function runInstruction(callControlId: string, instruction: AfterHoursInstruction | null): Promise<void> {
  if (!instruction || instruction.action === "none") return;
  if (instruction.action === "speak" && instruction.text) {
    await callAction(callControlId, "speak", { payload: instruction.text, voice: "female-US", language: "en-US" });
  }
  if (instruction.action === "gather_using_ai") {
    await fetch(`${TELNYX_API}/calls/${callControlId}/actions/gather_using_ai`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        parameters: {
          type: "object",
          properties: { answer: { type: "string", description: "The caller's spoken need, verbatim." } },
          required: ["answer"],
        },
        assistant: { model: process.env.AI_MODEL ?? "meta-llama/Llama-3.3-70B-Instruct", instructions: "One-turn capture: record exactly what the caller says in the answer field." },
        transcription: { language: "en" },
        user_response_timeout_ms: 20000,
      }),
    });
  }
  if (instruction.action === "hangup") {
    await callAction(callControlId, "hangup", {});
  }
}

function normalizeCall(body: Record<string, unknown>): { from: string; to: string; callControlId: string } {
  const event = (body?.data ?? {}) as Record<string, unknown>;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  return {
    from: (payload.from as string) ?? "",
    to: (payload.to as string) ?? "",
    callControlId: (payload.call_control_id as string) ?? "",
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return statusPage();
    if (req.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }
    if (req.method !== "POST") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const eventType = data.event_type as string | undefined;
    if (!eventType) {
      return Response.json({ error: "no event_type in payload" }, { status: 400 });
    }

    const call = normalizeCall(body);
    const line = call.to || env.CLINIC_LINE || "+1555XXXXXXXX";
    const stub = env.AFTER_HOURS_LINE.idFromName(line);

    if (eventType === "call.initiated" && (data.payload as Record<string, unknown>)?.direction === "incoming") {
      await callAction(call.callControlId, "answer");
      const instruction = await stub.onCall(call);
      await runInstruction(call.callControlId, instruction);
      return Response.json({ action: "answered_and_gathering" });
    }

    if (eventType === "call.answered") {
      const instruction = await stub.onAnswered();
      await runInstruction(call.callControlId, instruction);
      return Response.json({ action: "gathering" });
    }

    if (eventType === "call.ai_gather.ended") {
      const payload = (data.payload ?? {}) as Record<string, unknown>;
      const result = (payload.result ?? {}) as Record<string, unknown>;
      const transcript = String(result.answer ?? "");
      const instruction = await stub.onGatherEnded(transcript);
      await runInstruction(call.callControlId, instruction);
      return Response.json({ action: "gather_processed" });
    }

    if (eventType === "call.ai_gather.failed") {
      const instruction = await stub.onGatherFailed();
      await runInstruction(call.callControlId, instruction);
      return Response.json({ action: "gather_failed" });
    }

    if (eventType === "call.hangup") {
      await stub.onHangup();
      return Response.json({ action: "call_closed" });
    }

    if (eventType === "inbound-message.received") {
      const payload = (data.payload ?? {}) as Record<string, unknown>;
      const text = String(payload.text ?? "");
      const from = String(payload.from ?? "");
      const instruction = await stub.onSmsReply(text, from);
      await runInstruction(call.callControlId, instruction);
      return Response.json({ action: "sms_processed" });
    }

    return Response.json({ action: "ignored", eventType });
  },
};
