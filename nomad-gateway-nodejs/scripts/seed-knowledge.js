// Seed the knowledge_chunks table with popular Wikipedia articles from Kiwix.
// Fetches articles, chunks them, embeds via Telnyx Embeddings API, stores in DB.
//
// Usage: npm run seed
//
// Requires: KIWIX_HOST running with a Wikipedia ZIM loaded, TELNYX_API_KEY set.
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env
try { process.loadEnvFile(path.join(__dirname, "..", ".env")); } catch { /* fine */ }

// Import project modules
const { openDb } = await import("../db.js");
const { searchKiwix, getKiwixArticle, embedText } = await import("../knowledge.js");
const { setting } = await import("../settings.js");

// Popular topics to seed
const SEED_TOPICS = [
  "Water purification", "First aid", "Solar energy", "Agriculture",
  "Navigation", "Weather", "Shelter", "Fire", "Nutrition",
  "Sanitation", "Radio communication", "Earthquake", "Flood",
  "Tropical cyclone", "Vaccination", "Malaria", "Cholera",
  "Electricity", "Mathematics", "Geography", "World history",
  "United Nations", "Human rights", "Climate change", "Biodiversity",
];

const CHUNK_SIZE = 1000; // characters per chunk

function chunkText(title, text) {
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
  console.log("Opening database...");
  const { db } = await openDb(path.join(__dirname, "..", "data"));

  const kiwixHost = setting("KIWIX_HOST");
  if (!kiwixHost) {
    console.error("KIWIX_HOST not set — start Kiwix with a Wikipedia ZIM first.");
    process.exit(1);
  }

  const apiKey = setting("TELNYX_API_KEY");
  if (!apiKey) {
    console.warn("TELNYX_API_KEY not set — chunks will be stored without embeddings.");
  }

  let totalChunks = 0;

  for (const topic of SEED_TOPICS) {
    console.log(`Searching: ${topic}`);
    const results = await searchKiwix(topic);
    if (!results.length) {
      console.log(`  No results for "${topic}"`);
      continue;
    }

    const first = results[0];
    console.log(`  Fetching: ${first.title}`);
    const content = await getKiwixArticle(first.zim, first.path);
    if (!content || content.length < 100) {
      console.log(`  Article too short, skipping`);
      continue;
    }

    const chunks = chunkText(first.title, content);
    console.log(`  Chunking into ${chunks.length} pieces`);

    for (const chunk of chunks) {
      let embedding = null;
      if (apiKey) {
        const vec = await embedText(chunk.content);
        if (vec.length) embedding = JSON.stringify(vec);
      }

      await db.prepare(
        "INSERT OR REPLACE INTO knowledge_chunks (id, title, content, embedding, source, created_at) VALUES (?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(), chunk.title, chunk.content,
        embedding, "kiwix", new Date().toISOString()
      ).run();
      totalChunks++;
    }

    // Rate limit to be kind to Kiwix and Telnyx APIs
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone! Seeded ${totalChunks} knowledge chunks from ${SEED_TOPICS.length} topics.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
