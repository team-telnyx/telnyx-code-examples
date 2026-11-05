/* ------------------------------------------------------------------ *
 *  dashboard.js — SSE handlers + animations for the identity dashboard *
 * ------------------------------------------------------------------ */

let eventSource = null;
let timerInterval = null;
let callStartTime = null;

/* ── SSE Connection ────────────────────────────────────────────────── */

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource("/stream");

  eventSource.onopen = () => {
    console.log("SSE connected");
  };

  eventSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      handleEvent(event);
    } catch { /* parse error */ }
  };

  eventSource.onerror = () => {
    eventSource.close();
    setTimeout(connectSSE, 3000);
  };
}

/* ── Event Router ──────────────────────────────────────────────────── */

function handleEvent(event) {
  const { type } = event;

  switch (type) {
    case "call.incoming":
      handleIncoming(event);
      break;
    case "lookup.started":
      handleLookupStarted(event);
      break;
    case "lookup.complete":
      handleLookupComplete(event);
      break;
    case "risk.assessed":
      handleRiskAssessed(event);
      break;
    case "call.answered":
      handleAnswered(event);
      break;
    case "ai.starting":
      addTimeline("AI Assistant launching", "blue", event.ts, `Mode: ${event.mode}`);
      break;
    case "ai.started":
    case "ai.connected":
      handleAiStarted(event);
      break;
    case "ai.error":
      addTimeline(`AI error: ${event.message}`, "red", event.ts);
      break;
    case "call.ended":
      handleEnded(event);
      break;
    case "state.reset":
      resetDashboard();
      break;
  }
}

/* ── Event Handlers ────────────────────────────────────────────────── */

function handleIncoming(event) {
  resetDashboard();
  const phone = event.phone || "Unknown";
  setStatus("incoming", "Incoming Call");

  // Show identity card in skeleton state
  document.getElementById("awaitingCard").classList.add("hidden");
  document.getElementById("identityCard").classList.remove("hidden");

  // Set all fields to skeleton
  document.querySelectorAll(".identity-field").forEach(f => {
    f.classList.add("skeleton");
    f.classList.remove("revealed");
  });

  addTimeline(`Incoming call from ${formatPhone(phone)}`, "blue", event.ts);
  callStartTime = new Date();
  startTimer();
}

function handleLookupStarted(event) {
  setStatus("lookup", "Looking Up");
  addTimeline("Number Lookup started", "yellow", event.ts, "Querying carrier + caller identity");
}

function handleLookupComplete(event) {
  const id = event.identity || {};

  // Stagger-reveal identity fields
  const fields = [
    { el: "fieldName", value: id.name || "Not available" },
    { el: "fieldLocation", value: id.location || "Not available" },
    { el: "fieldCarrier", value: id.carrier || "Unknown" },
    { el: "fieldLineType", value: id.lineType || "Unknown" },
  ];

  fields.forEach((f, i) => {
    setTimeout(() => {
      const el = document.getElementById(f.el);
      if (!el) return;
      el.querySelector(".field-value").textContent = f.value;
      el.classList.remove("skeleton");
      el.classList.add("revealed");
    }, i * 200);
  });

  addTimeline("Identity data received", "green", event.ts,
    id.name ? `Identified: ${id.name}` : "No registered name");

  // Build signal chips
  buildSignalChips(id);
}

function handleRiskAssessed(event) {
  // Update status — move past "Looking Up" once risk is assessed
  if (event.state === "lookup" || event.state === "incoming") {
    setStatus("answered", "Answered");
  }
  const { score, level, factors } = event;

  // Trust badge
  const badge = document.getElementById("trustBadge");
  badge.textContent = level.toUpperCase();
  badge.className = `trust-badge ${level}`;

  // Card glow
  const card = document.getElementById("identityCard");
  card.classList.remove("glow-trusted", "glow-standard", "glow-suspicious");
  card.classList.add(`glow-${level}`);

  // Animate trust meter
  const meter = document.getElementById("trustMeter");
  meter.classList.remove("hidden");
  const fill = document.getElementById("trustFill");
  const num = document.getElementById("trustNumber");

  fill.className = `meter-fill ${level}`;
  // Animate from 0 to score
  let current = 0;
  const step = Math.max(1, Math.floor(score / 40));
  const interval = setInterval(() => {
    current = Math.min(current + step, score);
    num.textContent = current;
    fill.style.width = `${current}%`;
    if (current >= score) clearInterval(interval);
  }, 25);

  // Risk factor pills (staggered)
  if (factors && factors.length) {
    const container = document.getElementById("riskFactors");
    container.classList.remove("hidden");
    const list = document.getElementById("factorsList");
    list.innerHTML = "";

    factors.forEach((f, i) => {
      setTimeout(() => {
        const pill = document.createElement("div");
        pill.className = `factor-pill ${f.impact}`;
        pill.style.animationDelay = `${i * 0.1}s`;

        const icon = f.impact === "positive" ? "\u2713" : f.impact === "negative" ? "\u2717" : "\u25CB";
        pill.innerHTML = `
          <span class="factor-icon">${icon}</span>
          <span>${f.signal}${f.value != null ? ` (${f.value})` : ""}</span>
        `;
        list.appendChild(pill);
      }, i * 150);
    });
  }

  const levelLabel = level === "trusted" ? "VERIFIED" : level === "standard" ? "STANDARD" : "SUSPICIOUS";
  const dotColor = level === "trusted" ? "green" : level === "standard" ? "yellow" : "red";
  addTimeline(`Trust level: ${levelLabel} (${score}/100)`, dotColor, event.ts);
}

function handleAnswered(event) {
  setStatus("answered", "Answered");
  addTimeline("Call answered", "green", event.ts);
}

function handleAiStarted(event) {
  setStatus("ai_connected", "AI Connected");
  const modeLabel = event.mode === "trusted" ? "Personalized" :
                    event.mode === "suspicious" ? "Verification" : "Standard";
  addTimeline("AI Assistant connected", "green", event.ts, `Greeting mode: ${modeLabel}`);
}

function handleEnded(event) {
  setStatus("ended", "Call Ended");
  stopTimer();
  const dur = event.duration ? formatDuration(event.duration) : "";
  addTimeline(`Call ended${dur ? ` (${dur})` : ""}`, "gray", event.ts, event.reason || "");
  document.getElementById("resetBtn").classList.remove("hidden");
}

/* ── UI Helpers ─────────────────────────────────────────────────────── */

function setStatus(cls, label) {
  const badge = document.getElementById("statusBadge");
  badge.className = `status-badge ${cls}`;
  document.getElementById("statusLabel").textContent = label;
}

function addTimeline(text, dotColor, ts, detail) {
  const timeline = document.getElementById("timeline");
  // Remove empty state
  const empty = timeline.querySelector(".timeline-empty");
  if (empty) empty.remove();

  const entry = document.createElement("div");
  entry.className = "timeline-entry";

  const timeStr = ts ? new Date(ts).toLocaleTimeString() : "";

  entry.innerHTML = `
    <span class="timeline-dot ${dotColor}"></span>
    <div class="timeline-content">
      <div class="timeline-text">${text}</div>
      ${detail ? `<div class="timeline-detail">${detail}</div>` : ""}
      <div class="timeline-time">${timeStr}</div>
    </div>
  `;

  timeline.appendChild(entry);
  timeline.scrollTop = timeline.scrollHeight;
}

function buildSignalChips(identity) {
  const container = document.getElementById("signalChips");
  container.classList.remove("hidden");
  const list = document.getElementById("chipsList");
  list.innerHTML = "";

  const chips = [
    { label: "Carrier", value: identity.carrier || "N/A" },
    { label: "CNAM", value: identity.cnam || "N/A" },
    { label: "Line Type", value: identity.lineType || "N/A" },
    { label: "Ported", value: identity.ported || "No" },
    { label: "Confidence", value: identity.confidence != null ? `${identity.confidence}/100` : "N/A" },
  ];

  for (const c of chips) {
    const chip = document.createElement("div");
    chip.className = "signal-chip";
    chip.innerHTML = `
      <span class="chip-label">${c.label}</span>
      <span class="chip-value">${c.value}</span>
    `;
    list.appendChild(chip);
  }
}

function formatPhone(phone) {
  if (!phone || phone.length < 10) return phone || "Unknown";
  // Show first 5 and last 2 for privacy in demo
  return phone.slice(0, 5) + "..." + phone.slice(-2);
}

/* ── Timer ──────────────────────────────────────────────────────────── */

function startTimer() {
  const el = document.getElementById("callTimer");
  el.classList.remove("hidden");
  callStartTime = callStartTime || new Date();

  timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - callStartTime.getTime()) / 1000);
    el.textContent = formatDuration(diff);
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* ── Reset ─────────────────────────────────────────────────────────── */

function resetDashboard() {
  stopTimer();
  callStartTime = null;
  setStatus("idle", "Awaiting Call");

  document.getElementById("awaitingCard").classList.remove("hidden");
  document.getElementById("identityCard").classList.add("hidden");
  document.getElementById("trustMeter").classList.add("hidden");
  document.getElementById("riskFactors").classList.add("hidden");
  document.getElementById("signalChips").classList.add("hidden");
  document.getElementById("callTimer").classList.add("hidden");
  document.getElementById("resetBtn").classList.add("hidden");

  const card = document.getElementById("identityCard");
  card.classList.remove("glow-trusted", "glow-standard", "glow-suspicious");
  document.getElementById("trustBadge").textContent = "";
  document.getElementById("trustBadge").className = "trust-badge";

  document.getElementById("timeline").innerHTML =
    '<div class="timeline-empty">No activity yet. Make a call to begin.</div>';

  document.querySelectorAll(".identity-field").forEach(f => {
    f.classList.add("skeleton");
    f.classList.remove("revealed");
    f.querySelector(".field-value").textContent = "---";
  });
}

/* ── Init ──────────────────────────────────────────────────────────── */

async function init() {
  connectSSE();

  // Load initial state
  try {
    const resp = await fetch("/api/state");
    const state = await resp.json();
    if (state.status !== "idle" && state.identity) {
      // Restore active call state
      handleIncoming({ phone: state.phone, ts: state.callStartedAt });
      if (state.identity) {
        handleLookupComplete({ identity: state.identity, ts: state.callStartedAt });
      }
      if (state.identity?.trustScore != null) {
        handleRiskAssessed({
          score: state.identity.trustScore,
          level: state.identity.trustLevel,
          factors: state.identity.factors,
          ts: state.callStartedAt,
        });
      }
      if (state.status === "ai_connected") {
        setStatus("ai_connected", "AI Connected");
      } else if (state.status === "answered") {
        setStatus("answered", "Answered");
      }
    }
  } catch { /* initial load failed, SSE will catch up */ }

  // Reset button
  document.getElementById("resetBtn").addEventListener("click", async () => {
    try {
      await fetch("/api/reset", { method: "POST" });
    } catch { /* ignore */ }
    resetDashboard();
  });

  // Load phone number for awaiting card
  try {
    const resp = await fetch("/health");
    const data = await resp.json();
    // Phone number comes from env, not health endpoint — use placeholder
  } catch { /* ignore */ }
}

init();
