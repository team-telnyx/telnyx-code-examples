/**
 * The branded microsite — Telnyx design system applied to the event
 * sponsorship agent. Black canvas, cream type, PP Formula display face,
 * Telnyx Green as the single accent, pill CTAs, no emoji.
 */
import { PP_FORMULA_WOFF2_B64, TELNYX_LOGO_SVG } from "./assets";

export interface MicrositeOpts {
  eventName: string;
  prize: string;
  smsNumber: string; // E.164, used for display + sms:/tel: links
}

const FONT_FACE = `
@font-face {
  font-family: "PP Formula";
  src: url("/fonts/pp-formula.woff2") format("woff2");
  font-weight: 800;
  font-style: normal;
  font-display: swap;
}`;

const CSS = `
:root {
  --telnyx-black: #000000;
  --telnyx-cream: #FEFDF5;
  --telnyx-green: #00E3AA;
  --telnyx-green-10: #CCF9EE;
  --telnyx-slate: #141414;
  --telnyx-graphite: #1E1E1E;
  --fg-1: #FEFDF5;
  --fg-2: #C7C7C2;
  --fg-3: #8A8A85;
  --border-dark: rgba(255,255,255,0.08);
  --border-dark-strong: rgba(255,255,255,0.16);
  --glow-green: 0 0 60px rgba(0,227,170,0.25);
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-pill: 999px;
  --font-display: "PP Formula", "Inter Tight", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter Tight", ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: "Courier New", Courier, ui-monospace, monospace;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-med: 220ms;
  --dur-slow: 420ms;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  background: var(--telnyx-black);
  color: var(--fg-1);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }

/* ── Fixed nav ─────────────────────────────────────────────── */
.nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  height: 64px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px;
  background: rgba(0,0,0,0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border-dark);
}
.nav img.logo { height: 22px; display: block; }
.nav .event-label {
  font-weight: 600; font-size: 13px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--fg-3);
}

/* ── Hero ──────────────────────────────────────────────────── */
.hero { max-width: 1280px; margin: 0 auto; padding: 128px 24px 48px; }
.eyebrow {
  font-weight: 600; font-size: 13px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--fg-3); margin: 0 0 16px;
}
h1.hero-title {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(40px, 7vw, 72px);
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0 0 16px;
  color: var(--fg-1);
  text-wrap: balance;
  animation: tx-enter var(--dur-slow) var(--ease-out) both;
}
.lede { font-size: 18px; line-height: 1.5; color: var(--fg-2); max-width: 640px; margin: 0 0 32px; }

/* ── Reach panel — the number is the lanyard ───────────────── */
.reach {
  display: flex; flex-wrap: wrap; gap: 16px; margin: 0 0 24px;
  animation: tx-enter 420ms var(--ease-out) 80ms both;
}
.reach-card {
  flex: 1 1 320px; max-width: 480px;
  background: var(--telnyx-slate);
  border: 1px solid var(--border-dark);
  border-radius: var(--radius-xl);
  padding: 24px;
}
.reach-card.prize-card { border-color: rgba(0,227,170,0.35); box-shadow: var(--glow-green); }
.reach-card .card-eyebrow {
  font-weight: 600; font-size: 13px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--telnyx-green); margin: 0 0 8px;
}
.big-number {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: clamp(28px, 5vw, 40px);
  letter-spacing: -0.02em;
  line-height: 1.05;
  color: var(--fg-1);
  margin: 0 0 4px;
}
.card-note { font-size: 14px; color: var(--fg-2); margin: 0 0 16px; }
.btn-row { display: flex; flex-wrap: wrap; gap: 12px; }
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  border-radius: var(--radius-pill);
  padding: 12px 20px;
  font-family: var(--font-body);
  font-weight: 600; font-size: 13px;
  letter-spacing: 0.08em; text-transform: uppercase;
  transition: background var(--dur-med) var(--ease-out), border-color var(--dur-med) var(--ease-out), color var(--dur-med) var(--ease-out);
  cursor: pointer;
}
.btn:active { transform: translateY(1px); }
.btn-primary { background: var(--telnyx-green); color: #000000; border: 1px solid var(--telnyx-green); }
.btn-primary:hover { background: #FFFFFF; border-color: #FFFFFF; color: #000000; }
.btn-ghost { background: transparent; color: var(--fg-1); border: 1px solid rgba(255,255,255,0.32); }
.btn-ghost:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.32); }

/* ── Languages ─────────────────────────────────────────────── */
.lang-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  font-size: 13px; color: var(--fg-3); margin: 0 0 64px;
}
.lang-chip {
  border: 1px solid var(--border-dark);
  border-radius: var(--radius-pill);
  padding: 4px 12px;
  font-weight: 600; font-size: 12px; letter-spacing: 0.08em;
  color: var(--fg-2);
}

/* ── Chat ──────────────────────────────────────────────────── */
.chat-section { max-width: 1280px; margin: 0 auto; padding: 0 24px 96px; display: flex; gap: 24px; flex-wrap: wrap; }
.chat-panel {
  flex: 1 1 560px;
  background: var(--telnyx-slate);
  border: 1px solid var(--border-dark);
  border-radius: var(--radius-xl);
  overflow: hidden;
  display: flex; flex-direction: column;
  min-height: 520px;
}
.chat-head {
  padding: 20px 24px; border-bottom: 1px solid var(--border-dark);
  display: flex; align-items: center; justify-content: space-between;
}
.chat-head .title { font-weight: 600; font-size: 15px; color: var(--fg-1); }
.chat-head .dot {
  width: 8px; height: 8px; border-radius: 999px;
  background: var(--telnyx-green);
  display: inline-block; margin-right: 10px;
}
.chat-scroll { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.msg {
  max-width: 78%;
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  font-size: 15px; line-height: 1.5;
  animation: tx-enter var(--dur-med) var(--ease-out) both;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.msg.agent { align-self: flex-start; background: var(--telnyx-graphite); border: 1px solid var(--border-dark); color: var(--fg-1); }
.msg.user { align-self: flex-end; background: rgba(0,227,170,0.12); border: 1px solid rgba(0,227,170,0.35); color: var(--fg-1); }
.typing { align-self: flex-start; display: none; padding: 12px 16px; }
.typing span {
  display: inline-block; width: 6px; height: 6px; margin-right: 4px;
  border-radius: 999px; background: var(--fg-3);
  animation: blink 1.2s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }

.chip-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 24px 16px; }
.chip {
  border: 1px solid rgba(255,255,255,0.32);
  border-radius: var(--radius-pill);
  background: transparent; color: var(--fg-1);
  padding: 8px 14px;
  font-family: var(--font-body); font-weight: 600; font-size: 12px;
  letter-spacing: 0.06em; text-transform: uppercase;
  cursor: pointer;
  transition: background var(--dur-med) var(--ease-out), border-color var(--dur-med) var(--ease-out);
}
.chip:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.32); }
.chat-input-row {
  display: flex; gap: 12px; padding: 16px 24px 24px;
  border-top: 1px solid var(--border-dark);
}
.chat-input-row input {
  flex: 1;
  background: #0F0F0F;
  border: 1px solid var(--border-dark);
  border-radius: var(--radius-md);
  color: var(--fg-1);
  font-family: var(--font-body); font-size: 15px;
  padding: 12px 16px;
  outline: none;
  transition: border-color var(--dur-med) var(--ease-out);
}
.chat-input-row input:focus { border-color: var(--border-dark-strong); }
.chat-input-row input::placeholder { color: var(--fg-3); }

/* ── Steps aside ───────────────────────────────────────────── */
.steps {
  flex: 1 1 320px;
  display: flex; flex-direction: column; gap: 16px;
}
.step-card {
  background: var(--telnyx-slate);
  border: 1px solid var(--border-dark);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
}
.step-card .num {
  font-family: var(--font-display); font-weight: 800; font-size: 24px;
  letter-spacing: -0.02em; color: var(--telnyx-green); margin: 0 0 6px;
}
.step-card h3 { font-weight: 600; font-size: 15px; color: var(--fg-1); margin: 0 0 6px; }
.step-card p { font-size: 14px; color: var(--fg-2); margin: 0; }

/* ── Footer ────────────────────────────────────────────────── */
footer {
  border-top: 1px solid var(--border-dark);
  padding: 32px 24px 48px;
  max-width: 1280px; margin: 0 auto;
  display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between;
}
footer .note { font-size: 13px; color: var(--fg-3); }
footer .domain { font-family: var(--font-mono); font-size: 13px; color: var(--fg-2); }

@keyframes tx-enter {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (max-width: 640px) {
  .hero { padding-top: 96px; }
  .chat-panel { min-height: 420px; }
  .msg { max-width: 92%; }
}
`;

function chatJs(smsNumber: string): string {
  return `
const sessionId = 'web_' + Date.now();
const chatEl = document.getElementById('chat');
const typingEl = document.getElementById('typing');
const input = document.getElementById('input');
const NUMBER = ${JSON.stringify(smsNumber.replace(/[^\d+]/g, ""))};

function addMessage(text, cls) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  chatEl.insertBefore(div, typingEl);
  chatEl.scrollTop = chatEl.scrollHeight;
}
async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';
  typingEl.style.display = 'block';
  chatEl.scrollTop = chatEl.scrollHeight;
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text })
    });
    const data = await resp.json();
    addMessage(data.message || 'Something went wrong - please try again.', 'agent');
  } catch (err) {
    addMessage('Connection issue - please try again.', 'agent');
  }
  typingEl.style.display = 'none';
  chatEl.scrollTop = chatEl.scrollHeight;
}

// Quick-start chips and the giveaway CTA send preset messages
document.querySelectorAll('.chip, .chip-btn').forEach(function (chip) {
  chip.addEventListener('click', function () {
    input.value = chip.dataset.text || chip.textContent;
    sendMessage();
    document.querySelector('.chat-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});

// Copy-to-clipboard — the universal path on desktop
const copyBtn = document.getElementById('copy-number');
if (copyBtn) {
  copyBtn.addEventListener('click', function () {
    function done() {
      copyBtn.textContent = 'Copied ✓';
      setTimeout(function () { copyBtn.textContent = 'Copy number'; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(NUMBER).then(done).catch(function () { fallbackCopy(); });
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      const ta = document.createElement('textarea');
      ta.value = NUMBER;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  });
}

input.addEventListener('keypress', function (e) { if (e.key === 'Enter') sendMessage(); });
`;
}

export function micrositeHtml(opts: MicrositeOpts): string {
  const ev = escapeHtml(opts.eventName);
  const prize = escapeHtml(opts.prize);
  const num = escapeHtml(opts.smsNumber);
  const telHref = `tel:${opts.smsNumber.replace(/[^\d+]/g, "")}`;
  const smsHref = `sms:${opts.smsNumber.replace(/[^\d+]/g, "")}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Telnyx at ${ev} — enter the giveaway, ask about Telnyx, or book a demo by text, call, or chat. Reply in any language.">
  <title>Telnyx at ${ev}</title>
  <link rel="icon" href="/logo.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${FONT_FACE}${CSS}</style>
</head>
<body>
  <header class="nav">
    <a href="/" aria-label="Telnyx"><img class="logo" src="/logo.svg" alt="Telnyx"></a>
    <span class="event-label">${ev}</span>
  </header>

  <main>
    <section class="hero">
      <p class="eyebrow">Sponsored by Telnyx</p>
      <h1 class="hero-title">${ev}</h1>
      <p class="lede">Enter the giveaway, ask about Telnyx, or book a demo. Text the number below, call the booth line, or chat right here — in any language, and the agent answers in kind.</p>

      <div class="reach">
        <div class="reach-card">
          <p class="card-eyebrow">Text us</p>
          <p class="big-number">${num}</p>
          <p class="card-note">Save this number — it is on your lanyard card. On a phone, the buttons below open your messaging or dialer app. On desktop, use Copy number and text from any device.</p>
          <div class="btn-row">
            <a class="btn btn-primary" href="${smsHref}">Text the booth →</a>
            <a class="btn btn-ghost" href="${telHref}">Call us →</a>
            <button class="btn btn-ghost" id="copy-number">Copy number</button>
          </div>
        </div>
        <div class="reach-card prize-card">
          <p class="card-eyebrow">Giveaway</p>
          <p class="big-number">${prize}</p>
          <p class="card-note">A hardware starter kit for building voice AI agents — dev board, SIM, and API credits to ship your first agent. Enter by texting "giveaway" or with the button below; a sales rep follows up either way.</p>
          <div class="btn-row">
            <button class="btn btn-primary chip-btn" data-text="giveaway" id="enter-now">Enter now →</button>
          </div>
        </div>
      </div>

      <div class="lang-row">
        <span>Reply in your language:</span>
        <span class="lang-chip">EN</span>
        <span class="lang-chip">ES</span>
        <span class="lang-chip">FR</span>
        <span class="lang-chip">DE</span>
        <span class="lang-chip">PT</span>
        <span class="lang-chip">JA</span>
        <span class="lang-chip">ZH</span>
        <span class="lang-chip">IT</span>
      </div>
    </section>

    <section class="chat-section">
      <div class="chat-panel">
        <div class="chat-head">
          <span class="title"><span class="dot"></span>Booth agent — text, ask, book</span>
          <span class="event-label">${ev}</span>
        </div>
        <div class="chat-scroll" id="chat">
          <div class="msg agent">Hi! Welcome to ${ev}. I can enter you in the giveaway, answer product questions, or book you a demo. What's your name?</div>
          <div class="typing" id="typing"><span></span><span></span><span></span></div>
        </div>
        <div class="chip-row">
          <button class="chip" data-text="Enter the giveaway">Enter the giveaway</button>
          <button class="chip" data-text="Book a demo">Book a demo</button>
          <button class="chip" data-text="What can Telnyx do?">What can Telnyx do?</button>
        </div>
        <div class="chat-input-row">
          <input id="input" type="text" placeholder="Type a message..." autocomplete="off">
          <button class="btn btn-primary" id="send">Send →</button>
        </div>
      </div>

      <aside class="steps">
        <div class="step-card">
          <p class="num">01</p>
          <h3>Text or call the number</h3>
          <p>The number above is live for the whole show. Text works in any language — the agent detects and replies in kind.</p>
        </div>
        <div class="step-card">
          <p class="num">02</p>
          <h3>Tell us what you build</h3>
          <p>A short qualification — use case, company size, timeline — routes the right expert to you.</p>
        </div>
        <div class="step-card">
          <p class="num">03</p>
          <h3>Follow-up, your way</h3>
          <p>After the show we follow up on your preferred channel — SMS, email, or a call.</p>
        </div>
      </aside>
    </section>
  </main>

  <footer>
    <span class="note">Powered by Telnyx AI Communications Infrastructure</span>
    <span class="domain">telnyx-at-techhorizon.com</span>
  </footer>

  <script>${chatJs(opts.smsNumber)}</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
