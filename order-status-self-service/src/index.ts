/**
 * OrderAgent — the durable entity IS the customer (DEV-1189).
 *
 * One durable StatefulActor per customer E.164: it owns the customer's
 * order state (per-actor SQL), the SMS conversation memory (Agent MessageLog),
 * and the proactive delay notification (scheduled task + exactly-once guard).
 *
 * Telnyx Edge primitives used (per DEV-1189):
 *  - Agent SDK (Stateful Actors) -> class OrderAgent extends Agent<Env, CustomerState>
 *    addressed via `env.CUSTOMERS.idFromName(customerE164)`; born on the
 *    storefront's `linkOrder` RPC — one durable actor per customer, self-provisioned.
 *  - Per-actor SQL               -> `this.ctx.storage.sql.exec(...)` — durable
 *    `orders(order_id, customer, status, eta, ts)` table that survives evictions.
 *  - Message history             -> `this.messages` (MessageLog) — the SMS thread
 *    persists in the actor, so a follow-up like "will it make it by Friday?"
 *    resolves without re-identification.
 *  - Scheduled tasks             -> `this.schedule(0, "notifyDelay", ...)` with a
 *    stable id — wakes the actor when a carrier reports a delay.
 *  - [telnyx] binding            -> `this.env.TELNYX.messages.send()` (zero-credential
 *    SMS) and `this.env.TELNYX.ai.openai.chat.createCompletion()` (one-line
 *    plain-language interpretation — Telnyx-hosted model, no keys in the sample).
 *
 * Restart/idempotency contract:
 *  - Durable state (SQL rows + agent state + message history) survives worker
 *    eviction — the next inbound message re-wakes the actor with full state.
 *  - A redelivered carrier webhook (same status + ts) is detected and dropped
 *    before any SMS is sent.
 *  - The delay notice is guarded twice: the stable schedule id dedupes the
 *    task itself, and `state.lastNotified` suppresses a second run.
 */

import {
  Agent,
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

// ── Env bindings (resolved from telnyx.toml) ──────────────────────────────

interface Env {
  CUSTOMERS: CustomerNamespace;
  TELNYX: {
    messages: {
      send(req: { from: string; to: string; text: string }): Promise<unknown>;
    };
    ai: {
      openai: {
        chat: {
          createCompletion(req: {
            model: string;
            messages: Array<{ role: string; content: string }>;
            max_tokens?: number;
          }): Promise<{ choices: Array<{ message: { content: string } }> }>;
        };
      };
    };
  };
}

type CustomerStub = ActorStub &
  Pick<OrderAgent, "linkOrder" | "onCarrier" | "onInboundMessage">;

interface CustomerNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): CustomerStub;
}

// ── Config + durable state shape ──────────────────────────────────────────

/** Telnyx-hosted inference model — zero BYOK keys required (spec: no keys in the sample). */
export const DEFAULT_AI_MODEL = "zai-org/GLM-5.2";

/**
 * Opts passed explicitly from the function runtime's process.env — the actor
 * runtime has its own (empty) process.env, so [env_vars] must be passed in,
 * not read inside the agent class.
 */
export interface CallOpts {
  demoMode?: boolean;
  smsFrom?: string;
  aiModel?: string;
}

export interface CustomerState extends Record<string, unknown> {
  /** The customer this actor embodies (E.164). */
  customer: string;
  /** Order ids linked to this customer by the storefront. */
  linked: string[];
  /** orderId of the delay notification already sent — exactly-once guard. */
  lastNotified: string | null;
}

export interface CarrierEvent {
  kind: "shipped" | "delayed" | "delivered";
  orderId: string;
  customer: string;
  eta: string;
  /** Carrier event timestamp — redelivered webhooks carry the same ts. */
  ts: number;
  reason?: string;
}

export interface InboundMessage {
  from: string;
  text: string;
}

export interface OrderRow {
  order_id: string;
  customer: string;
  status: string;
  eta: string;
  ts: number;
  [key: string]: string | number;
}

// ── The agent ─────────────────────────────────────────────────────────────

export class OrderAgent extends Agent<Env, CustomerState> {
  protected initialState(): CustomerState {
    return { customer: "", linked: [], lastNotified: null };
  }

  /**
   * Storefront RPC: link a customer's order to this actor.
   *
   * This is where the actor is born — the fetch handler resolves
   * `env.CUSTOMERS.idFromName(customerE164)` and calls this method, so the
   * durable entity is created on demand and self-provisions its schema.
   */
  async linkOrder(
    customerE164: string,
    orderId: string,
    carrier: string,
  ): Promise<{ ok: boolean; orderId: string; customer: string }> {
    if (!customerE164 || !orderId) {
      throw new Error("customerE164 and orderId are required");
    }
    const state = await this.getState();
    const linked = state.linked.includes(orderId)
      ? state.linked
      : [...state.linked, orderId];
    await this.setState({ customer: customerE164, linked });

    this.ensureTables();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO orders (order_id, customer, status, eta, ts)
       VALUES (?, ?, ?, ?, ?)`,
      orderId,
      customerE164,
      "pending",
      "",
      Date.now(),
    );
    await this.messages.add(
      "system",
      `order ${orderId} linked via ${carrier || "unknown carrier"} — status pending`,
    );
    return { ok: true, orderId, customer: customerE164 };
  }

  /**
   * Carrier webhook seam: update the durable orders SQL, then either text the
   * customer proactively (shipped/delivered) or wake the actor with a scheduled
   * task (delayed → notifyDelay) so the notice reaches them before they ask.
   *
   * Idempotent: a redelivered event (same status + ts) is dropped before any
   * SMS is sent.
   */
  async onCarrier(
    event: CarrierEvent,
    opts?: CallOpts,
  ): Promise<{ ok: boolean; duplicate: boolean }> {
    if (!event?.orderId || !event?.kind) {
      throw new Error("orderId and kind are required");
    }
    this.ensureTables();

    // Idempotency: a redelivered webhook carries the same status + ts.
    const existing = this.ctx.storage.sql
      .exec<{ status: string; ts: number }>(
        "SELECT status, ts FROM orders WHERE order_id = ?",
        event.orderId,
      )
      .toArray()[0];
    if (existing && existing.status === this.statusLabel(event.kind) && existing.ts === event.ts) {
      return { ok: true, duplicate: true }; // no double text
    }

    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO orders (order_id, customer, status, eta, ts)
       VALUES (?, ?, ?, ?, ?)`,
      event.orderId,
      event.customer,
      this.statusLabel(event.kind),
      event.eta,
      event.ts,
    );
    await this.messages.add(
      "system",
      `carrier update: order ${event.orderId} is ${this.statusLabel(event.kind)}${event.eta ? ` (eta ${event.eta})` : ""}${event.reason ? ` — ${event.reason}` : ""}`,
    );

    if (event.kind === "delayed") {
      // Wake the actor: the scheduled task runs even if this invocation ends
      // first. The stable id dedupes replays; notifyDelay guards exactly-once.
      this.schedule(0, "notifyDelay", { event, opts }, { id: `delay:${event.orderId}` });
      return { ok: true, duplicate: false };
    }

    await this.sendSms(event.customer, this.statusSms(event), opts);
    return { ok: true, duplicate: false };
  }

  /**
   * Inbound self-service: the customer texts "where's my order?" — answered
   * from the durable orders SQL plus the persisted thread (MessageLog), so a
   * follow-up like "will it make it by Friday?" needs no re-identification.
   */
  async onInboundMessage(
    msg: InboundMessage,
    opts?: CallOpts,
  ): Promise<{ ok: boolean; answer: string }> {
    if (!msg?.from || !msg?.text) {
      throw new Error("from and text are required");
    }
    const state = await this.getState();
    if (!state.customer) {
      // First contact before any storefront link — self-provision the actor.
      await this.setState({ customer: msg.from });
    }

    this.ensureTables();
    const rows = this.ctx.storage.sql
      .exec<OrderRow>(
        "SELECT * FROM orders WHERE customer = ? ORDER BY ts DESC",
        msg.from,
      )
      .toArray();

    await this.messages.add("user", msg.text);
    const answer = await this.buildAnswer(msg.text, rows, opts);
    await this.messages.add("assistant", answer);
    await this.sendSms(msg.from, answer, opts);
    return { ok: true, answer };
  }

  /**
   * Scheduled task: the proactive delay notification. The actor wakes itself
   * and texts the customer BEFORE they ask. Exactly-once via the `lastNotified`
   * guard on top of the stable schedule id.
   */
  async notifyDelay(payload: {
    event: CarrierEvent;
    opts?: CallOpts;
  }): Promise<{ ok: boolean; skipped?: boolean }> {
    const state = await this.getState();
    if (state.lastNotified === payload.event.orderId) {
      return { ok: true, skipped: true }; // exactly-once
    }
    await this.sendSms(
      payload.event.customer || state.customer,
      this.delaySms(payload.event),
      payload.opts,
    );
    await this.setState({ lastNotified: payload.event.orderId });
    return { ok: true };
  }

  // ── Answer construction ────────────────────────────────────────────────

  /**
   * One-line plain-language answer from durable state + the thread.
   * Live mode: Telnyx-hosted inference over the order rows + message history.
   * Demo mode: deterministic template (no charges, no LLM call).
   */
  async buildAnswer(
    question: string,
    rows: OrderRow[],
    opts?: CallOpts,
  ): Promise<string> {
    if (rows.length === 0) {
      return "I don't see any orders linked to this number yet. Place an order and I'll keep you posted.";
    }
    const demoMode = opts?.demoMode ?? true;
    if (demoMode) {
      return this.demoAnswer(question, rows);
    }
    const model = opts?.aiModel || DEFAULT_AI_MODEL;
    const system = [
      "You are a store's order-status assistant replying over SMS.",
      "Answer the customer's latest question in ONE short sentence (<=160 chars),",
      "in plain language, using only the order state and conversation history below.",
      "Never invent order details that are not in the state.",
      `Order state (newest first): ${JSON.stringify(rows)}`,
    ].join(" ");
    const history = await this.messages.toOpenAI();
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model,
      messages: [{ role: "system", content: system }, ...history],
      max_tokens: 200,
    });
    const content = completion.choices[0]?.message?.content?.trim();
    return content || this.demoAnswer(question, rows);
  }

  /** Deterministic demo interpretation of the latest order row. */
  demoAnswer(question: string, rows: OrderRow[]): string {
    if (rows.length === 0) {
      return "I don't see any orders linked to this number yet. Place an order and I'll keep you posted.";
    }
    const latest = rows[0];
    const q = (question || "").toLowerCase();
    const asksEta =
      /\b(friday|monday|tuesday|wednesday|thursday|saturday|sunday|when|eta|arrive|by \w+day|make it)\b/.test(
        q,
      );
    if (asksEta) {
      return latest.status === "delayed"
        ? `Heads up — order ${latest.order_id} is delayed; new ETA ${latest.eta || "TBD"}.`
        : `Order ${latest.order_id} should arrive by ${latest.eta || "the original ETA"}.`;
    }
    switch (latest.status) {
      case "shipped":
        return `On the way — out for delivery${latest.eta ? `, ETA ${latest.eta}` : ""}. (Order ${latest.order_id})`;
      case "delayed":
        return `Delayed — new ETA ${latest.eta || "TBD"}. (Order ${latest.order_id})`;
      case "delivered":
        return `Delivered${latest.eta ? ` — arrived ${latest.eta}` : ""}. (Order ${latest.order_id})`;
      default:
        return `Order ${latest.order_id} is being processed.`;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  statusLabel(kind: string): string {
    return kind === "shipped" || kind === "delayed" || kind === "delivered"
      ? kind
      : "pending";
  }

  statusSms(event: CarrierEvent): string {
    return event.kind === "delivered"
      ? `Your order ${event.orderId} was delivered. Thanks for shopping with us!`
      : `Your order ${event.orderId} is on the way${event.eta ? ` — out for delivery ${event.eta}` : ""}.`;
  }

  delaySms(event: CarrierEvent): string {
    return `Heads up — your order ${event.orderId} is delayed to ${event.eta || "a later date"}${event.reason ? `: ${event.reason}` : ""}. We're on it.`;
  }

  /** Per-actor durable schema — created on first use, survives eviction. */
  private ensureTables(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS orders (
         order_id TEXT PRIMARY KEY,
         customer TEXT NOT NULL,
         status   TEXT NOT NULL,
         eta      TEXT NOT NULL DEFAULT '',
         ts       INTEGER NOT NULL
       )`,
    );
  }

  private async sendSms(to: string, text: string, opts?: CallOpts): Promise<void> {
    if (!to) throw new Error("missing destination number");
    const demoMode = opts?.demoMode ?? true;
    if (demoMode) {
      console.log(`[demo] SMS to ${to}: ${text}`);
      return;
    }
    if (!opts?.smsFrom) {
      throw new Error("SMS_FROM is required in live mode");
    }
    await this.env.TELNYX.messages.send({ to, from: opts.smsFrom, text });
  }
}

// ── HTTP front door ───────────────────────────────────────────────────────

const PHONE_RE = /^\+?\d{10,15}$/;

/**
 * Sanitize an E.164 phone number for use as an actor name (RFC 1123:
 * lowercase alphanumeric, hyphens, dots — strip the leading "+").
 */
export function actorNameFromPhone(phone: string): string {
  return phone.replace(/^\+/, "").toLowerCase();
}

/**
 * [env_vars] live in the function runtime's process.env — read them here and
 * pass explicitly into the actor; the actor runtime has its own (empty)
 * process.env, so [env_vars] must not be read inside the agent class.
 */
function callOpts(): CallOpts {
  return {
    demoMode: (process.env.DEMO_MODE ?? "true") !== "false",
    smsFrom: process.env.SMS_FROM,
    aiModel: process.env.AI_MODEL,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ status: "ok", agent: "OrderAgent" });
    }
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    // ── Storefront RPC: linkOrder(customerE164, orderId, carrier) ──────
    if (url.pathname === "/rpc/linkOrder") {
      const customer = String(
        body.customer || url.searchParams.get("customer") || "",
      );
      const { orderId, carrier } = body as { orderId?: string; carrier?: string };
      if (!PHONE_RE.test(customer) || !orderId) {
        return json(
          {
            error:
              "customer (E.164 in ?customer= or body) and orderId are required",
          },
          400,
        );
      }
      try {
        const stub = env.CUSTOMERS.idFromName(actorNameFromPhone(customer));
        const result = await stub.linkOrder(customer, orderId, carrier || "");
        return json(result);
      } catch (e) {
        return json({ error: "failed to link order" }, 500);
      }
    }

    // ── Carrier webhook seam: shipped / delayed / delivered ────────────
    if (url.pathname === "/webhook/carrier") {
      const event = body as unknown as CarrierEvent;
      const customer = String(
        event.customer || url.searchParams.get("customer") || "",
      );
      if (!PHONE_RE.test(customer) || !event?.orderId || !event?.kind) {
        return json(
          { error: "customer, orderId and kind (shipped|delayed|delivered) are required" },
          400,
        );
      }
      try {
        const stub = env.CUSTOMERS.idFromName(actorNameFromPhone(customer));
        const result = await stub.onCarrier({ ...event, customer }, callOpts());
        return json(result);
      } catch (e) {
        return json({ error: "failed to process carrier event" }, 500);
      }
    }

    // ── Telnyx inbound-message callback: the customer asks ─────────────
    if (url.pathname === "/webhook/inbound") {
      const data = (body as { data?: { event_type?: string; payload?: Record<string, unknown> } })
        ?.data;
      if (!data || data.event_type !== "message.received") {
        return json({ error: "unexpected event_type" }, 400);
      }
      const payload = data.payload || {};
      const from = String(
        (payload.from as { phone_number?: string })?.phone_number ||
          payload.from ||
          "",
      );
      const text = String(payload.text || "");
      if (!from || !text.trim()) {
        return json({ error: "missing from or text" }, 400);
      }
      try {
        const stub = env.CUSTOMERS.idFromName(actorNameFromPhone(from));
        const result = await stub.onInboundMessage({ from, text }, callOpts());
        return json(result);
      } catch (e) {
        return json({ error: "failed to process inbound message" }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
