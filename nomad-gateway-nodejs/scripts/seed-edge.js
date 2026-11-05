// Seed knowledge_chunks on Edge SQL with real Wikipedia articles.
// Fetches articles from Wikipedia API, embeds via Telnyx Embeddings, stores in Edge SQL.
// This mirrors what the Kiwix-based seed script does with a local NOMAD server.
//
// Usage: SQLDB_ID=<id> TELNYX_API_KEY=<key> node scripts/seed-edge.js
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch { /* fine */ }

const API_KEY = process.env.TELNYX_API_KEY || process.env.NOMAD_TELNYX_API_KEY;
const SQLDB_ID = process.env.SQLDB_ID || process.env.NOMAD_SQLDB_ID;
const API_BASE = process.env.SQLDB_API_BASE || "https://api.telnyx.com/v2";

if (!API_KEY) { console.error("TELNYX_API_KEY required"); process.exit(1); }
if (!SQLDB_ID) { console.error("SQLDB_ID required"); process.exit(1); }

// Same topics as the Kiwix seed script — survival, science, geography, rights
const TOPICS = [
  "Water purification", "First aid", "Solar energy", "Agriculture",
  "Navigation", "Weather", "Shelter", "Fire", "Nutrition",
  "Sanitation", "Radio communication", "Earthquake", "Flood",
  "Tropical cyclone", "Vaccination", "Malaria", "Cholera",
  "Electricity", "Geography", "World history",
  "United Nations", "Human rights", "Climate change", "Biodiversity",
  "Morse code", "Compass", "Emergency management", "Renewable energy",
  "Telecommunications", "Internet", "Satellite", "GPS navigation device",
  "Water supply", "Food preservation", "Infectious disease",
];

const CHUNK_SIZE = 1000;

async function sqlQuery(sql, params = []) {
  const res = await fetch(`${API_BASE}/storage/sqldbs/${encodeURIComponent(SQLDB_ID)}/actions/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(params.length ? { sql, params } : { sql }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body.errors?.[0]?.detail || "query failed";
    if (res.status === 422 && detail.includes("snapshot") && detail.includes("write committed")) return {};
    throw new Error(`SQL ${res.status}: ${detail}`);
  }
  return Array.isArray(body.data) ? body.data[0] ?? {} : body.data ?? {};
}

// Fetch a Wikipedia article's plain text extract via the MediaWiki API
async function fetchWikipedia(topic) {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(topic)}&prop=extracts&explaintext=1&exlimit=1&format=json&redirects=1`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`Wikipedia ${resp.status}`);
  const data = await resp.json();
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return { title: topic, content: "" };
  // Truncate to ~4000 chars (same as getKiwixArticle)
  const content = (page.extract || "").slice(0, 4000);
  return { title: page.title || topic, content };
}

async function embed(text) {
  const resp = await fetch("https://api.telnyx.com/v2/ai/openai/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text-v1.5", input: text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.data?.[0]?.embedding || null;
}

function chunk(title, text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push({
      title: `${title} (part ${Math.floor(i / CHUNK_SIZE) + 1})`,
      content: text.slice(i, i + CHUNK_SIZE),
    });
  }
  return chunks;
}

async function main() {
  // Clear old AI-generated chunks first
  console.log("Clearing old knowledge chunks...");
  await sqlQuery("DELETE FROM knowledge_chunks");

  console.log(`Seeding ${TOPICS.length} Wikipedia articles into Edge SQL ${SQLDB_ID.slice(0, 8)}...`);
  let totalChunks = 0;

  for (const topic of TOPICS) {
    process.stdout.write(`${topic}... `);
    try {
      const { title, content } = await fetchWikipedia(topic);
      if (!content || content.length < 100) { console.log("too short, skip"); continue; }

      const chunks = chunk(title, content);
      process.stdout.write(`${content.length} chars, ${chunks.length} chunks... `);

      for (const c of chunks) {
        const vec = await embed(c.content);
        await sqlQuery(
          "INSERT OR REPLACE INTO knowledge_chunks (id, title, content, embedding, source, created_at) VALUES (?,?,?,?,?,?)",
          [crypto.randomUUID(), c.title, c.content, vec ? JSON.stringify(vec) : null, "wikipedia", new Date().toISOString()]
        );
        totalChunks++;
      }
      console.log("done");
    } catch (err) {
      console.log(`error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nSeeded ${totalChunks} chunks from ${TOPICS.length} Wikipedia articles.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
