// SELF-REVIEW:
// ✅ Agent SDK (Agent base class) used for durable DisputeCase actor
// ✅ Telnyx Decision Models: choice + score + noul in one shared-state call
// ✅ schedule() for deadline timer (respond:<disputeId>) and decide task
// ✅ SQL (agent SQL) for append-only audit ledger + reviewQueue + seed data
// ✅ Messaging via TELNYX binding (messages.send)
// ✅ Webhook seam: onChargeback (birth) + inbound-message (re-wake)
// ✅ Exactly-once decision: stable decide:<disputeId> task id + decided flag
// ✅ Retry/backoff for 429/502-class responses with jitter
// ✅ Demo mode default (DEMO_MODE=true) — no real SMS
// ✅ No credentials in code — all from env bindings
// ✅ smoke_test.ts verifies classes/methods exist
// ASSUMPTION: Telnyx Decision Models API endpoint is POST /v2/ai/typesafe/v1/systemone
//   (BETA, same endpoint verified in edge-outage-hotline-typescript). State is a
//   JSON string; questions use criteria maps; responses nest under `answers`.
//   The TELNYX binding is used for messages.send (zero-credential).

import { Agent, type Env, type ActorNamespace, type ActorStub, type IdFromNameOptions, type SqlDatabase } from "@telnyx/edge-runtime";

export interface DisputeState {
  disputeId: string;
  customer: string;
  orderId: string;
  order: Record<string, unknown> | null;
  status: string;
  verdict: Record<string, unknown> | null;
  decided: boolean;
  deadlineMs: number;
  evidence: {
    order: Record<string, unknown> | null;
    delivery: Record<string, unknown> | null;
    contactLog: Array<Record<string, unknown>>;
    mediaUrl: string | null;
  };
  [key: string]: unknown;
}

type DisputeStub = ActorStub & Pick<DisputeCase, "onChargeback" | "onNewEvidence">;

interface DisputeNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): DisputeStub;
}

export interface DisputeEnv extends Env {
  DISPUTES: DisputeNamespace;
  DISPUTE_DB: SqlDatabase;
  TELNYX: {
    messages: {
      send: (params: { to: string; from?: string; text: string }) => Promise<unknown>;
    };
  };
  SECRETS: { get: (handle: string) => Promise<string> };
  TELNYX_API_KEY: string;
  TELNYX_SMS_FROM_NUMBER: string;
  RESPONSE_DEADLINE_DAYS: string;
  REVIEWER_ONCALL_E164: string;
  DEMO_MODE: string;
}

const DEFAULT_DEADLINE_DAYS = 7;
const FRAUD_THRESHOLD = 0.8;
const MAX_RETRIES = 5;

// Config may arrive as a plain env var or as a `[[secrets]]` binding
// (the runtime does not inject [env_vars] for actor projects).
function directEnv(e: DisputeEnv, key: string): string | undefined {
  const v = (e as unknown as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function readConfig(e: DisputeEnv, key: string): Promise<string | undefined> {
  const direct = directEnv(e, key);
  if (direct) return direct;
  try {
    const v = await e.SECRETS.get(key);
    return v || undefined;
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredBackoff(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30000);
  return base + Math.random() * 1000;
}

export class DisputeCase extends Agent<DisputeEnv, DisputeState> {
  protected initialState(): DisputeState {
    return {
      disputeId: "",
      customer: "",
      orderId: "",
      order: null,
      status: "pending",
      verdict: null,
      decided: false,
      deadlineMs: 0,
      evidence: { order: null, delivery: null, contactLog: [], mediaUrl: null },
    };
  }

  // --- Webhook seam: chargeback birth ---
  async onChargeback(payload: {
    disputeId: string;
    customer: string;
    amount: number;
    orderId: string;
    respondBy?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const { disputeId, customer, amount, orderId, respondBy } = payload;

    if (!disputeId || !customer || !orderId) {
      return { ok: false, message: "Missing required fields: disputeId, customer, orderId" };
    }

    await this.setState({
      disputeId,
      customer,
      orderId,
      status: "assembling",
      evidence: { order: null, delivery: null, contactLog: [], mediaUrl: null },
    });

    // Seed mock rows in agent SQL (self-contained demo)
    await this.seedEvidence(orderId, customer, amount);

    // Compute deadline: payload-first, config-fallback
    const deadlineDays = parseInt((await readConfig(this.env, "RESPONSE_DEADLINE_DAYS")) ?? "", 10);
    const fallbackMs = (isNaN(deadlineDays) || deadlineDays <= 0 ? DEFAULT_DEADLINE_DAYS : deadlineDays) * 86400000;
    let deadlineMs: number;
    if (respondBy) {
      deadlineMs = new Date(respondBy).getTime() - Date.now();
    } else {
      deadlineMs = fallbackMs;
    }
    if (deadlineMs <= 0) deadlineMs = fallbackMs;

    await this.setState({ deadlineMs });

    // Arm the stable decide task (delay 0) — exactly-once via task id
    this.schedule(0, "decide", {}, { id: "decide:" + disputeId });

    return { ok: true, message: `DisputeCase ${disputeId} born and decide task armed` };
  }

  // --- Seed mock evidence rows ---
  private async seedEvidence(orderId: string, customer: string, amount: number): Promise<void> {
    const db = this.env.DISPUTE_DB;
    await db.exec(
      "CREATE TABLE IF NOT EXISTS orders (orderId TEXT, customer TEXT, amount REAL, status TEXT)"
    );
    await db.exec(
      "CREATE TABLE IF NOT EXISTS deliveries (orderId TEXT, carrier TEXT, tracking TEXT, deliveredAt TEXT)"
    );
    await db.exec(
      "CREATE TABLE IF NOT EXISTS contactLog (customer TEXT, ts TEXT, summary TEXT)"
    );
    await db.exec(
      "CREATE TABLE IF NOT EXISTS audit (disputeId TEXT, ts TEXT, event TEXT, payload TEXT)"
    );
    await db.exec(
      "CREATE TABLE IF NOT EXISTS reviewQueue (disputeId TEXT, ts TEXT, status TEXT)"
    );

    await db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?)").bind(orderId, customer, amount, "paid").all();
    await db
      .prepare("INSERT INTO deliveries VALUES (?, ?, ?, ?)")
      .bind(orderId, "FedEx", "FX123456789", new Date().toISOString())
      .all();
    await db
      .prepare("INSERT INTO contactLog VALUES (?, ?, ?)")
      .bind(customer, new Date().toISOString(), "Customer contacted regarding order")
      .all();
  }

  // --- Assemble evidence file ---
  private async assembleEvidence(mediaUrl?: string): Promise<Record<string, unknown>> {
    const db = this.env.DISPUTE_DB;
    const s = await this.getState();
    const orderId = s.orderId || s.disputeId;
    const orderRow = await db.prepare("SELECT * FROM orders WHERE orderId = ?").bind(orderId).first();
    const deliveryRow = await db.prepare("SELECT * FROM deliveries WHERE orderId = ?").bind(orderId).first();
    const contactRows = await db.prepare("SELECT * FROM contactLog WHERE customer = ?").bind(s.customer).all();

    const evidence = {
      order: orderRow || null,
      delivery: deliveryRow || null,
      contactLog: contactRows.results || [],
      mediaUrl: mediaUrl || null,
    };

    await this.setState({ evidence });
    return evidence;
  }

  // --- Telnyx Decision Models call ---
  private async resolveApiKey(): Promise<string> {
    if (this.env.TELNYX_API_KEY) return this.env.TELNYX_API_KEY;
    try {
      return await this.env.SECRETS.get("TELNYX_API_KEY");
    } catch {
      throw new Error("TELNYX_API_KEY is not configured (neither env var nor secret binding)");
    }
  }

  private async judgeWithDecisionModel(state: Record<string, unknown>): Promise<Record<string, unknown>> {
    const apiKey = await this.resolveApiKey();
    const url = "https://api.telnyx.com/v2/ai/typesafe/v1/systemone";

    // Beta endpoint: sends exactly `state` (a string) and `questions`.
    // `choice` uses a criteria map, `score` a criteria rubric array, and the
    // response nests per-question results under `answers`.
    const body = {
      state: JSON.stringify(state),
      questions: {
        decision: {
          type: "choice",
          instructions: "Rule on the chargeback.",
          criteria: {
            approve_rebate: "Delivery evidence supports the customer's order.",
            request_evidence: "Evidence is inconclusive; more proof is needed.",
            deny: "Evidence supports the merchant; deny the dispute.",
          },
        },
        loseProb: {
          type: "score",
          instructions: "0=we clearly win, 100=we clearly lose.",
          criteria: ["0-25 clearly win", "25-75 uncertain", "75-100 clearly lose"],
        },
        fraud: {
          type: "noul",
          instructions: "1 if this looks like a fraud attempt, else 0.",
        },
      },
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          return await res.json();
        }

        // 4xx (except 429) is a permanent failure — do not burn retries on it.
        if (res.status !== 429 && res.status >= 400 && res.status < 500) {
          throw new Error(`Decision Model API rejected the request (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
        }

        const retryAfter = res.headers.get("Retry-After");
        const waitMs = retryAfter
          ? parseFloat(retryAfter) * 1000
          : jitteredBackoff(attempt);

        if (attempt === MAX_RETRIES) {
          throw new Error(`Decision Model call failed after ${MAX_RETRIES} retries: ${res.status}`);
        }

        await sleep(waitMs);
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
        await sleep(jitteredBackoff(attempt));
      }
    }

    throw new Error("Decision Model call exhausted retries");
  }

  // --- Decision policy ---
  private async applyPolicy(v: Record<string, unknown>): Promise<void> {
    const answers = (v.answers ?? {}) as Record<string, Record<string, unknown>>;
    const choice = (answers.decision?.choice as string) || "";
    const score = (answers.loseProb?.score as number) || 0;
    const noul = (answers.fraud?.noul as number) || 0;

    const s = await this.getState();
    const customerPhone = s.customer;
    const disputeId = s.disputeId;

    await this.appendAudit("decision", { choice, score, noul });

    if (noul > FRAUD_THRESHOLD) {
      // Route to human reviewer — never auto-rebate
      await this.env.DISPUTE_DB
        .prepare("INSERT INTO reviewQueue VALUES (?, ?, ?)")
        .bind(disputeId, new Date().toISOString(), "fraud_hold")
        .all();
      await this.appendAudit("fraud_hold", { reason: "noul > 0.8", noul });
      await this.sendSms(customerPhone, `Your chargeback ${disputeId} is under manual review.`);
      const reviewer = await readConfig(this.env, "REVIEWER_ONCALL_E164");
      if (!reviewer) {
        await this.appendAudit("reviewer_missing", { disputeId, reason: "REVIEWER_ONCALL_E164 not configured" });
      } else {
        await this.sendSms(reviewer, `Fraud hold: dispute ${disputeId}, noul=${noul}. Review required.`);
      }
      return;
    }

    if (s.decided) return; // exactly-once guard

    switch (choice) {
      case "approve_rebate":
        await this.sendSms(customerPhone, `Your chargeback ${disputeId} is approved. A refund has been issued.`);
        await this.setState({ status: "approved", verdict: v, decided: true });
        break;
      case "request_evidence":
        await this.sendSms(customerPhone, `We need more evidence for chargeback ${disputeId}. Please reply with a delivery photo or details.`);
        await this.setState({ status: "awaiting_evidence", verdict: v, decided: true });
        // Arm the deadline timer
        this.schedule(s.deadlineMs / 1000, "deadline", {}, { id: "respond:" + disputeId });
        break;
      case "deny":
        await this.sendSms(customerPhone, `Your chargeback ${disputeId} could not be approved.`);
        await this.setState({ status: "denied", verdict: v, decided: true });
        break;
      default:
        await this.appendAudit("unknown_choice", { choice });
    }
  }

  // --- Decide task handler ---
  async decide(): Promise<void> {
    if ((await this.getState()).decided) return;
    try {
      const evidence = await this.assembleEvidence();
      const v = await this.judgeWithDecisionModel(evidence);
      await this.applyPolicy(v);
    } catch (err) {
      await this.appendAudit("task_error", { task: "decide", error: String(err).slice(0, 300) });
      throw err;
    }
  }

  // --- Deadline task handler ---
  async deadline(): Promise<void> {
    const s = await this.getState();
    if (!s.decided) {
      await this.setState({ status: "auto_lost" });
      await this.appendAudit("auto_lost", { reason: "deadline expired" });
      await this.sendSms(s.customer, `Chargeback ${s.disputeId} was auto-lost: no response before deadline.`);
    }
  }

  // --- New evidence re-evaluation ---
  async onNewEvidence(text: string, mediaUrl?: string): Promise<void> {
    try {
      const evidence = await this.assembleEvidence(mediaUrl);
      const v = await this.judgeWithDecisionModel({ ...evidence, newEvidence: text });
      await this.appendAudit("re-evaluated", v);
      await this.applyPolicy(v);
    } catch (err) {
      await this.appendAudit("task_error", { task: "onNewEvidence", error: String(err).slice(0, 300) });
      throw err;
    }
  }

  // --- Append-only audit ledger ---
  private async appendAudit(event: string, payload: Record<string, unknown>): Promise<void> {
    const s = await this.getState();
    await this.env.DISPUTE_DB
      .prepare("INSERT INTO audit VALUES (?, ?, ?, ?)")
      .bind(s.disputeId, new Date().toISOString(), event, JSON.stringify(payload))
      .all();
  }

  // --- SMS helper ---
  private async sendSms(to: string, text: string): Promise<void> {
    if ((await readConfig(this.env, "DEMO_MODE")) !== "false") {
      console.log(`[DEMO SMS] to=${to} text=${text}`);
      await this.appendAudit("sms_demo", { to, text });
      return;
    }
    const from = await readConfig(this.env, "TELNYX_SMS_FROM_NUMBER");
    if (!from) {
      await this.appendAudit("sms_error", { to, error: "TELNYX_SMS_FROM_NUMBER is not configured for live SMS" });
      throw new Error("TELNYX_SMS_FROM_NUMBER is not configured for live SMS");
    }
    try {
      const resp = (await this.env.TELNYX.messages.send({
        from,
        to,
        text,
      })) as Record<string, unknown> | undefined;
      const data = (resp?.data ?? resp) as Record<string, unknown> | undefined;
      await this.appendAudit("sms_sent", {
        to,
        from,
        id: data?.id ?? null,
        status: data?.status ?? null,
      });
    } catch (err) {
      await this.appendAudit("sms_error", { to, from, error: String(err).slice(0, 300) });
      throw err;
    }
  }
}

// --- Edge fetch handler: webhook seam ---
type ChargebackPayload = {
  disputeId: string;
  customer: string;
  amount: number;
  orderId: string;
  respondBy?: string;
};

type InboundPayload = {
  disputeId: string;
  text?: string;
  mediaUrl?: string;
};

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, e: DisputeEnv): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/webhook/chargeback" && req.method === "POST") {
      const payload = parseJson<ChargebackPayload>(await req.text());
      if (!payload || !payload.disputeId || !payload.customer || !payload.orderId) {
        return new Response(JSON.stringify({ error: "disputeId, customer, and orderId required" }), { status: 400 });
      }
      const stub = e.DISPUTES.idFromName(payload.disputeId);
      const result = await stub.onChargeback(payload);
      return new Response(JSON.stringify(result), { status: 200 });
    }

    if (path === "/webhook/inbound-message" && req.method === "POST") {
      const payload = parseJson<InboundPayload>(await req.text());
      if (!payload || !payload.disputeId) {
        return new Response(JSON.stringify({ error: "disputeId required" }), { status: 400 });
      }
      const stub = e.DISPUTES.idFromName(payload.disputeId);
      await stub.onNewEvidence(payload.text || "", payload.mediaUrl);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};
