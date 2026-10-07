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

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live Support Coach Room</title>
<script src="https://cdn.jsdelivr.net/npm/@telnyx/webrtc@2/dist/TelnyxRTC.min.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f1117; color: #e6e6e6; }
  header { display: flex; gap: 16px; align-items: center; padding: 12px 20px; border-bottom: 1px solid #262b36; }
  header h1 { font-size: 16px; margin: 0; flex: 1; }
  #status { font-size: 12px; padding: 3px 10px; border-radius: 12px; background: #262b36; }
  #status.live { background: #1c3a2a; color: #6ee7a0; }
  #status.down { background: #3a1c1c; color: #f87171; }
  main { display: grid; grid-template-columns: 280px 1fr 280px; gap: 12px; padding: 12px 20px; height: calc(100vh - 52px); }
  section { background: #161a23; border: 1px solid #262b36; border-radius: 10px; padding: 12px; overflow-y: auto; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8b93a7; margin: 0 0 10px; }
  .turn { padding: 8px 10px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; line-height: 1.45; }
  .turn .who { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #8b93a7; display: block; margin-bottom: 3px; }
  .turn.caller { background: #232a3a; }
  .turn.assistant { background: #1d2b26; }
  .turn.coach { background: #3a3320; border: 1px solid #6b5e26; }
  .turn.tool { background: #23232a; color: #9aa2b8; font-family: monospace; font-size: 12px; }
  .flag { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; background: #3a1c1c; color: #fca5a5; margin: 0 6px 6px 0; }
  button { background: #2b4c8c; color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; width: 100%; }
  button:disabled { opacity: .5; cursor: default; }
  input, select { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #2c3547; background: #0f1117; color: #e6e6e6; font-size: 13px; margin-bottom: 8px; }
  .kv { font-size: 12px; color: #8b93a7; margin: 2px 0; }
  .kv b { color: #e6e6e6; }
  .hidden { display: none; }
</style>
</head>
<body>
<header>
  <h1>Live Support Coach Room</h1>
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
      <div style="margin-top:10px">
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
  await fetch("/rooms/" + encodeURIComponent(conversationId) + "/join", { method: "POST" });
  // Unmute the softphone once the leg is in the AI conversation.
  if (rtcCall) { try { rtcCall.unmuteAudio(); } catch {} $("rtcstate").textContent = "live in AI conversation"; }
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
<title>Caller Simulator — Live Support Coach Room</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f1117; color: #e6e6e6; padding: 20px; max-width: 640px; }
  h1 { font-size: 18px; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8b93a7; }
  #conv { font-family: monospace; color: #6ee7a0; }
  textarea, input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #2c3547; background: #161a23; color: #e6e6e6; font-size: 14px; }
  button { background: #2b4c8c; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; margin: 8px 4px 0 0; }
  button:disabled { opacity: .5; }
  .turn { padding: 8px 10px; border-radius: 8px; margin: 8px 0; font-size: 13px; }
  .turn .who { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #8b93a7; display: block; }
  .turn.user { background: #232a3a; } .turn.assistant { background: #1d2b26; }
  .turn.coach { background: #3a3320; border: 1px solid #6b5e26; }
</style>
</head>
<body>
<h1>Caller Simulator</h1>
<p class="kv">Simulates the caller side of a support call so the coach pipeline runs without telephony. Keep the supervisor dashboard open in the second tab.</p>
<h2>Conversation</h2>
<div>id: <span id="conv">not started</span></div>
<button id="start">Start simulated call</button>
<button id="end" disabled>End call</button>
<h2 style="margin-top:16px">Caller says</h2>
<textarea id="say" rows="3" placeholder="e.g. I need a refund on my order — my account number is 5521890244."></textarea>
<div>
  <button id="saybtn" disabled>Send caller turn</button>
</div>
<h2 style="margin-top:16px">Assistant says (simulate reply)</h2>
<input id="assistant" placeholder="e.g. Let me verify your identity with your date of birth.">
<div><button id="abtn" disabled>Send assistant turn</button></div>
<h2 style="margin-top:16px">Transcript</h2>
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
