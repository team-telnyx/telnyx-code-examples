/**
 * Raw SQLite table viewer for the omni-channel inbox agent.
 *
 * Served at GET /db. Read-only — calls /api/db?customer_id=...&table=... to
 * dump the per-actor SQLite tables (conversations, messages) so the operator
 * can see exactly what's stored. Matches the admin UI's Telnyx-branded style.
 *
 * One actor = one customer. Pick a customer id (E.164 number or lowercased
 * email) to load that actor's database. Use "operator-default" for the
 * aggregate inbox view used by the admin UI's conversation list.
 */
export const DB_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Inbox DB — Telnyx</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --telnyx-cream: #FEFDF5;
    --telnyx-black: #000000;
    --telnyx-green: #00E3AA;
    --telnyx-tan: #E6E3D3;
    --inference-blue: #3434EF;
    --inference-bright-10: #D6EFFC;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', sans-serif;
    background: var(--telnyx-cream);
    color: var(--telnyx-black);
    min-height: 100vh;
  }
  .header {
    background: var(--telnyx-black);
    color: var(--telnyx-cream);
    padding: 18px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header .left { display: flex; align-items: center; gap: 12px; }
  .header .logo-mark {
    width: 24px;
    height: 24px;
    background: var(--telnyx-green);
    clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);
  }
  .header .logo-text {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -1px;
    text-transform: lowercase;
  }
  .header h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 16px;
    margin-left: 16px;
  }
  .header a {
    color: var(--telnyx-green);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
  }
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 32px 24px;
  }
  .bar {
    background: white;
    border: 1px solid var(--telnyx-tan);
    border-radius: 12px;
    padding: 16px 20px;
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .bar label {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 13px;
    color: #555;
  }
  .bar input, .bar select {
    padding: 8px 12px;
    border: 1px solid var(--telnyx-tan);
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    background: white;
  }
  .bar input { flex: 1; min-width: 240px; }
  .bar input:focus, .bar select:focus { border-color: var(--inference-blue); outline: none; }
  .bar button {
    padding: 8px 18px;
    background: var(--telnyx-black);
    color: var(--telnyx-green);
    border: none;
    border-radius: 8px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .bar button:hover { background: var(--inference-blue); color: white; }
  .bar button:disabled { opacity: 0.5; cursor: not-allowed; }
  .meta {
    font-size: 12px;
    color: #888;
    margin-left: auto;
  }
  .table-wrap {
    background: white;
    border: 1px solid var(--telnyx-tan);
    border-radius: 12px;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  thead th {
    background: var(--telnyx-black);
    color: var(--telnyx-green);
    padding: 10px 12px;
    text-align: left;
    font-weight: 600;
    position: sticky;
    top: 0;
    white-space: nowrap;
  }
  tbody td {
    padding: 8px 12px;
    border-top: 1px solid #eee;
    vertical-align: top;
    max-width: 380px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  tbody tr:hover { background: var(--inference-bright-10); }
  .empty {
    text-align: center;
    padding: 48px 24px;
    color: #888;
    font-size: 14px;
  }
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--telnyx-black);
    color: var(--telnyx-green);
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }
  .toast.error { background: #E5484D; color: white; }
</style>
</head>
<body>
<div class="header">
  <div class="left">
    <div class="logo-mark"></div>
    <div class="logo-text">telnyx</div>
    <h1>Inbox DB</h1>
  </div>
  <a href="/">← back to inbox</a>
</div>

<div class="container">
  <div class="bar">
    <label>customer_id</label>
    <input type="text" id="customerId" placeholder="e.g. +14155550199  or  customer@example.com  or  operator-default" />
    <label>table</label>
    <select id="table">
      <option value="conversations">conversations</option>
      <option value="messages">messages</option>
    </select>
    <label>conversation_id (messages only)</label>
    <input type="text" id="conversationId" placeholder="optional — filter messages by conversation" style="flex:0.5;" />
    <button id="loadBtn" onclick="load()">Load</button>
    <span class="meta" id="meta"></span>
  </div>

  <div class="table-wrap" id="tableWrap">
    <div class="empty">Pick a customer_id and a table, then click Load.</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function authHeaders() {
  return { 'Content-Type': 'application/json' };
}

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 2200);
}

async function load() {
  const customerId = document.getElementById('customerId').value.trim();
  const table = document.getElementById('table').value;
  const conversationId = document.getElementById('conversationId').value.trim();
  if (!customerId) { toast('customer_id is required', true); return; }
  const btn = document.getElementById('loadBtn');
  btn.disabled = true;
  btn.textContent = 'Loading...';
  const params = new URLSearchParams({ customer_id: customerId, table });
  if (conversationId) params.set('conversation_id', conversationId);
  try {
    const resp = await fetch('/api/db?' + params.toString(), { headers: authHeaders() });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'load failed: ' + resp.status, true); return; }
    const data = await resp.json();
    render(data.rows || [], data.total || 0, table);
  } catch (e) {
    toast('Network error: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Load';
  }
}

function render(rows, total, table) {
  document.getElementById('meta').textContent = rows.length + ' / ' + total + ' rows';
  const wrap = document.getElementById('tableWrap');
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty">No rows in ' + table + ' for this customer.</div>';
    return;
  }
  const cols = Object.keys(rows[0]);
  let html = '<table><thead><tr>';
  cols.forEach(c => html += '<th>' + escapeHtml(c) + '</th>');
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr>';
    cols.forEach(c => {
      let v = r[c];
      if (v === null || v === undefined) v = '';
      else if (typeof v === 'number' && c === 'ts' || c.endsWith('_at')) {
        v = new Date(v).toLocaleString();
      } else if (typeof v === 'string' && v.length > 200) {
        v = v.slice(0, 200) + '…';
      }
      html += '<td title="' + escapeHtml(String(r[c] ?? '')) + '">' + escapeHtml(String(v)) + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.getElementById('customerId').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
</script>
</body>
</html>`;
