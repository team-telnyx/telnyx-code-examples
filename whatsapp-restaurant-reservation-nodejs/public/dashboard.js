/* ── State ────────────────────────────────────────────────────── */
let allRestaurants = [];
let eventSource = null;
let currentPage = 1;
let totalPages = 1;
let totalResults = 0;
const PER_PAGE = 12;

// Config fetched from /api/config (replaces Jinja2 template vars)
let WA_NUMBER = "";
let DEFAULT_CITY = "Amsterdam";

/* ── Config Bootstrap ────────────────────────────────────────── */
async function loadConfig() {
  try {
    const resp = await fetch("/api/config");
    const cfg = await resp.json();
    WA_NUMBER = (cfg.whatsapp_number || "").replace("+", "");
    DEFAULT_CITY = cfg.city || "Amsterdam";

    // Populate city input
    document.getElementById("cityInput").value = DEFAULT_CITY;
    _lastCity = DEFAULT_CITY;

    // Populate cuisine dropdown
    const select = document.getElementById("cuisineSelect");
    select.innerHTML = "";
    for (const c of cfg.cuisines || []) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    }

    // Set hero CTA link
    if (WA_NUMBER) {
      document.getElementById("heroCta").href =
        `https://web.whatsapp.com/send?phone=${WA_NUMBER}`;
      document.getElementById("heroCtaText").textContent =
        `Message +${WA_NUMBER} to try it`;
    }
  } catch (err) {
    console.warn("Failed to load config:", err);
  }
}

/* ── SSE Connection ───────────────────────────────────────────── */
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource("/stream");

  eventSource.onopen = () => {
    document.getElementById("statusDot").style.background = "var(--green)";
  };

  eventSource.onerror = () => {
    document.getElementById("statusDot").style.background = "var(--red)";
  };

  eventSource.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    handleSSE(data);
  };
}

// Dedup restaurant UI events — prevent SSE + polling from firing the same action twice.
// Uses only stable fields (not ts which differs between SSE and polling).
let _lastRestEvtKey = "";

function handleSSE(data) {
  const type = data.type;

  if (type === "restaurant.search" || type === "restaurant.selected") {
    const key = type + "|" + (data.city || "") + "|" + (data.query || "") + "|" + (data.restaurant_id || "");
    if (key === _lastRestEvtKey) return;
    _lastRestEvtKey = key;
  }

  if (type === "channel.whatsapp") {
    showTyping(false);
    // Dedup key uses phone + role + content (NOT timestamp — SSE ts differs from DB timestamp)
    const phone = data.from || data.to || "";
    const role = data.direction === "inbound" ? "user" : "assistant";
    const key = phone + "|" + role + "|" + (data.text || "").slice(0, 80);
    if (_seenMsgKeys.has(key)) return;
    _seenMsgKeys.add(key);
    addChatBubble(data);
    updateActivity(data.direction === "inbound" ? "Message received" : "Message sent");
  }
  else if (type === "agent.thinking") {
    showTyping(true);
    updateActivity("Thinking...");
  }
  else if (type === "agent.done") {
    showTyping(false);
    updateActivity("Ready");
  }
  else if (type === "agent.tool_call") {
    showTyping(true);
    updateActivity("Using tool: " + (data.tool || ""));
  }
  else if (type === "agent.tool_result") {
    if (data.tool === "make_reservation" || data.tool === "cancel_reservation") {
      loadReservations();
    }
  }
  else if (type === "agent.error") {
    showTyping(false);
    updateActivity("Error: " + (data.error || "Unknown"));
  }
  else if (type === "restaurant.search") {
    if (data.city) {
      document.getElementById("cityInput").value = data.city;
      _lastCity = data.city;
    }
    document.getElementById("searchInput").value = data.query || "";
    document.getElementById("cuisineSelect").value = "All";
    currentPage = 1;
    _pendingLoad = loadRestaurants(1);
  }
  else if (type === "restaurant.selected") {
    if (data.restaurant_id) {
      const highlightCard = () => {
        const card = document.querySelector(`.restaurant-card[data-id="${CSS.escape(data.restaurant_id)}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("highlighted");
          setTimeout(() => card.classList.remove("highlighted"), 2000);
        }
      };
      if (_pendingLoad) {
        _pendingLoad.then(highlightCard);
        _pendingLoad = null;
      } else if (document.querySelector(`.restaurant-card[data-id="${CSS.escape(data.restaurant_id)}"]`)) {
        highlightCard();
      } else if (data.city) {
        document.getElementById("cityInput").value = data.city;
        _lastCity = data.city;
        document.getElementById("searchInput").value = "";
        document.getElementById("cuisineSelect").value = "All";
        currentPage = 1;
        const p = loadRestaurants(1);
        if (p && p.then) p.then(highlightCard);
      }
    }
  }
  else if (type === "reservation.new" || type === "reservation.update") {
    loadReservations();
  }
}

/* ── Chat Bubbles ─────────────────────────────────────────────── */
function formatWhatsApp(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
  s = s.replace(/\b_([^_\n]+)_\b/g, "<i>$1</i>");
  s = s.replace(/~([^~\n]+)~/g, "<s>$1</s>");
  s = s.replace(/```([^`]+)```/g, "<code>$1</code>");
  s = s.replace(/\n/g, "<br>");
  return s;
}

function addChatBubble(data) {
  const chatArea = document.getElementById("chatArea");
  const empty = document.getElementById("chatEmpty");
  if (empty) empty.remove();

  const bubble = document.createElement("div");
  const isInbound = data.direction === "inbound";
  bubble.className = "chat-bubble " + (isInbound ? "inbound" : "outbound");

  const text = data.text || "";
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const ticks = isInbound ? "" : '<span class="read-ticks">&#10003;&#10003;</span>';
  bubble.innerHTML = `
    <div>${formatWhatsApp(text)}</div>
    <div class="chat-time">${time} ${ticks}</div>
  `;

  chatArea.appendChild(bubble);
  chatArea.scrollTop = chatArea.scrollHeight;

  if (isInbound && data.from) {
    const ph = data.from;
    const masked = ph.length > 4 ? "***" + ph.slice(-4) : ph;
    document.getElementById("phoneStatus").textContent = "Chat with " + masked;
  }

  showTyping(false);
}

function showTyping(show) {
  document.getElementById("chatTyping").style.display = show ? "block" : "none";
  if (show) {
    const chatArea = document.getElementById("chatArea");
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

function updateActivity(text) {
  const bar = document.getElementById("activityBar");
  bar.textContent = text.length > 80 ? text.substring(0, 80) + "..." : text;
}

/* ── Restaurant List ──────────────────────────────────────────── */
let _lastCity = DEFAULT_CITY;
let _pendingLoad = null;
let _cityDebounce = null;

function getCity() {
  return (document.getElementById("cityInput").value || "").trim() || DEFAULT_CITY;
}
function getCuisine() {
  return document.getElementById("cuisineSelect").value;
}

function loadRestaurants(page) {
  page = page || currentPage;
  const city = getCity();
  const cuisine = getCuisine();
  const q = document.getElementById("searchInput").value.trim();
  const params = new URLSearchParams({ city, cuisine, page, per_page: PER_PAGE });
  if (q) params.set("q", q);

  document.getElementById("restaurantList").innerHTML =
    '<div class="loading-spinner">Loading restaurants...</div>';

  return fetch("/api/restaurants?" + params)
    .then((r) => r.json())
    .then((data) => {
      allRestaurants = data.restaurants;
      currentPage = data.page;
      totalPages = data.total_pages;
      totalResults = data.total;
      renderRestaurants(allRestaurants);
      renderPagination();
    })
    .catch(() => {
      document.getElementById("restaurantList").innerHTML =
        '<div class="empty-state">Failed to load restaurants</div>';
    });
}

function goToPage(page) {
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  loadRestaurants(page);
  const panel = document.getElementById("restaurantList").closest(".panel-body");
  if (panel) panel.scrollTop = 0;
}

function onCityChange() {
  const city = getCity();
  if (city === _lastCity) return;
  _lastCity = city;
  document.getElementById("searchInput").value = "";
  currentPage = 1;
  loadRestaurants(1);
}

function onCuisineChange() {
  document.getElementById("searchInput").value = "";
  currentPage = 1;
  loadRestaurants(1);
}

let _searchDebounce = null;
function filterRestaurants() {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    currentPage = 1;
    loadRestaurants(1);
  }, 300);
}

function starRating(rating) {
  if (!rating) return "";
  const full = Math.floor(rating);
  const half = rating - full >= 0.3;
  let s = '<span style="letter-spacing:-1px">';
  for (let i = 0; i < full; i++) s += "\u2605";
  if (half) s += "\u00bd";
  s += "</span>";
  return s;
}

function renderRestaurants(list) {
  const container = document.getElementById("restaurantList");
  document.getElementById("restaurantCount").textContent = totalResults + " results";

  if (!list.length) {
    container.innerHTML = '<div class="empty-state">No restaurants found</div>';
    return;
  }

  container.innerHTML = list.map((r) => {
    let metaHtml = "";
    if (r.rating) {
      metaHtml += `<span class="restaurant-rating">${starRating(r.rating)} ${r.rating}</span>`;
      if (r.rating_count) metaHtml += `<span class="restaurant-rating-count">(${r.rating_count.toLocaleString()})</span>`;
    }
    if (r.price_level) metaHtml += `<span class="restaurant-price">${escapeHtml(r.price_level)}</span>`;
    if (r.price_range) metaHtml += `<span class="restaurant-price-range">${escapeHtml(r.price_range)}</span>`;

    let openHtml = "";
    if (r.open_now === 1) openHtml = '<span class="restaurant-open open-yes">Open</span>';
    else if (r.open_now === 0) openHtml = '<span class="restaurant-open open-no">Closed</span>';

    const tags = [];
    if (r.reservable) tags.push("Reservable");
    if (r.vegetarian) tags.push("Vegetarian");
    if (r.outdoor_seating) tags.push("Outdoor");
    if (r.dine_in) tags.push("Dine-in");
    if (r.delivery) tags.push("Delivery");
    if (r.takeout) tags.push("Takeout");
    const tagsHtml = tags.length
      ? '<div class="restaurant-tags">' + tags.map((t) => `<span class="restaurant-tag">${t}</span>`).join("") + "</div>"
      : "";

    let linksHtml = "";
    const links = [];
    if (r.website) links.push(`<a href="${escapeHtml(r.website)}" target="_blank" rel="noopener">\uD83C\uDF10 Website</a>`);
    if (r.maps_url) links.push(`<a href="${escapeHtml(r.maps_url)}" target="_blank" rel="noopener">\uD83D\uDCCD Maps</a>`);
    if (links.length) linksHtml = '<div class="restaurant-links">' + links.join("") + "</div>";

    let hoursHtml = "";
    if (r.hours) {
      try {
        const h = typeof r.hours === "string" ? JSON.parse(r.hours) : r.hours;
        if (h && h.length) {
          hoursHtml = `<div class="restaurant-hours-toggle" onclick="this.nextElementSibling.classList.toggle('show')">\u23F0 Hours \u25BE</div>`;
          hoursHtml += `<div class="restaurant-hours">${h.join("<br>")}</div>`;
        }
      } catch { /* ignore */ }
    }

    return `
    <div class="restaurant-card" data-id="${escapeHtml(r.id)}">
      <img class="restaurant-photo" src="${escapeHtml(r.photo_url || "")}"
           alt="${escapeHtml(r.name)}" loading="lazy"
           onerror="this.style.display='none'">
      <div class="restaurant-info">
        <div class="restaurant-name">${escapeHtml(r.name)}</div>
        <div class="restaurant-meta-row">
          ${r.cuisine ? `<span class="restaurant-cuisine">${escapeHtml(formatCuisine(r.cuisine))}</span>` : ""}
          ${openHtml}
        </div>
        ${metaHtml ? `<div class="restaurant-meta-row">${metaHtml}</div>` : ""}
        <div class="restaurant-address">${escapeHtml(r.address || "")}</div>
        ${tagsHtml}
        ${hoursHtml}
        ${linksHtml}
        <div class="restaurant-actions">
          <a class="btn-book"
             href="https://web.whatsapp.com/send?phone=${WA_NUMBER}&text=${encodeURIComponent("Book a table at " + r.name)}"
             target="_blank" rel="noopener">
            Book via WhatsApp
          </a>
        </div>
      </div>
    </div>
  `;
  }).join("");
}

function renderPagination() {
  const existing = document.getElementById("pagination");
  if (existing) existing.remove();
  if (totalPages <= 1) return;

  const container = document.getElementById("restaurantList");
  const nav = document.createElement("div");
  nav.id = "pagination";
  nav.className = "pagination";

  let html = "";
  html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage <= 1 ? "disabled" : ""}>&laquo; Prev</button>`;

  const pages = [1];
  for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
    pages.push(i);
  }
  if (totalPages > 1) pages.push(totalPages);
  const unique = [...new Set(pages)].sort((a, b) => a - b);

  let last = 0;
  for (const p of unique) {
    if (p - last > 1) html += '<span class="page-dots">&hellip;</span>';
    html += `<button class="page-btn ${p === currentPage ? "active" : ""}" onclick="goToPage(${p})">${p}</button>`;
    last = p;
  }

  html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage >= totalPages ? "disabled" : ""}>Next &raquo;</button>`;
  nav.innerHTML = html;
  container.after(nav);
}

function formatCuisine(c) {
  if (!c) return "";
  return c.split(";")[0].replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function refreshRestaurants() {
  const city = getCity();
  fetch("/api/restaurants/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ city }),
  })
    .then((r) => r.json())
    .then(() => loadRestaurants())
    .catch(() => {});
}

/* ── Reservations ─────────────────────────────────────────────── */
function loadReservations() {
  fetch("/api/reservations")
    .then((r) => r.json())
    .then((data) => renderReservations(data))
    .catch(() => {});
}

function renderReservations(data) {
  const list = data.reservations || [];

  document.getElementById("resDate").textContent = "Upcoming";

  const active = list.filter((r) => r.status !== "cancelled");
  const confirmed = list.filter((r) => r.status === "confirmed");
  const pending = list.filter((r) => r.status === "pending");
  document.getElementById("totalBookings").textContent = active.length;
  document.getElementById("confirmedCount").textContent = confirmed.length;
  document.getElementById("pendingCount").textContent = pending.length;

  updateTableGrid(active);

  const container = document.getElementById("resList");
  if (!active.length) {
    container.innerHTML = '<div class="empty-state">No upcoming reservations</div>';
    return;
  }

  container.innerHTML = active.map((r) => `
    <div class="res-card">
      <div class="res-time">${escapeHtml(r.time)}</div>
      <div class="res-details">
        <div class="res-restaurant">${escapeHtml(r.restaurant_name || r.restaurant_id)}</div>
        <div class="res-meta">
          ${escapeHtml(r.date)} &middot; Party of ${r.party_size}${r.customer_name ? " &middot; " + escapeHtml(r.customer_name) : ""}
        </div>
        <div class="res-actions">
          ${r.status === "pending" ? `<button class="btn btn-sm" onclick="updateRes('${escapeHtml(r.id)}','confirmed')">Confirm</button>` : ""}
          ${r.status !== "cancelled" && r.status !== "completed" ? `<button class="btn btn-sm" onclick="updateRes('${escapeHtml(r.id)}','cancelled')">Cancel</button>` : ""}
          ${r.status === "confirmed" ? `<button class="btn btn-sm" onclick="updateRes('${escapeHtml(r.id)}','completed')">Complete</button>` : ""}
        </div>
      </div>
      <span class="res-badge badge-${r.status}">${r.status}</span>
    </div>
  `).join("");
}

function updateTableGrid(reservations) {
  const tables = [
    { id: "T1", seats: 2 }, { id: "T2", seats: 2 }, { id: "T3", seats: 4 },
    { id: "T4", seats: 4 }, { id: "T5", seats: 6 }, { id: "T6", seats: 8 },
  ];

  const assigned = new Set();
  const pendingTables = new Set();
  const sortedRes = [...reservations].sort((a, b) => a.party_size - b.party_size);

  for (const r of sortedRes) {
    for (let i = 0; i < tables.length; i++) {
      if (!assigned.has(i) && !pendingTables.has(i) && tables[i].seats >= r.party_size) {
        if (r.status === "confirmed") assigned.add(i);
        else if (r.status === "pending") pendingTables.add(i);
        break;
      }
    }
  }

  const grid = document.getElementById("tableGrid");
  grid.innerHTML = tables.map((t, i) => {
    let cls = "available";
    if (assigned.has(i)) cls = "booked";
    else if (pendingTables.has(i)) cls = "pending";
    return `<div class="table-cell ${cls}"><div class="table-id">${t.id}</div><div class="table-seats">${t.seats} seats</div></div>`;
  }).join("");
}

function updateRes(id, status) {
  fetch(`/api/reservations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  })
    .then((r) => r.json())
    .then(() => loadReservations())
    .catch(() => {});
}

/* ── Utilities ────────────────────────────────────────────────── */
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ── Conversation Polling ─────────────────────────────────────── */
// On Edge, the webhook and SSE may land on different instances, so SSE events
// for chat messages can be missed. Poll /api/conversations as a fallback.
let _lastMsgTs = "";
let _seenMsgKeys = new Set();

function pollConversations() {
  const url = _lastMsgTs
    ? `/api/conversations?since=${encodeURIComponent(_lastMsgTs)}&limit=20`
    : "/api/conversations?limit=30";
  fetch(url).then((r) => r.json()).then((data) => {
    const msgs = data.messages || [];
    for (const m of msgs) {
      // Always advance the cursor so we don't re-fetch the same rows
      if (m.timestamp > _lastMsgTs) _lastMsgTs = m.timestamp;
      const key = (m.customer_phone || "") + "|" + m.role + "|" + m.content.slice(0, 80);
      if (_seenMsgKeys.has(key)) continue;
      _seenMsgKeys.add(key);
      addChatBubble({
        direction: m.role === "user" ? "inbound" : "outbound",
        from: m.customer_phone,
        text: m.content,
      });
    }
    // Cap the set size
    if (_seenMsgKeys.size > 500) _seenMsgKeys = new Set([..._seenMsgKeys].slice(-200));
  }).catch(() => {});
}

/* ── UI Event Polling ─────────────────────────────────────────── */
// On Edge, restaurant.search and restaurant.selected SSE events can be missed
// because the webhook instance differs from the SSE instance. Poll the DB.
let _lastUiEventTs = "";
let _seenUiEventIds = new Set();

function pollUiEvents() {
  const url = _lastUiEventTs
    ? `/api/ui-events?since=${encodeURIComponent(_lastUiEventTs)}`
    : "/api/ui-events";
  fetch(url).then((r) => r.json()).then((data) => {
    const events = data.events || [];
    for (const evt of events) {
      if (_seenUiEventIds.has(evt.id)) continue;
      _seenUiEventIds.add(evt.id);
      _lastUiEventTs = evt.created_at;
      try {
        const payload = typeof evt.payload === "string" ? JSON.parse(evt.payload) : evt.payload;
        handleSSE({ type: evt.type, ...payload });
      } catch { /* ignore parse errors */ }
    }
    if (_seenUiEventIds.size > 200) _seenUiEventIds = new Set([..._seenUiEventIds].slice(-100));
  }).catch(() => {});
}

/* ── Init ─────────────────────────────────────────────────────── */
loadConfig().then(() => {
  loadRestaurants();
  loadReservations();
  connectSSE();
  pollConversations();
  pollUiEvents();
});

// Auto-refresh reservations every 30s
setInterval(loadReservations, 30000);

// Poll conversations every 3s to catch messages missed by SSE
setInterval(pollConversations, 3000);

// Poll UI events every 3s to catch restaurant.search / restaurant.selected missed by SSE
setInterval(pollUiEvents, 3000);

// Keep phone clock updated
function updatePhoneClock() {
  const el = document.getElementById("phoneTime");
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
updatePhoneClock();
setInterval(updatePhoneClock, 30000);
