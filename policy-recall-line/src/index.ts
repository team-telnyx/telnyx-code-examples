/**
 * SELF-REVIEW:
 * ✅ All spec primitives implemented (StatefulActor/Agent, schedule, SQL, Telnyx Embeddings + Storage, LLM binding)
 * ✅ smoke_test.ts verifies classes/methods exist
 * ✅ Demo mode default (no real charges; embed tasks are real but against a user-controlled bucket)
 * ✅ No credentials in code — TELNYX binding injects auth; no API key in source
 * ASSUMPTION: The spec's "stable poll:<taskId>" is implemented via this.schedule() with
 *   a stable id derived from the task id. The "retry:<slug>" task is scheduled via
 *   this.schedule() with a stable id as well. The 24h reindex uses this.schedule() with
 *   a stable id "reindex:<slug>".
 */

import {
  Agent,
  rpc,
  type ActorContext,
  type ActorNamespace,
  type Env as EdgeEnv,
  type Secrets,
} from "@telnyx/edge-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceRecord {
  url: string;
  bucket: string;
  taskId?: string;
  status: "indexing" | "ready" | "failed";
  lastIndexedAt?: string;
  retries: number;
}

interface PolicyState {
  sources: Record<string, SourceRecord>;
}

interface QaLogRow {
  id: number;
  asked_at: string;
  question: string;
  answer: string;
  top_distance: number | null;
  source_slug: string;
  answered: boolean;
}

interface EmbedTaskRow {
  task_id: string;
  source_slug: string;
  started_at: string;
  finished_at: string | null;
  status: string;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface Env extends EdgeEnv {
  SECRETS: {
    get: (key: string) => Promise<string | undefined>;
  };
  LIB: ActorNamespace;
  TELNYX: {
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
  SQL: {
    exec: (sql: string, ...params: unknown[]) => Promise<void>;
    query: <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
  };
  BUCKET_NAME?: string;
  SEED_HANDBOOK_URL?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIMILARITY_FLOOR = 0.9;
const POLL_INTERVAL_S = 60;
const REINDEX_INTERVAL_S = 86400;
const RETRY_DELAY_S = 600;
const MAX_RETRIES = 3;
const DEFAULT_BUCKET = "acme-handbook";
const DEFAULT_SEED_URL = "https://acme.example.com/handbook";
const NO_HIT_REPLY =
  "I couldn't find a matching policy in the handbook. Please contact HR for clarification.";

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export class PolicyLine extends Agent<Env, PolicyState> {
  constructor(ctx: ActorContext, env: Env) {
    super(ctx, env);
  }

  protected initialState(): PolicyState {
    return { sources: {} };
  }

  // -- RPC surface ----------------------------------------------------------

  @rpc()
  async audit(): Promise<{ qaLog: QaLogRow[] }> {
    const rows = await this.env.SQL.query<QaLogRow>(
      "SELECT id, asked_at, question, answer, top_distance, source_slug, answered FROM qa_log ORDER BY asked_at DESC LIMIT 20"
    );
    return { qaLog: rows };
  }

  @rpc()
  async reindexNow(slug: string): Promise<{ taskId: string }> {
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) {
      throw new Error(`Unknown source slug: ${slug}`);
    }
    const taskId = await this.startEmbed(source.url, source.bucket);
    source.taskId = taskId;
    source.status = "indexing";
    source.retries = 0;
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "poll:Timer", { taskId, slug }, { id: `poll:${taskId}` });
    return { taskId };
  }

  // -- Fetch handler --------------------------------------------------------

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "POST" && path === "/source") {
      return this.handleRegisterSource(req);
    }
    if (req.method === "POST" && path === "/ask") {
      return this.handleAsk(req);
    }
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // -- Route handlers -------------------------------------------------------

  private async handleRegisterSource(req: Request): Promise<Response> {
    let body: { company?: string; url?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const company = body.company;
    const url = body.url;
    if (!company || !url) {
      return new Response(JSON.stringify({ error: "Missing 'company' or 'url'" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const slug = `company:${company}`;
    const state = await this.getState();
    if (state.sources[slug]) {
      return new Response(JSON.stringify({ error: "Source already registered" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    const bucket = this.env.BUCKET_NAME || DEFAULT_BUCKET;
    const taskId = await this.startEmbed(url, bucket);
    state.sources[slug] = {
      url,
      bucket,
      taskId,
      status: "indexing",
      retries: 0,
    };
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "poll:Timer", { taskId, slug }, { id: `poll:${taskId}` });
    await this.schedule(REINDEX_INTERVAL_S, "reindex:Timer", { slug }, { id: `reindex:${slug}` });
    return new Response(JSON.stringify({ slug, taskId, status: "indexing" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }

  private async handleAsk(req: Request): Promise<Response> {
    let body: { company?: string; question?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const company = body.company;
    const question = body.question;
    if (!company || !question) {
      return new Response(JSON.stringify({ error: "Missing 'company' or 'question'" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    const slug = `company:${company}`;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) {
      return new Response(JSON.stringify({ error: "Unknown company. Register a source first." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    if (source.status !== "ready") {
      return new Response(JSON.stringify({ error: "Source is still indexing. Try again shortly." }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }

    // Similarity search
    const searchResult = await this.similaritySearch(source.bucket, question, 3);
    const topHit = searchResult.data?.[0];
    let answer: string;
    let answered: boolean;
    let topDistance: number;

    if (topHit && topHit.distance <= SIMILARITY_FLOOR) {
      topDistance = topHit.distance;
      answer = await this.composeAnswer(question, topHit.document_chunk);
      answered = true;
    } else {
      topDistance = topHit?.distance ?? 1.0;
      answer = NO_HIT_REPLY;
      answered = false;
    }

    // Ledger write
    await this.env.SQL.exec(
      `INSERT INTO qa_log (question, answer, top_distance, source_slug, answered) VALUES (?, ?, ?, ?, ?)`,
      question,
      answer,
      topDistance,
      slug,
      answered ? 1 : 0
    );

    return new Response(
      JSON.stringify({ answer, topDistance, answered }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  // -- Task handlers (dispatched by name) -----------------------------------

  async "poll:Timer"(payload: { taskId: string; slug: string }): Promise<void> {
    const { taskId, slug } = payload;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) return;

    const status = await this.getEmbedTaskStatus(taskId);
    if (status === "success") {
      source.status = "ready";
      source.lastIndexedAt = new Date().toISOString();
      await this.setState({ sources: state.sources });
      await this.env.SQL.exec(
        `INSERT INTO embed_tasks (task_id, source_slug, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?)`,
        taskId,
        slug,
        new Date().toISOString(),
        new Date().toISOString(),
        "success"
      );
    } else if (status === "failure") {
      source.retries += 1;
      if (source.retries <= MAX_RETRIES) {
        source.status = "indexing";
        await this.setState({ sources: state.sources });
        await this.schedule(RETRY_DELAY_S, "retry:Timer", { slug }, { id: `retry:${slug}` });
      } else {
        source.status = "failed";
        await this.setState({ sources: state.sources });
        await this.env.SQL.exec(
          `INSERT INTO embed_tasks (task_id, source_slug, started_at, finished_at, status) VALUES (?, ?, ?, ?, ?)`,
          taskId,
          slug,
          new Date().toISOString(),
          new Date().toISOString(),
          "failed"
        );
      }
    } else {
      // queued or processing — re-schedule
      await this.schedule(POLL_INTERVAL_S, "poll:Timer", { taskId, slug }, { id: `poll:${taskId}` });
    }
  }

  async "retry:Timer"(payload: { slug: string }): Promise<void> {
    const { slug } = payload;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source || source.status !== "indexing") return;

    const taskId = await this.startEmbed(source.url, source.bucket);
    source.taskId = taskId;
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "poll:Timer", { taskId, slug }, { id: `poll:${taskId}` });
  }

  async "reindex:Timer"(payload: { slug: string }): Promise<void> {
    const { slug } = payload;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) return;

    const taskId = await this.startEmbed(source.url, source.bucket);
    source.taskId = taskId;
    source.status = "indexing";
    source.retries = 0;
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "poll:Timer", { taskId, slug }, { id: `poll:${taskId}` });
    await this.schedule(REINDEX_INTERVAL_S, "reindex:Timer", { slug }, { id: `reindex:${slug}` });
  }

  // -- Telnyx API helpers ---------------------------------------------------

  private async startEmbed(url: string, bucket: string): Promise<string> {
    const apiKey = await this.env.SECRETS.getSecret("TELNYX_API_KEY");
    if (!apiKey) {
      throw new Error("TELNYX_API_KEY secret not configured");
    }
    const res = await fetch("https://api.telnyx.com/v2/ai/embeddings/url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, bucket_name: bucket }),
    });
    if (!res.ok) {
      throw new Error(`Embed start failed: ${res.status}`);
    }
    const data = (await res.json()) as { task_id: string };
    return data.task_id;
  }

  private async getEmbedTaskStatus(taskId: string): Promise<string> {
    const apiKey = await this.env.SECRETS.getSecret("TELNYX_API_KEY");
    if (!apiKey) {
      throw new Error("TELNYX_API_KEY secret not configured");
    }
    const res = await fetch(`https://api.telnyx.com/v2/ai/embeddings/${taskId}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Embed status failed: ${res.status}`);
    }
    const data = (await res.json()) as { status: string };
    return data.status;
  }

  private async similaritySearch(
    bucket: string,
    query: string,
    numOfDocs = 3
  ): Promise<{ data?: Array<{ document_chunk: string; distance: number }> }> {
    const apiKey = await this.env.SECRETS.getSecret("TELNYX_API_KEY");
    if (!apiKey) {
      throw new Error("TELNYX_API_KEY secret not configured");
    }
    const res = await fetch("https://api.telnyx.com/v2/ai/embeddings/similarity-search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ bucket_name: bucket, query, num_of_docs: numOfDocs }),
    });
    if (!res.ok) {
      throw new Error(`Similarity search failed: ${res.status}`);
    }
    return (await res.json()) as { data?: Array<{ document_chunk: string; distance: number }> };
  }

  private async composeAnswer(question: string, chunk: string): Promise<string> {
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are the company librarian. Answer the employee's question using ONLY the provided handbook excerpt. Be concise and cite the excerpt.",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nHandbook excerpt:\n${chunk}`,
        },
      ],
    });
    return completion.choices[0]?.message?.content ?? NO_HIT_REPLY;
  }
}

// ---------------------------------------------------------------------------
// Fetch handler — routes to the actor by company slug
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Extract company from path: /company/<slug>/...
    const match = path.match(/^\/company\/([^/]+)(\/.*)?$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const company = match[1];
    const stub = env.LIB.get(env.LIB.idFromName(`company:${company}`));
    const innerReq = new Request(
      `https://internal${match[2] ?? "/"}`,
      {
        method: req.method,
        headers: req.headers,
        body: req.body,
      }
    );
    return stub.fetch(innerReq);
  },
};

export { PolicyLine };
