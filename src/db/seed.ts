/**
 * DataPilot MCP — Sample Data Seeder
 *
 * Creates and populates SQLite with realistic sample datasets:
 * - sales_orders      : e-commerce order data
 * - products          : product catalog
 * - customers         : customer profiles
 * - web_events        : clickstream/analytics events
 * - support_tickets   : customer support data
 *
 * Run: npx tsx src/db/seed.ts
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.resolve(process.env['DATABASE_PATH'] ?? './data/datapilot.db');
const DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rand = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const randFloat = (min: number, max: number, dp = 2): number =>
  parseFloat((Math.random() * (max - min) + min).toFixed(dp));

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// ─── Products ─────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    price REAL NOT NULL,
    cost REAL NOT NULL,
    inventory_count INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )
`);

const CATEGORIES: Record<string, string[]> = {
  Electronics: ['Laptops', 'Phones', 'Tablets', 'Accessories'],
  Clothing: ['Shirts', 'Pants', 'Jackets', 'Shoes'],
  'Home & Garden': ['Furniture', 'Decor', 'Kitchen', 'Garden'],
  Sports: ['Fitness', 'Outdoor', 'Team Sports', 'Water Sports'],
  Books: ['Fiction', 'Non-Fiction', 'Technical', 'Children'],
};

const PRODUCT_NAMES: Record<string, string[]> = {
  Laptops: ['ProBook 14', 'UltraSlim 15', 'Gaming Beast X1', 'Business Edge 13'],
  Phones: ['SmartX Pro', 'PixelAce 5', 'NovaCam Ultra', 'BudgetPal 3'],
  Tablets: ['PadPro 11', 'SlimTab 10', 'KidSafe Tab', 'DrawPad Pro'],
  Accessories: ['USB-C Hub', 'Wireless Charger', 'Noise-Cancel Buds', 'Laptop Stand'],
  Shirts: ['Oxford Classic', 'Slim Fit Polo', 'Casual Linen', 'Performance Tee'],
  Pants: ['Chino Slim', 'Denim Stretch', 'Cargo Trail', 'Dress Pant'],
  Jackets: ['Puffer Winter', 'Rain Shield', 'Fleece Warmth', 'Moto Classic'],
  Shoes: ['Runner X5', 'Oxford Brogue', 'Trail Hiker', 'Canvas Low'],
  Furniture: ['Ergonomic Chair', 'Standing Desk', 'Bookshelf Oak', 'Sofa 3-Seater'],
  Decor: ['Canvas Print', 'Table Lamp', 'Throw Pillow Set', 'Wall Clock Modern'],
  Kitchen: ['Air Fryer XL', 'Coffee Maker Pro', 'Blender Power', 'Cast Iron Pan'],
  Garden: ['Raised Bed Kit', 'Garden Hose 50ft', 'Solar Path Lights', 'Compost Bin'],
  Fitness: ['Yoga Mat', 'Resistance Bands', 'Dumbbell Set 20lb', 'Pull-Up Bar'],
  Outdoor: ['Camping Tent 4P', 'Hiking Backpack', 'Trekking Poles', 'Headlamp Pro'],
  'Team Sports': ['Soccer Ball Pro', 'Basketball Indoor', 'Volleyball Set', 'Badminton Kit'],
  'Water Sports': ['Swim Goggles', 'Surfboard Foam', 'Snorkel Set', 'Kayak Paddle'],
  Fiction: ['The Last Signal', 'Dark Meridian', 'Ocean of Stars', 'The Glass Maze'],
  'Non-Fiction': ['Atomic Habits', 'Deep Work', 'Zero to One', 'Thinking Fast & Slow'],
  Technical: ['Clean Code', 'Designing Data Systems', 'System Design Interview', 'The Pragmatic Programmer'],
  Children: ['Where Dragons Fly', 'Dino ABC', 'Math Adventures', 'Space Explorer'],
};

db.exec('DELETE FROM products');
const insertProduct = db.prepare(
  'INSERT INTO products (sku, name, category, subcategory, price, cost, inventory_count, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

let productId = 1;
for (const [category, subcategories] of Object.entries(CATEGORIES)) {
  for (const subcategory of subcategories) {
    const names = PRODUCT_NAMES[subcategory] ?? ['Generic Product'];
    for (const name of names) {
      const price = randFloat(9.99, 999.99);
      insertProduct.run(
        `SKU-${String(productId).padStart(5, '0')}`,
        name,
        category,
        subcategory,
        price,
        parseFloat((price * randFloat(0.35, 0.65)).toFixed(2)),
        rand(0, 500),
        rand(0, 10) > 1 ? 1 : 0,
        dateOffset(rand(90, 730)),
      );
      productId++;
    }
  }
}
console.log(`✓ Seeded ${productId - 1} products`);

// ─── Customers ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    country TEXT NOT NULL,
    city TEXT NOT NULL,
    segment TEXT NOT NULL,
    lifetime_value REAL NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    last_order_at TEXT
  )
`);

const FIRST_NAMES = ['James', 'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Elijah', 'Sophia', 'Lucas', 'Isabella', 'Mason', 'Mia', 'Ethan', 'Charlotte', 'Aiden', 'Amelia', 'Logan', 'Harper', 'Jackson', 'Evelyn'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
const COUNTRIES = ['US', 'UK', 'CA', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'SG'];
const CITIES: Record<string, string[]> = {
  US: ['New York', 'Los Angeles', 'Chicago', 'Houston'],
  UK: ['London', 'Manchester', 'Birmingham', 'Leeds'],
  CA: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
  DE: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt'],
  FR: ['Paris', 'Lyon', 'Marseille', 'Nice'],
  JP: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'],
  BR: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador'],
  IN: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai'],
  SG: ['Singapore', 'Jurong', 'Woodlands', 'Tampines'],
};
const SEGMENTS = ['enterprise', 'smb', 'consumer', 'vip'];

db.exec('DELETE FROM customers');
const insertCustomer = db.prepare(
  'INSERT INTO customers (email, first_name, last_name, country, city, segment, lifetime_value, joined_at, last_order_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

const CUSTOMER_COUNT = 500;
const insertCustomerMany = db.transaction(() => {
  for (let i = 1; i <= CUSTOMER_COUNT; i++) {
    const fn = pick(FIRST_NAMES);
    const ln = pick(LAST_NAMES);
    const country = pick(COUNTRIES);
    const city = pick(CITIES[country] ?? ['Unknown']);
    const joinedDaysAgo = rand(10, 1000);
    const hasOrdered = rand(0, 10) > 2;
    insertCustomer.run(
      `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`,
      fn,
      ln,
      country,
      city,
      pick(SEGMENTS),
      hasOrdered ? randFloat(50, 15000) : 0,
      dateOffset(joinedDaysAgo),
      hasOrdered ? dateOffset(rand(0, joinedDaysAgo - 1)) : null,
    );
  }
});
insertCustomerMany();
console.log(`✓ Seeded ${CUSTOMER_COUNT} customers`);

// ─── Sales Orders ─────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sales_orders (
    id INTEGER PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL,
    channel TEXT NOT NULL,
    region TEXT NOT NULL,
    ordered_at TEXT NOT NULL,
    shipped_at TEXT,
    delivered_at TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )
`);

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
const CHANNELS = ['web', 'mobile', 'marketplace', 'direct', 'partner'];
const REGIONS = ['north_america', 'europe', 'apac', 'latam', 'mena'];

db.exec('DELETE FROM sales_orders');
const insertOrder = db.prepare(
  'INSERT INTO sales_orders (order_number, customer_id, product_id, quantity, unit_price, discount_pct, total_amount, status, channel, region, ordered_at, shipped_at, delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

const ORDER_COUNT = 2000;
const insertOrdersMany = db.transaction(() => {
  for (let i = 1; i <= ORDER_COUNT; i++) {
    const qty = rand(1, 5);
    const price = randFloat(9.99, 999.99);
    const discount = pick([0, 0, 0, 5, 10, 15, 20]);
    const total = parseFloat((qty * price * (1 - discount / 100)).toFixed(2));
    const orderedDaysAgo = rand(0, 365);
    const status = pick(ORDER_STATUSES);
    const shippedDaysAgo = status !== 'pending' && status !== 'processing' ? rand(0, orderedDaysAgo) : null;
    const deliveredDaysAgo = status === 'delivered' ? (shippedDaysAgo ? rand(0, shippedDaysAgo) : null) : null;

    insertOrder.run(
      `ORD-${String(i).padStart(6, '0')}`,
      rand(1, CUSTOMER_COUNT),
      rand(1, productId - 1),
      qty,
      price,
      discount,
      total,
      status,
      pick(CHANNELS),
      pick(REGIONS),
      dateOffset(orderedDaysAgo),
      shippedDaysAgo !== null ? dateOffset(shippedDaysAgo) : null,
      deliveredDaysAgo !== null ? dateOffset(deliveredDaysAgo) : null,
    );
  }
});
insertOrdersMany();
console.log(`✓ Seeded ${ORDER_COUNT} sales orders`);

// ─── Web Events ───────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS web_events (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    customer_id INTEGER,
    event_type TEXT NOT NULL,
    page TEXT NOT NULL,
    referrer TEXT,
    device TEXT NOT NULL,
    browser TEXT NOT NULL,
    country TEXT NOT NULL,
    duration_sec INTEGER,
    occurred_at TEXT NOT NULL
  )
`);

const EVENT_TYPES = ['page_view', 'click', 'add_to_cart', 'checkout_start', 'purchase', 'search', 'scroll'];
const PAGES = ['/', '/products', '/products/:id', '/cart', '/checkout', '/account', '/search', '/blog'];
const DEVICES = ['desktop', 'mobile', 'tablet'];
const BROWSERS = ['Chrome', 'Safari', 'Firefox', 'Edge', 'Samsung Internet'];
const REFERRERS = [null, 'google.com', 'facebook.com', 'twitter.com', 'email', 'direct'];

db.exec('DELETE FROM web_events');
const insertEvent = db.prepare(
  'INSERT INTO web_events (session_id, customer_id, event_type, page, referrer, device, browser, country, duration_sec, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

const EVENT_COUNT = 5000;
const insertEventsMany = db.transaction(() => {
  for (let i = 0; i < EVENT_COUNT; i++) {
    const hasCustomer = rand(0, 10) > 4;
    insertEvent.run(
      `sess_${Math.random().toString(36).slice(2, 10)}`,
      hasCustomer ? rand(1, CUSTOMER_COUNT) : null,
      pick(EVENT_TYPES),
      pick(PAGES),
      pick(REFERRERS),
      pick(DEVICES),
      pick(BROWSERS),
      pick(COUNTRIES),
      rand(1, 300),
      dateOffset(rand(0, 90)) + `T${String(rand(0, 23)).padStart(2, '0')}:${String(rand(0, 59)).padStart(2, '0')}:00Z`,
    );
  }
});
insertEventsMany();
console.log(`✓ Seeded ${EVENT_COUNT} web events`);

// ─── Support Tickets ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    id INTEGER PRIMARY KEY,
    ticket_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL,
    subject TEXT NOT NULL,
    satisfaction_score INTEGER,
    first_response_min INTEGER,
    resolution_min INTEGER,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )
`);

const TICKET_CATEGORIES = ['billing', 'technical', 'shipping', 'returns', 'account', 'product'];
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'escalated'];
const TICKET_SUBJECTS: Record<string, string[]> = {
  billing: ['Incorrect charge on my account', 'Refund not received', 'Cannot update payment method'],
  technical: ['App crashes on login', 'Cannot download my order', 'API authentication failing'],
  shipping: ['Order not arrived', 'Wrong item shipped', 'Package damaged on delivery'],
  returns: ['How do I return an item?', 'Return label not working', 'Refund status unclear'],
  account: ['Cannot reset my password', 'Duplicate account issue', 'Account suspended unexpectedly'],
  product: ['Item defective after 1 week', 'Missing parts in package', 'Product not as described'],
};

db.exec('DELETE FROM support_tickets');
const insertTicket = db.prepare(
  'INSERT INTO support_tickets (ticket_number, customer_id, category, priority, status, subject, satisfaction_score, first_response_min, resolution_min, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
);

const TICKET_COUNT = 800;
const insertTicketsMany = db.transaction(() => {
  for (let i = 1; i <= TICKET_COUNT; i++) {
    const category = pick(TICKET_CATEGORIES);
    const status = pick(TICKET_STATUSES);
    const createdDaysAgo = rand(0, 180);
    const isResolved = status === 'resolved' || status === 'closed';
    const resolutionMin = isResolved ? rand(30, 14400) : null;
    insertTicket.run(
      `TKT-${String(i).padStart(5, '0')}`,
      rand(1, CUSTOMER_COUNT),
      category,
      pick(TICKET_PRIORITIES),
      status,
      pick(TICKET_SUBJECTS[category] ?? ['General inquiry']),
      isResolved ? rand(1, 5) : null,
      rand(5, 480),
      resolutionMin,
      dateOffset(createdDaysAgo),
      isResolved ? dateOffset(rand(0, createdDaysAgo)) : null,
    );
  }
});
insertTicketsMany();
console.log(`✓ Seeded ${TICKET_COUNT} support tickets`);

// ─── Done ─────────────────────────────────────────────────────────────────────

db.close();
console.log('\n🚀 DataPilot database seeded successfully at:', DB_PATH);
console.log('\nAvailable datasets:');
console.log('  • products         — product catalog');
console.log('  • customers        — customer profiles');
console.log('  • sales_orders     — e-commerce orders');
console.log('  • web_events       — clickstream analytics');
console.log('  • support_tickets  — customer support data');
