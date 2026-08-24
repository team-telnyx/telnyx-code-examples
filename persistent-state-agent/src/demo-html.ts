import type { Env } from "./types.js";
import { demoCustomerName, demoCustomerSalesforceId, demoSenderNumber } from "./types.js";

export const BRAND_VERSION = "persistent-state-agent v0.1.0";

export function demoHtml(env: Env): string {
  const customerName = demoCustomerName(env);
  const customerPhone = demoSenderNumber(env);
  const customerSalesforceId = demoCustomerSalesforceId(env);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CustomerAgent (LangGraph on Edge) — Demo</title>
<style>
  :root { --green: #00e3aa; --bg: #0a0a0a; --card: #161616; --border: #2a2a2a; --text: #e8e8e8; --muted: #888; --amber: #f59e0b; --blue: #7ec8ff; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 24px; max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  h1 span { color: var(--green); }
  .thesis { color: var(--muted); font-size: 0.85rem; margin-bottom: 18px; line-height: 1.5; }
  .thesis strong { color: var(--green); }
  .customer-banner { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 18px; font-size: 0.85rem; }
  .customer-banner .label { color: var(--muted); margin-right: 4px; }
  .customer-banner .value { color: var(--green); font-family: monospace; }
  .customer-banner .pill { background: #0c2a23; border: 1px solid #14413a; color: var(--green); padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; }
  .card h2 { font-size: 1.05rem; margin-bottom: 12px; color: var(--green); }
  .chat-log { height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 0.85rem; line-height: 1.6; }
  .chat-log .user { color: var(--blue); }
  .chat-log .assistant { color: var(--green); }
  .input-row { display: flex; gap: 8px; }
  .input-row input { flex: 1; padding: 10px 14px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.9rem; }
  .input-row button { padding: 10px 20px; background: var(--green); color: #000; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
  .input-row button:disabled { opacity: 0.5; cursor: not-allowed; }
  .kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.78rem; }
  .kv-grid div { padding: 6px 10px; background: var(--bg); border-radius: 6px; border: 1px solid var(--border); }
  .kv-grid .label { color: var(--muted); }
  .kv-grid .value { color: var(--green); font-family: monospace; word-break: break-all; }
  .kv-grid .value.muted { color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; font-size: 0.85rem; }
  .graph-exec { font-size: 0.8rem; line-height: 1.8; }
  .graph-exec .path { font-family: monospace; font-size: 0.95rem; color: var(--green); margin-bottom: 8px; letter-spacing: 0.5px; }
  .graph-exec .path .skipped { color: var(--muted); text-decoration: line-through; }
  .graph-exec .detail { color: var(--muted); }
  .graph-exec .detail strong { color: var(--text); }
  .process-log { height: 180px; overflow-y: auto; font-size: 0.75rem; font-family: monospace; line-height: 1.8; color: var(--muted); }
  .process-log .phase { color: var(--green); }
  .process-log .turn { color: var(--amber); }
</style>
</head>
<body>
<h1>CustomerAgent on <span>Edge</span></h1>
<p class="thesis">The <strong>customer is the durable entity</strong>. SMS, voice, Salesforce, schedules, and human escalation all route into the same per-customer actor. The actor is the customer, not a conversation.</p>
<div class="customer-banner">
  <span><span class="label">demo customer:</span><span class="value">${customerName}</span></span>
  <span><span class="label">phone:</span><span class="value">${customerPhone}</span></span>
  <span><span class="label">salesforce_id:</span><span class="value">${customerSalesforceId}</span></span>
  <span class="pill">actor = customer-${customerPhone.replace(/\\D/g, "")}</span>
</div>
<div class="grid">
  <div class="card">
    <h2>Conversation (durable history)</h2>
    <div class="chat-log" id="chatLog"></div>
    <div class="input-row">
      <input type="text" id="textInput" placeholder="Send a message... (try: any update on my onboarding package?)" autocomplete="off" />
      <button id="sendBtn" onclick="sendText()">Send</button>
    </div>
  </div>
  <div class="card">
    <h2>Customer State</h2>
    <div class="kv-grid" id="customerGrid">
      <div><span class="label">phone_e164</span><br><span class="value" id="c-phone">\u2014</span></div>
      <div><span class="label">name</span><br><span class="value" id="c-name">\u2014</span></div>
      <div><span class="label">salesforce_id</span><br><span class="value" id="c-sfid">\u2014</span></div>
      <div><span class="label">channel</span><br><span class="value" id="c-channel">\u2014</span></div>
      <div><span class="label">turn</span><br><span class="value" id="c-turn">0</span></div>
      <div><span class="label">lastIntent</span><br><span class="value" id="c-intent">\u2014</span></div>
      <div><span class="label">open_tickets</span><br><span class="value muted" id="c-tickets">[]</span></div>
      <div><span class="label">latest_lead</span><br><span class="value muted" id="c-lead">null</span></div>
      <div><span class="label">escalation_pending</span><br><span class="value muted" id="c-escalation">null</span></div>
      <div><span class="label">schedule_ids</span><br><span class="value muted" id="c-schedules">[]</span></div>
    </div>
    <h2 style="margin-top:14px;">Turn State Machine</h2>
    <div class="kv-grid">
      <div><span class="label">turn</span><br><span class="value" id="s-turn">0</span></div>
      <div><span class="label">queuedTurn</span><br><span class="value" id="s-queued">0</span></div>
      <div><span class="label">processingTurn</span><br><span class="value" id="s-processing">0</span></div>
      <div><span class="label">lastSentTurn</span><br><span class="value" id="s-lastsent">0</span></div>
    </div>
    <h2 style="margin-top:14px;">Graph Execution</h2>
    <div class="graph-exec" id="graphExec"><span class="empty">No graph runs yet.</span></div>
    <h2 style="margin-top:14px;">Process Log</h2>
    <div class="process-log" id="processLog"></div>
  </div>
</div>
<script>
const PHONE = ${JSON.stringify(customerPhone)};
async function sendText() {
  const input = document.getElementById('textInput');
  const btn = document.getElementById('sendBtn');
  const text = input.value.trim();
  if (!text) return;
  btn.disabled = true;
  input.value = '';
  try {
    await fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from: PHONE }),
    });
  } catch (e) { console.error(e); }
  btn.disabled = false;
  input.focus();
  setTimeout(refresh, 400);
}
input.addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function shortJson(v) {
  if (v === null || v === undefined) return 'null';
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}
function renderGraphExec(gx) {
  if (!gx) return '<span class="empty">No graph runs yet.</span>';
  var pathParts = gx.path.split('\u2192');
  var pathHtml = pathParts.map(function(n) {
    if (n === 'action' && gx.intent !== 'lead') return '<span class="skipped">' + escapeHtml(n) + '</span>';
    return escapeHtml(n);
  }).join(' \u2192 ');
  var html = '<div class="path">' + pathHtml + '</div>';
  html += '<div class="detail"><strong>turn</strong> ' + gx.turn + ' &nbsp; <strong>intent</strong> ' + escapeHtml(gx.intent) + ' &nbsp; <strong>history</strong> ' + gx.historyCount + '</div>';
  if (gx.orderId) html += '<div class="detail"><strong>record ID</strong> ' + escapeHtml(gx.orderId) + '</div>';
  if (gx.actionResult) html += '<div class="detail"><strong>action result</strong> ' + escapeHtml(gx.actionResult) + '</div>';
  if (gx.reply) html += '<div class="detail"><strong>reply</strong> ' + escapeHtml(gx.reply.slice(0, 100)) + '</div>';
  return html;
}
async function refresh() {
  try {
    const [evRes, ctxRes] = await Promise.all([
      fetch('/events?from=' + encodeURIComponent(PHONE) + '&limit=50'),
      fetch('/context?phone=' + encodeURIComponent(PHONE)),
    ]);
    const data = await evRes.json();
    const ctx = await ctxRes.json();
    const log = document.getElementById('chatLog');
    log.innerHTML = (data.conversation || []).slice().reverse().map(r =>
      '<div class="' + r.role + '">' + r.role + ': ' + escapeHtml(r.content) + '</div>'
    ).join('');
    const c = (ctx && ctx.customer) || {};
    document.getElementById('c-phone').textContent = c.phone_e164 || '\u2014';
    document.getElementById('c-name').textContent = c.name || '\u2014';
    document.getElementById('c-sfid').textContent = c.salesforce_id || '\u2014';
    document.getElementById('c-channel').textContent = c.preferred_channel || '\u2014';
    document.getElementById('c-turn').textContent = c.turn ?? 0;
    document.getElementById('c-intent').textContent = c.lastIntent || '\u2014';
    document.getElementById('c-tickets').textContent = shortJson(c.open_tickets);
    document.getElementById('c-lead').textContent = shortJson(c.latest_lead);
    document.getElementById('c-escalation').textContent = shortJson(c.escalation_pending);
    document.getElementById('c-schedules').textContent = shortJson(c.active_schedule_ids);
    document.getElementById('s-turn').textContent = data.turnState?.turn ?? 0;
    document.getElementById('s-queued').textContent = data.turnState?.queuedTurn ?? 0;
    document.getElementById('s-processing').textContent = data.turnState?.processingTurn ?? 0;
    document.getElementById('s-lastsent').textContent = data.turnState?.lastSentTurn ?? 0;
    document.getElementById('graphExec').innerHTML = renderGraphExec(data.graphExecution);
    const plog = document.getElementById('processLog');
    plog.innerHTML = (data.processLog || []).slice().reverse().map(r =>
      '<div><span class="phase">' + escapeHtml(r.phase) + '</span> <span class="turn">turn=' + r.turn + '</span> ' + escapeHtml(r.note || '') + '</div>'
    ).join('');
  } catch (e) { console.error(e); }
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
}
