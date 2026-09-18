/**
 * Minimal live dashboard. Speech and tally updates stream in over WebSocket
 * (the agent's built-in connection surface via the /agents mount); votes and
 * debate control go over plain HTTP.
 */
export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Multi-Agent Debate — Live</title>
<style>
  :root { --bg:#fafafa; --card:#fff; --border:#e5e5e5; --text:#1a1a1a; --muted:#666; --pro:#1a7f37; --con:#b62324; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .arg { padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 14px; }
  .arg:last-child { border-bottom: none; }
  .who { font-weight: 600; margin-right: 8px; }
  .pro .who { color: var(--pro); }
  .con .who { color: var(--con); }
  .phase { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #eef; font-size: 12px; margin-left: 8px; }
  .tally { font-size: 14px; margin: 8px 0; }
  .bar { height: 10px; border-radius: 5px; background: #eee; overflow: hidden; display: flex; margin: 4px 0 12px; }
  .bar .pro { background: var(--pro); }
  .bar .con { background: var(--con); }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: #fff; cursor: pointer; margin-right: 8px; }
  button:hover { background: #f2f2f2; }
  input { font: inherit; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; margin-right: 8px; width: 240px; }
  #status { color: var(--muted); font-size: 12px; margin-top: 12px; }
</style>
</head>
<body>
<h1>Multi-Agent Debate</h1>
<div class="sub">Two AI agents debate a topic; the audience votes on the winner. Telnyx Edge Compute.<br>
Arguments and the tally stream live over WebSocket; votes go over HTTP.</div>

<div class="card">
  <input id="topic" placeholder="Resolved: AI will benefit humanity">
  <button onclick="startDebate()">Start debate</button>
  <button onclick="endDebate()">End &amp; declare winner</button>
  <br><br>
  <input id="debateIdInput" placeholder="Existing debate id">
  <button onclick="loadDebate()">Load existing debate</button>
  <div id="status"></div>
</div>

<div class="card" id="liveCard" style="display:none">
  <div id="topicLabel"></div>
  <div class="sub">Debate ID: <code id="debateIdLabel"></code></div>
  <div class="tally">Pro <b id="proCount">0</b> &middot; Con <b id="conCount">0</b> <span class="phase" id="phase"></span></div>
  <div class="bar"><div class="pro" id="proBar"></div><div class="con" id="conBar"></div></div>
  <div>
    <button onclick="vote('pro')">Vote pro</button>
    <button onclick="vote('con')">Vote con</button>
  </div>
  <div id="args"></div>
</div>

<script>
let debateId = "", sock = null, liveState = null;
const voterId = "audience-" + Math.random().toString(36).slice(2, 10);
function status(s, isErr) {
  const el = document.getElementById("status");
  el.textContent = s;
  el.style.color = isErr ? "#c33" : "";
}
async function api(path, body) {
  const res = await fetch(path, { method: body ? "POST" : "GET", headers: {"content-type":"application/json"}, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || ("HTTP " + res.status));
  return json;
}
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  if (typeof target !== "object" || target === null || Array.isArray(target)) target = {};
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete target[k];
    else target[k] = mergePatch(target[k], patch[k]);
  }
  return target;
}
function renderFromState(s) {
  if (!s) return;
  document.getElementById("proCount").textContent = s.tally ? s.tally.pro : 0;
  document.getElementById("conCount").textContent = s.tally ? s.tally.con : 0;
  const total = s.tally ? s.tally.pro + s.tally.con : 0;
  document.getElementById("proBar").style.width = total ? (100 * s.tally.pro / total) + "%" : "0";
  document.getElementById("conBar").style.width = total ? (100 * s.tally.con / total) + "%" : "0";
  document.getElementById("phase").textContent = s.phase ? "phase: " + s.phase + " — live (WebSocket)" : "";
  const el = document.getElementById("args");
  el.innerHTML = "";
  for (const a of s.args || []) {
    const d = document.createElement("div");
    d.className = "arg " + a.stance;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = a.stance === "pro" ? "Pro:" : "Con:";
    d.appendChild(who);
    d.appendChild(document.createTextNode(a.text));
    el.appendChild(d);
  }
  if (s.phase === "ended") {
    status(s.winner === "tie" ? "Debate ended — tie." : "Debate ended — winner: " + s.winner + ".");
  }
}
function connectWS() {
  if (sock || !debateId) return;
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  try { sock = new WebSocket(proto + location.host + "/agents/room/" + debateId); } catch { return; }
  sock.onmessage = (e) => {
    try {
      const w = JSON.parse(e.data);
      const f = w.json ?? w; // mount wraps protocol frames in a {"json": ...} envelope
      if (f.kind === "state") {
        if (f.snapshot !== undefined) liveState = f.snapshot;
        else if (f.patch !== undefined) liveState = mergePatch(liveState, f.patch);
        renderFromState(liveState);
      }
    } catch { /* malformed frame — ignore */ }
  };
  sock.onopen = () => status("Live (WebSocket) — arguments and votes push in real time.");
  sock.onclose = () => { sock = null; };
}
async function showDebate(id) {
  debateId = id;
  if (sock) { sock.close(); sock = null; }
  liveState = await api("/debate/" + debateId);
  if (!liveState || !liveState.debateId) throw new Error("Debate not found");
  document.getElementById("liveCard").style.display = "block";
  document.getElementById("topicLabel").textContent = "Topic: " + liveState.topic;
  document.getElementById("topic").value = liveState.topic || "";
  document.getElementById("debateIdInput").value = debateId;
  document.getElementById("debateIdLabel").textContent = debateId;
  renderFromState(liveState);
  connectWS();
}
async function startDebate() {
  try {
    const topic = document.getElementById("topic").value.trim() || "Resolved: AI will benefit humanity";
    const r = await api("/debate", { topic });
    await showDebate(r.debateId);
    status("Debate started — arguments stream below, then voting opens.");
  } catch (e) { status("Start failed: " + e.message, true); }
}
async function loadDebate() {
  try {
    const id = document.getElementById("debateIdInput").value.trim();
    if (!id) { status("Paste a debate id first.", true); return; }
    await showDebate(id);
    status("Loaded persisted debate state for " + id + ".");
  } catch (e) { status("Load failed: " + e.message, true); }
}
async function vote(side) {
  if (!debateId) { status("Start a debate first.", true); return; }
  try {
    const s = await api("/debate/" + debateId + "/vote", { voterId, choice: side });
    renderFromState(s);
    status("Vote recorded (" + side + "). One vote per audience member; voting again changes it.");
  } catch (e) { status("Vote failed: " + e.message, true); }
}
async function endDebate() {
  if (!debateId) { status("Start a debate first.", true); return; }
  try {
    const r = await api("/debate/" + debateId + "/end", {});
    renderFromState(await api("/debate/" + debateId));
    status(r.winner === "tie" ? "Debate ended — tie." : "Debate ended — winner: " + r.winner + ".");
  } catch (e) { status("End failed: " + e.message, true); }
}
</script>
</body>
</html>`;
}
