// Minimal local dashboard for the Telnyx Email API. No dependencies (Node 18+).
const http = require("http");
const fs = require("fs");
const path = require("path");

// --- Load .env without printing anything ---
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}
const { TELNYX_API_KEY, FROM_EMAIL, TO_EMAIL } = process.env;
const PORT = Number(process.env.PORT) || 3000;
const API = "https://api.telnyx.com/v2";

for (const [k, v] of Object.entries({ TELNYX_API_KEY, FROM_EMAIL, TO_EMAIL })) {
  if (!v) { console.error(`Missing ${k} in .env`); process.exit(1); }
}

// o***@m***.com
function mask(email) {
  const [local = "", domain = ""] = String(email).split("@");
  const parts = domain.split(".");
  const tld = parts.length > 1 ? parts.pop() : "";
  return `${local[0] || ""}***@${(parts.join(".")[0] || "")}***${tld ? "." + tld : ""}`;
}

async function telnyx(method, urlPath, body) {
  const res = await fetch(API + urlPath, {
    method,
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

// Pull a readable error out of a Telnyx error response, scrubbed of addresses.
function apiError(r) {
  const e = r.json?.errors?.[0];
  const msg = e ? [e.title, e.detail].filter(Boolean).join(": ") : `HTTP ${r.status}`;
  return msg.replace(/[^\s@"']+@[^\s@"']+/g, (m) => mask(m));
}

// Messages sent from this dashboard (in memory + persisted locally).
// `data/` is gitignored so message IDs from local runs are not committed.
const DATA_DIR = path.join(__dirname, "data");
const SENT_FILE = path.join(DATA_DIR, "sent.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
let sent = [];
try { sent = JSON.parse(fs.readFileSync(SENT_FILE, "utf8")); } catch {}
const saveSent = () => fs.writeFileSync(SENT_FILE, JSON.stringify(sent, null, 2));

async function sendTestEmail() {
  const now = new Date().toISOString();
  const r = await telnyx("POST", "/email_messages", {
    from: {
      email: FROM_EMAIL,
      name: "Telnyx Email API Demo",
    },
    to: [{ email: TO_EMAIL }],
    subject: `Telnyx Email API Demo - ${now}`,
    html_body: `<h2>Telnyx Email API Demo</h2>
<p>Sent at ${now} from the local dashboard.</p>
<p><a href="https://telnyx.com/products/email-api">Click this link</a> to generate a click event.</p>`,
    text_body: `Telnyx Email API Demo sent at ${now}. Link: https://telnyx.com/products/email-api`,
    // Per-send tracking overrides the sender domain defaults for this message.
    // If you omit this object, the message inherits the domain tracking settings.
    tracking_settings: {
      open_tracking: true,
      click_tracking: true,
    },
    tags: ["dashboard-test"],
  });
  if (!r.ok) return { ok: false, status: r.status, error: apiError(r) };
  const d = r.json.data || {};
  const rec = { id: d.id, status: d.status, subject: d.subject, created_at: d.created_at || now };
  sent.unshift(rec);
  saveSent();
  return { ok: true, message: rec };
}

// Fetch every event for the messages we sent (per-message history endpoint,
// falling back to the global feed filtered by email_id).
async function eventsFor(id) {
  const out = [];
  let cursor;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("page_cursor", cursor);
    let r = await telnyx("GET", `/email_messages/${id}/events?${qs}`);
    if (r.status === 404) {
      qs.set("email_id", id);
      r = await telnyx("GET", `/email_events?${qs}`);
    }
    if (!r.ok) throw new Error(apiError(r));
    out.push(...(r.json.data || []));
    cursor = r.json.meta?.page_cursor;
    if (!cursor) break;
  }
  return out;
}

const norm = (t) => String(t || "").replace(/^email\./, "");

async function stats() {
  const errors = [];
  const events = [];
  for (const m of sent) {
    try {
      for (const e of await eventsFor(m.id)) {
        const type = norm(e.canonical_event_type || e.event_type);
        const occurred_at = e.occurred_at || e.created_at;
        events.push({ email_id: m.id, type, occurred_at });
      }
      const latest = events.filter((e) => e.email_id === m.id)
        .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))).pop();
      if (latest) m.status = latest.type;
    } catch (err) {
      errors.push(`${m.id.slice(0, 8)}…: ${err.message}`);
    }
  }
  // Unique messages per event type.
  const uniq = {};
  for (const e of events) (uniq[e.type] ||= new Set()).add(e.email_id);
  const n = (t) => (uniq[t] ? uniq[t].size : 0);
  const total = sent.length;
  const delivered = n("delivered");
  const pct = (a, b) => (b ? +(100 * a / b).toFixed(1) : null);
  events.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
  return {
    counts: {
      sent: total,
      delivered,
      opened: n("opened"),
      clicked: n("clicked"),
      bounced: n("bounced"), unsubscribed: n("unsubscribed"),
      failed: n("failed"), complained: n("complained"),
    },
    rates: {
      delivery: pct(delivered, total),
      open: pct(n("opened"), delivered),
      click: pct(n("clicked"), delivered),
      bounce: pct(n("bounced"), total),
      unsubscribe: pct(n("unsubscribed"), delivered),
    },
    messages: sent,
    events: events.slice(0, 200),
    errors,
    polled_at: new Date().toISOString(),
  };
}

// Optional domain-default lookup. The send request above uses message-level
// tracking_settings, so this endpoint is informational only.
async function trackingInfo() {
  const domain = FROM_EMAIL.split("@")[1]?.toLowerCase();
  const r = await telnyx("GET", "/email_domains?page_size=100");
  if (!r.ok) return { known: false, error: apiError(r) };
  const d = (r.json.data || []).find((x) => String(x.name || x.domain || "").toLowerCase() === domain);
  if (!d) return { known: false, error: "Sending domain not found in account" };
  const t = d.tracking || {};
  return {
    known: true,
    domain_id: d.id,
    open_tracking: !!t.open_tracking,
    click_tracking: !!t.click_tracking,
    unsubscribe_tracking: t.unsubscribe_tracking !== false,
    status: d.status || null,
  };
}

function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    }
    if (req.method === "GET" && req.url === "/api/config")
      return json(res, 200, { from: mask(FROM_EMAIL), to: mask(TO_EMAIL) });
    if (req.method === "POST" && req.url === "/api/send") {
      const r = await sendTestEmail();
      return json(res, r.ok ? 200 : 502, r);
    }
    if (req.method === "GET" && req.url === "/api/stats") return json(res, 200, await stats());
    if (req.method === "GET" && req.url === "/api/tracking") return json(res, 200, await trackingInfo());
    json(res, 404, { error: "Not found" });
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Telnyx Email dashboard: http://localhost:${PORT}  (sender/recipient configured)`);
});
