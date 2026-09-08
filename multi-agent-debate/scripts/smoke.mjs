// Smoke test: run against a live edge runtime (`npm start`, or set DEMO_BASE_URL).
// Exercises the full debate flow in demo mode: start → vote → status → end.
const baseUrl = process.env.DEMO_BASE_URL || "http://localhost:8787";
const topic = `Smoke debate ${new Date().toISOString()}`;

async function json(path, method = "GET", body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

// ── Start the debate (demo mode: canned arguments, no inference call) ────
const started = await json("/debate", "POST", { topic });
if (!started.debateId) throw new Error("start did not return a debateId");
if (started.status !== "voting") throw new Error(`expected phase "voting" after both arguments, got "${started.status}"`);
const debateId = started.debateId;

// ── Cast one vote per side ───────────────────────────────────────────────
await json(`/debate/${debateId}/vote`, "POST", { voterId: "smoke-pro", choice: "pro" });
await json(`/debate/${debateId}/vote`, "POST", { voterId: "smoke-con", choice: "con" });
await json(`/debate/${debateId}/vote`, "POST", { voterId: "smoke-con", choice: "con" }); // same voter changes vote

// ── Fetch status: two arguments, tally matches the deduplicated votes ────
const state = await json(`/debate/${debateId}`);
if (state.args?.length !== 2) throw new Error(`expected 2 arguments, got ${state.args?.length}`);
if (state.tally?.pro !== 1 || state.tally?.con !== 2) {
  throw new Error(`unexpected tally ${JSON.stringify(state.tally)} (expected pro=1, con=2)`);
}

// ── End the debate: con wins on the tally above ──────────────────────────
const result = await json(`/debate/${debateId}/end`, "POST");
if (result.winner !== "con") throw new Error(`expected winner "con", got "${result.winner}"`);
if (result.finalVotes?.pro !== 1 || result.finalVotes?.con !== 2) {
  throw new Error(`unexpected finalVotes ${JSON.stringify(result.finalVotes)}`);
}
if (result.totalArguments !== 2) throw new Error(`expected 2 totalArguments, got ${result.totalArguments}`);

// ── Voting after the end must be refused ─────────────────────────────────
const closed = await fetch(`${baseUrl}/debate/${debateId}/vote`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ voterId: "smoke-late", choice: "pro" }),
});
if (closed.ok) throw new Error("voting should be refused after the debate ended");

console.log(`Smoke test passed for ${debateId}`);
