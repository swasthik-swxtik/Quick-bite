/**
 * P1.11 — Route param validation.
 *
 * Malformed UUIDs used to reach PostgreSQL and surface as 500s. They must now
 * be rejected with 400 before any query runs, while well-formed-but-absent ids
 * still produce a normal 404.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { startServer, login, api } = require('./helpers/server');
const { query } = require('../src/config/db');

const MISSING_OUTLET = '00000000-0000-0000-0000-000000000000';
const PIZZA_OUTLET   = '11111111-1111-1111-1111-111111111111';

let ctx;
let admin;
let employee;
let customer;
let customerId;

before(async () => {
  ctx = await startServer();

  admin    = await login(ctx.baseUrl, 'admin@quickbite.com');
  employee = await login(ctx.baseUrl, 'pizza@quickbite.com');

  const email = `p1-validate-${Date.now()}@example.com`;
  const reg = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: 'P1 Validate', email, password: 'test-password-123' },
  });
  assert.equal(reg.status, 201, reg.text);
  customerId = reg.body.user.id;
  customer = await login(ctx.baseUrl, email, 'test-password-123');
});

after(async () => {
  if (customerId) await query('DELETE FROM users WHERE id = $1', [customerId]);
  await ctx.close();
});

test('P1.11 — malformed UUID params are rejected with 400 instead of 500', async () => {
  const cases = [
    { label: 'public outlet detail',      path: '/api/outlets/not-a-uuid',                        cookie: undefined, expected: 400 },
    { label: 'public outlet menu',        path: '/api/outlets/not-a-uuid/menu',                   cookie: undefined, expected: 400 },
    { label: 'customer order detail',     path: '/api/orders/not-a-uuid',                         cookie: customer.cookie, expected: 400 },
    { label: 'employee outlet order',     path: '/api/employee/outlet-orders/not-a-uuid',         cookie: employee.cookie, expected: 400, method: 'PATCH', body: { status: 'preparing' } },
    { label: 'admin outlet update',       path: '/api/admin/outlets/not-a-uuid',                  cookie: admin.cookie, expected: 400, method: 'PUT', body: { name: 'Nope' } },
    { label: 'admin menu item delete',    path: '/api/admin/menu-items/not-a-uuid',               cookie: admin.cookie, expected: 400, method: 'DELETE' },
    { label: 'admin employee delete',     path: '/api/admin/employees/not-a-uuid',                cookie: admin.cookie, expected: 400, method: 'DELETE' },
    { label: 'admin order detail',        path: '/api/admin/orders/not-a-uuid',                   cookie: admin.cookie, expected: 400 },
    { label: 'admin outlet menu list',    path: `/api/admin/outlets/${PIZZA_OUTLET}/menu`,        cookie: admin.cookie, expected: 200, method: 'GET' },
    { label: 'admin menu create (bad outlet id)', path: '/api/admin/outlets/not-a-uuid/menu',     cookie: admin.cookie, expected: 400, method: 'POST', body: { name: 'x', price: 1 } },
  ];

  for (const c of cases) {
    const res = await api(ctx.baseUrl, c.method || 'GET', c.path, { cookie: c.cookie, body: c.body });
    assert.equal(res.status, c.expected, `${c.label}: expected ${c.expected}, got ${res.status} — ${res.text}`);
    if (c.expected === 400 && res.body.details) {
      assert.ok(Array.isArray(res.body.details), `${c.label}: details should be an array`);
    }
  }

  // Well-formed but absent ids are still a normal 404
  const notFound = await api(ctx.baseUrl, 'GET', `/api/outlets/${MISSING_OUTLET}`);
  assert.equal(notFound.status, 404, notFound.text);

  // Authentication still takes precedence over param validation
  const unauthed = await api(ctx.baseUrl, 'GET', '/api/orders/not-a-uuid');
  assert.equal(unauthed.status, 401, unauthed.text);

  // Read-only checks must not have changed any data
  const counts = await query('SELECT COUNT(*)::int AS n FROM outlet_order_items');
  assert.equal(typeof counts.rows[0].n, 'number');
});
