/* ── State ────────────────────────────────────────────────────── */
let allRestaurants = [];
let eventSource = null;
let currentPage = 1;
let totalPages = 1;
let totalResults = 0;
const PER_PAGE = 12;
let selectedPhone = "";
let currentCustomer = null; // { phone, name, city }

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

    // Populate cuisine dropdown
    const select = document.getElementById("cuisineSelect");
    select.innerHTML = "";
    for (const c of cfg.cuisines || []) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    }
  } catch (err) {
    console.warn("Failed to load config:", err);
  }
}

/* ── Welcome Gate ────────────────────────────────────────────── */
async function checkWelcome() {
  const stored = localStorage.getItem("dinenyx_customer");
  if (stored) {
    try {
      const cust = JSON.parse(stored);
      // Validate against backend
      const resp = await fetch("/api/customers/" + encodeURIComponent(cust.phone));
      if (resp.ok) {
        const data = await resp.json();
        currentCustomer = data.customer;
        selectedPhone = currentCustomer.phone;
        activateDashboard();
        return;
      }
    } catch { /* invalid stored data — show overlay */ }
    localStorage.removeItem("dinenyx_customer");
  }
  // Show overlay
  document.getElementById("welcomeOverlay").style.display = "flex";
}

function showReadyScreen() {
  const waDisplay = WA_NUMBER ? `+${WA_NUMBER}` : "our WhatsApp number";
  const waLink = WA_NUMBER
    ? `https://web.whatsapp.com/send?phone=${WA_NUMBER}`
    : "#";
  const modal = document.querySelector(".welcome-modal");
  modal.innerHTML = `
    <div class="welcome-brand">Dine<b>Nyx</b></div>
    <p class="welcome-tagline">You're all set, ${escapeHtml(currentCustomer.name)}!</p>
    <p class="welcome-instruction">Send a WhatsApp message to <strong>${escapeHtml(waDisplay)}</strong> to start your conversation.</p>
    <a class="welcome-wa-link" href="${waLink}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" fill="currentColor"/></svg>
      Open WhatsApp
    </a>
    <button class="welcome-continue" onclick="activateDashboard()">Go to Dashboard</button>
  `;
}

function activateDashboard() {
  document.getElementById("welcomeOverlay").style.display = "none";

  // Restore search state from localStorage, or default to customer's city
  const saved = JSON.parse(localStorage.getItem("dinenyx_search") || "null");
  document.getElementById("cityInput").value = saved?.city || currentCustomer.city || DEFAULT_CITY;
  _lastCity = document.getElementById("cityInput").value;
  document.getElementById("cuisineSelect").value = saved?.cuisine || "All";
  document.getElementById("searchInput").value = saved?.query || "";
  currentPage = 1;

  // Set hero CTA link
  if (WA_NUMBER) {
    document.getElementById("heroCta").href =
      `https://web.whatsapp.com/send?phone=${WA_NUMBER}`;
    document.getElementById("heroCtaText").textContent =
      `Message +${WA_NUMBER} to try it`;
  }

  // Show customer name in header
  const nameEl = document.getElementById("customerName");
  nameEl.textContent = currentCustomer.name;
  nameEl.style.display = "inline";
  document.getElementById("phoneStatus").textContent = "Chat with " + currentCustomer.name;

  // Load dashboard data
  loadRestaurants();
  loadReservations();
  connectSSE();
  pollConversations();
  // Set the UI event cursor to "now" so old events don't override the customer's city
  _lastUiEventTs = new Date().toISOString();
  pollUiEvents();
}

function submitWelcome(event) {
  event.preventDefault();
  const name = document.getElementById("welcomeName").value.trim();
  const city = document.getElementById("welcomeCity").value.trim();
  let phone = document.getElementById("welcomePhone").value.trim();
  if (!name || !city || !phone) return false;

  // Normalize phone
  if (!phone.startsWith("+")) phone = "+" + phone;

  fetch("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, name, city }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.error) { alert(data.error); return; }
      currentCustomer = data.customer;
      selectedPhone = phone;
      localStorage.setItem("dinenyx_customer", JSON.stringify(currentCustomer));
      showReadyScreen();
    })
    .catch((err) => {
      console.error("Registration failed:", err);
      alert("Registration failed. Please try again.");
    });
  return false;
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
    // Filter restaurant panel events by phone — only show events from the logged-in customer
    if (selectedPhone && data.customer_phone && data.customer_phone !== selectedPhone) return;
    const key = type + "|" + (data.city || "") + "|" + (data.query || "") + "|" + (data.restaurant_id || "");
    if (key === _lastRestEvtKey) return;
    _lastRestEvtKey = key;
  }

  if (type === "channel.whatsapp") {
    showTyping(false);
    const phone = data.from || data.to || "";

    // Filter: only show messages for the logged-in customer's phone
    if (selectedPhone && phone && phone !== selectedPhone) return;

    // Dedup: include minute-bucket so repeated identical messages still show,
    // but SSE + poll for the SAME message (within the same minute) dedup.
    const role = data.direction === "inbound" ? "user" : "assistant";
    const tsBucket = (data.ts || new Date().toISOString()).slice(0, 16); // YYYY-MM-DDTHH:MM
    const key = phone + "|" + role + "|" + tsBucket + "|" + (data.text || "").slice(0, 80);
    if (_seenMsgKeys.has(key)) return;
    _seenMsgKeys.add(key);
    addChatBubble(data);
    updateActivity(data.direction === "inbound" ? "Message received" : "Message sent");
  }
  else if (type === "customer.registered") {
    // WhatsApp-first registration — update name display if it's our phone
    if (selectedPhone && data.phone === selectedPhone && data.name) {
      currentCustomer = { phone: data.phone, name: data.name, city: data.city };
      localStorage.setItem("dinenyx_customer", JSON.stringify(currentCustomer));
      const nameEl = document.getElementById("customerName");
      nameEl.textContent = data.name;
      nameEl.style.display = "inline";
      document.getElementById("phoneStatus").textContent = "Chat with " + data.name;
    }
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

function saveSearchState() {
  localStorage.setItem("dinenyx_search", JSON.stringify({
    city: getCity(),
    cuisine: getCuisine(),
    query: document.getElementById("searchInput").value.trim(),
  }));
}

function loadRestaurants(page) {
  page = page || currentPage;
  const city = getCity();
  const cuisine = getCuisine();
  const q = document.getElementById("searchInput").value.trim();
  saveSearchState();
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
  const params = new URLSearchParams();
  if (selectedPhone) params.set("phone", selectedPhone);
  const qs = params.toString();
  fetch("/api/reservations" + (qs ? "?" + qs : ""))
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
  const params = new URLSearchParams();
  if (_lastMsgTs) { params.set("since", _lastMsgTs); params.set("limit", "20"); }
  else { params.set("limit", "30"); }
  if (selectedPhone) params.set("phone", selectedPhone);
  const url = "/api/conversations?" + params;
  fetch(url).then((r) => r.json()).then((data) => {
    const msgs = data.messages || [];
    for (const m of msgs) {
      // Always advance the cursor so we don't re-fetch the same rows
      if (m.timestamp > _lastMsgTs) _lastMsgTs = m.timestamp;
      const tsBucket = (m.timestamp || "").slice(0, 16); // YYYY-MM-DDTHH:MM
      const key = (m.customer_phone || "") + "|" + m.role + "|" + tsBucket + "|" + m.content.slice(0, 80);
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

/* ── New Chat ─────────────────────────────────────────────────── */
function newChat() {
  if (!selectedPhone) return;
  const qs = "?phone=" + encodeURIComponent(selectedPhone);
  fetch("/api/conversations" + qs, { method: "DELETE" })
    .then((r) => r.json())
    .then(() => {
      document.getElementById("chatArea").innerHTML =
        '<div class="chat-empty" id="chatEmpty">Send a WhatsApp message to<br>start a conversation</div>';
      _lastMsgTs = "";
      _seenMsgKeys = new Set();
      _lastUiEventTs = "";
      _seenUiEventIds = new Set();
      _lastRestEvtKey = "";
      showTyping(false);
      updateActivity("Message");
      loadReservations();
    });
}

/* ── Init ─────────────────────────────────────────────────────── */
loadConfig().then(() => {
  checkWelcome();
});

// Auto-refresh — guarded so polling only runs after the customer has logged in
setInterval(() => { if (currentCustomer) loadReservations(); }, 30000);
setInterval(() => { if (currentCustomer) pollConversations(); }, 3000);
setInterval(() => { if (currentCustomer) pollUiEvents(); }, 3000);

// Keep phone clock updated
function updatePhoneClock() {
  const el = document.getElementById("phoneTime");
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
updatePhoneClock();
setInterval(updatePhoneClock, 30000);
