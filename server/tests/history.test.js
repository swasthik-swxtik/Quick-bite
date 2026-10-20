/**
 * History management — "delete from history" is an archive, never a delete.
 *
 * Verifies:
 *   - a customer can hide only a fully `collected` parent order, and only their own
 *   - an employee can archive only a `collected` outlet order of their own outlet
 *     (admins may archive any outlet's completed order)
 *   - active orders (confirmed / preparing / ready / partially ready) are refused
 *   - hidden parent orders disappear from the customer's list and from the owner's
 *     detail endpoint (404), while admins keep their record access
 *   - archived outlet orders disappear from that outlet's queue only: the parent
 *     order, the customer's history, the other outlets and the admin views stay
 *   - the underlying rows are never modified: order status, items, payment method
 *     and pickup codes are byte-for-byte unchanged after archiving
 *   - repeat calls are idempotent, one archive row per entry
 *   - no archive response or staff payload ever carries a pickup code
 *   - sessions are pinned: a staff cookie cannot use the customer endpoint and a
 *     customer cookie cannot use the staff endpoint
 *
 * Runs against the real database. Every row this file creates is removed in
 * `after()`, and assertions are scoped to the ids this file created, because
 * `node --test` runs test FILES in parallel and the seeded outlets are shared.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, login, api } = require('./helpers/server');
const { query } = require('../src/config/db');

const PIZZA_OUTLET = '11111111-1111-1111-1111-111111111111';
const PASTA_OUTLET = '22222222-2222-2222-2222-222222222222';
const MISSING_UUID = '00000000-0000-0000-0000-000000000000';
const UNIQUE = `${Date.now()}`;

let ctx;
let pizzaEmployee;
let pastaEmployee;
let admin;
let customer;
let otherCustomer;

let pizzaItem;
let pastaItem;

const createdUserIds = [];
const createdOrderIds = [];

// Orders created by one test and inspected by a later one.
let hiddenOrder;          // hidden by the customer (test 3)
let outletArchivedOrder;  // pizza sub-order archived (test 5)

const registerCustomer = async (label) => {
  const email = `history-${label}-${UNIQUE}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: `History ${label}`, email, password: 'test-password-123' },
  });
  assert.equal(res.status, 201, `register failed: ${res.text}`);
  createdUserIds.push(res.body.user.id);
  return login(ctx.baseUrl, email, 'test-password-123');
};

const placeOrder = async (auth, items) => {
  const res = await api(ctx.baseUrl, 'POST', '/api/orders', {
    cookie: auth.cookie,
    body: { items, payment: { method: 'card' } },
  });
  assert.equal(res.status, 201, `checkout failed: ${res.text}`);
  createdOrderIds.push(res.body.orderId);
  return res.body;
};

const placeSplitOrder = (auth) =>
  placeOrder(auth, [
    { menuItemId: pizzaItem.id, quantity: 1 },
    { menuItemId: pastaItem.id, quantity: 2 },
  ]);

const subOrderAt = (placed, outletId) =>
  placed.outletOrders.find((oo) => oo.outletId === outletId);

const employeeFor = (outletId) =>
  outletId === PIZZA_OUTLET ? pizzaEmployee : pastaEmployee;

const patchStatus = (auth, outletOrderId, body) =>
  api(ctx.baseUrl, 'PATCH', `/api/employee/outlet-orders/${outletOrderId}`, {
    cookie: auth.cookie,
    body,
  });

/** Walk an outlet order through the happy path to `collected`. */
const advanceToCollected = async (auth, outletOrderId, pickupCode) => {
  for (const status of ['preparing', 'ready']) {
    const res = await patchStatus(auth, outletOrderId, { status });
    assert.equal(res.status, 200, `advancing to ${status} failed: ${res.text}`);
  }
  const res = await patchStatus(auth, outletOrderId, { status: 'collected', pickupCode });
  assert.equal(res.status, 200, `collecting failed: ${res.text}`);
  return res.body;
};

/** A split order where every counter has finished (parent = 'collected'). */
const completeSplitOrder = async (auth = customer) => {
  const placed = await placeSplitOrder(auth);

  for (const sub of placed.outletOrders) {
    await advanceToCollected(employeeFor(sub.outletId), sub.id, sub.pickupCode);
  }

  return placed;
};

const listCustomerOrders = (auth) =>
  api(ctx.baseUrl, 'GET', '/api/orders', { cookie: auth.cookie });

const listOutletOrders = (auth) =>
  api(ctx.baseUrl, 'GET', '/api/employee/orders', { cookie: auth.cookie });

const orderDetail = (auth, orderId) =>
  api(ctx.baseUrl, 'GET', `/api/orders/${orderId}`, { cookie: auth.cookie });

const archiveCustomerOrder = (auth, orderId) =>
  api(ctx.baseUrl, 'DELETE', `/api/orders/${orderId}/history`, { cookie: auth.cookie });

const archiveOutletOrder = (auth, outletOrderId) =>
  api(ctx.baseUrl, 'DELETE', `/api/employee/outlet-orders/${outletOrderId}/history`, {
    cookie: auth.cookie,
  });

/** Snapshot of the rows a history action must never change. */
const snapshotOrder = async (orderId) => {
  const { rows: [order] } = await query(
    `SELECT o.status, o.total_amount AS "totalAmount", o.payment_method AS "paymentMethod"
     FROM orders o WHERE o.id = $1`,
    [orderId]
  );

  const { rows: outletOrders } = await query(
    `SELECT id, outlet_id AS "outletId", status, subtotal, pickup_code AS "pickupCode"
     FROM outlet_orders WHERE order_id = $1 ORDER BY created_at`,
    [orderId]
  );

  const { rows: [itemCount] } = await query(
    `SELECT COUNT(*)::int AS count
     FROM outlet_order_items i
     JOIN outlet_orders oo ON oo.id = i.outlet_order_id
     WHERE oo.order_id = $1`,
    [orderId]
  );

  return { order, outletOrders, itemCount: itemCount.count };
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

test('history archives — sessions are pinned and ownership is enforced', async () => {
  const placed = await completeSplitOrder();

  const anonymous = await api(ctx.baseUrl, 'DELETE', `/api/orders/${placed.orderId}/history`);
  assert.equal(anonymous.status, 401, anonymous.text);

  // A staff cookie must not be able to hide a customer's order.
  const asStaff = await archiveCustomerOrder(pizzaEmployee, placed.orderId);
  assert.equal(asStaff.status, 401, asStaff.text);

  // Another customer gets the same 404 as an unknown id (no existence leak).
  const asStranger = await archiveCustomerOrder(otherCustomer, placed.orderId);
  assert.equal(asStranger.status, 404, asStranger.text);

  const unknown = await archiveCustomerOrder(customer, MISSING_UUID);
  assert.equal(unknown.status, 404, unknown.text);

  const malformed = await archiveCustomerOrder(customer, 'not-a-uuid');
  assert.equal(malformed.status, 400, malformed.text);

  // Every attempt above failed, so the order is still in the history.
  const history = await listCustomerOrders(customer);
  assert.equal(history.status, 200, history.text);
  assert.ok(
    history.body.orders.some((o) => o.id === placed.orderId),
    'a completed order must stay listed while archiving is refused'
  );
});

test('history archives — active orders cannot be removed', async () => {
  // A split order so the parent is not completed until BOTH counters finish.
  const placed = await placeSplitOrder(customer);

  const pizzaSub = subOrderAt(placed, PIZZA_OUTLET);
  const pastaSub = subOrderAt(placed, PASTA_OUTLET);

  const assertStillListed = async (label) => {
    const history = await listCustomerOrders(customer);
    assert.ok(
      history.body.orders.some((o) => o.id === placed.orderId),
      `${label}: the order must stay in the history`
    );
  };

  // Parent 'confirmed'.
  let res = await archiveCustomerOrder(customer, placed.orderId);
  assert.equal(res.status, 409, `confirmed: ${res.text}`);
  assert.match(res.body.message, /completed/i);
  await assertStillListed('confirmed');

  // One counter preparing → parent 'preparing'.
  assert.equal((await patchStatus(pizzaEmployee, pizzaSub.id, { status: 'preparing' })).status, 200);
  res = await archiveCustomerOrder(customer, placed.orderId);
  assert.equal(res.status, 409, `preparing: ${res.text}`);
  await assertStillListed('preparing');

  // One counter ready, the other not → parent 'partially_ready'.
  assert.equal((await patchStatus(pizzaEmployee, pizzaSub.id, { status: 'ready' })).status, 200);
  res = await archiveCustomerOrder(customer, placed.orderId);
  assert.equal(res.status, 409, `partially ready: ${res.text}`);
  await assertStillListed('partially_ready');

  // One counter collected, the other still working → still not completed.
  assert.equal(
    (await patchStatus(pizzaEmployee, pizzaSub.id, { status: 'collected', pickupCode: pizzaSub.pickupCode })).status,
    200
  );
  res = await archiveCustomerOrder(customer, placed.orderId);
  assert.equal(res.status, 409, `one counter collected: ${res.text}`);
  await assertStillListed('collected + active sibling');

  // Every counter collected → parent 'collected' → now allowed.
  assert.equal((await patchStatus(pastaEmployee, pastaSub.id, { status: 'preparing' })).status, 200);
  assert.equal((await patchStatus(pastaEmployee, pastaSub.id, { status: 'ready' })).status, 200);
  assert.equal(
    (await patchStatus(pastaEmployee, pastaSub.id, { status: 'collected', pickupCode: pastaSub.pickupCode })).status,
    200
  );

  const { rows: [parent] } = await query('SELECT status FROM orders WHERE id = $1', [placed.orderId]);
  assert.equal(parent.status, 'collected');
});

test('history archives — a customer hides a completed parent order only', async () => {
  const placed = await completeSplitOrder();
  hiddenOrder = placed;

  const before = await snapshotOrder(placed.orderId);
  assert.equal(before.order.status, 'collected');
  assert.equal(before.outletOrders.length, 2);
  assert.ok(before.itemCount > 0);

  const res = await archiveCustomerOrder(customer, placed.orderId);
  assert.equal(res.status, 204, res.text);
  assert.equal(res.text, '', 'a 204 must not carry a body (and therefore no codes)');

  // Gone from this customer's list...
  const history = await listCustomerOrders(customer);
  assert.ok(
    !history.body.orders.some((o) => o.id === placed.orderId),
    'the hidden order must not be returned by GET /api/orders'
  );

  // ...and gone from the owner's detail view (404, like an unknown id).
  const ownerDetail = await orderDetail(customer, placed.orderId);
  assert.equal(ownerDetail.status, 404, ownerDetail.text);

  // Admins keep their record access, still with every outlet sub-order.
  const adminDetail = await orderDetail(admin, placed.orderId);
  assert.equal(adminDetail.status, 200, adminDetail.text);
  assert.equal(adminDetail.body.order.outletOrders.length, 2);

  // The underlying rows are untouched.
  const snapshot = await snapshotOrder(placed.orderId);
  assert.deepEqual(snapshot, before, 'archiving must not modify the order, items or pickup codes');

  // Exactly one archive row, owned by this customer.
  const { rows: archives } = await query(
    `SELECT customer_id AS "customerId" FROM customer_order_archives WHERE order_id = $1`,
    [placed.orderId]
  );
  assert.equal(archives.length, 1);
  assert.equal(archives[0].customerId, customer.user.id);

  // Idempotent: the second call succeeds and does not add a row.
  const again = await archiveCustomerOrder(customer, placed.orderId);
  assert.equal(again.status, 204, again.text);

  const { rows: [count] } = await query(
    'SELECT COUNT(*)::int AS count FROM customer_order_archives WHERE order_id = $1',
    [placed.orderId]
  );
  assert.equal(count.count, 1);
});

test('history archives — a customer hide never touches the outlet queues', async () => {
  const pizzaSub = subOrderAt(hiddenOrder, PIZZA_OUTLET);
  const pastaSub = subOrderAt(hiddenOrder, PASTA_OUTLET);

  const pizzaQueue = await listOutletOrders(pizzaEmployee);
  const pastaQueue = await listOutletOrders(pastaEmployee);
  assert.equal(pizzaQueue.status, 200, pizzaQueue.text);
  assert.equal(pastaQueue.status, 200, pastaQueue.text);

  assert.ok(
    pizzaQueue.body.orders.some((o) => o.id === pizzaSub.id),
    'the pizza counter must still see its collected order'
  );
  assert.ok(
    pastaQueue.body.orders.some((o) => o.id === pastaSub.id),
    'the pasta counter must still see its collected order'
  );

  // The other customer's history is unaffected (and never contained it).
  const otherHistory = await listCustomerOrders(otherCustomer);
  assert.ok(!otherHistory.body.orders.some((o) => o.id === hiddenOrder.orderId));
});

test('history archives — an outlet archives its own completed order only', async () => {
  const placed = await completeSplitOrder();
  outletArchivedOrder = placed;

  const pizzaSub = subOrderAt(placed, PIZZA_OUTLET);
  const pastaSub = subOrderAt(placed, PASTA_OUTLET);
  const before = await snapshotOrder(placed.orderId);

  const res = await archiveOutletOrder(pizzaEmployee, pizzaSub.id);
  assert.equal(res.status, 204, res.text);
  assert.equal(res.text, '', 'a 204 must not carry a body (and therefore no codes)');

  // This outlet's queue no longer has it; the other outlet still has its own.
  const pizzaQueue = await listOutletOrders(pizzaEmployee);
  const pastaQueue = await listOutletOrders(pastaEmployee);
  assert.ok(
    !pizzaQueue.body.orders.some((o) => o.id === pizzaSub.id),
    'the archived outlet order must leave the pizza queue'
  );
  assert.ok(
    pastaQueue.body.orders.some((o) => o.id === pastaSub.id),
    'the pasta queue must be unaffected'
  );

  // The customer's history still has the parent order and BOTH pickup codes.
  const history = await listCustomerOrders(customer);
  const current = history.body.orders.find((o) => o.id === placed.orderId);
  assert.ok(current, 'the customer history must keep the parent order');
  assert.deepEqual(
    current.outletOrders.map((o) => o.pickupCode).sort(),
    [pizzaSub.pickupCode, pastaSub.pickupCode].sort(),
    'the customer must still see every pickup code'
  );

  // The customer's detail view is intact too (archiving is staff-side only).
  const detail = await orderDetail(customer, placed.orderId);
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.body.order.outletOrders.length, 2);

  // Nothing was modified: same statuses, subtotals and pickup codes.
  assert.deepEqual(await snapshotOrder(placed.orderId), before);

  // One archive row, attributed to the employee and the outlet.
  const { rows: archives } = await query(
    `SELECT outlet_id AS "outletId", archived_by AS "archivedBy"
     FROM outlet_order_archives WHERE outlet_order_id = $1`,
    [pizzaSub.id]
  );
  assert.equal(archives.length, 1);
  assert.equal(archives[0].outletId, PIZZA_OUTLET);
  assert.equal(archives[0].archivedBy, pizzaEmployee.user.id);

  // Idempotent.
  const again = await archiveOutletOrder(pizzaEmployee, pizzaSub.id);
  assert.equal(again.status, 204, again.text);
  const { rows: [count] } = await query(
    'SELECT COUNT(*)::int AS count FROM outlet_order_archives WHERE outlet_order_id = $1',
    [pizzaSub.id]
  );
  assert.equal(count.count, 1);

  // The admin still sees both sub-orders.
  const adminDetail = await orderDetail(admin, placed.orderId);
  assert.equal(adminDetail.status, 200, adminDetail.text);
  assert.equal(adminDetail.body.order.outletOrders.length, 2);
});

test('history archives — employees cannot archive an active outlet order', async () => {
  // A fresh split order so the parent is not completed until both counters finish.
  const fresh = await placeSplitOrder(customer);
  const freshPizza = subOrderAt(fresh, PIZZA_OUTLET);

  let res = await archiveOutletOrder(pizzaEmployee, freshPizza.id);
  assert.equal(res.status, 409, `confirmed: ${res.text}`);
  assert.match(res.body.message, /completed/i);

  assert.equal((await patchStatus(pizzaEmployee, freshPizza.id, { status: 'preparing' })).status, 200);
  res = await archiveOutletOrder(pizzaEmployee, freshPizza.id);
  assert.equal(res.status, 409, `preparing: ${res.text}`);

  assert.equal((await patchStatus(pizzaEmployee, freshPizza.id, { status: 'ready' })).status, 200);
  res = await archiveOutletOrder(pizzaEmployee, freshPizza.id);
  assert.equal(res.status, 409, `ready: ${res.text}`);

  // Still in the queue after every refusal.
  const queue = await listOutletOrders(pizzaEmployee);
  assert.ok(queue.body.orders.some((o) => o.id === freshPizza.id));
});

test('history archives — employees cannot archive another outlet\'s order', async () => {
  const placed = await completeSplitOrder();
  const pizzaSub = subOrderAt(placed, PIZZA_OUTLET);

  const anonymous = await api(
    ctx.baseUrl,
    'DELETE',
    `/api/employee/outlet-orders/${pizzaSub.id}/history`
  );
  assert.equal(anonymous.status, 401, anonymous.text);

  // A customer cookie is not a staff session.
  const asCustomer = await archiveOutletOrder(customer, pizzaSub.id);
  assert.equal(asCustomer.status, 401, asCustomer.text);

  // Legitimately completed, but it belongs to the pizza counter.
  const asPasta = await archiveOutletOrder(pastaEmployee, pizzaSub.id);
  assert.equal(asPasta.status, 404, asPasta.text);

  const unknown = await archiveOutletOrder(pizzaEmployee, MISSING_UUID);
  assert.equal(unknown.status, 404, unknown.text);

  const malformed = await archiveOutletOrder(pizzaEmployee, 'not-a-uuid');
  assert.equal(malformed.status, 400, malformed.text);

  // The pizza queue still has it.
  const pizzaQueue = await listOutletOrders(pizzaEmployee);
  assert.ok(pizzaQueue.body.orders.some((o) => o.id === pizzaSub.id));

  // Admins may archive any outlet's completed order.
  const asAdmin = await archiveOutletOrder(admin, pizzaSub.id);
  assert.equal(asAdmin.status, 204, asAdmin.text);

  const afterAdmin = await listOutletOrders(pizzaEmployee);
  assert.ok(!afterAdmin.body.orders.some((o) => o.id === pizzaSub.id));

  // ...but never an active one.
  const fresh = await placeSplitOrder(customer);
  const freshSub = subOrderAt(fresh, PIZZA_OUTLET);
  const refused = await archiveOutletOrder(admin, freshSub.id);
  assert.equal(refused.status, 409, refused.text);
});

test('history archives — no staff response or payload carries a pickup code', async () => {
  const pizzaQueue = await listOutletOrders(pizzaEmployee);
  const pastaQueue = await listOutletOrders(pastaEmployee);

  const codes = [
    ...outletArchivedOrder.outletOrders.map((o) => o.pickupCode),
    ...hiddenOrder.outletOrders.map((o) => o.pickupCode),
  ];

  for (const code of codes) {
    assert.ok(!pizzaQueue.text.includes(code), `pizza queue leaked a pickup code (${code})`);
    assert.ok(!pastaQueue.text.includes(code), `pasta queue leaked a pickup code (${code})`);
  }

  // The customer's own view still has its codes (the feature removes rows, not
  // proofs of collection).
  const history = await listCustomerOrders(customer);
  assert.ok(history.text.includes(outletArchivedOrder.outletOrders[0].pickupCode));
});
