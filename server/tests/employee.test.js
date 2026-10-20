/**
 * Stage 4 — The employee dashboard contract.
 *
 * Verifies the rules this stage depends on:
 *   - the queue is scoped to the employee's OWN outlet (server-side, from the JWT)
 *   - an employee cannot read or change another outlet's order (IDOR)
 *   - status transitions are validated server-side, one step at a time
 *   - an order can only be marked collected with the matching pickup code
 *   - the parent order status is recalculated from its outlet orders
 *   - a status change is pushed to the customer tracking that order
 *   - only staff can use the employee API at all
 *   - a pickup code is only accepted for the exact outlet order it belongs to,
 *     only once the order is ready, and only until it has been collected
 *   - repeated wrong codes lock the attempt out instead of allowing a brute force
 *   - no staff response or socket payload ever carries a pickup code, while the
 *     customer's own history and tracking view still do
 *
 * Runs against the real database. Every row this file creates is removed in
 * `after()`, and every assertion is scoped to the ids this file created, because
 * `node --test` runs test FILES in parallel and the seeded outlet is shared.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  startServer,
  login,
  api,
  connectSocket,
  expectConnection,
  waitForEvent,
} = require('./helpers/server');
const { query } = require('../src/config/db');
const { pickupCodeLimiter } = require('../src/middleware/rateLimit');

const PIZZA_OUTLET = '11111111-1111-1111-1111-111111111111';
const PASTA_OUTLET = '22222222-2222-2222-2222-222222222222';
const UNIQUE = `${Date.now()}`;

let ctx;
let pizzaEmployee;   // employee of PIZZA_OUTLET
let pastaEmployee;   // employee of PASTA_OUTLET
let admin;           // role 'admin', not assigned to any outlet
let customer;        // places the orders under test
let otherCustomer;   // a different customer

let pizzaItem;       // available seeded item on PIZZA_OUTLET
let pastaItem;       // available seeded item on PASTA_OUTLET

const createdUserIds = [];
const createdOrderIds = [];

const registerCustomer = async (label) => {
  const email = `stage4-${label}-${UNIQUE}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: `Stage4 ${label}`, email, password: 'test-password-123' },
  });
  assert.equal(res.status, 201, `register failed: ${res.text}`);
  createdUserIds.push(res.body.user.id);
  return login(ctx.baseUrl, email, 'test-password-123');
};

/** Place a real order and remember it for cleanup. */
const placeOrder = async (auth, items) => {
  const res = await api(ctx.baseUrl, 'POST', '/api/orders', {
    cookie: auth.cookie,
    body: { items, payment: { method: 'card' } },
  });
  assert.equal(res.status, 201, `checkout failed: ${res.text}`);
  createdOrderIds.push(res.body.orderId);
  return res.body;
};

/** An order split across both outlets (one sub-order each). */
const placeSplitOrder = (auth) =>
  placeOrder(auth, [
    { menuItemId: pizzaItem.id, quantity: 1 },
    { menuItemId: pastaItem.id, quantity: 2 },
  ]);

const subOrderAt = (placed, outletId) =>
  placed.outletOrders.find((oo) => oo.outletId === outletId);

const patchStatus = (auth, outletOrderId, body) =>
  api(ctx.baseUrl, 'PATCH', `/api/employee/outlet-orders/${outletOrderId}`, {
    cookie: auth.cookie,
    body,
  });

const listOrders = (auth) => api(ctx.baseUrl, 'GET', '/api/employee/orders', { cookie: auth.cookie });

const orderDetail = (auth, orderId) =>
  api(ctx.baseUrl, 'GET', `/api/orders/${orderId}`, { cookie: auth.cookie });

const dbOutletStatus = async (outletOrderId) =>
  (await query('SELECT status FROM outlet_orders WHERE id = $1', [outletOrderId])).rows[0].status;

/** Walk an outlet order through the happy path up to `target`. */
const advanceTo = async (auth, outletOrderId, pickupCode, target) => {
  const path = ['preparing', 'ready', 'collected'];
  for (const status of path) {
    const res = await patchStatus(
      auth,
      outletOrderId,
      status === 'collected' ? { status, pickupCode } : { status }
    );
    assert.equal(res.status, 200, `advancing to ${status} failed: ${res.text}`);
    if (status === target) return res.body;
  }
  return null;
};

before(async () => {
  ctx = await startServer();

  pizzaEmployee = await login(ctx.baseUrl, 'pizza@quickbite.com');
  pastaEmployee = await login(ctx.baseUrl, 'pasta@quickbite.com');
  admin         = await login(ctx.baseUrl, 'admin@quickbite.com');
  customer      = await registerCustomer('buyer');
  otherCustomer = await registerCustomer('other');

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
  if (createdOrderIds.length) {
    await query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [createdOrderIds]);
  }
  if (createdUserIds.length) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }
  await ctx.close();
});

test('Stage 4 — only staff can use the employee API', async () => {
  const anonymous = await api(ctx.baseUrl, 'GET', '/api/employee/orders');
  assert.equal(anonymous.status, 401, anonymous.text);

  // A customer login lives in the customer cookie, so a staff route (which
  // reads only the staff cookie) never even authenticates it.
  const asCustomer = await listOrders(customer);
  assert.equal(asCustomer.status, 401, asCustomer.text);

  const patchAsCustomer = await patchStatus(customer, '00000000-0000-0000-0000-000000000000', {
    status: 'preparing',
  });
  assert.equal(patchAsCustomer.status, 401, patchAsCustomer.text);
});

test('Stage 4 — the queue shows only the employee\'s own outlet', async () => {
  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);
  const pastaSubOrder = subOrderAt(placed, PASTA_OUTLET);

  const pizzaQueue = await listOrders(pizzaEmployee);
  assert.equal(pizzaQueue.status, 200, pizzaQueue.text);

  const pizzaIds = pizzaQueue.body.orders.map((o) => o.id);
  assert.ok(pizzaIds.includes(pizzaSubOrder.id), 'the pizza queue must contain the pizza sub-order');
  assert.ok(
    !pizzaIds.includes(pastaSubOrder.id),
    'the pizza queue must NOT contain another outlet\'s sub-order'
  );

  const pastaQueue = await listOrders(pastaEmployee);
  assert.equal(pastaQueue.status, 200, pastaQueue.text);

  const pastaIds = pastaQueue.body.orders.map((o) => o.id);
  assert.ok(pastaIds.includes(pastaSubOrder.id));
  assert.ok(!pastaIds.includes(pizzaSubOrder.id));

  // The dashboard renders exactly these fields, so pin them down.
  const row = pizzaQueue.body.orders.find((o) => o.id === pizzaSubOrder.id);
  assert.equal(row.orderId, placed.orderId);
  assert.equal(row.status, 'confirmed');
  assert.ok(row.createdAt, 'the queue needs a timestamp per order');
  assert.equal(row.items.length, 1);
  assert.equal(row.items[0].name, pizzaItem.name);

  // The pickup code is the customer's, not the kitchen's: the employee has to
  // read it off the customer, so the queue must never carry it.
  assert.equal(
    JSON.stringify(row).includes(pizzaSubOrder.pickupCode),
    false,
    'the employee queue must not expose the pickup code'
  );
});

test('Stage 4 — an employee cannot change another outlet\'s order', async () => {
  const placed = await placeSplitOrder(customer);
  const pastaSubOrder = subOrderAt(placed, PASTA_OUTLET);

  const forbidden = await patchStatus(pizzaEmployee, pastaSubOrder.id, { status: 'preparing' });
  assert.equal(forbidden.status, 403, forbidden.text);
  assert.match(forbidden.text, /different outlet/i);

  // …and nothing was written.
  assert.equal(await dbOutletStatus(pastaSubOrder.id), 'confirmed');

  // The outlet that owns it can.
  const allowed = await patchStatus(pastaEmployee, pastaSubOrder.id, { status: 'preparing' });
  assert.equal(allowed.status, 200, allowed.text);
  assert.equal(await dbOutletStatus(pastaSubOrder.id), 'preparing');
});

test('Stage 4 — status transitions are validated server-side', async () => {
  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);
  const { pickupCode } = pizzaSubOrder;

  // An unknown status is rejected outright.
  const unknown = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'cancelled' });
  assert.equal(unknown.status, 400, unknown.text);

  // Skipping a step is refused, with the current status in the message.
  const skip = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'ready' });
  assert.equal(skip.status, 400, skip.text);
  assert.match(skip.text, /from 'confirmed' to 'ready'/);

  // Jumping straight to collected is refused too.
  const skipToCollected = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode,
  });
  assert.equal(skipToCollected.status, 400, skipToCollected.text);
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'confirmed');

  // Step by step it works…
  const preparing = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'preparing' });
  assert.equal(preparing.status, 200, preparing.text);
  assert.equal(preparing.body.outletOrder.status, 'preparing');

  // …a repeat of the same step is not a valid transition…
  const repeat = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'preparing' });
  assert.equal(repeat.status, 400, repeat.text);

  const ready = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'ready' });
  assert.equal(ready.status, 200, ready.text);

  // …and a collected order is terminal.
  const collected = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode,
  });
  assert.equal(collected.status, 200, collected.text);

  const afterTerminal = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'preparing' });
  assert.equal(afterTerminal.status, 400, afterTerminal.text);
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'collected');
});

test('Stage 4 — collecting an order requires the matching pickup code', async () => {
  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);

  // Get it to 'ready'.
  for (const status of ['preparing', 'ready']) {
    const res = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status });
    assert.equal(res.status, 200, res.text);
  }

  // No code at all — the schema requires it for 'collected'.
  const missing = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'collected' });
  assert.equal(missing.status, 400, missing.text);

  // Wrong code — refused, and the order stays 'ready'.
  const wrong = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode: 'ZZ0000',
  });
  assert.equal(wrong.status, 400, wrong.text);
  assert.match(wrong.text, /incorrect pickup code/i);
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'ready');

  // Correct code — accepted.
  const correct = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode: pizzaSubOrder.pickupCode,
  });
  assert.equal(correct.status, 200, correct.text);
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'collected');
});

test('Stage 4 — the parent order status is recalculated from its outlet orders', async () => {
  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);
  const pastaSubOrder = subOrderAt(placed, PASTA_OUTLET);

  const parentStatus = async () => (await orderDetail(customer, placed.orderId)).body.order.status;

  assert.equal(await parentStatus(), 'confirmed');

  await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'preparing' });
  assert.equal(await parentStatus(), 'preparing');

  await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'ready' });
  assert.equal(await parentStatus(), 'partially_ready', 'one of two outlets is ready');

  await patchStatus(pastaEmployee, pastaSubOrder.id, { status: 'preparing' });
  assert.equal(await parentStatus(), 'partially_ready', 'still one of two ready');

  await patchStatus(pastaEmployee, pastaSubOrder.id, { status: 'ready' });
  assert.equal(await parentStatus(), 'ready', 'every outlet is ready');

  await patchStatus(pastaEmployee, pastaSubOrder.id, {
    status: 'collected',
    pickupCode: pastaSubOrder.pickupCode,
  });
  assert.equal(await parentStatus(), 'ready', 'one collected, one still ready');

  await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode: pizzaSubOrder.pickupCode,
  });
  assert.equal(await parentStatus(), 'collected', 'everything collected');
});

test('Stage 4 — a status change is pushed to the customer tracking that order', async () => {
  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);

  const customerSocket = connectSocket(ctx.baseUrl, { cookie: customer.cookie });
  await expectConnection(customerSocket);

  const joined = await new Promise((resolve) =>
    customerSocket.emit('join_order_room', placed.orderId, resolve)
  );
  assert.deepEqual(joined, { ok: true, room: `order:${placed.orderId}` });

  const event = waitForEvent(customerSocket, 'outlet_order_status_updated');

  const patched = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'preparing' });
  assert.equal(patched.status, 200, patched.text);

  const payload = await event;
  assert.equal(payload.outletOrderId, pizzaSubOrder.id);
  assert.equal(payload.outletId, PIZZA_OUTLET);
  assert.equal(payload.status, 'preparing');
  // The tracking page announces the code from the order it loaded, so the
  // broadcast (which also reaches the kitchen) must not carry it.
  assert.equal('pickupCode' in payload, false, 'the status event must not carry a pickup code');
  // The tracking page shows the overall status too — the server recalculates it.
  assert.equal(payload.orderStatus, 'preparing');

  customerSocket.close();
});

test('Stage 4 — customers can track their own order and nobody else\'s', async () => {
  const placed = await placeSplitOrder(customer);

  const owner = await orderDetail(customer, placed.orderId);
  assert.equal(owner.status, 200, owner.text);
  assert.equal(owner.body.order.outletOrders.length, 2, 'a split order keeps both sub-orders');

  const stranger = await orderDetail(otherCustomer, placed.orderId);
  assert.equal(stranger.status, 403, stranger.text);

  const anonymous = await api(ctx.baseUrl, 'GET', `/api/orders/${placed.orderId}`);
  assert.equal(anonymous.status, 401, anonymous.text);

  // A customer must not be able to join someone else's live room either.
  const strangerSocket = connectSocket(ctx.baseUrl, { cookie: otherCustomer.cookie });
  await expectConnection(strangerSocket);
  const refused = await new Promise((resolve) =>
    strangerSocket.emit('join_order_room', placed.orderId, resolve)
  );
  assert.deepEqual(refused, { ok: false, reason: 'forbidden' });
  strangerSocket.close();
});

test('Stage 4 — an admin can work any outlet queue, and has none of their own', async () => {
  const ownQueue = await listOrders(admin);
  assert.equal(ownQueue.status, 400, ownQueue.text);
  assert.match(ownQueue.text, /not assigned to any outlet/i);

  // Admins are trusted across outlets (the dashboard link is shown to them).
  const placed = await placeSplitOrder(customer);
  const pastaSubOrder = subOrderAt(placed, PASTA_OUTLET);

  const updated = await advanceTo(admin, pastaSubOrder.id, pastaSubOrder.pickupCode, 'preparing');
  assert.ok(updated, 'expected the admin status update to succeed');
  assert.equal(updated.outletOrder.status, 'preparing');
});

// ── Part B — collection verification ─────────────────────────────────────────

test('Part B — a pickup code only collects the outlet order it belongs to', async () => {
  const first = await placeSplitOrder(customer);
  const second = await placeSplitOrder(customer);

  const pizzaFirst = subOrderAt(first, PIZZA_OUTLET);
  const pizzaSecond = subOrderAt(second, PIZZA_OUTLET);
  const pastaFirst = subOrderAt(first, PASTA_OUTLET);

  const makeReady = async (subOrder) => {
    for (const status of ['preparing', 'ready']) {
      const res = await patchStatus(pizzaEmployee, subOrder.id, { status });
      assert.equal(res.status, 200, res.text);
    }
  };

  await makeReady(pizzaFirst);
  await makeReady(pizzaSecond);

  // Another order's code must not collect this one…
  const otherOrder = await patchStatus(pizzaEmployee, pizzaFirst.id, {
    status: 'collected',
    pickupCode: pizzaSecond.pickupCode,
  });
  assert.equal(otherOrder.status, 400, otherOrder.text);
  assert.match(otherOrder.text, /incorrect pickup code/i);
  assert.equal(await dbOutletStatus(pizzaFirst.id), 'ready');

  // …and neither does the sibling counter's code from the same order.
  const otherOutlet = await patchStatus(pizzaEmployee, pizzaFirst.id, {
    status: 'collected',
    pickupCode: pastaFirst.pickupCode,
  });
  assert.equal(otherOutlet.status, 400, otherOutlet.text);
  assert.equal(await dbOutletStatus(pizzaFirst.id), 'ready');

  // A failed attempt never leaks the expected code back.
  assert.equal(otherOutlet.text.includes(pizzaFirst.pickupCode), false);

  // The right code, typed with stray spaces and lower case, still works.
  const collected = await patchStatus(pizzaEmployee, pizzaFirst.id, {
    status: 'collected',
    pickupCode: `  ${pizzaFirst.pickupCode.toLowerCase()} `,
  });
  assert.equal(collected.status, 200, collected.text);
  assert.equal(await dbOutletStatus(pizzaFirst.id), 'collected');

  // An order that is not ready yet cannot be collected, correct code or not.
  const pending = await placeSplitOrder(customer);
  const pendingPizza = subOrderAt(pending, PIZZA_OUTLET);
  const tooEarly = await patchStatus(pizzaEmployee, pendingPizza.id, {
    status: 'collected',
    pickupCode: pendingPizza.pickupCode,
  });
  assert.equal(tooEarly.status, 400, tooEarly.text);
  assert.match(tooEarly.text, /cannot change status/i);
  assert.equal(await dbOutletStatus(pendingPizza.id), 'confirmed');

  // Collecting twice is refused, even with the code that just worked.
  const repeat = await patchStatus(pizzaEmployee, pizzaFirst.id, {
    status: 'collected',
    pickupCode: pizzaFirst.pickupCode,
  });
  assert.equal(repeat.status, 400, repeat.text);
  assert.equal(await dbOutletStatus(pizzaFirst.id), 'collected');
});

test('Part B — repeated wrong codes lock the attempt out', async () => {
  // This file shares the process-wide limiter with the tests above, so start
  // from a known state and clear it again before finishing.
  pickupCodeLimiter.reset();

  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);

  for (const status of ['preparing', 'ready']) {
    const res = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status });
    assert.equal(res.status, 200, res.text);
  }

  // A malformed code is a format problem, not a guess: it is refused by the
  // schema and cannot succeed, so it does not consume a guess…
  const malformed = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode: 'not-a-code',
  });
  assert.equal(malformed.status, 400, malformed.text);
  assert.match(malformed.text, /two letters followed by four digits/i);
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'ready');

  // …while five well-formed wrong codes fill the allowance.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const res = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
      status: 'collected',
      pickupCode: 'ZZ0000',
    });
    assert.equal(res.status, 400, `attempt ${attempt}: ${res.text}`);
    assert.match(res.text, /incorrect pickup code/i);
  }

  // The pair is now locked: even the correct code is refused, so a guesser
  // cannot keep walking the code space inside the lockout window.
  const locked = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode: pizzaSubOrder.pickupCode,
  });
  assert.equal(locked.status, 429, locked.text);
  assert.match(locked.text, /too many incorrect pickup codes/i);
  assert.equal(
    locked.text.includes(pizzaSubOrder.pickupCode),
    false,
    'a lockout response must not reveal the code'
  );
  assert.ok(locked.headers.get('retry-after'), 'a lockout says how long to wait');
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'ready');

  // Clear the lockout, then the customer collects normally: the lockout, not a
  // broken verification, is what refused the attempt above.
  pickupCodeLimiter.reset();

  const collected = await patchStatus(pizzaEmployee, pizzaSubOrder.id, {
    status: 'collected',
    pickupCode: pizzaSubOrder.pickupCode,
  });
  assert.equal(collected.status, 200, collected.text);
  assert.equal(await dbOutletStatus(pizzaSubOrder.id), 'collected');
});

test('Part B — staff never receive a pickup code, the customer always does', async () => {
  const placed = await placeSplitOrder(customer);
  const pizzaSubOrder = subOrderAt(placed, PIZZA_OUTLET);
  const code = pizzaSubOrder.pickupCode;

  // The employee queue.
  const queue = await listOrders(pizzaEmployee);
  const row = queue.body.orders.find((o) => o.id === pizzaSubOrder.id);
  assert.ok(row, 'the queue must contain the new sub-order');
  assert.equal(JSON.stringify(row).includes(code), false, 'the queue must not carry the code');

  // A status update response.
  const patched = await patchStatus(pizzaEmployee, pizzaSubOrder.id, { status: 'preparing' });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(JSON.stringify(patched.body).includes(code), false, 'the PATCH must not echo the code');

  // An admin is staff too: neither order endpoint hands them the code.
  const adminCustomerEndpoint = await orderDetail(admin, placed.orderId);
  assert.equal(adminCustomerEndpoint.status, 200, adminCustomerEndpoint.text);
  assert.equal(
    JSON.stringify(adminCustomerEndpoint.body).includes(code),
    false,
    'an admin reading /api/orders/:id must not receive the code'
  );

  const adminOrderEndpoint = await api(ctx.baseUrl, 'GET', `/api/admin/orders/${placed.orderId}`, {
    cookie: admin.cookie,
  });
  assert.equal(adminOrderEndpoint.status, 200, adminOrderEndpoint.text);
  assert.equal(
    JSON.stringify(adminOrderEndpoint.body).includes(code),
    false,
    'the admin order detail must not carry the code'
  );

  // …while the owning customer keeps it on their own order.
  const owner = await orderDetail(customer, placed.orderId);
  assert.equal(owner.status, 200, owner.text);
  assert.equal(
    owner.body.order.outletOrders.find((oo) => oo.id === pizzaSubOrder.id).pickupCode,
    code
  );
});

test('Part B — the customer history carries one pickup code per counter', async () => {
  const placed = await placeSplitOrder(customer);

  const res = await api(ctx.baseUrl, 'GET', '/api/orders', { cookie: customer.cookie });
  assert.equal(res.status, 200, res.text);

  const order = res.body.orders.find((o) => o.id === placed.orderId);
  assert.ok(order, 'a new order must appear in the customer history');
  assert.equal(order.outletOrders.length, 2, 'both sub-orders must be listed');

  const byOutlet = new Map(order.outletOrders.map((oo) => [oo.outletId, oo]));

  assert.equal(byOutlet.get(PIZZA_OUTLET).pickupCode, subOrderAt(placed, PIZZA_OUTLET).pickupCode);
  assert.equal(byOutlet.get(PASTA_OUTLET).pickupCode, subOrderAt(placed, PASTA_OUTLET).pickupCode);
  assert.equal(byOutlet.get(PIZZA_OUTLET).status, 'confirmed');
  assert.ok(byOutlet.get(PIZZA_OUTLET).outletName, 'the history needs the counter name');

  // A different customer's history never includes this order.
  const other = await api(ctx.baseUrl, 'GET', '/api/orders', { cookie: otherCustomer.cookie });
  assert.equal(other.status, 200, other.text);
  assert.equal(other.body.orders.some((o) => o.id === placed.orderId), false);
});
