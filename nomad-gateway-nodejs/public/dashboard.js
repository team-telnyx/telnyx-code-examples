// Nomad Gateway — Dashboard client
let eventSource = null;
let phoneNumber = "";

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  try {
    const resp = await fetch("/api/config");
    const cfg = await resp.json();
    phoneNumber = cfg.phone_number || "";
    if (phoneNumber) {
      const cta = document.getElementById("heroCta");
      cta.href = `sms:${phoneNumber}`;
      cta.textContent = `Text ${phoneNumber}`;
    }
  } catch { /* ignore */ }

  await Promise.all([loadQueries(), loadStatus(), loadKnowledge()]);
  connectSSE();
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------
async function loadQueries() {
  try {
    const resp = await fetch("/api/queries?limit=50");
    const data = await resp.json();
    renderQueries(data.queries || []);
  } catch { /* ignore */ }
}

async function loadStatus() {
  try {
    const resp = await fetch("/api/status");
    const data = await resp.json();
    updateStatusPanel(data.status || {});
  } catch { /* ignore */ }
}

async function loadKnowledge() {
  try {
    const resp = await fetch("/api/knowledge");
    const data = await resp.json();
    document.getElementById("chunkCount").textContent = data.total || 0;
    document.getElementById("knowledgeInfo").textContent = `${data.total || 0} chunks`;
    renderKnowledge(data.chunks || []);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderQueries(queries) {
  const list = document.getElementById("queryList");
  document.getElementById("queryCount").textContent = `${queries.length} queries`;
  if (!queries.length) {
    list.innerHTML = '<div class="empty-state">No queries yet — text or call the number to start</div>';
    return;
  }
  list.innerHTML = queries.map((q) => {
    const channel = (q.channel || "sms").toLowerCase();
    const mode = (q.inference_mode || "online").toLowerCase();
    return `<div class="query-item">
      <div class="query-meta">
        <span class="channel-badge ${channel}">${channel}</span>
        <span class="source-badge ${mode}">${mode === "online" ? "Telnyx AI" : "Ollama"}</span>
        <span class="query-phone">${escapeHtml(q.phone || "")}</span>
        <span class="query-latency">${q.latency_ms || 0}ms</span>
      </div>
      <div class="query-question">Q: ${escapeHtml(q.question || "")}</div>
      <div class="query-answer">A: ${escapeHtml(q.answer || "—")}</div>
    </div>`;
  }).join("");
}

function renderKnowledge(chunks) {
  const list = document.getElementById("knowledgeList");
  if (!chunks.length) {
    list.innerHTML = '<div class="empty-state">No knowledge chunks indexed yet. Run: npm run seed</div>';
    return;
  }
  list.innerHTML = chunks.map((c) => `<div class="knowledge-item">
    <div class="knowledge-title">${escapeHtml(c.title || "Untitled")}</div>
    <div class="knowledge-meta">${escapeHtml(c.source || "kiwix")} &middot; ${c.created_at ? new Date(c.created_at).toLocaleDateString() : "—"}</div>
  </div>`).join("");
}

function updateStatusPanel(s) {
  const set = (indId, valId, up, label) => {
    const ind = document.getElementById(indId);
    const val = document.getElementById(valId);
    if (ind) { ind.classList.toggle("up", up); ind.classList.toggle("down", !up); }
    if (val) val.textContent = label || (up ? "Online" : "Offline");
  };

  const internet = !!s.internet_up;
  set("indInternet", "valInternet", internet);
  set("indKiwix", "valKiwix", !!s.kiwix_up);
  set("indOllama", "valOllama", !!s.ollama_up);
  set("indMaps", "valMaps", !!s.maps_up);
  set("indIot", "valIot", s.iot_sim_status === "active", s.iot_sim_status || "Unknown");

  const mode = document.getElementById("modeDisplay");
  const modeVal = document.getElementById("modeValue");
  const heroMode = document.getElementById("heroMode");
  if (internet) {
    mode.className = "mode-display online";
    modeVal.textContent = "ONLINE";
    heroMode.className = "hero-mode online";
    heroMode.textContent = "ONLINE";
  } else {
    mode.className = "mode-display offline";
    modeVal.textContent = "OFFLINE";
    heroMode.className = "hero-mode offline";
    heroMode.textContent = "OFFLINE";
  }

  if (s.updated_at) {
    document.getElementById("lastCheck").textContent = new Date(s.updated_at).toLocaleTimeString();
  }
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource("/stream");

  eventSource.onopen = () => {
    document.getElementById("statusDot").classList.add("connected");
    document.getElementById("connLabel").textContent = "Connected";
  };

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch { /* parse error */ }
  };

  eventSource.onerror = () => {
    document.getElementById("statusDot").classList.remove("connected");
    document.getElementById("connLabel").textContent = "Reconnecting";
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

function handleEvent(event) {
  const { type } = event;

  if (type === "system.status") {
    // Convert SSE format to status panel format
    updateStatusPanel({
      internet_up: event.internet ? 1 : 0,
      kiwix_up: event.kiwix ? 1 : 0,
      ollama_up: event.ollama ? 1 : 0,
      maps_up: event.maps ? 1 : 0,
      iot_sim_status: event.iot_sim || "unknown",
      updated_at: event.ts,
    });
  } else if (type === "channel.sms" || type === "channel.voice" || type === "agent.done") {
    // Refresh query log when new activity happens
    loadQueries();
  } else if (type === "knowledge.search" || type === "knowledge.article") {
    loadKnowledge();
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
init();
