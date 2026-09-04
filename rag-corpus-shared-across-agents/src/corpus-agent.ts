import { Agent } from "@telnyx/edge-runtime";
import type { SqlValue } from "@telnyx/edge-runtime";
import { cosine } from "./similarity.js";
import { chunkText } from "./text.js";
import {
  chunkOverlap,
  chunkSize,
  embeddingModelId,
  knowledgePrefix,
  type Env,
  type IngestResult,
  type CorpusState,
  type SearchHit,
} from "./types.js";

interface ChunkRow extends Record<string, SqlValue> {
  id: string;
  doc: string;
  ord: number;
  text: string;
  embedding: string;
}

/**
 * The shared knowledge base. ONE actor instance per corpus id — every persona
 * agent addresses the same actor via `env.CORPUS.idFromName(corpusId)`, so
 * every personality answers from the same embedded document store.
 *
 * Documents arrive either directly (`ingest`) or from the Cloud Storage
 * bucket binding (`ingestBucket`). Text is chunked, embedded through the
 * zero-credential `TELNYX` binding, and stored in per-actor SQL. Retrieval
 * embeds the query and ranks stored chunks by cosine similarity.
 */
export class CorpusAgent extends Agent<Env, CorpusState> {
  protected initialState(): CorpusState {
    return { docs: [], chunkCount: 0, lastIngestedAt: 0 };
  }

  /** Chunk + embed one document, replacing any previous version of it. */
  async ingest(name: string, text: string): Promise<IngestResult> {
    const chunks = chunkText(text, chunkSize(this.env), chunkOverlap(this.env));
    if (chunks.length === 0) return { doc: name, chunks: 0 };

    const vectors = await this.embed(chunks);
    this.ensureTable();

    this.ctx.storage.sql.exec("DELETE FROM chunks WHERE doc = ?", name);
    for (let i = 0; i < chunks.length; i++) {
      this.ctx.storage.sql.exec(
        "INSERT INTO chunks (id, doc, ord, text, embedding) VALUES (?, ?, ?, ?, ?)",
        `${name}#${i}`,
        name,
        i,
        chunks[i],
        JSON.stringify(vectors[i]),
      );
    }

    await this.refreshDocList();
    return { doc: name, chunks: chunks.length };
  }

  /** Ingest every object under the configured bucket prefix. */
  async ingestBucket(): Promise<IngestResult[]> {
    const page = await this.env.KNOWLEDGE.list({ prefix: knowledgePrefix(this.env) });
    const results: IngestResult[] = [];
    for (const object of page.objects) {
      const file = await this.env.KNOWLEDGE.get(object.key);
      if (!file || !("body" in file)) continue;
      const text = await file.text();
      if (!text.trim()) continue;
      results.push(await this.ingest(object.key, text));
    }
    return results;
  }

  /** Embed the query, rank stored chunks by cosine similarity, return top-K. */
  async search(query: string, limit?: number): Promise<SearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const topK = limit && Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 4;

    const [queryVector] = await this.embed([trimmed]);
    this.ensureTable();
    const rows = this.ctx.storage.sql
      .exec<ChunkRow>("SELECT id, doc, ord, text, embedding FROM chunks")
      .toArray();

    const hits: SearchHit[] = [];
    for (const row of rows) {
      let vector: number[] = [];
      try {
        const parsed: unknown = JSON.parse(row.embedding);
        if (Array.isArray(parsed)) vector = parsed.filter((n): n is number => typeof n === "number");
      } catch {
        continue;
      }
      hits.push({
        id: row.id,
        doc: row.doc,
        ord: row.ord,
        text: row.text,
        score: cosine(queryVector, vector),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  /** Corpus snapshot: documents, chunk count, last ingest time. */
  async stats(): Promise<CorpusState> {
    return this.getState();
  }

  /** Drop every chunk (docs must be re-ingested afterwards). */
  async reset(): Promise<void> {
    this.ensureTable();
    this.ctx.storage.sql.exec("DELETE FROM chunks");
    await this.setState({ docs: [], chunkCount: 0, lastIngestedAt: 0 });
  }

  // ---- Internals -----------------------------------------------------------

  private ensureTable(): void {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, doc TEXT, ord INTEGER, text TEXT, embedding TEXT)",
    );
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const response = await this.env.TELNYX.ai.openai.embeddings.createEmbeddings({
      model: embeddingModelId(this.env),
      input: texts,
    });
    return response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  private async refreshDocList(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<{ doc: string } & Record<string, SqlValue>>("SELECT DISTINCT doc FROM chunks ORDER BY doc")
      .toArray();
    const counted = this.ctx.storage.sql
      .exec<{ n: number } & Record<string, SqlValue>>("SELECT COUNT(*) AS n FROM chunks")
      .toArray();
    await this.setState({
      docs: rows.map((r) => r.doc),
      chunkCount: counted[0]?.n ?? 0,
      lastIngestedAt: Date.now(),
    });
  }
}
