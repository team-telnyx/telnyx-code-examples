#!/usr/bin/env node
/**
 * Bootstrap the wrap desk: register the demo episode and follow the wrap
 * pipeline until the episode lands `wrapped`.
 *
 * Usage:
 *   npm run bootstrap
 *
 * Requires .env with:
 *   DEPLOY_URL   — the deployed function URL (printed by `npm run deploy`)
 *   EPISODE_URL  — optional; defaults to the Sonnet 116 public-domain mp3
 */

import { readFile } from "node:fs/promises";

const DEFAULT_EPISODE_URL =
  "https://archive.org/download/sonnet_116_librivox/sonnet_116_shakespeare_add_64kb.mp3";

async function loadEnv() {
  const env = {};
  try {
    const raw = await readFile(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // no .env — fall through to process.env
  }
  return (key) => env[key] ?? process.env[key];
}

const get = await loadEnv();
const deployUrl = (get("DEPLOY_URL") ?? "").replace(/\/+$/, "");
if (!deployUrl || deployUrl.includes("<")) {
  console.error(
    "Set DEPLOY_URL in .env to the deployed function URL.\n" +
      "`npm run deploy` (telnyx-edge ship) prints it, e.g.:\n" +
      "  DEPLOY_URL=https://show-wrap-desk-<id>.telnyxcompute.com"
  );
  process.exit(1);
}

const show = "tok-podcast";
const episodeUrl = get("EPISODE_URL") ?? DEFAULT_EPISODE_URL;

async function api(path, init) {
  const resp = await fetch(`${deployUrl}${path}`, init);
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: resp.status, body };
}

console.log(`Wrapping episode for show "${show}" at ${deployUrl}`);
const wrapped = await api("/wrap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ show, audioUrl: episodeUrl }),
});
if (wrapped.status !== 202) {
  console.error(`POST /wrap failed (HTTP ${wrapped.status}):`, JSON.stringify(wrapped.body));
  process.exit(1);
}
console.log(`Episode registered: ${wrapped.body.episodeId} (status: ${wrapped.body.status})`);

const maxAttempts = 60;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  await new Promise((r) => setTimeout(r, 5000));
  const status = await api(`/wrapstatus/${wrapped.body.episodeId}?show=${encodeURIComponent(show)}`);
  if (status.status !== 200) {
    console.warn(`  poll ${attempt}: HTTP ${status.status}`);
    continue;
  }
  const ep = status.body;
  console.log(`  poll ${attempt}: ${ep.status}${ep.error ? ` (error: ${ep.error})` : ""}`);
  if (ep.status === "wrapped") {
    console.log("\nEpisode wrapped:");
    for (const chapter of ep.chapters) {
      console.log(`  - ${chapter.title} (${chapter.start}s–${chapter.end}s)`);
    }
    console.log(`  notes: ${(ep.notesPreview || "").slice(0, 80)}...`);
    console.log(`  trailer: ${ep.trailerBytes} bytes of mp3 in the host's voice`);
    console.log("\nEpisode ledger:");
    for (const row of ep.episodes) {
      console.log(`  ${row.ep_id}  ${row.status}  ${row.audio_url}`);
    }
    process.exit(0);
  }
  if (ep.error) {
    console.error("The wrap failed:", ep.error);
    process.exit(1);
  }
}
console.error("Timed out waiting for the wrap to finish. Check the deployment logs.");
process.exit(1);
