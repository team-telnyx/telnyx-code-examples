import type { EventData } from "../types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * In-browser voice concierge — no dialing, no credentials.
 *
 * Uses @telnyx/ai-agent-lib (WebRTC): the browser connects straight to the
 * Telnyx AI Assistant with just an agent ID (anonymous login — no API key in
 * the page, no JWT minting). The assistant answers event questions through a
 * webhook tool backed by this function's KV namespace (/tools/lookup), so it
 * always says exactly what the microsite says.
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
  .transcript { max-height: 320px; overflow-y: auto; }
  .turn { margin: .5rem 0; padding: .5rem .8rem; border-radius: 8px; }
  .user { background: #243b6b; margin-left: 2rem; }
  .assistant { background: #232741; margin-right: 2rem; }
  .muted { color: #8b93a7; }
  a { color: #6ea8ff; }
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
    <p class="muted">Ask about the schedule, rooms, speakers, WiFi or parking — answers come live from the event KV store.</p>
  </div>

  <div class="panel">
    <h3>Live transcript</h3>
    <div id="transcript" class="transcript"><p class="muted">Nothing yet.</p></div>
  </div>

  <p><a href="/">← Back to the microsite</a></p>
</div>

<script type="module">
import { TelnyxAIAgent } from 'https://esm.sh/@telnyx/ai-agent-lib@0.6.5?bundle';

const stateEl = document.getElementById('state');
const transcriptEl = document.getElementById('transcript');
const connectBtn = document.getElementById('connectBtn');
const talkBtn = document.getElementById('talkBtn');
const endBtn = document.getElementById('endBtn');

let agent = null;
let firstTurn = true;

function addTurn(role, content) {
  if (firstTurn) { transcriptEl.innerHTML = ''; firstTurn = false; }
  const div = document.createElement('div');
  div.className = 'turn ' + role;
  div.textContent = role + ': ' + content;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

async function ensureAgentId() {
  const r = await fetch('/api/config');
  const cfg = await r.json();
  if (!cfg.assistant_id) throw new Error('Assistant not provisioned — POST /api/setup-assistant first.');
  return cfg.assistant_id;
}

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  stateEl.textContent = 'connecting…';
  try {
    const agentId = await ensureAgentId();
    agent = new TelnyxAIAgent({ agentId, debug: false });
    agent.on('agent.connected', () => {
      stateEl.textContent = 'connected';
      talkBtn.disabled = false;
    });
    agent.on('agent.disconnected', () => {
      stateEl.textContent = 'disconnected';
      talkBtn.disabled = true;
      endBtn.disabled = true;
      connectBtn.disabled = false;
    });
    agent.on('conversation.agent.state', (s) => { stateEl.textContent = s; });
    agent.on('transcript.item', (item) => {
      addTurn(item.role, item.content);
      captureFeedbackTurn(item.role, item.content);
    });
    await agent.connect();
  } catch (e) {
    stateEl.textContent = 'error: ' + (e?.message || e);
    connectBtn.disabled = false;
  }
});

talkBtn.addEventListener('click', async () => {
  if (!agent) return;
  talkBtn.disabled = true;
  endBtn.disabled = false;
  try {
    await agent.startConversation({ callerName: 'Attendee (browser)' });
  } catch (e) {
    stateEl.textContent = 'error: ' + (e?.message || e);
    talkBtn.disabled = false;
  }
});

endBtn.addEventListener('click', async () => {
  if (!agent) return;
  endBtn.disabled = true;
  try { await agent.endConversation(); } catch {}
  talkBtn.disabled = false;
});

// ── Feedback capture: user turns are saved as spoken feedback ──────────────
let feedbackTurns = [];
let feedbackTimer = null;
function captureFeedbackTurn(role, content) {
  if (role !== 'user' || !content) return;
  feedbackTurns.push(content);
  clearTimeout(feedbackTimer);
  // After 20s of no new user speech, submit the collected turns as feedback.
  feedbackTimer = setTimeout(submitFeedback, 20000);
}
async function submitFeedback() {
  if (!feedbackTurns.length) return;
  const transcript = feedbackTurns.join(' ');
  feedbackTurns = [];
  try {
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, phone_number: 'browser', source: 'voice' }),
    });
    addTurn('system', '(feedback saved for the sponsor report)');
  } catch {}
}
</script>
</body>
</html>`;
}
