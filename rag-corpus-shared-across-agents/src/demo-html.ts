const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RAG Corpus — Shared Across Agents</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0f17; color: #e6e9f0;
         max-width: 860px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p.sub { color: #8b93a7; margin: 0 0 24px; font-size: 14px; }
  label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .08em;
          color: #8b93a7; margin: 14px 0 6px; }
  input, select, textarea { width: 100%; box-sizing: border-box; background: #131a26; color: #e6e9f0;
          border: 1px solid #26304a; border-radius: 8px; padding: 10px 12px; font-size: 14px; }
  textarea { min-height: 84px; resize: vertical; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; }
  button { background: #3b5bdb; border: none; color: #fff; font-size: 14px; font-weight: 600;
           padding: 10px 16px; border-radius: 8px; cursor: pointer; margin-top: 14px; }
  button.ghost { background: #1b2436; color: #aab3c8; margin-left: 8px; }
  button:disabled { opacity: .5; cursor: wait; }
  #answer { background: #101724; border: 1px solid #26304a; border-radius: 10px;
            padding: 16px; margin-top: 20px; white-space: pre-wrap; line-height: 1.55; font-size: 14px; }
  .source { background: #0f1522; border-left: 3px solid #3b5bdb; border-radius: 6px;
            padding: 8px 12px; margin: 8px 0; font-size: 12px; color: #aab3c8; }
  .meta { color: #8b93a7; font-size: 12px; margin-top: 10px; }
  .error { color: #ff8787; }
</style>
</head>
<body>
<h1>RAG Corpus — Shared Across Agents</h1>
<p class="sub">One embedded knowledge base (CorpusAgent), many personalities (PersonaAgent).
Ingest docs, then ask the same question as support, sales, and engineering.</p>

<label>Corpus id</label>
<input id="corpus" value="product-docs">

<label>Question</label>
<textarea id="question" placeholder="How do I rotate an API key?"></textarea>

<label>Persona</label>
<select id="persona">
  <option value="support">Support Agent</option>
  <option value="sales">Sales Engineer</option>
  <option value="engineer">Solutions Engineer</option>
</select>

<button id="ask">Ask</button>
<button id="seed" class="ghost">Seed sample docs</button>
<button id="stats" class="ghost">Corpus stats</button>

<div id="answer" hidden></div>

<script>
const $ = (id) => document.getElementById(id);
const corpus = () => $("corpus").value.trim() || "product-docs";
const api = (path, init) => fetch("/api/corpus/" + encodeURIComponent(corpus()) + path, init);

const SEED_DOCS = [
  { name: "knowledge/api-keys.txt", text:
    "API key management.\\n\\nCreate keys in the Portal under Account Settings > API Keys. " +
    "Every key has full account access, so scope work to a dedicated key per integration. " +
    "Rotate keys quarterly: create the new key first, deploy it, then delete the old one. " +
    "Deleted keys stop working immediately; there is no grace period." },
  { name: "knowledge/rate-limits.txt", text:
    "Rate limits.\\n\\nThe inference API allows 60 requests per minute per key by default. " +
    "Bursts above the limit return HTTP 429 with a Retry-After header. " +
    "Production integrations should back off exponentially and cache embedding results " +
    "because identical inputs always produce identical vectors." },
  { name: "knowledge/edge-functions.txt", text:
    "Edge Compute functions.\\n\\nFunctions deploy with 'telnyx-edge ship' and run at the edge " +
    "closest to the caller. Stateful actors keep durable state per id; bindings provide " +
    "pre-authenticated access to Telnyx APIs, Cloud Storage buckets, and KV namespaces " +
    "without storing credentials in code." },
];

function show(node) { $("answer").hidden = false; $("answer").innerHTML = node; }

async function ask() {
  const question = $("question").value.trim();
  if (!question) return;
  $("ask").disabled = true;
  show("<em>Retrieving from the shared corpus and thinking as " + $("persona").value + "…</em>");
  try {
    const res = await api("/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona: $("persona").value, question }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.status);
    const sources = (data.sources || [])
      .map((s) => '<div class="source">[' + (s.doc) + "] score " + s.score.toFixed(3) + "</div>")
      .join("");
    show(
      "<strong>[" + data.persona + "]</strong> " + data.answer +
      (sources ? "<div class='meta'>Sources</div>" + sources : "<div class='meta'>No sources retrieved</div>")
    );
  } catch (err) {
    show("<span class='error'>Ask failed: " + err.message + "</span>");
  } finally {
    $("ask").disabled = false;
  }
}

async function seed() {
  $("seed").disabled = true;
  for (const doc of SEED_DOCS) {
    const res = await api("/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (!res.ok) { show("<span class='error'>Seeding " + doc.name + " failed: HTTP " + res.status + "</span>"); break; }
  }
  $("seed").disabled = false;
  stats();
}

async function stats() {
  try {
    const res = await api("/stats");
    const data = await res.json();
    const s = data.stats || {};
    show("<div class='meta'>Corpus <strong>" + data.corpus_id + "</strong>: " +
      (s.docs || []).length + " docs, " + (s.chunkCount ?? 0) + " chunks. " +
      "Docs: " + JSON.stringify(s.docs || []) + "</div>");
  } catch (err) {
    show("<span class='error'>Stats failed: " + err.message + "</span>");
  }
}

$("ask").onclick = ask;
$("seed").onclick = seed;
$("stats").onclick = stats;
$("question").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
</script>
</body>
</html>
`;

export default html;
