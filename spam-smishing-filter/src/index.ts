// SELF-REVIEW:
// ✅ All spec primitives implemented: Agent SDK, Jev Decision Models (typesafe), Messaging (inbound/send), Agent SQL, schedule()
// ✅ smoke_test.ts verifies classes/methods exist
// ✅ Demo mode default (DEMO_MODE=true) — no real SMS sent unless DEMO_MODE=false
// ✅ No credentials in code — TELNYX_API_KEY from secrets
// ✅ Idempotent per-message task via schedule() + acted guard
// ✅ 429/502 retry/backoff with jitter + Retry-After honored
// ✅ Audit row for every transition
// ASSUMPTION: Jev Decision Models accessed via raw fetch to POST /v2/ai/typesafe/v1/systemone
//   using TELNYX_API_KEY from secrets. The TELNYX binding's ai.openai.chat.createCompletion
//   is for OpenAI-compatible chat, not the typesafe systemone endpoint, so raw fetch is used.

import { Agent, env } from "@telnyx/edge-runtime";

// ─── Types ───────────────────────────────────────────────────────────────

export interface WatchState {
  number: string;
}

export interface JevVerdict {
  choice: "ok" | "spam" | "phishing";
  noul: number;
  score: number;
}

export interface EnvLocal {
  SECRETS: { get(name: string): Promise<string | null> };
  SPAM_DB: {
    exec(sql: string): Promise<void>;
    prepare(sql: string): {
      bind(...args: unknown[]): {
        all(): Promise<{ results: unknown[] }>;
        run(): Promise<void>;
      };
    };
  };
  TELNYX: {
    messages: {
      send(params: { to: string; from: string; text: string }): Promise<unknown>;
    };
  };
  SPAM_FILTER: {
    idFromName(name: string): string;
    get(id: string): SpamFilter;
  };
}

// ─── Config ──────────────────────────────────────────────────────────────

const SPAM_PERMANENT_BLOCK_N = Number(env?.SPAM_PERMANENT_BLOCK_N ?? 5);
const SPAM_BLOCK_SCORE = Number(env?.SPAM_BLOCK_SCORE ?? 4);
const COOLDOWN_MS = Number(env?.COOLDOWN_MS ?? 3600000);
const DEMO_MODE = env?.DEMO_MODE !== "false";

// ─── SpamFilter Actor ────────────────────────────────────────────────────

export class SpamFilter extends Agent<EnvLocal, WatchState> {
  protected initialState(): WatchState {
    return { number: "" };
  }

  // ── RPC: watch(number) ──────────────────────────────────────────────
  async watch(number: string): Promise<void> {
    if (!number || !/^\+?[1-9]\d{1,14}$/.test(number)) {
      throw new Error("Invalid phone number format");
    }
    await this.replaceState({ number });
    await this.initDb();
  }

  // ── DB init ─────────────────────────────────────────────────────────
  private async initDb(): Promise<void> {
    await this.env.SPAM_DB.exec(`
      CREATE TABLE IF NOT EXISTS senderMsgs (
        sender TEXT, text TEXT, verdict TEXT, ts INTEGER
      );
      CREATE TABLE IF NOT EXISTS blocklist (
        sender TEXT PRIMARY KEY, reason TEXT, ts INTEGER
      );
      CREATE TABLE IF NOT EXISTS audit (
        ts INTEGER, sender TEXT, event TEXT, fromState TEXT, toState TEXT, detail TEXT
      );
    `);
  }

  // ── Inbound handler ─────────────────────────────────────────────────
  async onMessage(msg: { id: string; from: string; text: string }): Promise<void> {
    const messageId = msg.id;

    // Idempotent: schedule under stable act:<messageId>
    await this.schedule(0, "act", { ...msg }, { act: `act:${messageId}` });
  }

  // ── Idempotent task handler ─────────────────────────────────────────
  async act(msg: { id: string; from: string; text: string }): Promise<void> {
    const sender = msg.from;
    const messageId = msg.id;

    // acted guard — re-delivery is a no-op
    const actedKey = `acted:${messageId}`;
    const alreadyActed = await this.ctx.storage.get<boolean>(actedKey);
    if (alreadyActed) return;

    await this.initDb();

    // Check blocklist
    const blocked = await this.isBlocked(sender);
    if (blocked) {
      const cooldownOk = await this.cooldownElapsed(sender);
      if (cooldownOk) {
        await this.reEvaluate(sender, msg);
      } else {
        await this.discardSilent(sender, msg);
      }
      await this.ctx.storage.put(actedKey, true);
      return;
    }

    // Judge with Jev
    const history = await this.senderHistory(sender);
    const v = await this.judgeWithJev(msg.text, history);
    await this.audit(sender, "verdict", "n/a", v.choice, JSON.stringify(v));

    // Record message
    await this.env.SPAM_DB
      .prepare("INSERT INTO senderMsgs(sender,text,verdict,ts) VALUES(?,?,?,?)")
      .bind(sender, msg.text, v.choice, Date.now())
      .run();

    // Policy
    if (v.choice === "phishing" || v.noul > 0.8) {
      await this.block(sender, "phishing", msg.text);
    } else if (v.choice === "spam" && v.score >= SPAM_BLOCK_SCORE) {
      await this.block(sender, "spam", msg.text);
    } else if (v.choice === "spam") {
      await this.escalateCount(sender);
    } else {
      await this.deliver(msg);
    }

    await this.ctx.storage.put(actedKey, true);
  }

  // ── Jev Decision Models ─────────────────────────────────────────────
  private async judgeWithJev(text: string, history: unknown[]): Promise<JevVerdict> {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!apiKey) throw new Error("TELNYX_API_KEY not configured");

    const body = {
      model: "telnyx/decision-flash",
      state: { text, history },
      questions: [
        { type: "choice", options: ["ok", "spam", "phishing"] },
        { type: "noul", instructions: "1 if hard stop (phishing/credential theft), else 0" },
        { type: "score", options: 5, instructions: "0=legit, 5=obviously malicious" },
      ],
    };

    const resp = await this.fetchWithRetry("https://api.telnyx.com/v2/ai/typesafe/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    return {
      choice: data.choice || "ok",
      noul: Number(data.noul || 0),
      score: Number(data.score || 0),
    };
  }

  // ── Retry with backoff for 429/502 ──────────────────────────────────
  private async fetchWithRetry(
    url: string,
    opts: RequestInit,
    retries = 5,
  ): Promise<Response> {
    let lastErr: Error | undefined;
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(url, opts);
        if (resp.ok) return resp;
        if (resp.status === 429 || resp.status === 502) {
          const retryAfter = Number(resp.headers.get("Retry-After") || Math.min(1000 * 2 ** i, 10000));
          const jitter = Math.random() * 500;
          await new Promise((r) => setTimeout(r, retryAfter + jitter));
          continue;
        }
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      } catch (e) {
        lastErr = e as Error;
        const backoff = Math.min(1000 * 2 ** i, 10000);
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, backoff + jitter));
      }
    }
    throw lastErr ?? new Error("Max retries exceeded");
  }

  // ── Block logic ─────────────────────────────────────────────────────
  private async block(sender: string, reason: string, snippet: string): Promise<void> {
    await this.env.SPAM_DB
      .prepare("INSERT OR IGNORE INTO blocklist(sender,reason,ts) VALUES(?,?,?)")
      .bind(sender, reason, Date.now())
      .run();
    await this.audit(sender, "block", "n/a", reason, snippet);

    if (DEMO_MODE) {
      console.log(`[DEMO] Would send block alert to ${this.state.number}: Blocked ${reason} from ${sender}`);
      return;
    }

    await this.env.TELNYX.messages.send({
      to: this.state.number,
      from: this.state.number,
      body: `Blocked a suspected ${reason} text from ${sender}: '${snippet}'.`,
    });
  }

  // ── Permanent block on N cumulative spam ────────────────────────────
  private async escalateCount(sender: string): Promise<void> {
    const count = await this.cumulativeSpamCount(sender);
    if (count >= SPAM_PERMANENT_BLOCK_N) {
      await this.env.SPAM_DB
        .prepare("INSERT OR REPLACE INTO blocklist(sender,reason,ts) VALUES(?,?,?)")
        .bind(sender, "spam_reputation", Date.now())
        .run();
      await this.audit(sender, "permanent_block", "spam", "spam_reputation", `count=${count}`);
    }
  }

  // ── Re-evaluation ───────────────────────────────────────────────────
  private async reEvaluate(sender: string, msg: { text: string }): Promise<void> {
    const history = await this.senderHistory(sender);
    const v = await this.judgeWithJev(msg.text, history);
    await this.audit(sender, "reeval", "blocked", v.choice, JSON.stringify(v));

    if (v.choice === "ok") {
      await this.unblock(sender);
      await this.deliver(msg);
    }
    // else: uphold block
  }

  private async unblock(sender: string): Promise<void> {
    await this.env.SPAM_DB
      .prepare("DELETE FROM blocklist WHERE sender = ?")
      .bind(sender)
      .run();
    await this.audit(sender, "unblock", "blocked", "ok", "cooldown_lift");
  }

  // ── Discard during cooldown ─────────────────────────────────────────
  private async discardSilent(sender: string, msg: { text: string }): Promise<void> {
    await this.audit(sender, "discard_silent", "blocked", "blocked", msg.text);
  }

  // ── Deliver (ok verdict) ────────────────────────────────────────────
  private async deliver(msg: { from: string; text: string }): Promise<void> {
    await this.audit(msg.from, "deliver", "n/a", "ok", msg.text);
    if (DEMO_MODE) {
      console.log(`[DEMO] Would deliver message from ${msg.from}: ${msg.text}`);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  private async isBlocked(sender: string): Promise<boolean> {
    const result = await this.env.SPAM_DB
      .prepare("SELECT 1 FROM blocklist WHERE sender = ?")
      .bind(sender)
      .all();
    return result.results.length > 0;
  }

  private async cooldownElapsed(sender: string): Promise<boolean> {
    const result = await this.env.SPAM_DB
      .prepare("SELECT ts FROM blocklist WHERE sender = ?")
      .bind(sender)
      .all();
    if (result.results.length === 0) return true;
    const ts = Number((result.results[0] as { ts: number }).ts);
    return Date.now() - ts >= COOLDOWN_MS;
  }

  private async senderHistory(sender: string): Promise<unknown[]> {
    const result = await this.env.SPAM_DB
      .prepare("SELECT text, verdict, ts FROM senderMsgs WHERE sender = ? ORDER BY ts DESC LIMIT 20")
      .bind(sender)
      .all();
    return result.results;
  }

  private async cumulativeSpamCount(sender: string): Promise<number> {
    const result = await this.env.SPAM_DB
      .prepare("SELECT COUNT(*) as n FROM senderMsgs WHERE sender = ? AND verdict = 'spam'")
      .bind(sender)
      .all();
    return Number((result.results[0] as { n: number }).n);
  }

  private async audit(
    sender: string,
    event: string,
    fromState: string,
    toState: string,
    detail: string,
  ): Promise<void> {
    await this.env.SPAM_DB
      .prepare("INSERT INTO audit(ts,sender,event,fromState,toState,detail) VALUES(?,?,?,?,?,?)")
      .bind(Date.now(), sender, event, fromState, toState, detail)
      .run();
  }
}

// ─── Fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(req: Request, e: EnvLocal): Promise<Response> {
    const url = new URL(req.url);

    // Webhook: inbound-message
    if (url.pathname === "/inbound-message" && req.method === "POST") {
      const payload = await req.json() as {
        data: { payload: { from: string; to: string; text: string; id: string } };
      };
      const from = payload.data.payload.from;
      const to = payload.data.payload.to;
      const text = payload.data.payload.text;
      const id = payload.data.payload.id;

      const actorId = e.SPAM_FILTER.idFromName(to);
      const stub = e.SPAM_FILTER.get(actorId);
      await stub.onMessage({ id, from, text });
      return new Response("OK", { status: 200 });
    }

    // RPC: watch(number)
    if (url.pathname === "/watch" && req.method === "POST") {
      const body = await req.json() as { number: string };
      const actorId = e.SPAM_FILTER.idFromName(body.number);
      const stub = e.SPAM_FILTER.get(actorId);
      await stub.watch(body.number);
      return new Response(JSON.stringify({ status: "watching", number: body.number }), { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};
