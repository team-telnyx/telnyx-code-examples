import type { Grouped, Report } from "./index";

export interface DashboardInput {
  day: string;
  group: string;
  demo: boolean;
  report: Report | null;
  error: string | null;
}

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, '&#39;');

const int = (v: unknown): string => Number(v ?? 0).toLocaleString("en-US");
const usd = (v: unknown): string => `$${Number(v ?? 0).toFixed(4)}`;
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

const SERVICE_COLORS: Record<string, string> = {
  support: "#00E3AA",
  billing: "#4D7CFE",
  docs: "#FFB13C",
};

const serviceColor = (service: string): string => SERVICE_COLORS[service] ?? "#8A8F98";

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function donut(rows: { service: string; requests: number }[], total: number, baseline: Map<string, number>): string {
  const C = 2 * Math.PI * 70;
  const B = 2 * Math.PI * 88;
  let cum = 0;
  const segs: string[] = [];
  for (const r of rows) {
    const frac = total > 0 ? r.requests / total : 0;
    const len = frac * C;
    segs.push(
      `<circle r="70" cx="110" cy="110" fill="none" stroke="${serviceColor(r.service)}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-cum * C).toFixed(2)}" transform="rotate(-90 110 110)" />`,
    );
    cum += frac;
  }
  let bcum = 0;
  const baseSegs: string[] = [];
  for (const [service, share] of [...baseline.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const len = share * B;
    baseSegs.push(
      `<circle r="88" cx="110" cy="110" fill="none" stroke="${serviceColor(service)}" stroke-width="7" stroke-dasharray="${len.toFixed(2)} ${(B - len).toFixed(2)}" stroke-dashoffset="${(-bcum * B).toFixed(2)}" transform="rotate(-90 110 110)" opacity="0.55" />`,
    );
    bcum += share;
  }
  return `<svg viewBox="0 0 220 220" class="wheel" role="img" aria-label="Spend attribution wheel">${baseSegs.join("")}${segs.join("")}</svg>`;
}

function bars(items: Grouped[], color: (v: string) => string): string {
  if (items.length === 0) return `<p class="muted small">no attribution rows for this day yet</p>`;
  const max = Math.max(...items.map((g) => g.requests), 1);
  return items
    .map(
      (g) => `<div class="bar-row"><span class="bar-label">${esc(g.value)}</span><span class="bar-track"><span class="bar-fill" style="width:${((g.requests / max) * 100).toFixed(1)}%;background:${color(g.value)}"></span></span><span class="bar-num">${int(g.requests)} · ${usd(g.spend)}</span></div>`,
    )
    .join("");
}

function noteBadge(note: string | null): string {
  if (note === "anomaly") return `<span class="badge anomaly">ANOMALY</span>`;
  if (note === "recovery") return `<span class="badge recovery">RECOVERY</span>`;
  if (note === "continued") return `<span class="badge continued">CONTINUED</span>`;
  return `<span class="badge ok">OK</span>`;
}

function srcBadge(source: string): string {
  if (source === "gateway") return `<span class="badge live">GATEWAY</span>`;
  if (source === "synthetic") return `<span class="badge demo">SEEDED</span>`;
  return `<span class="badge ok">${esc(source)}</span>`;
}

export function renderDashboard(input: DashboardInput): string {
  const { day, group, demo, error } = input;
  const report = input.report;
  const rows = report?.rows ?? [];
  const totals = report?.totals;
  const totalRequests = Number(totals?.requests ?? 0);
  const baseline = new Map<string, number>();
  for (const r of rows) {
    const ratio = Number(r.baseline_ratio ?? 0);
    if (ratio > 0) baseline.set(r.service, Number(r.requests ?? 0) / (ratio > 0 ? ratio : 1));
  }
  const baseTotal = [...baseline.values()].reduce((a, b) => a + b, 0);
  const baselineShares = new Map<string, number>();
  for (const [service, req] of baseline) {
    baselineShares.set(service, baseTotal > 0 ? req / baseTotal : 0);
  }
  const usage = report?.usage ?? null;
  const byTenant = report?.byTenant ?? [];
  const byEnv = report?.byEnv ?? [];

  const table = rows.length
    ? `<table>
  <thead><tr><th>Service</th><th>Requests</th><th>Share</th><th>Baseline</th><th>×Baseline</th><th>Input tok</th><th>Output tok</th><th>Spend</th><th>Reserved</th><th>Unknown</th><th>Source</th><th>Status</th></tr></thead>
  <tbody>${rows
    .map((r) => {
      const share = totalRequests > 0 ? Number(r.requests ?? 0) / totalRequests : 0;
      const baseShare = baselineShares.get(r.service) ?? 0;
      return `<tr><td><span class="dot" style="background:${serviceColor(r.service)}"></span>${esc(r.service)}</td><td class="num">${int(r.requests)}</td><td class="num">${pct(share)}</td><td class="num">${pct(baseShare)}</td><td class="num ${Number(r.baseline_ratio ?? 0) >= 1.5 ? "hot" : ""}">${Number(r.baseline_ratio ?? 0).toFixed(2)}×</td><td class="num">${int(r.input_tokens)}</td><td class="num">${int(r.output_tokens)}</td><td class="num">${usd(r.spend)}</td><td class="num">${usd(r.reserved_spend)}</td><td class="num">${int(r.unknown_requests)}</td><td>${srcBadge(String(r.source ?? ""))}</td><td>${noteBadge(r.note ?? null)}</td></tr>`;
    })
    .join("")}</tbody>
  <tfoot><tr><td>Total</td><td class="num">${int(totalRequests)}</td><td class="num">100.0%</td><td class="num">—</td><td class="num">—</td><td class="num">${int(totals?.input_tokens ?? 0)}</td><td class="num">${int(totals?.output_tokens ?? 0)}</td><td class="num">${usd(totals?.spend ?? 0)}</td><td class="num">${usd(totals?.reserved_spend ?? 0)}</td><td class="num">${int(totals?.unknown_requests ?? 0)}</td><td>—</td></tr></tfoot>
</table>`
    : `<div class="empty"><p>No ledger rows for <strong>${esc(day)}</strong>.</p><p class="muted small">Run <code>python traffic.py --days 7</code> to seed baseline history, then <code>python traffic.py --profile spike</code> and <code>python traffic.py --profile recovery</code> to turn the wheel.</p></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Telnyx · Attribution Wheel</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%23000'/%3E%3Cpath d='M5 7h14l-9 10H5z' fill='%2300E3AA'/%3E%3C/svg%3E">
<style>
:root{color-scheme:dark;--bg:#000;--panel:#0b0d10;--panel2:#12161b;--line:#232a31;--ink:#f2f5f7;--muted:#8a929b;--green:#00E3AA;--blue:#4D7CFE;--amber:#FFB13C;--red:#FF4A5E}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1120px;margin:0 auto;padding:24px 20px 48px}
header{display:flex;align-items:center;gap:14px;padding:6px 0 18px;border-bottom:1px solid var(--line)}
.logo{width:34px;height:34px;flex:none}
h1{font-size:19px;margin:0;letter-spacing:-.01em}
.sub{color:var(--muted);font-size:12px;margin-top:2px}
.badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:999px;border:1px solid}
.badge.demo{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 45%,transparent);background:color-mix(in srgb,var(--amber) 10%,transparent)}
.badge.live{color:var(--green);border-color:color-mix(in srgb,var(--green) 45%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.badge.anomaly{color:#fff;background:var(--red);border-color:var(--red)}
.badge.recovery{color:#000;background:var(--green);border-color:var(--green)}
.badge.continued{color:var(--amber);border-color:var(--amber)}
.badge.ok{color:var(--muted);border-color:var(--line)}
.bar-row{display:grid;grid-template-columns:70px 1fr auto;gap:10px;align-items:center;margin:8px 0}
.bar-label{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis}
.bar-track{height:9px;background:var(--panel2);border:1px solid var(--line);border-radius:99px;overflow:hidden}
.bar-fill{display:block;height:100%;border-radius:99px}
.bar-num{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:16px 0}
.controls form{display:flex;gap:8px;align-items:center}
input[type=date],select,button{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px}
button{cursor:pointer}button:hover{border-color:var(--green);color:var(--green)}
.grid{display:grid;grid-template-columns:320px 1fr;gap:18px;align-items:start}
@media(max-width:860px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:18px}
.card h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 14px}
.wheel{width:100%;max-width:230px;display:block;margin:0 auto}
.legend{margin-top:14px;display:flex;flex-direction:column;gap:7px;font-size:12px}
.legend .row{display:flex;justify-content:space-between;gap:10px}
.legend .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:7px;vertical-align:-1px}
.legend .muted{color:var(--muted)}
.centerstats{position:relative;text-align:center}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.kpi .k{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.kpi .v{font:600 20px ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:4px}
.kpi .v.green{color:var(--green)}.kpi .v.red{color:var(--red)}.kpi .v.amber{color:var(--amber)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{color:var(--muted);font-size:10px;letter-spacing:.09em;text-transform:uppercase;font-weight:600}
td.num,th.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
td.num.hot{color:var(--red);font-weight:700}
tfoot td{font-weight:700;border-top:2px solid var(--line);border-bottom:none}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px}
.empty{background:var(--panel);border:1px dashed var(--line);border-radius:14px;padding:28px;text-align:center}
.empty code{background:var(--panel2);padding:2px 6px;border-radius:6px;color:var(--green)}
.muted{color:var(--muted)}.small{font-size:12px}
.err{background:color-mix(in srgb,var(--red) 12%,transparent);border:1px solid var(--red);color:#ffd7dc;border-radius:12px;padding:14px 16px;margin-bottom:18px;font-size:13px}
.usage{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.usage .u{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px}
.usage .u b{display:block;color:var(--muted);font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;margin-bottom:4px}
footer{margin-top:26px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
code.inline{background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--green);font:12px ui-monospace,Menlo,monospace}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <svg class="logo" viewBox="0 0 40 40" aria-label="Telnyx"><rect width="40" height="40" rx="9" fill="#00E3AA"/><path d="M9 12h22L19.5 29H9z" fill="#000"/></svg>
    <div style="flex:1">
      <h1>Attribution Wheel <span class="muted" style="font-weight:400">· ${esc(group)}</span></h1>
      <div class="sub">AI Gateway spend attribution · per-service, per-tenant, per-env · 7-day rolling baseline</div>
    </div>
    <span class="badge ${demo ? "demo" : "live"}">${demo ? "DEMO MODE · pages logged" : "LIVE · SMS pages armed"}</span>
  </header>

  <div class="controls">
    <form method="get" action="/">
      <input type="date" name="day" value="${esc(day)}" max="${esc(shiftDay(todayUtc(), 0))}">
      <input type="hidden" name="group" value="${esc(group)}">
      <button type="submit">View day</button>
      <a class="badge ok" href="/?group=${esc(group)}&day=${esc(shiftDay(day, -1))}">‹ prev</a>
      <a class="badge ok" href="/?group=${esc(group)}&day=${esc(shiftDay(day, 1))}">next ›</a>
    </form>
    <span class="muted small">auto-refreshes every 30s</span>
  </div>

  ${error ? `<div class="err">Report failed: ${esc(error)}</div>` : ""}

  <div class="kpis">
    <div class="kpi"><div class="k">Requests</div><div class="v">${int(totalRequests)}</div></div>
    <div class="kpi"><div class="k">Spend (day)</div><div class="v">${usd(totals?.spend ?? 0)}</div></div>
    <div class="kpi"><div class="k">Reserved spend</div><div class="v amber">${usd(totals?.reserved_spend ?? 0)}</div></div>
    <div class="kpi"><div class="k">Unknown requests</div><div class="v amber">${int(totals?.unknown_requests ?? 0)}</div></div>
    <div class="kpi"><div class="k">Pages sent</div><div class="v red">${esc(String(demo ? "logged only" : "live SMS"))}</div></div>
  </div>

  <div class="grid">
    <div>
      <div class="card">
        <h2>The Wheel · share of requests</h2>
        ${rows.length ? `${donut(rows, totalRequests, baselineShares)}
        <div class="legend">
          ${rows
            .map((r) => {
              const share = totalRequests > 0 ? Number(r.requests) / totalRequests : 0;
              const base = baselineShares.get(r.service) ?? 0;
              return `<div class="row"><span><span class="sw" style="background:${serviceColor(r.service)}"></span>${esc(r.service)}</span><span>${pct(share)} <span class="muted">(base ${pct(base)})</span></span></div>`;
            })
            .join("")}
        </div>` : `<p class="muted small">No data — run the traffic driver.</p>`}
        <p class="muted small" style="margin-top:12px">Outer ring = 7-day baseline share. Inner ring = today.</p>
      </div>
      <div class="card">
        <h2>Per tenant</h2>
        ${bars(byTenant, () => "#00E3AA")}
        <h2 style="margin-top:18px">Per env</h2>
        ${bars(byEnv, () => "#4D7CFE")}
      </div>
    </div>

    <div>
      <div class="card">
        <h2>Ledger · spend_daily (${esc(day)})</h2>
        ${table}
      </div>
      <div class="card">
        <h2>Gateway usage summary</h2>
        ${usage
          ? `<div class="usage">
              <div class="u"><b>Requests</b>${int(usage.totals.requests)}</div>
              <div class="u"><b>Input tok</b>${int(usage.totals.input_tokens)}</div>
              <div class="u"><b>Output tok</b>${int(usage.totals.output_tokens)}</div>
              <div class="u"><b>Unknown req</b>${int(usage.totals.unknown_requests)}</div>
              <div class="u"><b>Spend</b>${usd(usage.totals.spend)}</div>
              <div class="u"><b>Reserved</b>${usd(usage.totals.reserved_spend)}</div>
              <div class="u"><b>Guardrail blocked</b>${int(usage.guardrails.blocked_events)}</div>
              <div class="u"><b>Guardrail flagged</b>${int(usage.guardrails.flagged_events)}</div>
            </div>
            <p class="muted small" style="margin-bottom:0">live from <code class="inline">GET /v2/llm_token_gateway/usage/summary</code> — ${demo ? "zeros expected in demo mode (traffic is synthetic)" : "tagged live traffic"}</p>`
          : `<p class="muted small">Not available — the actor has no token group bound yet (run <code class="inline">POST /rpc/bootstrap</code>), or the gateway call failed this cycle. Reserved spend and unknown requests are excluded from breach/baseline math either way.</p>`}
      </div>
    </div>
  </div>

  <footer>
    <span>Attribution Wheel · Telnyx Edge Compute + AI Gateway · <a href="/report?day=${esc(day)}&group=${esc(group)}">raw JSON</a></span>
    <span class="muted">Drive it: <code class="inline">python traffic.py --days 7</code> → <code class="inline">--profile spike</code> → <code class="inline">--profile recovery</code></span>
  </footer>
</div>
</body>
</html>`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
