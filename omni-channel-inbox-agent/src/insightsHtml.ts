/**
 * Email Insights dashboard for the omni-channel inbox agent.
 *
 * Served at GET /insights. Shows aggregate email engagement (sent, delivered,
 * opened, clicked, bounced) with open/click rates, plus a per-message table
 * fed by GET /api/email/insights. Matches the admin UI's Telnyx-branded style.
 */
export const INSIGHTS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Email Insights — Telnyx</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --telnyx-cream: #F7F7F2;
    --telnyx-black: #000000;
    --telnyx-green: #00E3AA;
    --telnyx-green-dark: #00B98B;
    --telnyx-tan: #E4E4DC;
    --ink-muted: #64645F;
    --ink-faint: #92928C;
    --inference-blue: #3434EF;
    --bright-20: #CCF9EE;
    --inference-bright-10: #D6EFFC;
    --draft-amber: #F4B740;
    --sent-green: #00E3AA;
    --failed-red: #E5484D;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', sans-serif;
    background: #ECECE6;
    color: var(--telnyx-black);
    min-height: 100vh;
  }
  .header {
    background: var(--telnyx-green);
    color: var(--telnyx-black);
    min-height: 76px;
    padding: 16px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header .brand-lockup {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .header .logo-img {
    display: block;
    width: 126px;
    height: auto;
  }
  .brand-divider { width: 1px; height: 28px; background: rgba(0,0,0,.3); }
  .brand-copy .eyebrow {
    font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    margin-bottom: 2px;
  }
  .header h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 18px; line-height: 1.1;
    letter-spacing: -0.45px;
  }
  .header-tools { display:flex; align-items:center; gap:10px; }
  .db-link { color:#000; text-decoration:none; background:rgba(255,255,255,.48); border:1px solid rgba(0,0,0,.16); padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; }
  .db-link:hover { background:#fff; }
  .layout {
    max-width: 1680px;
    margin: 0 auto;
    background: #fff;
    box-shadow: 0 20px 60px rgba(0,0,0,.08);
    min-height: calc(100vh - 76px);
  }
  .container {
    padding: 32px clamp(24px, 4vw, 48px);
  }
  .page-eyebrow {
    color: var(--ink-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .14em;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .page-title {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -.8px;
    margin-bottom: 24px;
  }
  .bar {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .bar .title {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 14px;
  }
  .bar .meta { font-size: 12px; color: var(--ink-muted); margin-left: auto; }
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
  .bar button:hover { background: #222; color: var(--telnyx-green); }
  .bar button:disabled { opacity: 0.5; cursor: not-allowed; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px;
    margin-bottom: 28px;
  }
  .stat-card {
    background: #fff;
    border: 1px solid var(--telnyx-tan);
    border-radius: 10px;
    padding: 18px 20px;
  }
  .stat-card .label {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin-bottom: 10px;
  }
  .stat-card .value {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 30px;
    letter-spacing: -1px;
    line-height: 1;
  }
  .stat-card .value.green { color: var(--telnyx-green-dark); }
  .stat-card .value.blue { color: var(--inference-blue); }
  .stat-card .value.red { color: var(--failed-red); }
  .stat-card .sub { font-size: 11px; color: var(--ink-faint); margin-top: 6px; }
  .table-wrap {
    background: #fff;
    border: 1px solid var(--telnyx-tan);
    border-radius: 10px;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  thead th {
    background: #FDFDFB;
    color: var(--ink-muted);
    padding: 11px 14px;
    text-align: left;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: .14em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--telnyx-tan);
    position: sticky;
    top: 0;
    white-space: nowrap;
  }
  tbody td {
    padding: 11px 14px;
    border-top: 1px solid var(--telnyx-tan);
    vertical-align: middle;
  }
  tbody tr:hover { background: #F0F0E9; }
  td .subject { font-weight: 600; }
  td .mono { font-family: 'Space Grotesk', sans-serif; font-size: 12px; color: var(--telnyx-black); }
  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge.ok    { background: var(--bright-20); color: var(--telnyx-black); }
  .badge.blue  { background: var(--inference-bright-10); color: var(--inference-blue); }
  .badge.dark  { background: var(--bright-20); color: var(--telnyx-black); }
  .badge.bad   { background: rgba(229,72,77,.12); color: var(--failed-red); }
  .badge.gray  { background: rgba(146,146,140,.16); color: var(--ink-faint); }
  .empty {
    text-align: center;
    padding: 48px 24px;
    color: var(--ink-faint);
    font-size: 14px;
  }
  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--telnyx-black);
    color: var(--telnyx-green);
    padding: 12px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 8px 30px rgba(0,0,0,0.18);
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }
  .toast.error { background: var(--failed-red); color: white; }
  @media (max-width: 850px) {
    .header { padding:12px 16px; min-height:68px; }
    .header .logo-img { width:104px; }
    .brand-copy .eyebrow { display:none; }
    .container { padding: 22px 16px; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="brand-lockup">
    <img class="logo-img" src="https://lowlatencyclub.ai/assets/images/telnyx-logo.svg" alt="Telnyx">
    <div class="brand-divider"></div>
    <div class="brand-copy">
      <div class="eyebrow">Omni-Channel Agent</div>
      <h1>Email Insights</h1>
    </div>
  </div>
  <div class="header-tools">
    <a href="/" class="db-link">&larr; back to inbox</a>
  </div>
</div>

<div class="layout">
  <div class="container">
    <div class="page-eyebrow">Engagement</div>
    <div class="page-title">Email Insights</div>

    <div class="bar">
      <span class="title">Aggregate across all sent emails</span>
      <button id="refreshBtn" onclick="load()">Refresh</button>
      <span class="meta" id="meta"></span>
    </div>

    <div class="stats" id="stats">
      <div class="stat-card"><div class="label">Sent</div><div class="value" id="s-sent">&mdash;</div><div class="sub" id="s-tracked"></div></div>
      <div class="stat-card"><div class="label">Delivered</div><div class="value green" id="s-delivered">&mdash;</div></div>
<div class="stat-card"><div class="label">Open rate</div><div class="value blue" id="s-open-rate">&mdash;</div></div>
    </div>

    <div class="table-wrap" id="tableWrap">
      <div class="empty">Loading email activity&hellip;</div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 2200);
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function badge(text, cls, title) {
  return '<span class="badge ' + cls + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + escapeHtml(text) + '</span>';
}

async function load() {
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  try {
    const resp = await fetch('/api/email/insights');
    if (!resp.ok) {
      const e = await resp.json().catch(() => ({}));
      toast(e.error || 'load failed: ' + resp.status, true);
      return;
    }
    const data = await resp.json();
    render(data);
  } catch (e) {
    toast('Network error: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

function render(data) {
  const t = data.totals || {};
  const rates = data.rates || {};
  document.getElementById('s-sent').textContent = t.sent ?? 0;
  document.getElementById('s-tracked').textContent = (t.tracked ?? 0) + ' tracked for events';
  document.getElementById('s-delivered').textContent = t.delivered ?? 0;
  document.getElementById('s-open-rate').textContent = (rates.open_rate ?? 0) + '%';

  const msgs = data.messages || [];
  document.getElementById('meta').textContent = msgs.length + ' outbound emails';
  const wrap = document.getElementById('tableWrap');
  if (!msgs.length) {
    wrap.innerHTML = '<div class="empty">No outbound emails yet. Send the results email from the inbox, then refresh.</div>';
    return;
  }
  let html = '<table><thead><tr>' +
    '<th>Recipient</th><th>Subject</th><th>Sent</th><th>Send status</th><th>Delivery</th><th>Opened</th>' +
    '</tr></thead><tbody>';
  msgs.forEach(m => {
    const sendBadge = m.status === 'sent' ? badge('sent', 'ok') : m.status === 'failed' ? badge('failed', 'bad') : badge(m.status, 'gray');
    const delBadge = m.delivered_at ? badge('delivered', 'ok', 'at ' + fmtTime(m.delivered_at)) : (m.tracked ? badge('pending', 'gray') : badge('untracked', 'gray', 'no tracking id (threaded reply)'));
    const openBadge = m.opened_at ? badge('opened', 'blue', 'at ' + fmtTime(m.opened_at)) : '<span style="color:#bbb">—</span>';
    html += '<tr>' +
      '<td class="mono">' + escapeHtml(maskEmail(m.to || '')) + '</td>' +
      '<td><span class="subject">' + escapeHtml(m.subject || '(no subject)') + '</span></td>' +
      '<td class="mono">' + fmtTime(m.sent_at) + '</td>' +
      '<td>' + sendBadge + '</td>' +
      '<td>' + delBadge + '</td>' +
      '<td>' + openBadge + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function maskEmail(s) {
  const v = String(s || '');
  const at = v.indexOf('@');
  if (at < 1) return v;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const dDot = domain.lastIndexOf('.');
  const domainName = dDot === -1 ? domain : domain.slice(0, dDot);
  const tld = dDot === -1 ? '' : domain.slice(dDot);
  const maskWord = (w) => w.length <= 2 ? w.slice(0, 1) + '•••' : w.slice(0, 1) + '•••' + w.slice(-1);
  return maskWord(local) + '@' + maskWord(domainName) + tld;
}

load();
</script>
</body>
</html>`;
