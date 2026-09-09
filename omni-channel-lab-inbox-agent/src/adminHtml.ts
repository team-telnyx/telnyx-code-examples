/**
 * Admin UI for the omni-channel inbox agent.
 *
 * Single self-contained HTML page (matches the multi-model-inference-switcher
 * pattern). Calls the REST API — no auth needed in demo mode.
 * v1 uses simple polling (5s) for new messages instead of AgentClient WebSocket —
 * the WebSocket path is a v1.1 follow-on per PRD Open Decisions.
 *
 * The page is served from GET / and GET /admin → 302 /.
 */
export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Omni-Channel Inbox — Telnyx</title>
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
  .header .token-input {
    background: transparent;
    border: 1px solid #444;
    color: var(--telnyx-cream);
    padding: 8px 12px;
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    width: 260px;
  }
  .header .token-input::placeholder { color: #888; }
  .header-tools { display:flex; align-items:center; gap:10px; }
  .live-pill { display:flex; align-items:center; gap:7px; border:1px solid rgba(0,0,0,.45); border-radius:999px; padding:7px 11px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em; }
  .live-pill::before { content:''; width:7px; height:7px; border-radius:50%; background:#000; box-shadow:0 0 0 3px rgba(0,0,0,.12); }
  .db-link { color:#000; text-decoration:none; background:rgba(255,255,255,.48); border:1px solid rgba(0,0,0,.16); padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; }
  .db-link:hover { background:#fff; }
  .layout {
    display: grid;
    grid-template-columns: 354px 1fr;
    height: calc(100vh - 76px);
    max-width: 1680px;
    margin: 0 auto;
    background: #fff;
    box-shadow: 0 20px 60px rgba(0,0,0,.08);
  }
  .sidebar {
    background: #FDFDFB;
    border-right: 1px solid var(--telnyx-tan);
    overflow-y: auto;
  }
  .sidebar-top { padding:22px 20px 12px; }
  .sidebar-top .eyebrow { color:var(--ink-muted); font-size:10px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; }
  .sidebar-top h2 { font-family:'Space Grotesk',sans-serif; font-size:24px; letter-spacing:-.8px; margin-top:5px; }
  .sidebar .filters {
    padding: 10px 20px 16px;
    border-bottom: 1px solid var(--telnyx-tan);
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
  }
  .sidebar .filters select {
    width: 100%;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--telnyx-tan);
    border-radius: 6px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    background: white;
  }
  .sidebar .filters button {
    grid-column: 1 / -1;
    width: 100%;
    padding: 9px 14px;
    background: var(--telnyx-green);
    color: var(--telnyx-black);
    border: none;
    border: 1px solid #00C896;
    border-radius: 6px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .conv-list { padding: 10px 12px 28px; }
  .conv-item {
    padding: 12px 14px;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 6px;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }
  .conv-item:hover { background: #F0F0E9; }
  .conv-item.active { background: #E0FBF4; border-color: var(--telnyx-green-dark); box-shadow: inset 3px 0 0 var(--telnyx-green-dark); }
  .conv-item .row1 {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .conv-item .label {
    font-weight: 600;
    font-size: 14px;
    color: var(--telnyx-black);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }
  .conv-item .channel-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: uppercase;
  }
  .channel-voice { background: var(--bright-20); color: var(--telnyx-black); }
  .channel-email { background: #FFE7B0; color: var(--telnyx-black); }
  .channel-sms { background: #D8E0FF; color: var(--telnyx-black); }
  .channel-rcs { background: #FFD8E0; color: var(--telnyx-black); }
  .channel-whatsapp { background: #C8F0CC; color: var(--telnyx-black); }
.channel-fax { background: var(--telnyx-tan); color: var(--telnyx-black); }
  .conv-item .preview {
    font-size: 12px;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conv-item .meta {
    font-size: 11px;
    color: #888;
    margin-top: 4px;
    display: flex;
    justify-content: space-between;
  }
  .conv-item .unread-dot {
    width: 8px;
    height: 8px;
    background: var(--inference-blue);
    border-radius: 50%;
  }
  .thread-pane {
    display: flex;
    flex-direction: column;
    background: #F4F4EF;
    min-width: 0;
  }
  .thread-header {
    background: white;
    border-bottom: 1px solid var(--telnyx-tan);
    padding: 18px 28px;
    min-height: 76px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .thread-header .title { font-family:'Space Grotesk',sans-serif; font-weight: 700; font-size: 18px; letter-spacing:-.35px; }
  .thread-header .subtitle { color: var(--ink-muted); font-size: 12px; margin-top: 3px; }
  .thread-header .actions { display: flex; gap: 8px; }
  .thread-header button {
    padding: 6px 14px;
    border: 1px solid var(--telnyx-tan);
    background: white;
    border-radius: 6px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    cursor: pointer;
  }
  .thread-header button.primary {
    background: var(--telnyx-black);
    color: var(--telnyx-green);
    border: none;
    font-weight: 600;
  }
  .thread-header button:hover { border-color: var(--telnyx-black); }
  .thread-header button.primary:hover { background: #222; color: var(--telnyx-green); }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 32px clamp(24px,5vw,72px);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg-bubble {
    max-width: min(72%, 720px);
    padding: 14px 17px;
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.5;
  }
  .msg-bubble.inbound {
    align-self: flex-start;
    background: white;
    border: 1px solid var(--telnyx-tan);
    border-bottom-left-radius: 4px;
  }
  .msg-bubble.outbound.sent {
    align-self: flex-end;
    background: var(--inference-blue);
    color: white;
    border-bottom-right-radius: 4px;
  }
  .msg-bubble.outbound.draft {
    align-self: flex-end;
    background: var(--draft-amber);
    color: var(--telnyx-black);
    border-bottom-right-radius: 4px;
    border: 2px dashed #B8860B;
  }
  .msg-bubble.outbound.failed {
    align-self: flex-end;
    background: var(--failed-red);
    color: white;
    border-bottom-right-radius: 4px;
  }
  .msg-bubble .sender-label {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 4px;
    opacity: 0.75;
  }
  .msg-bubble.draft .draft-actions {
    margin-top: 10px;
    display: flex;
    gap: 8px;
  }
  .msg-bubble.draft textarea {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #B8860B;
    border-radius: 6px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    resize: vertical;
    min-height: 60px;
    margin-bottom: 8px;
  }
  .msg-bubble.draft button {
    padding: 6px 12px;
    border-radius: 6px;
    border: none;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
  }
  .msg-bubble.draft button.approve {
    background: var(--telnyx-black);
    color: var(--telnyx-green);
  }
  .msg-bubble.draft button.edit {
    background: white;
    color: var(--telnyx-black);
    border: 1px solid var(--telnyx-black);
  }
  .empty-state {
    text-align: center;
    padding: 80px 24px;
    color: #888;
    font-size: 14px;
  }
  .reply-bar {
    background: white;
    border-top: 1px solid var(--telnyx-tan);
    padding: 16px 24px;
    display: flex;
    gap: 12px;
  }
  .reply-bar input {
    flex: 1;
    padding: 10px 14px;
    border: 1px solid var(--telnyx-tan);
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 14px;
  }
  .reply-bar input:focus { border-color: var(--inference-blue); outline: none; }
  .reply-bar button {
    padding: 10px 22px;
    background: var(--telnyx-green);
    color: var(--telnyx-black);
    border: none;
    border-radius: 8px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
  }
  .reply-bar button:hover { background: var(--telnyx-black); color: var(--telnyx-green); }
  .reply-bar button:disabled { opacity: 0.5; cursor: not-allowed; }
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
    .brand-copy .eyebrow, .live-pill { display:none; }
    .layout { grid-template-columns: 1fr; height:auto; min-height:calc(100vh - 68px); }
    .sidebar { max-height:38vh; border-right:0; border-bottom:1px solid var(--telnyx-tan); }
    .thread-pane { min-height:62vh; }
    .messages { min-height:320px; padding:22px 16px; }
    .msg-bubble { max-width:88%; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="brand-lockup">
    <img class="logo-img" src="https://lowlatencyclub.ai/assets/images/telnyx-logo.svg" alt="Telnyx">
    <div class="brand-divider"></div>
    <div class="brand-copy">
      <div class="eyebrow">DevRel Mission Control</div>
      <h1>Omnichannel Inbox</h1>
    </div>
  </div>
  <div class="header-tools">
    <div class="live-pill">Live</div>
    <a href="/db" class="db-link">Database ↗</a>
    <button onclick="simulateFax()" style="margin-left:8px;background:var(--telnyx-green);color:#000;border:none;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Simulate incoming fax</button>
    <button onclick="bookAppointment()" style="margin-left:8px;background:var(--inference-blue);color:#fff;border:none;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Book appointment</button>
    <button onclick="completeAppointment()" style="margin-left:8px;background:#fff;color:#000;border:1px solid #000;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Mark visit complete</button>
  </div>
</div>

<div class="layout">
  <div class="sidebar">
    <div class="sidebar-top"><div class="eyebrow">Unified workspace</div><h2>Conversations</h2></div>
    <div class="filters">
      <select id="channelFilter">
        <option value="">All channels</option>
        <option value="voice">Voice</option>
        <option value="email">Email (v1.1)</option>
        <option value="sms">SMS (v2)</option>
        <option value="rcs">RCS (v2)</option>
        <option value="whatsapp">WhatsApp (v2)</option>
      </select>
      <select id="statusFilter">
        <option value="">All status</option>
        <option value="open">Open</option>
        <option value="awaiting_human">Awaiting human</option>
        <option value="closed">Closed</option>
      </select>
      <button onclick="loadConversations()">Refresh</button>
    </div>
    <div style="padding:10px 12px 4px;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Lab Documents</div>
    <div class="conv-list" id="docList" style="padding-top:4px;">
      <div class="empty-state">No lab documents yet.</div>
    </div>
    <div style="padding:10px 12px 4px;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:0.5px;">Conversations</div>
    <div class="conv-list" id="convList">
      <div class="empty-state">No conversations yet. Click Refresh or call the intake number.</div>
    </div>
  </div>
  <div class="thread-pane">
    <div class="thread-header" id="threadHeader" style="display:none;">
      <div>
        <div class="title" id="threadTitle">—</div>
        <div class="subtitle" id="threadSubtitle">—</div>
      </div>
      <div class="actions" id="threadActions"></div>
    </div>
    <div class="messages" id="messages">
      <div class="empty-state">Pick a conversation on the left to view its thread.</div>
    </div>
    <div class="reply-bar" id="replyBar" style="display:none;">
      <input type="text" id="replyInput" placeholder="Type a reply on the conversation's channel..." onkeydown="if(event.key==='Enter') sendReply()" />
      <button id="replyBtn" onclick="sendReply()">Send</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
let activeConversation = null;
let activeCustomerId = null;
let pollTimer = null;
let activeCallControlId = null;

function authHeaders() {
  return { 'Content-Type': 'application/json' };
}

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 2500);
}

let activeDocCustomerId = null;

async function simulateFax() {
  try {
    const resp = await fetch('/api/demo/simulate-fax', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast(data.error || 'simulate failed', true); return; }
    toast('Fax received — reference ' + data.reference);
    await loadDocuments();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function bookAppointment() {
  try {
    const resp = await fetch('/api/appointment/book', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast(data.error || 'booking failed', true); return; }
    if (data.sms_sent) toast('Appointment booked — confirmation texted to the patient');
    else toast('Booked, but SMS failed: ' + (data.sms_error || 'unknown'), true);
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function completeAppointment() {
  try {
    const resp = await fetch('/api/appointment/complete', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast(data.error || 'complete failed', true); return; }
    if (data.sms_sent) toast('Visit marked complete — text sent to the patient');
    else toast('Completed, but SMS failed: ' + (data.sms_error || 'unknown'), true);
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function loadDocuments() {
  try {
    const resp = await fetch('/api/documents', { headers: authHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    renderDocuments(data.documents || []);
  } catch (e) {}
}

function statusBadge(status) {
  const colors = {
    received: ['var(--draft-amber)', 'var(--telnyx-black)'],
    reviewed: ['#D8E0FF', 'var(--telnyx-black)'],
    accepted: ['var(--sent-green)', 'var(--telnyx-black)'],
    rejected: ['var(--failed-red)', 'white'],
    followed_up: ['var(--bright-20)', 'var(--telnyx-black)'],
  };
  const [bg, fg] = colors[status] || ['var(--telnyx-tan)', 'var(--telnyx-black)'];
  return '<span style="background:' + bg + ';color:' + fg + ';padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;text-transform:uppercase;">' + status + '</span>';
}

function renderDocuments(docs) {
  const list = document.getElementById('docList');
  if (!list) return;
  if (!docs.length) {
    list.innerHTML = '<div class="empty-state">No lab documents yet. Send a fax to the intake number.</div>';
    return;
  }
  list.innerHTML = '';
  docs.forEach(d => {
    const item = document.createElement('div');
    item.className = 'conv-item';
    const received = new Date(d.received_at).toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
    const canAct = d.status === 'received' || d.status === 'reviewed';
    let actions = '';
    if (d.fax_url && canAct) {
      actions += '<a href="/api/document/download?document_id=' + d.id + '&customer_id=' + (d.customer_id || '') + '" target="_blank" style="font-size:11px;font-weight:600;color:var(--inference-blue);text-decoration:none;margin-right:8px;">Download PDF</a>';
    }
    if (canAct) {
      actions += '<button data-doc="' + d.id + '" data-cust="' + (d.customer_id || '') + '" class="doc-accept" style="font-size:11px;padding:3px 10px;background:var(--sent-green);color:var(--telnyx-black);border:none;border-radius:6px;font-weight:700;cursor:pointer;margin-right:6px;">Accept</button>';
      actions += '<button data-doc="' + d.id + '" data-cust="' + (d.customer_id || '') + '" class="doc-reject" style="font-size:11px;padding:3px 10px;background:var(--failed-red);color:white;border:none;border-radius:6px;font-weight:700;cursor:pointer;">Reject</button>';
    } else if (d.status === 'followed_up') {
      const openLabel = d.opened_at ? '👀 opened ' + new Date(d.opened_at).toLocaleDateString([], {month:'short',day:'numeric'}) : '';
      actions += '<button data-doc="' + d.id + '" data-cust="' + (d.customer_id || '') + '" class="doc-opened" style="font-size:11px;padding:3px 10px;background:var(--inference-bright-10);color:var(--inference-blue);border:1px solid var(--inference-blue);border-radius:6px;font-weight:700;cursor:pointer;' + (d.opened_at ? 'display:none;' : '') + '">Simulate: patient opened email</button>';
      if (openLabel) actions += '<span style="font-size:11px;font-weight:600;color:var(--inference-blue);margin-left:8px;">' + openLabel + '</span>';
      if (d.emailed_to) actions += '<div style="font-size:10px;color:#888;margin-top:4px;">results emailed to ' + d.emailed_to + '</div>';
    } else if (d.status === 'accepted' && !d.deleted_at) {
      actions += '<span style="font-size:11px;color:#888;">deleting fax…</span>';
    }
    item.innerHTML =
      '<div class="row1">' +
      '<div class="label">' + d.reference + '</div>' +
      statusBadge(d.status) +
      '</div>' +
      '<div class="preview">from ' + (d.from_number || 'unknown') + ' · ' + received + (d.deleted_at ? ' · fax deleted' : '') + '</div>' +
      '<div style="margin-top:6px;">' + actions + '</div>';
    item.onclick = (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
      activeDocCustomerId = (d.customer_id || 'unknown');
      openConversation(d.conversation_id, activeDocCustomerId, 'fax');
    };
    list.appendChild(item);
  });
}

async function acceptDocument(docId, customerId) {
  try {
    const resp = await fetch('/api/document/accept', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ document_id: docId, customer_id: customerId }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast(data.error || 'accept failed', true); return; }
    toast('Accepted — fax deleted from Telnyx, metadata retained');
    await loadDocuments();
    const draftResp = await fetch('/api/document/draft-email', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ document_id: docId, customer_id: customerId }),
    });
    if (draftResp.ok) toast('Confirmation email drafted — review in the thread');
    await loadMessages();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function rejectDocument(docId, customerId) {
  try {
    const resp = await fetch('/api/document/reject', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ document_id: docId, customer_id: customerId }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast(data.error || 'reject failed', true); return; }
    toast('Rejected — fax deleted, no follow-up drafted');
    await loadDocuments();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function loadConversations() {
  const channel = document.getElementById('channelFilter').value;
  const status = document.getElementById('statusFilter').value;
  const params = new URLSearchParams();
  if (channel) params.set('channel', channel);
  if (status) params.set('status', status);
  try {
    const resp = await fetch('/api/conversations?' + params.toString(), { headers: authHeaders() });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      toast('Failed to load: ' + (err.error || resp.status), true);
      return;
    }
    const data = await resp.json();
    renderConversations(data.conversations || []);
  } catch (e) {
    toast('Network error: ' + e.message, true);
  }
}

function renderConversations(convs) {
  const list = document.getElementById('convList');
  if (!convs.length) {
    list.innerHTML = '<div class="empty-state">No conversations yet.</div>';
    return;
  }
  list.innerHTML = '';
  convs.forEach(c => {
    const conv = c.conversation;
    const item = document.createElement('div');
    item.className = 'conv-item' + (activeConversation === conv.id ? ' active' : '');
    item.onclick = () => openConversation(conv.id, conv.customer_id, conv.channel);
    const time = c.last_message_at ? new Date(c.last_message_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
    item.innerHTML = \`
      <div class="row1">
        <div class="label">\${conv.customer_label || conv.customer_id}</div>
        <span class="channel-badge channel-\${conv.channel}">\${conv.channel}</span>
      </div>
      <div class="preview">\${c.last_message_preview || '(no messages yet)'}</div>
      <div class="meta">
        <span>\${conv.status}</span>
        <span style="display:flex;align-items:center;gap:6px;">
          \${c.unread ? '<span class="unread-dot"></span>' : ''}
          \${time}
        </span>
      </div>
    \`;
    list.appendChild(item);
  });
}

async function openConversation(conversationId, customerId, channel) {
  activeConversation = conversationId;
  activeCustomerId = customerId;
  activeCallControlId = null;
  // Re-render sidebar highlight
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  // We can't easily find the right .conv-item by id without changing renderConversations;
  // for now we accept the visual lag on sidebar highlight.
  await loadMessages();
  // Show thread header + reply bar
  document.getElementById('threadHeader').style.display = 'flex';
  document.getElementById('replyBar').style.display = 'flex';
  document.getElementById('threadTitle').textContent = 'Conversation ' + conversationId.slice(0, 12);
  document.getElementById('threadSubtitle').textContent = 'channel: ' + channel + ' · customer: ' + customerId;
  // Actions: take over (voice only), close
  const actions = document.getElementById('threadActions');
  actions.innerHTML = '';
  if (channel === 'voice') {
    const takeBtn = document.createElement('button');
    takeBtn.className = 'primary';
    takeBtn.textContent = 'Take over';
    takeBtn.onclick = () => takeOverVoice();
    actions.appendChild(takeBtn);
    const callInput = document.createElement('input');
    callInput.type = 'text';
    callInput.placeholder = 'call_control_id (live call)';
    callInput.id = 'callControlInput';
    callInput.style.cssText = 'padding:6px 10px;border:1px solid var(--telnyx-tan);border-radius:8px;font-size:12px;width:200px;';
    actions.appendChild(callInput);
  }
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => closeConversation();
  actions.appendChild(closeBtn);
  // Start polling
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 5000);
}

async function loadMessages() {
  if (!activeConversation || !activeCustomerId) return;
  try {
    const resp = await fetch('/api/messages?conversation_id=' + encodeURIComponent(activeConversation) + '&customer_id=' + encodeURIComponent(activeCustomerId), { headers: authHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    renderMessages(data.messages || []);
  } catch (e) {
    // silent — poll will retry
  }
}

function renderMessages(msgs) {
  const container = document.getElementById('messages');
  if (!msgs.length) {
    container.innerHTML = '<div class="empty-state">No messages in this conversation yet.</div>';
    return;
  }
  container.innerHTML = '';
  msgs.forEach(m => {
    const msg = m.message;
    const div = document.createElement('div');
    const dirClass = msg.direction === 'inbound' ? 'inbound' : 'outbound ' + msg.status;
    div.className = 'msg-bubble ' + dirClass;
    let inner = '<div class="sender-label">' + m.sender_label + '</div>';
    inner += '<div class="body">' + escapeHtml(msg.body) + '</div>';
    if (msg.direction === 'outbound' && msg.status === 'draft' && msg.sender_kind === 'agent') {
      inner += '<div class="draft-actions">';
      inner += '<textarea class="draft-edit" data-id="' + msg.id + '">' + escapeHtml(msg.body) + '</textarea>';
      inner += '<button class="edit" onclick="editDraft(\\'' + msg.id + '\\')">Save edit</button>';
      inner += '<button class="approve" onclick="approveDraft(\\'' + msg.id + '\\')">Approve &amp; send</button>';
      inner += '</div>';
    }
    if (msg.email_tracking_id) {
      inner += '<div class="email-status" data-tracking="' + msg.email_tracking_id + '" style="margin-top:10px;font-size:11px;color:#888;">checking delivery…</div>';
      loadEmailStatus(msg.email_tracking_id);
    }
    div.innerHTML = inner;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

const EMAIL_STATUS_ICONS = {
  'email.queued': '⏳', 'queued': '⏳',
  'email.sending': '📤', 'sending': '📤',
  'email.sent': '✉️', 'sent': '✉️',
  'email.delivered': '✅', 'delivered': '✅',
  'email.opened': '👀', 'opened': '👀',
  'email.clicked': '🖱️', 'clicked': '🖱️',
  'email.bounced': '⛔', 'bounced': '⛔',
  'email.failed': '❌', 'failed': '❌',
  'email.unsubscribed': '🚫', 'unsubscribed': '🚫',
  'email.complained': '⚠️', 'complained': '⚠️',
};

const EMAIL_STATUS_ORDER = ['queued', 'sending', 'sent', 'delivered', 'opened', 'clicked'];

async function loadEmailStatus(trackingId) {
  try {
    const resp = await fetch('/api/email-events?message_id=' + encodeURIComponent(trackingId), { headers: authHeaders() });
    if (!resp.ok) return;
    const data = await resp.json();
    const events = data.events || [];
    const nodes = document.querySelectorAll('.email-status[data-tracking="' + trackingId + '"]');
    nodes.forEach(node => {
      if (!events.length) { node.textContent = 'no delivery events yet'; return; }
      const have = {};
      events.forEach(e => {
        const t = String(e.type || '').replace('email.', '');
        if (!have[t] || (e.occurred_at && e.occurred_at > have[t])) have[t] = e.occurred_at;
      });
      const failed = have['failed'] || have['bounced'];
      let chips = '';
      EMAIL_STATUS_ORDER.forEach(t => {
        if (have[t]) {
          chips += '<span style="margin-right:8px;">' + (EMAIL_STATUS_ICONS[t] || '•') + ' ' + t + '</span>';
        }
      });
      if (have['failed']) chips += '<span style="color:var(--failed-red);font-weight:600;">❌ failed</span>';
      if (have['bounced']) chips += '<span style="color:var(--failed-red);font-weight:600;">⛔ bounced</span>';
      node.innerHTML = '<div style="margin-top:2px;">' + chips + (failed ? '' : '') + '</div>';
    });
  } catch (e) {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function editDraft(messageId) {
  const ta = document.querySelector('textarea[data-id="' + messageId + '"]');
  if (!ta) return;
  const newBody = ta.value.trim();
  if (!newBody) { toast('Body cannot be empty', true); return; }
  try {
    const resp = await fetch('/api/draft/edit', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ message_id: messageId, body: newBody, customer_id: activeCustomerId }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'edit failed', true); return; }
    toast('Draft updated');
    await loadMessages();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function approveDraft(messageId) {
  // Save any in-progress edit first
  const ta = document.querySelector('textarea[data-id="' + messageId + '"]');
  if (ta && ta.value.trim()) {
    const newBody = ta.value.trim();
    try {
      await fetch('/api/draft/edit', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ message_id: messageId, body: newBody, customer_id: activeCustomerId }),
      });
    } catch {}
  }
  let patientEmail = null;
  try {
    const resp = await fetch('/api/document/patient-email?conversation_id=' + encodeURIComponent(activeConversation) + '&customer_id=' + encodeURIComponent(activeCustomerId), { headers: authHeaders() });
    if (resp.ok) {
      const data = await resp.json();
      patientEmail = data.email || null;
      if (!patientEmail && data.demo_default) {
        patientEmail = prompt('No patient email on file for this case yet. Enter it (it will be saved to the case):', data.demo_default);
        if (patientEmail === null) return;
        patientEmail = patientEmail.trim();
        if (!patientEmail || patientEmail.indexOf('@') === -1) {
          toast('A valid patient email is required to send', true);
          return;
        }
      }
    }
  } catch (e) {}
  if (!patientEmail) {
    patientEmail = prompt('Patient email address to send this to:', '');
    if (patientEmail === null) return;
    patientEmail = patientEmail.trim();
    if (!patientEmail || patientEmail.indexOf('@') === -1) {
      toast('A valid patient email is required to send', true);
      return;
    }
  }
  try {
    const resp = await fetch('/api/draft/approve', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ message_id: messageId, customer_id: activeCustomerId, to: patientEmail }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'approve failed', true); return; }
    toast('Approved & sent to ' + patientEmail);
    await loadMessages();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function sendReply() {
  const input = document.getElementById('replyInput');
  const text = input.value.trim();
  if (!text || !activeConversation || !activeCustomerId) return;
  document.getElementById('replyBtn').disabled = true;
  try {
    const body = {
      conversation_id: activeConversation,
      customer_id: activeCustomerId,
      text,
      operator_id: 'admin-ui',
    };
    if (activeCallControlId) body.call_control_id = activeCallControlId;
    const resp = await fetch('/api/reply', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'send failed', true); return; }
    input.value = '';
    toast('Reply sent');
    await loadMessages();
  } catch (e) { toast('Network error: ' + e.message, true); }
  document.getElementById('replyBtn').disabled = false;
}

async function takeOverVoice() {
  if (!activeConversation || !activeCustomerId) return;
  const callInput = document.getElementById('callControlInput');
  const callControlId = callInput ? callInput.value.trim() : '';
  if (!callControlId) { toast('Enter the live call_control_id', true); return; }
  try {
    const resp = await fetch('/api/takeover', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        conversation_id: activeConversation,
        customer_id: activeCustomerId,
        operator_id: 'admin-ui',
        call_control_id: callControlId,
      }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'takeover failed', true); return; }
    activeCallControlId = callControlId;
    toast('Took over — type replies below to speak them to the caller');
    document.getElementById('replyInput').placeholder = 'Type to speak to the caller (TTS)...';
  } catch (e) { toast('Network error: ' + e.message, true); }
}

async function closeConversation() {
  if (!activeConversation || !activeCustomerId) return;
  try {
    const resp = await fetch('/api/close', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ conversation_id: activeConversation, customer_id: activeCustomerId }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'close failed', true); return; }
    toast('Conversation closed');
    if (pollTimer) clearInterval(pollTimer);
    await loadConversations();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('.doc-accept, .doc-reject, .doc-opened');
  if (!btn) return;
  var docId = btn.getAttribute('data-doc');
  var customerId = btn.getAttribute('data-cust');
  if (btn.classList.contains('doc-accept')) acceptDocument(docId, customerId);
  else if (btn.classList.contains('doc-reject')) rejectDocument(docId, customerId);
  else markOpened(docId, customerId);
});

async function markOpened(docId, customerId) {
  try {
    const resp = await fetch('/api/document/mark-opened', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ document_id: docId, customer_id: customerId }),
    });
    if (!resp.ok) { const e = await resp.json().catch(() => ({})); toast(e.error || 'failed', true); return; }
    toast('Recorded: patient opened the results email');
    await loadDocuments();
  } catch (e) { toast('Network error: ' + e.message, true); }
}

loadConversations();
loadDocuments();
setInterval(loadDocuments, 10000);
</script>
</body>
</html>`;
