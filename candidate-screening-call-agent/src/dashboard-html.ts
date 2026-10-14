export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Candidate Screening Call Agent</title>
  <style>
    :root {
      color-scheme: dark;
      --black: #000000;
      --surface: #1B1B20;
      --surface-2: #222227;
      --line: rgba(254, 253, 245, 0.14);
      --cream: #FEFDF5;
      --muted: #909093;
      --accent: #00E3AA;
      --good: #00E3AA;
      --bad: #FF9B8C;
    }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color:var(--cream); background:var(--black); }
    header { display:flex; align-items:center; justify-content:space-between; padding:18px 28px; background:var(--black); color:var(--cream); border-bottom:1px solid var(--line); }
    .brand { display:flex; align-items:baseline; gap:12px; }
    .brand .logo { height:24px; width:auto; display:block; align-self:center; }
    .brand .divider { width:1px; height:22px; background:rgba(254,253,245,0.25); align-self:center; }
    .brand h1 { margin:0; font-size:15px; font-weight:520; letter-spacing:-0.01em; opacity:0.92; }
    .tagline { font-size:12.5px; color:var(--muted); }
    h2 { margin:0 0 12px; font-size:12px; text-transform:uppercase; color:var(--muted); letter-spacing:.08em; font-weight:640; }
    main { display:grid; grid-template-columns: 340px 1fr 400px; gap:16px; padding:16px 20px 28px; align-items:start; }
    section { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:18px; min-width:0; }
    .status { display:flex; gap:8px; align-items:center; font-size:13.5px; color:var(--cream); }
    .dot { width:9px; height:9px; border-radius:50%; background:var(--muted); }
    .dot.good { background:var(--accent); box-shadow:0 0 0 3px rgba(0,227,170,0.18); }
    button { appearance:none; border:1px solid var(--line); background:transparent; border-radius:999px; padding:9px 16px; font-weight:620; font-size:13.5px; cursor:pointer; color:var(--cream); transition: transform 0.12s ease, opacity 0.12s ease; }
    button:hover:not(:disabled) { transform: translateY(-1px); }
    button:active:not(:disabled) { transform: translateY(0); opacity:0.85; }
    button.primary { background:var(--cream); color:var(--black); border-color:var(--cream); width:100%; padding:13px 18px; font-size:14.5px; }
    button.primary:hover:not(:disabled) { opacity:0.9; }
    button:disabled { opacity:.4; cursor:not-allowed; }
    .callbox { display:grid; gap:10px; margin:0 0 14px; padding:16px; border:1px solid var(--line); border-radius:14px; background:var(--surface-2); }
    .callstatus { min-height:22px; color:var(--muted); font-size:13.5px; line-height:1.45; }
    .callstatus.error { color:var(--bad); font-weight:620; }
    .callstatus.ok { color:var(--good); font-weight:620; }
    .row { display:flex; justify-content:space-between; gap:14px; padding:9px 0; border-bottom:1px solid var(--line); font-size:13.5px; }
    .row:last-child { border-bottom:0; }
    .label { color:var(--muted); }
    .value { text-align:right; font-weight:620; overflow-wrap:anywhere; }
    .toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
    .timeline { display:grid; gap:10px; }
    .bubble { border-radius:10px; padding:10px 12px; font-size:13.5px; line-height:1.45; }
    .bubble.assistant { background:var(--surface-2); color:var(--cream); }
    .bubble.candidate { background:rgba(0,227,170,0.16); color:var(--cream); }
    .bubble .who { display:block; font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; opacity:0.65; margin-bottom:3px; }
    .questions { display:grid; gap:10px; }
    .question { border:1px solid var(--line); border-radius:12px; padding:12px 14px; background:var(--black); }
    .question.done { border-color:rgba(0,227,170,0.45); background:rgba(0,227,170,0.07); }
    .question p { margin:0 0 10px; font-size:14px; line-height:1.4; }
    .score { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
    .metric { border:1px solid var(--line); border-radius:12px; padding:12px; background:var(--surface-2); }
    .metric b { display:block; font-size:24px; letter-spacing:-0.02em; }
    .muted { color:var(--muted); font-size:13px; }
    @media (max-width: 1100px) { main { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <img class="logo" src="/telnyx-logo.svg" alt="Telnyx">
      <div class="divider"></div>
      <div>
        <h1>Candidate Screening Call Agent</h1>
        <div class="tagline">AI Communications Infrastructure: ai assistants + durable screening workflow</div>
      </div>
    </div>
    <div class="status"><span id="apiDot" class="dot"></span><span id="apiStatus">checking telnyx</span></div>
  </header>
  <main>
    <section>
      <h2>Live Telnyx Setup</h2>
      <div id="telnyxRows"></div>
      <div class="toolbar" style="margin-top:14px">
        <button onclick="refreshTelnyx()">Refresh Telnyx</button>
        <button onclick="resetDemo()">Reset Demo</button>
      </div>
    </section>
    <section>
      <h2>Screening Flow</h2>
      <div class="callbox">
        <button class="primary" id="callButton" onclick="placeCall()">Call Me Now</button>
        <div class="callstatus" id="callStatus">press the button and telnyx will call you from the screening number</div>
      </div>
      <div class="toolbar">
        <button class="primary" onclick="autofill()">Run Full Demo</button>
        <button onclick="answerNext()">Score Next Answer</button>
      </div>
      <div class="score" id="score"></div>
      <div class="questions" id="questions"></div>
    </section>
    <section>
      <h2>Live Call Transcript</h2>
      <div class="timeline" id="transcriptMessages"></div>
    </section>
  </main>
  <script>
    let state;
    async function api(path, options) {
      const res = await fetch(path, options);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    function row(label, value) {
      return '<div class="row"><span class="label">' + label + '</span><span class="value">' + (value ?? '-') + '</span></div>';
    }
    function shortId(value) {
      if (!value) return 'created on first call';
      const text = String(value);
      return text.length > 12 ? '...' + text.slice(-8) : text;
    }
    async function refreshTelnyx() {
      const data = await api('/api/telnyx');
      document.getElementById('apiDot').className = 'dot ' + (data.connected ? 'good' : '');
      document.getElementById('apiStatus').textContent = data.connected ? 'telnyx api connected' : 'telnyx api missing';
      const app = data.texmlApplication || {};
      document.getElementById('telnyxRows').innerHTML =
        row('caller id', data.callerId) +
        row('assistant id', shortId(data.assistantId)) +
        row('assistant voice', data.assistantVoice || 'resolved on first call') +
        row('number created', data.selectedNumber?.created_at) +
        row('number updated', data.selectedNumber?.updated_at) +
        row('number status', data.selectedNumber?.status) +
        row('voice connection id', data.selectedNumber?.connection_id) +
        row('texml app id', shortId(app.id || app.error)) +
        row('texml voice url', app.voice_url) +
        row('numbers in account', data.numberCount);
    }
    async function refreshState() {
      state = await api('/api/state');
      renderState();
    }
    function renderState() {
      const view = state.view;
      const summary = view.summary || {};
      document.getElementById('score').innerHTML =
        '<div class="metric"><span class="muted">status</span><b>' + esc(view.status) + '</b></div>' +
        '<div class="metric"><span class="muted">average</span><b>' + (summary.averageScore ?? 0) + '</b></div>' +
        '<div class="metric"><span class="muted">next step</span><b style="font-size:16px">' + esc(summary.recommendedNextStep ?? 'pending') + '</b></div>';
      document.getElementById('questions').innerHTML = state.profile.rubric.map((q) => {
        const answer = view.answers.find((a) => a.qIdx === q.qIdx);
        const score = view.scores.find((s) => s.qIdx === q.qIdx);
        return '<div class="question ' + (answer ? 'done' : '') + '"><p><b>Q' + (q.qIdx + 1) + '.</b> ' + esc(q.prompt) + '</p>' +
          (answer ? '<div class="muted">' + esc(answer.answer) + '</div><div><b>' + esc(score.choice) + '</b> score ' + score.score + ' - ' + esc(score.reason) + '</div>' : '<button onclick="answerQuestion(' + q.qIdx + ')">Score sample answer</button>') +
          '</div>';
      }).join('');
    }
    async function pollLive() {
      if (!state || (state.view.status !== 'screening' && state.view.status !== 'calling')) return;
      const live = await api('/api/live');
      if (live.conversationId) {
        document.getElementById('transcriptMessages').innerHTML = live.transcript.map((m) => {
          const cls = m.role === 'user' ? 'candidate' : 'assistant';
          const who = m.role === 'user' ? 'candidate' : 'assistant';
          return '<div class="bubble ' + cls + '"><span class="who">' + who + '</span>' + esc(m.text || '') + '</div>';
        }).join('') || '<div class="muted">waiting for the first spoken words...</div>';
      }
      state = live.state;
      renderState();
    }
    setInterval(() => { pollLive().catch(() => { /* polling errors are transient; next tick retries */ }); }, 4000);
    function esc(value) {
      const map = { '&': '&#38;', '<': '&#60;', '>': '&#62;', '"': '&#34;', "'": '&#39;' };
      return String(value ?? '').replace(/[&<>"']/g, (ch) => map[ch] || ch);
    }
    async function answerQuestion(qIdx) {
      await api('/api/answer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ qIdx }) });
      await refreshState();
    }
    async function answerNext() {
      const next = state.profile.rubric.find((q) => !state.view.answers.some((a) => a.qIdx === q.qIdx));
      if (next) await answerQuestion(next.qIdx);
    }
    async function autofill() { await api('/api/autofill', { method:'POST' }); await refreshState(); }
    async function resetDemo() { await api('/api/reset', { method:'POST' }); await refreshState(); }
    async function placeCall() {
      const button = document.getElementById('callButton');
      const status = document.getElementById('callStatus');
      button.disabled = true;
      status.className = 'callstatus';
      status.textContent = 'creating assistant and placing the ai screening call';
      try {
        const result = await api('/api/call', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify({})
        });
        status.className = 'callstatus ok';
        status.textContent = 'call placed \u2014 pick up when your phone rings';
        await refreshTelnyx();
        await refreshState();
      } catch (error) {
        status.className = 'callstatus error';
        status.textContent = readableError(error);
      } finally {
        button.disabled = false;
      }
    }
    function readableError(error) {
      const raw = error.message || String(error);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.error === 'string') return parsed.error;
      } catch (parseError) {
        // raw text was not json, fall through to the raw message
      }
      return raw;
    }
    refreshTelnyx().catch(console.error);
    refreshState().catch(console.error);
  </script>
</body>
</html>`;
}
