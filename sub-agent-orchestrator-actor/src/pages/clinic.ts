/**
 * The clinic-facing front door (GET /) — the product experience for the
 * DEV-1085 use case: a clinic network's nightly transcription batch, the 3am
 * power event, automatic recovery without redoing finished work, and the
 * morning report with the operator SMS.
 *
 * Telnyx-branded, light theme, server-rendered shell + a small client script
 * that talks to the same API the console uses. No build step, no dependencies.
 * The embedded script avoids backticks so it stays a valid template literal.
 */

export const CLINIC_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nightly Transcription — Clinic Network</title>
<style>
  :root {
    --teal: #00e3aa; --teal-dark: #00b389; --ink: #0a0a0a; --muted: #575757;
    --bg: #fefdf5; --card: #ffffff; --line: #e6e3d3; --ok: #0c8a4e; --bad: #c22736;
    --amber: #b06e10; --chipbg: #ccf9ee;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 -apple-system, 'Segoe UI', sans-serif; }
  header { background: linear-gradient(135deg, #0a0a0a 55%, #00b389); color: #fff; padding: 2.2rem 1.2rem 1.6rem; border-bottom: 3px solid var(--teal); }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 0 1rem; }
  header h1 { margin: 0 0 .35rem; font-size: 1.55rem; }
  header p { margin: 0; opacity: .92; max-width: 760px; }
  .section { background: var(--card); margin: 1.1rem 0; padding: 1.4rem 1.5rem; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.07); }
  h2 { color: var(--ink); margin: 0 0 .7rem; font-size: 1.08rem; border-bottom: 2px solid var(--chipbg); padding-bottom: .45rem; }
  .consults { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .8rem; }
  .consult { border: 1px solid var(--line); border-radius: 10px; padding: .8rem .9rem; }
  .consult .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .consult .name { font-weight: 700; font-size: .95rem; }
  .consult .meta { color: var(--muted); font-size: .8rem; margin-top: 2px; }
  .chip { font-size: .72rem; font-weight: 700; padding: .12rem .55rem; border-radius: 999px; white-space: nowrap; }
  .chip.Queued { background: #eceff4; color: #5f6b7f; }
  .chip.Transcribing { background: var(--chipbg); color: #046a52; }
  .chip.Done { background: #e2f6ec; color: var(--ok); }
  .chip.Failed { background: #fde8ea; color: var(--bad); }
  .chip.recovered { background: #fff3e0; color: var(--amber); }
  .faultToggle { display: flex; align-items: center; gap: 6px; margin-top: .5rem; font-size: .78rem; color: var(--muted); cursor: pointer; user-select: none; }
  .faultToggle.on { color: var(--bad); font-weight: 600; }
  .btn { display: inline-block; background: var(--teal); color: #04231a; text-decoration: none; border: 0; padding: .7rem 1.4rem; border-radius: 8px; font-weight: 700; font-size: .95rem; cursor: pointer; margin: .6rem .5rem 0 0; }
  .btn.ghost { background: #fff; color: var(--teal-dark); border: 1.5px solid var(--teal); }
  .btn:disabled { opacity: .45; cursor: default; }
  .bar { height: 10px; background: #f0eee5; border-radius: 99px; overflow: hidden; margin: .7rem 0 .3rem; }
  .bar > div { height: 100%; width: 0; background: linear-gradient(90deg, var(--teal), var(--ok)); transition: width .5s; }
  .statusline { color: var(--muted); font-size: .85rem; }
  .incident { background: #fff8ec; border: 1px solid #f0dcba; color: #7a4c08; border-radius: 9px; padding: .55rem .8rem; font-size: .85rem; margin: .45rem 0; }
  .incident b { color: #5c3a06; }
  .err { background: #fde8ea; border: 1px solid #f2bfc5; color: var(--bad); border-radius: 8px; padding: .45rem .7rem; font-size: .82rem; margin-top: .4rem; }
  details { margin-top: .45rem; }
  summary { cursor: pointer; color: var(--teal-dark); font-size: .84rem; }
  pre { margin: .4rem 0 0; white-space: pre-wrap; word-break: break-word; background: #f7f6ee; border: 1px solid var(--line); border-radius: 8px; padding: .7rem; font: .82rem/1.5 'SF Mono', 'Fira Code', monospace; color: #2c3230; }
  .sms { white-space: pre-wrap; background: #f7f6ee; border: 1px solid var(--line); border-radius: 10px; padding: .8rem; font: .85rem 'SF Mono', monospace; color: #2c3230; }
  .storybox { background: #ccf9ee; border: 1px solid #99f4dd; border-radius: 10px; padding: .8rem 1rem; font-size: .88rem; color: #04483a; margin-top: .8rem; }
  .muted { color: var(--muted); }
  .row { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
  input[type=text] { padding: .55rem .7rem; border: 1px solid var(--line); border-radius: 7px; font-size: .92rem; min-width: 260px; background: #fff; }
  footer { padding: 1rem 1.2rem 2.2rem; color: var(--muted); font-size: .84rem; }
  footer a { color: var(--teal-dark); }
  .pill { display: inline-block; font-size: .75rem; font-weight: 700; padding: .14rem .6rem; border-radius: 999px; background: var(--chipbg); color: #046a52; }
  .empty { color: var(--muted); font-size: .9rem; }
  /* ── animation stage ── */
  .anim-stage { position: relative; background: #f7f6ee; border: 1px solid var(--line); border-radius: 12px; padding: 18px 14px 14px; min-height: 360px; overflow: hidden; }
  .anim-grid { display: grid; grid-template-columns: 150px 200px 1fr; gap: 14px; align-items: start; }
  @media (max-width: 720px) { .anim-grid { grid-template-columns: 1fr; } }
  .anim-label { font-size: .68rem; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin-bottom: 6px; }
  .anim-queue { display: flex; flex-direction: column; gap: 8px; }
  .q-dot { font-size: .72rem; background: #fff; border: 1px solid var(--line); border-radius: 999px; padding: .25rem .55rem; color: var(--muted); transition: all .4s; }
  .q-dot.hot { border-color: var(--teal); color: var(--ink); background: var(--chipbg); }
  .q-dot.dead { opacity: .35; text-decoration: line-through; }
  .anim-parent { position: relative; background: #0a0a0a; color: #fff; border: 2px solid var(--teal); border-radius: 12px; padding: .8rem .9rem; text-align: center; transition: box-shadow .4s, transform .4s; }
  .anim-parent .pt { font-weight: 700; font-size: .85rem; }
  .anim-parent .ps { font-size: .68rem; opacity: .75; margin-top: 2px; }
  .anim-parent.hot { box-shadow: 0 0 0 4px rgba(0,227,170,.25); }
  .anim-watchdog { display: inline-block; margin-top: .5rem; font-size: .66rem; font-weight: 700; background: #fff3e0; color: var(--amber); border: 1px solid #f0dcba; border-radius: 999px; padding: .12rem .5rem; opacity: .35; transition: opacity .3s; }
  .anim-watchdog.on { opacity: 1; animation: wdPulse 1s infinite; }
  @keyframes wdPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
  .anim-workers { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; min-height: 190px; }
  .w { background: #fff; border: 1.5px solid var(--line); border-radius: 10px; padding: .5rem .6rem; font-size: .74rem; opacity: 0; transform: translateY(6px); transition: all .45s; }
  .w.show { opacity: 1; transform: none; }
  .w .wn { font-weight: 700; color: var(--ink); }
  .w .wt { display: block; color: var(--muted); font-size: .66rem; margin-top: 2px; }
  .w.working { border-color: var(--teal); }
  .w.working .wt::after { content: '●'; color: var(--teal); margin-left: 4px; animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: .25; } }
  .w.done { border-color: var(--ok); background: #e2f6ec; }
  .w.down { border-color: var(--bad); background: #fde8ea; animation: flicker .9s 2; }
  @keyframes flicker { 0%,100% { opacity: 1; } 40% { opacity: .25; } 60% { opacity: .8; } }
  .w.locked { opacity: .75; }
  .w.locked .wt::before { content: 'never redone · '; color: var(--amber); font-weight: 600; }
  .anim-kv { position: relative; margin-top: 14px; background: #101a16; border: 1.5px solid #1f4a3c; border-radius: 12px; padding: .7rem .9rem; }
  .anim-kv .kt { font-size: .72rem; font-weight: 700; color: var(--accent); letter-spacing: .4px; }
  .anim-kv .ks { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; margin-top: 8px; }
  .kv-slot { font: .64rem var(--mono); color: #7f8f88; background: #0a0a0a; border: 1px solid #22332c; border-radius: 7px; padding: .28rem .45rem; transition: all .4s; }
  .kv-slot.lit { color: #d8efe4; border-color: var(--accent); box-shadow: 0 0 8px rgba(0,227,170,.35); }
  .anim-sms { position: absolute; right: 12px; top: 12px; background: #0a0a0a; color: #d8efe4; border: 1.5px solid var(--accent); border-radius: 12px; padding: .5rem .7rem; font-size: .7rem; max-width: 250px; opacity: 0; transform: translate(24px, -10px); transition: all .6s; z-index: 5; }
  .anim-sms.show { opacity: 1; transform: none; }
  .anim-caption { margin-top: 10px; font-size: .84rem; color: var(--ink); font-weight: 600; min-height: 1.3em; }
  .packet { position: absolute; width: 9px; height: 9px; border-radius: 50%; background: var(--teal); z-index: 9; pointer-events: none; transition: all .55s cubic-bezier(.4,0,.2,1); opacity: .95; }
  .packet.report { background: var(--amber); }
  .packet.out { background: #0a0a0a; }
  .anim-controls { display: flex; gap: .6rem; align-items: center; margin-top: .8rem; flex-wrap: wrap; }
  .anim-controls .btn { margin: 0; padding: .45rem .9rem; font-size: .82rem; }
  .anim-authoritative { margin-top: 10px; text-align: center; font-size: .82rem; font-weight: 700; color: #046a52; opacity: 0; transition: opacity .6s; }
  .anim-authoritative.show { opacity: 1; }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>Nightly Transcription — Clinic Network</h1>
    <p>Every consultation recording from today's clinics is transcribed overnight by one recording per worker. In the morning, clinicians review the transcripts and billing posts — which is exactly why a lost or duplicated transcript matters.</p>
    <div class="storybox" style="margin-top:.9rem">
      <b>Tonight:</b> the batch runs unattended. If a power event takes workers down at 3am, the service notices which recordings never came back, re-runs only those, and never redoes finished work — so billing and clinician review see exactly one authoritative transcript per recording.
    </div>
  </div>
</header>
<div class="wrap">

  <div class="section">
    <h2>Tonight's batch</h2>
    <div class="row">
      <div>
        <label class="muted" for="batchId" style="font-size:.8rem">Batch ID</label><br>
        <input type="text" id="batchId">
      </div>
      <button class="btn" id="startBtn" style="margin-top:1.4rem">Start nightly batch</button>
      <button class="btn ghost" id="recheckBtn" style="margin-top:1.4rem" disabled>Power returned — check batch</button>
    </div>
    <div class="consults" id="consultList" style="margin-top:.9rem"></div>
    <div class="muted" id="faultNote" style="font-size:.82rem; margin-top:.5rem"></div>
  </div>

  <div class="section" id="boardSection" style="display:none">
    <h2>Batch progress <span class="pill" id="batchStatus" style="display:none"></span></h2>
    <div class="bar"><div id="progressBar"></div></div>
    <div class="statusline" id="progressLine"></div>
    <div id="incidentLog"></div>
    <div class="consults" id="boardCards" style="margin-top:.8rem"></div>
    <div class="empty" id="boardEmpty">Waiting for the first update…</div>
  </div>

  <div class="section" id="reportSection" style="display:none">
    <h2>Morning report</h2>
    <div id="reportBody"></div>
    <div class="muted" style="margin:.7rem 0 .3rem; font-size:.84rem">Sent to the transcription-service manager:</div>
    <div class="sms" id="smsText">—</div>
    <div class="muted" style="margin-top:.7rem; font-size:.82rem" id="recordNote"></div>
  </div>

  <div class="section" id="animSection">
    <h2>How it survives the night</h2>
    <div class="muted" style="font-size:.85rem; margin-bottom:.8rem">The technology behind this service, played out: one durable parent actor, one worker per recording, KV-first writes, and recovery that never redoes finished work.</div>
    <div class="anim-stage" id="animStage">
      <div class="anim-grid">
        <div>
          <div class="anim-label">Tonight's recordings</div>
          <div class="anim-queue" id="animQueue"></div>
        </div>
        <div>
          <div class="anim-label">Durable workflow</div>
          <div class="anim-parent" id="animParent">
            <div class="pt">Orchestrator actor</div>
            <div class="ps">owns the batch · keeps state</div>
            <div class="anim-watchdog" id="animWatchdog">&#9201; watchdog</div>
          </div>
        </div>
        <div>
          <div class="anim-label">Worker actors — one per recording</div>
          <div class="anim-workers" id="animWorkers"></div>
        </div>
      </div>
      <div class="anim-kv" id="animKv">
        <div class="kt">KV — the authority (per-file records, written before reporting)</div>
        <div class="ks" id="animKvSlots"></div>
      </div>
      <div class="anim-sms" id="animSms"></div>
      <div class="anim-caption" id="animCaption"></div>
      <div class="anim-authoritative" id="animAuthoritative">&#9989; The authoritative record survives — every recording has exactly one transcript on file, nothing redone, nothing lost.</div>
    </div>
    <div class="anim-controls">
      <button class="btn ghost" id="animAutoBtn">&#9654; Auto-play</button>
      <button class="btn" id="animLiveBtn">&#9889; Run it live — real batch, real recovery</button>
      <span class="muted" style="font-size:.8rem" id="animHint"></span>
    </div>
  </div>

</div>
<footer>
  This service is a durable actor workflow: one parent actor owns the batch, each recording gets its own worker actor, and every outcome is persisted before it is reported — that is what makes recovery exact.
  <a href="/console">See the orchestration internals</a> ·
  <a href="https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sub-agent-orchestrator-actor/GUIDE.md">How it works</a>
</footer>
<script>
(function () {
  'use strict';
  var consultList = document.getElementById('consultList');
  var batchIdEl = document.getElementById('batchId');
  var startBtn = document.getElementById('startBtn');
  var recheckBtn = document.getElementById('recheckBtn');
  var faultNote = document.getElementById('faultNote');
  var boardSection = document.getElementById('boardSection');
  var boardEmpty = document.getElementById('boardEmpty');
  var boardCards = document.getElementById('boardCards');
  var batchStatus = document.getElementById('batchStatus');
  var progressBar = document.getElementById('progressBar');
  var progressLine = document.getElementById('progressLine');
  var incidentLog = document.getElementById('incidentLog');
  var reportSection = document.getElementById('reportSection');
  var reportBody = document.getElementById('reportBody');
  var smsText = document.getElementById('smsText');
  var recordNote = document.getElementById('recordNote');

  var audioUrls = [];
  var pollTimer = null;
  var lastJob = null;
  var prevAttempts = {};   // fileId -> attempts before the last action (recovery deltas)

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function todayBatchId() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'clinic-nightly-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  var ROOMS = ['Room 2', 'Room 5', 'Suite 1', 'Telehealth', 'Room 3'];
  var LENGTHS = ['12 min', '8 min', '19 min', '6 min', '11 min'];

  function consultTitle(i) {
    return 'Consult recording ' + (i + 1);
  }

  function renderConsults() {
    consultList.innerHTML = '';
    var n = Math.max(audioUrls.length, 5);
    for (var i = 0; i < n; i++) {
      var fid = 'file-' + (i + 1);
      var card = document.createElement('div');
      card.className = 'consult';
      card.setAttribute('data-file', fid);
      var meta = (LENGTHS[i] || '10 min') + ' · ' + (ROOMS[i] || 'Room 1');
      card.innerHTML = '<div class="top"><span class="name">' + esc(consultTitle(i)) + '</span>' +
        '<span class="chip Queued" data-chip>Queued</span></div>' +
        '<div class="meta">' + esc(meta) + '</div>';
      var toggle = document.createElement('label');
      toggle.className = 'faultToggle';
      toggle.setAttribute('data-file', fid);
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', function () { this.parentNode.classList.toggle('on', this.checked); updateFaultNote(); });
      toggle.appendChild(cb);
      toggle.appendChild(document.createTextNode(' on tonight\\'s fault circuit'));
      card.appendChild(toggle);
      consultList.appendChild(card);
    }
    updateFaultNote();
  }

  function updateFaultNote() {
    var sel = selectedFaults();
    faultNote.textContent = sel.length
      ? sel.length + ' recording' + (sel.length === 1 ? '' : 's') + ' on the fault circuit: if the power event hits, their workers go down mid-run. The service will re-run exactly those — finished work is never redone.'
      : 'Tip: mark one or two recordings as "on tonight\\'s fault circuit" to simulate the 3am power event.';
  }

  function selectedFaults() {
    var out = [];
    consultList.querySelectorAll('.faultToggle.on').forEach(function (el) { out.push(el.getAttribute('data-file')); });
    return out;
  }

  function setButtons(running) {
    startBtn.disabled = running;
    recheckBtn.disabled = !batchIdEl.value.trim();
  }

  function postJob(faults) {
    var jobId = batchIdEl.value.trim();
    if (!jobId) return;
    var body = { jobId: jobId, audioUrls: audioUrls, stuckTimeoutSeconds: 6, demoMode: true };
    if (faults && faults.length) body.hangOnce = faults;
    setButtons(true);
    if (lastJob) prevAttempts = mapAttempts(lastJob);
    startPolling();
    fetch('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        setButtons(false);
        if (!res.ok) { faultNote.textContent = 'Error: ' + (res.j.error || 'request failed'); return; }
      })
      .catch(function (e) { setButtons(false); faultNote.textContent = 'Error: ' + String(e); });
  }

  function mapAttempts(job) {
    var m = {};
    (job.children || []).forEach(function (c) { m[c.fileId] = c.attempts; });
    return m;
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(poll, 1500);
    poll();
  }

  function poll() {
    var jobId = batchIdEl.value.trim();
    if (!jobId) return;
    fetch('/api/jobs/' + encodeURIComponent(jobId)).then(function (r) {
      if (r.status === 404) return null;
      return r.json();
    }).then(function (job) {
      if (!job) return;
      lastJob = job;
      render(job);
      if (job.status === 'COMPLETED' || job.status === 'PARTIAL_FAILURE') {
        clearInterval(pollTimer); pollTimer = null;
        setButtons(false);
      }
    }).catch(function () {});
  }

  function statusLabel(status) {
    return { RUNNING: 'Transcribing', COMPLETED: 'Done', FAILED: 'Failed', SPAWNING: 'Queued', PENDING: 'Queued', COMPLETING: 'Wrapping up', PARTIAL_FAILURE: 'Done (with failures)', CLEANING_UP: 'Wrapping up' }[status] || status;
  }

  function render(job) {
    boardSection.style.display = '';
    boardEmpty.style.display = 'none';
    batchStatus.style.display = '';
    batchStatus.textContent = job.status === 'PARTIAL_FAILURE' ? 'Done (with failures)' : job.status === 'COMPLETED' ? 'Done' : job.status;
    var total = job.totalFiles || 0;
    var done = (job.completed || 0) + (job.failed || 0);
    progressBar.style.width = total ? Math.round(100 * done / total) + '%' : '0';
    progressLine.textContent = done + ' of ' + total + ' recordings resolved' + (job.completedAt ? ' · batch finished' : ' · batch in progress');

    var byFile = {};
    (job.children || []).forEach(function (c) { byFile[c.fileId] = c; });
    var incidents = job.incidents || [];
    var incByFile = {};
    incidents.forEach(function (i2) { (incByFile[i2.fileId] = incByFile[i2.fileId] || []).push(i2); });

    incidentLog.innerHTML = incidents.map(function (i2) {
      return '<div class="incident"><b>Incident</b> — worker for <b>' + esc(i2.fileId) + '</b> went down during the batch (' + esc(i2.reason) + '). It was re-run automatically — attempt #' + esc(i2.attempt) + '.</div>';
    }).join('');

    boardCards.innerHTML = audioUrls.map(function (u, idx) {
      var fid = 'file-' + (idx + 1);
      var c = byFile[fid];
      var chipClass = 'Queued', chipText = 'Queued', extra = '', body2 = '';
      if (c) {
        if (c.status === 'RUNNING' || c.status === 'PENDING') { chipClass = 'Transcribing'; chipText = 'Transcribing'; }
        else if (c.status === 'COMPLETED') { chipClass = 'Done'; chipText = 'Done'; }
        else if (c.status === 'FAILED') { chipClass = 'Failed'; chipText = 'Failed'; }
        else if (c.status === 'DESTROYED') { chipClass = 'Queued'; chipText = 'Re-running'; }
        else { chipClass = 'Queued'; chipText = statusLabel(c.status); }
        var before = prevAttempts[fid];
        if ((c.attempts || 1) > 1) {
          extra = '<span class="chip recovered">recovered after outage · ' + esc(c.attempts) + ' attempts</span>';
        } else if (before && before > 1 && c.attempts === 1) {
          extra = '<span class="chip recovered">finished work kept — not redone</span>';
        }
        if (c.error) body2 += '<div class="err">' + esc(c.error) + '</div>';
        (incByFile[fid] || []).forEach(function (i2) {
          body2 += '<div class="incident">went down mid-batch (' + esc(i2.reason) + ') — re-run automatically, never redone</div>';
        });
      }
      var transcriptBlock = '';
      var result = (job.results || []).filter(function (r) { return r.fileId === fid; })[0];
      if (result) {
        transcriptBlock = '<details><summary>Show transcript</summary><pre>' + esc(result.transcript) + '</pre></details>';
      }
      return '<div class="consult"><div class="top"><span class="name">' + esc(consultTitle(idx)) + '</span><span class="chip ' + chipClass + '">' + esc(chipText) + '</span></div>' +
        '<div class="meta">' + esc((LENGTHS[idx] || '10 min') + ' · ' + (ROOMS[idx] || 'Room 1')) + (c ? ' · worker ' + esc(c.name) : '') + '</div>' +
        (extra ? '<div style="margin-top:.35rem">' + extra + '</div>' : '') + body2 + transcriptBlock + '</div>';
    }).join('');

    var finished = job.status === 'COMPLETED' || job.status === 'PARTIAL_FAILURE';
    reportSection.style.display = finished ? '' : 'none';
    if (finished) {
      reportBody.innerHTML = (job.outcomes || []).map(function (o) {
        var line = o.status === 'COMPLETED'
          ? '<b>' + esc(o.fileId) + '</b> — transcript ready (' + esc(o.attempts) + ' attempt' + (o.attempts === 1 ? '' : 's') + ')' + (o.attempts > 1 ? ' <span class="chip recovered">survived the power event — never redone</span>' : '')
          : '<b style="color:var(--bad)">' + esc(o.fileId) + '</b> — could not be transcribed after ' + esc(o.attempts) + ' attempt' + (o.attempts === 1 ? '' : 's') + ': ' + esc(o.error);
        return '<div style="font-size:.9rem; margin:.4rem 0">' + line + '</div>';
      }).join('');
      smsText.textContent = job.notification || '—';
      recordNote.textContent = job.status === 'COMPLETED'
        ? 'Every recording has exactly one authoritative transcript on record. Re-posting this batch ID would be a no-op — finished work is never redone.'
        : 'The batch finished with failures on record. Re-posting this batch ID is a no-op; use a new batch ID after fixing the cause.';
    }
  }

  fetch('/config').then(function (r) { return r.json(); }).then(function (cfg) {
    audioUrls = cfg.audioUrls || [];
    batchIdEl.value = todayBatchId();
    renderConsults();
    // Preselect the second recording for the outage story.
    var pre = consultList.querySelectorAll('.faultToggle')[1];
    if (pre) { pre.classList.add('on'); pre.querySelector('input').checked = true; updateFaultNote(); }
    var demoNote = cfg.demoMode
      ? 'Demo mode: transcripts are mocked, SMS is logged. Live mode transcribes real audio via /v2/ai/audio/transcriptions.'
      : 'LIVE mode: real transcription via /v2/ai/audio/transcriptions; SMS delivered to the operator.';
    faultNote.setAttribute('data-demo', demoNote);
  }).catch(function () {
    batchIdEl.value = todayBatchId();
    renderConsults();
  });


  // ── animation: how it survives the night ──
  var stage = document.getElementById('animStage');
  var queueEl = document.getElementById('animQueue');
  var parentEl = document.getElementById('animParent');
  var workersEl = document.getElementById('animWorkers');
  var kvSlotsEl = document.getElementById('animKvSlots');
  var smsEl = document.getElementById('animSms');
  var captionEl = document.getElementById('animCaption');
  var watchdogEl = document.getElementById('animWatchdog');
  var authoritativeEl = document.getElementById('animAuthoritative');
  var animAutoBtn = document.getElementById('animAutoBtn');
  var animLiveBtn = document.getElementById('animLiveBtn');
  var animHint = document.getElementById('animHint');

  var N_FILES = 5;
  var workerEls = [];
  var qEls = [];
  var kvEls = [];
  var autoTimer = null;
  var liveTimer = null;
  var liveJobId = null;
  var livePrevAttempts = {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildAnim() {
    queueEl.innerHTML = '';
    workersEl.innerHTML = '';
    kvSlotsEl.innerHTML = '';
    qEls = []; workerEls = []; kvEls = [];
    for (var i = 0; i < N_FILES; i++) {
      var fid = 'file-' + (i + 1);
      var q = el('div', 'q-dot', consultTitle(i));
      queueEl.appendChild(q); qEls.push(q);
      var w = el('div', 'w');
      w.appendChild(el('span', 'wn', 'Worker ' + (i + 1)));
      w.appendChild(el('span', 'wt', fid));
      workersEl.appendChild(w); workerEls.push(w);
      kvSlotsEl.appendChild(el('div', 'kv-slot', 'job/<batch>/file/' + (i + 1)));
      kvEls.push(kvSlotsEl.lastChild);
    }
  }

  function resetAnim() {
    parentEl.classList.remove('hot');
    watchdogEl.classList.remove('on');
    smsEl.classList.remove('show');
    authoritativeEl.classList.remove('show');
    for (var i = 0; i < N_FILES; i++) {
      qEls[i].className = 'q-dot';
      workerEls[i].className = 'w';
      workerEls[i].querySelector('.wt').textContent = 'file-' + (i + 1);
      kvEls[i].className = 'kv-slot';
    }
  }

  function say(text) { captionEl.textContent = text; }

  function flyPacket(fromEl, toEl, kind) {
    var sr = fromEl.getBoundingClientRect();
    var tr = toEl.getBoundingClientRect();
    var st = stage.getBoundingClientRect();
    var dot = el('div', 'packet' + (kind ? ' ' + kind : ''));
    dot.style.left = (sr.left - st.left + sr.width / 2) + 'px';
    dot.style.top = (sr.top - st.top + sr.height / 2) + 'px';
    stage.appendChild(dot);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        dot.style.left = (tr.left - st.left + tr.width / 2) + 'px';
        dot.style.top = (tr.top - st.top + tr.height / 2) + 'px';
        dot.style.opacity = '0.15';
      });
    });
    setTimeout(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 700);
  }

  function workerDone(i, tag) {
    var w = workerEls[i];
    w.classList.remove('working'); w.classList.add('done');
    if (tag) w.querySelector('.wt').textContent = tag;
    kvEls[i].classList.add('lit');
    flyPacket(w, kvEls[i], '');
    setTimeout(function () { flyPacket(w, parentEl, 'report'); }, 380);
  }

  function autoScript() {
    var steps = [];
    steps.push([200, function () {
      say('1. The nightly queue hands the batch to the orchestrator actor');
      parentEl.classList.add('hot');
      var i;
      for (i = 0; i < N_FILES; i++) {
        (function (j) {
          setTimeout(function () { qEls[j].classList.add('hot'); flyPacket(qEls[j], parentEl, ''); }, j * 130);
        })(i);
      }
    }]);
    steps.push([900, function () {
      say('2. spawn(): one persistent worker actor per recording');
      for (var i = 0; i < N_FILES; i++) {
        (function (j) {
          setTimeout(function () { workerEls[j].classList.add('show'); flyPacket(parentEl, workerEls[j], ''); }, j * 130);
        })(i);
      }
    }]);
    steps.push([1000, function () {
      say('3. Each worker transcribes, then writes its outcome to KV FIRST (the authority) before reporting back');
      watchdogEl.classList.add('on');
    }]);
    for (var i = 0; i < N_FILES; i++) {
      steps.push([620, (function (idx) {
        return function () {
          workerEls[idx].classList.add('working');
          setTimeout(function () { workerDone(idx); }, 520);
        };
      })(i)]);
    }
    steps.push([900, function () {
      say('4. 3:02 AM - a power event takes Worker 2 down mid-flight');
      var w2 = workerEls[1];
      w2.classList.remove('working', 'done'); w2.classList.add('down');
      qEls[1].classList.remove('hot'); qEls[1].classList.add('dead');
      watchdogEl.classList.remove('on');
    }]);
    steps.push([1400, function () {
      say('5. The watchdog notices the missing report - re-spawns ONLY that file');
      watchdogEl.classList.add('on');
      var w2 = workerEls[1];
      setTimeout(function () {
        w2.classList.remove('down');
        w2.querySelector('.wt').textContent = 'file-2 (attempt 2)';
        w2.classList.add('working');
      }, 500);
    }]);
    steps.push([1500, function () { workerDone(1, 'file-2 (attempt 2)'); }]);
    steps.push([900, function () {
      say('6. Morning: scorecard compiled, one SMS to the operator, the parent cleans itself up');
      for (var i = 0; i < N_FILES; i++) { workerEls[i].classList.add('locked'); }
      smsEl.textContent = 'Job complete: 5/5 transcripts compiled.';
      smsEl.classList.add('show');
      parentEl.classList.remove('hot');
      watchdogEl.classList.remove('on');
    }]);
    steps.push([1300, function () {
      say('Nothing redone. Nothing lost.');
      authoritativeEl.classList.add('show');
    }]);
    return steps;
  }

  function isLive() { return liveTimer !== null; }

  function stopAll() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
    liveJobId = null;
    livePrevAttempts = {};
  }

  function playAuto() {
    stopAll();
    buildAnim(); resetAnim(); say('');
    var steps = autoScript();
    var t = 0;
    steps.forEach(function (st) {
      t += st[0];
      setTimeout(function () { if (isLive()) return; st[1](); }, t);
    });
    autoTimer = setTimeout(function () { playAuto(); }, t + 4200);
  }

  // Live mode: start a REAL batch (one-shot power event on file-2) and let the
  // animation replay what actually happens.
  function playLive() {
    stopAll();
    buildAnim(); resetAnim(); say('Starting a real batch - one recording is on the fault circuit...');
    animLiveBtn.disabled = true;
    var jobId = 'clinic-live-demo-' + Date.now();
    liveJobId = jobId;
    fetch('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: jobId, audioUrls: audioUrls, hangOnce: ['file-2'], stuckTimeoutSeconds: 6, demoMode: true }) })
      .catch(function () {});
    watchdogEl.classList.add('on');
    parentEl.classList.add('hot');
    var i;
    for (i = 0; i < N_FILES; i++) {
      qEls[i].classList.add('hot');
      workerEls[i].classList.add('show', 'working');
    }
    liveTimer = setInterval(function () {
      fetch('/api/jobs/' + encodeURIComponent(jobId)).then(function (r) {
        if (r.status === 404) return null;
        return r.json();
      }).then(function (job) { if (job) liveRender(job); }).catch(function () {});
    }, 1200);
  }

  function liveRender(job) {
    var results = {};
    (job.results || []).forEach(function (r) { results[r.fileId] = r; });
    var byFile = {};
    (job.children || []).forEach(function (c) { byFile[c.fileId] = c; });

    var i;
    for (i = 0; i < N_FILES; i++) {
      var fid = 'file-' + (i + 1);
      var w = workerEls[i];
      var c = byFile[fid];
      if (!c) continue;
      if (c.attempts > 1 && !w.getAttribute('data-respawn')) {
        w.setAttribute('data-respawn', '1');
        w.classList.remove('working', 'done', 'down');
        w.querySelector('.wt').textContent = fid + ' (attempt ' + c.attempts + ')';
        w.classList.add('working');
        say('Power event hit ' + fid + ' - the watchdog re-spawned only that file');
      }
      if (results[fid] && w.className.indexOf('done') === -1) {
        workerDone(i, w.querySelector('.wt').textContent);
        if (c.attempts > 1) say(fid + ' recovered - finished files were never redone');
      }
      livePrevAttempts[fid] = c.attempts;
    }

    if (job.status === 'COMPLETED' || job.status === 'PARTIAL_FAILURE') {
      clearInterval(liveTimer); liveTimer = null;
      animLiveBtn.disabled = false;
      for (var k = 0; k < N_FILES; k++) { workerEls[k].classList.add('locked'); }
      parentEl.classList.remove('hot');
      watchdogEl.classList.remove('on');
      smsEl.textContent = job.notification || (job.status === 'COMPLETED' ? 'Job complete.' : 'Job finished with failures.');
      smsEl.classList.add('show');
      say(job.status === 'COMPLETED'
        ? 'Real batch: 5/5 done - one outage, zero rework, zero loss.'
        : 'Real batch finished with failures on record.');
      authoritativeEl.classList.add('show');
    }
  }

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  animAutoBtn.addEventListener('click', function () { animHint.textContent = ''; playAuto(); });
  animLiveBtn.addEventListener('click', playLive);
  if (!reducedMotion) {
    var seen = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen && !isLive()) {
          seen = true;
          animHint.textContent = 'Auto-playing - press Run it live to sync with a real batch.';
          playAuto();
        }
      });
    }, { threshold: 0.3 });
    io.observe(document.getElementById('animSection'));
  }

  startBtn.addEventListener('click', function () { postJob(selectedFaults()); });
  recheckBtn.addEventListener('click', function () {
    // Power returned: re-post the same batch ID. Finished batches are a no-op
    // (ALREADY_DONE); interrupted ones resume exactly where they stopped.
    postJob(null);
  });
  batchIdEl.addEventListener('input', function () { recheckBtn.disabled = !batchIdEl.value.trim(); });
})();
</script>
</body>
</html>`;
