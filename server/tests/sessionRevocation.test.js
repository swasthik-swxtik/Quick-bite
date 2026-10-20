/**
 * Security regressions for durable session revocation.
 *
 * Covers:
 *  - logout revokes the copied cookie and disconnects only that tab's socket
 *  - unrelated customer/Burger/Pasta sessions stay valid
 *  - an established socket is disconnected at its token expiry
 *  - PostgreSQL LISTEN/NOTIFY disconnects a socket when another instance
 *    revokes the session (the local emitter is deliberately not used)
 *  - employee outlet reassignment, role demotion and password reset revoke
 *    old sessions and sockets, while a fresh login works
 *  - account deletion revokes everything
 *
 * Runs against the real database. Rows created here are removed in `after()`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const {
  startServer,
  login,
  api,
  connectSocket,
  expectConnection,
  expectConnectionError,
  setCookiesOf,
} = require('./helpers/server');
const { query } = require('../src/config/db');
const env = require('../src/config/env');
const sessionModel = require('../src/models/session.model');
const sessionEvents = require('../src/services/sessionEvents');

const PIZZA_OUTLET = '11111111-1111-1111-1111-111111111111';
const BURGER_OUTLET = '22222222-2222-2222-2222-222222222222';
const PASTA_OUTLET = '33333333-3333-3333-3333-333333333333';

const UNIQUE = `${Date.now()}`;
const EMPLOYEE_PASSWORD = 'rev-password-123';
const NEW_PASSWORD = 'rev-password-456';

let ctx;
let admin;
let sequence = 0;

const createdUserIds = [];
const createdSids = new Set();
const openSockets = [];

const trackSession = (auth) => {
  if (auth?.session) createdSids.add(auth.session);
  return auth;
};

const loginTracked = async (email, password) => trackSession(await login(ctx.baseUrl, email, password));

const connectTracked = (options) => {
  const socket = connectSocket(ctx.baseUrl, options);
  openSockets.push(socket);
  return socket;
};

const waitForDisconnect = (socket, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    if (!socket.connected) return resolve('already-disconnected');
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for socket disconnect')),
      timeoutMs,
    );
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });

const authFromResponse = (res) => {
  const cookie = setCookiesOf(res)
    .map((value) => value.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('auth response did not set a cookie');

  const token = /(?:^|;\s*)qb_sess_[0-9a-f]{32}=([^;]*)/.exec(cookie)?.[1] || null;
  const auth = {
    cookie,
    token,
    session: res.body?.session?.id || null,
    user: res.body?.user || null,
  };
  return trackSession(auth);
};

const registerCustomer = async () => {
  const email = `rev-customer-${UNIQUE}-${++sequence}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: 'Revocation Customer', email, password: EMPLOYEE_PASSWORD },
  });
  assert.equal(res.status, 201, res.text);
  createdUserIds.push(res.body.user.id);
  return { ...authFromResponse(res), email, password: EMPLOYEE_PASSWORD };
};

const createEmployee = async (outletId = PIZZA_OUTLET) => {
  const email = `rev-employee-${UNIQUE}-${++sequence}@example.com`;
  const res = await api(ctx.baseUrl, 'POST', '/api/admin/employees', {
    cookie: admin.cookie,
    headers: { 'X-QB-Session': admin.session },
    body: {
      name: `Revocation Employee ${sequence}`,
      email,
      password: EMPLOYEE_PASSWORD,
      outletId,
    },
  });
  assert.equal(res.status, 201, res.text);

  const employee = res.body.employee;
  createdUserIds.push(employee.id);
  return { employee, email, password: EMPLOYEE_PASSWORD };
};

const updateEmployee = (id, body) =>
  api(ctx.baseUrl, 'PUT', `/api/admin/employees/${id}`, {
    cookie: admin.cookie,
    headers: { 'X-QB-Session': admin.session },
    body,
  });

const deleteEmployee = (id) =>
  api(ctx.baseUrl, 'DELETE', `/api/admin/employees/${id}`, {
    cookie: admin.cookie,
    headers: { 'X-QB-Session': admin.session },
  });

const me = (auth) =>
  api(ctx.baseUrl, 'GET', '/api/auth/me', {
    cookie: auth.cookie,
    headers: { 'X-QB-Session': auth.session },
  });

const employeeOrders = (auth) =>
  api(ctx.baseUrl, 'GET', '/api/employee/orders', {
    cookie: auth.cookie,
    headers: { 'X-QB-Session': auth.session },
  });

const joinOutlet = (socket, outletId) =>
  new Promise((resolve) => socket.emit('join_outlet_room', outletId, resolve));

before(async () => {
  ctx = await startServer();
  admin = await loginTracked('admin@quickbite.com');
});

after(async () => {
  for (const socket of openSockets) {
    socket.close();
  }

  if (createdSids.size > 0) {
    await query('DELETE FROM user_sessions WHERE sid = ANY($1::varchar[])', [[...createdSids]]);
  }
  if (createdUserIds.length > 0) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }

  await ctx.close();
});

test('logout revokes the copied cookie and disconnects only its socket', async () => {
  const customer = await registerCustomer();
  const burger = await loginTracked('burger@quickbite.com');
  const pasta = await loginTracked('pasta@quickbite.com');

  const customerSocket = connectTracked({ cookie: customer.cookie, session: customer.session });
  const burgerSocket = connectTracked({ cookie: burger.cookie, session: burger.session });
  const pastaSocket = connectTracked({ cookie: pasta.cookie, session: pasta.session });

  await Promise.all([
    expectConnection(customerSocket),
    expectConnection(burgerSocket),
    expectConnection(pastaSocket),
  ]);

  const copiedCookie = customer.cookie;
  const disconnected = waitForDisconnect(customerSocket);

  const logout = await api(ctx.baseUrl, 'POST', '/api/auth/logout', {
    cookie: customer.cookie,
    headers: { 'X-QB-Session': customer.session },
  });
  assert.equal(logout.status, 200, logout.text);

  await disconnected;
  assert.equal(customerSocket.connected, false);

  // The copied cookie is dead for both identity and protected data.
  assert.equal((await me({ cookie: copiedCookie, session: customer.session })).status, 401);
  assert.equal(
    (await api(ctx.baseUrl, 'GET', '/api/orders', {
      cookie: copiedCookie,
      headers: { 'X-QB-Session': customer.session },
    })).status,
    401,
  );

  // Unrelated customer/staff tabs are untouched.
  assert.equal((await employeeOrders(burger)).status, 200);
  assert.equal((await employeeOrders(pasta)).status, 200);
  assert.equal(burgerSocket.connected, true);
  assert.equal(pastaSocket.connected, true);

  burgerSocket.close();
  pastaSocket.close();
});

test('an established socket is disconnected when its token expires', async () => {
  const customer = await registerCustomer();
  const sid = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + 2000;

  const token = jwt.sign(
    {
      id: customer.user.id,
      name: customer.user.name,
      email: customer.user.email,
      role: customer.user.role,
      outletId: customer.user.outletId || null,
      sid,
    },
    env.jwt.secret,
    { expiresIn: '2s' },
  );

  createdSids.add(sid);
  await sessionModel.create({ sid, userId: customer.user.id, expiresAt: new Date(expiresAt) });

  const socket = connectTracked({ token });
  await expectConnection(socket);
  assert.equal(socket.connected, true);

  const disconnected = waitForDisconnect(socket, 6000);
  const reason = await disconnected;
  assert.equal(reason, 'io server disconnect');
  assert.equal(socket.connected, false);

  // The same (now expired) token cannot open a new connection.
  const again = connectTracked({ token });
  const err = await expectConnectionError(again);
  assert.match(err.message, /invalid or expired/i);
  again.close();
});

test('a PostgreSQL revocation notification disconnects an established socket', async () => {
  const customer = await registerCustomer();
  const socket = connectTracked({ cookie: customer.cookie, session: customer.session });
  await expectConnection(socket);
  assert.equal(socket.connected, true);

  // Simulate another server instance: update the row and publish directly.
  // This deliberately bypasses sessionEvents, so only the LISTEN path can
  // close the socket.
  await query(
    'UPDATE user_sessions SET revoked_at = NOW() WHERE sid = $1',
    [customer.session],
  );
  await query('SELECT pg_notify($1, $2)', [
    sessionEvents.CHANNEL,
    JSON.stringify({ sid: customer.session }),
  ]);

  await waitForDisconnect(socket);
  assert.equal(socket.connected, false);
  assert.equal((await me(customer)).status, 401);
});

test('outlet reassignment revokes the old session and socket', async () => {
  const { employee, email, password } = await createEmployee(PIZZA_OUTLET);
  const old = await loginTracked(email, password);
  const oldSocket = connectTracked({ cookie: old.cookie, session: old.session });

  await expectConnection(oldSocket);
  assert.deepEqual(await joinOutlet(oldSocket, PIZZA_OUTLET), {
    ok: true,
    room: `outlet:${PIZZA_OUTLET}`,
  });

  const disconnected = waitForDisconnect(oldSocket);
  const updated = await updateEmployee(employee.id, { outletId: BURGER_OUTLET });
  assert.equal(updated.status, 200, updated.text);
  await disconnected;

  assert.equal((await employeeOrders(old)).status, 401);

  // A fresh login gets the new outlet, and the old outlet is now forbidden.
  const fresh = await loginTracked(email, password);
  assert.equal(fresh.user.outletId, BURGER_OUTLET);

  const freshSocket = connectTracked({ cookie: fresh.cookie, session: fresh.session });
  await expectConnection(freshSocket);
  assert.deepEqual(await joinOutlet(freshSocket, PIZZA_OUTLET), {
    ok: false,
    reason: 'forbidden',
  });
  assert.deepEqual(await joinOutlet(freshSocket, BURGER_OUTLET), {
    ok: true,
    room: `outlet:${BURGER_OUTLET}`,
  });
});

test('role demotion revokes an existing admin session and socket', async () => {
  const { employee, email, password } = await createEmployee(PIZZA_OUTLET);

  const promoted = await updateEmployee(employee.id, { role: 'admin' });
  assert.equal(promoted.status, 200, promoted.text);

  const oldAdmin = await loginTracked(email, password);
  const adminSocket = connectTracked({ cookie: oldAdmin.cookie, session: oldAdmin.session });
  await expectConnection(adminSocket);

  const oldAdminOrders = await api(ctx.baseUrl, 'GET', '/api/admin/orders', {
    cookie: oldAdmin.cookie,
    headers: { 'X-QB-Session': oldAdmin.session },
  });
  assert.equal(oldAdminOrders.status, 200, oldAdminOrders.text);

  const disconnected = waitForDisconnect(adminSocket);
  const demoted = await updateEmployee(employee.id, { role: 'employee' });
  assert.equal(demoted.status, 200, demoted.text);
  await disconnected;

  assert.equal(
    (await api(ctx.baseUrl, 'GET', '/api/admin/orders', {
      cookie: oldAdmin.cookie,
      headers: { 'X-QB-Session': oldAdmin.session },
    })).status,
    401,
  );

  const fresh = await loginTracked(email, password);
  assert.equal(fresh.user.role, 'employee');
  assert.equal(
    (await api(ctx.baseUrl, 'GET', '/api/admin/orders', {
      cookie: fresh.cookie,
      headers: { 'X-QB-Session': fresh.session },
    })).status,
    403,
  );
  assert.equal((await employeeOrders(fresh)).status, 200);
});

test('a password reset revokes the old session and socket', async () => {
  const { employee, email, password } = await createEmployee(PASTA_OUTLET);
  const old = await loginTracked(email, password);
  const socket = connectTracked({ cookie: old.cookie, session: old.session });
  await expectConnection(socket);

  const disconnected = waitForDisconnect(socket);
  const reset = await updateEmployee(employee.id, { password: NEW_PASSWORD });
  assert.equal(reset.status, 200, reset.text);
  await disconnected;

  assert.equal((await employeeOrders(old)).status, 401);

  const oldLogin = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
    body: { email, password },
  });
  assert.equal(oldLogin.status, 401, oldLogin.text);

  const fresh = await loginTracked(email, NEW_PASSWORD);
  assert.equal((await employeeOrders(fresh)).status, 200);
});

test('deleting an account revokes its session and disconnects its socket', async () => {
  const { employee, email, password } = await createEmployee(BURGER_OUTLET);
  const old = await loginTracked(email, password);
  const socket = connectTracked({ cookie: old.cookie, session: old.session });
  await expectConnection(socket);

  const disconnected = waitForDisconnect(socket);
  const deleted = await deleteEmployee(employee.id);
  assert.equal(deleted.status, 200, deleted.text);
  await disconnected;

  assert.equal((await employeeOrders(old)).status, 401);

  const loginAfterDelete = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
    body: { email, password },
  });
  assert.equal(loginAfterDelete.status, 401, loginAfterDelete.text);
});
