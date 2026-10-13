/**
 * Bootstrap the Handbook Librarian: register the seed handbook source for the
 * demo company. The first POST /source births the librarian actor, shelves the
 * source with status "indexing", and arms the stable poll/reindex tasks.
 *
 * Usage:
 *   npm run bootstrap
 *
 * Reads from .env (or the environment):
 *   BASE_URL           — deployed worker URL (printed by `telnyx-edge ship`).
 *   COMPANY            — company slug (default: acme).
 *   SEED_HANDBOOK_URL  — a small handbook you control (2-5 pages).
 */

import fs from "node:fs";
import path from "node:path";

interface EnvMap {
  [key: string]: string;
}

/** Minimal .env parser — no dependencies. */
function loadDotEnv(dir: string): EnvMap {
  const out: EnvMap = {};
  try {
    const text = fs.readFileSync(path.join(dir, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in out)) out[key] = value;
    }
  } catch {
    // No .env file — fall back to the process environment only.
  }
  return out;
}

async function main(): Promise<void> {
  const file = loadDotEnv(process.cwd());
  const get = (key: string): string => process.env[key] || file[key] || "";

  const baseUrl = (get("BASE_URL") || "http://localhost:8787").replace(/\/+$/, "");
  const company = get("COMPANY") || "acme";
  const seedUrl = get("SEED_HANDBOOK_URL") || "https://acme.example.com/handbook";

  const url = `${baseUrl}/company/${company}/source`;
  console.log(`[bootstrap] POST ${url}`);
  console.log(`[bootstrap]   company: ${company}`);
  console.log(`[bootstrap]   url:     ${seedUrl}`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ company, url: seedUrl }),
    });
  } catch (err) {
    console.error(`[bootstrap] Request failed: ${(err as Error).message}`);
    console.error(
      "[bootstrap] Set BASE_URL in .env to your deployed worker URL (printed by `telnyx-edge ship`).",
    );
    process.exit(1);
  }

  const body = await res.text();
  if (!res.ok) {
    console.error(`[bootstrap] HTTP ${res.status}: ${body}`);
    process.exit(1);
  }
  const data = JSON.parse(body) as { slug?: string; taskId?: string; status?: string };
  console.log(`[bootstrap] ✓ Registered source ${data.slug} (status: ${data.status})`);
  console.log(`[bootstrap]   Embed task: ${data.taskId}`);
  console.log("[bootstrap] The librarian is polling via the stable poll:<taskId> schedule.");
  console.log("[bootstrap] Next: POST /ask to ask a policy question once the index is ready.");
}

main();
