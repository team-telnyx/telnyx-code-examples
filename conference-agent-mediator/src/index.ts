// Re-export the actor classes so they ship with the bundle.
export { ConferenceAgent, ConferenceRegistry } from "./conferenceAgent";
import type { ConferenceAgent, ConferenceRegistry, ConferenceRecord, TurnRecord } from "./conferenceAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";
import { mountAgents } from "@telnyx/edge-runtime/mount";

type ConferenceStub = ActorStub &
  Pick<
    ConferenceAgent,
    | "onConferenceStart"
    | "addParticipant"
    | "removeParticipant"
    | "onTranscript"
    | "mediate"
    | "onConferenceEnd"
    | "getSnapshot"
    | "getTurns"
    | "getEvents"
  >;

interface ConferenceNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): ConferenceStub;
}

type RegistryStub = ActorStub &
  Pick<
    ConferenceRegistry,
    | "record"
    | "list"
    | "getActiveBridge"
    | "setActiveBridge"
    | "clearBridge"
    | "mapCall"
    | "conferenceForCall"
    | "unmapCall"
    | "unmapConference"
  >;

interface RegistryNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): RegistryStub;
}

interface Env {
  CONFERENCE: ConferenceNamespace;
  REGISTRY: RegistryNamespace;
  SECRETS: { get(handle: string): Promise<string> };
}

const TELNYX_API = "https://api.telnyx.com/v2";
const DEFAULT_MODEL = "zai-org/GLM-5.2";

function getApiKey(): string {
  const apiKey = process.env.TELNYX_API_KEY ?? "";
  if (!apiKey) throw new Error("TELNYX_API_KEY not configured");
  return apiKey;
}

/**
 * Demo mode: the DEMO_MODE secret wins when set (live-mode flip without a
 * redeploy), then the telnyx.toml env_var, then true (safe default).
 */
async function isDemoMode(env: Env): Promise<boolean> {
  try {
    const viaSecret = await env.SECRETS.get("DEMO_MODE");
    if (viaSecret) return viaSecret.toLowerCase() === "true";
  } catch {
    // secret not declared or store unavailable — fall through
  }
  return (process.env.DEMO_MODE ?? "true").toLowerCase() !== "false";
}

function aiModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

function conferenceActorName(conferenceId: string): string {
  // Dapr-safe: RFC 1123 — no "+", no special chars
  return conferenceId.replace(/[^0-9a-zA-Z.-]/g, "");
}

// ── Agent socket mount — WebSocket/SSE/RPC for observers ─────────────────
// Addresses: /agents/conference/<conference-id> — a WebSocket upgrade lands
// in ConferenceAgent.webSocket and receives state snapshots + patches live.
const handleAgents = mountAgents<Env>((env) => ({ conference: env.CONFERENCE }));

// ── Router ───────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Health ───────────────────────────────────────────────────────
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") {
      return Response.json({ status: "ok", demoMode: await isDemoMode(env) });
    }

    // ── Live transcript stream (agent socket mount) ──────────────────
    if (url.pathname.startsWith("/agents/")) {
      return handleAgents(req, env);
    }

    // ── Voice webhook ────────────────────────────────────────────────
    if (url.pathname === "/webhooks/voice" && req.method === "POST") {
      return handleVoiceWebhook(req, env);
    }

    // ── Demo simulation (safe — no live calls/SMS) ───────────────────
    if (req.method === "POST" && url.pathname === "/demo/conference") {
      return demoStart(req, env);
    }
    if (req.method === "POST" && url.pathname.startsWith("/demo/conference/")) {
      const rest = url.pathname.slice("/demo/conference/".length);
      const [id, action] = rest.split("/");
      if (!id || !action) return Response.json({ error: "expected /demo/conference/{id}/{join|say|end}" }, { status: 400 });
      if (action === "join") return demoJoin(req, env, id);
      if (action === "say") return demoSay(req, env, id);
      if (action === "end") return demoEnd(env, id);
      return Response.json({ error: `unknown demo action '${action}'` }, { status: 404 });
    }

    // ── Conference queries ───────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/conferences") {
      try {
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
        const rows: ConferenceRecord[] = await env.REGISTRY.idFromName("global").list(limit);
        return Response.json({ conferences: rows });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "failed to list conferences";
        return Response.json({ error: msg }, { status: 500 });
      }
    }
    if (req.method === "GET" && url.pathname.startsWith("/conferences/")) {
      const parts = url.pathname.split("/conferences/")[1].split("/");
      const id = parts[0];
      if (!id) return Response.json({ error: "conference id required" }, { status: 400 });
      try {
        const stub = env.CONFERENCE.idFromName(conferenceActorName(id));
        if (parts[1] === "transcript") {
          const since = Number(url.searchParams.get("since")) || 0;
          const data = await stub.getTurns(since);
          return Response.json({ conference_id: id, ...data });
        }
        if (parts[1] === "events") {
          const afterSeq = Number(url.searchParams.get("afterSeq")) || 0;
          const events = await stub.getEvents(afterSeq);
          return Response.json({ conference_id: id, events });
        }
        const state = await stub.getSnapshot();
        if (!state.conferenceId) return Response.json({ error: "conference not found" }, { status: 404 });
        // Write-back on read: once the pipeline is finished, publish the final
        // record to the registry actor (fetch env owns cross-actor writes).
        if (state.phase === "done" || state.phase === "error") {
          try {
            await env.REGISTRY.idFromName("global").record(snapshotToRecord(state));
          } catch {
            // best-effort — the snapshot above is the source of truth
          }
        }
        return Response.json(state);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "failed to fetch conference";
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    // ── Live dashboard ───────────────────────────────────────────────
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(DASHBOARD_HTML, {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};

// ── Telnyx voice webhook handler ─────────────────────────────────────────

async function handleVoiceWebhook(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const event = (body as { data?: Record<string, unknown> })?.data;
  const eventType = event?.event_type as string | undefined;
  const payload = (event?.payload ?? {}) as Record<string, unknown>;
  if (!eventType) {
    return Response.json({ error: "no event_type in payload" }, { status: 400 });
  }

  const demo = await isDemoMode(env);
  const conferenceId = (payload.conference_id as string) ?? (payload.conferenceId as string);
  const stub = env.CONFERENCE.idFromName(conferenceActorName(conferenceId || "unknown"));

  // ── call.initiated — answer + remember the leg ─────────────────
  if (eventType === "call.initiated") {
    const ccid = payload.call_control_id as string;
    if (!ccid) return Response.json({ error: "no call_control_id in payload" }, { status: 400 });
    try {
      const resp = await telnyxRest("/calls/" + encodeURIComponent(ccid) + "/actions/answer", {});
      if (!resp.ok) return telnyxFail("answer", resp);
    } catch (e: unknown) {
      return Response.json({ error: e instanceof Error ? e.message : "answer failed" }, { status: 500 });
    }
    try {
      await env.REGISTRY.idFromName("global").mapCall(ccid, "");
    } catch {
      // best-effort — mapping is re-set on answered
    }
    return Response.json({ action: "answering" });
  }

  // ── call.answered — create the bridge or join the active one ──
  if (eventType === "call.answered") {
    const ccid = payload.call_control_id as string;
    if (!ccid) return Response.json({ error: "no call_control_id in payload" }, { status: 400 });
    const registry = env.REGISTRY.idFromName("global");
    let bridge = "";
    try {
      bridge = await registry.getActiveBridge();
    } catch {
      // registry unavailable — treat as no bridge
    }
    if (!bridge) {
      // First caller: create the conference with this leg as participant #1.
      try {
        const resp = await telnyxRest("/conferences", {
          call_control_id: ccid,
          name: "bridge-" + Date.now().toString(36),
        });
        if (!resp.ok) return telnyxFail("conference_create", resp);
        const data = (await resp.json()) as { data?: { id?: string } };
        bridge = data?.data?.id ?? "";
      } catch (e: unknown) {
        return Response.json({ error: e instanceof Error ? e.message : "conference create failed" }, { status: 500 });
      }
      if (!bridge) return Response.json({ error: "conference created without id" }, { status: 502 });
      try {
        await registry.setActiveBridge(bridge);
      } catch {
        // best-effort — the next dial-in creates its own bridge
      }
    } else {
      // Later callers join the active bridge.
      try {
        const resp = await telnyxRest("/calls/" + encodeURIComponent(ccid) + "/actions/join_conference", {
          conference_id: bridge,
        });
        if (!resp.ok) return telnyxFail("join_conference", resp);
      } catch (e: unknown) {
        return Response.json({ error: e instanceof Error ? e.message : "join failed" }, { status: 500 });
      }
    }
    try {
      await registry.mapCall(ccid, bridge);
    } catch {
      // best-effort — client_state routing on transcription_start still applies
    }
    // Start STT on this leg; client_state routes transcription events back.
    try {
      await telnyxRest("/calls/" + encodeURIComponent(ccid) + "/actions/transcription_start", {
        transcription_tracks: "inbound",
        transcription_engine: "Telnyx",
        client_state: encodeClientState({ conference_id: bridge }),
        command_id: "transcribe-start-" + Date.now(),
      });
    } catch {
      // best-effort — the call still works without STT
    }
    return Response.json({ action: bridge ? "joined_bridge" : "bridge_created", conference_id: bridge });
  }

  // ── call.hangup — drop the leg's mapping ──────────────────────
  if (eventType === "call.hangup") {
    const ccid = payload.call_control_id as string;
    if (ccid) {
      try {
        await env.REGISTRY.idFromName("global").unmapCall(ccid);
      } catch {
        // best-effort
      }
    }
    return Response.json({ action: "hangup_tracked" });
  }

  // ── conference.created / conference.start ──────────────────────
  if (eventType === "conference.created" || eventType === "conference.start") {
    if (!conferenceId) return Response.json({ error: "no conference_id in payload" }, { status: 400 });
    await stub.onConferenceStart(conferenceId, {
      demo,
      friendlyName: (payload.name as string) ?? "",
      model: aiModel(),
    });
    await trackConferenceStart(env, {
      conference_id: conferenceId,
      friendly_name: (payload.name as string) ?? "",
      participants: 0,
      turn_count: 0,
      summary: "",
      started_at: Date.now(),
      ended_at: 0,
      status: "active",
    });
    return Response.json({ action: "agent_joined", conferenceId });
  }

  // ── conference.participant.joined ─────────────────────────────
  if (eventType === "conference.participant.joined") {
    if (!conferenceId) return Response.json({ error: "no conference_id in payload" }, { status: 400 });
    const name = (payload.call_control_id as string) ?? (payload.connection_id as string) ?? "participant";
    await stub.addParticipant(name, (payload.call_control_id as string) ?? undefined);
    return Response.json({ action: "participant_tracked", conferenceId });
  }

  // ── conference.participant.left ───────────────────────────────
  if (eventType === "conference.participant.left") {
    if (!conferenceId) return Response.json({ error: "no conference_id in payload" }, { status: 400 });
    const name = (payload.call_control_id as string) ?? "participant";
    await stub.removeParticipant(name);
    return Response.json({ action: "participant_removed", conferenceId });
  }

  // ── call.transcription ────────────────────────────────────────
  if (eventType === "call.transcription") {
    const transcriptionData = (payload.transcription_data ?? {}) as {
      transcript?: string;
      is_final?: boolean;
    };
    const fragment = String(transcriptionData.transcript || "").trim();
    if (!fragment) return Response.json({ action: "empty_transcription" });
    const isFinal = transcriptionData.is_final !== false;
    if (!isFinal) return Response.json({ action: "transcript_interim" });
    // Route: client_state stamped on transcription_start first, then the
    // registry's call→conference map (fetch-env actor, best-effort).
    const ccid = (payload.call_control_id as string) || "";
    const clientState = decodeClientState(payload.client_state);
    let route = clientState.conference_id ?? "";
    if (!route && ccid) {
      try {
        route = await env.REGISTRY.idFromName("global").conferenceForCall(ccid);
      } catch {
        // best-effort
      }
    }
    if (!route) return Response.json({ action: "no_conference_routing", call_control_id: ccid });
    const routeStub = env.CONFERENCE.idFromName(conferenceActorName(route));
    const speaker = clientState.speaker ?? (ccid || "participant");
    await routeStub.onTranscript(speaker, fragment);
    return Response.json({ action: "transcript_final", turn: fragment.slice(0, 120) });
  }

  // ── conference.ended ──────────────────────────────────────────
  if (eventType === "conference.ended" || eventType === "conference.end") {
    if (!conferenceId) return Response.json({ error: "no conference_id in payload" }, { status: 400 });
    await stub.onConferenceEnd();
    // The bridge is over: clear the pointer + leg mappings (best-effort).
    try {
      const registry = env.REGISTRY.idFromName("global");
      await registry.clearBridge();
      await registry.unmapConference(conferenceId);
    } catch {
      // best-effort
    }
    return Response.json({ action: "finalizing", conferenceId });
  }

  return Response.json({ action: "noop", event: eventType });
}

function encodeClientState(state: Record<string, string>): string {
  return btoa(JSON.stringify(state));
}

function decodeClientState(clientState: unknown): Record<string, string> {
  if (typeof clientState !== "string" || !clientState) return {};
  try {
    const decoded = JSON.parse(atob(clientState));
    return decoded && typeof decoded === "object" ? decoded : {};
  } catch {
    return {};
  }
}

export { encodeClientState };

// ── Demo simulation handlers ─────────────────────────────────────────────
// These drive the exact same agent pipeline as live webhooks, minus real
// Call Control / SMS side effects (agent runs with demo=true).

function newDemoId(): string {
  return `demo-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

async function demoStart(req: Request, env: Env): Promise<Response> {
  const body = (await safeJson(req)) as { name?: string };
  const conferenceId = newDemoId();
  const stub = env.CONFERENCE.idFromName(conferenceActorName(conferenceId));
  await stub.onConferenceStart(conferenceId, {
    demo: true,
    friendlyName: body?.name ?? "Demo Conference",
    model: aiModel(),
  });
  await trackConferenceStart(env, {
    conference_id: conferenceId,
    friendly_name: body?.name ?? "Demo Conference",
    participants: 0,
    turn_count: 0,
    summary: "",
    started_at: Date.now(),
    ended_at: 0,
    status: "active",
  });
  return Response.json({ conference_id: conferenceId, demo: true, next: "POST /demo/conference/{id}/join" });
}

/** Best-effort registry write from the fetch env (actors can't reach it). */
async function trackConferenceStart(env: Env, record: ConferenceRecord): Promise<void> {
  try {
    await env.REGISTRY.idFromName("global").record(record);
  } catch {
    // best-effort — /conferences/{id} write-back fills it in later
  }
}

async function demoJoin(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await safeJson(req)) as { name?: string };
  const name = body?.name?.trim();
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });
  await env.CONFERENCE.idFromName(conferenceActorName(id)).addParticipant(name);
  return Response.json({ joined: name, conference_id: id });
}

async function demoSay(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await safeJson(req)) as { speaker?: string; text?: string };
  const speaker = body?.speaker?.trim();
  const text = body?.text?.trim();
  if (!speaker || !text) return Response.json({ error: "speaker and text are required" }, { status: 400 });
  await env.CONFERENCE.idFromName(conferenceActorName(id)).onTranscript(speaker, text);
  return Response.json({ recorded: true, conference_id: id });
}

async function demoEnd(env: Env, id: string): Promise<Response> {
  await env.CONFERENCE.idFromName(conferenceActorName(id)).onConferenceEnd();
  return Response.json({
    ending: true,
    conference_id: id,
    next: "GET /conferences/{id} — summarize → store → notify pipeline runs asynchronously",
  });
}

async function safeJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── Telnyx REST helpers (fetch env — API key from the secrets store) ─────

function authHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

async function telnyxRest(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(TELNYX_API + path, {
    method: "POST",
    headers: authHeaders(getApiKey()),
    body: JSON.stringify(body),
  });
}

function telnyxFail(step: string, resp: Response): Promise<Response> {
  return resp
    .text()
    .then((errBody) =>
      Response.json(
        { action: "error", step, status: resp.status, err: errBody.slice(0, 200) },
        { status: 502 },
      ),
    );
}

function snapshotToRecord(state: {
  conferenceId: string;
  friendlyName: string;
  participants: Record<string, number>;
  turns: Array<unknown>;
  summary: string;
  startedAt: number;
  endedAt: number;
  phase: string;
}): ConferenceRecord {
  return {
    conference_id: state.conferenceId,
    friendly_name: state.friendlyName,
    participants: Object.keys(state.participants).length,
    turn_count: state.turns.length,
    summary: state.summary || "",
    started_at: state.startedAt,
    ended_at: state.endedAt || Date.now(),
    status: state.phase === "error" ? "error" : "stored",
  };
}

// ── Minimal live dashboard ───────────────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conference Agent Mediator — Live</title>
<style>
  :root { --bg:#fafafa; --card:#fff; --border:#e5e5e5; --text:#1a1a1a; --muted:#666; --accent:#41a; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .turn { padding: 6px 0; border-bottom: 1px dashed var(--border); font-size: 14px; }
  .turn:last-child { border-bottom: none; }
  .who { font-weight: 600; color: var(--accent); margin-right: 8px; }
  .mediator .who { color: #a63; }
  .phase { display: inline-block; padding: 2px 10px; border-radius: 999px; background: #eef; font-size: 12px; margin-left: 8px; }
  .summary { white-space: pre-wrap; font-size: 14px; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: #fff; cursor: pointer; margin-right: 8px; }
  button:hover { background: #f2f2f2; }
  input { font: inherit; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; margin-right: 8px; width: 160px; }
  #status { color: var(--muted); font-size: 12px; margin-top: 12px; }
</style>
</head>
<body>
<h1>Conference Agent Mediator</h1>
<div class="sub">AI meeting facilitator — transcribes, mediates turn-taking, summarizes. Telnyx Edge Compute.<br>The Mediator prompts participants who have been silent for ~60 seconds.</div>

<div class="card">
  <button onclick="startDemo()">Start demo conference</button>
  <input id="confId" placeholder="conference_id">
  <input id="name" placeholder="participant name">
  <button onclick="join()">Join</button>
  <input id="say" placeholder="What they said…" style="width:280px">
  <button onclick="say()">Say</button>
  <button onclick="endConf()">End conference</button>
  <div id="status"></div>
</div>

<div class="card" id="liveCard" style="display:none">
  <div>Transcript <span class="phase" id="phase"></span></div>
  <div id="turns"></div>
</div>

<div class="card" id="summaryCard" style="display:none">
  <div><b>Post-conference summary</b></div>
  <div class="summary" id="summary"></div>
</div>

<script>
let confId = "", since = 0, timer = null, sock = null, liveState = null;
function status(s, isErr) {
  const el = document.getElementById("status");
  el.textContent = s;
  el.style.color = isErr ? "#c33" : "";
}
async function api(path, body) {
  const res = await fetch(path, { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}
// ── WebSocket live transcript (agent socket mount) ──────────────────────
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  if (typeof target !== "object" || target === null || Array.isArray(target)) target = {};
  for (const k of Object.keys(patch)) {
    if (patch[k] === null) delete target[k];
    else target[k] = mergePatch(target[k], patch[k]);
  }
  return target;
}
function renderFromState(s) {
  if (!s) return;
  const el = document.getElementById("turns");
  el.innerHTML = "";
  for (const t of s.turns || []) {
    const d = document.createElement("div");
    d.className = "turn" + (t.speaker === "mediator" ? " mediator" : "");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = t.speaker === "mediator" ? "Mediator:" : t.speaker + ":";
    d.appendChild(who);
    d.appendChild(document.createTextNode(t.text));
    el.appendChild(d);
  }
  document.getElementById("phase").textContent = s.phase ? "phase: " + s.phase + " — live (WebSocket)" : "";
  if (s.phase === "done" || s.phase === "error") {
    document.getElementById("summary").textContent =
      s.summary || "(no summary generated" + (s.error ? " — " + s.error : "") + ")";
    document.getElementById("summaryCard").style.display = "block";
  }
}
function connectWS() {
  if (sock || !confId) return;
  const name = confId.replace(/[^0-9a-zA-Z.-]/g, "");
  const proto = location.protocol === "https:" ? "wss://" : "ws://";
  try { sock = new WebSocket(proto + location.host + "/agents/conference/" + name); } catch { return; }
  sock.onmessage = (e) => {
    try {
      const w = JSON.parse(e.data);
      const f = w.json ?? w; // mount wraps protocol frames in a {"json": ...} envelope
      if (f.kind === "state") {
        if (f.snapshot !== undefined) liveState = f.snapshot;
        else if (f.patch !== undefined) liveState = mergePatch(liveState, f.patch);
        renderFromState(liveState);
      }
    } catch { /* malformed frame — ignore */ }
  };
  sock.onopen = () => status("Live (WebSocket) — transcript pushes in real time.");
  sock.onclose = () => { sock = null; liveState = null; };
}
async function startDemo() {
  try {
    const r = await api("/demo/conference", { name: "Demo Conference" });
    confId = r.conference_id; document.getElementById("confId").value = confId;
    document.getElementById("turns").innerHTML = "";
    document.getElementById("liveCard").style.display = "block";
    document.getElementById("summaryCard").style.display = "none";
    since = 0; liveState = null; connectWS(); poll();
    status("Started " + confId + " — add participants, then type what they say. Silent participants get an AI prompt after ~60s.");
  } catch (e) { status("Start failed: " + e.message, true); }
}
async function join() {
  if (!conf()) return;
  const name = document.getElementById("name").value.trim();
  if (!name) { status("Type a participant name first.", true); return; }
  try {
    await api("/demo/conference/" + confId + "/join", { name });
    status(name + " joined — type what they say in the next box, then press Say.");
  } catch (e) { status("Join failed: " + e.message, true); }
}
async function say() {
  if (!conf()) return;
  const name = document.getElementById("name").value.trim() || "participant";
  const text = document.getElementById("say").value.trim();
  if (!text) { status("Type what they said first.", true); return; }
  try {
    await api("/demo/conference/" + confId + "/say", { speaker: name, text });
    document.getElementById("say").value = "";
    status("Recorded [" + name + "] — transcript updates below within ~2s.");
  } catch (e) { status("Say failed: " + e.message, true); }
}
async function endConf() {
  if (!conf()) return;
  try {
    await api("/demo/conference/" + confId + "/end");
    status("Conference ending — summarizing with the LLM, usually ~10–30s…");
    if (!timer) timer = setInterval(poll, 2000);
  } catch (e) { status("End failed: " + e.message, true); }
}
function conf() {
  confId = document.getElementById("confId").value.trim() || confId;
  if (!confId) { status("Start a demo conference or paste a conference_id first.", true); return false; }
  document.getElementById("liveCard").style.display = "block";
  connectWS();
  if (!timer) timer = setInterval(poll, 2000);
  return true;
}
async function poll() {
  if (!confId) return;
  if (sock && sock.readyState === 1) return; // WS covers it
  try {
    const r = await fetch("/conferences/" + confId + "/transcript?since=" + since).then(r => r.json());
    if (r.turns && r.turns.length) {
      const el = document.getElementById("turns");
      for (const t of r.turns) {
        const d = document.createElement("div");
        d.className = "turn" + (t.speaker === "mediator" ? " mediator" : "");
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = t.speaker === "mediator" ? "Mediator:" : t.speaker + ":";
        d.appendChild(who);
        d.appendChild(document.createTextNode(t.text));
        el.appendChild(d);
      }
      since = r.turns[r.turns.length - 1].at;
    }
    document.getElementById("phase").textContent = r.phase ? "phase: " + r.phase : "";
    if (r.phase === "done" || r.phase === "error") {
      document.getElementById("summary").textContent =
        r.summary || "(no summary generated" + (r.phase === "error" ? " — " + (r.summary || "see /events for the error") : "") + ")";
      document.getElementById("summaryCard").style.display = "block";
      status("Done — summary is below. Start another conference any time.");
      clearInterval(timer); timer = null;
    }
  } catch (e) { /* transient — next tick retries */ }
}
</script>
</body>
</html>`;
