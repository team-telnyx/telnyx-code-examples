/* ── State ────────────────────────────────────────────────────── */
let allProducts = [];
let eventSource = null;
let selectedPhone = "";
let currentCustomer = null;
let currentOrders = [];
let currentSubs = [];
let activityFeed = [];
let hasChatMessages = false;
let WA_NUMBER = "";
let CATEGORIES = [];

/* Stage: idle | greeted | shopping | confirmed | picking | packed | out_for_delivery | delivered */
let currentStage = "idle";

/* ── Product icon map — SVG illustrations for basket tiles ──── */
const PRODUCT_ICONS = {
  avo:    { svg: '<svg viewBox="0 0 64 64" width="76" height="76"><ellipse cx="32" cy="34" rx="18" ry="24" fill="#4E7D2E"/><ellipse cx="32" cy="35" rx="13" ry="18" fill="#C8E28A"/><circle cx="32" cy="40" r="7" fill="#8B5A2B"/></svg>', tint: '#E4F1D6' },
  bread:  { svg: '<svg viewBox="0 0 64 64" width="84" height="84"><path d="M8 40c0-12 11-20 24-20s24 8 24 20c0 4-3 6-6 6H14c-3 0-6-2-6-6z" fill="#D9A35F"/><path d="M22 26l-4 8M32 24l-3 9M42 26l-3 8" stroke="#B97E3E" stroke-width="3" stroke-linecap="round"/></svg>', tint: '#F8E7CF' },
  carton: { svg: '<svg viewBox="0 0 64 64" width="76" height="76"><path d="M20 18l6-10h12l6 10v40H20z" fill="#FFFFFF" stroke="#D5DAD2" stroke-width="2"/><path d="M20 18h24" stroke="#D5DAD2" stroke-width="2"/><rect x="20" y="30" width="24" height="16" fill="#3F7FC1"/></svg>', tint: '#E3EEF8' },
  eggs:   { svg: '<svg viewBox="0 0 64 64" width="80" height="80"><rect x="8" y="34" width="48" height="14" rx="4" fill="#D9C7A4"/><ellipse cx="20" cy="32" rx="7" ry="9" fill="#FFF8EC" stroke="#E7D7B8" stroke-width="2"/><ellipse cx="32" cy="30" rx="7" ry="9" fill="#FFF8EC" stroke="#E7D7B8" stroke-width="2"/><ellipse cx="44" cy="32" rx="7" ry="9" fill="#FFF8EC" stroke="#E7D7B8" stroke-width="2"/></svg>', tint: '#FFF3D6' },
  banana: { svg: '<svg viewBox="0 0 64 64" width="80" height="80"><path d="M10 22c4 18 20 28 42 22-4 6-14 10-24 8C16 49 9 37 10 22z" fill="#F5D33F" stroke="#D9B21E" stroke-width="2"/><path d="M10 22l-2-6" stroke="#6B5A2B" stroke-width="3" stroke-linecap="round"/></svg>', tint: '#FFF6C8' },
  tomato: { svg: '<svg viewBox="0 0 64 64" width="76" height="76"><circle cx="24" cy="38" r="13" fill="#E5483A"/><circle cx="42" cy="34" r="12" fill="#EF6A55"/><path d="M24 25l-4-4M24 25l4-5M42 22l-3-4M42 22l4-3" stroke="#3E8E3A" stroke-width="3" stroke-linecap="round"/></svg>', tint: '#FDE2DC' },
  bag:    { svg: '<svg viewBox="0 0 64 64" width="76" height="76"><path d="M18 12h28l4 46H14z" fill="#F3C35B"/><rect x="22" y="28" width="20" height="14" rx="2" fill="#F2E6D8"/></svg>', tint: '#FBEFD5' },
  round:  { svg: '<svg viewBox="0 0 64 64" width="76" height="76"><circle cx="32" cy="36" r="18" fill="#E2533F"/><path d="M32 18c0-5 3-8 8-9" stroke="#3E8E3A" stroke-width="3" stroke-linecap="round" fill="none"/></svg>', tint: '#FDE6E1' },
  block:  { svg: '<svg viewBox="0 0 64 64" width="76" height="76"><path d="M10 40l14-18h30v18z" fill="#F2C14E"/><path d="M10 40h44v8H10z" fill="#E0B84A"/><circle cx="34" cy="32" r="3" fill="#E0B84A"/><circle cx="44" cy="30" r="2.5" fill="#E0B84A"/></svg>', tint: '#FFF1D2' },
  generic:{ svg: '<svg viewBox="0 0 64 64" width="76" height="76"><rect x="16" y="16" width="32" height="32" rx="8" fill="#D5DAD2"/><circle cx="32" cy="32" r="8" fill="#FFFFFF"/></svg>', tint: '#F3F5F0' },
};

function getProductIcon(name) {
  const n = (name || "").toLowerCase();
  if (/avocado/.test(n)) return "avo";
  if (/bread|loaf|sourdough|baguette|croissant|muffin/.test(n)) return "bread";
  if (/milk|oat|cream|yogurt/.test(n)) return "carton";
  if (/egg/.test(n)) return "eggs";
  if (/banana/.test(n)) return "banana";
  if (/tomato|pepper|onion/.test(n)) return "tomato";
  if (/pasta|spaghetti|coffee|rice|flour|cereal|granola/.test(n)) return "bag";
  if (/apple|orange|lemon|lime|peach|pear|plum|mango|berry|grape|melon/.test(n)) return "round";
  if (/butter|cheese|tofu|chocolate/.test(n)) return "block";
  return "generic";
}

/* ── Config Bootstrap ────────────────────────────────────────── */
async function loadConfig() {
  try {
    const resp = await fetch("/api/config");
    const cfg = await resp.json();
    WA_NUMBER = (cfg.whatsapp_number || "").replace("+", "");
    CATEGORIES = cfg.categories || [];
    if (WA_NUMBER) {
      document.getElementById("idlePhone").textContent =
        "Say hi on WhatsApp at +" + WA_NUMBER;
    }
  } catch (err) {
    console.warn("Failed to load config:", err);
  }
}

/* ── Welcome Gate ────────────────────────────────────────────── */
async function checkWelcome() {
  const stored = localStorage.getItem("freshcart_customer");
  if (stored) {
    try {
      const cust = JSON.parse(stored);
      const resp = await fetch("/api/customers/" + encodeURIComponent(cust.phone));
      if (resp.ok) {
        const data = await resp.json();
        currentCustomer = data.customer;
        selectedPhone = currentCustomer.phone;
        activateDashboard();
        return;
      }
    } catch { /* invalid stored data */ }
    localStorage.removeItem("freshcart_customer");
  }
  document.getElementById("welcomeOverlay").style.display = "flex";
}

function showReadyScreen() {
  const waDisplay = WA_NUMBER ? `+${WA_NUMBER}` : "our WhatsApp number";
  const waLink = WA_NUMBER
    ? `https://web.whatsapp.com/send?phone=${WA_NUMBER}`
    : "#";
  const modal = document.querySelector(".welcome-modal");
  modal.innerHTML = `
    <div class="welcome-logo">
      <span class="logo-icon">
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19l7-7"/></svg>
      </span>
      <span class="logo-text">freshcart</span>
    </div>
    <p class="welcome-tagline">You're all set, ${escapeHtml(currentCustomer.name)}!</p>
    <p class="welcome-instruction">Send a WhatsApp message to <strong>${escapeHtml(waDisplay)}</strong> to start shopping.</p>
    <a class="welcome-wa-link" href="${waLink}" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" fill="currentColor"/></svg>
      Open WhatsApp
    </a>
    <button class="welcome-continue" onclick="activateDashboard()">Go to Dashboard</button>
  `;
}

function activateDashboard() {
  document.getElementById("welcomeOverlay").style.display = "none";

  const badge = document.getElementById("userBadge");
  badge.style.display = "flex";
  document.getElementById("userInitial").textContent =
    (currentCustomer.name || "?")[0].toUpperCase();
  document.getElementById("userName").textContent = currentCustomer.name;
  document.getElementById("phoneStatus").textContent =
    "Chat with " + currentCustomer.name;

  loadOrders();
  loadSubstitutions();
  connectSSE();
  pollConversations();
  _lastUiEventTs = new Date().toISOString();
  pollUiEvents();
}

function submitWelcome(event) {
  event.preventDefault();
  const name = document.getElementById("welcomeName").value.trim();
  const address = document.getElementById("welcomeAddress").value.trim();
  let phone = document.getElementById("welcomePhone").value.trim();
  if (!name || !address || !phone) return false;
  if (!phone.startsWith("+")) phone = "+" + phone;

  fetch("/api/customers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, name, address }),
  })
    .then(async (r) => {
      const data = await r.json();
      if (!r.ok || data.error) {
        alert(data.error || "Registration failed.");
        return;
      }
      currentCustomer = data.customer;
      selectedPhone = phone;
      localStorage.setItem("freshcart_customer", JSON.stringify(currentCustomer));
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
    document.getElementById("statusDot").className = "live-dot";
  };
  eventSource.onerror = () => {
    document.getElementById("statusDot").style.background = "#c4483e";
    document.getElementById("statusDot").style.boxShadow = "0 0 0 4px rgba(196,72,62,0.18)";
  };
  eventSource.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    handleSSE(data);
  };
}

let _lastProdEvtKey = "";

function handleSSE(data) {
  const type = data.type;

  if (type === "channel.whatsapp") {
    showTyping(false);
    const phone = data.from || data.to || "";
    if (selectedPhone && phone && phone !== selectedPhone) return;

    const role = data.direction === "inbound" ? "user" : "assistant";
    const tsBucket = (data.ts || new Date().toISOString()).slice(0, 16);
    const key = phone + "|" + role + "|" + tsBucket + "|" + (data.text || "").slice(0, 80);
    if (_seenMsgKeys.has(key)) return;
    _seenMsgKeys.add(key);
    addChatBubble(data);

    if (!hasChatMessages) {
      hasChatMessages = true;
      addFeedItem(data.direction === "inbound" ? "Customer messaged" : "Mia replied", "#0B6E4F");
    } else {
      addFeedItem(data.direction === "inbound" ? "Message received" : "Message sent", "#0B6E4F");
    }
    recomputeStage();
  }
  else if (type === "customer.registered") {
    if (selectedPhone && data.phone === selectedPhone && data.name) {
      currentCustomer = { phone: data.phone, name: data.name, address: currentCustomer?.address || "" };
      localStorage.setItem("freshcart_customer", JSON.stringify(currentCustomer));
      document.getElementById("userInitial").textContent = data.name[0].toUpperCase();
      document.getElementById("userName").textContent = data.name;
      document.getElementById("phoneStatus").textContent = "Chat with " + data.name;
      addFeedItem("Mia recognised " + data.name, "#13A36E");
      recomputeStage();
    }
  }
  else if (type === "agent.thinking") {
    showTyping(true);
    addFeedItem("Mia is thinking...", "#0B6E4F");
  }
  else if (type === "agent.done") {
    showTyping(false);
  }
  else if (type === "agent.tool_call") {
    showTyping(true);
    const toolNames = {
      browse_products: "Browsing products",
      add_to_cart: "Adding to cart",
      view_cart: "Checking cart",
      update_cart: "Updating cart",
      get_delivery_slots: "Checking delivery slots",
      place_order: "Placing order",
      track_delivery: "Tracking delivery",
      reschedule_delivery: "Rescheduling",
      handle_substitution: "Handling substitution",
      reorder: "Reordering",
      register_customer: "Registering customer",
      send_whatsapp: "Sending message",
    };
    addFeedItem(toolNames[data.tool] || ("Using " + (data.tool || "")), "#0B6E4F");
  }
  else if (type === "agent.tool_result") {
    if (data.tool === "place_order" || data.tool === "reschedule_delivery" || data.tool === "reorder") {
      loadOrders();
    }
    if (data.tool === "handle_substitution") {
      loadSubstitutions();
      loadOrders();
    }
    if (data.tool === "add_to_cart" || data.tool === "update_cart" || data.tool === "view_cart") {
      loadCart();
    }
  }
  else if (type === "agent.error") {
    showTyping(false);
    addFeedItem("Error: " + (data.error || "Unknown"), "#c4483e");
  }
  else if (type === "order.new") {
    loadOrders();
    addFeedItem("New order placed", "#13A36E");
  }
  else if (type === "order.update") {
    loadOrders();
    loadSubstitutions();
    addFeedItem("Order updated", "#0B6E4F");
  }
  else if (type === "substitution.resolved") {
    loadSubstitutions();
    loadOrders();
    addFeedItem("Substitution resolved", "#FF7A1A");
  }
  else if (type === "cart.update") {
    loadCart();
  }
}

/* ── Activity Feed ───────────────────────────────────────────── */
function addFeedItem(text, dotColor) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  activityFeed.unshift({ text, dot: dotColor || "#0B6E4F", time });
  if (activityFeed.length > 50) activityFeed = activityFeed.slice(0, 50);
  renderFeed();
}

function renderFeed() {
  const list = document.getElementById("feedList");
  const empty = document.getElementById("feedEmpty");

  if (!activityFeed.length) {
    empty.style.display = "block";
    list.innerHTML = "";
    return;
  }
  empty.style.display = "none";
  list.innerHTML = activityFeed.map(f => `
    <li class="feed-item">
      <span class="feed-dot" style="background:${f.dot}"></span>
      <span class="feed-text">${escapeHtml(f.text)}</span>
      <span class="feed-time">${f.time}</span>
    </li>
  `).join("");
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
    <span>${formatWhatsApp(text)}</span>
    <span class="chat-time">${time} ${ticks}</span>
  `;

  chatArea.appendChild(bubble);
  chatArea.scrollTop = chatArea.scrollHeight;
  showTyping(false);
  hasChatMessages = true;
}

function showTyping(show) {
  document.getElementById("chatTyping").style.display = show ? "block" : "none";
  if (show) {
    const chatArea = document.getElementById("chatArea");
    chatArea.scrollTop = chatArea.scrollHeight;
  }
}

/* ── Stage Computation ───────────────────────────────────────── */
function recomputeStage() {
  let newStage = "idle";

  const activeOrder = currentOrders.find(o => o.status !== "delivered");
  const deliveredOrder = currentOrders.find(o => o.status === "delivered");

  if (activeOrder) {
    newStage = activeOrder.status; // confirmed, picking, packed, out_for_delivery
  } else if (deliveredOrder && !activeOrder) {
    newStage = "delivered";
  } else if (hasChatMessages) {
    newStage = "shopping";
  }

  if (newStage !== currentStage) {
    currentStage = newStage;
    renderProgress();
    renderStageHead();
  }
  renderStageCanvas();
  renderOrderSummary();
  renderAdvanceBtn();
}

/* ── Progress Bar ────────────────────────────────────────────── */
const PROGRESS_STEPS = ["greeted", "shopping", "confirmed", "picking", "out_for_delivery", "delivered"];
const PROGRESS_LABELS = ["Greeted", "Shopping", "Checkout", "Packing", "On the way", "Delivered"];

function stageToProgressIndex(stage) {
  const map = {
    idle: -1,
    greeted: 0,
    shopping: 1,
    confirmed: 2,
    picking: 3,
    packed: 3,
    out_for_delivery: 4,
    delivered: 5,
  };
  return map[stage] ?? -1;
}

function renderProgress() {
  const steps = document.querySelectorAll(".progress-step");
  const idx = stageToProgressIndex(currentStage);

  const isComplete = currentStage === "delivered";
  steps.forEach((step, i) => {
    const bar = step.querySelector(".bar");
    const label = step.querySelector(".step-label");
    bar.className = "bar";
    label.className = "step-label";

    if (i < idx || (isComplete && i === idx)) {
      bar.classList.add("active");
      label.classList.add("active");
    } else if (i === idx) {
      bar.classList.add("current");
      label.classList.add("current");
    }
  });
}

/* ── Stage Heading ───────────────────────────────────────────── */
function renderStageHead() {
  const title = document.getElementById("stageTitle");
  const sub = document.getElementById("stageSub");
  const meta = document.getElementById("stageMeta");

  const activeOrder = currentOrders.find(o => o.status !== "delivered");
  const anyOrder = activeOrder || currentOrders[0];

  const headings = {
    idle:             { t: "Getting started",     s: "Send a message to start your order" },
    greeted:          { t: "Welcome back",        s: currentCustomer ? "Mia recognised " + currentCustomer.name : "Mia is ready" },
    shopping:         { t: "Building your basket", s: "Tell Mia what you need" },
    confirmed:        { t: "Order confirmed",     s: "Your order has been placed" },
    picking:          { t: "Packing your order",  s: "Items are being collected" },
    packed:           { t: "Ready for dispatch",  s: "Your order is packed" },
    out_for_delivery: { t: "On the way",          s: "Your delivery is en route" },
    delivered:        { t: "Delivered",            s: "From shopping list to doorstep" },
  };

  const h = headings[currentStage] || headings.idle;
  title.textContent = h.t;
  sub.textContent = h.s;

  if (anyOrder) {
    meta.textContent = "#" + anyOrder.id.slice(0, 8) + " · " + (anyOrder.item_count || 0) + " items";
  } else {
    meta.textContent = "";
  }
}

/* ── Stage Canvas ────────────────────────────────────────────── */
function renderStageCanvas() {
  const views = ["viewIdle", "viewGreeted", "viewBasket", "viewPacking", "viewDelivery", "viewDelivered"];
  views.forEach(id => { document.getElementById(id).style.display = "none"; });

  switch (currentStage) {
    case "idle":
      document.getElementById("viewIdle").style.display = "block";
      break;
    case "greeted":
    case "shopping":
      renderBasketView();
      break;
    case "confirmed":
    case "picking":
    case "packed":
      renderPackingView();
      break;
    case "out_for_delivery":
      renderDeliveryView();
      break;
    case "delivered":
      renderDeliveredView();
      break;
  }
}

function renderBasketView() {
  const view = document.getElementById("viewBasket");
  view.style.display = "block";

  const activeOrder = currentOrders.find(o => o.status !== "delivered");
  const items = activeOrder?.items || _cartItems || [];

  if (!items.length) {
    // Show greeted view instead
    view.style.display = "none";
    const greeted = document.getElementById("viewGreeted");
    greeted.style.display = "block";
    greeted.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;padding:8px 4px">
        <div class="greeted-card">
          <span class="greeted-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
          </span>
          <span><strong>Mia is ready</strong> to help ${escapeHtml(currentCustomer?.name || "you")} build a shopping list.</span>
        </div>
        ${currentCustomer?.address ? `<span style="font-size:14px;color:#5F6B64">Delivering to ${escapeHtml(currentCustomer.address)}</span>` : ""}
      </div>
    `;
    return;
  }

  view.innerHTML = `<div class="basket-grid">${items.map(item => {
    const icon = getProductIcon(item.product_name || item.name || "");
    const iconData = PRODUCT_ICONS[icon];
    const sub = currentSubs.find(s => s.order_id === (activeOrder?.id) &&
      s.status === "accepted" && s.suggested_item === (item.product_name || item.name));
    const unitPrice = item.unit_price || item.price || 0;
    const qty = item.quantity || item.qty || 1;

    return `
      <article class="basket-tile">
        <div class="tile-visual" style="background:${iconData.tint}">
          ${iconData.svg}
          ${sub ? '<span class="tile-swapped">Swapped</span>' : ""}
          <span class="tile-qty">&times;${qty}</span>
        </div>
        <div class="tile-info">
          <span class="tile-name">${escapeHtml(item.product_name || item.name || "")}</span>
          ${sub ? `<span class="tile-instead">Instead of ${escapeHtml(sub.original_item)}</span>` : ""}
          <span class="tile-price">
            <span class="unit">$${unitPrice.toFixed(2)} each</span>
            <span class="total">$${(item.subtotal || unitPrice * qty).toFixed(2)}</span>
          </span>
        </div>
      </article>
    `;
  }).join("")}</div>`;
}

function renderPackingView() {
  const view = document.getElementById("viewPacking");
  view.style.display = "block";

  const activeOrder = currentOrders.find(o => o.status !== "delivered");
  const items = activeOrder?.items || [];
  const isPacked = currentStage === "packed" || currentStage === "confirmed";

  view.innerHTML = items.length ? items.map((item, i) => {
    const packed = currentStage === "packed";
    const done = packed || currentStage === "picking";
    const stateLabel = packed ? "Packed" : "Picked";
    return `
      <div class="pack-item" style="background:${done ? "#E7F5EE" : "#F3F5F0"}">
        <span class="pack-check ${done ? "done" : "pending"}">
          ${done ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : ""}
        </span>
        <span class="item-name">${item.quantity || 1} &times; ${escapeHtml(item.product_name || "")}</span>
        <span class="item-state">${done ? stateLabel : "Waiting"}</span>
      </div>
    `;
  }).join("") : '<div style="padding:20px;color:#5F6B64;font-size:14px">No items to display</div>';
}

function renderDeliveryView() {
  const view = document.getElementById("viewDelivery");
  view.style.display = "block";

  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="delivery-map">
        <svg width="100%" height="100%" viewBox="0 0 640 320" preserveAspectRatio="xMidYMid slice">
          <rect width="640" height="320" fill="#E6EEE3"/>
          <path d="M-20 250 C 120 200, 220 280, 360 220 S 560 120, 680 160" stroke="#BCD9E8" stroke-width="22" fill="none"/>
          <path d="M-20 90 C 140 60, 260 140, 420 90 S 600 40, 680 60" stroke="#BCD9E8" stroke-width="16" fill="none"/>
          <path d="M80 0 L 120 320 M 260 0 L 230 320 M 420 0 L 460 320 M 560 0 L 520 320 M 0 170 L 640 150" stroke="#FFFFFF" stroke-width="9"/>
          <rect x="140" y="110" width="70" height="40" rx="6" fill="#D6E3D2"/><rect x="300" y="170" width="90" height="40" rx="6" fill="#D6E3D2"/><rect x="470" y="70" width="60" height="50" rx="6" fill="#D6E3D2"/>
          <path d="M90 60 L 110 165 L 245 160 L 440 155 L 455 255" stroke="#0B6E4F" stroke-width="5" stroke-dasharray="2 10" stroke-linecap="round" fill="none"/>
          <circle cx="90" cy="60" r="10" fill="#10241C"/>
          <g transform="translate(455 255)"><circle r="20" fill="#FF7A1A" opacity="0.2"/><path d="M0-22c-9 0-15 6-15 14 0 10 15 24 15 24s15-14 15-24c0-8-6-14-15-14z" fill="#FF7A1A" transform="translate(0 -8)"/><circle cy="-16" r="5" fill="#FFFFFF"/></g>
          <g transform="translate(280 160)"><circle r="22" fill="#0B6E4F" opacity="0.18"/><circle r="15" fill="#0B6E4F"/><path d="M-7-3h8v7h-8zM1 0h4l2 3v1H1z" fill="#FFFFFF"/></g>
        </svg>
      </div>
      <div class="delivery-cards">
        <div class="delivery-driver">
          <span class="driver-avatar">T</span>
          <span style="display:flex;flex-direction:column"><span style="font-weight:600">Tom is driving</span><span style="font-size:14px;color:#5F6B64">Electric van &middot; FreshCart West</span></span>
        </div>
        <div class="delivery-eta">
          <span class="eta-label">Arriving around</span>
          <span class="eta-time">${getETA()}</span>
          <span class="eta-stops">2 stops away</span>
        </div>
      </div>
    </div>
  `;
}

function renderDeliveredView() {
  const view = document.getElementById("viewDelivered");
  view.style.display = "block";

  const order = currentOrders.find(o => o.status === "delivered") || currentOrders[0];
  const total = order ? "$" + (order.subtotal || 0).toFixed(2) : "$0.00";
  const count = order ? (order.item_count || 0) + " items" : "0 items";

  view.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:18px;padding:24px 6px">
      <span class="delivered-check">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>
      </span>
      <span class="delivered-heading">From shopping list to doorstep, all in one chat.</span>
      <div class="delivered-stats">
        <span class="delivered-stat">${count}</span>
        <span class="delivered-stat">${total} paid</span>
      </div>
    </div>
  `;
}

function getETA() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 25);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Order Summary Sidebar ───────────────────────────────────── */
function renderOrderSummary() {
  const order = currentOrders.find(o => o.status !== "delivered") || currentOrders[0];
  const items = order?.items || _cartItems || [];

  const titleEl = document.getElementById("summaryTitle");
  const countEl = document.getElementById("itemCount");
  const emptyEl = document.getElementById("summaryEmpty");
  const itemsEl = document.getElementById("summaryItems");
  const totalsEl = document.getElementById("summaryTotals");
  const detailsEl = document.getElementById("summaryDetails");

  titleEl.textContent = order ? "Order summary" : "Your basket";
  countEl.textContent = items.length ? items.length + " items" : "";

  if (!items.length) {
    emptyEl.style.display = "block";
    itemsEl.innerHTML = "";
    totalsEl.style.display = "none";
    detailsEl.style.display = "none";
    return;
  }

  emptyEl.style.display = "none";

  itemsEl.innerHTML = items.map(item => {
    const unitPrice = item.unit_price || item.price || 0;
    const qty = item.quantity || item.qty || 1;
    return `
    <span class="summary-line">
      <span>${qty} &times; ${escapeHtml(item.product_name || item.name || "")}</span>
      <span class="amount">$${(item.subtotal || unitPrice * qty).toFixed(2)}</span>
    </span>
  `;}).join("");

  const subtotal = items.reduce((s, i) => s + (i.subtotal || (i.unit_price || i.price || 0) * (i.quantity || i.qty || 1)), 0);
  const fee = order ? 2.95 : 0;
  const total = subtotal + fee;

  totalsEl.style.display = "flex";
  totalsEl.innerHTML = `
    <div class="summary-totals">
      <span class="row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></span>
      ${order ? `<span class="row"><span>Delivery</span><span>$${fee.toFixed(2)}</span></span>` : ""}
      <span class="total-row"><span>Total</span><span>$${total.toFixed(2)}</span></span>
    </div>
  `;

  if (order) {
    detailsEl.style.display = "flex";
    detailsEl.style.flexDirection = "column";
    detailsEl.style.gap = "8px";
    detailsEl.style.paddingTop = "4px";
    detailsEl.innerHTML = `
      <span class="summary-detail"><span class="detail-label">Delivery</span><span class="detail-value">${escapeHtml(order.slot_label || "TBD")}</span></span>
      <span class="summary-detail"><span class="detail-label">Status</span><span class="detail-value">${escapeHtml(formatStatus(order.status))}</span></span>
    `;
  } else {
    detailsEl.style.display = "none";
  }
}

function formatStatus(status) {
  const labels = {
    confirmed: "Confirmed",
    picking: "Packing",
    packed: "Packed",
    out_for_delivery: "On the way",
    delivered: "Delivered",
  };
  return labels[status] || status;
}

/* ── Advance Button ──────────────────────────────────────────── */
function renderAdvanceBtn() {
  const btn = document.getElementById("advanceBtn");
  const activeOrder = currentOrders.find(o => o.status !== "delivered");
  if (activeOrder) {
    btn.style.display = "inline-flex";
    const next = {
      confirmed: "Start picking",
      picking: "Mark packed",
      packed: "Send out",
      out_for_delivery: "Mark delivered",
    };
    btn.textContent = next[activeOrder.status] || "Advance";
  } else {
    btn.style.display = "none";
  }
}

function advanceActiveOrder() {
  const activeOrder = currentOrders.find(o => o.status !== "delivered");
  if (!activeOrder) return;
  fetch(`/api/orders/${activeOrder.id}/advance`, { method: "POST" })
    .then(r => r.json())
    .then(() => {
      loadOrders();
      addFeedItem("Order advanced", "#13A36E");
    })
    .catch(() => {});
}

/* ── Cart Loading ────────────────────────────────────────────── */
let _cartItems = [];

function loadCart() {
  if (!selectedPhone) return;
  fetch("/api/cart/" + encodeURIComponent(selectedPhone))
    .then(r => r.json())
    .then(data => {
      _cartItems = data.items || [];
      recomputeStage();
    })
    .catch(() => {});
}

/* ── Order Loading ───────────────────────────────────────────── */
function loadOrders() {
  const params = new URLSearchParams();
  if (selectedPhone) params.set("phone", selectedPhone);
  fetch("/api/orders?" + params)
    .then(r => r.json())
    .then(async (data) => {
      const orders = data.orders || [];
      // Fetch items for each order (the list endpoint doesn't include them)
      for (const o of orders) {
        if (!o.items) {
          try {
            const detail = await fetch("/api/orders/" + o.id).then(r => r.json());
            o.items = detail.order?.items || [];
          } catch { o.items = []; }
        }
      }
      currentOrders = orders;
      recomputeStage();
    })
    .catch(() => {});
}

/* ── Substitutions ───────────────────────────────────────────── */
function loadSubstitutions() {
  fetch("/api/substitutions")
    .then(r => r.json())
    .then(data => {
      currentSubs = data.substitutions || [];
      recomputeStage();
    })
    .catch(() => {});
}

/* ── Utilities ────────────────────────────────────────────────── */
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ── Conversation Polling ─────────────────────────────────────── */
let _lastMsgTs = "";
let _seenMsgKeys = new Set();

function pollConversations() {
  const params = new URLSearchParams();
  if (_lastMsgTs) { params.set("since", _lastMsgTs); params.set("limit", "20"); }
  else { params.set("limit", "30"); }
  if (selectedPhone) params.set("phone", selectedPhone);
  fetch("/api/conversations?" + params).then(r => r.json()).then(data => {
    const msgs = data.messages || [];
    for (const m of msgs) {
      if (m.timestamp > _lastMsgTs) _lastMsgTs = m.timestamp;
      const tsBucket = (m.timestamp || "").slice(0, 16);
      const key = (m.customer_phone || "") + "|" + m.role + "|" + tsBucket + "|" + m.content.slice(0, 80);
      if (_seenMsgKeys.has(key)) continue;
      _seenMsgKeys.add(key);
      addChatBubble({
        direction: m.role === "user" ? "inbound" : "outbound",
        from: m.customer_phone,
        text: m.content,
      });
    }
    if (_seenMsgKeys.size > 500) _seenMsgKeys = new Set([..._seenMsgKeys].slice(-200));
  }).catch(() => {});
}

/* ── UI Event Polling ─────────────────────────────────────────── */
let _lastUiEventTs = "";
let _seenUiEventIds = new Set();

function pollUiEvents() {
  const url = _lastUiEventTs
    ? `/api/ui-events?since=${encodeURIComponent(_lastUiEventTs)}`
    : "/api/ui-events";
  fetch(url).then(r => r.json()).then(data => {
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

/* ── New Chat / Reset ─────────────────────────────────────────── */
function newChat() {
  if (!selectedPhone) return;
  const qs = "?phone=" + encodeURIComponent(selectedPhone);
  fetch("/api/conversations" + qs, { method: "DELETE" })
    .then(r => r.json())
    .then(() => {
      const chatArea = document.getElementById("chatArea");
      chatArea.innerHTML =
        '<span class="chat-system">Chat with Mia, FreshCart\'s shopping assistant.</span>' +
        '<div class="chat-empty" id="chatEmpty">Send a WhatsApp message to<br>start shopping</div>';
      _lastMsgTs = "";
      _seenMsgKeys = new Set();
      _lastUiEventTs = "";
      _seenUiEventIds = new Set();
      _lastProdEvtKey = "";
      hasChatMessages = false;
      _cartItems = [];
      currentOrders = [];
      currentSubs = [];
      activityFeed = [];
      currentStage = "idle";
      showTyping(false);
      renderFeed();
      renderProgress();
      renderStageCanvas();
      renderStageHead();
      renderOrderSummary();
      renderAdvanceBtn();
      loadOrders();
      loadSubstitutions();
    });
}

function resetDemo() {
  newChat();
}

/* ── Init ─────────────────────────────────────────────────────── */
loadConfig().then(() => {
  checkWelcome();
  renderProgress();
  renderFeed();
});

setInterval(() => { if (currentCustomer) loadOrders(); }, 15000);
setInterval(() => { if (currentCustomer) pollConversations(); }, 3000);
setInterval(() => { if (currentCustomer) pollUiEvents(); }, 3000);
setInterval(() => { if (currentCustomer) loadSubstitutions(); }, 15000);
setInterval(() => { if (currentCustomer) loadCart(); }, 10000);
