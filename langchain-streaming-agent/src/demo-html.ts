/** Streaming chat demo served at `GET /`. Uses the browser `AgentClient`. */
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LangChain Streaming Agent — Telnyx Edge</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='%230e8fb3'/><text x='8' y='12' font-size='10' text-anchor='middle' fill='white' font-family='sans-serif'>L</text></svg>">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0;
         background: #f6f7f9; color: #1a1a2e; }
  header { background: #10131c; color: #fff; padding: 12px 20px; display: flex;
           align-items: center; justify-content: space-between; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  #status { font-size: 12px; padding: 3px 10px; border-radius: 12px; background: #444; }
  #status.thinking { background: #b3790e; }
  #status.idle { background: #0e8fb3; }
  main { max-width: 860px; margin: 20px auto; padding: 0 16px; }
  #session-bar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
  #session { border: 1px solid #d6d9e0; border-radius: 6px; padding: 6px 10px; font-size: 13px; width: 220px; }
  #log { background: #fff; border: 1px solid #d6d9e0; border-radius: 8px; padding: 16px;
         min-height: 200px; max-height: 46vh; overflow-y: auto; }
  .msg { margin-bottom: 14px; }
  .msg .who { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #667; margin-bottom: 3px; }
  .msg .body { font-size: 14px; line-height: 1.55; white-space: pre-wrap; }
  .msg.user .body { background: #e8f4f8; display: inline-block; padding: 8px 12px; border-radius: 8px; }
  #live { margin-top: 10px; }
  #stream { display: none; background: #eef7fa; border: 1px dashed #0e8fb3; border-radius: 8px;
            padding: 10px 14px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; }
  #stream.on { display: block; }
  #stream .who { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #0e6f8c; margin-bottom: 3px; }
  .cursor { display: inline-block; width: 8px; height: 15px; background: #0e8fb3;
            animation: blink 1s steps(1) infinite; vertical-align: text-bottom; }
  @keyframes blink { 50% { opacity: 0; } }
  .toolchip { font-size: 12px; border: 1px solid #d6d9e0; border-left: 3px solid #b3790e;
              background: #fffaf0; border-radius: 6px; padding: 6px 10px; margin-top: 8px;
              font-family: ui-monospace, Menlo, monospace; }
  .toolchip b { color: #8a5a06; }
  .toolchip .out { color: #444; margin-top: 3px; }
  #composer { display: flex; gap: 8px; margin-top: 12px; }
  #input { flex: 1; border: 1px solid #d6d9e0; border-radius: 8px; padding: 10px 14px; font-size: 14px; }
  #send { background: #0e8fb3; color: #fff; border: 0; border-radius: 8px; padding: 10px 18px;
          cursor: pointer; font-size: 14px; }
  #send:disabled { opacity: .5; cursor: default; }
  .prompts { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
  .prompts button { background: #e8f4f8; color: #0e6f8c; border: 0; border-radius: 6px;
                    padding: 6px 12px; font-size: 12px; cursor: pointer; }
  #meta { font-size: 12px; color: #889; margin-top: 10px; }
  .muted { color: #889; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>LangChain Streaming Agent <span class="muted" style="font-weight:400">on Telnyx Edge</span></h1>
  <div><span id="status">connecting…</span></div>
</header>
<main>
  <div id="session-bar">
    <label for="session" class="muted">Session:</label>
    <input id="session" value="demo" spellcheck="false">
    <button id="reconnect" class="muted" style="border:1px solid #d6d9e0;border-radius:6px;padding:6px 12px;cursor:pointer;background:#fff">Reconnect</button>
  </div>
  <div id="log"></div>
  <div id="live">
    <div id="stream"><div class="who">agent — streaming live</div><span id="stream-text"></span><span class="cursor"></span></div>
    <div id="chips"></div>
  </div>
  <div id="composer">
    <input id="input" placeholder="e.g. Where is my order ORD-1042? What's the return policy?" autocomplete="off">
    <button id="send">Send</button>
  </div>
  <div class="prompts">
    <button data-q="Where is my order ORD-1042?">Where is my order ORD-1042?</button>
    <button data-q="Can I return a headset, and how long do refunds take?">Returns + refunds?</button>
    <button data-q="My webcam arrived with a cracked lens — what should I do?">Cracked lens — what now?</button>
  </div>
  <div id="meta">Tokens stream over WebSocket from a LangChain tool-calling agent running on Telnyx Edge Compute — inference via the zero-credential TELNYX binding.</div>
</main>
<script type="module">
import { AgentClient } from "https://esm.sh/@telnyx/edge-runtime@0.13.0/client";

const els = {
  log: document.getElementById("log"),
  stream: document.getElementById("stream"),
  streamText: document.getElementById("stream-text"),
  chips: document.getElementById("chips"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  status: document.getElementById("status"),
  session: document.getElementById("session"),
  reconnect: document.getElementById("reconnect"),
  meta: document.getElementById("meta"),
};

let client = null;
let lastEventSeq = 0;
let liveTurn = 0;
let tokenEvents = 0;
let liveText = "";

/** Escape HTML, then render **bold** markers from model markdown.
 * Split-based on purpose: a regex here would sit inside a template literal,
 * whose escape processing eats the backslashes and corrupts it. */
function renderRich(text) {
  const div = document.createElement("div");
  div.textContent = text;
  const parts = div.innerHTML.split("**");
  if (parts.length < 3) return div.innerHTML;
  return parts.map((p, i) => (i % 2 === 1 ? "<b>" + p + "</b>" : p)).join("");
}

function scrollLog() { els.log.scrollTop = els.log.scrollHeight; }

function msgNode(role, text) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + (role === "user" ? "user" : "assistant");
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = role === "user" ? "you" : "agent";
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = renderRich(text);
  wrap.appendChild(who);
  wrap.appendChild(body);
  return wrap;
}

/** The committed conversation re-renders from the durable message log. */
function renderLog(snapshot) {
  els.log.textContent = "";
  const messages = snapshot ?? [];
  if (messages.length === 0) {
    const hint = document.createElement("div");
    hint.className = "muted";
    hint.textContent = "No messages yet — ask about an order (ORD-1042) or a policy.";
    els.log.appendChild(hint);
    return;
  }
  for (const m of messages) {
    if (m.role === "user" || m.role === "assistant") els.log.appendChild(msgNode(m.role, m.content));
  }
  scrollLog();
}

function clearLive() {
  els.stream.classList.remove("on");
  els.streamText.textContent = "";
  els.chips.textContent = "";
}

function appendToken(turn, text) {
  if (turn < liveTurn) return; // replay of an older turn — counter only
  if (turn > liveTurn) { liveTurn = turn; liveText = ""; }
  liveText += text;
  els.stream.classList.add("on");
  els.streamText.innerHTML = renderRich(liveText);
  scrollLog();
}

function chip(turn, tool, detail, isResult) {
  if (turn < liveTurn) return;
  let chipNode = [...els.chips.children].find((n) => n.dataset.tool === tool && !isResult);
  if (isResult) {
    chipNode = [...els.chips.children].find((n) => n.dataset.tool === tool);
  }
  if (!chipNode) {
    chipNode = document.createElement("div");
    chipNode.className = "toolchip";
    chipNode.dataset.tool = tool;
    const head = document.createElement("div");
    head.innerHTML = "<b></b>";
    head.querySelector("b").textContent = tool;
    const out = document.createElement("div");
    out.className = "out";
    chipNode.appendChild(head);
    chipNode.appendChild(out);
    els.chips.appendChild(chipNode);
  }
  const out = chipNode.querySelector(".out");
  out.textContent = isResult ? "→ " + detail : String(detail);
}

function connect() {
  const session = (els.session.value || "demo").replace(/[^a-zA-Z0-9_-]/g, "") || "demo";
  if (client) client.close();
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  client = new AgentClient(
    proto + location.host + "/websocket?session=" + encodeURIComponent(session),
    { token: "demo", subscribe: ["state", "messages", "events"], resume: true },
  );
  // Warm the actor over HTTP so the WebSocket attach does not race a cold
  // start (the platform answers cold upgrades with 502).
  fetch("/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session }),
  }).catch(() => {});
  lastEventSeq = 0;
  liveTurn = 0;
  tokenEvents = 0;
  liveText = "";
  clearLive();

  client.onState((state) => {
    els.status.textContent = "agent: " + (state?.status ?? "?") + " · turn " + (state?.turn ?? 0);
    els.status.className = state?.status === "thinking" ? "thinking" : "idle";
  });

  let allMessages = [];
  client.onMessages(({ snapshot, appended }) => {
    // Live appends arrive WITHOUT a snapshot — accumulate to keep the log.
    if (snapshot) allMessages = snapshot;
    else if (appended && appended.length) allMessages = allMessages.concat(appended);
    // A committed user turn starts a new live pane; a committed assistant
    // turn hands the streamed answer off to the log.
    const last = allMessages[allMessages.length - 1];
    if (last?.role === "user" || last?.role === "assistant") clearLive();
    renderLog(allMessages);
  });

  client.onEvents((event) => {
    if (event.seq <= lastEventSeq) return; // dedupe replayed frames
    lastEventSeq = event.seq;
    const p = event.payload ?? {};
    if (event.type === "token") {
      tokenEvents += 1;
      appendToken(p.turn ?? 0, p.text ?? "");
    } else if (event.type === "tool_start") {
      chip(p.turn ?? 0, String(p.tool ?? "tool"), JSON.stringify(p.input ?? {}), false);
    } else if (event.type === "tool_result") {
      const output = String(p.output ?? "");
      chip(p.turn ?? 0, String(p.tool ?? "tool"), output.length > 220 ? output.slice(0, 220) + "…" : output, true);
    }
    els.meta.textContent = tokenEvents + " token events streamed over WebSocket this session · last event seq " + lastEventSeq + ".";
  });
}

async function waitForConnection(ms) {
  const deadline = Date.now() + ms;
  while (!client.isConnected()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
  return true;
}

async function submit(text) {
  const value = (text ?? els.input.value).trim();
  if (!value || !client) return;
  const prompts = document.querySelectorAll(".prompts button");
  els.log.appendChild(msgNode("user", value));
  els.input.value = "";
  els.send.disabled = true;
  els.send.textContent = "connecting…";
  prompts.forEach((b) => { b.disabled = true; });
  clearLive();
  scrollLog();
  try {
    // Cold starts on the edge can take a few seconds — wait for the socket
    // instead of silently dropping the click.
    const connected = await waitForConnection(25000);
    if (!connected) throw new Error("still connecting — try again in a moment");
    await client.stub.send(value);
  } catch (err) {
    els.log.lastChild?.remove();
    chip(liveTurn + 1, "error", err?.message ?? String(err), false);
  } finally {
    els.send.disabled = false;
    els.send.textContent = "Send";
    prompts.forEach((b) => { b.disabled = false; });
    els.input.focus();
  }
}

els.send.addEventListener("click", () => submit());
els.input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
els.reconnect.addEventListener("click", connect);
els.session.addEventListener("change", connect);
for (const b of document.querySelectorAll(".prompts button")) {
  b.addEventListener("click", () => submit(b.dataset.q));
}
// Surface connection state: the pill flips to "connecting…" whenever the
// socket is down (the client reconnects automatically).
setInterval(() => {
  if (client && !client.isConnected()) {
    els.status.textContent = "connecting…";
    els.status.className = "";
  }
}, 1000);
connect();
</script>
</body>
</html>
`;
export default html;
