import http from "node:http";

const PORT = Number(process.env.PORT || 8789);
const REMOTE_BASE =
  process.env.REMOTE_BASE || "http://localhost:8787";

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email Batch Retry Demo</title>
  <style>
    :root {
      --bg: #f6f8fb;
      --panel: #ffffff;
      --ink: #172033;
      --muted: #667085;
      --line: #d9e0ea;
      --blue: #1b5cff;
      --green: #087443;
      --amber: #a15c00;
      --red: #b42318;
      --slate: #344054;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0;
    }
    button { font: inherit; }
    .shell { max-width: 1180px; margin: 0 auto; padding: 28px; }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--line);
    }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: 0; }
    .lede { margin: 10px 0 0; max-width: 780px; color: var(--muted); line-height: 1.5; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .button {
      border: 1px solid var(--blue);
      background: var(--blue);
      color: #fff;
      min-height: 40px;
      padding: 0 14px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 650;
    }
    .button.secondary { background: #fff; color: var(--blue); }
    .button:disabled { opacity: .55; cursor: not-allowed; }
    main { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(340px, .95fr); gap: 18px; margin-top: 22px; }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(16,24,40,.04);
      padding: 18px;
    }
    h2 { margin: 0 0 14px; font-size: 18px; letter-spacing: 0; }
    .scenario, .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .stats { grid-template-columns: repeat(4, 1fr); margin-top: 14px; }
    .step, .stat {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfe;
      padding: 13px;
    }
    .step { min-height: 112px; }
    .step b { display: block; margin-bottom: 8px; color: var(--slate); }
    .step p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.4; }
    .label { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 750; letter-spacing: .04em; }
    .value { margin-top: 8px; font-size: 28px; font-weight: 760; }
    .campaign-line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding-bottom: 12px;
    }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
    code {
      color: #243b6b;
      background: #eef4ff;
      padding: 2px 5px;
      border-radius: 5px;
      overflow-wrap: anywhere;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 750;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--slate);
    }
    .status-SENT, .status-COMPLETED { color: var(--green); background: #ecfdf3; border-color: #abefc6; }
    .status-FAILED, .status-RETRYING { color: var(--amber); background: #fffaeb; border-color: #fedf89; }
    .status-EXHAUSTED, .status-PARTIAL_FAILURE { color: var(--red); background: #fef3f2; border-color: #fecdca; }
    .messages { display: grid; gap: 10px; margin-top: 14px; }
    .message {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
    }
    .index {
      width: 36px;
      height: 36px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #eef4ff;
      color: #174ea6;
      font-weight: 760;
    }
    .msg-title { font-weight: 720; overflow-wrap: anywhere; }
    .msg-meta { margin-top: 5px; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .attempts { text-align: right; color: var(--muted); font-size: 13px; min-width: 86px; }
    .attempts b { display: block; color: var(--ink); font-size: 22px; }
    .terminal {
      background: #111827;
      color: #d1d5db;
      border-radius: 8px;
      padding: 14px;
      overflow: auto;
      font-size: 12px;
      line-height: 1.55;
      max-height: 470px;
    }
    .note { color: var(--muted); line-height: 1.45; font-size: 14px; margin: 10px 0 0; }
    @media (max-width: 900px) {
      .shell { padding: 18px; }
      header, main { display: block; }
      .actions { justify-content: flex-start; margin-top: 16px; }
      .scenario, .stats { grid-template-columns: 1fr; }
      section { margin-top: 14px; }
      .message { grid-template-columns: 42px minmax(0,1fr); }
      .attempts { grid-column: 2; text-align: left; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div>
        <h1>Fraud Alert Batch Campaign</h1>
        <p class="lede">A persistent actor owns the campaign, remembers every recipient, retries only failed messages, and keeps the audit trail operators need after a partial provider failure.</p>
      </div>
      <div class="actions">
        <button class="button" id="start">Start demo campaign</button>
        <button class="button secondary" id="refresh">Refresh state</button>
      </div>
    </header>

    <main>
      <div>
        <section>
          <h2>Use Case</h2>
          <div class="scenario">
            <div class="step"><b>Urgent batch</b><p>A bank's fraud team must notify affected cardholders before the end of the day.</p></div>
            <div class="step"><b>Partial failure</b><p>One alert is accepted; one fails because its sender domain is invalid.</p></div>
            <div class="step"><b>Durable retry</b><p>The actor remembers the split and retries only the failed alert.</p></div>
          </div>
        </section>

        <section>
          <div class="campaign-line">
            <div>
              <div class="label">Campaign ID</div>
              <code id="campaignId">No campaign yet</code>
            </div>
            <span class="status-pill" id="status">IDLE</span>
          </div>
          <div class="stats">
            <div class="stat"><div class="label">Total</div><div class="value" id="total">0</div></div>
            <div class="stat"><div class="label">Sent</div><div class="value" id="sent">0</div></div>
            <div class="stat"><div class="label">Failed</div><div class="value" id="failed">0</div></div>
            <div class="stat"><div class="label">Exhausted</div><div class="value" id="exhausted">0</div></div>
          </div>
          <div class="messages" id="messages"></div>
          <p class="note" id="note">Start a campaign, then keep this beside your terminal. The UI shows the story; the terminal shows the raw actor state.</p>
        </section>
      </div>

      <div>
        <section>
          <h2>Terminal Command</h2>
          <pre class="terminal" id="terminal">BASE="${REMOTE_BASE}"
CAMPAIGN_ID="paste-id-from-ui"

curl -sS "$BASE/campaigns/$CAMPAIGN_ID" | jq '{
  campaignId,status,total,sent,failed,exhausted,notifyError,
  messages:[.messages[]|{index,status,attempts,lastError,messageId,idempotencyKeys}]
}'</pre>
        </section>
      </div>
    </main>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    const remoteBase = ${JSON.stringify(REMOTE_BASE)};
    let campaignId = "";
    let pollTimer = null;

    function statusClass(status) {
      return "status-pill status-" + String(status || "IDLE").replace(/[^A-Z_]/g, "");
    }

    function render(state) {
      $("campaignId").textContent = state.campaignId || campaignId || "No campaign yet";
      $("status").textContent = state.status || "IDLE";
      $("status").className = statusClass(state.status);
      $("total").textContent = state.total ?? 0;
      $("sent").textContent = state.sent ?? 0;
      $("failed").textContent = state.failed ?? 0;
      $("exhausted").textContent = state.exhausted ?? 0;

      $("messages").innerHTML = (state.messages || []).map((m) => {
        const status = m.status || "PENDING";
        const title = m.index === 0 ? "Approved fraud alert" : "Bad sender demo";
        const detail = m.lastError ? m.lastError : (m.messageId ? "Telnyx message id: " + m.messageId : "Waiting for provider response");
        return '<div class="message">' +
          '<div class="index">' + m.index + '</div>' +
          '<div><div class="msg-title">' + title + ' <span class="' + statusClass(status) + '">' + status + '</span></div>' +
          '<div class="msg-meta">' + detail + '</div>' +
          '<div class="msg-meta">' + (m.idempotencyKeys || []).length + ' idempotency key(s)</div></div>' +
          '<div class="attempts"><b>' + (m.attempts || 0) + '</b>attempts</div>' +
          '</div>';
      }).join("");

      if (state.status === "RETRYING") {
        $("note").textContent = "This is the key moment: the actor saved the campaign and is waiting to retry only the failed message.";
      } else if (state.status === "PARTIAL_FAILURE") {
        $("note").textContent = "Final audit state: successful messages were not duplicated, failed messages exhausted their retry budget, and notification completed if notifyError is null.";
      }
    }

    async function refresh() {
      if (!campaignId) return;
      const res = await fetch("/campaigns/" + encodeURIComponent(campaignId));
      if (!res.ok) throw new Error("GET failed: HTTP " + res.status);
      render(await res.json());
    }

    async function startDemo() {
      $("start").disabled = true;
      campaignId = "fraud-alert-demo-" + Math.floor(Date.now() / 1000);
      const body = {
        campaignId,
        messages: [
          {
            to: "devrel-inbox+approved-" + campaignId + "@qsywfrdyuwdo.msgtelnyx.com",
            subject: "Fraud alert: suspicious card activity",
            text: "Suspicious card activity detected. Please review your account."
          },
          {
            to: "devrel-inbox+bad-sender-" + campaignId + "@qsywfrdyuwdo.msgtelnyx.com",
            from: "alerts@definitely-unverified-codex.invalid",
            subject: "Fraud alert: suspicious card activity",
            text: "Suspicious card activity detected. Please review your account."
          }
        ]
      };
      const res = await fetch("/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        const active = text.match(/campaign \(([^)]+)\) is already active/i);
        if (res.status === 409 && active) {
          campaignId = active[1];
          $("note").textContent = "Another campaign is already active, so this dashboard loaded it instead.";
          await refresh();
          $("start").disabled = false;
          return;
        }
        $("start").disabled = false;
        throw new Error("POST failed: HTTP " + res.status + " " + text);
      }
      $("terminal").textContent = [
        'BASE="' + remoteBase + '"',
        'CAMPAIGN_ID="' + campaignId + '"',
        '',
        'curl -sS "$BASE/campaigns/$CAMPAIGN_ID" | jq ' + JSON.stringify('{campaignId,status,total,sent,failed,exhausted,notifyError,messages:[.messages[]|{index,status,attempts,lastError,messageId,idempotencyKeys}]}')
      ].join("\n");
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await refresh();
      clearInterval(pollTimer);
      pollTimer = setInterval(() => refresh().catch(console.error), 5000);
      $("start").disabled = false;
    }

    $("start").addEventListener("click", () => startDemo().catch((err) => {
      $("note").textContent = err.message;
      $("start").disabled = false;
    }));
    $("refresh").addEventListener("click", () => refresh().catch((err) => $("note").textContent = err.message));
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
    return;
  }

  if (url.pathname === "/campaigns" || url.pathname.startsWith("/campaigns/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const upstream = await fetch(`${REMOTE_BASE}${url.pathname}${url.search}`, {
      method: req.method,
      headers: { "content-type": req.headers["content-type"] || "application/json" },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    });
    res.end(await upstream.text());
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Demo dashboard: http://localhost:${PORT}`);
  console.log(`Proxying campaign API to: ${REMOTE_BASE}`);
});
