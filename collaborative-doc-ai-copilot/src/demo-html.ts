/** Editor page served at `GET /`. Uses the real browser `AgentClient`. */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collaborative Doc — AI Copilot</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%230e8fb3'/><text x='8' y='12' font-size='10' text-anchor='middle' fill='white' font-family='sans-serif'>AI</text></svg>">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0;
         background: #f6f7f9; color: #1a1a2e; }
  header { background: #10131c; color: #fff; padding: 12px 20px; display: flex;
           align-items: center; justify-content: space-between; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  #status { font-size: 12px; padding: 3px 10px; border-radius: 12px; background: #444; }
  #status.online { background: #0e8fb3; }
  main { display: grid; grid-template-columns: 1fr 320px; gap: 16px;
         max-width: 1100px; margin: 20px auto; padding: 0 16px; }
  textarea { width: 100%; height: 60vh; padding: 16px; border: 1px solid #d6d9e0;
             border-radius: 8px; font: 14px/1.6 ui-monospace, Menlo, monospace;
             resize: vertical; background: #fff; }
  .panel { background: #fff; border: 1px solid #d6d9e0; border-radius: 8px;
           padding: 14px; overflow-y: auto; max-height: 75vh; }
  .panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
              color: #667; margin: 0 0 10px; }
  #users span { display: inline-block; background: #e8f4f8; color: #0e6f8c;
                border-radius: 12px; padding: 3px 10px; margin: 2px; font-size: 12px; }
  .suggestion { border: 1px solid #d6d9e0; border-left: 3px solid #0e8fb3;
                border-radius: 6px; padding: 10px; margin-bottom: 10px; font-size: 12px; }
  .suggestion p { margin: 4px 0; white-space: pre-wrap; max-height: 110px; overflow: auto; }
  .suggestion button { border: 0; border-radius: 4px; padding: 5px 12px; margin-right: 6px;
                       cursor: pointer; font-size: 12px; }
  .accept { background: #0e8fb3; color: #fff; }
  .reject { background: #e4e7ec; color: #333; }
  #doc-id { color: #9aa; font-size: 12px; }
  .muted { color: #889; font-size: 12px; }
  #ask { background: #10131c; color: #fff; border: 0; border-radius: 4px;
         padding: 6px 12px; cursor: pointer; font-size: 12px; margin-bottom: 10px; }
</style>
</head>
<body>
<header>
  <h1>Collaborative Doc <span id="doc-id"></span></h1>
  <div><span id="me"></span> <span id="status">connecting…</span></div>
</header>
<main>
  <textarea id="editor" placeholder="Start typing — everyone sees your edits live, and the AI copilot suggests improvements."></textarea>
  <div class="panel">
    <h2>Participants</h2>
    <div id="users"><span class="muted">nobody yet</span></div>
    <h2 style="margin-top:18px">AI Suggestions</h2>
    <button id="ask">Ask the copilot</button>
    <div id="suggestions"><span class="muted">Edit the doc — the copilot reacts.</span></div>
  </div>
</main>
<script type="module">
import { AgentClient } from "https://esm.sh/@telnyx/edge-runtime@0.15.1/client";

const params = new URLSearchParams(location.search);
const docId = params.get("doc") || "doc_demo";
const name = params.get("name") || ("user_" + crypto.randomUUID().slice(0, 6));
document.getElementById("doc-id").textContent = "#" + docId;
document.getElementById("me").textContent = name;

const editor = document.getElementById("editor");
const usersEl = document.getElementById("users");
const suggEl = document.getElementById("suggestions");
const statusEl = document.getElementById("status");

const proto = location.protocol === "https:" ? "wss://" : "ws://";
const client = new AgentClient(proto + location.host + "/websocket?doc=" + encodeURIComponent(docId) + "&name=" + encodeURIComponent(name));

function setStatus(text, online) {
  statusEl.textContent = text;
  statusEl.className = online ? "online" : "";
}
let applying = false, editTimer = null, cursorTimer = null;

function render(state) {
  if (editor !== document.activeElement && !applying && editor.value !== state.text) {
    const pos = editor.selectionStart;
    applying = true; editor.value = state.text; applying = false;
    editor.setSelectionRange(Math.min(pos, state.text.length), Math.min(pos, state.text.length));
  }
  const users = [...new Set([...Object.keys(state.cursors || {}), name])];
  usersEl.innerHTML = "";
  users.forEach((u) => {
    const s = document.createElement("span");
    s.textContent = u === name ? u + " (you)" : u;
    usersEl.appendChild(s);
  });
  if (!users.length) usersEl.innerHTML = '<span class="muted">nobody yet</span>';
  renderSuggestions(state.suggestions || []);
}

function renderSuggestions(list) {
  suggEl.innerHTML = "";
  list.forEach((s) => {
    const card = document.createElement("div");
    card.className = "suggestion";
    const who = document.createElement("strong");
    who.textContent = s.model || "AI suggestion";
    const body = document.createElement("p");
    body.textContent = s.suggestedText;
    const accept = document.createElement("button");
    accept.className = "accept"; accept.textContent = "Accept";
    accept.onclick = () => client.stub.respondSuggestion(s.id, true);
    const reject = document.createElement("button");
    reject.className = "reject"; reject.textContent = "Reject";
    reject.onclick = () => client.stub.respondSuggestion(s.id, false);
    card.append(who, body, accept, reject);
    suggEl.appendChild(card);
  });
  if (!list.length)
    suggEl.innerHTML = '<span class="muted">Edit the doc — the copilot reacts.</span>';
}

function lineCol(text, pos) {
  const upto = text.slice(0, pos);
  const lines = upto.split("\\n");
  return { line: lines.length - 1, col: lines[lines.length - 1].length };
}

editor.addEventListener("input", () => {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => client.stub.edit(name, editor.value), 300);
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(
    () => client.stub.setCursor(name, lineCol(editor.value, editor.selectionStart)), 150);
});

document.getElementById("ask").addEventListener("click", () => {
  client.stub.requestSuggestion();
});

// First render as soon as the connection is live; then keep rendering.
let rendered = false;
client.onState((state) => {
  setStatus("live", true);
  if (!rendered) {
    rendered = true;
    editor.value = state.text || "";
    client.stub.setCursor(name, { line: 0, col: 0 });
  }
  render(state);
});

// Initial create so the document exists before the first edit.
fetch("/api/documents", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ doc_id: docId }),
});
</script>
</body>
</html>
`;

export default html;
