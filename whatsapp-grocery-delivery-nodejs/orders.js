// Cart, order, delivery, and substitution operations.
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Delivery status pipeline
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = ["confirmed", "picking", "packed", "out_for_delivery", "delivered"];

export function nextStatus(current) {
  const idx = ORDER_STATUSES.indexOf(current);
  if (idx === -1 || idx >= ORDER_STATUSES.length - 1) return null;
  return ORDER_STATUSES[idx + 1];
}

export function statusLabel(s) {
  const labels = {
    confirmed: "Confirmed",
    picking: "Picking",
    packed: "Packed",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
  };
  return labels[s] || s;
}

// ---------------------------------------------------------------------------
// Cart operations
// ---------------------------------------------------------------------------
export async function getCart(db, phone) {
  const { results } = await db.prepare(
    "SELECT * FROM cart_items WHERE customer_phone = ? ORDER BY added_at"
  ).bind(phone).all();
  return results;
}

export async function addToCart(db, phone, product, quantity) {
  quantity = Math.max(1, Number(quantity) || 1);
  const effectivePrice = product.on_sale && product.sale_price > 0 ? product.sale_price : product.price;

  // Check if already in cart
  const existing = await db.prepare(
    "SELECT * FROM cart_items WHERE customer_phone = ? AND product_id = ?"
  ).bind(phone, product.id).first();

  if (existing) {
    const newQty = existing.quantity + quantity;
    await db.prepare(
      "UPDATE cart_items SET quantity = ? WHERE id = ?"
    ).bind(newQty, existing.id).run();
    return { ...existing, quantity: newQty };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO cart_items (id, customer_phone, product_id, product_name, quantity, unit_price, added_at) VALUES (?,?,?,?,?,?,?)"
  ).bind(id, phone, product.id, product.name, quantity, effectivePrice, now).run();
  return { id, customer_phone: phone, product_id: product.id, product_name: product.name, quantity, unit_price: effectivePrice };
}

export async function updateCartItem(db, phone, productName, quantity) {
  quantity = Number(quantity);
  if (quantity <= 0) {
    // Remove item
    await db.prepare(
      "DELETE FROM cart_items WHERE customer_phone = ? AND LOWER(product_name) = ?"
    ).bind(phone, productName.toLowerCase()).run();
    return { removed: true, product_name: productName };
  }
  await db.prepare(
    "UPDATE cart_items SET quantity = ? WHERE customer_phone = ? AND LOWER(product_name) = ?"
  ).bind(quantity, phone, productName.toLowerCase()).run();
  return { updated: true, product_name: productName, quantity };
}

export async function clearCart(db, phone) {
  await db.prepare("DELETE FROM cart_items WHERE customer_phone = ?").bind(phone).run();
}

export function cartTotal(items) {
  return items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

// ---------------------------------------------------------------------------
// Delivery slot operations
// ---------------------------------------------------------------------------
export async function getAvailableSlots(db) {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await db.prepare(
    "SELECT * FROM delivery_slots WHERE date >= ? AND booked < capacity ORDER BY date, time_start"
  ).bind(today).all();
  return results;
}

export async function bookSlot(db, slotId) {
  await db.prepare(
    "UPDATE delivery_slots SET booked = booked + 1 WHERE id = ?"
  ).bind(slotId).run();
  return db.prepare("SELECT * FROM delivery_slots WHERE id = ?").bind(slotId).first();
}

// ---------------------------------------------------------------------------
// Order operations
// ---------------------------------------------------------------------------
export async function placeOrder(db, ssePublish, phone, slotId) {
  const cart = await getCart(db, phone);
  if (!cart.length) return { error: "Cart is empty" };

  const slot = await db.prepare("SELECT * FROM delivery_slots WHERE id = ?").bind(slotId).first();
  if (!slot) return { error: "Invalid delivery slot" };
  if (slot.booked >= slot.capacity) return { error: "Delivery slot is full" };

  const customer = await db.prepare("SELECT * FROM customers WHERE phone = ?").bind(phone).first();
  const total = cartTotal(cart);
  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO orders (id, customer_phone, customer_name, slot_id, slot_label, status, subtotal, item_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, phone, customer?.name || "", slotId, slot.label, "confirmed", total, cart.length, now, now).run();

  // Copy cart items to order items
  for (const item of cart) {
    await db.prepare(
      "INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal) VALUES (?,?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(), orderId, item.product_id, item.product_name, item.quantity, item.unit_price, item.quantity * item.unit_price).run();
  }

  // Book the slot
  await bookSlot(db, slotId);

  // Clear the cart
  await clearCart(db, phone);

  const order = await getOrderById(db, orderId);
  ssePublish("order.new", { order });
  return order;
}

export async function getOrderById(db, orderId) {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return null;
  const { results: items } = await db.prepare(
    "SELECT * FROM order_items WHERE order_id = ? ORDER BY product_name"
  ).bind(orderId).all();
  const { results: subs } = await db.prepare(
    "SELECT * FROM substitutions WHERE order_id = ? ORDER BY created_at"
  ).bind(orderId).all();
  return { ...order, items, substitutions: subs };
}

export async function getOrdersForPhone(db, phone) {
  const { results } = await db.prepare(
    "SELECT * FROM orders WHERE customer_phone = ? ORDER BY created_at DESC LIMIT 10"
  ).bind(phone).all();
  return results;
}

export async function getActiveOrders(db, phone) {
  const { results } = await db.prepare(
    "SELECT * FROM orders WHERE customer_phone = ? AND status != 'delivered' ORDER BY created_at DESC"
  ).bind(phone).all();
  return results;
}

export async function getAllOrders(db) {
  const { results } = await db.prepare(
    "SELECT * FROM orders ORDER BY created_at DESC LIMIT 50"
  ).all();
  return results;
}

export async function advanceOrder(db, ssePublish, orderId) {
  const order = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
  if (!order) return { error: "Order not found" };
  const next = nextStatus(order.status);
  if (!next) return { error: "Order is already delivered" };

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?"
  ).bind(next, now, orderId).run();

  const updated = await getOrderById(db, orderId);
  ssePublish("order.update", { order: updated });
  return updated;
}

export async function rescheduleOrder(db, ssePublish, orderId, newSlotId) {
  const slot = await db.prepare("SELECT * FROM delivery_slots WHERE id = ?").bind(newSlotId).first();
  if (!slot) return { error: "Invalid delivery slot" };
  if (slot.booked >= slot.capacity) return { error: "Delivery slot is full" };

  const now = new Date().toISOString();
  await db.prepare(
    "UPDATE orders SET slot_id = ?, slot_label = ?, updated_at = ? WHERE id = ?"
  ).bind(newSlotId, slot.label, now, orderId).run();

  await bookSlot(db, newSlotId);

  const updated = await getOrderById(db, orderId);
  ssePublish("order.update", { order: updated });
  return updated;
}

// ---------------------------------------------------------------------------
// Substitution operations
// ---------------------------------------------------------------------------
export async function getPendingSubstitutions(db, orderId) {
  const { results } = await db.prepare(
    "SELECT * FROM substitutions WHERE order_id = ? AND status = 'pending'"
  ).bind(orderId).all();
  return results;
}

export async function resolveSubstitution(db, ssePublish, subId, action) {
  const now = new Date().toISOString();
  let newStatus;
  if (action === "accept") newStatus = "accepted";
  else if (action === "reject") newStatus = "rejected";
  else if (action === "remove") newStatus = "removed";
  else return { error: "Invalid action. Use accept, reject, or remove." };

  await db.prepare(
    "UPDATE substitutions SET status = ?, resolved_at = ? WHERE id = ?"
  ).bind(newStatus, now, subId).run();

  const sub = await db.prepare("SELECT * FROM substitutions WHERE id = ?").bind(subId).first();
  ssePublish("substitution.resolved", { substitution: sub });
  return sub;
}

export async function getAllSubstitutions(db) {
  const { results } = await db.prepare(
    "SELECT s.*, o.customer_name FROM substitutions s LEFT JOIN orders o ON s.order_id = o.id ORDER BY s.created_at DESC LIMIT 20"
  ).all();
  return results;
}

// ---------------------------------------------------------------------------
// Reorder — populate cart from a previous order
// ---------------------------------------------------------------------------
export async function reorderFromOrder(db, phone, orderId) {
  const { results: items } = await db.prepare(
    "SELECT * FROM order_items WHERE order_id = ?"
  ).bind(orderId).all();

  if (!items.length) return { error: "No items in that order" };

  // Clear existing cart
  await clearCart(db, phone);

  const now = new Date().toISOString();
  for (const item of items) {
    await db.prepare(
      "INSERT INTO cart_items (id, customer_phone, product_id, product_name, quantity, unit_price, added_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(), phone, item.product_id, item.product_name, item.quantity, item.unit_price, now).run();
  }

  return { items_added: items.length, items };
}
