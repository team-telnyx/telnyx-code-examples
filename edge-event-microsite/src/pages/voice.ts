import type { EventData } from "../types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * In-browser voice concierge — no dialing, no credentials.
 *
 * Uses @telnyx/webrtc (WebRTC) with anonymous_login: the browser connects
 * straight to the Telnyx AI Assistant with just an assistant id — no API key
 * in the page, no JWT minting. After login, newCall's destination is ignored
 * and routed to the assistant. The assistant answers event questions through
 * a webhook tool backed by this function's KV namespace (/tools/lookup), so
 * it always says exactly what the microsite says.
 */
export function renderVoicePage(data: EventData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Voice Concierge — ${esc(data.event.name)}</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 0; background: #0f1222; color: #eef1f7; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 2rem 1rem; }
  h1 { color: #6ea8ff; }
  .panel { background: #181c30; border-radius: 12px; padding: 1.5rem; margin: 1rem 0; }
  button { background: #0062ff; color: #fff; border: none; border-radius: 8px; padding: .7rem 1.3rem; font-size: 1rem; cursor: pointer; margin: .25rem; }
  button:disabled { opacity: .4; cursor: not-allowed; }
  button.danger { background: #b91c1c; }
  #state { font-weight: 700; color: #6ea8ff; }
  #error { color: #f87171; font-size: .9rem; min-height: 1.2rem; }
  .muted { color: #8b93a7; }
  a { color: #6ea8ff; }
  #remoteAudio { width: 100%; margin-top: .5rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🎙️ Voice Concierge</h1>
  <p class="muted">${esc(data.event.name)} — talk right here in the browser. No number to dial.</p>

  <div class="panel">
    <button id="connectBtn">Connect</button>
    <button id="talkBtn" disabled>Talk to the concierge</button>
    <button id="endBtn" class="danger" disabled>End</button>
    <p>State: <span id="state">idle</span></p>
    <div id="error"></div>
    <p class="muted">Ask about the schedule, rooms, speakers, WiFi or parking — answers come live from the event KV store.</p>
    <audio id="remoteAudio" autoplay controls></audio>
  </div>

  <p><a href="/">← Back to the microsite</a></p>
</div>

<script type="module">
import { TelnyxRTC } from 'https://unpkg.com/@telnyx/webrtc@2.27.10/lib/bundle.mjs';

const stateEl = document.getElementById('state');
const errorEl = document.getElementById('error');
const connectBtn = document.getElementById('connectBtn');
const talkBtn = document.getElementById('talkBtn');
const endBtn = document.getElementById('endBtn');
const remoteAudio = document.getElementById('remoteAudio');

let client = null;
let call = null;
let connectTimeout = null;

function setState(s) { stateEl.textContent = s; }
function fail(msg) {
  errorEl.textContent = 'Error: ' + msg;
  setState('error');
  clearTimeout(connectTimeout);
  connectBtn.disabled = false;
  talkBtn.disabled = true;
  endBtn.disabled = true;
}

async function ensureAgentId() {
  const r = await fetch('/api/config');
  const cfg = await r.json();
  if (!cfg.assistant_id) throw new Error('Assistant not provisioned — POST /api/setup-assistant first.');
  return cfg.assistant_id;
}

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  errorEl.textContent = '';
  setState('connecting…');
  try {
    const agentId = await ensureAgentId();

    client = new TelnyxRTC({
      anonymous_login: { target_type: 'ai_assistant', target_id: agentId },
    });

    client.on('telnyx.ready', () => {
      clearTimeout(connectTimeout);
      setState('connected — ready to talk');
      talkBtn.disabled = false;
    });

    client.on('telnyx.error', (err) => {
      fail((err && (err.message || err.code)) || 'connection error');
    });

    client.on('telnyx.notification', (n) => {
      if (!n) return;
      if (n.type === 'callUpdate' && n.call) {
        const s = n.call.state || n.call.cause;
        if (s) setState('call: ' + s);
        if (s === 'active') { talkBtn.disabled = true; endBtn.disabled = false; }
        if (s === 'hangup' || s === 'ended' || s === 'busy') {
          endBtn.disabled = true;
          talkBtn.disabled = false;
          call = null;
        }
      }
      if (n.type === 'userMediaError') fail('microphone permission denied');
      if (n.type === 'peerConnectionFailedError') fail('media connection failed — check network');
    });

    // Guardrail: never hang on "connecting…" silently.
    connectTimeout = setTimeout(() => {
      if (stateEl.textContent === 'connecting…') {
        fail('connect timed out after 15s — reload the page and try again');
      }
    }, 15000);

    await client.connect();
  } catch (e) {
    fail(e?.message || String(e));
  }
});

talkBtn.addEventListener('click', () => {
  if (!client) return;
  errorEl.textContent = '';
  try {
    // Destination is ignored after anonymous login — routed to the assistant.
    call = client.newCall({
      destinationNumber: '',
      audio: true,
      remoteElement: remoteAudio,
      callerName: 'Attendee (browser)',
    });
    setState('calling…');
  } catch (e) {
    fail(e?.message || String(e));
  }
});

endBtn.addEventListener('click', () => {
  try { if (call) call.hangup(); } catch {}
  endBtn.disabled = true;
  talkBtn.disabled = false;
  setState('connected — ready to talk');
});
</script>
</body>
</html>`;
}
