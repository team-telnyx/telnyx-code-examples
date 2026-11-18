// Product catalog — categories, seed products, search helpers.
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export const CATEGORIES = [
  { id: "fruits",     name: "Fruits & Berries",    emoji: "\uD83C\uDF53", sort_order: 1 },
  { id: "vegetables", name: "Vegetables",           emoji: "\uD83E\uDD66", sort_order: 2 },
  { id: "dairy",      name: "Dairy & Eggs",         emoji: "\uD83E\uDDC0", sort_order: 3 },
  { id: "bakery",     name: "Bakery",               emoji: "\uD83C\uDF5E", sort_order: 4 },
  { id: "meat",       name: "Meat & Seafood",       emoji: "\uD83E\uDD69", sort_order: 5 },
  { id: "pantry",     name: "Pantry Staples",       emoji: "\uD83C\uDF7D\uFE0F", sort_order: 6 },
  { id: "beverages",  name: "Beverages",            emoji: "\uD83E\uDDC3", sort_order: 7 },
  { id: "snacks",     name: "Snacks",               emoji: "\uD83C\uDF7F", sort_order: 8 },
  { id: "frozen",     name: "Frozen",               emoji: "\u2744\uFE0F",  sort_order: 9 },
];

// ---------------------------------------------------------------------------
// Seed products (~70 items, Unsplash images, realistic prices)
// ---------------------------------------------------------------------------
const IMG = (id) => `https://images.unsplash.com/photo-${id}?w=400&h=300&fit=crop&q=80`;

export const SEED_PRODUCTS = [
  // ── Fruits & Berries ──
  { category_id: "fruits", name: "Organic Bananas",       price: 1.29, unit: "bunch",  image_url: IMG("1571771894821-ce9b6c11b08e"), dietary_tags: "organic,vegan",   on_sale: 1, sale_price: 0.99 },
  { category_id: "fruits", name: "Strawberries",          price: 4.99, unit: "punnet", image_url: IMG("1464965911861-1fd34db45b85"), dietary_tags: "vegan" },
  { category_id: "fruits", name: "Avocados",              price: 1.99, unit: "each",   image_url: IMG("1523049673857-eb18f1d7b578"), dietary_tags: "vegan" },
  { category_id: "fruits", name: "Blueberries",           price: 3.99, unit: "punnet", image_url: IMG("1498557850523-fd3d118b962e"), dietary_tags: "vegan,organic" },
  { category_id: "fruits", name: "Lemons",                price: 0.79, unit: "each",   image_url: IMG("1590502593747-42a996133562"), dietary_tags: "vegan" },
  { category_id: "fruits", name: "Red Apples",            price: 3.49, unit: "kg",     image_url: IMG("1560806887-1e4fb5e366b9"), dietary_tags: "vegan" },
  { category_id: "fruits", name: "Oranges",               price: 4.29, unit: "kg",     image_url: IMG("1547514701-42782101795b"), dietary_tags: "vegan" },
  { category_id: "fruits", name: "Mangoes",               price: 2.49, unit: "each",   image_url: IMG("1553279768-865429fa0078"), dietary_tags: "vegan",           on_sale: 1, sale_price: 1.99 },

  // ── Vegetables ──
  { category_id: "vegetables", name: "Baby Spinach",       price: 2.99, unit: "bag",   image_url: IMG("1576045057995-568f588f82fb"), dietary_tags: "organic,vegan" },
  { category_id: "vegetables", name: "Cherry Tomatoes",    price: 3.49, unit: "punnet", image_url: IMG("1546094096-0df4bcaaa337"), dietary_tags: "vegan" },
  { category_id: "vegetables", name: "Broccoli",           price: 2.49, unit: "head",   image_url: IMG("1459411552884-841db9b3cc2a"), dietary_tags: "vegan" },
  { category_id: "vegetables", name: "Sweet Potatoes",     price: 3.99, unit: "kg",     image_url: IMG("1596097635092-6e7ba0e5cae0"), dietary_tags: "vegan" },
  { category_id: "vegetables", name: "Red Bell Peppers",   price: 1.99, unit: "each",   image_url: IMG("1563565375-f3fdfdbefa83"), dietary_tags: "vegan" },
  { category_id: "vegetables", name: "Carrots",            price: 1.49, unit: "bunch",  image_url: IMG("1598170845058-32b9d6a5da37"), dietary_tags: "organic,vegan" },
  { category_id: "vegetables", name: "Cucumber",           price: 0.99, unit: "each",   image_url: IMG("1449300079323-02e209d9d3a6"), dietary_tags: "vegan" },
  { category_id: "vegetables", name: "Mixed Salad Greens", price: 3.29, unit: "bag",    image_url: IMG("1512621776951-a57141f2eefd"), dietary_tags: "organic,vegan", on_sale: 1, sale_price: 2.49 },

  // ── Dairy & Eggs ──
  { category_id: "dairy", name: "Organic Whole Milk",    price: 4.99, unit: "liter",  image_url: IMG("1563636619-e9143da7973b"), dietary_tags: "organic" },
  { category_id: "dairy", name: "Oat Milk",              price: 4.49, unit: "liter",  image_url: IMG("1600788907416-bc98b6cc7f24"), dietary_tags: "vegan,dairy-free" },
  { category_id: "dairy", name: "Free Range Eggs",       price: 5.99, unit: "dozen",  image_url: IMG("1582722872445-44dc5f7e3c8f"), dietary_tags: "free-range" },
  { category_id: "dairy", name: "Greek Yogurt",          price: 3.79, unit: "500g",   image_url: IMG("1488477181946-6428a0291777"), dietary_tags: "" },
  { category_id: "dairy", name: "Cheddar Cheese",        price: 5.49, unit: "block",  image_url: IMG("1618164436241-4473940d1f5c"), dietary_tags: "" },
  { category_id: "dairy", name: "Butter",                price: 3.99, unit: "250g",   image_url: IMG("1589985270826-4b7bb135bc0d"), dietary_tags: "" },
  { category_id: "dairy", name: "Mozzarella",            price: 4.29, unit: "ball",   image_url: IMG("1626957341926-98752fc2ba90"), dietary_tags: "" },
  { category_id: "dairy", name: "Almond Milk",           price: 4.29, unit: "liter",  image_url: IMG("1600718374662-0483d2b9da44"), dietary_tags: "vegan,dairy-free" },

  // ── Bakery ──
  { category_id: "bakery", name: "Sourdough Bread",       price: 5.49, unit: "loaf",   image_url: IMG("1509440159596-0249088772ff"), dietary_tags: "vegan" },
  { category_id: "bakery", name: "Whole Wheat Bread",     price: 3.99, unit: "loaf",   image_url: IMG("1565299624946-b28f40a0ae38"), dietary_tags: "vegan" },
  { category_id: "bakery", name: "Croissants",            price: 4.99, unit: "4 pack", image_url: IMG("1555507036-ab1f4038024a"), dietary_tags: "" },
  { category_id: "bakery", name: "Bagels",                price: 4.49, unit: "6 pack", image_url: IMG("1585535065908-0f5e5a12de7e"), dietary_tags: "vegan" },
  { category_id: "bakery", name: "Baguette",              price: 2.99, unit: "each",   image_url: IMG("1549931319-a545dcf3bc73"), dietary_tags: "vegan" },
  { category_id: "bakery", name: "Cinnamon Rolls",        price: 6.99, unit: "4 pack", image_url: IMG("1509365390695-33aee754301f"), dietary_tags: "",               on_sale: 1, sale_price: 4.99 },
  { category_id: "bakery", name: "Gluten-Free Bread",     price: 6.49, unit: "loaf",   image_url: IMG("1586444248902-2367b7f64cb6"), dietary_tags: "gluten-free,vegan" },

  // ── Meat & Seafood ──
  { category_id: "meat", name: "Chicken Breast",         price: 9.99,  unit: "kg",    image_url: IMG("1604503468506-a8da13d82571"), dietary_tags: "high-protein" },
  { category_id: "meat", name: "Atlantic Salmon",        price: 14.99, unit: "500g",  image_url: IMG("1574781330855-d0db8cc6a79c"), dietary_tags: "omega-3" },
  { category_id: "meat", name: "Ground Beef",            price: 11.99, unit: "kg",    image_url: IMG("1602473812476-a0e5e4a9dfd3"), dietary_tags: "high-protein" },
  { category_id: "meat", name: "Shrimp",                 price: 12.99, unit: "500g",  image_url: IMG("1565680018434-b513d5e5fd47"), dietary_tags: "" },
  { category_id: "meat", name: "Turkey Mince",           price: 8.99,  unit: "500g",  image_url: IMG("1602476923749-1c2f8f14fbb3"), dietary_tags: "lean" },
  { category_id: "meat", name: "Pork Chops",             price: 10.49, unit: "kg",    image_url: IMG("1432139555190-58524dae6a55"), dietary_tags: "" },
  { category_id: "meat", name: "Plant-Based Burger",     price: 7.99,  unit: "2 pack",image_url: IMG("1585032226651-759b368d7246"), dietary_tags: "vegan,plant-based", on_sale: 1, sale_price: 5.99 },

  // ── Pantry Staples ──
  { category_id: "pantry", name: "Extra Virgin Olive Oil", price: 8.99, unit: "500ml", image_url: IMG("1474979266404-7eaacbcd87c5"), dietary_tags: "vegan" },
  { category_id: "pantry", name: "Basmati Rice",           price: 4.99, unit: "kg",    image_url: IMG("1586201375761-83865001e31c"), dietary_tags: "vegan,gluten-free" },
  { category_id: "pantry", name: "Pasta Penne",            price: 2.49, unit: "500g",  image_url: IMG("1551462147-37885acc36f1"), dietary_tags: "vegan" },
  { category_id: "pantry", name: "Canned Tomatoes",        price: 1.79, unit: "400g",  image_url: IMG("1589927986089-35812388d1f4"), dietary_tags: "vegan" },
  { category_id: "pantry", name: "Organic Honey",          price: 7.99, unit: "350g",  image_url: IMG("1587049352846-4a222e784d38"), dietary_tags: "organic" },
  { category_id: "pantry", name: "Peanut Butter",          price: 4.49, unit: "jar",   image_url: IMG("1598511726623-d2e9996892f0"), dietary_tags: "vegan,high-protein" },
  { category_id: "pantry", name: "Black Beans",            price: 1.49, unit: "400g",  image_url: IMG("1536304993881-84e24830913e"), dietary_tags: "vegan,gluten-free" },
  { category_id: "pantry", name: "Coconut Oil",            price: 5.99, unit: "500ml", image_url: IMG("1526318472351-c75fcf070305"), dietary_tags: "vegan,organic" },

  // ── Beverages ──
  { category_id: "beverages", name: "Orange Juice",         price: 4.99, unit: "liter",  image_url: IMG("1621506289937-a8855f7e5e70"), dietary_tags: "vegan" },
  { category_id: "beverages", name: "Sparkling Water",      price: 1.99, unit: "liter",  image_url: IMG("1559839914-17aae19cec71"), dietary_tags: "vegan" },
  { category_id: "beverages", name: "Green Tea",            price: 3.99, unit: "20 bags",image_url: IMG("1556881286-fc6d0fbb9a95"), dietary_tags: "vegan,organic" },
  { category_id: "beverages", name: "Cold Brew Coffee",     price: 5.49, unit: "bottle", image_url: IMG("1461023058943-07fcbe16d735"), dietary_tags: "vegan" },
  { category_id: "beverages", name: "Coconut Water",        price: 3.49, unit: "500ml",  image_url: IMG("1525385133512-2f3bdd039054"), dietary_tags: "vegan",           on_sale: 1, sale_price: 2.49 },
  { category_id: "beverages", name: "Kombucha",             price: 4.29, unit: "bottle", image_url: IMG("1563227812-0ea4c22e6cc8"), dietary_tags: "vegan,probiotic" },
  { category_id: "beverages", name: "Apple Cider",          price: 4.99, unit: "liter",  image_url: IMG("1576673442511-7e39b6545c87"), dietary_tags: "vegan" },

  // ── Snacks ──
  { category_id: "snacks", name: "Mixed Nuts",           price: 6.99, unit: "250g",  image_url: IMG("1536591375668-3ad03e75c784"), dietary_tags: "vegan,gluten-free" },
  { category_id: "snacks", name: "Dark Chocolate",       price: 3.99, unit: "100g",  image_url: IMG("1481391319762-47dff72954d9"), dietary_tags: "vegan" },
  { category_id: "snacks", name: "Rice Cakes",           price: 2.99, unit: "pack",  image_url: IMG("1586985289688-ca3cf47d3e6e"), dietary_tags: "vegan,gluten-free" },
  { category_id: "snacks", name: "Hummus",               price: 3.49, unit: "300g",  image_url: IMG("1577805947858-27f82516de83"), dietary_tags: "vegan" },
  { category_id: "snacks", name: "Tortilla Chips",       price: 3.29, unit: "pack",  image_url: IMG("1600952841320-db92ec4047ca"), dietary_tags: "vegan,gluten-free" },
  { category_id: "snacks", name: "Granola Bars",         price: 4.49, unit: "6 pack",image_url: IMG("1558961363-fa8fdf82db35"), dietary_tags: "vegan",              on_sale: 1, sale_price: 3.29 },
  { category_id: "snacks", name: "Dried Mango",          price: 4.99, unit: "150g",  image_url: IMG("1604909052743-9c2904c353ab"), dietary_tags: "vegan" },
  { category_id: "snacks", name: "Trail Mix",            price: 5.49, unit: "300g",  image_url: IMG("1604909052743-9c2904c353ac"), dietary_tags: "vegan,high-protein" },

  // ── Frozen ──
  { category_id: "frozen", name: "Frozen Pizza",         price: 5.99, unit: "each",  image_url: IMG("1565299624946-b28f40a0ae39"), dietary_tags: "" },
  { category_id: "frozen", name: "Frozen Mixed Berries", price: 4.99, unit: "500g",  image_url: IMG("1563746098251-d35aef196e83"), dietary_tags: "vegan" },
  { category_id: "frozen", name: "Ice Cream Vanilla",    price: 6.49, unit: "500ml", image_url: IMG("1570197788417-0e82375c9371"), dietary_tags: "" },
  { category_id: "frozen", name: "Frozen Peas",          price: 2.49, unit: "500g",  image_url: IMG("1563565375-f3fdfdbefa84"), dietary_tags: "vegan" },
  { category_id: "frozen", name: "Fish Fingers",         price: 4.99, unit: "10 pack", image_url: IMG("1574781330855-d0db8cc6a80c"), dietary_tags: "" },
  { category_id: "frozen", name: "Veggie Dumplings",     price: 5.99, unit: "pack",  image_url: IMG("1563379926898-05f4575a45d8"), dietary_tags: "vegan",            on_sale: 1, sale_price: 3.99 },
  { category_id: "frozen", name: "Frozen Edamame",       price: 3.49, unit: "400g",  image_url: IMG("1564834744159-ff0ea41ba4b9"), dietary_tags: "vegan,high-protein" },
];

// ---------------------------------------------------------------------------
// Seed database
// ---------------------------------------------------------------------------
export async function seedProducts(db) {
  // Check if already seeded
  const count = await db.prepare("SELECT COUNT(*) as cnt FROM products").first("cnt");
  if (count > 0) return;

  const now = new Date().toISOString();

  // Insert categories
  for (const cat of CATEGORIES) {
    await db.prepare(
      "INSERT OR IGNORE INTO categories (id, name, emoji, sort_order) VALUES (?,?,?,?)"
    ).bind(cat.id, cat.name, cat.emoji, cat.sort_order).run();
  }

  // Insert products
  for (const p of SEED_PRODUCTS) {
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO products (id, category_id, name, description, price, unit, image_url, in_stock, on_sale, sale_price, dietary_tags, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      id, p.category_id, p.name, p.description || "",
      p.price, p.unit || "each", p.image_url || "",
      p.in_stock ?? 1, p.on_sale ?? 0, p.sale_price ?? 0,
      p.dietary_tags || "", now
    ).run();
  }

  // Seed delivery slots for next 3 days
  const slotTemplates = [
    { label: "Morning (9am-12pm)",    time_start: "09:00", time_end: "12:00" },
    { label: "Afternoon (12pm-3pm)",  time_start: "12:00", time_end: "15:00" },
    { label: "Evening (3pm-6pm)",     time_start: "15:00", time_end: "18:00" },
    { label: "Night (6pm-9pm)",       time_start: "18:00", time_end: "21:00" },
  ];

  for (let d = 0; d < 3; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    for (const tmpl of slotTemplates) {
      await db.prepare(
        "INSERT OR IGNORE INTO delivery_slots (id, label, date, time_start, time_end, capacity, booked) VALUES (?,?,?,?,?,?,?)"
      ).bind(
        `${dateStr}-${tmpl.time_start}`,
        `${dateStr} ${tmpl.label}`,
        dateStr, tmpl.time_start, tmpl.time_end, 5, 0
      ).run();
    }
  }

  // Seed demo customer: Sarah with an active order
  await db.prepare(
    "INSERT OR IGNORE INTO customers (phone, name, address, created_at) VALUES (?,?,?,?)"
  ).bind("+15551234567", "Sarah", "123 Green Street, Apt 4B", now).run();

  // Create a demo order in "picking" status
  const orderId = crypto.randomUUID();
  const todayStr = new Date().toISOString().slice(0, 10);
  await db.prepare(
    `INSERT INTO orders (id, customer_phone, customer_name, slot_id, slot_label, status, subtotal, item_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(orderId, "+15551234567", "Sarah", `${todayStr}-15:00`, `${todayStr} Evening (3pm-6pm)`, "picking", 32.45, 5, now, now).run();

  // Demo order items
  const demoItems = [
    { name: "Organic Bananas", qty: 2, price: 0.99 },
    { name: "Sourdough Bread", qty: 1, price: 5.49 },
    { name: "Organic Whole Milk", qty: 1, price: 4.99 },
    { name: "Free Range Eggs", qty: 1, price: 5.99 },
    { name: "Atlantic Salmon", qty: 1, price: 14.99 },
  ];
  for (const item of demoItems) {
    await db.prepare(
      "INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, subtotal) VALUES (?,?,?,?,?,?,?)"
    ).bind(crypto.randomUUID(), orderId, "", item.name, item.qty, item.price, item.qty * item.price).run();
  }

  // Pending substitution for Organic Whole Milk -> Oat Milk
  await db.prepare(
    `INSERT INTO substitutions (id, order_id, original_item, original_product_id, suggested_item, suggested_product_id, price_diff, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(), orderId, "Organic Whole Milk", "", "Oat Milk", "", -0.50, "pending", now).run();

  console.log(`Seeded ${SEED_PRODUCTS.length} products, ${CATEGORIES.length} categories, demo order`);
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------
export async function searchProducts(db, query, categoryId) {
  let sql = "SELECT p.*, c.name as category_name, c.emoji as category_emoji FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.in_stock = 1";
  const params = [];

  if (categoryId) {
    sql += " AND p.category_id = ?";
    params.push(categoryId);
  }

  if (query) {
    sql += " AND (LOWER(p.name) LIKE ? OR LOWER(p.dietary_tags) LIKE ?)";
    const q = `%${query.toLowerCase()}%`;
    params.push(q, q);
  }

  sql += " ORDER BY p.on_sale DESC, p.name ASC LIMIT 20";

  const stmt = db.prepare(sql);
  const { results } = params.length ? await stmt.bind(...params).all() : await stmt.all();
  return results;
}

export async function getProductById(db, productId) {
  return db.prepare(
    "SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?"
  ).bind(productId).first();
}

export async function getProductByName(db, name) {
  return db.prepare(
    "SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE LOWER(p.name) = ?"
  ).bind(name.toLowerCase()).first();
}

export async function getSpecials(db) {
  const { results } = await db.prepare(
    "SELECT p.*, c.name as category_name, c.emoji as category_emoji FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.on_sale = 1 AND p.in_stock = 1 ORDER BY p.name"
  ).all();
  return results;
}
