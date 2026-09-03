import type { EventData } from "../types";
import { envVars } from "../types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Server-rendered microsite — every value on this page comes from KV. */
export function renderMicrosite(data: EventData): string {
  const smsFrom = envVars.TELNYX_SMS_FROM || "the event number";
  const scheduleRows = data.schedule
    .map(
      (s) => `
      <div class="item">
        <strong>${esc(s.time)}</strong> — ${esc(s.title)}
        ${s.speaker ? `<br><em>by ${esc(s.speaker)}</em>` : ""}
        <br><small>📍 ${esc(s.room)}</small>
      </div>`,
    )
    .join("");

  const speakerCards = data.speakers
    .map(
      (sp) => `
      <div class="card">
        <strong>${esc(sp.name)}</strong><br>
        <span class="muted">${esc(sp.title)}</span>
        <p>${esc(sp.bio)}</p>
      </div>`,
    )
    .join("");

  const sponsorCards = data.sponsors
    .map(
      (s) =>
        `<div class="card"><strong>${esc(s.name)}</strong><br><span class="badge">${esc(s.tier)}</span></div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(data.event.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; margin: 0; background: #f5f6f8; color: #1a1a2e; }
  header { background: linear-gradient(135deg, #0062ff, #0048b8); color: #fff; padding: 2.5rem 1rem; text-align: center; }
  header h1 { margin: 0 0 .5rem; }
  .container { max-width: 960px; margin: 0 auto; padding: 1rem; }
  .section { background: #fff; margin: 1rem 0; padding: 1.5rem; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  h2 { color: #0062ff; margin-top: 0; border-bottom: 2px solid #e8f0fe; padding-bottom: .4rem; }
  .item { border-left: 3px solid #0062ff; padding: .5rem 1rem; margin: .6rem 0; }
  .cards { display: flex; flex-wrap: wrap; gap: 1rem; }
  .card { flex: 1 1 220px; border: 1px solid #e3e6ea; border-radius: 8px; padding: 1rem; }
  .badge { display: inline-block; background: #ff6b35; color: #fff; border-radius: 12px; padding: .15rem .7rem; font-size: .8rem; }
  .muted { color: #6b7280; }
  .contact { background: #e8f0fe; border-radius: 8px; padding: 1rem; text-align: center; }
  .contact code { background: #fff; padding: .2rem .5rem; border-radius: 4px; }
  .btn { display: inline-block; background: #0062ff; color: #fff; text-decoration: none; padding: .6rem 1.2rem; border-radius: 8px; margin: .3rem; }
  form { display: grid; gap: .6rem; max-width: 460px; }
  input, button { padding: .6rem; border-radius: 6px; border: 1px solid #cbd2d9; font-size: 1rem; }
  button { background: #0062ff; color: #fff; border: none; cursor: pointer; }
  #leadResult, #feedbackResult { margin-top: .6rem; font-weight: 600; }
</style>
</head>
<body>
<header>
  <h1>${esc(data.event.name)}</h1>
  <p>${esc(data.event.date)} • ${esc(data.event.location)}</p>
</header>
<div class="container">

  <div class="section">
    <h2>About</h2>
    <p>${esc(data.event.description)}</p>
  </div>

  <div class="section">
    <h2>Schedule</h2>
    ${scheduleRows}
  </div>

  <div class="section">
    <h2>Speakers</h2>
    <div class="cards">${speakerCards}</div>
  </div>

  <div class="section">
    <h2>Venue</h2>
    <p>📍 ${esc(data.venue.address)} — <a href="${esc(data.venue.map_url)}">map</a></p>
    <p><strong>WiFi:</strong> ${esc(data.venue.wifi)}</p>
    <p><strong>Parking:</strong> ${esc(data.venue.parking)}</p>
  </div>

  <div class="section">
    <h2>Sponsors</h2>
    <div class="cards">${sponsorCards}</div>
  </div>

  <div class="section">
    <h2>Talk to the Concierge</h2>
    <div class="contact">
      <p>Text <strong>${esc(smsFrom)}</strong> for schedule, rooms, speakers, WiFi, or parking — answered by AI from the same data this page is built from.</p>
      <a class="btn" href="/voice">🎙️ Talk to the concierge in your browser</a>
    </div>
  </div>

  <div class="section">
    <h2>Exhibitor — Scan a Lead</h2>
    <p class="muted">Text the concierge ("Acme Corp, 500 people, budget high, needed next month") or submit here. Hot leads route to sales instantly.</p>
    <form id="leadForm">
      <input name="company" placeholder="Company" required>
      <input name="company_size" placeholder="Company size" required>
      <input name="budget" placeholder="Budget (low / medium / high / enterprise)" required>
      <input name="timeline" placeholder="Timeline (e.g. immediate, this quarter)" required>
      <input name="phone_number" placeholder="Contact phone (+E.164)" required>
      <button type="submit">Submit lead</button>
    </form>
    <div id="leadResult"></div>
  </div>

  <div class="section">
    <h2>Register for Updates</h2>
    <form id="attendeeForm">
      <input name="phone_number" placeholder="Your phone (+E.164)" required>
      <button type="submit">Get schedule-change alerts by text</button>
    </form>
    <div id="attendeeResult"></div>
  </div>

  <div class="section">
    <h2>Post-Event Feedback</h2>
    <p class="muted">Record a short voice note — it's transcribed and summarized into the sponsor report.</p>
    <button id="recordBtn">🎙️ Start recording</button>
    <span id="recState" class="muted"></span>
    <div id="feedbackResult"></div>
  </div>

</div>
<script>
const origin = location.origin;
document.getElementById('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  const out = document.getElementById('leadResult');
  try {
    const r = await fetch(origin + '/api/leads', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    out.textContent = d.is_hot ? '🔥 HOT LEAD — routed to sales now.' : 'Lead saved' + (d.error ? (' — ' + d.error) : '.');
    out.style.color = d.is_hot ? '#c2410c' : '#0062ff';
  } catch { out.textContent = 'Network error — try again.'; out.style.color = '#b91c1c'; }
});
document.getElementById('attendeeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target).entries());
  const out = document.getElementById('attendeeResult');
  try {
    const r = await fetch(origin + '/api/attendees', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const d = await r.json();
    out.textContent = d.ok ? 'Registered — you will get text updates.' : ('Error: ' + (d.error || 'unknown'));
  } catch { out.textContent = 'Network error — try again.'; }
});
// ── Voice feedback: MediaRecorder → /api/feedback → Whisper → summary ──
let mediaRecorder = null; let chunks = [];
const recordBtn = document.getElementById('recordBtn');
const recState = document.getElementById('recState');
const fbResult = document.getElementById('feedbackResult');
recordBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop(); return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => chunks.push(ev.data);
    mediaRecorder.onstop = async () => {
      recordBtn.textContent = '🎙️ Start recording';
      recState.textContent = 'Uploading + transcribing…';
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const phone = prompt('Your phone (for the report):', '+15551234567') || '';
      const form = new FormData();
      form.append('audio', blob, 'feedback.webm');
      form.append('phone_number', phone);
      try {
        const r = await fetch(origin + '/api/feedback', { method: 'POST', body: form });
        const d = await r.json();
        if (d.error) { fbResult.textContent = 'Error: ' + d.error; return; }
        recState.textContent = '';
        fbResult.innerHTML = '<strong>Thanks!</strong> Summary: ' + (d.summary || d.transcript || '(empty)');
      } catch { recState.textContent = 'Upload failed — try again.'; }
    };
    mediaRecorder.start();
    recordBtn.textContent = '⏹️ Stop & submit';
    recState.textContent = 'Recording…';
  } catch { recState.textContent = 'Microphone permission denied.'; }
});
</script>
</body>
</html>`;
}
