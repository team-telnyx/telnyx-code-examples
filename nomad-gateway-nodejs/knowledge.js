// Knowledge sources — Kiwix (Wikipedia), Telnyx Embeddings, OpenStreetMap.
// All functions gracefully return empty results on failure.
import { setting } from "./settings.js";

const TELNYX_API = "https://api.telnyx.com/v2";

// ---------------------------------------------------------------------------
// Kiwix — offline Wikipedia search and article retrieval
// ---------------------------------------------------------------------------
export async function searchKiwix(query) {
  const host = setting("KIWIX_HOST");
  if (!host) return [];

  try {
    const url = `${host}/search?pattern=${encodeURIComponent(query)}&books=&pageLength=5`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return [];
    const html = await resp.text();

    // Parse search results from Kiwix HTML response
    const results = [];
    const regex = /<a[^>]+href="\/([^/]+)\/([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({ zim: match[1], path: match[2], title: match[3].trim() });
    }
    return results.slice(0, 5);
  } catch {
    return [];
  }
}

export async function getKiwixArticle(zimName, articlePath) {
  const host = setting("KIWIX_HOST");
  if (!host) return "";

  try {
    const url = `${host}/${encodeURIComponent(zimName)}/${articlePath}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!resp.ok) return "";
    const html = await resp.text();

    // Strip HTML tags, collapse whitespace, truncate
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 4000);
  } catch {
    return "";
  }
}

export async function checkKiwix() {
  const host = setting("KIWIX_HOST");
  if (!host) return false;
  try {
    const resp = await fetch(`${host}/`, { signal: AbortSignal.timeout(3_000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Telnyx Embeddings API — vectorize text for semantic search
// ---------------------------------------------------------------------------
export async function embedText(text) {
  const apiKey = setting("TELNYX_API_KEY");
  if (!apiKey) return [];

  try {
    const resp = await fetch(`${TELNYX_API}/ai/openai/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "nomic-embed-text-v1.5",
        input: text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.data?.[0]?.embedding || [];
  } catch {
    return [];
  }
}

// Cosine similarity between two vectors
function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function semanticSearch(db, query) {
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding.length) return [];

  const { results: chunks } = await db.prepare(
    "SELECT id, title, content, embedding, source FROM knowledge_chunks"
  ).all();

  const scored = [];
  for (const chunk of chunks) {
    if (!chunk.embedding) continue;
    let embedding;
    try { embedding = JSON.parse(chunk.embedding); } catch { continue; }
    const score = cosineSimilarity(queryEmbedding, embedding);
    scored.push({ ...chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ id, title, content, source, score }) => ({
    id, title, content: content.slice(0, 1000), source, score: Math.round(score * 100) / 100,
  }));
}

// ---------------------------------------------------------------------------
// OpenStreetMap — geographic search via Nominatim
// ---------------------------------------------------------------------------
export async function searchMaps(query) {
  const host = setting("MAPS_HOST") || "https://nominatim.openstreetmap.org";
  try {
    const url = `${host}/search?q=${encodeURIComponent(query)}&format=json&limit=3`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "NomadGateway/1.0" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.map((r) => ({
      name: r.display_name,
      lat: r.lat,
      lon: r.lon,
      type: r.type,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ollama — local AI health check
// ---------------------------------------------------------------------------
export async function checkOllama() {
  const host = setting("OLLAMA_HOST");
  if (!host) return false;
  try {
    const resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internet connectivity check
// ---------------------------------------------------------------------------
export async function checkInternet() {
  try {
    const resp = await fetch("https://api.telnyx.com/v2/health", {
      signal: AbortSignal.timeout(3_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
