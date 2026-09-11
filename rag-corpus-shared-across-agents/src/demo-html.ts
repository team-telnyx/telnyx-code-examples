const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>telnyx — RAG Corpus Shared Across Agents</title>
<style>
  :root {
    --bg: #0b0d0e; --panel: #131719; --border: #232a2d;
    --teal: #0fb5a9; --teal-dim: #0b8a81;
    --text: #f2f4f5; --muted: #9aa5a9;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: var(--bg); color: var(--text); max-width: 880px; margin: 0 auto;
         padding: 28px 16px 64px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--border);
           padding-bottom: 18px; margin-bottom: 20px; }
  .wordmark { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: var(--teal); }
  .tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--muted);
         border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.sub { color: var(--muted); margin: 0 0 24px; font-size: 14px; line-height: 1.5; }
  label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .1em;
          color: var(--muted); margin: 14px 0 6px; }
  input, select, textarea { width: 100%; background: var(--panel); color: var(--text);
          border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 14px; }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--teal-dim); border-color: var(--teal-dim); }
  textarea { min-height: 84px; resize: vertical; }
  button { background: var(--teal); border: none; color: #06201e; font-size: 14px; font-weight: 700;
           padding: 10px 18px; border-radius: 8px; cursor: pointer; margin-top: 14px; }
  button.ghost { background: transparent; color: var(--teal); border: 1px solid var(--teal-dim);
                 margin-left: 8px; font-weight: 600; }
  button:hover { filter: brightness(1.1); }
  button:disabled { opacity: .5; cursor: wait; }
  #answer { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
            padding: 16px; margin-top: 20px; white-space: pre-wrap; line-height: 1.55; font-size: 14px; }
  .source { background: #0f1415; border-left: 3px solid var(--teal); border-radius: 6px;
            padding: 8px 12px; margin: 8px 0; font-size: 12px; color: var(--muted); }
  .meta { color: var(--muted); font-size: 12px; margin-top: 10px; }
  .error { color: #ff8787; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border);
           color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; }
  footer a { color: var(--teal); text-decoration: none; }
</style>
</head>
<body>
<header>
  <span class="wordmark">telnyx</span>
  <span class="tag">Code Sample</span>
</header>

<h1>RAG Corpus — Shared Across Agents</h1>
<p class="sub">One embedded knowledge base (CorpusAgent), many personalities (PersonaAgent).
Ingest Telnyx platform docs, then ask the same question as support, sales, and engineering —
same sources, different voices.</p>

<label>Corpus id</label>
<input id="corpus" value="telnyx-docs">

<label>Question</label>
<textarea id="question" placeholder="How do I deploy an edge function?"></textarea>

<label>Persona</label>
<select id="persona">
  <option value="support">Support Agent</option>
  <option value="sales">Sales Engineer</option>
  <option value="engineer">Solutions Engineer</option>
</select>

<button id="ask">Ask</button>
<button id="seed" class="ghost">Seed Telnyx docs</button>
<button id="stats" class="ghost">Corpus stats</button>

<div id="answer" hidden></div>

<footer>
  <span>Telnyx — AI Communications Infrastructure</span>
  <a href="https://telnyx.com" target="_blank" rel="noopener">telnyx.com</a>
</footer>

<script>
const $ = (id) => document.getElementById(id);
const corpus = () => $("corpus").value.trim() || "telnyx-docs";
const api = (path, init) => fetch("/api/corpus/" + encodeURIComponent(corpus()) + path, init);

const SEED_DOCS = [
  { name: "knowledge/edge-compute.txt", text:
    "Telnyx Edge Compute.\\n\\nEdge Compute runs your code at the edge location closest to the caller. " +
    "Functions deploy with the Edge CLI command 'telnyx-edge ship' from a project configured in telnyx.toml. " +
    "Scaffold a stateful project with 'telnyx-edge new-func' and generate typed bindings with 'telnyx-edge types'. " +
    "Stateful actors keep durable, single-threaded state per actor id, with per-actor SQLite through " +
    "ctx.storage.sql. Bindings provide pre-authenticated access to Telnyx APIs, Cloud Storage buckets, and KV " +
    "namespaces, so deployed functions hold no API keys." },
  { name: "knowledge/inference.txt", text:
    "Telnyx Inference.\\n\\nTelnyx Inference serves OpenAI-compatible AI endpoints under " +
    "https://api.telnyx.com/v2/ai/openai — chat completions at /chat/completions and embeddings at /embeddings. " +
    "Available embedding models include thenlper/gte-large, intfloat/multilingual-e5-large, and " +
    "Qwen/Qwen3-Embedding-8B. Chat models include meta-llama/Llama-3.3-70B-Instruct. " +
    "On Edge Compute the TELNYX binding is pre-authenticated: call this.env.TELNYX.ai.openai.chat.createCompletion " +
    "and this.env.TELNYX.ai.openai.embeddings.createEmbeddings directly — no API key appears in your code." },
  { name: "knowledge/voice-api.txt", text:
    "Telnyx Voice API.\\n\\nThe Voice API gives programmatic call control over webhooks. Inbound call events " +
    "arrive as webhooks, and their Ed25519 signatures must be verified with the Telnyx SDK webhooks.unwrap call " +
    "using the account public key before the payload is trusted. Phone numbers use E.164 format, for example " +
    "+13125790015. Call control commands such as answer, transfer, gather, and hangup are issued through the " +
    "Calls API while conversation state flows through webhook events." },
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
