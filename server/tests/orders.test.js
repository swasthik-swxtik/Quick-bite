/**
 * Stage 3 — Checkout: the order-creation contract.
 *
 * Verifies the properties the cart + checkout flow depends on:
 *   - prices are always recalculated from the database; client-sent prices are rejected
 *   - a multi-outlet cart becomes ONE parent order + one outlet order per outlet
 *   - every outlet order gets its own pickup code
 *   - the whole write is transactional: a mid-transaction failure leaves no rows
 *   - invalid input (empty cart, bad quantities, unavailable items) is rejected
 *   - items from an outlet that is switched OFF are rejected, and the check
 *     happens inside the checkout transaction
 *   - duplicate menu item ids are merged into one line before the cap is applied
 *   - the simulated payment method is recorded on the order
 *   - the order detail endpoint (used by the confirmation page) is owner-scoped
 *
 * Runs against the real database. Every row this file creates is removed in
 * `after()`, and nothing here writes to seeded rows.
 *
 * Note on assertions: `node --test` runs test FILES in parallel, so global
 * table counts would be racy. Every count is therefore scoped to the throwaway
 * customer (or a marker pickup code) created by this file.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, login, api } = require('./helpers/server');
const { query } = require('../src/config/db');
const orderModel = require('../src/models/order.model');
const orderService = require('../src/services/order.service');

const PIZZA_OUTLET = '11111111-1111-1111-1111-111111111111';
const PASTA_OUTLET = '22222222-2222-2222-2222-222222222222';
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';
const UNIQUE = `${Date.now()}`;

// <= 10 chars (pickup_code is VARCHAR(10)); marks the rolled-back outlet order.
const ROLLBACK_MARKER = `RB${UNIQUE.slice(-6)}`;

// Marks the checkout that a throwing in-transaction validator must abort.
const VALIDATION_MARKER = `VD${UNIQUE.slice(-6)}`;

let ctx;
let customer;       // places the orders under test
let otherCustomer;  // proves order detail is owner-scoped
let employee;       // proves staff cannot place customer orders

let pizzaItem;          // real seeded item
let pastaItem;          // real seeded item on a different outlet
let unavailableItem;    // item on a throwaway outlet, is_available = FALSE
let inactiveOutletId;   // throwaway outlet with is_active = FALSE
let inactiveOutletItem; // available item ON that closed outlet

const createdUserIds = [];
const createdOutletIds = [];
let orderId;        // created by the first test, reused by the ownership test

const round2 = (n) => Math.round(n * 100) / 100;
const price = (item) => Number(item.price);

/** Number of orders belonging to the throwaway buyer (safe under parallelism). */
const myOrderCount = async () =>
  (await query('SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = $1', [customer.user.id]))
    .rows[0].n;

const registerCustomer = async (label) => {
  const email = `stage3-${label}-${UNIQUE}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: `Stage3 ${label}`, email, password: 'test-password-123' },
  });
  assert.equal(res.status, 201, `register failed: ${res.text}`);
  createdUserIds.push(res.body.user.id);
  return login(ctx.baseUrl, email, 'test-password-123');
};

const placeOrder = (auth, body) =>
  api(ctx.baseUrl, 'POST', '/api/orders', { cookie: auth.cookie, body });

before(async () => {
  ctx = await startServer();

  customer = await registerCustomer('buyer');
  otherCustomer = await registerCustomer('other');
  employee = await login(ctx.baseUrl, 'pizza@quickbite.com');

  // A throwaway outlet so the "unavailable item" test never mutates seed data.
  const outlet = await query(
    `INSERT INTO outlets (name, description, cuisine_type, counter_info, is_active)
     VALUES ($1, 'created by tests', 'TEST', 'Counter Z', TRUE)
     RETURNING id`,
    [`Stage3 Throwaway Outlet ${UNIQUE}`]
  );
  createdOutletIds.push(outlet.rows[0].id);

  unavailableItem = (
    await query(
      `INSERT INTO menu_items (outlet_id, name, description, price, is_available)
       VALUES ($1, $2, 'created by tests', 100.00, FALSE)
       RETURNING id`,
      [outlet.rows[0].id, `Sold Out Dish ${UNIQUE}`]
    )
  ).rows[0];

  // A throwaway outlet that is switched OFF, carrying a perfectly available
  // item: the item is fine, the outlet is not, and checkout must refuse it.
  const inactiveOutlet = await query(
    `INSERT INTO outlets (name, description, cuisine_type, counter_info, is_active)
     VALUES ($1, 'created by tests', 'TEST', 'Counter Y', FALSE)
     RETURNING id`,
    [`Stage3 Closed Outlet ${UNIQUE}`]
  );
  createdOutletIds.push(inactiveOutlet.rows[0].id);
  inactiveOutletId = inactiveOutlet.rows[0].id;

  inactiveOutletItem = (
    await query(
      `INSERT INTO menu_items (outlet_id, name, description, price, is_available)
       VALUES ($1, $2, 'created by tests', 250.00, TRUE)
       RETURNING id, name`,
      [inactiveOutletId, `Closed Outlet Dish ${UNIQUE}`]
    )
  ).rows[0];

  const pickAvailable = async (outletId) =>
    (
      await query(
        `SELECT id, name, price FROM menu_items
         WHERE outlet_id = $1 AND is_available = TRUE
         ORDER BY name LIMIT 1`,
        [outletId]
      )
    ).rows[0];

  pizzaItem = await pickAvailable(PIZZA_OUTLET);
  pastaItem = await pickAvailable(PASTA_OUTLET);
  assert.ok(pizzaItem && pastaItem, 'expected seeded available items on both outlets');
});

after(async () => {
  // Orders first (orders.customer_id is ON DELETE RESTRICT), then the throwaway
  // outlet (its menu_items cascade), then the throwaway users.
  if (createdUserIds.length) {
    await query('DELETE FROM orders WHERE customer_id = ANY($1::uuid[])', [createdUserIds]);
  }
  if (createdOutletIds.length) {
    await query('DELETE FROM outlets WHERE id = ANY($1::uuid[])', [createdOutletIds]);
  }
  if (createdUserIds.length) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }
  await ctx.close();
});

test('Stage 3 — multi-outlet checkout creates one order with a sub-order and pickup code per outlet', async () => {
  const pizzaQty = 2;
  const pastaQty = 3;

  const res = await placeOrder(customer, {
    items: [
      { menuItemId: pizzaItem.id, quantity: pizzaQty },
      { menuItemId: pastaItem.id, quantity: pastaQty },
    ],
    payment: { method: 'card' },
  });

  assert.equal(res.status, 201, res.text);
  orderId = res.body.orderId;

  const expectedPizza = round2(price(pizzaItem) * pizzaQty);
  const expectedPasta = round2(price(pastaItem) * pastaQty);
  const expectedTotal = round2(expectedPizza + expectedPasta);

  // ── the parent order ──
  assert.equal(Number(res.body.order.totalAmount), expectedTotal, 'total must be summed from DB prices');
  assert.equal(res.body.order.status, 'confirmed');

  // ── one sub-order per outlet (not one per item) ──
  assert.equal(res.body.outletOrders.length, 2, 'expected exactly one sub-order per outlet');
  const byOutlet = Object.fromEntries(res.body.outletOrders.map((o) => [o.outletId, o]));
  assert.equal(Number(byOutlet[PIZZA_OUTLET].subtotal), expectedPizza);
  assert.equal(Number(byOutlet[PASTA_OUTLET].subtotal), expectedPasta);

  // ── separate pickup codes, one per outlet ──
  const codes = res.body.outletOrders.map((o) => o.pickupCode);
  assert.equal(new Set(codes).size, 2, 'pickup codes must be distinct within one order');
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z]{2}\d{4}$/, `unexpected pickup code format: ${code}`);
  }

  // ── items are snapshots priced from the database ──
  const pizzaLine = byOutlet[PIZZA_OUTLET].items[0];
  assert.equal(pizzaLine.menuItemId, pizzaItem.id);
  assert.equal(pizzaLine.quantity, pizzaQty);
  assert.equal(Number(pizzaLine.unitPrice), price(pizzaItem), 'unit price must come from the DB');

  // ── and the same is true in the database ──
  const dbOrder = await query('SELECT total_amount, status FROM orders WHERE id = $1', [orderId]);
  assert.equal(dbOrder.rowCount, 1);
  assert.equal(Number(dbOrder.rows[0].total_amount), expectedTotal);

  const dbOutletOrders = await query(
    'SELECT outlet_id, pickup_code, status, subtotal FROM outlet_orders WHERE order_id = $1',
    [orderId]
  );
  assert.equal(dbOutletOrders.rowCount, 2);
  for (const row of dbOutletOrders.rows) {
    assert.equal(row.status, 'confirmed');
    assert.match(row.pickup_code, /^[A-HJ-NP-Z]{2}\d{4}$/);
  }

  const dbItems = await query(
    `SELECT i.unit_price, i.quantity
     FROM outlet_order_items i
     JOIN outlet_orders oo ON oo.id = i.outlet_order_id
     WHERE oo.order_id = $1`,
    [orderId]
  );
  assert.equal(dbItems.rowCount, 2);
  const summedFromDb = round2(
    dbItems.rows.reduce((sum, r) => sum + Number(r.unit_price) * r.quantity, 0)
  );
  assert.equal(summedFromDb, expectedTotal);
});

test('Stage 3 — client-supplied prices are rejected (prices only ever come from the DB)', async () => {
  const before = await myOrderCount();

  const injected = await placeOrder(customer, {
    items: [{ menuItemId: pizzaItem.id, quantity: 1, unitPrice: 0.01, price: 0.01 }],
    payment: { method: 'card' },
  });
  assert.equal(injected.status, 400, injected.text);
  assert.match(injected.text, /is not allowed/);

  assert.equal(await myOrderCount(), before, 'a rejected request must not create an order');

  // Every stored line for this item carries the catalogue price.
  const stored = await query(
    'SELECT unit_price FROM outlet_order_items WHERE menu_item_id = $1',
    [pizzaItem.id]
  );
  assert.ok(stored.rowCount > 0, 'expected the successful order to have stored a line for this item');
  for (const row of stored.rows) {
    assert.equal(Number(row.unit_price), price(pizzaItem));
  }
});

test('Stage 3 — an empty cart cannot be checked out', async () => {
  const before = await myOrderCount();

  const empty = await placeOrder(customer, { items: [], payment: { method: 'card' } });
  assert.equal(empty.status, 400, empty.text);
  assert.match(empty.text, /Validation failed/);

  const missing = await placeOrder(customer, { payment: { method: 'card' } });
  assert.equal(missing.status, 400, missing.text);

  // The service layer refuses an empty cart too, in case validation is bypassed.
  await assert.rejects(
    () => orderService.placeOrder(customer.user.id, []),
    (err) => err.status === 400 && /Cart is empty/.test(err.message)
  );

  assert.equal(await myOrderCount(), before);
});

test('Stage 3 — invalid quantities are rejected', async () => {
  const before = await myOrderCount();
  const invalidQuantities = [0, -1, 1.5, 51, 'abc', null, true];

  for (const quantity of invalidQuantities) {
    const res = await placeOrder(customer, {
      items: [{ menuItemId: pizzaItem.id, quantity }],
      payment: { method: 'card' },
    });
    assert.equal(res.status, 400, `quantity ${JSON.stringify(quantity)} should be rejected: ${res.text}`);
  }

  const missingQuantity = await placeOrder(customer, {
    items: [{ menuItemId: pizzaItem.id }],
    payment: { method: 'card' },
  });
  assert.equal(missingQuantity.status, 400, missingQuantity.text);

  assert.equal(await myOrderCount(), before, 'rejected carts must not create orders');
});

test('Stage 3 — an unavailable item is rejected and nothing is persisted', async () => {
  const before = await myOrderCount();

  const soldOutOnly = await placeOrder(customer, {
    items: [{ menuItemId: unavailableItem.id, quantity: 1 }],
    payment: { method: 'upi' },
  });
  assert.equal(soldOutOnly.status, 400, soldOutOnly.text);
  assert.match(soldOutOnly.text, /unavailable/i);

  // A cart mixing an available item with a sold-out one fails as a whole.
  const mixed = await placeOrder(customer, {
    items: [
      { menuItemId: pizzaItem.id, quantity: 1 },
      { menuItemId: unavailableItem.id, quantity: 1 },
    ],
    payment: { method: 'wallet' },
  });
  assert.equal(mixed.status, 400, mixed.text);

  assert.equal(await myOrderCount(), before, 'no order may be created for a rejected cart');
});

test('Stage 3 fix (2) — an item from an outlet that is switched off cannot be ordered', async () => {
  const before = await myOrderCount();

  // The item itself is available — only its outlet is closed.
  const res = await placeOrder(customer, {
    items: [{ menuItemId: inactiveOutletItem.id, quantity: 1 }],
    payment: { method: 'card' },
  });
  assert.equal(res.status, 400, res.text);
  assert.match(res.text, /not accepting orders/i);
  assert.match(res.text, new RegExp(inactiveOutletItem.name), 'the message must name the item');
  assert.equal(await myOrderCount(), before, 'a rejected cart must not create an order');

  // A cart mixing an item from an open outlet with one from the closed outlet
  // is refused as a whole — no partial order.
  const mixed = await placeOrder(customer, {
    items: [
      { menuItemId: pizzaItem.id, quantity: 1 },
      { menuItemId: inactiveOutletItem.id, quantity: 1 },
    ],
    payment: { method: 'card' },
  });
  assert.equal(mixed.status, 400, mixed.text);
  assert.equal(await myOrderCount(), before, 'the whole cart must be refused, not partly ordered');

  // The check really does run inside the checkout transaction: a validator that
  // throws after BEGIN must abort the write before anything is inserted.
  await assert.rejects(
    () =>
      orderModel.createOrderWithOutletOrders({
        customerId: customer.user.id,
        totalAmount: 12.34,
        paymentMethod: 'card',
        outletOrders: [
          {
            outletId: PIZZA_OUTLET,
            pickupCode: VALIDATION_MARKER,
            subtotal: 12.34,
            items: [
              {
                menuItemId: pizzaItem.id,
                name: pizzaItem.name,
                unitPrice: price(pizzaItem),
                quantity: 1,
              },
            ],
          },
        ],
        validateItems: async () => {
          const err = new Error('refused by the in-transaction validator');
          err.status = 400;
          throw err;
        },
      }),
    /refused by the in-transaction validator/
  );

  assert.equal(await myOrderCount(), before, 'failed in-transaction validation must persist nothing');

  const orphan = await query(
    'SELECT COUNT(*)::int AS n FROM outlet_orders WHERE pickup_code = $1',
    [VALIDATION_MARKER]
  );
  assert.equal(orphan.rows[0].n, 0, 'no outlet order may be written when validation fails');
});

test('Stage 3 fix (3) — duplicate menu item ids are merged into a single line', async () => {
  const before = await myOrderCount();

  const res = await placeOrder(customer, {
    items: [
      { menuItemId: pizzaItem.id, quantity: 2 },
      { menuItemId: pizzaItem.id, quantity: 3 },
    ],
    payment: { method: 'card' },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(await myOrderCount(), before + 1);

  assert.equal(res.body.outletOrders.length, 1, 'one item means one outlet order');
  const lines = res.body.outletOrders[0].items;
  assert.equal(lines.length, 1, 'the same item sent twice must not become two lines');
  assert.equal(lines[0].quantity, 5, 'quantities must be summed');
  assert.equal(Number(res.body.outletOrders[0].subtotal), round2(price(pizzaItem) * 5));

  // …and the database agrees.
  const stored = await query(
    `SELECT i.quantity
     FROM outlet_order_items i
     JOIN outlet_orders oo ON oo.id = i.outlet_order_id
     WHERE oo.order_id = $1 AND i.menu_item_id = $2`,
    [res.body.orderId, pizzaItem.id]
  );
  assert.equal(stored.rowCount, 1, 'exactly one stored line for the duplicated item');
  assert.equal(stored.rows[0].quantity, 5);
});

test('Stage 3 fix (3) — the per-item cap applies to the merged quantity', async () => {
  const before = await myOrderCount();

  // 30 + 30 only breaks the cap after merging; neither entry does on its own,
  // so this is exactly the hole the merge closes.
  const over = await placeOrder(customer, {
    items: [
      { menuItemId: pizzaItem.id, quantity: 30 },
      { menuItemId: pizzaItem.id, quantity: 30 },
    ],
    payment: { method: 'card' },
  });
  assert.equal(over.status, 400, over.text);
  assert.match(over.text, /exceeds the maximum of 50/i);
  assert.equal(await myOrderCount(), before);

  // 25 + 25 lands exactly on the cap and is fine.
  const onTheCap = await placeOrder(customer, {
    items: [
      { menuItemId: pizzaItem.id, quantity: 25 },
      { menuItemId: pizzaItem.id, quantity: 25 },
    ],
    payment: { method: 'card' },
  });
  assert.equal(onTheCap.status, 201, onTheCap.text);
  assert.equal(onTheCap.body.outletOrders[0].items[0].quantity, 50);
});

test('Stage 3 fix (3) — the service rejects bad quantities even when validation is bypassed', async () => {
  // These go straight to the service, i.e. past the Joi schema.
  for (const quantity of [0, -1, 1.5, 51, 'abc', null]) {
    await assert.rejects(
      () => orderService.placeOrder(customer.user.id, [{ menuItemId: pizzaItem.id, quantity }], 'card'),
      (err) => err.status === 400,
      `quantity ${JSON.stringify(quantity)} should be rejected by the service`
    );
  }

  await assert.rejects(
    () => orderService.placeOrder(customer.user.id, [{ quantity: 1 }], 'card'),
    (err) => err.status === 400,
    'an entry without a menu item id should be rejected'
  );

  await assert.rejects(
    () =>
      orderService.placeOrder(
        customer.user.id,
        [{ menuItemId: pizzaItem.id, quantity: 1 }],
        'bitcoin'
      ),
    (err) => err.status === 400,
    'an unsupported payment method should be rejected'
  );
});

test('Stage 3 fix (4) — the simulated payment method is recorded on the order', async () => {
  const before = await myOrderCount();

  const res = await placeOrder(customer, {
    items: [{ menuItemId: pastaItem.id, quantity: 1 }],
    payment: { method: 'upi' },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.body.order.paymentMethod, 'upi');

  const stored = await query('SELECT payment_method FROM orders WHERE id = $1', [
    res.body.orderId,
  ]);
  assert.equal(stored.rows[0].payment_method, 'upi');

  // The confirmation page reads it back through the API.
  const detail = await api(ctx.baseUrl, 'GET', `/api/orders/${res.body.orderId}`, {
    cookie: customer.cookie,
  });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.body.order.paymentMethod, 'upi');

  // Only the three simulated methods are accepted.
  const invalid = await placeOrder(customer, {
    items: [{ menuItemId: pastaItem.id, quantity: 1 }],
    payment: { method: 'bitcoin' },
  });
  assert.equal(invalid.status, 400, invalid.text);

  assert.equal(await myOrderCount(), before + 1, 'only the valid checkout may create an order');
});

test('Stage 3 fix (1) — a pickup code that already exists is detected and never stored twice', async () => {
  // A constant generator makes the collision certain instead of astronomically
  // unlikely: every attempt produces the exact same code. Only this test runs
  // at a time (node:test runs each file in its own process, tests in a file
  // sequentially), so stubbing Math.random cannot disturb anything else.
  const originalRandom = Math.random;
  Math.random = () => 0.99;

  try {
    // First checkout: the generated code is free, so it is stored normally.
    const first = await orderService.placeOrder(
      customer.user.id,
      [{ menuItemId: pizzaItem.id, quantity: 1 }],
      'card'
    );
    const takenCode = first.outletOrders[0].pickupCode;
    assert.ok(takenCode, 'expected the first checkout to be given a pickup code');

    const before = await myOrderCount();

    // Second checkout: the generator now emits a code the database already
    // holds. The unique index rejects it, the service retries with fresh codes
    // (which collide again, because the generator is stuck) and finally gives
    // up cleanly rather than looping or writing a duplicate.
    await assert.rejects(
      () =>
        orderService.placeOrder(
          customer.user.id,
          [{ menuItemId: pizzaItem.id, quantity: 1 }],
          'card'
        ),
      (err) => err.status === 409,
      'an unresolvable collision must fail cleanly'
    );

    assert.equal(await myOrderCount(), before, 'the retried attempts must persist nothing');

    const owners = await query(
      'SELECT COUNT(*)::int AS n FROM outlet_orders WHERE pickup_code = $1',
      [takenCode]
    );
    assert.equal(owners.rows[0].n, 1, 'exactly one outlet order may own that code');
  } finally {
    Math.random = originalRandom;
  }
});

test('Stage 3 — a mid-transaction failure rolls the entire order back', async () => {
  const before = await myOrderCount();

  // The parent order and the outlet order are written first; the item insert
  // then fails on a foreign key to a non-existent menu item. Everything the
  // transaction wrote before that point must be rolled back.
  await assert.rejects(
    () =>
      orderModel.createOrderWithOutletOrders({
        customerId: customer.user.id,
        totalAmount: 12.34,
        outletOrders: [
          {
            outletId: PIZZA_OUTLET,
            pickupCode: ROLLBACK_MARKER,
            subtotal: 12.34,
            items: [
              { menuItemId: MISSING_UUID, name: 'Ghost item', unitPrice: 12.34, quantity: 1 },
            ],
          },
        ],
      }),
    (err) => err.code === '23503'
  );

  assert.equal(await myOrderCount(), before, 'the rolled-back parent order must not exist');

  const orphan = await query(
    'SELECT COUNT(*)::int AS n FROM outlet_orders WHERE pickup_code = $1',
    [ROLLBACK_MARKER]
  );
  assert.equal(orphan.rows[0].n, 0, 'the rolled-back outlet order must not exist');
});

test('Stage 3 — the confirmation endpoint returns a full order to its owner only', async () => {
  assert.ok(orderId, 'expected the checkout test to have created an order');

  const owner = await api(ctx.baseUrl, 'GET', `/api/orders/${orderId}`, { cookie: customer.cookie });
  assert.equal(owner.status, 200, owner.text);
  assert.equal(owner.body.order.outletOrders.length, 2);

  // The confirmation page renders these fields, so assert they are present.
  for (const outletOrder of owner.body.order.outletOrders) {
    assert.ok(outletOrder.pickupCode, 'each sub-order needs a pickup code');
    assert.ok(outletOrder.outletName, 'each sub-order needs its outlet name');
    assert.ok(Array.isArray(outletOrder.items) && outletOrder.items.length > 0);
  }

  const stranger = await api(ctx.baseUrl, 'GET', `/api/orders/${orderId}`, {
    cookie: otherCustomer.cookie,
  });
  assert.equal(stranger.status, 403, stranger.text);
});

test('Stage 3 — only authenticated customers can place orders', async () => {
  const body = {
    items: [{ menuItemId: pizzaItem.id, quantity: 1 }],
    payment: { method: 'card' },
  };

  const anonymous = await api(ctx.baseUrl, 'POST', '/api/orders', { body });
  assert.equal(anonymous.status, 401, anonymous.text);

  // A staff login lives in the staff cookie, which the customer-only checkout
  // endpoint never reads.
  const staff = await api(ctx.baseUrl, 'POST', '/api/orders', { cookie: employee.cookie, body });
  assert.equal(staff.status, 401, staff.text);
});
