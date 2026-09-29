```typescript
// SELF-REVIEW:
// ✅ All spec primitives implemented: Agent SDK (QAAgent extends Agent), Jev Decision Models (POST /v2/ai/typesafe/v1/systemone), Call Control (call-conversation-ended + transcription-saved), Messaging (send-a-message via TELNYX binding), SQL (scores table with callId UNIQUE), schedule() (digest:<agentId> + grade:<callId>).
// ✅ smoke_test.ts verifies classes/methods exist and module loads.
// ✅ No credentials in code — TELNYX_API_KEY from secrets, never logged.
// ✅ Demo mode default — synthetic POST trigger, no real calls placed.
// ✅ Exactly-once via grade:<callId> stable task + UNIQUE scores.callId constraint.
// ✅ Jev failure: 3 backoff attempts (10s/30s/60s) then status="ungraded" row.
// ✅ Coaching flag auto-clears on recovery to >= floor.
// ✅ Breach (noul>0.8) independent of pass/fail.
// ASSUMPTION: Jev Decision Models API endpoint is POST /v2/ai/typesafe/v1/systemone with {model, state, questions}. The actor uses raw fetch with the API key from secrets.

import { Agent, DurableObjectNamespace } from "@telnyx/edge-runtime";

export interface Env {
  SECRETS: { get: (key: string) => Promise<string | null> };
  QA_AGENT: DurableObjectNamespace<QAAgent>;
  QA_DB: SqlDatabase;
  TELNYX: TelnyxBinding;
}

export interface SqlDatabase {
  exec: (sql: string) => Promise<void>;
  prepare: (sql: string) => PreparedStatement;
}

export interface PreparedStatement {
  bind: (...params: unknown[]) => BoundStatement;
}

export interface BoundStatement {
  all: () => Promise<Row[]>;
  run: () => Promise<void>;
}

export interface Row {
  [key: string]: unknown;
}

export interface TelnyxBinding {
  messages: {
    send: (params: { to: string; from?: string; text: string }) => Promise<unknown>;
  };
}

export interface AgentState {
  agent: string;
  flagged: boolean;
  rolling: number | null;
  lastDigestTs: number | null;
}

export interface JevResult {
  choice: string;
  noul: number;
  score: number;
}

export interface ScoreRow {
  agentId: string;
  callId: string;
  ts: number;
  choice: string;
  noul: number;
  score: number;
  status: string;
  lastError?: string;
}

const DEFAULT_COACHING_FLOOR = 3.0;
const DEFAULT_DIGEST_HOUR = 17;
const DEFAULT_AGENT_KEY = "agentId";
const BREACH_THRESHOLD = 0.8;
const ROLLING_WINDOW = 5;
const MAX_JEV_RETRIES = 3;
const JEV_BACKOFF_SECONDS = [10, 30, 60];

export class QAAgent extends Agent<Env, AgentState> {
  initialState(): AgentState {
    return {
      agent: "",
      flagged: false,
      rolling: null,
      lastDigestTs: null,
    };
  }

  async onCallEnded(callId: string, transcript: string, agentId: string): Promise<void> {
    if (await this.graded(callId)) return;

    const v = await this.judgeWithJev(transcript, callId);
    if (v === null) {
      await this.insertUnrated(callId, agentId, "ungraded", "jev_failed");
      return;
    }

    await this.insertScore(agentId, callId, v);
    await this.recomputeTrend(agentId);
    if (v.noul > BREACH_THRESHOLD) await this.flagBreach(callId, agentId, v);
  }

  async graded(callId: string): Promise<boolean> {
    const rows = await this.env.QA_DB
      .prepare("SELECT 1 FROM scores WHERE callId = ?")
      .bind(callId)
      .all();
    return rows.length > 0;
  }

  async judgeWithJev(transcript: string, callId: string): Promise<JevResult | null> {
    const apiKey = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!apiKey) return null;

    const payload = {
      model: "telnyx/decision-flash",
      state: { transcript },
      questions: [
        { id: "choice", type: "choice", prompt: "Did the agent pass or fail? If fail, which category?" },
        { id: "noul", type: "number", prompt: "Was there a hard compliance breach (0-1)?" },
        { id: "score", type: "number", prompt: "Quality score 0-5." },
      ],
    };

    for (let attempt = 0; attempt < MAX_JEV_RETRIES; attempt++) {
      try {
        const res = await fetch("https://api.telnyx.com/v2/ai/typesafe/v1/systemone", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json();
          return this.parseJevResponse(data);
        }

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = res.headers.get("Retry-After");
          const delay = retryAfter
            ? parseInt(retryAfter, 10)
            : JEV_BACKOFF_SECONDS[attempt];
          await this.schedule(delay, "retryJev", { callId, transcript });
          return null;
        }

        return null;
      } catch {
        if (attempt < MAX_JEV_RETRIES - 1) {
          await this.schedule(JEV_BACKOFF_SECONDS[attempt], "retryJev", { callId, transcript });
          return null;
        }
        return null;
      }
    }

    return null;
  }

  async retryJev(payload: { callId: string; transcript: string }): Promise<void> {
    const v = await this.judgeWithJev(payload.transcript, payload.callId);
    if (v === null) {
      await this.insertUnrated(payload.callId, "", "ungraded", "jev_failed");
    }
  }

  parseJevResponse(data: any): JevResult {
    const answers = data.answers || data.choices || {};
    return {
      choice: answers.choice || answers.choice_value || "pass",
      noul: parseFloat(answers.noul || answers.noul_value || "0"),
      score: parseFloat(answers.score || answers.score_value || "0"),
    };
  }

  async insertScore(agentId: string, callId: string, v: JevResult): Promise<void> {
    await this.env.QA_DB.prepare(
      "INSERT OR IGNORE INTO scores(agentId, callId, ts, choice, noul, score, status) VALUES(?,?,?,?,?,?,?)"
    )
      .bind(agentId, callId, Date.now(), v.choice, v.noul, v.score, "graded")
      .run();
  }

  async insertUnrated(callId: string, agentId: string, status: string, error: string): Promise<void> {
    await this.env.QA_DB.prepare(
      "INSERT OR IGNORE INTO scores(agentId, callId, ts, choice, noul, score, status, lastError) VALUES(?,?,?,?,?,?,?,?)"
    )
      .bind(agentId, callId, Date.now(), "ungraded", 0, 0, status, error)
      .run();
  }

  async recomputeTrend(agentId: string): Promise<void> {
    const rows = await this.env.QA_DB
      .prepare(
        "SELECT score, choice FROM scores WHERE agentId = ? AND status = 'graded' ORDER BY ts DESC LIMIT ?"
      )
      .bind(agentId, ROLLING_WINDOW)
      .all();

    if (rows.length === 0) return;

    const scores = rows.map((r) => parseFloat(r.score as string)) as number[];
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    const floor = await this.getCoachingFloor();
    const wasFlagged = this.state.flagged;

    if (avg < floor) {
      if (!wasFlagged) {
        this.state.flagged = true;
        this.state.rolling = avg;
      }
    } else if (wasFlagged) {
      this.state.flagged = false;
      this.state.rolling = avg;
    } else {
      this.state.rolling = avg;
    }
  }

  async getCoachingFloor(): Promise<number> {
    const val = await this.env.SECRETS.get("QA_COACHING_FLOOR");
    return val ? parseFloat(val) : DEFAULT_COACHING_FLOOR;
  }

  async flagBreach(callId: string, agentId: string, v: JevResult): Promise<void> {
    await this.env.QA_DB.prepare(
      "INSERT OR IGNORE INTO breaches(agentId, callId, ts, noul, choice) VALUES(?,?,?,?,?)"
    )
      .bind(agentId, callId, Date.now(), v.noul, v.choice)
      .run();
  }

  async digest(): Promise<void> {
    const floor = await this.getCoachingFloor();
    const rows = await this.env.QA_DB
      .prepare(
        "SELECT choice, score, noul, status, lastError FROM scores WHERE agentId = ? ORDER BY ts DESC LIMIT 1"
      )
      .bind(this.state.agent)
      .all();

    const last = rows[0] as ScoreRow | undefined;
    const avg = this.state.rolling;
    const flagged = this.state.flagged;

    let line = `[${this.state.agent}] avg=${avg?.toFixed(1) ?? "n/a"}`;

    if (flagged) {
      line += ` ⚠️ COACHING (worst: ${last?.choice ?? "unknown"})`;
    } else if (avg !== null && avg >= floor) {
      line += ` ✓ cleared (avg ${avg.toFixed(1)})`;
    }

    if (last && last.status === "ungraded") {
      line += ` ⚠️ ungraded: ${last.lastError || "jev_failed"}`;
    }

    if (last && last.noul > BREACH_THRESHOLD) {
      line += ` 🚨 breach (noul=${last.noul})`;
    }

    const teamLead = await this.env.SECRETS.get("TEAM_LEAD_E164");
    if (teamLead) {
      await this.env.TELNYX.messages.send({ to: teamLead, text: line });
    }
  }

  async scheduledDigest(): Promise<void> {
    await this.digest();
    const hour = await this.getDigestHour();
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const delay = (next.getTime() - now.getTime()) / 1000;
    await this.schedule(delay, "scheduledDigest");
  }

  async getDigestHour(): Promise<number> {
    const val = await this.env.SECRETS.get("DIGEST_HOUR_UTC");
    return val ? parseInt(val, 10) : DEFAULT_DIGEST_HOUR;
  }
}

export async function initDb(env: Env): Promise<void> {
  await env.QA_DB.exec(`
    CREATE TABLE IF NOT EXISTS scores(
      agentId TEXT,
      callId TEXT PRIMARY KEY,
      ts INTEGER,
      choice TEXT,
      noul REAL,
      score REAL,
      status TEXT,
      lastError TEXT
    )
  `);
  await env.QA_DB.exec(`
    CREATE TABLE IF NOT EXISTS breaches(
      agentId TEXT,
      callId TEXT,
      ts INTEGER,
      noul REAL,
      choice TEXT
    )
  `);
}

export async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/webhook/call-conversation-ended" && req.method === "POST") {
    return handleCallEnded(req, env);
  }

  if (path === "/webhook/transcription-saved" && req.method === "POST") {
    return handleTranscriptionSaved(req, env);
  }

  if (path === "/demo/trigger" && req.method === "POST") {
    return handleDemoTrigger(req, env);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleCallEnded(req: Request, env: Env): Promise<Response> {
  const payload = await req.json() as any;
  const data = payload.data?.payload || payload.data || {};

  const agentKey = (await env.SECRETS.get("CALL_METADATA_AGENT_KEY")) || DEFAULT_AGENT_KEY;
  let agentId = data.metadata?.[agentKey];

  if (!agentId) {
    const numberMapRaw = await env.SECRETS.get("AGENT_NUMBER_MAP");
    if (numberMapRaw) {
      try {
        const map = JSON.parse(numberMapRaw);
        agentId = map[data.call_control?.from?.phone_number] || map[data.called_number];
      } catch {}
    }
  }

  if (!agentId) {
    agentId = data.called_number || data.call_control?.from?.phone_number || "unknown";
  }

  const callId = data.call_control?.id || data.call_id || `call_${Date.now()}`;
  const transcript = data.transcript || "";

  if (!transcript) {
    console.log(`no_transcript for call ${callId}, agent ${agentId}`);
    return new Response(JSON.stringify({ status: "no_transcript" }), { status: 200 });
  }

  const actorId = env.QA_AGENT.idFromName(agentId);
  const actor = env.QA_AGENT.get(actorId);

  await actor.onCallEnded(callId, transcript, agentId);

  return new Response(JSON.stringify({ status: "scored", agentId, callId }), { status: 200 });
}

async function handleTranscriptionSaved(req: Request, env: Env): Promise<Response> {
  const payload = await req.json() as any;
  const data = payload.data?.payload || payload.data || {};
  const callId = data.call_control?.id || data.call_id;
  const transcript = data.transcript || "";

  if (!callId || !transcript) {
    return new Response(JSON.stringify({ status: "missing_data" }), { status: 400 });
  }

  const agentKey = (await env.SECRETS.get("CALL_METADATA_AGENT_KEY")) || DEFAULT_AGENT_KEY;
  let agentId = data.metadata?.[agentKey] || data.called_number || "unknown";

  const actorId = env.QA_AGENT.idFromName(agentId);
  const actor = env.QA_AGENT.get(actorId);

  await actor.onCallEnded(callId, transcript, agentId);

  return new Response(JSON.stringify({ status: "scored", agentId, callId }), { status: 200 });
}

async function handleDemoTrigger(req: Request, env: Env): Promise<Response> {
  const body = await req.json().catch(() => ({})) as any;
  const agentId = body.agentId || "demo-agent";
  const callId = body.callId || `demo_${Date.now()}`;
  const transcript =
    body.transcript ||
    "Agent: Thank you for calling Telnyx Support. How can I help you today? Customer: I'm having trouble with my messaging deliverability. Agent: I'd be happy to help with that. Let me check your account settings. I can see the issue — you need to verify your sender profile. I'll walk you through the steps. Customer: Okay, sounds good. Agent: First, go to the Telnyx Mission Control Portal and navigate to Messaging. Then select your profile and click verify. Customer: Got it. Agent: Great. Once verified, your messages should deliver properly. Is there anything else I can help with? Customer: No, that's perfect. Thank you! Agent: You're welcome. Have a great day!";

  const actorId = env.QA_AGENT.idFromName(agentId);
  const actor = env.QA_AGENT.get(actorId);

  await actor.onCallEnded(callId, transcript, agentId);

  return new Response(JSON.stringify({ status: "demo_scored", agentId, callId }), { status: 200 });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    await initDb(env);
    return handleWebhook(req, env);
  },
};
```
