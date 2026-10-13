/**
 * policy-recall-line — The Handbook Librarian (DEV-1285).
 *
 * One durable actor per company keeps the handbook embedded and fresh, answers
 * every policy question from the stacks, and files every Q&A in its ledger —
 * a reference desk that never sleeps, re-shelves itself nightly.
 *
 * Primitives composed:
 *  - Stateful Actor (Agent SDK) — source map, poll/re-index tasks, Q&A ledger.
 *  - Telnyx Embeddings + Storage — /v2/ai/embeddings/url + similarity-search.
 *  - LLM binding — this.env.TELNYX.ai.openai.chat.createCompletion (no keys in code).
 */

import {
  Agent,
  rpc,
  type ActorNamespace,
  type ActorStub,
  type Env as EdgeEnv,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceRecord {
  url: string;
  bucket: string;
  taskId: string | null;
  status: "indexing" | "ready" | "failed";
  lastIndexedAt: string | null;
  retries: number;
}

export interface PolicyState extends Record<string, unknown> {
  sources: Record<string, SourceRecord>;
}

/** qa_log row as served over the API (answered as a boolean). */
export interface QaLogRow {
  id: number;
  asked_at: string;
  question: string;
  answer: string;
  top_distance: number | null;
  source_slug: string;
  answered: boolean;
}

/** embed_tasks row as served over the API. */
export interface EmbedTaskRow {
  task_id: string;
  source_slug: string;
  started_at: string;
  finished_at: string | null;
  status: string;
}

/** One similarity-search result chunk. */
export interface SearchHit {
  document_chunk: string;
  distance: number;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Remote-callable surface of PolicyLine (ActorStub carries fetch itself). */
type PolicyStub = ActorStub & Pick<PolicyLine, "audit" | "reindexNow">;

interface PolicyNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): PolicyStub;
}

export interface Env extends EdgeEnv {
  LIB: PolicyNamespace;
  TELNYX: {
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
  SECRETS: { get: (handle: string) => Promise<string> };
}

// ---------------------------------------------------------------------------
// Config (secrets bindings with plain env-var fallback)
// ---------------------------------------------------------------------------
// The Edge runtime does NOT inject [env_vars] for actor projects, so config
// ships as [[secrets]] bindings in telnyx.toml and is read via SECRETS.get()
// with a plain env-var fallback (for local tooling).

function directEnv(e: Env, key: string): string | undefined {
  const v = (e as unknown as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function readConfig(e: Env, key: string): Promise<string | undefined> {
  const direct = directEnv(e, key);
  if (direct) return direct;
  try {
    const v = await e.SECRETS.get(key);
    return v || undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Constants (hardcoded demo surface — see README "Environment Variables")
// ---------------------------------------------------------------------------

/** A chunk with distance <= SIMILARITY_FLOOR counts as a hit. */
export const SIMILARITY_FLOOR = 0.9;
/** Stable poll:<taskId> cadence (seconds). */
export const POLL_INTERVAL_S = 60;
/** Stable reindex:<slug> cadence — the nightly re-shelving (seconds). */
export const REINDEX_INTERVAL_S = 86400;
/** Delay before a failed embed is retried (seconds). */
export const RETRY_DELAY_S = 600;
/** Max retry attempts per source before it is marked failed. */
export const MAX_RETRIES = 3;

const DEFAULT_BUCKET = "acme-handbook";
const DEFAULT_SEED_URL = "https://acme.example.com/handbook";
/** Telnyx-hosted inference model — zero BYOK keys required (no keys in the sample). */
export const DEFAULT_AI_MODEL = "meta-llama/Llama-3.3-70B-Instruct";

const NO_HIT_REPLY =
  "I couldn't find a matching policy in the handbook. Please contact HR for clarification.";

const EMBED_URL = "https://api.telnyx.com/v2/ai/embeddings/url";
const EMBED_TASK_URL = "https://api.telnyx.com/v2/ai/embeddings";
const SIMILARITY_SEARCH_URL =
  "https://api.telnyx.com/v2/ai/embeddings/similarity-search";

// ---------------------------------------------------------------------------
// The actor
// ---------------------------------------------------------------------------

export class PolicyLine extends Agent<Env, PolicyState> {
  protected override initialState(): PolicyState {
    return { sources: {} };
  }

  // -- Durable ledger schema (per-actor SQLite) -----------------------------

  /** Idempotent schema setup. Safe to call on every actor entry. */
  private ensureSchema(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS qa_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        asked_at     TEXT NOT NULL,
        question     TEXT NOT NULL,
        answer       TEXT NOT NULL,
        top_distance REAL,
        source_slug  TEXT NOT NULL,
        answered     INTEGER NOT NULL
      );
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS embed_tasks (
        task_id     TEXT PRIMARY KEY,
        source_slug TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL
      );
    `);
  }

  // -- RPC surface ----------------------------------------------------------

  @rpc()
  async audit(): Promise<{ qaLog: QaLogRow[] }> {
    this.ensureSchema();
    const rows = this.ctx.storage.sql
      .exec<{
        id: number;
        asked_at: string;
        question: string;
        answer: string;
        top_distance: number | null;
        source_slug: string;
        answered: number;
      }>(
        `SELECT id, asked_at, question, answer, top_distance, source_slug, answered
         FROM qa_log ORDER BY id DESC LIMIT 20`,
      )
      .toArray();
    return {
      qaLog: rows.map((r) => ({
        id: r.id,
        asked_at: r.asked_at,
        question: r.question,
        answer: r.answer,
        top_distance: r.top_distance,
        source_slug: r.source_slug,
        answered: r.answered === 1,
      })),
    };
  }

  @rpc()
  async reindexNow(slug: string): Promise<{ taskId: string }> {
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) {
      throw new Error(`Unknown source slug: ${slug}`);
    }
    const taskId = await this.startEmbed(source.url, source.bucket, slug);
    source.taskId = taskId;
    source.status = "indexing";
    source.retries = 0;
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "onPollTask", { taskId, slug }, {
      id: `poll:${taskId}`,
    });
    return { taskId };
  }

  // -- HTTP entry (inner actor routes; company arrives via the URL slug) ----

  override async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/source") {
      return this.handleRegisterSource(req);
    }
    if (req.method === "POST" && path === "/ask") {
      return this.handleAsk(req);
    }
    return this.json({ error: "Not found" }, 404);
  }

  private json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  // -- Route handlers -------------------------------------------------------

  /** The "birth": first registration shelves the source and starts the embed. */
  private async handleRegisterSource(req: Request): Promise<Response> {
    let body: { company?: string; url?: string };
    try {
      body = (await req.json()) as { company?: string; url?: string };
    } catch {
      return this.json({ error: "Invalid JSON body" }, 400);
    }
    const company = body.company?.trim();
    if (!company) {
      return this.json({ error: "Missing 'company'" }, 400);
    }
    const slug = `company:${company}`;
    const state = await this.getState();
    if (state.sources[slug]) {
      return this.json({ error: "Source already registered" }, 409);
    }
    const url =
      body.url?.trim() ||
      (await readConfig(this.env, "SEED_HANDBOOK_URL")) ||
      DEFAULT_SEED_URL;
    const bucket =
      (await readConfig(this.env, "BUCKET_NAME")) || DEFAULT_BUCKET;

    this.ensureSchema();
    let taskId: string;
    try {
      taskId = await this.startEmbed(url, bucket, slug);
    } catch {
      return this.json(
        { error: "Embedding task failed to start. Check the URL and API key." },
        502,
      );
    }
    state.sources[slug] = {
      url,
      bucket,
      taskId,
      status: "indexing",
      lastIndexedAt: null,
      retries: 0,
    };
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "onPollTask", { taskId, slug }, {
      id: `poll:${taskId}`,
    });
    await this.schedule(REINDEX_INTERVAL_S, "onReindexTask", { slug }, {
      id: `reindex:${slug}`,
    });
    return this.json({ slug, taskId, status: "indexing" }, 201);
  }

  /** The "reference desk": search the stacks, compose, and log the Q&A. */
  private async handleAsk(req: Request): Promise<Response> {
    let body: { company?: string; question?: string };
    try {
      body = (await req.json()) as { company?: string; question?: string };
    } catch {
      return this.json({ error: "Invalid JSON body" }, 400);
    }
    const company = body.company?.trim();
    const question = body.question?.trim();
    if (!company || !question) {
      return this.json({ error: "Missing 'company' or 'question'" }, 400);
    }
    const slug = `company:${company}`;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) {
      return this.json(
        { error: "Unknown company. Register a source first." },
        404,
      );
    }
    if (source.status !== "ready") {
      return this.json(
        { error: "Source is still indexing. Try again shortly." },
        202,
      );
    }

    this.ensureSchema();
    try {
      const search = await this.similaritySearch(source.bucket, question, 3);
      const topHit = selectTopHit(search);
      const answered = topHit !== null;
      const answer = topHit
        ? await this.composeAnswer(question, topHit.document_chunk)
        : NO_HIT_REPLY;

      this.ctx.storage.sql.exec(
        `INSERT INTO qa_log (asked_at, question, answer, top_distance, source_slug, answered)
         VALUES (?, ?, ?, ?, ?, ?)`,
        new Date().toISOString(),
        question,
        answer,
        topHit ? topHit.distance : null,
        slug,
        answered ? 1 : 0,
      );

      return this.json(
        {
          answer,
          topDistance: topHit ? topHit.distance : null,
          answered,
        },
        200,
      );
    } catch {
      return this.json(
        { error: "Answer lookup failed. Try again shortly." },
        500,
      );
    }
  }

  // -- Task handlers (dispatched by name; stable ids upsert) ----------------

  /** Stable-id task `poll:<taskId>` — the crash-safe embed poller. */
  async onPollTask(payload: { taskId: string; slug: string }): Promise<void> {
    const { taskId, slug } = payload;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source || source.taskId !== taskId) return;

    const status = await this.getEmbedTaskStatus(taskId);
    if (status === "success") {
      source.status = "ready";
      source.lastIndexedAt = new Date().toISOString();
      await this.setState({ sources: state.sources });
      this.ctx.storage.sql.exec(
        `UPDATE embed_tasks SET finished_at = ?, status = 'success' WHERE task_id = ?`,
        new Date().toISOString(),
        taskId,
      );
    } else if (status === "failure") {
      source.retries += 1;
      if (source.retries <= MAX_RETRIES) {
        await this.setState({ sources: state.sources });
        await this.schedule(RETRY_DELAY_S, "onRetryTask", { slug }, {
          id: `retry:${slug}`,
          maxRetries: MAX_RETRIES,
        });
      } else {
        source.status = "failed";
        await this.setState({ sources: state.sources });
        this.ctx.storage.sql.exec(
          `UPDATE embed_tasks SET finished_at = ?, status = 'failed' WHERE task_id = ?`,
          new Date().toISOString(),
          taskId,
        );
      }
    } else {
      // queued or processing — re-book the next look on the same stable id.
      await this.schedule(POLL_INTERVAL_S, "onPollTask", { taskId, slug }, {
        id: `poll:${taskId}`,
      });
    }
  }

  /** Stable-id task `retry:<slug>` — re-embed after a failed task. */
  async onRetryTask(payload: { slug: string }): Promise<void> {
    const { slug } = payload;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source || source.status === "ready") return;

    const taskId = await this.startEmbed(source.url, source.bucket, slug);
    source.taskId = taskId;
    source.status = "indexing";
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "onPollTask", { taskId, slug }, {
      id: `poll:${taskId}`,
    });
  }

  /** Stable-id task `reindex:<slug>` — the nightly re-shelving. */
  async onReindexTask(payload: { slug: string }): Promise<void> {
    const { slug } = payload;
    const state = await this.getState();
    const source = state.sources[slug];
    if (!source) return;

    const taskId = await this.startEmbed(source.url, source.bucket, slug);
    source.taskId = taskId;
    source.status = "indexing";
    source.retries = 0;
    await this.setState({ sources: state.sources });
    await this.schedule(POLL_INTERVAL_S, "onPollTask", { taskId, slug }, {
      id: `poll:${taskId}`,
    });
    await this.schedule(REINDEX_INTERVAL_S, "onReindexTask", { slug }, {
      id: `reindex:${slug}`,
    });
  }

  // -- Telnyx Embeddings API helpers ---------------------------------------

  private async apiKey(): Promise<string> {
    const key = await this.env.SECRETS.get("TELNYX_API_KEY");
    if (!key) {
      throw new Error("TELNYX_API_KEY secret not configured");
    }
    return key;
  }

  /** POST /v2/ai/embeddings/url — crawl + embed, returns the async task id. */
  private async startEmbed(
    url: string,
    bucket: string,
    slug: string,
  ): Promise<string> {
    const key = await this.apiKey();
    const res = await fetch(EMBED_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ url, bucket_name: bucket }),
    });
    if (!res.ok) {
      throw new Error(`Embed start failed: ${res.status}`);
    }
    const data = (await res.json()) as { task_id?: string };
    const taskId = data.task_id;
    if (!taskId) {
      throw new Error("Embed start returned no task_id");
    }
    // The ledger row is appended when the task STARTS, not when it ends.
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO embed_tasks (task_id, source_slug, started_at, finished_at, status)
       VALUES (?, ?, ?, NULL, 'processing')`,
      taskId,
      slug,
      new Date().toISOString(),
    );
    return taskId;
  }

  /** GET /v2/ai/embeddings/{task_id} — queued | processing | success | failure. */
  private async getEmbedTaskStatus(taskId: string): Promise<string> {
    const key = await this.apiKey();
    const res = await fetch(`${EMBED_TASK_URL}/${taskId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      throw new Error(`Embed status failed: ${res.status}`);
    }
    const data = (await res.json()) as { status?: string };
    return data.status ?? "processing";
  }

  /** POST /v2/ai/embeddings/similarity-search — the RAG primitive. */
  private async similaritySearch(
    bucket: string,
    query: string,
    numOfDocs = 3,
  ): Promise<SearchHit[]> {
    const key = await this.apiKey();
    const res = await fetch(SIMILARITY_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        bucket_name: bucket,
        query,
        num_of_docs: numOfDocs,
      }),
    });
    if (!res.ok) {
      throw new Error(`Similarity search failed: ${res.status}`);
    }
    const data = (await res.json()) as { data?: SearchHit[] };
    return data.data ?? [];
  }

  /** LLM binding — answer composition from the top chunk (no API key in code). */
  private async composeAnswer(
    question: string,
    chunk: string,
  ): Promise<string> {
    const model =
      (await readConfig(this.env, "AI_MODEL")) || DEFAULT_AI_MODEL;
    const completion = await this.env.TELNYX.ai.openai.chat.createCompletion({
      model,
      max_tokens: 300,
      temperature: 0.2,
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
// Pure helpers (unit-testable without the actor runtime)
// ---------------------------------------------------------------------------

/** Return the best hit (lowest distance) when it is within the floor, else null. */
export function selectTopHit(search: SearchHit[]): SearchHit | null {
  const hits = search.filter((h) => h && Number.isFinite(h.distance));
  if (hits.length === 0) return null;
  const best = hits.reduce((a, b) => (b.distance < a.distance ? b : a));
  if (best.distance > SIMILARITY_FLOOR) return null;
  return best;
}

// ---------------------------------------------------------------------------
// Fetch handler — routes every request to the actor by company slug
// ---------------------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;

    if (path === "/health") {
      return new Response(JSON.stringify({ status: "ok", agent: "PolicyLine" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    // POST /company/<company>/source | /ask | /rpc/audit | /rpc/reindexNow
    const match = path.match(/^\/company\/([^/]+)(\/.*)?$/);
    if (!match || req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    const company = match[1];
    const rest = match[2] ?? "/";
    const stub = env.LIB.idFromName(`company:${company}`);

    if (rest === "/rpc/audit") {
      const result = await stub.audit();
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (rest === "/rpc/reindexNow") {
      const body = (await req.json().catch(() => ({}))) as { slug?: string };
      const slug = body.slug || `company:${company}`;
      try {
        const result = await stub.reindexNow(slug);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      } catch {
        return new Response(
          JSON.stringify({ error: "Unknown source slug." }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
    }

    const innerReq = new Request(`https://internal${rest}`, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    return stub.fetch(innerReq);
  },
};
