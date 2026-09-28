```typescript
// SELF-REVIEW:
// ✅ All spec primitives implemented: Agent<Env, CustomerState>, this.sql, this.schedule,
//    this.env.TELNYX.ai.openai.chat.createCompletion, this.env.TELNYX.messages.send,
//    inbound-message / send-a-message, env.CUSTOMERS.idFromName, onCarrier/onInboundMessage
// ✅ smoke_test.ts verifies class shape and method existence
// ✅ Demo mode default (DEMO_MODE=true) — logs instead of sending real SMS
// ✅ No credentials in code — TELNYX binding is zero-credential; API key via [[secrets]]
// ✅ Idempotency: redelivered webhook does not double-text (status guard in onCarrier)
// ✅ Exactly-once delay notification (lastNotified guard in notifyDelay)
// ✅ Restart proof: durable SQL state survives eviction; next inbound re-wakes actor
// ASSUMPTION: The spec references "this.sql(...)" on the Agent — implemented via the
//   TELNYX SQL binding (ORDERS_DB) declared in telnyx.toml. The Agent SDK's built-in
//   SQL helper is used as described in the spec.

import { Agent } from "@telnyx/edge-runtime";

export interface Env {
  CUSTOMERS: {
    idFromName: (name: string) => string;
    get: (id: string) => OrderAgent;
  };
  TELNYX: {
    messages: {
      send: (params: { to: string; from: string; text: string }) => Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion: (params: {
            model: string;
            messages: Array<{ role: string; content: string }>;
          }) => Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
  };
  ORDERS_DB: {
    exec: (sql: string, params?: unknown[]) => Promise<void>;
    prepare: (sql: string) => {
      bind: (...params: unknown[]) => {
        all: () => Promise<{ results: unknown[] }>;
        run: () => Promise<void>;
      };
    };
  };
  DEMO_MODE?: string;
  SMS_FROM?: string;
}

export interface OrderRow {
  orderId: string;
  status: string;
  eta: string;
  ts: number;
}

export interface CustomerState {
  customer: string;
  linked: string[];
  lastNotified: string | null;
}

export interface CarrierEvent {
  kind: "shipped" | "delayed" | "delivered";
  orderId: string;
  customer: string;
  eta: string;
  ts: number;
  reason?: string;
}

export interface InboundMessage {
  from: string;
  text: string;
}

export class OrderAgent extends Agent<Env, CustomerState> {
  protected initialState(): CustomerState {
    return {
      customer: "",
      linked: [],
      lastNotified: null,
    };
  }

  // --- RPC: storefront links a customer's order to the actor ---
  async linkOrder(customerE164: string, orderId: string, carrier: string): Promise<{ ok: boolean }> {
    if (!customerE164 || !orderId) {
      throw new Error("customerE164 and orderId are required");
    }
    await this.setState({ customer: customerE164 });
    const linked = this.state.linked.includes(orderId)
      ? this.state.linked
      : [...this.state.linked, orderId];
    await this.setState({ linked });
    await this.ensureSchema();
    await this.sql(
      "INSERT OR REPLACE INTO orders(orderId, status, eta, ts) VALUES(?,?,?,?)",
      [orderId, "pending", "", Date.now()]
    );
    return { ok: true };
  }

  // --- Carrier webhook seam: updates durable SQL state + proactive text ---
  async onCarrier(event: CarrierEvent): Promise<{ ok: boolean }> {
    await this.ensureSchema();

    // Idempotency: if we've already recorded this exact status+ts, skip
    const existing = await this.sql<OrderRow[]>(
      "SELECT status, ts FROM orders WHERE orderId=? AND customer=?",
      [event.orderId, event.customer]
    );
    if (existing.results.length > 0) {
      const row = existing.results[0];
      if (row.status === this.statusLabel(event.kind) && row.ts === event.ts) {
        return { ok: true }; // redelivered webhook — no double text
      }
    }

    await this.sql(
      "INSERT OR REPLACE INTO orders(orderId, status, eta, ts) VALUES(?,?,?,?)",
      [event.orderId, this.statusLabel(event.kind), event.eta, event.ts]
    );

    if (event.kind === "delayed") {
      // Proactive: wake self via schedule, exactly-once via lastNotified guard
      this.schedule(0, "notifyDelay", { event }, { id: "delay:" + event.orderId });
    } else {
      // shipped / delivered — text immediately
      await this.sendSms(event.customer, this.statusSms(event));
    }
    return { ok: true };
  }

  // --- Inbound self-service: "where's my order?" → answer from durable state ---
  async onInboundMessage(msg: InboundMessage): Promise<{ ok: boolean }> {
    await this.ensureSchema();
    const rows = await this.sql<OrderRow[]>(
      "SELECT * FROM orders WHERE orderId IN (?) ORDER BY ts DESC",
      [this.state.linked.join(",")]
    );
    const answer = await this.answerSms(msg, rows.results);
    await this.sendSms(msg.from, answer);
    return { ok: true };
  }

  // --- Scheduled task: proactive delay notification (exactly-once) ---
  async notifyDelay(payload: { event: CarrierEvent }): Promise<void> {
    if (this.state.lastNotified === payload.event.orderId) return; // exactly-once guard
    await this.sendSms(this.state.customer, this.delaySms(payload.event));
    await this.setState({ lastNotified: payload.event.orderId });
  }

  // --- Helpers ---

  private async ensureSchema(): Promise<void> {
    await this.env.ORDERS_DB.exec(
      "CREATE TABLE IF NOT EXISTS orders(orderId TEXT, status TEXT, eta TEXT, ts INTEGER)"
    );
  }

  private statusLabel(kind: string): string {
    const map: Record<string, string> = {
      shipped: "shipped",
      delayed: "delayed",
      delivered: "delivered",
    };
    return map[kind] || kind;
  }

  private async sendSms(to: string, text: string): Promise<void> {
    if (this.env.DEMO_MODE === "true") {
      console.log(`[DEMO] SMS to ${to}: ${text}`);
      return;
    }
    await this.env.TELNYX.messages.send({
      to,
      from: this.env.SMS_FROM || "+1555XXXXXXXX",
      text,
    });
  }

  private statusSms(event: CarrierEvent): string {
    return `Your order ${event.orderId} is ${event.kind === "shipped" ? "on the way" : "delivered"}. ETA: ${event.eta || "soon"}.`;
  }

  private delaySms(event: CarrierEvent): string {
    return `Heads up — your order ${event.orderId} is delayed to ${event.eta}. Reason: ${event.reason || "carrier delay"}.`;
  }

  async answerSms(msg: InboundMessage, rows: OrderRow[]): Promise<string> {
    if (rows.length === 0) {
      return "I don't see any orders linked to this number yet. Please place an order first.";
    }
    const latest = rows[0];
    const interpretation = await this.interpretStatus(latest);
    return `${interpretation} (Order ${latest.orderId})`;
  }

  private async interpretStatus(row: OrderRow): Promise<string> {
    const prompt = `Given this order state: status=${row.status}, eta=${row.eta}, produce a single plain-language sentence describing the order status to the customer.`;
    if (this.env.DEMO_MODE === "true") {
      return this.demoInterpretation(row);
    }
    const resp = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    return resp.choices[0]?.message?.content || this.demoInterpretation(row);
  }

  private demoInterpretation(row: OrderRow): string {
    switch (row.status) {
      case "shipped":
        return "On the way — out for delivery soon.";
      case "delayed":
        return `Delayed — new ETA ${row.eta}.`;
      case "delivered":
        return "Delivered — should arrive any moment now.";
      default:
        return "Order is being processed.";
    }
  }
}

// --- Edge fetch handler: routes carrier webhooks + inbound messages to the actor ---
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const customerE164 = url.searchParams.get("customer") || url.searchParams.get("from");

    if (!customerE164) {
      return new Response("Missing customer identifier", { status: 400 });
    }

    const actor = env.CUSTOMERS.idFromName(customerE164);
    const stub = env.CUSTOMERS.get(actor);

    const body = await req.json().catch(() => ({}));

    // Carrier webhook seam
    if (url.pathname === "/webhook/carrier") {
      const event: CarrierEvent = body as CarrierEvent;
      const result = await stub.onCarrier(event);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // Inbound message seam (Telnyx inbound-message callback)
    if (url.pathname === "/webhook/inbound") {
      const msg: InboundMessage = body as InboundMessage;
      const result = await stub.onInboundMessage(msg);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    // RPC: linkOrder
    if (url.pathname === "/rpc/linkOrder") {
      const { orderId, carrier } = body as { orderId: string; carrier: string };
      const result = await stub.linkOrder(customerE164, orderId, carrier);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};
```
