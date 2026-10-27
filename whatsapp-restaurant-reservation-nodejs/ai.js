// AI inference loop — system prompt, tool definitions, tool executor.
import crypto from "node:crypto";
import { setting } from "./settings.js";
import { sendText, sendList, sendButtons } from "./whatsapp.js";
import { searchRestaurants } from "./restaurants.js";

const INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions";

// ---------------------------------------------------------------------------
// Table inventory — 6 tables, fixed time slots
// ---------------------------------------------------------------------------
export const TABLES = [
  { id: 1, seats: 2, label: "T1" },
  { id: 2, seats: 2, label: "T2" },
  { id: 3, seats: 4, label: "T3" },
  { id: 4, seats: 4, label: "T4" },
  { id: 5, seats: 6, label: "T5" },
  { id: 6, seats: 8, label: "T6" },
];

export const TIME_SLOTS = [
  "17:30", "18:00", "18:30", "19:00",
  "19:30", "20:00", "20:30", "21:00",
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

  return `You are a friendly restaurant reservation assistant. You help customers browse restaurants and book tables via WhatsApp. You can find restaurants in any city — just ask the customer where they'd like to dine.

Today's date is ${dateStr} (${dayName}).

Available time slots: ${TIME_SLOTS.join(", ")}

CRITICAL RULES:
- ALWAYS use the send_whatsapp tool to reply to the customer. NEVER put your reply in a plain text response — it MUST go through send_whatsapp. Every turn must end with exactly one send_whatsapp call.
- Send EXACTLY ONE WhatsApp message per turn. After calling send_whatsapp, STOP. Do not call send_whatsapp again — wait for the customer to reply.
- You may call search_restaurants, check_availability, or other data tools multiple times before sending your ONE message via send_whatsapp.
- Keep messages short — this is WhatsApp, not email. 1-3 sentences max.
- Always use send_whatsapp with message_type="text" — do NOT use "list" or "buttons" message types.

Conversation flow:
1. Customer says hi → Greet them and ask what they're looking for. Call send_whatsapp with your greeting.
2. Customer mentions a restaurant or cuisine → ALWAYS call search_restaurants first (even if you discussed it before), then call send_whatsapp with the match and ask for date and party size.
3. Customer provides details → Use check_availability, then call send_whatsapp with available times.
4. Customer picks a time → Use make_reservation to book it, then call send_whatsapp with confirmation.
5. If the customer wants to cancel → Use get_customer_reservations, then cancel_reservation, then call send_whatsapp to confirm cancellation.

IMPORTANT: ALWAYS call search_restaurants whenever the customer asks about a specific restaurant, even if you already discussed it earlier in the conversation. This keeps the dashboard in sync.

Other guidelines:
- NEVER invent or guess the customer's name. You only know their phone number. If you need their name, ask them. Until they tell you, do not use any name.
- Default to today's date if the customer says "tonight" or "today"
- Parse relative dates: "tomorrow", "this Friday", "next week", etc.
- If a voice note transcription is provided, respond naturally to its content`;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description: "Search for restaurants by name or cuisine in a given city. If no cached results exist, fetches live data from Google Places. Always pass the city when the customer mentions a location.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — restaurant name or cuisine type" },
          city: { type: "string", description: "City or area to search in" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Check available time slots for a specific restaurant on a given date and party size.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string", description: "Restaurant ID" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          party_size: { type: "integer", description: "Number of guests" },
        },
        required: ["restaurant_id", "date", "party_size"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "make_reservation",
      description: "Create a confirmed restaurant reservation.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string", description: "Restaurant ID" },
          customer_phone: { type: "string", description: "Customer phone in E.164 format" },
          customer_name: { type: "string", description: "Customer name (if known)" },
          party_size: { type: "integer", description: "Number of guests" },
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          time: { type: "string", description: "Time slot (e.g. '19:00')" },
          notes: { type: "string", description: "Special requests or notes" },
        },
        required: ["restaurant_id", "customer_phone", "party_size", "date", "time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_reservation",
      description: "Cancel an existing reservation by ID.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: { type: "string", description: "Reservation ID to cancel" },
        },
        required: ["reservation_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_reservations",
      description: "Get all upcoming reservations for a customer by phone number.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Customer phone in E.164 format" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_whatsapp",
      description: "Send a WhatsApp message to the customer. Supports text, interactive list, and interactive button messages.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient phone number in E.164 format" },
          message_type: {
            type: "string",
            enum: ["text", "list", "buttons"],
            description: "Message type",
          },
          text: { type: "string", description: "Message body text" },
          button_text: { type: "string", description: "For list messages: the button text" },
          sections: { type: "array", description: "For list messages: sections with selectable rows" },
          buttons: { type: "array", description: "For button messages: quick reply buttons (max 3)" },
        },
        required: ["to", "message_type", "text"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Inference call
// ---------------------------------------------------------------------------
async function callInference(messages) {
  const resp = await fetch(INFERENCE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${setting("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: setting("AI_MODEL") || "THUDM/GLM3-flash",
      messages,
      tools: TOOLS,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`Inference failed: ${resp.status}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Conversation & reservation helpers (DB operations)
// ---------------------------------------------------------------------------
async function storeMessage(db, phone, role, content) {
  await db.prepare(
    "INSERT INTO conversations (id, customer_phone, role, content, timestamp) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), phone, role, content, new Date().toISOString()).run();
}

async function getConversationHistory(db, phone, limit = 20) {
  const { results } = await db.prepare(
    "SELECT role, content, timestamp FROM conversations WHERE customer_phone = ? ORDER BY timestamp DESC LIMIT ?"
  ).bind(phone, limit).all();
  return results.reverse();
}

async function getReservationsForPhone(db, phone) {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await db.prepare(
    `SELECT r.*, rest.name as restaurant_name FROM reservations r
     LEFT JOIN restaurants rest ON r.restaurant_id = rest.id
     WHERE r.customer_phone = ? AND r.date >= ? AND r.status != 'cancelled'
     ORDER BY r.date, r.time`
  ).bind(phone, today).all();
  return results;
}

async function checkAvailability(db, restaurantId, dateStr, partySize) {
  partySize = Number(partySize);
  const { results: booked } = await db.prepare(
    `SELECT time, party_size FROM reservations
     WHERE restaurant_id = ? AND date = ? AND status IN ('pending', 'confirmed')`
  ).bind(restaurantId, dateStr).all();

  const bookedTimes = {};
  for (const row of booked) {
    if (!bookedTimes[row.time]) bookedTimes[row.time] = [];
    bookedTimes[row.time].push(row.party_size);
  }

  const available = [];
  for (const slot of TIME_SLOTS) {
    const bookedAtSlot = bookedTimes[slot] || [];
    const bookedCount = bookedAtSlot.length;
    if (bookedCount < TABLES.length && TABLES.some((t) => t.seats >= partySize)) {
      available.push(slot);
    }
  }
  return available;
}

async function makeReservation(db, ssePublish, { restaurantId, customerPhone, customerName, partySize, date, time, notes }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO reservations (id, restaurant_id, customer_phone, customer_name,
     party_size, date, time, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,'confirmed',?,?,?)`
  ).bind(id, restaurantId, customerPhone, customerName || "", Number(partySize), date, time, notes || "", now, now).run();

  const row = await db.prepare(
    `SELECT r.*, rest.name as restaurant_name FROM reservations r
     LEFT JOIN restaurants rest ON r.restaurant_id = rest.id WHERE r.id = ?`
  ).bind(id).first();

  const reservation = row || { id };
  ssePublish("reservation.new", { reservation });
  return reservation;
}

async function cancelReservation(db, ssePublish, reservationId) {
  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?"
  ).bind(now, reservationId).run();

  const row = await db.prepare(
    `SELECT r.*, rest.name as restaurant_name FROM reservations r
     LEFT JOIN restaurants rest ON r.restaurant_id = rest.id WHERE r.id = ?`
  ).bind(reservationId).first();

  const reservation = row || { id: reservationId };
  ssePublish("reservation.update", { reservation });
  return reservation;
}

// ---------------------------------------------------------------------------
// Persist a UI event to the database so dashboard instances on other Edge
// pods can pick it up via polling (SSE is per-instance).
async function persistUiEvent(db, type, payload) {
  try {
    await db.prepare(
      "INSERT INTO ui_events (id, type, payload, created_at) VALUES (?,?,?,?)"
    ).bind(crypto.randomUUID(), type, JSON.stringify(payload), new Date().toISOString()).run();
  } catch (err) { console.warn("persistUiEvent failed:", err.message); }
}

// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(db, ssePublish, toolName, toolInput, customerPhone) {
  if (toolName === "search_restaurants") {
    const city = toolInput.city;
    const results = await searchRestaurants(db, toolInput.query || "", city);
    const evt = { city: city || "", query: toolInput.query || "" };
    ssePublish("restaurant.search", evt);
    await persistUiEvent(db, "restaurant.search", evt);
    // Also fire restaurant.selected for the top result so the dashboard highlights it
    if (results.length && results[0].id) {
      const selEvt = { restaurant_id: results[0].id, city: city || "" };
      ssePublish("restaurant.selected", selEvt);
      await persistUiEvent(db, "restaurant.selected", selEvt);
    }
    return JSON.stringify({ restaurants: results });
  }

  if (toolName === "check_availability") {
    const slots = await checkAvailability(db, toolInput.restaurant_id, toolInput.date, toolInput.party_size || 2);
    return JSON.stringify({ available_slots: slots, date: toolInput.date });
  }

  if (toolName === "make_reservation") {
    const reservation = await makeReservation(db, ssePublish, {
      restaurantId: toolInput.restaurant_id,
      customerPhone: toolInput.customer_phone || customerPhone,
      customerName: toolInput.customer_name || "",
      partySize: toolInput.party_size,
      date: toolInput.date,
      time: toolInput.time,
      notes: toolInput.notes || "",
    });
    // Look up city for UI sync
    let restCity = "";
    try {
      const row = await db.prepare("SELECT city, address FROM restaurants WHERE id = ?").bind(toolInput.restaurant_id).first();
      if (row) restCity = row.city || "";
    } catch { /* ignore */ }
    const selEvt = { restaurant_id: toolInput.restaurant_id, city: restCity };
    ssePublish("restaurant.selected", selEvt);
    await persistUiEvent(db, "restaurant.selected", selEvt);
    return JSON.stringify({ reservation });
  }

  if (toolName === "cancel_reservation") {
    const reservation = await cancelReservation(db, ssePublish, toolInput.reservation_id);
    return JSON.stringify({ reservation });
  }

  if (toolName === "get_customer_reservations") {
    const reservations = await getReservationsForPhone(db, toolInput.phone);
    return JSON.stringify({ reservations });
  }

  if (toolName === "send_whatsapp") {
    const to = toolInput.to;
    const msgType = toolInput.message_type || "text";
    const text = toolInput.text || "";

    try {
      if (msgType === "list") {
        await sendList(to, text, toolInput.button_text || "Select", toolInput.sections || []);
      } else if (msgType === "buttons") {
        await sendButtons(to, text, toolInput.buttons || []);
      } else {
        await sendText(to, text);
      }
    } catch (err) {
      console.warn(`WhatsApp send failed (${msgType}), falling back to text:`, err.message);
      if (msgType !== "text") await sendText(to, text);
    }

    await storeMessage(db, to, "assistant", text);
    ssePublish("channel.whatsapp", {
      direction: "outbound",
      text,
      to,
      message_type: msgType,
    });
    return JSON.stringify({ status: "sent", message_type: msgType });
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` });
}

// ---------------------------------------------------------------------------
// Main agentic loop — exported for the webhook handler
// ---------------------------------------------------------------------------
export async function processInbound(db, ssePublish, fromNumber, text) {
  const history = await getConversationHistory(db, fromNumber);
  const historyText = history.map((m) => `${m.role}: ${m.content}`).join("\n");

  const reservations = await getReservationsForPhone(db, fromNumber);
  let resText = "";
  if (reservations.length) {
    resText = "\nCustomer's upcoming reservations:\n" + reservations.map((r) =>
      `  #${r.id}: ${r.restaurant_name || r.restaurant_id} on ${r.date} at ${r.time} (party of ${r.party_size}, status: ${r.status})`
    ).join("\n");
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: `Customer phone: ${fromNumber}\nInbound WhatsApp message: ${text}\n\nConversation history:\n${historyText}\n${resText}\n\nHandle this message. Use your tools to search restaurants, check availability, and make reservations as needed. Always send a WhatsApp response.`,
    },
  ];

  ssePublish("agent.thinking", { content: `Processing message from ${fromNumber}...` });

  for (let i = 0; i < 10; i++) {
    let data;
    try {
      data = await callInference(messages);
    } catch (err) {
      console.error("Inference failed:", err.message);
      ssePublish("agent.error", { error: err.message });
      try {
        await sendText(fromNumber, "Sorry, I'm having trouble processing your request right now. Please try again in a moment.");
      } catch { /* ignore */ }
      return;
    }

    const choice = data.choices[0];
    const msg = choice.message;

    if (msg.content) ssePublish("agent.thinking", { content: msg.content });

    if (!msg.tool_calls) {
      // No more tools — send text if present
      if (msg.content) {
        try {
          await sendText(fromNumber, msg.content);
          await storeMessage(db, fromNumber, "assistant", msg.content);
          ssePublish("channel.whatsapp", {
            direction: "outbound",
            text: msg.content,
            to: fromNumber,
            message_type: "text",
          });
        } catch (err) {
          console.error("Auto-send failed:", err.message);
          ssePublish("agent.error", { error: err.message });
        }
      }
      ssePublish("agent.done", { content: "Message sent" });
      break;
    }

    messages.push(msg);
    let messageSent = false;

    for (const tc of msg.tool_calls) {
      const fn = tc.function;
      const toolName = fn.name;
      let toolInput;
      try {
        const raw = fn.arguments || "{}";
        toolInput = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (typeof toolInput !== "object" || toolInput === null) toolInput = {};
      } catch {
        toolInput = {};
      }

      ssePublish("agent.tool_call", { tool: toolName, input: toolInput });
      const result = await executeTool(db, ssePublish, toolName, toolInput, fromNumber);
      ssePublish("agent.tool_result", { tool: toolName, result });

      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      if (toolName === "send_whatsapp") messageSent = true;
    }

    if (messageSent) {
      ssePublish("agent.done", { content: "Message sent, waiting for reply" });
      break;
    }
  }
}

// Export helpers that server.js needs directly
export { storeMessage, getReservationsForPhone, checkAvailability, makeReservation, cancelReservation };
