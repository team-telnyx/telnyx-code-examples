/**
 * Email Inbox Demo — dashboard HTML.
 *
 * 3-pane layout, vanilla HTML/JS, SSE for live inbound updates.
 *
 *   ┌──────────────┬──────────────────────────┬──────────────────────────┐
 *   │ Inboxes       │ Message list              │ Reader                   │
 *   │ ─────────     │ ─────────────             │ ─────────                │
 *   │ • Acme        │ ● Priya — Re: Order …     │ From: priya@…            │
 *   │   3 unread    │   2 min ago               │ Subject: Re: Order…      │
 *   │ • Cloud       │ ○ Stripe — Invoice INV…   │                          │
 *   │   12 unread   │   1 hour ago              │ [HTML body renders here] │
 *   │               │ ○ GitHub — Two-factor…    │                          │
 *   │ + New inbox   │   yesterday              │ Reply (v2)               │
 *   └──────────────┴──────────────────────────┴──────────────────────────┘
 *
 * Recording view: a `.recording` class on the body enlarges type, hides the
 * "Trigger inbound" debug button, and shows a Telnyx-style demo banner.
 */
export function dashboard(opts: {
  demoMode: boolean;
  hasTelnyxCreds: boolean;
  apiBase: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Email Inbox · Telnyx</title>
<style>
  :root {
    --ink: #0b1414;
    --ink-muted: #5b6663;
    --line: #e2e8e4;
    --paper: #f7f8f6;
    --green: #00E3AA;
    --green-deep: #00B98B;
    --tan: #e7e8e0;
    --red: #cf3a3a;
    --blue: #3434EF;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--paper);
    color: var(--ink);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  button, input, select, textarea { font: inherit; color: inherit; }
  button {
    cursor: pointer;
    background: var(--ink);
    color: var(--paper);
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-weight: 600;
  }
  button:hover { background: #2a3434; }
  button.secondary {
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--line);
  }
  button.secondary:hover { background: #eef0ec; }
  button:disabled { opacity: 0.4; cursor: wait; }
  input, select {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 8px;
    padding: 8px 10px;
    outline: none;
  }
  input:focus, select:focus { border-color: var(--green-deep); box-shadow: 0 0 0 3px rgba(0,185,139,.18); }
  a { color: var(--green-deep); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
    outline: 3px solid var(--green-deep);
    outline-offset: 2px;
  }

  .topbar {
    background: var(--green);
    color: var(--ink);
    padding: 14px 22px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(0,0,0,.1);
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-mark {
    width: 32px; height: 32px;
    background: var(--ink);
    color: var(--green);
    border-radius: 8px;
    display: grid; place-items: center;
    font-weight: 800; font-size: 13px;
    letter-spacing: -0.02em;
  }
  .brand-title {
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.01em;
  }
  .brand-sub {
    font-size: 11px;
    color: var(--ink-muted);
    margin-top: -2px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }
  .demo-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--ink);
    color: var(--green);
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .demo-pill::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 0 3px rgba(0,227,170,.3);
  }
  .demo-pill.live { background: var(--green-deep); color: white; }
  .topbar-right { display: flex; gap: 10px; align-items: center; }

  .layout {
    display: grid;
    grid-template-columns: 260px 360px 1fr;
    height: calc(100vh - 64px);
    max-width: 1600px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid var(--line);
    border-top: none;
  }
  .pane { overflow-y: auto; border-right: 1px solid var(--line); }
  .pane:last-child { border-right: none; }

  .pane-header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #fbfcfb;
  }
  .pane-header h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--ink-muted);
  }

  /* ── Inboxes pane ──────────────────────────────────────── */
  .inbox-list { list-style: none; margin: 0; padding: 8px; }
  .inbox-row {
    padding: 12px 14px;
    border-radius: 10px;
    cursor: pointer;
    transition: background .12s;
    border: 1px solid transparent;
  }
  .inbox-row:hover { background: var(--paper); }
  .inbox-row.selected {
    background: var(--paper);
    border-color: var(--line);
  }
  .inbox-row .addr {
    font-weight: 700;
    font-size: 13px;
    word-break: break-all;
  }
  .inbox-row .meta {
    font-size: 11px;
    color: var(--ink-muted);
    margin-top: 2px;
    display: flex; justify-content: space-between;
  }
  .inbox-row .badge {
    background: var(--green);
    color: var(--ink);
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 700;
  }
  .new-inbox-form {
    padding: 12px;
    border-top: 1px solid var(--line);
    display: grid;
    gap: 8px;
  }

  /* ── Message list pane ─────────────────────────────────── */
  .msg-list { list-style: none; margin: 0; padding: 0; }
  .msg-row {
    padding: 14px 18px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    transition: background .1s;
    position: relative;
  }
  .msg-row:hover { background: #f6f8f6; }
  .msg-row.selected { background: var(--paper); border-left: 3px solid var(--green); padding-left: 15px; }
  .msg-row.unread { background: #fff; }
  .msg-row.unread::before {
    content: "";
    position: absolute;
    top: 22px; left: 6px;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--green-deep);
  }
  .msg-row .from {
    font-weight: 700;
    font-size: 13px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-row .subject {
    font-size: 13px;
    color: var(--ink);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-row.unread .from,
  .msg-row.unread .subject { font-weight: 700; }
  .msg-row .preview {
    font-size: 12px;
    color: var(--ink-muted);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg-row .time {
    font-size: 11px;
    color: var(--ink-muted);
    position: absolute;
    top: 14px; right: 18px;
  }
  .empty-state {
    padding: 40px 24px;
    text-align: center;
    color: var(--ink-muted);
    font-size: 13px;
  }
  .empty-state strong { color: var(--ink); display: block; font-size: 14px; margin-bottom: 4px; }

  /* ── Reader pane ───────────────────────────────────────── */
  .reader { padding: 22px 28px; }
  .reader-empty { padding: 60px 28px; text-align: center; color: var(--ink-muted); }
  .reader-header { border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 18px; }
  .reader-subject { font-size: 22px; font-weight: 700; line-height: 1.3; margin: 0 0 8px 0; }
  .reader-meta {
    display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;
    font-size: 13px;
  }
  .reader-meta dt { color: var(--ink-muted); font-weight: 600; }
  .reader-meta dd { margin: 0; word-break: break-word; }
  .reader-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
  .reader-body { padding-top: 16px; line-height: 1.6; }
  .reader-body iframe {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    min-height: 360px;
    background: #fff;
  }
  .reader-body pre {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }

  /* ── Toast ─────────────────────────────────────────────── */
  .toast {
    position: fixed;
    bottom: 24px; right: 24px;
    background: var(--ink);
    color: var(--green);
    padding: 12px 18px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity .2s, transform .2s;
    pointer-events: none;
    z-index: 100;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.error { background: var(--red); color: white; }

  /* ── Recording view: enlarge, simplify ─────────────────── */
  body.recording { background: #fdfdf9; }
  body.recording .topbar { background: var(--green); }
  body.recording .layout {
    height: calc(100vh - 70px);
    box-shadow: 0 6px 32px rgba(0,0,0,.08);
    border-radius: 14px;
    margin: 8px auto;
    overflow: hidden;
  }
  body.recording { font-size: 16px; }
  body.recording .reader-subject { font-size: 26px; }
  body.recording .pane-header h2 { font-size: 13px; }
  body.recording .inbox-row .addr { font-size: 15px; }
  body.recording .msg-row { padding: 18px 22px; }
  body.recording .msg-row .from,
  body.recording .msg-row .subject { font-size: 15px; }
  body.recording .msg-row .preview { font-size: 14px; }
  body.recording .new-inbox-form,
  body.recording .debug-btn { display: none; }
  body.recording .recording-hint { display: block; }
  .recording-hint { display: none; padding: 14px 22px; background: var(--tan); color: var(--ink); font-size: 13px; border-bottom: 1px solid var(--line); }

  .debug-btn {
    background: transparent;
    border: 1px dashed var(--line);
    color: var(--ink-muted);
    padding: 6px 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .debug-btn:hover { background: var(--paper); color: var(--ink); }
</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">Tx</div>
      <div>
        <div class="brand-title">Email Inbox</div>
        <div class="brand-sub">Telnyx Email API · Inbound</div>
      </div>
    </div>
    <div class="topbar-right">
      ${opts.demoMode
        ? '<span class="demo-pill">Demo mode</span>'
        : opts.hasTelnyxCreds
          ? '<span class="demo-pill live">Live</span>'
          : '<span class="demo-pill">No credentials</span>'}
      <button class="secondary" id="recording-toggle" aria-pressed="false">Recording view</button>
      ${opts.demoMode
        ? '<button class="debug-btn" id="trigger-btn" title="Inject one simulated inbound now">Trigger inbound</button>'
        : ""}
    </div>
  </header>

  <div class="recording-hint">Recording view: type enlarged, debug controls hidden, demo banner on.</div>

  <main class="layout">
    <aside class="pane" id="inboxes-pane">
      <div class="pane-header"><h2>Inboxes</h2><span id="inbox-count" style="font-size:11px;color:var(--ink-muted);"></span></div>
      <ul class="inbox-list" id="inbox-list"></ul>
      ${opts.demoMode
        ? `<form class="new-inbox-form" id="new-inbox-form">
             <input type="text" id="new-inbox-username" placeholder="username" value="support" />
             <input type="text" id="new-inbox-domain" placeholder="subdomain" value="telnyx-demo" />
             <button type="submit">+ Add inbox</button>
           </form>`
        : ""}
    </aside>

    <section class="pane" id="messages-pane">
      <div class="pane-header">
        <h2 id="messages-pane-title">Inbox</h2>
        <select id="status-filter" style="font-size:11px;padding:4px 6px;">
          <option value="all">All</option>
          <option value="received">Unread</option>
          <option value="read">Read</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <ul class="msg-list" id="msg-list"></ul>
    </section>

    <section class="pane" id="reader-pane">
      <div class="pane-header"><h2>Reader</h2><span id="reader-meta-summary"></span></div>
      <div id="reader"></div>
    </section>
  </main>

  <div class="toast" id="toast"></div>

  <script>
    const API = ${JSON.stringify(opts.apiBase)};
    const DEMO_MODE = ${JSON.stringify(opts.demoMode)};

    const state = {
      inboxes: [],
      selectedInboxId: null,
      messages: [],
      selectedMessageId: null,
      statusFilter: "all",
      recording: false,
    };

    const $ = (id) => document.getElementById(id);
    const inboxListEl = $("inbox-list");
    const msgListEl = $("msg-list");
    const readerEl = $("reader");
    const inboxCountEl = $("inbox-count");
    const messagesTitleEl = $("messages-pane-title");
    const readerSummaryEl = $("reader-meta-summary");

    function toast(text, kind) {
      const el = $("toast");
      el.textContent = text;
      el.className = "toast show" + (kind === "error" ? " error" : "");
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { el.className = "toast"; }, 2400);
    }

    function fmtTime(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diff = (now - d) / 1000;
      if (diff < 60) return "just now";
      if (diff < 3600) return Math.floor(diff / 60) + "m ago";
      if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
      return d.toLocaleDateString();
    }

    async function fetchJson(url, opts) {
      const res = await fetch(url, opts);
      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) throw new Error(typeof body === "string" ? body : (body.error || res.statusText));
      return body;
    }

    async function loadInboxes() {
      state.inboxes = await fetchJson(API + "/api/inboxes");
      inboxCountEl.textContent = state.inboxes.length + " total";
      inboxListEl.innerHTML = state.inboxes.length
        ? state.inboxes.map((ib) => \`
            <li class="inbox-row \${ib.id === state.selectedInboxId ? "selected" : ""}"
                data-id="\${ib.id}">
              <div class="addr">\${ib.email_address}</div>
              <div class="meta">
                <span>\${ib.source === "demo" ? "Demo" : "Live"} · \${ib.status}</span>
                <span class="badge" data-inbox-id="\${ib.id}" data-unread></span>
              </div>
            </li>
          \`).join("")
        : '<li class="empty-state"><strong>No inboxes yet</strong>Add one to start receiving.</li>';
      inboxListEl.querySelectorAll(".inbox-row").forEach((row) => {
        row.addEventListener("click", () => selectInbox(row.dataset.id));
      });
      updateUnreadBadges();
      if (!state.selectedInboxId && state.inboxes.length) selectInbox(state.inboxes[0].id);
    }

    function updateUnreadBadges() {
      const counts = {};
      state.messages.forEach((m) => { if (m.status === "received") counts[m.inbox_id] = (counts[m.inbox_id] || 0) + 1; });
      document.querySelectorAll("[data-unread]").forEach((el) => {
        const c = counts[el.dataset.inboxId] || 0;
        el.textContent = c > 0 ? c + " unread" : "0";
      });
    }

    async function selectInbox(id) {
      state.selectedInboxId = id;
      const ib = state.inboxes.find((i) => i.id === id);
      messagesTitleEl.textContent = ib ? ib.email_address : "Inbox";
      inboxListEl.querySelectorAll(".inbox-row").forEach((row) => {
        row.classList.toggle("selected", row.dataset.id === id);
      });
      await loadMessages();
    }

    async function loadMessages() {
      if (!state.selectedInboxId) { state.messages = []; renderMessages(); return; }
      const statusParam = state.statusFilter === "all" ? "" : "?status=" + state.statusFilter;
      state.messages = await fetchJson(API + "/api/inboxes/" + state.selectedInboxId + "/messages" + statusParam);
      renderMessages();
      updateUnreadBadges();
    }

    function renderMessages() {
      const list = state.messages;
      msgListEl.innerHTML = list.length
        ? list.map((m) => \`
            <li class="msg-row \${m.status === "received" ? "unread" : ""} \${m.id === state.selectedMessageId ? "selected" : ""}"
                data-id="\${m.id}">
              <div class="from">\${escapeHtml(m.from_name || m.from_address)}</div>
              <div class="subject">\${escapeHtml(m.subject || "(no subject)")}</div>
              <div class="preview">\${escapeHtml(m.preview || "")}</div>
              <div class="time">\${fmtTime(m.received_at)}</div>
            </li>
          \`).join("")
        : '<li class="empty-state"><strong>Inbox empty</strong>' + (DEMO_MODE ? "Trigger an inbound from the top bar." : "Send a message to your inbox address.") + '</li>';
      msgListEl.querySelectorAll(".msg-row").forEach((row) => {
        row.addEventListener("click", () => selectMessage(row.dataset.id));
      });
    }

    async function selectMessage(id) {
      state.selectedMessageId = id;
      msgListEl.querySelectorAll(".msg-row").forEach((row) => {
        row.classList.toggle("selected", row.dataset.id === id);
      });
      const msg = await fetchJson(API + "/api/messages/" + id);
      renderReader(msg);
      // Mark read
      if (msg.status === "received") {
        await fetchJson(API + "/api/messages/" + id + "/read", { method: "POST" });
        msg.status = "read";
        loadMessages();
      }
    }

    function renderReader(msg) {
      readerSummaryEl.textContent = msg.status;
      readerEl.innerHTML = msg.body_html
        ? \`<div class="reader">
             <div class="reader-header">
               <h1 class="reader-subject">\${escapeHtml(msg.subject || "(no subject)")}</h1>
               <dl class="reader-meta">
                 <dt>From</dt><dd>\${escapeHtml(msg.from_name || "")} &lt;\${escapeHtml(msg.from_address)}&gt;</dd>
                 <dt>To</dt><dd>\${escapeHtml(msg.to_addresses)}</dd>
                 \${msg.cc_addresses ? '<dt>Cc</dt><dd>' + escapeHtml(msg.cc_addresses) + '</dd>' : ''}
                 <dt>Received</dt><dd>\${new Date(msg.received_at).toLocaleString()}</dd>
               </dl>
               <div class="reader-actions">
                 <button class="secondary" id="archive-btn">Archive</button>
                 <button class="secondary" id="delete-btn">Delete</button>
               </div>
             </div>
             <div class="reader-body">
               <iframe sandbox srcdoc="\${escapeAttr(msg.body_html)}"></iframe>
               \${msg.body_text ? '<details style="margin-top:10px;"><summary style="cursor:pointer;color:var(--ink-muted);font-size:12px;">Plain text</summary><pre>' + escapeHtml(msg.body_text) + '</pre></details>' : ''}
             </div>
           </div>\`
        : \`<div class="reader">
             <div class="reader-header">
               <h1 class="reader-subject">\${escapeHtml(msg.subject || "(no subject)")}</h1>
               <dl class="reader-meta">
                 <dt>From</dt><dd>\${escapeHtml(msg.from_address)}</dd>
                 <dt>To</dt><dd>\${escapeHtml(msg.to_addresses)}</dd>
                 <dt>Received</dt><dd>\${new Date(msg.received_at).toLocaleString()}</dd>
               </dl>
             </div>
             <div class="reader-body"><pre>\${escapeHtml(msg.body_text || "(empty body)")}</pre></div>
           </div>\`;
      const arc = $("archive-btn");
      const del = $("delete-btn");
      if (arc) arc.onclick = async () => { await fetchJson(API + "/api/messages/" + msg.id + "/archive", { method: "POST" }); toast("Archived"); await loadMessages(); };
      if (del) del.onclick = async () => { await fetchJson(API + "/api/messages/" + msg.id + "/delete", { method: "POST" }); toast("Deleted"); state.selectedMessageId = null; readerEl.innerHTML = '<div class="reader-empty">Select a message to read it.</div>'; await loadMessages(); };
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    }
    function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

    // ── SSE ─────────────────────────────────────────────
    let evtSrc;
    function connectSSE() {
      if (evtSrc) evtSrc.close();
      evtSrc = new EventSource(API + "/api/events");
      evtSrc.addEventListener("inbox_created", () => loadInboxes());
      evtSrc.addEventListener("message_received", (ev) => {
        const data = JSON.parse(ev.data);
        toast("New email from " + (data.from_name || data.from_address));
        if (data.inbox_id === state.selectedInboxId) loadMessages();
        else updateUnreadBadges();
      });
      evtSrc.addEventListener("message_status", () => { if (state.selectedInboxId) loadMessages(); });
      evtSrc.onerror = () => setTimeout(connectSSE, 2000);
    }

    // ── Wiring ──────────────────────────────────────────
    $("status-filter").addEventListener("change", (e) => {
      state.statusFilter = e.target.value;
      loadMessages();
    });

    $("recording-toggle").addEventListener("click", () => {
      state.recording = !state.recording;
      document.body.classList.toggle("recording", state.recording);
      $("recording-toggle").setAttribute("aria-pressed", String(state.recording));
      $("recording-toggle").textContent = state.recording ? "Exit recording view" : "Recording view";
    });

    if (DEMO_MODE) {
      const trigger = $("trigger-btn");
      if (trigger) trigger.addEventListener("click", async () => {
        if (!state.selectedInboxId) return;
        await fetchJson(API + "/api/demo/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inbox_id: state.selectedInboxId }) });
        toast("Injected simulated inbound");
      });

      $("new-inbox-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = $("new-inbox-username").value.trim();
        const domain = $("new-inbox-domain").value.trim();
        if (!username || !domain) return;
        try {
          await fetchJson(API + "/api/inboxes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, domain }) });
          toast("Inbox created");
          $("new-inbox-username").value = "";
          await loadInboxes();
        } catch (err) { toast("Failed: " + err.message, "error"); }
      });
    }

    (async () => {
      await loadInboxes();
      connectSSE();
    })();
  </script>
</body>
</html>`;
}
