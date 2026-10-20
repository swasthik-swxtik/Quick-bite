/**
 * Realtime tests.
 *
 * P1.6 — checkout pushes each outlet sub-order to that outlet's employee room.
 * P1.7 — `join_order_room` is authorised: customers only track their own orders.
 * P1.8 — a status change also reaches the owning outlet's employee room, and
 *        only that outlet's room.
 * P1.9 — outlet rooms: customers denied, employees assigned outlet only,
 *        admins any outlet.
 *
 * These tests run against the real database. They create two throwaway
 * customers and a couple of orders, then remove exactly those rows in `after()`.
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

const PIZZA_OUTLET  = '11111111-1111-1111-1111-111111111111';
const BURGER_OUTLET = '33333333-3333-3333-3333-333333333333';
const NO_SUCH_ORDER = '00000000-0000-0000-0000-000000000000';

let ctx;
let pizzaEmployee;
let burgerEmployee;
let customerA;
let customerB;
let admin;

const createdOrderIds = [];
const createdUserIds  = [];

const joinRoom       = (socket, outletId) => new Promise((r) => socket.emit('join_outlet_room', outletId, r));
const joinOrderRoom  = (socket, orderId)  => new Promise((r) => socket.emit('join_order_room', orderId, r));

const registerCustomer = async (label) => {
  const email = `p1-${label}-${Date.now()}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: `P1 ${label}`, email, password: 'test-password-123' },
  });
  assert.equal(res.status, 201, `registration failed: ${res.text}`);
  createdUserIds.push(res.body.user.id);
  return login(ctx.baseUrl, email, 'test-password-123');
};

const placeSingleItemOrder = async (customer, paymentMethod = 'card') => {
  const menu = await api(ctx.baseUrl, 'GET', `/api/outlets/${PIZZA_OUTLET}/menu`);
  assert.equal(menu.status, 200);
  const item = menu.body.items[0];

  const placed = await api(ctx.baseUrl, 'POST', '/api/orders', {
    cookie: customer.cookie,
    body: { items: [{ menuItemId: item.id, quantity: 1 }], payment: { method: paymentMethod } },
  });
  assert.equal(placed.status, 201, `checkout failed: ${placed.text}`);
  createdOrderIds.push(placed.body.orderId);

  return { placed: placed.body, item };
};

before(async () => {
  ctx = await startServer();

  pizzaEmployee  = await login(ctx.baseUrl, 'pizza@quickbite.com');
  burgerEmployee = await login(ctx.baseUrl, 'burger@quickbite.com');
  admin          = await login(ctx.baseUrl, 'admin@quickbite.com');

  customerA = await registerCustomer('owner');
  customerB = await registerCustomer('stranger');
});

after(async () => {
  // Remove only the rows this suite created (orders first — users are RESTRICTed)
  if (createdOrderIds.length > 0) {
    await query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [createdOrderIds]);
  }
  if (createdUserIds.length > 0) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }
  await ctx.close();
});

test('P1.6 — checkout emits new_outlet_order to the matching outlet room only', async () => {
  const pizzaSocket  = connectSocket(ctx.baseUrl, { cookie: pizzaEmployee.cookie });
  const burgerSocket = connectSocket(ctx.baseUrl, { cookie: burgerEmployee.cookie });
  const customerSocket = connectSocket(ctx.baseUrl, { cookie: customerA.cookie });

  await expectConnection(pizzaSocket);
  await expectConnection(burgerSocket);
  await expectConnection(customerSocket);

  assert.deepEqual(await joinRoom(pizzaSocket, PIZZA_OUTLET),   { ok: true, room: `outlet:${PIZZA_OUTLET}` });
  assert.deepEqual(await joinRoom(burgerSocket, BURGER_OUTLET), { ok: true, room: `outlet:${BURGER_OUTLET}` });

  // An employee must not be able to join a different outlet's room
  assert.deepEqual(await joinRoom(burgerSocket, PIZZA_OUTLET), { ok: false, reason: 'forbidden' });

  // A customer must never be able to join an outlet room
  assert.deepEqual(await joinRoom(customerSocket, PIZZA_OUTLET), { ok: false, reason: 'forbidden' });

  const menu = await api(ctx.baseUrl, 'GET', `/api/outlets/${PIZZA_OUTLET}/menu`);
  const [itemA, itemB] = menu.body.items;
  const expectedSubtotal = parseFloat(itemA.price) * 2 + parseFloat(itemB.price) * 1;

  const pizzaEvent  = waitForEvent(pizzaSocket, 'new_outlet_order');
  const burgerEvent = waitForEvent(burgerSocket, 'new_outlet_order', 600).then(() => 'received', () => 'none');
  const customerEvent = waitForEvent(customerSocket, 'new_outlet_order', 600).then(() => 'received', () => 'none');

  const placed = await api(ctx.baseUrl, 'POST', '/api/orders', {
    cookie: customerA.cookie,
    body: {
      items: [
        { menuItemId: itemA.id, quantity: 2 },
        { menuItemId: itemB.id, quantity: 1 },
      ],
      payment: { method: 'card' },
    },
  });

  assert.equal(placed.status, 201, `checkout failed: ${placed.text}`);
  createdOrderIds.push(placed.body.orderId);

  const payload = await pizzaEvent;

  assert.equal(payload.orderId, placed.body.orderId);
  assert.equal(payload.outletId, PIZZA_OUTLET);
  assert.equal(payload.status, 'confirmed');
  assert.equal(payload.items.length, 2);
  assert.equal(Number(payload.subtotal), expectedSubtotal);
  assert.equal(Number(placed.body.order.totalAmount), expectedSubtotal);

  // The payload is shaped for the dashboard row, and it must NOT carry the
  // pickup code: the kitchen has to read it off the customer.
  assert.ok(payload.id, 'the dashboard keys rows by the outlet order id');
  assert.ok(payload.createdAt, 'the dashboard shows when the order arrived');
  assert.equal(
    JSON.stringify(payload).includes(placed.body.outletOrders[0].pickupCode),
    false,
    'new_outlet_order must not expose the pickup code'
  );

  // Room scoping: the other outlet's employee and the customer must not
  // receive this event.
  assert.equal(await burgerEvent, 'none');
  assert.equal(await customerEvent, 'none');

  pizzaSocket.close();
  burgerSocket.close();
  customerSocket.close();
});

test('P1.7 — join_order_room authorises only the order owner', async () => {
  const { placed } = await placeSingleItemOrder(customerA, 'upi');
  const orderId = placed.orderId;
  const outletOrderId = placed.outletOrders[0].id;

  const ownerSocket    = connectSocket(ctx.baseUrl, { cookie: customerA.cookie });
  const strangerSocket = connectSocket(ctx.baseUrl, { cookie: customerB.cookie });
  const employeeSocket = connectSocket(ctx.baseUrl, { cookie: pizzaEmployee.cookie });

  await expectConnection(ownerSocket);
  await expectConnection(strangerSocket);
  await expectConnection(employeeSocket);

  // Only the owner may join: staff watch outlet queues, not customer rooms.
  assert.deepEqual(await joinOrderRoom(ownerSocket, orderId),    { ok: true, room: `order:${orderId}` });
  assert.deepEqual(await joinOrderRoom(strangerSocket, orderId), { ok: false, reason: 'forbidden' });
  assert.deepEqual(await joinOrderRoom(employeeSocket, orderId), { ok: false, reason: 'forbidden' });

  // Input handling
  assert.deepEqual(await joinOrderRoom(ownerSocket, 'not-a-uuid'),  { ok: false, reason: 'invalid_order_id' });
  assert.deepEqual(await joinOrderRoom(ownerSocket, NO_SUCH_ORDER), { ok: false, reason: 'not_found' });

  // An employee advancing the status must reach the owner, and no one else
  const ownerEvent    = waitForEvent(ownerSocket, 'outlet_order_status_updated');
  const strangerEvent = waitForEvent(strangerSocket, 'outlet_order_status_updated', 600).then(() => 'received', () => 'none');

  const patched = await api(ctx.baseUrl, 'PATCH', `/api/employee/outlet-orders/${outletOrderId}`, {
    cookie: pizzaEmployee.cookie,
    body: { status: 'preparing' },
  });
  assert.equal(patched.status, 200, `status update failed: ${patched.text}`);

  const payload = await ownerEvent;
  assert.equal(payload.outletOrderId, outletOrderId);
  assert.equal(payload.status, 'preparing');
  assert.equal(await strangerEvent, 'none');

  ownerSocket.close();
  strangerSocket.close();
  employeeSocket.close();
});

test('P1.8 — a status change reaches the owning outlet room, and no other outlet', async () => {
  const { placed } = await placeSingleItemOrder(customerA, 'card');
  const outletOrderId = placed.outletOrders[0].id;

  const pizzaSocket  = connectSocket(ctx.baseUrl, { cookie: pizzaEmployee.cookie });
  const burgerSocket = connectSocket(ctx.baseUrl, { cookie: burgerEmployee.cookie });
  const customerSocket = connectSocket(ctx.baseUrl, { cookie: customerA.cookie });

  await expectConnection(pizzaSocket);
  await expectConnection(burgerSocket);
  await expectConnection(customerSocket);

  assert.deepEqual(await joinRoom(pizzaSocket, PIZZA_OUTLET),   { ok: true, room: `outlet:${PIZZA_OUTLET}` });
  assert.deepEqual(await joinRoom(burgerSocket, BURGER_OUTLET), { ok: true, room: `outlet:${BURGER_OUTLET}` });
  assert.deepEqual(await joinRoom(customerSocket, PIZZA_OUTLET), { ok: false, reason: 'forbidden' });

  // The employee at the counter that changes the status, and a second screen
  // at the SAME outlet (e.g. another tab), must both be told.
  const secondPizzaSocket = connectSocket(ctx.baseUrl, { cookie: pizzaEmployee.cookie });
  await expectConnection(secondPizzaSocket);
  assert.deepEqual(await joinRoom(secondPizzaSocket, PIZZA_OUTLET), { ok: true, room: `outlet:${PIZZA_OUTLET}` });

  const assignedEvent = waitForEvent(pizzaSocket, 'outlet_order_status_updated');
  const secondScreenEvent = waitForEvent(secondPizzaSocket, 'outlet_order_status_updated');
  const otherOutletEvent = waitForEvent(burgerSocket, 'outlet_order_status_updated', 600).then(() => 'received', () => 'none');
  const deniedCustomerEvent = waitForEvent(customerSocket, 'outlet_order_status_updated', 600).then(() => 'received', () => 'none');

  const patched = await api(ctx.baseUrl, 'PATCH', `/api/employee/outlet-orders/${outletOrderId}`, {
    cookie: pizzaEmployee.cookie,
    body: { status: 'preparing' },
  });
  assert.equal(patched.status, 200, `status update failed: ${patched.text}`);

  const expected = {
    outletOrderId,
    outletId: PIZZA_OUTLET,
    status: 'preparing',
    orderStatus: 'preparing',
  };

  // The same payload goes to the customer's tracking page and to the kitchen:
  // it carries no pickup code (the customer's page reads that from its own
  // loaded order).
  assert.deepEqual(await assignedEvent, expected);

  // A different tab of the same outlet (the user-reported bug) is updated too.
  const secondPayload = await secondScreenEvent;
  assert.deepEqual(secondPayload, expected);
  assert.equal('pickupCode' in secondPayload, false);

  // Room scoping: the other outlet's employee and the denied customer must not
  // receive it.
  assert.equal(await otherOutletEvent, 'none');
  assert.equal(await deniedCustomerEvent, 'none');

  pizzaSocket.close();
  secondPizzaSocket.close();
  burgerSocket.close();
  customerSocket.close();
});

test('P1.9 — outlet rooms: customers denied, employees assigned outlet only, admins any', async () => {
  const { placed } = await placeSingleItemOrder(customerA, 'card');
  const randomOutlet = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const forbidden = { ok: false, reason: 'forbidden' };

  const customerSocket = connectSocket(ctx.baseUrl, { cookie: customerA.cookie });
  const pizzaSocket    = connectSocket(ctx.baseUrl, { cookie: pizzaEmployee.cookie });
  const burgerSocket   = connectSocket(ctx.baseUrl, { cookie: burgerEmployee.cookie });
  const adminSocket    = connectSocket(ctx.baseUrl, { cookie: admin.cookie });

  await expectConnection(customerSocket);
  await expectConnection(pizzaSocket);
  await expectConnection(burgerSocket);
  await expectConnection(adminSocket);

  // Customers cannot join any outlet room, whatever the id looks like...
  for (const outletId of [PIZZA_OUTLET, BURGER_OUTLET, randomOutlet, 'not-a-uuid']) {
    assert.deepEqual(await joinRoom(customerSocket, outletId), forbidden);
  }

  // ...but they can still track their own order.
  assert.deepEqual(
    await joinOrderRoom(customerSocket, placed.orderId),
    { ok: true, room: `order:${placed.orderId}` },
  );

  // Employees can join only their assigned outlet.
  assert.deepEqual(await joinRoom(pizzaSocket, PIZZA_OUTLET),  { ok: true, room: `outlet:${PIZZA_OUTLET}` });
  assert.deepEqual(await joinRoom(pizzaSocket, BURGER_OUTLET), forbidden);
  assert.deepEqual(await joinRoom(pizzaSocket, randomOutlet),  forbidden);

  assert.deepEqual(await joinRoom(burgerSocket, BURGER_OUTLET), { ok: true, room: `outlet:${BURGER_OUTLET}` });
  assert.deepEqual(await joinRoom(burgerSocket, PIZZA_OUTLET),  forbidden);
  assert.deepEqual(await joinRoom(burgerSocket, randomOutlet),  forbidden);

  // Admins may observe any real outlet...
  assert.deepEqual(await joinRoom(adminSocket, PIZZA_OUTLET),  { ok: true, room: `outlet:${PIZZA_OUTLET}` });
  assert.deepEqual(await joinRoom(adminSocket, BURGER_OUTLET), { ok: true, room: `outlet:${BURGER_OUTLET}` });

  // ...but not a room that does not correspond to an existing outlet.
  assert.deepEqual(await joinRoom(adminSocket, randomOutlet), { ok: false, reason: 'not_found' });
  assert.deepEqual(await joinRoom(adminSocket, 'not-a-uuid'), { ok: false, reason: 'invalid_outlet_id' });

  customerSocket.close();
  pizzaSocket.close();
  burgerSocket.close();
  adminSocket.close();
});
