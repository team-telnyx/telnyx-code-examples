// Re-export the actor classes so they ship with the bundle.
export { CoachRoom, CoachRegistry, NudgePolicy } from "./coachRoom";
export { AssistRelay } from "./relay";
import type {
  CoachRoom,
  CoachRegistry,
  RegistryRow,
  RelayResult,
} from "./coachRoom";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";
import { mountAgents } from "@telnyx/edge-runtime/mount";

type CoachRoomStub = ActorStub &
  Pick<CoachRoom, "startRoom" | "onAssistantFrame" | "endSession" | "joinCall" | "getSnapshot" | "getLog">;

interface CoachRoomNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): CoachRoomStub;
}

type RegistryStub = ActorStub &
  Pick<CoachRegistry, "recordStart" | "recordUpdate" | "recordEnd" | "list">;

interface RegistryNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RegistryStub;
}

type RelayStub = ActorStub & Record<string, never>;

interface RelayNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RelayStub;
}

interface Env {
  RELAY: RelayNamespace;
  COACHROOMS: CoachRoomNamespace;
  REGISTRY: RegistryNamespace;
  SECRETS: { get(handle: string): Promise<string> };
  NUDGE_MAX_PER_CALL: string;
  SILENCE_SECS: string;
  DASHBOARD_ORIGIN: string;
}

const DEFAULT_NUDGE_MAX = 3;
const DEFAULT_SILENCE_SECS = 90;
const REGISTRY_NAME = "coach-shift";

// ── Agent socket mount ───────────────────────────────────────────────────
// Two surfaces share the /agents mount:
//   /agents/assist            — the assistant event stream (websocket_settings.url)
//   /agents/coach-room/{id}   — supervisor dashboard tabs (live room view)
const handleAgents = mountAgents<Env>((env) => ({
  assist: env.RELAY,
  "coach-room": env.COACHROOMS,
}));

function daprSafeName(id: string): string {
  // Dapr-safe: RFC 1123 — no "+", no special chars
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}

function room(env: Env, conversationId: string): CoachRoomStub {
  return env.COACHROOMS.idFromName(daprSafeName(conversationId));
}

function registry(env: Env): RegistryStub {
  return env.REGISTRY.idFromName(REGISTRY_NAME);
}

function roomConfig(env: Env): { nudgeMaxPerCall: number; silenceSecs: number } {
  return {
    nudgeMaxPerCall: intFrom(env.NUDGE_MAX_PER_CALL, DEFAULT_NUDGE_MAX),
    silenceSecs: intFrom(env.SILENCE_SECS, DEFAULT_SILENCE_SECS),
  };
}

function intFrom(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ── Router ───────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Health ───────────────────────────────────────────────────────
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") {
      return Response.json({ status: "ok", nudge_max: intFrom(env.NUDGE_MAX_PER_CALL, DEFAULT_NUDGE_MAX) });
    }

    // ── Agent socket mount (assistant stream + supervisor desk) ──────
    if (url.pathname.startsWith("/agents/")) {
      return handleAgents(req, env);
    }

    // ── Supervisor surfaces ──────────────────────────────────────────
    if (url.pathname === "/rooms" && req.method === "GET") {
      return Response.json(await registry(env).list());
    }

    const joinMatch = req.method === "POST" && url.pathname.match(/^\/rooms\/([^/]+)\/join$/);
    if (joinMatch) {
      const result = await room(env, decodeURIComponent(joinMatch[1])).joinCall(undefined);
      return Response.json(result, { status: result.success ? 200 : 409 });
    }

    const snapshotMatch = url.pathname.match(/^\/rooms\/([^/]+)\/snapshot$/);
    if (snapshotMatch && req.method === "GET") {
      return Response.json(await room(env, decodeURIComponent(snapshotMatch[1])).getSnapshot());
    }

    const logMatch = url.pathname.match(/^\/rooms\/([^/]+)\/log$/);
    if (logMatch && req.method === "GET") {
      return Response.json({ rows: await room(env, decodeURIComponent(logMatch[1])).getLog() });
    }

    // ── Demo simulator — the two-tab demo without telephony ──────────
    if (req.method === "POST" && url.pathname === "/demo/start") {
      return demoStart(req, env);
    }
    if (req.method === "POST" && url.pathname === "/demo/say") {
      return demoSay(req, env, "user");
    }
    if (req.method === "POST" && url.pathname === "/demo/assistant-say") {
      return demoSay(req, env, "assistant");
    }
    if (req.method === "POST" && url.pathname === "/demo/end") {
      return demoEnd(req, env);
    }

    // ── Static surfaces ──────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/dashboard") {
      return new Response(DASHBOARD_HTML, { headers: { "content-type": "text/html;charset=utf-8" } });
    }
    if (req.method === "GET" && url.pathname === "/caller") {
      return new Response(CALLER_HTML, { headers: { "content-type": "text/html;charset=utf-8" } });
    }

    return new Response("not found", { status: 404 });
  },
};

// ── Demo simulator ───────────────────────────────────────────────────────

async function demoStart(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { conversation_id?: string };
  const conversationId = body.conversation_id || `sim-${crypto.randomUUID().slice(0, 8)}`;
  await room(env, conversationId).startRoom(
    conversationId,
    "sim-assistant",
    `v3:sim-${crypto.randomUUID().slice(0, 8)}`,
    roomConfig(env),
  );
  await registry(env).recordStart(conversationId);
  return Response.json({ conversation_id: conversationId }, { status: 201 });
}

async function demoSay(
  req: Request,
  env: Env,
  role: "user" | "assistant",
): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { conversation_id?: string; text?: string };
  const text = (body.text ?? "").trim();
  if (!body.conversation_id || !text) {
    return Response.json({ error: "conversation_id and text are required" }, { status: 400 });
  }

  // Same frame shape Telnyx sends on the event stream — the room cannot
  // tell a simulated turn from a live one.
  const result: RelayResult = await room(env, body.conversation_id).onAssistantFrame({
    type: "conversation.item.created",
    item: { type: "message", role, content: [{ type: "input_text", text }] },
  });
  if (result.inject.length > 0) {
    await registry(env).recordUpdate(body.conversation_id, {
      nudges: result.summary.nudges,
      took_over: result.summary.took_over,
      flag_count: result.summary.flags.length,
    });
  }
  return Response.json(result, { status: 201 });
}

async function demoEnd(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { conversation_id?: string; duration_sec?: number };
  if (!body.conversation_id) {
    return Response.json({ error: "conversation_id is required" }, { status: 400 });
  }
  const duration = typeof body.duration_sec === "number" ? body.duration_sec : null;
  await room(env, body.conversation_id).endSession(duration, "demo");
  await registry(env).recordEnd(body.conversation_id);
  return Response.json({ ended: true, conversation_id: body.conversation_id });
}

// ── Supervisor dashboard ─────────────────────────────────────────────────

const TELNYX_LOGO = `<svg id="Art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1180.92 315.8" class="brand"><defs><style>.cls-1{fill:#fefdf5;}.cls-2{fill:#00e3aa;}</style></defs><path class="cls-1" d="M1004.5,275.8a40,40,0,0,1-40,40H857.11a.34.34,0,0,1-.35-.35V279.73a.35.35,0,0,1,.35-.35H948.4a16,16,0,0,0,16-16V239.66a.34.34,0,0,0-.63-.17c-10.41,16.2-27.21,27.66-51.4,27.66-36.11,0-56-26.28-56-66.37V92.27a.35.35,0,0,1,.35-.35h39.12a.35.35,0,0,1,.35.35v104c0,23.9,10.09,36.91,32.66,36.91,25.87,0,33.84-16.89,35.46-31.51l.12-2.3V92.27a.35.35,0,0,1,.35-.35h39.38a.36.36,0,0,1,.36.35ZM468.6,188c0,48.86,26,79.12,80.45,79.12,47.52,0,72.48-23.63,75.66-58.94l.27-6.6H583.93l-.64,8.19a22.68,22.68,0,0,1-1,5.47c-3.29,9.8-13.51,17.63-33,17.63C520.64,232.9,510,216.44,510,192v-3.44a.55.55,0,0,1,.54-.55H626V168.92c0-51.51-27.61-79.65-77-79.65-54.43,0-80.45,30.26-80.45,78.59Zm42.23-28.94a.5.5,0,0,1-.5-.54c1.73-20.94,12.65-35,37.39-35,26.23,0,36.74,13.63,36.64,35.07a.5.5,0,0,1-.5.5ZM639.4,40.63V264.5h40.09V40.63Zm94.52,51.29H694.09V264.5h39.83v-103c0-15.4,5.84-38.23,35.84-38.23,22.57,0,32.66,13,32.66,36.91V264.5h39.82V155.64c0-40.09-19.91-66.37-56-66.37C762,89.27,745,101,734.56,117.19a.34.34,0,0,1-.64-.18ZM1073.41,175a1,1,0,0,1,0,1.1l-58.52,88.4h43.86L1096.56,207a.5.5,0,0,1,.83,0l37.29,57.51h46.24l-58.25-88.24a1,1,0,0,1,0-1.11l56.08-83.23h-45.93l-33,52.43a.5.5,0,0,1-.84,0l-33-52.43h-48.32ZM459.47,228.89H407.14a16,16,0,0,1-16-16V139.58a12,12,0,0,1,12-12h56.33V91.91H403.15a12,12,0,0,1-12-12V40.63H351.22V79.91a12,12,0,0,1-12,12h-27.9v35.67h28a12,12,0,0,1,12,12v84.31a40.73,40.73,0,0,0,40.6,40.61h67.55Z"/><path class="cls-2" d="M72.48,87h40.29L132,50.58a18.42,18.42,0,0,1,16.52-9.95h0a18.4,18.4,0,0,1,16.52,9.95L184.29,87h40.29l-28.06-53a54.29,54.29,0,0,0-96,0Z"/><path class="cls-2" d="M110.42,129.45v94.43h18.31a17.57,17.57,0,0,0,17.06-14.53,17.25,17.25,0,0,0,.25-2.89V150.07a22.5,22.5,0,0,1,22.48-22.5h79.2V92H147.92A37.54,37.54,0,0,0,110.42,129.45Z"/><path class="cls-2" d="M8.92,207.13A40.07,40.07,0,0,0,6.12,215a40.54,40.54,0,0,0,3.9,29,37.75,37.75,0,0,0,16.56,15.77c4.77,2.32,10.42,4.68,16.14,4.68H148.54a38.15,38.15,0,0,0,38.11-38.11V132.57H168.43A17.53,17.53,0,0,0,151,150v56.48a23.14,23.14,0,0,1-.35,3.84,22.57,22.57,0,0,1-22.15,18.53H60a13,13,0,0,1-11.24-6.45,13.84,13.84,0,0,1-.34-13.74l40.25-76.12H48.36L10.18,204.65C9.74,205.45,9.34,206.24,8.92,207.13Z"/><path class="cls-2" d="M270.49,259.82a37.8,37.8,0,0,0,16.56-15.77,40.53,40.53,0,0,0,3.89-29,40.07,40.07,0,0,0-2.8-7.89c-.42-.89-.82-1.69-1.24-2.43l-38.19-72.12H208.44l40.25,76.12a13.84,13.84,0,0,1-.34,13.74,13,13,0,0,1-11.23,6.45H191.58a42.8,42.8,0,0,1-4.62,17h0a43.38,43.38,0,0,1-18.27,18.55h85.67C260.07,264.5,265.72,262.14,270.49,259.82Z"/><path class="cls-2" d="M49.35,127.58h56.11A42.56,42.56,0,0,1,127.93,92H49.35Z"/></svg>`;

const BRAND_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Inter", system-ui, -apple-system, sans-serif; background: #0b0d10; color: #fefdf5; }
  a { color: #00e3aa; }
  header { display: flex; gap: 14px; align-items: center; padding: 14px 22px; border-bottom: 1px solid #1f262d; background: #0e1114; }
  .brand { height: 20px; width: auto; display: block; }
  .app-title { font-size: 13px; font-weight: 600; letter-spacing: .02em; color: #8a939e; flex: 1; padding-left: 6px; }
  #status { font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 999px; background: #1a1f24; color: #8a939e; letter-spacing: .04em; }
  #status.live { background: rgba(0,227,170,.12); color: #00e3aa; border: 1px solid rgba(0,227,170,.35); }
  #status.down { background: rgba(255,43,6,.12); color: #ff5c3d; border: 1px solid rgba(255,92,61,.35); }
  main { display: grid; grid-template-columns: 280px 1fr 290px; gap: 14px; padding: 14px 22px; height: calc(100vh - 53px); }
  section { background: #12161b; border: 1px solid #1f262d; border-radius: 12px; padding: 16px; overflow-y: auto; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: #8a939e; margin: 0 0 12px; font-weight: 600; }
  .turn { padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; font-size: 13px; line-height: 1.5; border: 1px solid transparent; }
  .turn .who { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: #8a939e; display: block; margin-bottom: 4px; font-weight: 600; }
  .turn.caller { background: #171d26; border-color: #242f40; }
  .turn.assistant { background: #10201b; border-color: #1d3a30; }
  .turn.coach { background: #0f2e24; border: 1px solid #00e3aa; }
  .turn.coach .who { color: #00e3aa; }
  .turn.tool { background: #191d22; color: #8a939e; font-family: ui-monospace, monospace; font-size: 12px; }
  .flag { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(255,43,6,.12); color: #ff5c3d; border: 1px solid rgba(255,92,61,.35); margin: 0 6px 6px 0; }
  button { background: #00e3aa; color: #04231a; border: 0; border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%; font-family: inherit; }
  button:hover { background: #17f0ba; }
  button:disabled { opacity: .45; cursor: default; }
  input, textarea { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #2a323b; background: #0e1114; color: #fefdf5; font-size: 13px; margin-bottom: 10px; font-family: inherit; }
  input:focus, textarea:focus { outline: 1px solid #00e3aa; }
  .kv { font-size: 12px; color: #8a939e; margin: 3px 0; }
  .kv b { color: #fefdf5; font-weight: 600; }
  .hidden { display: none; }
`;

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live Support Coach Room — Telnyx</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@telnyx/webrtc@2/dist/TelnyxRTC.min.js"></script>
<style>${BRAND_CSS}</style>
</head>
<body>
<header>
  ${TELNYX_LOGO}
  <span class="app-title">Live Support Coach Room</span>
  <span id="status">connecting</span>
</header>
<main>
  <section id="side">
    <h2>Rooms</h2>
    <div class="kv">COACH_AUTH token</div>
    <input id="auth" type="password" placeholder="coach auth value">
    <div id="roomlist"></div>
    <h2 class="hidden" id="detail-h">Call detail</h2>
    <div id="detail" class="hidden">
      <div class="kv">conversation <b id="d-conversation">—</b></div>
      <div class="kv">nudges <b id="d-nudges">0</b></div>
      <div class="kv">took over <b id="d-tookover">no</b></div>
      <div class="kv">stream <b id="d-stream">down</b></div>
      <div style="margin-top:10px"><button id="join">Escalate to supervisor</button></div>
      <div style="margin-top:14px">
        <h2>WebRTC softphone</h2>
        <div class="kv">login token (browser-side credential)</div>
        <input id="rtctoken" type="password" placeholder="Telnyx WebRTC login token">
        <div class="kv" id="rtcstate">not connected</div>
      </div>
    </div>
  </section>
  <section>
    <h2>Live transcript</h2>
    <div id="transcript"><div class="kv">Connect a room to follow the live conversation.</div></div>
  </section>
  <section>
    <h2>Policy flags</h2>
    <div id="flags"><span class="kv">none</span></div>
    <h2 style="margin-top:14px">How it works</h2>
    <div class="kv">The assistant streams conversation events to this room over <code>websocket_settings</code>. The room watches for identity loops, refund promises, and silence — and injects coach nudges via <code>conversation.item.create</code>. Escalation dials your softphone and joins the leg with <code>ai_assistant_join</code>.</div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let ws = null, backoffMs = 1000, stableSince = 0, conversationId = null, rtcClient = null, rtcCall = null;

// Reconnect with exponential backoff (1s → 30s), reset after 10s stable —
// mirroring Telnyx's own event-stream reconnect policy.
function connect(convId) {
  conversationId = convId;
  const token = encodeURIComponent($("auth").value || "");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = proto + "//" + location.host + "/agents/coach-room/" + encodeURIComponent(convId) + (token ? "?token=" + token : "");
  ws = new WebSocket(url);
  setStatus("connecting");
  ws.onopen = () => { stableSince = Date.now(); setStatus("live"); };
  ws.onmessage = (e) => { try { render(JSON.parse(e.data)); } catch {} };
  ws.onclose = () => {
    setStatus("down");
    const stable = stableSince && (Date.now() - stableSince > 10000);
    backoffMs = stable ? 1000 : Math.min(backoffMs * 2, 30000);
    stableSince = 0;
    setTimeout(() => connect(convId), backoffMs);
  };
}

function render(state) {
  if (!state) return;
  $("d-conversation").textContent = state.conversationId || conversationId;
  $("d-nudges").textContent = String(state.nudges ?? 0);
  $("d-tookover").textContent = state.tookOver ? "yes" : "no";
  $("d-stream").textContent = state.streamUp ? "up" : "down";
  $("join").disabled = !!state.tookOver;

  const t = $("transcript");
  if (state.turns && state.turns.length) {
    t.innerHTML = state.turns.map((tr) =>
      '<div class="turn ' + tr.role + '"><span class="who">' + tr.role + '</span>' + escapeHtml(tr.text) + '</div>'
    ).join("");
    t.scrollTop = t.scrollHeight;
  }
  const f = $("flags");
  f.innerHTML = (state.flags && state.flags.length)
    ? state.flags.map((x) => '<span class="flag">' + escapeHtml(x) + '</span>').join("")
    : '<span class="kv">none</span>';
  $("detail").classList.remove("hidden");
  $("detail-h").classList.remove("hidden");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function setStatus(label) { const s = $("status"); s.textContent = label; s.className = label === "live" ? "live" : (label === "down" ? "down" : ""); }

async function pickRoom() {
  const res = await fetch("/rooms");
  const data = await res.json();
  const rows = (data.active || []).concat(data.ended || []);
  $("roomlist").innerHTML = rows.length ? "" : '<div class="kv">No rooms yet — start the caller simulator tab.</div>';
  for (const r of rows) {
    const div = document.createElement("div");
    div.className = "turn" + (r.conversation_id === conversationId ? " coach" : " caller");
    div.style.cursor = "pointer";
    div.innerHTML = '<span class="who">' + escapeHtml(r.conversation_id) + (r.ended ? " · ended" : "") + '</span>' + r.nudges + ' nudges · ' + r.flag_count + ' flags';
    div.onclick = () => connect(r.conversation_id);
    $("roomlist").appendChild(div);
  }
}
setInterval(pickRoom, 5000);
pickRoom();

$("join").onclick = async () => {
  if (!conversationId) return;
  $("join").disabled = true;
  const res = await fetch("/rooms/" + encodeURIComponent(conversationId) + "/join", { method: "POST" });
  const result = await res.json();
  $("rtcstate").textContent = result.message || "escalation attempted";
  if (rtcCall && result.success) { try { rtcCall.unmuteAudio(); } catch {} }
};

$("rtctoken").onchange = () => {
  const TelnyxRTC = window.TelnyxRTC || window.Telnyx;
  if (!TelnyxRTC) { $("rtcstate").textContent = "TelnyxRTC SDK not loaded"; return; }
  try {
    rtcClient = new TelnyxRTC({ login_token: $("rtctoken").value });
    rtcClient.on("telnyx_rtc.ready", () => { $("rtcstate").textContent = "connected — waiting for escalation"; });
    rtcClient.on("telnyx_rtc.signal:incoming", (call) => {
      rtcCall = call;
      call.answer();
      try { call.muteAudio(); } catch {}
      $("rtcstate").textContent = "incoming — answered muted until joined";
    });
    rtcClient.on("telnyx_rtc.notification", (n) => { if (n && n.type === "error") $("rtcstate").textContent = "error: " + (n.message || "see console"); });
  } catch (e) { $("rtcstate").textContent = "connect failed"; }
};
</script>
</body>
</html>`;

// ── Caller simulator ─────────────────────────────────────────────────────

const CALLER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Caller Simulator — Telnyx</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${BRAND_CSS}
  body { max-width: 660px; padding: 26px 22px; }
  h1 { font-size: 17px; font-weight: 600; margin: 14px 0 6px; }
  .lead { color: #8a939e; font-size: 13px; line-height: 1.55; margin: 0 0 8px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(0,227,170,.12); color: #00e3aa; border: 1px solid rgba(0,227,170,.35); }
</style>
</head>
<body>
<header style="padding:0;border:0;background:none">
  ${TELNYX_LOGO}
  <span class="app-title">Caller Simulator</span>
</header>
<h1>Live Support Coach Room</h1>
<p class="lead">Simulates the caller side of a support call so the coach pipeline runs without telephony. Keep the supervisor dashboard open in the second tab.</p>
<h2>Conversation</h2>
<div>id: <span id="conv" class="badge">not started</span></div>
<button id="start">Start simulated call</button>
<button id="end" disabled style="background:#1a1f24;color:#fefdf5;margin-top:8px">End call</button>
<h2 style="margin-top:18px">Caller says</h2>
<textarea id="say" rows="3" placeholder="e.g. I need a refund on my order — my account number is 5521890244."></textarea>
<div>
  <button id="saybtn" disabled>Send caller turn</button>
</div>
<h2 style="margin-top:18px">Assistant says (simulate reply)</h2>
<input id="assistant" placeholder="e.g. Let me verify your identity with your date of birth.">
<div><button id="abtn" disabled style="background:#1a1f24;color:#fefdf5">Send assistant turn</button></div>
<h2 style="margin-top:18px">Transcript</h2>
<div id="log"></div>
<script>
const $ = (id) => document.getElementById(id);
let convId = null;
$("start").onclick = async () => {
  const res = await fetch("/demo/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const data = await res.json();
  convId = data.conversation_id;
  $("conv").textContent = convId;
  $("saybtn").disabled = false; $("abtn").disabled = false; $("end").disabled = false; $("start").disabled = true;
};
async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}
$("saybtn").onclick = async () => {
  const text = $("say").value.trim(); if (!convId || !text) return;
  $("say").value = "";
  const r = await post("/demo/say", { conversation_id: convId, text });
  log("caller", text);
  for (const inj of r.inject || []) log("coach", inj.item.content[0].text);
};
$("abtn").onclick = async () => {
  const text = $("assistant").value.trim(); if (!convId || !text) return;
  $("assistant").value = "";
  await post("/demo/assistant-say", { conversation_id: convId, text });
  log("assistant", text);
};
$("end").onclick = async () => {
  if (!convId) return;
  await post("/demo/end", { conversation_id: convId });
  log("system", "call ended — coach_log row filed");
  convId = null; $("conv").textContent = "not started";
  $("saybtn").disabled = true; $("abtn").disabled = true; $("end").disabled = true; $("start").disabled = false;
};
function log(role, text) {
  const d = document.createElement("div");
  d.className = "turn " + (role === "system" ? "coach" : role);
  d.innerHTML = '<span class="who">' + role + '</span>' + text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  $("log").appendChild(d);
}
</script>
</body>
</html>`;
