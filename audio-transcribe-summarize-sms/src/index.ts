export { VoicemailAgent } from "./voicemailAgent";
import type { VoicemailAgent } from "./voicemailAgent";

import {
  type ActorNamespace,
  type ActorStub,
  type IdFromNameOptions,
} from "@telnyx/edge-runtime";

type VoicemailAgentStub = ActorStub &
  Pick<
    VoicemailAgent,
    "start" | "transcribe" | "summarize" | "notify" | "getStatus"
  >;

interface VoicemailAgentNamespace extends ActorNamespace {
  idFromName(name: string, options?: IdFromNameOptions): VoicemailAgentStub;
}

interface Env {
  VOICEMAIL: VoicemailAgentNamespace;
  TELNYX_API_KEY: string;
  STORAGE_BUCKET: string;
  STORAGE_REGION: string;
  AI_MODEL: string;
  SENDER_PHONE: string;
}

// Dapr-safe actor names: no "+", no special chars (RFC 1123 job-name-safe).
function actorName(id: string): string {
  return id.replace(/[^0-9a-zA-Z.-]/g, "");
}

// ── Live Dashboard HTML (served from GET /) ──────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Voicemail Agent — Live Pipeline Dashboard</title>
<style>
  :root {
    --bg: #fafafa; --card: #ffffff; --border: #e5e5e5; --text: #1a1a1a;
    --muted: #666; --accent: #4a1; --accent-bg: #e8f5e9;
    --stage-pending: #f1f5f9; --stage-pending-text: #475569;
    --stage-active: #fef3c7; --stage-active-text: #92400e;
    --stage-done: #d1fae5; --stage-done-text: #065f46;
    --stage-error: #fee2e2; --stage-error-text: #991b1b;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 960px; margin: 0 auto; padding: 32px; color: var(--text); background: var(--bg); }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 14px; margin-bottom: 24px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
          padding: 20px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin: 0 0 16px; font-weight: 600; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--muted); }
  input[type=file], input[type=tel] { width: 100%; padding: 10px 12px; border: 1px solid var(--border);
          border-radius: 6px; font-size: 14px; margin-bottom: 14px; font-family: inherit; }
  button { background: var(--accent); color: white; border: none; padding: 12px 24px;
           border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .stages { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
  .stage { padding: 14px; border-radius: 6px; text-align: center; font-size: 12px;
           font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
           background: var(--stage-pending); color: var(--stage-pending-text); }
  .stage.active { background: var(--stage-active); color: var(--stage-active-text); }
  .stage.done { background: var(--stage-done); color: var(--stage-done-text); }
  .stage.error { background: var(--stage-error); color: var(--stage-error-text); }
  .stage-num { display: block; font-size: 18px; margin-bottom: 4px; }
  pre { background: #f7f7f7; padding: 12px; border-radius: 6px; font-size: 13px;
        white-space: pre-wrap; word-wrap: break-word; max-height: 200px; overflow-y: auto;
        margin: 0; font-family: 'SF Mono', Monaco, monospace; }
  .meta-line { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
  .meta-line b { color: var(--text); }
  .empty { color: #999; font-style: italic; }
  .error { color: var(--stage-error-text); font-weight: 600; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <h1>Voicemail Agent — Live Pipeline</h1>
  <div class="sub">Upload a voicemail → transcribe → AI summary → SMS. Agent SDK on Telnyx Edge Compute.</div>

  <div class="card">
    <h2>1. Upload audio file</h2>
    <form id="uploadForm">
      <label for="file">Audio file (.wav, .mp3, .m4a)</label>
      <input type="file" id="file" name="file" accept="audio/*" required>
      <label for="phone">Recipient phone (E.164, e.g. +17177247292)</label>
      <input type="tel" id="phone" name="recipient_phone" placeholder="+17177247292" required>
      <button type="submit" id="submitBtn">Run pipeline</button>
    </form>
    <div id="uploadStatus" style="margin-top:12px;font-size:13px;"></div>
  </div>

  <div class="card" id="pipelineCard" style="display:none;">
    <h2>2. Pipeline status</h2>
    <div class="stages">
      <div class="stage" id="stage-upload"><span class="stage-num">1</span>Upload</div>
      <div class="stage" id="stage-transcribe"><span class="stage-num">2</span>Transcribe</div>
      <div class="stage" id="stage-summarize"><span class="stage-num">3</span>Summarize</div>
      <div class="stage" id="stage-notify"><span class="stage-num">4</span>SMS</div>
    </div>
    <div class="meta-line" id="statusLine">Status: <b>pending</b></div>
    <div class="meta-line" id="errorLine" style="display:none;"></div>
  </div>

  <div class="card" id="transcriptCard" style="display:none;">
    <h2>3. Transcript (speech-to-text)</h2>
    <pre id="transcript" class="empty">Waiting for transcription…</pre>
  </div>

  <div class="card" id="summaryCard" style="display:none;">
    <h2>4. AI Summary (LLM)</h2>
    <pre id="summary" class="empty">Waiting for summary…</pre>
  </div>

  <div class="card" id="smsCard" style="display:none;">
    <h2>5. SMS delivery</h2>
    <div class="meta-line" id="smsLine">SMS status: <b>pending</b></div>
  </div>

<script>
const form = document.getElementById('uploadForm');
const submitBtn = document.getElementById('submitBtn');
const uploadStatus = document.getElementById('uploadStatus');
const pipelineCard = document.getElementById('pipelineCard');
const transcriptCard = document.getElementById('transcriptCard');
const summaryCard = document.getElementById('summaryCard');
const smsCard = document.getElementById('smsCard');
let pollTimer = null;

function setStage(name, cls) {
  const el = document.getElementById('stage-' + name);
  if (!el) return;
  el.className = 'stage ' + cls;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  uploadStatus.textContent = 'Uploading…';
  const fd = new FormData(form);
  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    uploadStatus.innerHTML = 'Queued. Agent ID: <b>' + data.agentId + '</b>';
    pipelineCard.style.display = 'block';
    setStage('upload', 'done');
    setStage('transcribe', 'active');
    pollStatus(data.agentId);
  } catch (err) {
    uploadStatus.innerHTML = '<span class="error">Error: ' + err.message + '</span>';
    submitBtn.disabled = false;
  }
});

function pollStatus(agentId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch('/status/' + agentId);
      const s = await res.json();
      updateUI(s);
      if (s.status === 'done' || s.status === 'error') {
        clearInterval(pollTimer);
        pollTimer = null;
        submitBtn.disabled = false;
      }
    } catch (e) { /* keep polling */ }
  }, 2000);
}

function updateUI(s) {
  const statusLine = document.getElementById('statusLine');
  const errorLine = document.getElementById('errorLine');
  statusLine.innerHTML = 'Status: <b>' + escapeHtml(s.status) + '</b>';

  if (s.status === 'transcribing') { setStage('transcribe', 'active'); }
  if (s.transcript) {
    setStage('transcribe', 'done');
    setStage('summarize', 'active');
    transcriptCard.style.display = 'block';
    document.getElementById('transcript').textContent = s.transcript;
    document.getElementById('transcript').className = '';
  }
  if (s.status === 'summarizing') { setStage('summarize', 'active'); }
  if (s.summary) {
    setStage('summarize', 'done');
    setStage('notify', 'active');
    summaryCard.style.display = 'block';
    document.getElementById('summary').textContent = s.summary;
    document.getElementById('summary').className = '';
    smsCard.style.display = 'block';
  }
  if (s.status === 'sending') { setStage('notify', 'active'); }
  if (s.status === 'done') {
    setStage('notify', 'done');
    smsCard.style.display = 'block';
    document.getElementById('smsLine').innerHTML = 'SMS sent to <b>' + escapeHtml(s.recipientPhone || '') + '</b> ✓';
  }
  if (s.status === 'error') {
    errorLine.style.display = 'block';
    errorLine.className = 'meta-line error';
    errorLine.textContent = 'Error: ' + (s.error || 'unknown');
    setStage('transcribe', s.transcript ? 'done' : 'error');
    setStage('summarize', s.summary ? 'done' : 'error');
    setStage('notify', s.smsSent ? 'done' : 'error');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
</script>
</body>
</html>`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // ── Health ─────────────────────────────────────────────────────────
    if (url.pathname === "/health/liveness") return new Response("ok");
    if (url.pathname === "/health/readiness") return new Response("ok");

    // ── Live Dashboard (for demo video) ────────────────────────────────
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return new Response(DASHBOARD_HTML, {
        headers: { "content-type": "text/html;charset=utf-8" },
      });
    }

    // ── Upload audio + trigger pipeline ─────────────────────────────────
    if (req.method === "POST" && url.pathname === "/upload") {
      try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;
        const recipientPhone = formData.get("recipient_phone") as string | null;

        if (!file || !recipientPhone) {
          return Response.json(
            { error: "Missing 'file' (audio) or 'recipient_phone' (SMS destination)" },
            { status: 400 },
          );
        }

        if (!env.TELNYX_API_KEY || !env.STORAGE_BUCKET) {
          return Response.json(
            { error: "Server missing TELNYX_API_KEY or STORAGE_BUCKET" },
            { status: 500 },
          );
        }

        const region = env.STORAGE_REGION || "us-central-1";
        const audioKey = `voicemails/${Date.now()}-${file.name || "audio.wav"}`;
        const audioBytes = await file.arrayBuffer();

        // Upload to Cloud Storage
        await VoicemailAgent.uploadToStorage(
          env.TELNYX_API_KEY,
          env.STORAGE_BUCKET,
          audioKey,
          audioBytes,
          file.type || "audio/wav",
          region,
        );

        // Start the agent pipeline
        const agentId = actorName(audioKey.replace(/\//g, "-"));
        await env.VOICEMAIL.idFromName(agentId).start({
          audioKey,
          bucket: env.STORAGE_BUCKET,
          recipientPhone,
          senderPhone: env.SENDER_PHONE,
        });

        return Response.json({
          action: "queued",
          audioKey,
          agentId,
          recipientPhone,
          statusUrl: `/status/${agentId}`,
        });
      } catch (e: any) {
        return Response.json({ error: e?.message || "upload failed" }, { status: 500 });
      }
    }

    // ── Check pipeline status ───────────────────────────────────────────
    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const agentId = url.pathname.split("/status/")[1];
      if (!agentId) return Response.json({ error: "missing agent id" }, { status: 400 });

      try {
        const state = await env.VOICEMAIL.idFromName(agentId).getStatus();
        return Response.json(state);
      } catch (e: any) {
        return Response.json({ error: e?.message || "failed to get state" }, { status: 500 });
      }
    }

    // ── Debug: simulate pipeline without uploading a real file ─────────
    if (req.method === "POST" && url.pathname === "/debug/simulate") {
      try {
        const body = (await req.json().catch(() => ({}))) as any;
        const recipientPhone = String(body.recipient_phone || "+17177247292");
        const audioKey = `debug/${Date.now()}-test.wav`;

        // Skip storage — just run the STT on a pre-existing file
        const agentId = actorName(`debug-${Date.now()}`);
        await env.VOICEMAIL.idFromName(agentId).start({
          audioKey: body.audio_key || audioKey,
          bucket: env.STORAGE_BUCKET || "test-bucket",
          recipientPhone,
          senderPhone: env.SENDER_PHONE || "+16282564655",
        });

        return Response.json({ action: "queued", agentId, recipientPhone });
      } catch (e: any) {
        return Response.json({ error: e?.message || "simulation failed" }, { status: 500 });
      }
    }

    return new Response("not found", { status: 404 });
  },
};
