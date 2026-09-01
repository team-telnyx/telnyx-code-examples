import demoHtml from "./demo-html.js";
import {
  sanitizeCorpusId,
  personaActorName,
  PERSONAS,
  type Env,
} from "./types.js";

export { CorpusAgent } from "./corpus-agent.js";
export { PersonaAgent } from "./persona-agent.js";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T> {
  return (await request.json().catch(() => ({}))) as T;
}

/**
 * Telnyx Edge Compute worker.
 *
 * - `GET /` serves the demo page.
 * - `/api/corpus/<id>/...` are thin REST wrappers over the two actor types:
 *   document ingestion + stats hit the corpus actor, questions hit the
 *   per-persona actors (all reading the same corpus).
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/" && request.method === "GET") {
      return new Response(demoHtml, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/api/personas" && request.method === "GET") {
      return json({ personas: PERSONAS.map(({ id, label }) => ({ id, label })) });
    }

    const segments = path.split("/").filter(Boolean);
    if (segments[0] !== "api" || segments[1] !== "corpus" || !segments[2]) {
      return json({ error: "Not found" }, { status: 404 });
    }
    const corpusId = sanitizeCorpusId(segments[2]);
    const corpus = env.CORPUS.idFromName(corpusId);
    const route = segments.slice(3).join("/");

    if (route === "stats" && request.method === "GET") {
      return json({ corpus_id: corpusId, stats: await corpus.stats() });
    }

    if (route === "reset" && request.method === "POST") {
      await corpus.reset();
      return json({ corpus_id: corpusId, status: "reset" });
    }

    if (route === "documents" && request.method === "POST") {
      const body = await readJson<{ name?: unknown; text?: unknown }>(request);
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "untitled";
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim()) {
        return json({ error: "text is required" }, { status: 400 });
      }
      const result = await corpus.ingest(name, text);
      return json({ corpus_id: corpusId, ...result }, { status: 201 });
    }

    if (route === "ingest-bucket" && request.method === "POST") {
      const results = await corpus.ingestBucket();
      return json({ corpus_id: corpusId, ingested: results });
    }

    if (route === "ask" && request.method === "POST") {
      const body = await readJson<{ persona?: unknown; question?: unknown }>(request);
      const persona = typeof body.persona === "string" ? body.persona : "support";
      const question = typeof body.question === "string" ? body.question : "";
      if (!question.trim()) {
        return json({ error: "question is required" }, { status: 400 });
      }
      const personaActor = env.PERSONAS.idFromName(personaActorName(corpusId, persona));
      const result = await personaActor.ask({ corpusId, persona, question });
      return json(result);
    }

    return json({ error: "Not found" }, { status: 404 });
  },
};
