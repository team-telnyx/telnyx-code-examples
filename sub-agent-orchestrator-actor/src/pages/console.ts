/**
 * The engineering console served at GET /console — a single-page UI that walks the
 * DEV-1085 use case: a clinic-network transcription batch, a 3am power event,
 * and a durable parent actor that resumes without redoing finished work.
 *
 * Plain HTML/CSS/JS (no build step, no dependencies). The embedded script
 * avoids backticks so it stays a valid TS template literal.
 */

export const CONSOLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clinic Transcription Console — Sub-Agent Orchestrator</title>
<style>
  :root {
    --bg: #0a0a0a; --panel: #141414; --panel2: #1d1d1d; --line: #2c2c2c;
    --text: #f2f0e9; --dim: #9a9a92; --accent: #00e3aa; --ok: #2ecc71;
    --warn: #f39c12; --bad: #ff5c69; --mono: 'SF Mono', 'Fira Code', monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, 'Segoe UI', sans-serif; }
  header { padding: 20px 28px; border-bottom: 2px solid var(--accent); background: linear-gradient(180deg, #161616, #0a0a0a); }
  header h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: .3px; }
  header p { margin: 0; color: var(--dim); font-size: 13.5px; max-width: 900px; }
  header .story { margin-top: 8px; padding: 10px 14px; border: 1px solid #1f4a3c; border-radius: 10px; background: #10201b; font-size: 13px; color: #b6ead9; }
  header .story b { color: var(--text); }
  main { display: grid; grid-template-columns: 330px 1fr; gap: 18px; padding: 20px 28px; align-items: start; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }
  .panel h2 { margin: 0 0 10px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--dim); }
  label { display: block; font-size: 12.5px; color: var(--dim); margin: 10px 0 4px; }
  input[type=text], textarea { width: 100%; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font-size: 13.5px; font-family: var(--mono); }
  textarea { min-height: 88px; resize: vertical; }
  .faults { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .fault { display: inline-flex; gap: 5px; align-items: center; font-size: 12.5px; background: var(--panel2); border: 1px solid var(--line); padding: 4px 9px; border-radius: 999px; cursor: pointer; }
  .fault.on { border-color: var(--bad); color: var(--bad); }
  button { margin-top: 14px; width: 100%; padding: 10px 12px; border: 0; border-radius: 9px; background: var(--accent); color: #04231a; font-weight: 600; font-size: 14px; cursor: pointer; }
  button.ghost { background: transparent; border: 1px solid var(--line); color: var(--text); font-weight: 500; }
  button:disabled { opacity: .45; cursor: default; }
  .hint { font-size: 12px; color: var(--dim); margin-top: 8px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .pill { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); }
  .pill.STARTED { color: var(--accent); border-color: var(--accent); }
  .pill.RESUMED { color: var(--warn); border-color: var(--warn); }
  .pill.ALREADY_DONE { color: var(--dim); }
  .status { display: inline-block; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .status.RUNNING, .status.SPAWNING { background: #10362a; color: #7af0d0; }
  .status.COMPLETING { background: #3d2f05; color: #ffd479; }
  .status.COMPLETED { background: #0e3b24; color: #7af0b1; }
  .status.PARTIAL_FAILURE { background: #451418; color: #ffaab1; }
  .bar { height: 8px; background: var(--panel2); border-radius: 99px; overflow: hidden; margin: 10px 0 4px; }
  .bar > div { height: 100%; background: linear-gradient(90deg, var(--accent), var(--ok)); width: 0; transition: width .4s; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; margin-top: 12px; }
  .card { background: var(--panel2); border: 1px solid var(--line); border-radius: 10px; padding: 11px 12px; }
  .card .top { display: flex; justify-content: space-between; align-items: center; }
  .card .fid { font-family: var(--mono); font-weight: 700; font-size: 13.5px; }
  .chip { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .chip.RUNNING { background: #10362a; color: #7af0d0; }
  .chip.COMPLETED { background: #0e3b24; color: #7af0b1; }
  .chip.FAILED { background: #451418; color: #ffaab1; }
  .chip.DESTROYED { background: #2a2f45; color: #9aa6c6; }
  .chip.PENDING { background: #2a2f45; color: #9aa6c6; }
  .meta { font-size: 12px; color: var(--dim); margin-top: 6px; font-family: var(--mono); }
  .err { margin-top: 6px; font-size: 12.5px; color: #ffb3ba; background: #2a1216; border: 1px solid #5c1e26; padding: 6px 8px; border-radius: 7px; }
  .recovery { margin-top: 6px; font-size: 12.5px; background: #33250a; border: 1px solid #6b5416; color: #ffd479; padding: 6px 8px; border-radius: 7px; }
  details { margin-top: 7px; }
  summary { cursor: pointer; font-size: 12.5px; color: var(--accent); }
  pre { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; font-family: var(--mono); font-size: 12.5px; color: #d8efe4; background: #101a16; border: 1px solid var(--line); border-radius: 8px; padding: 9px; }
  .sms { white-space: pre-wrap; font-family: var(--mono); font-size: 12.5px; background: #101a16; border: 1px solid var(--line); border-radius: 8px; padding: 10px; color: #d8efe4; }
  .empty { color: var(--dim); font-size: 13px; margin-top: 10px; }
  .keys { font-size: 12px; color: var(--dim); font-family: var(--mono); margin-top: 10px; }
  .badge-msg { font-size: 12.5px; color: var(--dim); margin-top: 6px; min-height: 18px; }
  footer { padding: 14px 28px 26px; color: var(--dim); font-size: 12.5px; }
  footer a { color: var(--accent); }
</style>
</head>
<body>
<header>
  <h1>Clinic Transcription Console <span style="color:var(--dim);font-weight:400;font-size:13px;">— durable sub-agent orchestration on Telnyx Edge</span></h1>
  <p>One persistent parent actor owns the whole nightly batch; each recording gets its own worker actor that runs, persists its outcome to KV, and reports back.</p>
  <div class="story">
    <b>The 3am problem:</b> a power event used to kill the batch mid-run — some transcripts lost, some done twice, nobody could say which was authoritative, so everything was re-run and everything was late.
    <b>Now:</b> every worker persists its per-file record <i>before</i> reporting, so after any outage you re-post the same job — finished files are adopted untouched, only lost workers re-spawn, and you get an honest scorecard. Try it below.
  </div>
</header>
<main>
  <section class="panel">
    <h2>1 · Nightly batch</h2>
    <label for="jobId">Job ID (same ID = same durable actor)</label>
    <input id="jobId" type="text" placeholder="clinic-night-batch-001" spellcheck="false">
    <label for="urls">Recordings (one per line — each gets its own worker)</label>
    <textarea id="urls" spellcheck="false"></textarea>
    <label>Simulate a 3am power event: pick workers to take down</label>
    <div class="faults" id="faults"></div>
    <button id="start">Start batch</button>
    <button class="ghost" id="repost" disabled>&#8635; Re-post same job <span style="opacity:.7">(power returned)</span></button>
    <div class="badge-msg" id="badgeMsg"></div>
    <div class="hint" id="configHint"></div>
  </section>
  <section>
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">2 · Job board</h2>
        <div class="row"><span class="pill" id="actionPill" style="display:none"></span><span class="status" id="statusPill" style="display:none"></span></div>
      </div>
      <div class="bar"><div id="bar"></div></div>
      <div class="hint" id="progress"></div>
      <div class="keys" id="kvKeys"></div>
    </div>
    <div class="cards" id="cards"></div>
    <div class="panel" id="scorecardPanel" style="display:none; margin-top:14px;">
      <h2>3 · Scorecard &amp; operator SMS</h2>
      <div id="outcomes"></div>
      <div class="hint" style="margin:10px 0 4px">The exact text sent to the operator:</div>
      <div class="sms" id="sms">—</div>
    </div>
    <div class="empty" id="empty">No job yet. Pick a job ID, optionally take down some workers with the fault toggles, and start the batch.</div>
  </section>
</main>
<footer>
  KV is the authority — every outcome is persisted before it is reported, and the job record survives the parent actor's own destruction. API: <a href="/api/jobs/" onclick="return false">GET /api/jobs/:jobId</a> ·
  <a href="https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sub-agent-orchestrator-actor/GUIDE.md">Guide</a> ·
  <a href="https://developers.telnyx.com/docs/edge">Telnyx Edge docs</a>
</footer>
<script>
(function () {
  'use strict';
  var jobIdEl = document.getElementById('jobId');
  var urlsEl = document.getElementById('urls');
  var faultsEl = document.getElementById('faults');
  var startBtn = document.getElementById('start');
  var repostBtn = document.getElementById('repost');
  var badgeMsg = document.getElementById('badgeMsg');
  var actionPill = document.getElementById('actionPill');
  var statusPill = document.getElementById('statusPill');
  var barEl = document.getElementById('bar');
  var progressEl = document.getElementById('progress');
  var kvKeysEl = document.getElementById('kvKeys');
  var cardsEl = document.getElementById('cards');
  var emptyEl = document.getElementById('empty');
  var scorecardPanel = document.getElementById('scorecardPanel');
  var outcomesEl = document.getElementById('outcomes');
  var smsEl = document.getElementById('sms');

  var pollTimer = null;
  var lastJob = null;      // last GET response
  var prevChildren = {};   // fileId -> child, from before a re-post (for recovery deltas)
  var lastAction = null;   // STARTED | RESUMED | ALREADY_DONE

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function chipClass(status) { return esc(status); }

  function parseUrls(text) {
    return text.split(/[\\n,]/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function loadConfig() {
    fetch('/config').then(function (r) { return r.json(); }).then(function (cfg) {
      if (!urlsEl.value.trim() && cfg.audioUrls && cfg.audioUrls.length) {
        urlsEl.value = cfg.audioUrls.join('\\n');
      }
      var knobs = [];
      if (cfg.demoMode) knobs.push('demo mode: mock transcripts, SMS logged');
      else knobs.push('LIVE mode: real transcription via /v2/ai/audio/transcriptions');
      knobs.push('watchdog: ' + cfg.stuckTimeoutSeconds + 's');
      knobs.push('max attempts: ' + cfg.maxAttempts);
      document.getElementById('configHint').textContent = knobs.join(' · ');
      renderFaults(cfg.audioUrls || []);
    }).catch(function () {
      document.getElementById('configHint').textContent = 'config unavailable';
      renderFaults(['file-1', 'file-2', 'file-3', 'file-4', 'file-5']);
    });
  }

  function renderFaults(urls) {
    faultsEl.innerHTML = '';
    var n = Math.max(urls.length, 5);
    for (var i = 1; i <= n; i++) {
      var fid = 'file-' + i;
      var lab = document.createElement('label');
      lab.className = 'fault';
      lab.setAttribute('data-file', fid);
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () { this.parentNode.classList.toggle('on', this.checked); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + fid));
      faultsEl.appendChild(lab);
    }
  }

  function selectedFaults() {
    var out = [];
    faultsEl.querySelectorAll('.fault.on').forEach(function (el) { out.push(el.getAttribute('data-file')); });
    return out;
  }

  function setAction(action, msg) {
    lastAction = action;
    actionPill.style.display = '';
    actionPill.textContent = action;
    badgeMsg.textContent = msg || '';
    repostBtn.disabled = !jobIdEl.value.trim();
  }

  function startJob() {
    var jobId = jobIdEl.value.trim();
    if (!jobId) { badgeMsg.textContent = 'Pick a job ID first.'; return; }
    var body = { jobId: jobId, audioUrls: parseUrls(urlsEl.value), stuckTimeoutSeconds: 6, demoMode: true };
    var faults = selectedFaults();
    if (faults.length) body.hangFiles = faults;
    startBtn.disabled = true;
    fetch('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        startBtn.disabled = false;
        if (!res.ok) { setAction('ERROR', res.j.error || 'request failed'); return; }
        if (lastJob && res.j.status === 'RESUMED') prevChildren = mapChildren(lastJob);
        else if (res.j.status === 'STARTED') prevChildren = {};
        setAction(res.j.status, {
          STARTED: 'Batch launched — workers spawning.',
          RESUMED: 'Recovered — finished files adopted, lost workers re-spawned.',
          ALREADY_DONE: 'Job already finished; KV record returned untouched.'
        }[res.j.status] || '');
        startPolling();
      })
      .catch(function (e) { startBtn.disabled = false; setAction('ERROR', String(e)); });
  }

  function mapChildren(job) {
    var m = {};
    (job.children || []).forEach(function (c) { m[c.fileId] = c; });
    return m;
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 1500);
    poll();
  }

  function poll() {
    var jobId = jobIdEl.value.trim();
    if (!jobId) return;
    fetch('/api/jobs/' + encodeURIComponent(jobId)).then(function (r) {
      if (r.status === 404) return null;
      return r.json();
    }).then(function (job) {
      if (!job) { renderWaiting(); return; }
      lastJob = job;
      render(job);
      if (job.status === 'COMPLETED' || job.status === 'PARTIAL_FAILURE') {
        clearInterval(pollTimer); pollTimer = null;
      }
    }).catch(function () { renderWaiting(); });
  }

  function renderWaiting() {
    progressEl.textContent = 'waiting for the first snapshot…';
  }

  function render(job) {
    emptyEl.style.display = 'none';
    statusPill.style.display = '';
    statusPill.textContent = job.status;
    statusPill.className = 'status ' + chipClass(job.status);
    var total = job.totalFiles || 0;
    var done = (job.completed || 0) + (job.failed || 0);
    barEl.style.width = total ? Math.round(100 * done / total) + '%' : '0';
    progressEl.textContent = total
      ? (done + '/' + total + ' files resolved · started ' + (job.createdAt || '').slice(0, 19).replace('T', ' ') + (job.completedAt ? ' · finished ' + job.completedAt.slice(0, 19).replace('T', ' ') : ''))
      : '';
    kvKeysEl.textContent = 'KV: job/' + jobIdEl.value.trim() + ' · job/' + jobIdEl.value.trim() + '/file/<id> · job/' + jobIdEl.value.trim() + '/attempt/<id>';

    var prev = prevChildren;
    cardsEl.innerHTML = (job.children || []).map(function (c) {
      var before = prev[c.fileId];
      var notes = [];
      if (c.attempts > 1) notes.push('re-spawned attempt #' + c.attempts + (c.name.indexOf('-r' + c.attempts) > -1 ? ' (' + esc(c.name.split('-').slice(-2).join('-')) + ')' : ''));
      if (before && before.status === 'COMPLETED' && c.status === 'COMPLETED' && lastAction === 'RESUMED') notes.push('adopted — not redone');
      var html = '<div class="card"><div class="top"><span class="fid">' + esc(c.fileId) + '</span>' +
        '<span class="chip ' + chipClass(c.status) + '">' + esc(c.status) + '</span></div>' +
        '<div class="meta">worker: ' + esc(c.name) + ' · attempts: ' + esc(c.attempts) + '</div>';
      if (notes.length) html += '<div class="recovery">' + esc(notes.join(' · ')) + '</div>';
      if (c.error) html += '<div class="err">' + esc(c.error) + '</div>';
      return html + '</div>';
    }).join('');

    var results = job.results || [];
    var transcripts = results.map(function (r) {
      return '<div class="card"><div class="top"><span class="fid">' + esc(r.fileId) + ' transcript</span>' +
        '<span class="chip COMPLETED">' + esc(r.attempts) + (r.attempts === 1 ? ' attempt' : ' attempts') + '</span></div>' +
        '<details><summary>show transcript</summary><pre>' + esc(r.transcript) + '</pre></details></div>';
    }).join('');
    cardsEl.innerHTML += transcripts;

    var finished = job.status === 'COMPLETED' || job.status === 'PARTIAL_FAILURE';
    scorecardPanel.style.display = finished ? '' : 'none';
    if (finished) {
      outcomesEl.innerHTML = (job.outcomes || []).map(function (o) {
        var line = o.status === 'COMPLETED'
          ? '<b>' + esc(o.fileId) + '</b> — completed in ' + esc(o.attempts) + ' attempt' + (o.attempts === 1 ? '' : 's') + ' (' + esc(o.childName) + ')'
          : '<b style="color:var(--bad)">' + esc(o.fileId) + '</b> — FAILED after ' + esc(o.attempts) + ' attempt' + (o.attempts === 1 ? '' : 's') + ': ' + esc(o.error);
        return '<div style="font-size:13px;margin:6px 0">' + line + '</div>';
      }).join('');
      smsEl.textContent = job.notification || '—';
    }
  }

  startBtn.addEventListener('click', startJob);
  repostBtn.addEventListener('click', startJob);
  jobIdEl.addEventListener('input', function () { repostBtn.disabled = !jobIdEl.value.trim(); });
  loadConfig();
})();
</script>
</body>
</html>`;
