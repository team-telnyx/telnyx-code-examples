/**
 * Demo UI: a single-file browser client for the replay socket protocol.
 *
 * Speaks the agent socket wire directly (attach → state/messages/events
 * streams → call frames for play/pause/speed/commentary), so the sample has
 * zero client build step: the Edge function serves this page at `/`.
 */
import type { ReplayEnv } from "./types.js";

export const BRAND_VERSION = "agent-message-replay v0.1.0";

/** Escape a string for safe HTML interpolation inside the client script. */
function jsString(value: string): string {
  return JSON.stringify(value);
}

export function demoHtml(env: ReplayEnv): string {
  const defaultToken = env.REPLAY_TOKEN ?? "replay-demo";
  const model = env.MODEL ?? "zai-org/GLM-5.2";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Message Replay — Live Streaming Replay on Telnyx Edge</title>
<style>
  :root { --green: #00e3aa; --bg: #0a0a0a; --card: #161616; --border: #2a2a2a; --text: #e8e8e8; --muted: #888; --amber: #f59e0b; --blue: #7ec8ff; --red: #ff6b6b; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 24px; max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  h1 span { color: var(--green); }
  .thesis { color: var(--muted); font-size: 0.85rem; margin-bottom: 16px; line-height: 1.5; }
  .thesis strong { color: var(--green); }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; font-size: 0.85rem; }
  .bar label { color: var(--muted); font-size: 0.75rem; }
  .bar input[type=text] { padding: 7px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.8rem; width: 130px; }
  .bar button { padding: 7px 14px; background: var(--green); color: #000; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.8rem; }
  .bar button.secondary { background: var(--card); color: var(--green); border: 1px solid var(--green); }
  .bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  .bar select { padding: 7px 10px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.8rem; }
  .bar .conn { margin-left: auto; font-size: 0.75rem; }
  .conn.ok { color: var(--green); } .conn.bad { color: var(--red); } .conn.wait { color: var(--amber); }
  .statusline { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 16px; font-size: 0.8rem; }
  .pill { background: var(--card); border: 1px solid var(--border); padding: 3px 10px; border-radius: 999px; color: var(--muted); }
  .pill b { color: var(--text); font-family: monospace; }
  .pill.stage b { color: var(--green); }
  .pill.busy b { color: var(--amber); }
  .grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 18px; }
  @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 18px; }
  .card h2 { font-size: 1rem; margin-bottom: 10px; color: var(--green); }
  .chat-log { height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem; line-height: 1.5; padding: 4px 2px; }
  .msg { padding: 8px 12px; border-radius: 10px; max-width: 85%; border: 1px solid var(--border); }
  .msg .who { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .msg.user { align-self: flex-end; background: #101c26; border-color: #1d3a4d; }
  .msg.user .who { color: var(--blue); }
  .msg.assistant { align-self: flex-start; background: #0c241d; border-color: #14413a; }
  .msg.assistant .who { color: var(--green); }
  .msg.system { align-self: center; color: var(--muted); font-size: 0.75rem; }
  .scrub-row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
  .scrub-row input[type=range] { flex: 1; accent-color: var(--green); }
  .live-badge { font-size: 0.72rem; padding: 2px 10px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); cursor: pointer; }
  .live-badge.on { color: var(--green); border-color: var(--green); }
  .stage-badge { display: inline-block; background: #0c2a23; border: 1px solid #14413a; color: var(--green); padding: 4px 12px; border-radius: 999px; font-family: monospace; font-size: 0.85rem; margin-bottom: 10px; }
  .state-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.78rem; margin-bottom: 12px; }
  .state-grid div { padding: 6px 10px; background: var(--bg); border-radius: 6px; border: 1px solid var(--border); }
  .state-grid .label { color: var(--muted); }
  .state-grid .value { color: var(--green); font-family: monospace; }
  .trail { max-height: 150px; overflow-y: auto; font-size: 0.75rem; line-height: 1.7; }
  .trail .entry { padding: 4px 8px; border-left: 2px solid var(--green); margin-bottom: 6px; background: var(--bg); border-radius: 0 6px 6px 0; }
  .trail .entry .t { color: var(--muted); }
  .trail .entry b { color: var(--green); font-family: monospace; }
  .feed { max-height: 240px; overflow-y: auto; font-size: 0.78rem; line-height: 1.6; display: flex; flex-direction: column; gap: 8px; }
  .feed .commentary { padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-left: 3px solid var(--amber); border-radius: 0 8px 8px 0; }
  .feed .commentary .tag { color: var(--amber); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.5px; }
  .feed .sysline { color: var(--muted); font-size: 0.72rem; }
  .feed .sysline b { color: var(--text); }
  .empty { color: var(--muted); font-style: italic; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>Agent Message Replay on <span>Edge</span></h1>
<p class="thesis">Replay is a <strong>durable actor</strong>: recorded messages stream through the <strong>MessageLog</strong> over a live <strong>WebSocket</strong>, original state changes re-enact as state patches, and an LLM annotates the conversation as it plays. Scrub the timeline to move through history.</p>

<div class="bar">
  <label>token</label> <input type="text" id="token" value=${jsString(defaultToken)}>
  <label>conversation</label> <input type="text" id="conv" value="demo-1">
  <button id="btn-connect">Connect</button>
  <button id="btn-seed" class="secondary" disabled>Load demo</button>
  <button id="btn-play" class="secondary" disabled>&#9654; Play</button>
  <button id="btn-pause" class="secondary" disabled>Pause</button>
  <label>speed</label>
  <select id="speed" disabled><option>0.5</option><option selected>1</option><option>2</option><option>4</option></select>
  <label><input type="checkbox" id="commentary" disabled> LLM commentary</label>
  <span class="conn wait" id="conn">connecting&hellip;</span>
</div>

<div class="statusline">
  <span class="pill">replay: <b id="st-status">empty</b></span>
  <span class="pill">playhead: <b id="st-playhead">0 / 0</b></span>
  <span class="pill">model: <b>${model}</b></span>
  <span class="pill stage">stage: <b id="st-stage">&mdash;</b></span>
  <span class="pill busy">commentary: <b id="st-busy">off</b></span>
</div>

<div class="grid">
  <div class="card">
    <h2>Replayed conversation</h2>
    <div class="chat-log" id="chat"><div class="empty">Connect, then press &ldquo;Load demo&rdquo; and &ldquo;Play&rdquo;. Messages stream in live from the agent&rsquo;s MessageLog.</div></div>
    <div class="scrub-row">
      <input type="range" id="scrub" min="0" max="0" value="0" step="1">
      <span class="live-badge on" id="live">LIVE</span>
      <span class="pill" style="border:none;background:none"><b id="scrub-pos">0</b><span style="color:var(--muted)"> msgs</span></span>
    </div>
  </div>
  <div>
    <div class="card">
      <h2>Agent state (re-enacted)</h2>
      <span class="stage-badge" id="stage-badge">idle</span>
      <div class="state-grid">
        <div><div class="label">conversation</div><div class="value" id="st-conv">&mdash;</div></div>
        <div><div class="label">speed</div><div class="value" id="st-speed">1</div></div>
        <div><div class="label">recording loaded</div><div class="value" id="st-total">0 steps</div></div>
        <div><div class="label">watchers</div><div class="value" id="st-watchers">&mdash;</div></div>
      </div>
      <div class="trail" id="trail"><div class="empty">State changes appear here as the replay re-enacts them.</div></div>
    </div>
    <div class="card">
      <h2>LLM commentary</h2>
      <div class="feed" id="feed"><div class="empty">Toggle commentary above, then play — the model annotates each agent message.</div></div>
    </div>
  </div>
</div>

<script>
(function () {
  'use strict';
  var ws = null;
  var state = null;
  var messages = [];
  var events = [];
  var pendingCalls = new Map();
  var viewLive = true;
  var viewPos = 0;
  var callSeq = 0;

  var el = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  };

  // ---- wire protocol (agent socket v1 calls + v2 attach) -------------------
  // Frames are SuperJSON text frames: { json: <frame>, meta?: <transforms> }.
  function decode(raw) {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && 'json' in parsed ? parsed.json : parsed;
  }
  function send(frame) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ json: frame })); }
  function call(method, args) {
    var id = 'c' + (++callSeq);
    return new Promise(function (resolve, reject) {
      pendingCalls.set(id, { resolve: resolve, reject: reject });
      send({ v: 1, kind: 'call', id: id, method: method, args: args || [] });
      setTimeout(function () {
        if (pendingCalls.has(id)) { pendingCalls.delete(id); reject(new Error('timeout')); }
      }, 15000);
    });
  }

  // RFC 7396 merge-patch, mirroring the server-side semantics.
  function mergePatch(target, patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    if (typeof target !== 'object' || target === null || Array.isArray(target)) target = {};
    Object.keys(patch).forEach(function (k) {
      var v = patch[k];
      if (v === null) { delete target[k]; return; }
      target[k] = (typeof v === 'object' && !Array.isArray(v))
        ? mergePatch(target[k], v) : v;
    });
    return target;
  }

  function handleFrame(frame) {
    if (!frame || typeof frame !== 'object') return;
    switch (frame.kind) {
      case 'hello':
        setConn('ok', 'connected');
        break;
      case 'attached':
        var canRpc = (frame.grants || []).indexOf('rpc') !== -1;
        ['btn-seed', 'btn-play', 'btn-pause', 'speed', 'commentary'].forEach(function (id) {
          el(id).disabled = !canRpc;
        });
        if (!canRpc) setConn('wait', 'read-only (bad token?)');
        break;
      case 'state':
        if (frame.snapshot !== undefined) state = frame.snapshot;
        else if (frame.patch !== undefined) state = mergePatch(state || {}, frame.patch);
        renderState();
        break;
      case 'messages':
        if (frame.snapshot !== undefined) messages = frame.snapshot.slice();
        else if (frame.appended !== undefined) messages = messages.concat(frame.appended);
        if (viewLive) { viewPos = messages.length; }
        el('scrub').max = String(messages.length);
        renderMessages();
        break;
      case 'event':
        events.push(frame);
        renderPanels();
        break;
      case 'result':
        var ok = pendingCalls.get(frame.id);
        if (ok) { pendingCalls.delete(frame.id); ok.resolve(frame.value); }
        break;
      case 'error':
        var bad = frame.id ? pendingCalls.get(frame.id) : null;
        if (bad) { pendingCalls.delete(frame.id); bad.reject(new Error(frame.message)); }
        else { setConn('bad', 'error: ' + frame.code); }
        break;
      case 'pong':
        break;
    }
  }

  // ---- connection ----------------------------------------------------------
  function connect() {
    var token = el('token').value.trim();
    var conv = el('conv').value.trim() || 'demo-1';
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    setConn('wait', 'connecting\u2026');
    try { if (ws) ws.close(); } catch (e) { /* socket already gone */ }
    messages = []; events = []; state = null; viewPos = 0; viewLive = true;
    ws = new WebSocket(proto + location.host + '/ws?conv=' + encodeURIComponent(conv));
    ws.onopen = function () {
      send({ v: 2, kind: 'attach', token: token || undefined, subscribe: ['state', 'messages', 'events'] });
    };
    ws.onmessage = function (ev) {
      try { handleFrame(decode(ev.data)); }
      catch (err) { setConn('bad', 'bad frame: ' + err.message); }
    };
    ws.onclose = function () { setConn('bad', 'disconnected'); };
    ws.onerror = function () { setConn('bad', 'socket error'); };
  }

  function setConn(cls, text) { var c = el('conn'); c.className = 'conn ' + cls; c.innerHTML = esc(text); }

  // ---- rendering -----------------------------------------------------------
  function visibleMessages() { return viewLive ? messages : messages.slice(0, viewPos); }
  function visibleEvents() {
    var limit = viewLive ? Infinity : viewPos;
    return events.filter(function (e) {
      var p = e.payload || {};
      return (p.stepIndex === undefined ? Infinity : p.stepIndex) < limit;
    });
  }

  function renderMessages() {
    var log = el('chat');
    var list = visibleMessages();
    log.innerHTML = list.length
      ? list.map(function (m) {
          var who = m.role === 'user' ? 'customer' : (m.role === 'assistant' ? 'agent' : m.role);
          return '<div class="msg ' + esc(m.role) + '"><div class="who">' + esc(who) + ' &middot; #' + esc(m.seq) + '</div>' + esc(m.content) + '</div>';
        }).join('')
      : '<div class="empty">No messages replayed yet.</div>';
    log.scrollTop = log.scrollHeight;
    el('scrub-pos').textContent = String(viewLive ? messages.length : viewPos);
    el('live').className = 'live-badge' + (viewLive ? ' on' : '');
    renderPanels();
  }

  function renderState() {
    if (!state) return;
    el('st-status').textContent = state.status || 'empty';
    el('st-playhead').textContent = (state.playhead || 0) + ' / ' + (state.total || 0);
    el('st-stage').textContent = state.agentStage || '\u2014';
    el('st-busy').textContent = state.commentaryBusy ? 'thinking\u2026' : (state.commentary ? 'on' : 'off');
    el('st-conv').textContent = state.conversationId || '\u2014';
    el('st-speed').textContent = String(state.speed || 1);
    el('st-total').textContent = (state.total || 0) + ' steps';
    el('stage-badge').textContent = state.agentStage || 'idle';
  }

  function renderPanels() {
    var trail = el('trail');
    var stateChanges = visibleEvents().filter(function (e) { return e.type === 'state_change'; });
    trail.innerHTML = stateChanges.length
      ? stateChanges.map(function (e) {
          return '<div class="entry"><b>' + esc(e.payload.stage) + '</b> <span class="t">at step ' + esc(e.payload.stepIndex + 1) + ' &middot; event #' + esc(e.seq) + '</span></div>';
        }).join('')
      : '<div class="empty">State changes appear here as the replay re-enacts them.</div>';

    var feed = el('feed');
    var rows = [];
    visibleEvents().forEach(function (e) {
      var p = e.payload || {};
      if (e.type === 'commentary') {
        rows.push('<div class="commentary"><div class="tag">commentary &middot; step ' + esc(p.stepIndex + 1) + ' &middot; ' + esc(p.model || '') + '</div>' + esc(p.text) + '</div>');
      } else if (e.type === 'playback_started') {
        rows.push('<div class="sysline">&#9654; playback started at playhead <b>' + esc(p.playhead) + '</b></div>');
      } else if (e.type === 'playback_paused') {
        rows.push('<div class="sysline">&#10074;&#10074; paused at playhead <b>' + esc(p.playhead) + '</b></div>');
      } else if (e.type === 'playback_seeked') {
        rows.push('<div class="sysline">&#8634; seeked to <b>' + esc(p.playhead) + '</b></div>');
      } else if (e.type === 'recording_loaded') {
        rows.push('<div class="sysline">&#128190; loaded <b>' + esc(p.conversationId) + '</b> (' + esc(p.total) + ' steps)</div>');
      } else if (e.type === 'replay_finished') {
        rows.push('<div class="sysline">&#9989; replay finished (' + esc(p.total) + ' steps)</div>');
      } else if (e.type === 'commentary_error') {
        rows.push('<div class="sysline" style="color:var(--red)">&#9888; commentary failed at step ' + esc(p.stepIndex + 1) + ' \u2014 ' + esc(p.message || '') + '</div>');
      }
    });
    feed.innerHTML = rows.length ? rows.join('') : '<div class="empty">Toggle commentary above, then play \u2014 the model annotates each agent message.</div>';
    feed.scrollTop = feed.scrollHeight;
  }

  // ---- controls ------------------------------------------------------------
  el('btn-connect').onclick = connect;
  el('btn-seed').onclick = function () { call('seed').catch(showCallError); };
  el('btn-play').onclick = function () { call('play').catch(showCallError); };
  el('btn-pause').onclick = function () { call('pause').catch(showCallError); };
  el('speed').onchange = function () { call('setSpeed', [parseFloat(el('speed').value)]).catch(showCallError); };
  el('commentary').onchange = function () { call('setCommentary', [el('commentary').checked]).catch(showCallError); };
  el('live').onclick = function () { viewLive = true; viewPos = messages.length; el('scrub').value = String(messages.length); renderMessages(); };
  el('scrub').oninput = function () {
    var pos = parseInt(el('scrub').value, 10) || 0;
    viewLive = pos >= messages.length;
    viewPos = pos;
    renderMessages();
  };

  function showCallError(err) { setConn('wait', 'call failed: ' + (err && err.message ? err.message : 'unknown')); }

  // Auto-connect on load so the demo is one click from a cold open.
  connect();
})();
</script>
</body>
</html>`;
}
