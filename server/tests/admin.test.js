/**
 * Admin API tests.
 *
 * P1.8 — PUT /api/admin/employees/:id must not clear fields that were omitted,
 *        and must support password resets.
 * P1.9 — Referential/unique constraint violations surface as 409, not 500.
 * P1.10 — Update routes validate their input instead of trusting req.body.
 *
 * Runs against the real database; every row it creates is removed in `after()`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, login, api } = require('./helpers/server');
const { query } = require('../src/config/db');

const PIZZA_OUTLET = '11111111-1111-1111-1111-111111111111';
const UNIQUE = `${Date.now()}`;

let ctx;
let admin;

const createdUserIds  = [];
const createdItemIds  = [];
const createdOrderIds = [];

before(async () => {
  ctx = await startServer();
  admin = await login(ctx.baseUrl, 'admin@quickbite.com');
});

after(async () => {
  if (createdOrderIds.length > 0) await query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [createdOrderIds]);
  if (createdItemIds.length > 0)  await query('DELETE FROM menu_items WHERE id = ANY($1::uuid[])', [createdItemIds]);
  if (createdUserIds.length > 0)  await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  await ctx.close();
});

/** Create a throwaway employee and remember it for cleanup. */
const createEmployee = async (label) => {
  const email = `p1-emp-${label}-${UNIQUE}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/admin/employees', {
    cookie: admin.cookie,
    body: { name: `P1 ${label}`, email, password: 'initial-pass-123', outletId: PIZZA_OUTLET },
  });
  assert.equal(res.status, 201, `create employee failed: ${res.text}`);
  createdUserIds.push(res.body.employee.id);
  return { id: res.body.employee.id, email };
};

/** Register a throwaway customer and remember it for cleanup. */
const createCustomer = async (label) => {
  const email = `p1-cust-${label}-${UNIQUE}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: `P1 ${label}`, email, password: 'test-password-123' },
  });
  assert.equal(res.status, 201, `register failed: ${res.text}`);
  createdUserIds.push(res.body.user.id);
  return login(ctx.baseUrl, email, 'test-password-123');
};

/** Create a throwaway menu item on the pizza outlet and remember it for cleanup. */
const createMenuItem = async (label) => {
  const res = await api(ctx.baseUrl, 'POST', `/api/admin/outlets/${PIZZA_OUTLET}/menu`, {
    cookie: admin.cookie,
    body: { name: `P1 ${label} Item ${UNIQUE}`, description: 'created by tests', price: 50 },
  });
  assert.equal(res.status, 201, `create menu item failed: ${res.text}`);
  createdItemIds.push(res.body.item.id);
  return { id: res.body.item.id };
};

test('P1.8 — PUT /admin/employees/:id preserves omitted fields and supports password reset', async () => {
  const { id, email } = await createEmployee('p18');

  // 1. A name-only update must NOT wipe the outlet assignment
  const renamed = await api(ctx.baseUrl, 'PUT', `/api/admin/employees/${id}`, {
    cookie: admin.cookie,
    body: { name: 'P1 Employee Renamed' },
  });
  assert.equal(renamed.status, 200, `rename failed: ${renamed.text}`);
  assert.equal(renamed.body.employee.name, 'P1 Employee Renamed');
  assert.equal(renamed.body.employee.outletId, PIZZA_OUTLET, 'outletId must survive a partial update');

  // 2. Password reset: the new password works, the old one no longer does
  const reset = await api(ctx.baseUrl, 'PUT', `/api/admin/employees/${id}`, {
    cookie: admin.cookie,
    body: { password: 'rotated-pass-456' },
  });
  assert.equal(reset.status, 200, `password update failed: ${reset.text}`);

  const relogin = await login(ctx.baseUrl, email, 'rotated-pass-456');
  assert.equal(relogin.user.role, 'employee');
  assert.equal(relogin.user.outletId, PIZZA_OUTLET);

  await assert.rejects(
    () => login(ctx.baseUrl, email, 'initial-pass-123'),
    /login failed/,
    'the previous password must stop working',
  );

  // 3. An explicit null is still able to clear the assignment
  const cleared = await api(ctx.baseUrl, 'PUT', `/api/admin/employees/${id}`, {
    cookie: admin.cookie,
    body: { outletId: null },
  });
  assert.equal(cleared.status, 200, `clear failed: ${cleared.text}`);
  assert.equal(cleared.body.employee.outletId, null);
});

test('P1.9 — deleting a menu item referenced by an order returns 409, not 500', async () => {
  const created = await api(ctx.baseUrl, 'POST', `/api/admin/outlets/${PIZZA_OUTLET}/menu`, {
    cookie: admin.cookie,
    body: { name: `P1 Temp Item ${UNIQUE}`, description: 'created by the P1.9 test', price: 99.5 },
  });
  assert.equal(created.status, 201, `menu item create failed: ${created.text}`);
  const itemId = created.body.item.id;
  createdItemIds.push(itemId);

  const customer = await createCustomer('p19');
  const placed = await api(ctx.baseUrl, 'POST', '/api/orders', {
    cookie: customer.cookie,
    body: { items: [{ menuItemId: itemId, quantity: 1 }], payment: { method: 'wallet' } },
  });
  assert.equal(placed.status, 201, `checkout failed: ${placed.text}`);
  createdOrderIds.push(placed.body.orderId);

  const deleted = await api(ctx.baseUrl, 'DELETE', `/api/admin/menu-items/${itemId}`, { cookie: admin.cookie });
  assert.equal(deleted.status, 409, `expected 409 but got ${deleted.status}: ${deleted.text}`);
  assert.match(deleted.body.message, /referenced|conflicts/i);

  // The row must still exist
  const stillThere = await query('SELECT id FROM menu_items WHERE id = $1', [itemId]);
  assert.equal(stillThere.rowCount, 1);
});

test('P1.9 — reusing an existing email returns 409, not 500', async () => {
  const first  = await createEmployee('dupa');
  const second = await createEmployee('dupb');

  const conflict = await api(ctx.baseUrl, 'PUT', `/api/admin/employees/${second.id}`, {
    cookie: admin.cookie,
    body: { email: first.email },
  });

  assert.equal(conflict.status, 409, `expected 409 but got ${conflict.status}: ${conflict.text}`);
  assert.match(conflict.body.message, /already exists/i);
});

test('P1.10 — admin update routes validate input and strip unknown fields', async () => {
  const item = await createMenuItem('p110');
  const employee = await createEmployee('p110');

  const invalidCases = [
    { label: 'menu item price is not a number', path: `/api/admin/menu-items/${item.id}`,     body: { price: 'abc' } },
    { label: 'menu item price is not positive', path: `/api/admin/menu-items/${item.id}`,     body: { price: -5 } },
    { label: 'outlet isActive is not a boolean', path: `/api/admin/outlets/${PIZZA_OUTLET}`,  body: { isActive: 'yes' } },
    { label: 'employee email is malformed',      path: `/api/admin/employees/${employee.id}`, body: { email: 'not-an-email' } },
    { label: 'empty update body',                path: `/api/admin/menu-items/${item.id}`,     body: {} },
  ];

  for (const c of invalidCases) {
    const res = await api(ctx.baseUrl, 'PUT', c.path, { cookie: admin.cookie, body: c.body });
    assert.equal(res.status, 400, `${c.label}: expected 400, got ${res.status} — ${res.text}`);
    assert.ok(Array.isArray(res.body.details), `${c.label}: expected a details array`);
  }

  // A valid partial update succeeds and unknown fields never reach SQL
  const ok = await api(ctx.baseUrl, 'PUT', `/api/admin/menu-items/${item.id}`, {
    cookie: admin.cookie,
    body: { price: 123.45, bogusColumn: "'; DROP TABLE users; --" },
  });
  assert.equal(ok.status, 200, `valid update failed: ${ok.text}`);
  assert.equal(Number(ok.body.item.price), 123.45);
  assert.equal(ok.body.item.bogusColumn, undefined);

  // Sanity: the seeded data is untouched
  const seeded = await query("SELECT COUNT(*)::int AS n FROM users WHERE email = 'admin@quickbite.com'");
  assert.equal(seeded.rows[0].n, 1);
});
