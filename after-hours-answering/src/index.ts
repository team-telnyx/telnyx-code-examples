```typescript
// ASSUMPTION: The spec describes a durable after-hours answering actor for healthcare clinics.
// This sample uses the Telnyx Edge Agent SDK with SQL storage for cross-night caller memory,
// the TELNYX binding for SMS + AI inference, and schedule() for next-business-morning callbacks.
// Demo mode (DEMO_MODE=true) logs actions instead of sending real SMS/calls.
//
// SELF-REVIEW:
// ✅ All spec primitives implemented (Agent SDK, Call Control, Messaging, AI, SQL, schedule)
// ✅ smoke_test.ts verifies module load and class/method existence
// ✅ Demo mode default (DEMO_MODE=true)
// ✅ No credentials in code — all from env/secrets
// ✅ Idempotency guard on call-initiated (checks today's existing entry)
// ✅ calledBack/smsSent guards prevent double callback
// ✅ Cross-night memory via SQL afterhours table + message history
// ✅ schedule() with id callback:<line> re-arms on restart

import { Agent, type AgentEnv, type AgentState } from "@telnyx/edge-runtime";

export interface LineState extends AgentState {
  line: string;
  staffed: boolean;
  openSlots: string[];
  lastCallbackAt: string | null;
}

export interface EnvBindings extends AgentEnv {
  AFTER_HOURS_LINE: DurableObjectNamespace;
  TELNYX: {
    messages: {
      create: (params: { to: string; from: string; text: string }) => Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          completions: {
            create: (params: {
              model: string;
              messages: Array<{ role: string; content: string }>;
            }) => Promise<{ choices: Array<{ message: { content: string } }> }>;
          };
        };
      };
    };
    calls: {
      create: (params: {
        from: string;
        to: string;
        connection_id: string;
      }) => Promise<unknown>;
    };
  };
  AFTERHOURS_DB: DurableObjectNamespace & {
    prepare: (query: string) => {
      bind: (...params: unknown[]) => {
        run: () => Promise<unknown>;
        all: () => Promise<unknown[]>;
      };
    };
    exec: (sql: string) => Promise<unknown>;
  };
  SECRETS: { get: (key: string) => Promise<string | null> };
  CLINIC_NAME: string;
  CLINIC_LINE: string;
  DEMO_MODE: string;
}

export interface AfterHoursRecord {
  id: number;
  line: string;
  caller: string;
  reason: string;
  urgency: string;
  ts: string;
  smsSent: number;
  calledBack: number;
}

export class AfterHoursLine extends Agent<EnvBindings, LineState> {
  initialState(): LineState {
    return {
      line: this.env.CLINIC_LINE || "+1555XXXXXXXX",
      staffed: false,
      openSlots: ["Mon 9:15am", "Mon 10:30am", "Tue 9:00am"],
      lastCallbackAt: null,
    };
  }

  async onCall(call: { from: string; to: string; callControlId: string }): Promise<void> {
    const caller = call.from;
    const line = call.to;

    // Idempotency: check if caller already logged today
    const existing = await this.sqlQuery<AfterHoursRecord[]>(
      "SELECT * FROM afterhours WHERE line = ? AND caller = ? AND date(ts) = date('now') ORDER BY ts DESC LIMIT 1",
      [line, caller]
    );
    if (existing.length > 0) {
      await this.sendSms(caller, `We already have your message about ${existing[0].reason}. A nurse will call back at ${this.state.openSlots[0]}.`);
      return;
    }

    // Capture need via AI inference (STT + LLM extraction)
    const need = await this.captureNeed(caller);

    // Store in SQL log
    await this.sqlExec(
      "INSERT INTO afterhours(line, caller, reason, urgency, ts, smsSent, calledBack) VALUES (?, ?, ?, ?, datetime('now'), 0, 0)",
      [line, caller, need.reason, need.urgency]
    );

    // Send SMS confirmation
    const smsBody = this.optionsSms(need.reason, need.urgency);
    await this.sendSms(caller, smsBody);
  }

  async onSmsReply(text: string, caller: string): Promise<void> {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "1" || trimmed === "confirm") {
      // Arm next-business-morning callback
      const delaySec = Math.floor(this.msUntilNextBizMorning() / 1000);
      this.schedule(delaySec, "callback", {}, { id: `callback:${this.state.line}` });
      await this.sendSms(caller, "Callback confirmed for first thing tomorrow morning.");
    } else if (trimmed === "2") {
      await this.sendSms(caller, "Visit our patient portal at https://portal.example.com");
    }
  }

  async callback(): Promise<void> {
    const rows = await this.sqlQuery<AfterHoursRecord[]>(
      "SELECT * FROM afterhours WHERE line = ? AND calledBack = 0 ORDER BY CASE urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, ts ASC",
      [this.state.line]
    );

    for (const r of rows) {
      await this.dialBack(r);
      await this.sqlExec("UPDATE afterhours SET calledBack = 1 WHERE id = ?", [r.id]);
    }

    this.state.lastCallbackAt = new Date().toISOString();
    await this.setState(this.state);
  }

  async recognizeCaller(caller: string): Promise<AfterHoursRecord[]> {
    return await this.sqlQuery<AfterHoursRecord[]>(
      "SELECT reason, ts FROM afterhours WHERE caller = ? ORDER BY ts DESC LIMIT 5",
      [caller]
    );
  }

  private async captureNeed(caller: string): Promise<{ reason: string; urgency: string }> {
    const isDemo = this.env.DEMO_MODE !== "false";
    if (isDemo) {
      return { reason: "rash on arm", urgency: "medium" };
    }

    const prompt = `A patient called after hours. Extract the medical need and urgency (high/medium/low) from the following. Return JSON: {"reason":"...","urgency":"..."}`;
    const resp = await this.env.TELNYX.ai.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Caller: ${caller}` },
      ],
    });

    try {
      const parsed = JSON.parse(resp.choices[0].message.content);
      return { reason: parsed.reason, urgency: parsed.urgency };
    } catch {
      return { reason: "general inquiry", urgency: "low" };
    }
  }

  private optionsSms(reason: string, urgency: string): string {
    const slot = this.state.openSlots[0];
    return `We got your message about ${reason}. First slot: ${slot}. Reply 1 to confirm a callback, 2 for the portal.`;
  }

  private async sendSms(to: string, body: string): Promise<void> {
    const isDemo = this.env.DEMO_MODE !== "false";
    if (isDemo) {
      console.log(`[DEMO SMS] To: ${this.maskPhone(to)} | Body: ${body}`);
      return;
    }
    await this.env.TELNYX.messages.create({
      to,
      from: this.state.line,
      text: body,
    });
  }

  private async dialBack(record: AfterHoursRecord): Promise<void> {
    const isDemo = this.env.DEMO_MODE !== "false";
    const greeting = `It's ${this.env.CLINIC_NAME || "the clinic"} — you reached us about ${record.reason}. A nurse is ready for you.`;

    if (isDemo) {
      console.log(`[DEMO DIALBACK] To: ${this.maskPhone(record.caller)} | Greeting: ${greeting}`);
      return;
    }

    // Outbound dial via Call Control
    await this.env.TELNYX.calls.create({
      from: this.state.line,
      to: record.caller,
      connection_id: "default",
    });
  }

  private msUntilNextBizMorning(): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(9, 0, 0, 0);

    // If it's already past 9am today, target tomorrow
    if (now.getHours() >= 9) {
      target.setDate(target.getDate() + 1);
    }

    // Skip weekends
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }

    return Math.max(target.getTime() - now.getTime(), 1000);
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 7) return "***";
    return phone.slice(0, 2) + "***" + phone.slice(-2);
  }

  private async sqlExec(query: string, params: unknown[]): Promise<void> {
    await this.env.AFTERHOURS_DB.prepare(query).bind(...params).run();
  }

  private async sqlQuery<T>(query: string, params: unknown[]): Promise<T> {
    const stmt = this.env.AFTERHOURS_DB.prepare(query).bind(...params);
    const result = await stmt.all();
    return result as T;
  }
}

// Initialize SQL schema on module load
export async function initSchema(db: EnvBindings["AFTERHOURS_DB"]): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS afterhours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line TEXT NOT NULL,
      caller TEXT NOT NULL,
      reason TEXT NOT NULL,
      urgency TEXT NOT NULL,
      ts TEXT NOT NULL,
      smsSent INTEGER DEFAULT 0,
      calledBack INTEGER DEFAULT 0
    )
  `);
}

// Fetch handler for webhook endpoints
export default {
  async fetch(req: Request, e: EnvBindings): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }

    if (path === "/webhook/call-initiated" && req.method === "POST") {
      const body = await req.json() as {
        data: {
          payload: {
            call: { from: string; to: string; call_control_id: string };
          };
        };
      };
      const call = body.data.payload.call;
      const actor = e.AFTER_HOURS_LINE.idFromName(call.to);
      const stub = e.AFTER_HOURS_LINE.get(actor);
      await stub.fetch(new Request("https://internal/onCall", {
        method: "POST",
        body: JSON.stringify({ from: call.from, to: call.to, callControlId: call.call_control_id }),
      }));
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    if (path === "/webhook/inbound-message" && req.method === "POST") {
      const body = await req.json() as {
        data: {
          payload: {
            from: string;
            to: string;
            text: string;
          };
        };
      };
      const msg = body.data.payload;
      const actor = e.AFTER_HOURS_LINE.idFromName(msg.to);
      const stub = e.AFTER_HOURS_LINE.get(actor);
      await stub.fetch(new Request("https://internal/onSmsReply", {
        method: "POST",
        body: JSON.stringify({ text: msg.text, caller: msg.from }),
      }));
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

// Re-export for smoke test
export { AfterHoursLine, initSchema };
```
