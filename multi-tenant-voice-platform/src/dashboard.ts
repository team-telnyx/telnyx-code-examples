/**
 * Multi-Tenant Voice Platform — dashboard HTML export.
 *
 * Two-column layout (one column per tenant) with live counters, rate-limit
 * progress bars, recent-calls feed, and a "Place call" form per tenant.
 *
 * Design goals:
 *   - Looks polished on a YouTube screen recording
 *   - Recording view (top-right toggle) hides debug controls and enlarges type
 *   - DEMO_MODE / LIVE_MODE pill in the header — viewer can see the source of truth
 *   - All actions feel responsive: SSE-driven counters + recent-calls feed
 *
 * Server-side this is one HTML file. The browser does the rendering. State
 * comes from polling (every 1.5s) plus Server-Sent Events for live deltas.
 */
export function dashboardHtml(opts: {
  demoMode: boolean;
  apiBase: string;
  publicBaseUrl?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Multi-Tenant Voice · Telnyx Edge Compute</title>
<style>
  :root {
    --ink: #0b1414;
    --ink-muted: #5b6663;
    --line: #e2e8e4;
    --paper: #f7f8f6;
    --a-green: #00E3AA;
    --a-green-deep: #00B98B;
    --b-blue: #3434EF;
    --b-blue-deep: #2A2AC9;
    --tan: #e7e8e0;
    --red: #cf3a3a;
    --amber: #f4b740;
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
    padding: 9px 16px;
    font-weight: 600;
  }
  button:hover { background: #2a3434; }
  button:disabled { opacity: 0.4; cursor: wait; }
  button.tenant-a { background: var(--a-green-deep); color: var(--ink); }
  button.tenant-a:hover { background: #009d77; }
  button.tenant-b { background: var(--b-blue-deep); color: white; }
  button.tenant-b:hover { background: #2020aa; }
  button.secondary {
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--line);
  }
  button.secondary:hover { background: #eef0ec; }
  input {
    border: 1px solid var(--line);
    background: #fff;
    border-radius: 8px;
    padding: 9px 12px;
    outline: none;
  }
  input:focus { border-color: var(--a-green-deep); box-shadow: 0 0 0 3px rgba(0,185,139,.18); }
  a:focus-visible, button:focus-visible, input:focus-visible {
    outline: 3px solid var(--a-green-deep);
    outline-offset: 2px;
  }

  /* ── Header ──────────────────────────────────────────── */
  .topbar {
    background: var(--ink);
    color: var(--paper);
    padding: 18px 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-mark {
    width: 36px; height: 36px;
    background: var(--a-green);
    color: var(--ink);
    border-radius: 9px;
    display: grid; place-items: center;
    font-weight: 800; font-size: 14px;
    letter-spacing: -0.02em;
  }
  .brand-title {
    font-weight: 800;
    font-size: 17px;
    letter-spacing: -0.01em;
  }
  .brand-sub {
    font-size: 11px;
    color: rgba(247,248,246,.65);
    margin-top: -1px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }
  .topbar-right { display: flex; gap: 10px; align-items: center; }
  .mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .mode-pill.live { background: var(--red); color: white; }
  .mode-pill.live::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: 50%;
    background: white;
    animation: blink 1.2s ease-in-out infinite;
  }
  .mode-pill.demo { background: var(--amber); color: var(--ink); }
  .mode-pill.demo::before {
    content: "";
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--ink);
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* ── Tenants grid ───────────────────────────────────── */
  .tenants {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 22px;
    max-width: 1400px;
    margin: 22px auto;
    padding: 0 22px;
  }
  .tenant-card {
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 6px 24px rgba(0,0,0,.04);
  }
  .tenant-card .stripe { height: 5px; }
  .tenant-card.a .stripe { background: var(--a-green); }
  .tenant-card.b .stripe { background: var(--b-blue); }
  .tenant-head {
    padding: 18px 22px 14px;
    border-bottom: 1px solid var(--line);
    background: #fbfcfb;
  }
  .tenant-head .id {
    font-size: 11px;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
  }
  .tenant-head .name {
    font-size: 22px;
    font-weight: 800;
    margin: 4px 0 0;
    letter-spacing: -0.01em;
  }
  .tenant-body { padding: 18px 22px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    margin-bottom: 18px;
  }
  .stat {
    background: var(--paper);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .stat-label {
    font-size: 10px;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .stat-value {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }
  .stat .of {
    font-size: 13px;
    color: var(--ink-muted);
    font-weight: 600;
  }
  .bar {
    height: 8px;
    background: var(--tan);
    border-radius: 999px;
    overflow: hidden;
    margin-top: 8px;
  }
  .bar-fill { height: 100%; transition: width 0.4s; border-radius: 999px; }
  .tenant-card.a .bar-fill { background: var(--a-green-deep); }
  .tenant-card.b .bar-fill { background: var(--b-blue-deep); }
  .bar-fill.warn { background: var(--amber) !important; }
  .bar-fill.full { background: var(--red) !important; }

  /* ── Place call form ─────────────────────────────────── */
  .place-form {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 8px;
    margin-bottom: 18px;
  }
  .place-form input { font-size: 13px; padding: 8px 10px; }
  .place-form button { padding: 8px 14px; font-size: 13px; }
  .place-error {
    color: var(--red);
    font-size: 12px;
    margin: -10px 0 12px;
    min-height: 16px;
  }

  /* ── Recent calls ────────────────────────────────────── */
  .recent-label {
    font-size: 11px;
    color: var(--ink-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 700;
    margin-bottom: 8px;
  }
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 280px;
    overflow-y: auto;
  }
  .recent li {
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 13px;
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: center;
    margin-bottom: 4px;
    background: var(--paper);
  }
  .recent li.empty { display: block; text-align: center; color: var(--ink-muted); padding: 20px; }
  .status-pill {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: 6px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .status-queued { background: var(--tan); color: var(--ink); }
  .status-ringing { background: #fff4d4; color: #7a5500; }
  .status-answered { background: #d6effc; color: var(--b-blue); }
  .status-completed { background: #e7f8f3; color: var(--a-green-deep); }
  .status-failed { background: #ffe5e5; color: var(--red); }
  .recent .call-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent .call-detail .dir { color: var(--ink-muted); font-size: 11px; }
  .recent .call-time { color: var(--ink-muted); font-size: 11px; font-variant-numeric: tabular-nums; }

  /* ── Recording view ─────────────────────────────────── */
  body.recording { background: #fdfdf9; }
  body.recording .topbar { padding: 22px 32px; }
  body.recording .brand-title { font-size: 20px; }
  body.recording .tenant-head .name { font-size: 26px; }
  body.recording .stat-value { font-size: 26px; }
  body.recording .recent li { padding: 13px 16px; font-size: 14px; }
  body.recording .place-form,
  body.recording .debug-only { display: none; }
  body.recording .recording-banner { display: block; }
  .recording-banner {
    display: none;
    background: var(--ink);
    color: var(--a-green);
    text-align: center;
    padding: 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  /* ── Toast ──────────────────────────────────────────── */
  .toast {
    position: fixed;
    bottom: 24px; right: 24px;
    background: var(--ink);
    color: var(--a-green);
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

  @media (max-width: 980px) {
    .tenants { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">Tx</div>
      <div>
        <div class="brand-title">Multi-Tenant Voice</div>
        <div class="brand-sub">Telnyx Edge Compute · Stateful Actors</div>
      </div>
    </div>
    <div class="topbar-right">
      ${opts.demoMode
        ? '<span class="mode-pill demo">Demo mode</span>'
        : '<span class="mode-pill live">Live · Telnyx</span>'}
      <button class="secondary" id="recording-toggle" aria-pressed="false">Recording view</button>
    </div>
  </header>

  <div class="recording-banner">Recording view · type enlarged · debug controls hidden</div>

  <main class="tenants">
    <section class="tenant-card a" data-tenant="tenant_a">
      <div class="stripe"></div>
      <div class="tenant-head">
        <div class="id">TENANT · A</div>
        <div class="name" data-bind="name">Acme Robotics</div>
      </div>
      <div class="tenant-body">
        <div class="stats">
          <div class="stat">
            <div class="stat-label">Calls this minute</div>
            <div class="stat-value"><span data-bind="rl_used">0</span><span class="of">/<span data-bind="rl_limit">10</span></span></div>
            <div class="bar"><div class="bar-fill" data-bind="rl_fill" style="width:0%"></div></div>
          </div>
          <div class="stat">
            <div class="stat-label">Active calls</div>
            <div class="stat-value"><span data-bind="ac_used">0</span><span class="of">/<span data-bind="ac_limit">5</span></span></div>
            <div class="bar"><div class="bar-fill" data-bind="ac_fill" style="width:0%"></div></div>
          </div>
        </div>

        <form class="place-form" data-place="tenant_a">
          <input type="tel" name="from" placeholder="from (E.164)" value="+15555550101" required />
          <input type="tel" name="to" placeholder="to (E.164)" value="+15555550201" required />
          <button type="submit" class="tenant-a">Place call</button>
        </form>
        <div class="place-error" data-error="tenant_a"></div>

        <div class="recent-label">Recent calls</div>
        <ul class="recent" data-recent="tenant_a">
          <li class="empty">No calls yet</li>
        </ul>
      </div>
    </section>

    <section class="tenant-card b" data-tenant="tenant_b">
      <div class="stripe"></div>
      <div class="tenant-head">
        <div class="id">TENANT · B</div>
        <div class="name" data-bind="name">Munich Finanz</div>
      </div>
      <div class="tenant-body">
        <div class="stats">
          <div class="stat">
            <div class="stat-label">Calls this minute</div>
            <div class="stat-value"><span data-bind="rl_used">0</span><span class="of">/<span data-bind="rl_limit">5</span></span></div>
            <div class="bar"><div class="bar-fill" data-bind="rl_fill" style="width:0%"></div></div>
          </div>
          <div class="stat">
            <div class="stat-label">Active calls</div>
            <div class="stat-value"><span data-bind="ac_used">0</span><span class="of">/<span data-bind="ac_limit">3</span></span></div>
            <div class="bar"><div class="bar-fill" data-bind="ac_fill" style="width:0%"></div></div>
          </div>
        </div>

        <form class="place-form" data-place="tenant_b">
          <input type="tel" name="from" placeholder="from (E.164)" value="+15555550102" required />
          <input type="tel" name="to" placeholder="to (E.164)" value="+15555550202" required />
          <button type="submit" class="tenant-b">Place call</button>
        </form>
        <div class="place-error" data-error="tenant_b"></div>

        <div class="recent-label">Recent calls</div>
        <ul class="recent" data-recent="tenant_b">
          <li class="empty">No calls yet</li>
        </ul>
      </div>
    </section>
  </main>

  <div class="toast" id="toast"></div>

  <script>
    const API_BASE = ${JSON.stringify(opts.apiBase)};
    const ORIGIN = (typeof window !== "undefined" && window.location && window.location.origin) || API_BASE;
    const API = ORIGIN;
    const DEMO_MODE = ${JSON.stringify(opts.demoMode)};

    const TENANTS = ["tenant_a", "tenant_b"];

    function $card(tenantId) { return document.querySelector('[data-tenant="' + tenantId + '"]'); }
    function $bind(tenantId, key) { return $card(tenantId).querySelector('[data-bind="' + key + '"]'); }
    function $recent(tenantId) { return document.querySelector('[data-recent="' + tenantId + '"]'); }
    function $error(tenantId) { return document.querySelector('[data-error="' + tenantId + '"]'); }

    function toast(text, kind) {
      const el = document.getElementById("toast");
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

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    }

    async function fetchJson(url, opts) {
      const res = await fetch(url, opts);
      const ct = res.headers.get("content-type") || "";
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) throw new Error(typeof body === "string" ? body : (body.error || res.statusText));
      return body;
    }

    async function refresh() {
      const data = await fetchJson(API + "/api/dashboard");
      for (const t of data.tenants) {
        const card = $card(t.tenant_id);
        if (!card) continue;
        $bind(t.tenant_id, "name").textContent = t.name;
        $bind(t.tenant_id, "rl_limit").textContent = t.rate_limit_per_minute;
        $bind(t.tenant_id, "ac_limit").textContent = t.max_concurrent_calls;
        $bind(t.tenant_id, "rl_used").textContent = t.rate_limit.used;
        $bind(t.tenant_id, "ac_used").textContent = t.active_calls;
        const rlPct = t.rate_limit.limit > 0 ? (t.rate_limit.used / t.rate_limit.limit) * 100 : 0;
        const acPct = t.max_concurrent_calls > 0 ? (t.active_calls / t.max_concurrent_calls) * 100 : 0;
        const rlFill = $bind(t.tenant_id, "rl_fill");
        const acFill = $bind(t.tenant_id, "ac_fill");
        rlFill.style.width = rlPct + "%";
        acFill.style.width = acPct + "%";
        rlFill.classList.toggle("warn", rlPct >= 60 && rlPct < 100);
        rlFill.classList.toggle("full", t.rate_limit.used >= t.rate_limit.limit);
        acFill.classList.toggle("warn", acPct >= 60 && acPct < 100);
        acFill.classList.toggle("full", t.active_calls >= t.max_concurrent_calls);

        const recent = $recent(t.tenant_id);
        recent.innerHTML = t.recent_calls.length
          ? t.recent_calls.map((c) => \`
              <li>
                <span class="status-pill status-\${c.status}">\${c.status}</span>
                <span class="call-detail"><div>\${escapeHtml(c.from_number)} → \${escapeHtml(c.to_number)}</div><div class="dir">\${c.call_control_id ? 'real · ' + c.call_control_id.slice(0, 12) : 'simulated'}</div></span>
                <span class="call-time">\${fmtTime(c.started_at)}</span>
              </li>
            \`).join("")
          : '<li class="empty">No calls yet</li>';
      }
    }

    async function placeCall(tenantId, form) {
      const data = Object.fromEntries(new FormData(form).entries());
      const errEl = $error(tenantId);
      errEl.textContent = "";
      try {
        const res = await fetchJson(API + "/api/tenants/" + tenantId + "/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: data.from, to: data.to }),
        });
        toast(\`Call queued for \${tenantId}\`);
        await refresh();
        return res;
      } catch (err) {
        errEl.textContent = err.message;
        toast(err.message, "error");
      }
    }

    document.querySelectorAll(".place-form").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const tenantId = form.getAttribute("data-place");
        placeCall(tenantId, form);
      });
    });

    document.getElementById("recording-toggle").addEventListener("click", () => {
      const on = !document.body.classList.contains("recording");
      document.body.classList.toggle("recording", on);
      document.getElementById("recording-toggle").setAttribute("aria-pressed", String(on));
      document.getElementById("recording-toggle").textContent = on ? "Exit recording view" : "Recording view";
    });

    // Live updates via SSE
    let evtSrc;
    function connect() {
      if (evtSrc) evtSrc.close();
      evtSrc = new EventSource(API + "/api/events");
      evtSrc.addEventListener("dashboard_update", () => refresh());
      evtSrc.onerror = () => setTimeout(connect, 2000);
    }

    (async () => {
      await refresh();
      connect();
    })();
  </script>
</body>
</html>`;
}
