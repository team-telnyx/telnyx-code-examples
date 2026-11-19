// AI inference loop — Mia system prompt, tool definitions, tool executor.
import crypto from "node:crypto";
import { setting } from "./settings.js";
import { sendText, sendList, sendButtons } from "./whatsapp.js";
import { searchProducts, getProductByName, getSpecials, CATEGORIES } from "./products.js";
import {
  getCart, addToCart, updateCartItem, cartTotal, clearCart,
  getAvailableSlots, placeOrder, getActiveOrders, getOrdersForPhone,
  getOrderById, rescheduleOrder, getPendingSubstitutions, resolveSubstitution,
  reorderFromOrder, ORDER_STATUSES, statusLabel,
} from "./orders.js";

const INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });
  const categoryList = CATEGORIES.map((c) => `${c.emoji} ${c.name}`).join(", ");

  return `You are Mia, a warm, friendly, and relaxed AI grocery delivery assistant for FreshCart. You help customers browse products, build their cart, place orders, and manage deliveries via WhatsApp. You're cheerful, casual, and genuinely helpful — like a friend who works at the grocery store.

Today is ${dateStr} (${dayName}).

Product categories: ${categoryList}

CRITICAL RULES:
- ALWAYS use the send_whatsapp tool to reply to the customer. NEVER put your reply in a plain text response — it MUST go through send_whatsapp. Every turn must end with exactly one send_whatsapp call.
- Send EXACTLY ONE WhatsApp message per turn. After calling send_whatsapp, STOP. Do not call send_whatsapp again.
- You may call browse_products, view_cart, add_to_cart, or other data tools multiple times before sending your ONE message via send_whatsapp.
- Keep messages short and conversational — this is WhatsApp, not email. 1-3 sentences max.
- Always use send_whatsapp with message_type="text" — do NOT use "list" or "buttons" message types.

PRODUCT FLEXIBILITY — VERY IMPORTANT:
- This is a demo grocery store with a FULL catalog. If a customer asks for ANY grocery item — even if browse_products returns no results — you can ALWAYS add it to their cart using add_to_cart. The tool will handle adding it.
- NEVER tell a customer "we don't have that" or "that's not in our catalog." FreshCart carries everything. If they ask for Nutrilon baby formula, wagyu steak, truffle oil, or any grocery item — just add it.
- Only decline requests for things that are clearly NOT groceries (e.g. a car, furniture, electronics).
- When a customer asks for ONE item, call add_to_cart ONCE with quantity 1. Do NOT create multiple variations of the same product. "Formula milk for 6+ months baby" = one add_to_cart call, not two.

Voice notes:
- When you receive a voice note transcription (prefixed with [Voice note transcription]:), parse the items mentioned and use add_to_cart to add each one. Be smart about quantities — "a dozen eggs" means quantity 1 of "Free Range Eggs", "2 bananas" means quantity 2 of bananas.

Conversation flow:
1. Customer says hi → Greet them warmly and naturally. Mention you can help them shop, check specials, or manage orders.
2. Customer wants to browse → Call browse_products with their query or category, then share results.
3. Customer wants to add items → Call add_to_cart for each item, then confirm what was added.
4. Customer wants to checkout → Show cart with view_cart, then offer delivery slots with get_delivery_slots, then place_order.
5. Customer asks about an order → Call track_delivery, respond with status.
6. Customer wants to reschedule → Call get_delivery_slots for options, then reschedule_delivery.
7. Out-of-stock substitution → Call handle_substitution with the customer's choice.
8. Customer wants to reorder → Call reorder to populate cart from a previous order.

Personality:
- Be warm, casual, and human. Use natural language, not corporate speak.
- Use emojis sparingly but naturally — 1-2 per message max.
- Mention specials and deals when relevant.
- Be helpful with dietary preferences — mention tags like organic, vegan, gluten-free.
- When showing cart, include a clear total.
- NEVER invent or guess the customer's name. If you need their name, ask them.`;
}

// ---------------------------------------------------------------------------
// Tool definitions (12 tools)
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: "function",
    function: {
      name: "browse_products",
      description: "Search or browse products by category or keyword. Returns matching in-stock products with prices and dietary tags.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — product name, category, or keyword like 'organic' or 'vegan'" },
          category: { type: "string", description: "Category ID to filter by: fruits, vegetables, dairy, bakery, meat, pantry, beverages, snacks, frozen" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Add a product to the customer's cart. Supports bulk adds from voice notes. If the exact product is not found, suggests close matches.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Name of the product to add (partial match supported)" },
          quantity: { type: "integer", description: "Number of units to add (default: 1)" },
        },
        required: ["product_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "view_cart",
      description: "Show the customer's current cart contents with itemized prices and total.",
      parameters: {
        type: "object",
        properties: {
          customer_phone: { type: "string", description: "Customer phone in E.164 format" },
        },
        required: ["customer_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_cart",
      description: "Change quantity of an item in the cart or remove it (set quantity to 0 to remove).",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Name of the product to update" },
          quantity: { type: "integer", description: "New quantity (0 to remove)" },
        },
        required: ["product_name", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_delivery_slots",
      description: "Get available delivery windows for the next few days.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "place_order",
      description: "Checkout — convert the cart into an order with a chosen delivery slot.",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string", description: "Delivery slot ID from get_delivery_slots" },
        },
        required: ["slot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "track_delivery",
      description: "Get the current delivery status and ETA for the customer's active orders.",
      parameters: {
        type: "object",
        properties: {
          customer_phone: { type: "string", description: "Customer phone in E.164 format" },
        },
        required: ["customer_phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_delivery",
      description: "Change the delivery window for an active order.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Order ID to reschedule" },
          new_slot_id: { type: "string", description: "New delivery slot ID" },
        },
        required: ["order_id", "new_slot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "handle_substitution",
      description: "Respond to an out-of-stock substitution: accept the substitute, reject it, or remove the item entirely.",
      parameters: {
        type: "object",
        properties: {
          substitution_id: { type: "string", description: "Substitution ID" },
          action: { type: "string", enum: ["accept", "reject", "remove"], description: "What to do: accept substitute, reject and keep original, or remove from order" },
        },
        required: ["substitution_id", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reorder",
      description: "Reorder items from a previous delivery — populates the cart with items from a past order.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Previous order ID to reorder from" },
        },
        required: ["order_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "register_customer",
      description: "Register a new customer with their name and delivery address. Validates phone via Telnyx Number Lookup.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Customer phone in E.164 format" },
          name: { type: "string", description: "Customer name" },
          address: { type: "string", description: "Delivery address" },
        },
        required: ["phone", "name"],
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
// Conversation helpers
// ---------------------------------------------------------------------------
export async function storeMessage(db, phone, role, content) {
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

// ---------------------------------------------------------------------------
// Persist a UI event to the database for cross-instance polling
// ---------------------------------------------------------------------------
async function persistUiEvent(db, type, payload) {
  try {
    await db.prepare(
      "INSERT INTO ui_events (id, type, payload, created_at) VALUES (?,?,?,?)"
    ).bind(crypto.randomUUID(), type, JSON.stringify(payload), new Date().toISOString()).run();
  } catch (err) { console.warn("persistUiEvent failed:", err.message); }
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------
async function executeTool(db, ssePublish, toolName, toolInput, customerPhone) {
  if (toolName === "browse_products") {
    const results = await searchProducts(db, toolInput.query || "", toolInput.category || "");
    const evt = { query: toolInput.query || "", category: toolInput.category || "", customer_phone: customerPhone };
    ssePublish("product.search", evt);
    await persistUiEvent(db, "product.search", evt);
    if (results.length) {
      const selEvt = { product_id: results[0].id, customer_phone: customerPhone };
      ssePublish("product.selected", selEvt);
      await persistUiEvent(db, "product.selected", selEvt);
    }
    return JSON.stringify({
      products: results.map((p) => ({
        id: p.id, name: p.name, price: p.price, unit: p.unit,
        on_sale: p.on_sale, sale_price: p.sale_price,
        category: p.category_name, dietary_tags: p.dietary_tags,
        in_stock: p.in_stock,
      })),
    });
  }

  if (toolName === "add_to_cart") {
    const name = toolInput.product_name;
    const qty = toolInput.quantity || 1;

    // Find the product by name (fuzzy match)
    let product = await getProductByName(db, name);
    if (!product) {
      // Try partial search
      const results = await searchProducts(db, name);
      if (results.length === 1) {
        product = results[0];
      } else if (results.length > 1) {
        // If multiple matches, pick the best one instead of blocking
        product = results[0];
      } else {
        // Product not in catalog — create an ad-hoc product for the demo
        const id = crypto.randomUUID();
        const price = parseFloat((3 + Math.random() * 12).toFixed(2)); // $3-$15
        const now = new Date().toISOString();
        await db.prepare(
          "INSERT INTO products (id, category_id, name, description, price, unit, image_url, in_stock, on_sale, sale_price, dietary_tags, created_at) VALUES (?,?,?,?,?,?,?,1,0,NULL,?,?)"
        ).bind(id, "pantry", name, "", price, "each", "", "", now).run();
        product = { id, name, price, unit: "each", on_sale: 0, sale_price: null };
        console.log(`[product] Created ad-hoc product: ${name} ($${price})`);
      }
    }

    const item = await addToCart(db, customerPhone, product, qty);
    ssePublish("cart.update", { customer_phone: customerPhone, action: "add", product_name: product.name, quantity: qty });
    return JSON.stringify({
      added: { product_name: product.name, quantity: qty, unit_price: item.unit_price, unit: product.unit },
    });
  }

  if (toolName === "view_cart") {
    const phone = toolInput.customer_phone || customerPhone;
    const items = await getCart(db, phone);
    const total = cartTotal(items);
    return JSON.stringify({
      cart_items: items.map((i) => ({
        product_name: i.product_name, quantity: i.quantity,
        unit_price: i.unit_price, subtotal: (i.quantity * i.unit_price).toFixed(2),
      })),
      total: total.toFixed(2),
      item_count: items.length,
    });
  }

  if (toolName === "update_cart") {
    const result = await updateCartItem(db, customerPhone, toolInput.product_name, toolInput.quantity);
    ssePublish("cart.update", { customer_phone: customerPhone, action: result.removed ? "remove" : "update", product_name: toolInput.product_name });
    return JSON.stringify(result);
  }

  if (toolName === "get_delivery_slots") {
    const slots = await getAvailableSlots(db);
    return JSON.stringify({
      slots: slots.map((s) => ({
        id: s.id, label: s.label, date: s.date,
        time_start: s.time_start, time_end: s.time_end,
        available: s.capacity - s.booked,
      })),
    });
  }

  if (toolName === "place_order") {
    const order = await placeOrder(db, ssePublish, customerPhone, toolInput.slot_id);
    if (order.error) return JSON.stringify({ error: order.error });
    return JSON.stringify({
      order_id: order.id, status: order.status,
      subtotal: order.subtotal, item_count: order.item_count,
      delivery: order.slot_label,
    });
  }

  if (toolName === "track_delivery") {
    const phone = toolInput.customer_phone || customerPhone;
    const orders = await getActiveOrders(db, phone);
    if (!orders.length) return JSON.stringify({ message: "No active orders found." });

    const tracked = [];
    for (const o of orders) {
      const full = await getOrderById(db, o.id);
      const pipeline = ORDER_STATUSES.map((s) => ({
        step: statusLabel(s),
        current: s === o.status,
        completed: ORDER_STATUSES.indexOf(s) < ORDER_STATUSES.indexOf(o.status),
      }));
      const pendingSubs = (full.substitutions || []).filter((s) => s.status === "pending");
      tracked.push({
        order_id: o.id, status: statusLabel(o.status), pipeline,
        delivery: o.slot_label, subtotal: o.subtotal, item_count: o.item_count,
        pending_substitutions: pendingSubs.map((s) => ({
          id: s.id, original: s.original_item, suggested: s.suggested_item, price_diff: s.price_diff,
        })),
      });
    }
    return JSON.stringify({ orders: tracked });
  }

  if (toolName === "reschedule_delivery") {
    const result = await rescheduleOrder(db, ssePublish, toolInput.order_id, toolInput.new_slot_id);
    if (result.error) return JSON.stringify({ error: result.error });
    return JSON.stringify({
      order_id: result.id, new_delivery: result.slot_label, status: result.status,
    });
  }

  if (toolName === "handle_substitution") {
    const result = await resolveSubstitution(db, ssePublish, toolInput.substitution_id, toolInput.action);
    if (result.error) return JSON.stringify({ error: result.error });
    return JSON.stringify({
      substitution_id: result.id, status: result.status,
      original: result.original_item, suggested: result.suggested_item,
    });
  }

  if (toolName === "reorder") {
    const result = await reorderFromOrder(db, customerPhone, toolInput.order_id);
    if (result.error) return JSON.stringify({ error: result.error });
    ssePublish("cart.update", { customer_phone: customerPhone, action: "reorder", items_added: result.items_added });
    return JSON.stringify({
      items_added: result.items_added,
      items: result.items.map((i) => ({ product_name: i.product_name, quantity: i.quantity })),
    });
  }

  if (toolName === "register_customer") {
    // Validate phone via Telnyx Number Lookup API
    const apiKey = setting("TELNYX_API_KEY");
    if (apiKey) {
      try {
        const nlResp = await fetch(
          `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(toolInput.phone)}`,
          { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
        );
        if (nlResp.ok) {
          const nlData = await nlResp.json();
          if (nlData.data && nlData.data.valid_number === false) {
            return JSON.stringify({ error: "invalid_phone", message: "The phone number is not valid. Ask the customer to provide a valid phone number with country code." });
          }
        }
      } catch { /* If lookup fails, proceed with registration */ }
    }

    const now = new Date().toISOString();
    await db.prepare(
      "INSERT OR REPLACE INTO customers (phone, name, address, created_at) VALUES (?,?,?,?)"
    ).bind(toolInput.phone, toolInput.name, toolInput.address || "", now).run();
    ssePublish("customer.registered", { phone: toolInput.phone, name: toolInput.name });
    return JSON.stringify({ status: "registered", name: toolInput.name });
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
// Main agentic loop
// ---------------------------------------------------------------------------
export async function processInbound(db, ssePublish, fromNumber, text) {
  const history = await getConversationHistory(db, fromNumber);
  const historyText = history.map((m) => `${m.role}: ${m.content}`).join("\n");

  // Check customer registration
  const customer = await db.prepare("SELECT phone, name, address FROM customers WHERE phone = ?").bind(fromNumber).first();
  let customerContext = "";
  if (!customer) {
    customerContext = "\n\nThis customer hasn't set up their profile yet. You can still help them browse and add items to cart right away — no need to block them. At some natural point in the conversation (e.g. before checkout), casually ask for their name and address so you can register them with register_customer. Don't make it a barrier.";
  } else {
    customerContext = `\n\nCustomer name: ${customer.name}. Delivery address: ${customer.address || "not set"}.`;
  }

  // Get active orders for context
  const activeOrders = customer ? await getActiveOrders(db, fromNumber) : [];
  let orderContext = "";
  if (activeOrders.length) {
    orderContext = "\n\nCustomer's active orders:";
    for (const o of activeOrders) {
      const full = await getOrderById(db, o.id);
      const pendingSubs = (full?.substitutions || []).filter((s) => s.status === "pending");
      orderContext += `\n  Order #${o.id.slice(0, 8)}: ${statusLabel(o.status)} — ${o.slot_label} ($${o.subtotal.toFixed(2)}, ${o.item_count} items)`;
      if (pendingSubs.length) {
        orderContext += `\n    Pending substitutions:`;
        for (const s of pendingSubs) {
          orderContext += `\n      - ${s.original_item} → ${s.suggested_item} (${s.price_diff >= 0 ? "+" : ""}$${s.price_diff.toFixed(2)}) [sub ID: ${s.id}]`;
        }
      }
    }
  }

  // Get cart context
  const cart = customer ? await getCart(db, fromNumber) : [];
  let cartContext = "";
  if (cart.length) {
    const total = cartTotal(cart);
    cartContext = `\n\nCustomer's cart (${cart.length} items, $${total.toFixed(2)} total):`;
    for (const item of cart) {
      cartContext += `\n  - ${item.product_name} x${item.quantity} ($${(item.quantity * item.unit_price).toFixed(2)})`;
    }
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() + customerContext + orderContext + cartContext },
    {
      role: "user",
      content: `Customer phone: ${fromNumber}\nInbound WhatsApp message: ${text}\n\nConversation history:\n${historyText}\n\nHandle this message. Use your tools to browse products, manage cart, and place orders as needed. Always send a WhatsApp response.`,
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
