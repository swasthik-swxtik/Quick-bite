/**
 * P2.0 — Per-login, per-tab sessions.
 *
 * Every login owns one httpOnly cookie (`qb_sess_<sid>`). A tab names its own
 * sid, and the server reads exactly that cookie: a missing, unknown or tampered
 * sid is a 401, never another tab's identity. This file covers three tabs
 * (customer + two employees), refreshes, logout in each tab, duplicate
 * identities, hardening, role isolation, the legacy migration path, expiry and
 * the active-session cap.
 *
 * Runs against the real database. The only row this file creates is a throwaway
 * customer, which is removed again in `after()`.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { startServer, login, trackSession, api, setCookiesOf } = require('./helpers/server');
const { query } = require('../src/config/db');
const env = require('../src/config/env');

const UNIQUE = `${Date.now()}`;
const CUSTOMER_EMAIL = `session-${UNIQUE}@example.com`;
const CUSTOMER_PASSWORD = 'test-password-123';

const SID_IN_NAME = /^qb_sess_([0-9a-f]{32})$/;

let ctx;
let customer;
let burger;
let pasta;
let admin;

const createdUserIds = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

const setCookieNames = (res) =>
  setCookiesOf(res).map((value) => value.split(';')[0].split('=')[0]);

/** Names of cookies a response asked the browser to delete (`name=`). */
const clearedCookieNames = (res) =>
  setCookiesOf(res)
    .map((value) => value.split(';')[0].trim())
    .filter((pair) => pair.endsWith('='))
    .map((pair) => pair.slice(0, -1));

const sidOfCookieName = (name) => SID_IN_NAME.exec(name)?.[1] || null;

/** Build a browser-style jar from login results. */
const jarOf = (...auths) => {
  const jar = {};
  for (const auth of auths) {
    const pair = auth.cookie.split(';')[0];
    const eq = pair.indexOf('=');
    jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return jar;
};

const jarHeader = (jar) =>
  Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');

/** Apply a response's Set-Cookie headers to the jar, as a browser would. */
const applySetCookies = (jar, res) => {
  for (const header of setCookiesOf(res)) {
    const [pair, ...attributes] = header.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attributes.some((attribute) => /expires=thu, 01 jan 1970/i.test(attribute));
    if (expired || value === '') delete jar[name];
    else jar[name] = value;
  }
  return jar;
};

/** A raw login request, so it can carry an existing browser jar. */
const rawLogin = async (email, password, cookie) => {
  const res = await fetch(`${ctx.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ email, password }),
  });

  // Track every per-tab cookie in the response for cleanup: a jar login can
  // clear an old sid and set a new one in the same response. Tracking a cleared
  // sid is harmless (the row is already gone or is deleted again).
  for (const header of setCookiesOf(res)) {
    if (!header.startsWith('qb_sess_')) continue;
    trackSession(/^qb_sess_([0-9a-f]{32})=/.exec(header)?.[1] || null);
  }

  return res;
};

/** Raw POST with an explicit selector. */
const rawPost = (path, { cookie, session, body } = {}) =>
  fetch(`${ctx.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(session ? { 'X-QB-Session': session } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** GET /me as one tab. */
const me = (sid, cookie, extra = {}) =>
  api(ctx.baseUrl, 'GET', '/api/auth/me', {
    cookie,
    headers: { 'X-QB-Session': sid },
    ...extra,
  });

before(async () => {
  ctx = await startServer();

  const registered = await api(ctx.baseUrl, 'POST', '/api/auth/register', {
    body: { name: 'Session Tester', email: CUSTOMER_EMAIL, password: CUSTOMER_PASSWORD },
  });
  assert.equal(registered.status, 201, `register failed: ${registered.text}`);
  createdUserIds.push(registered.body.user.id);

  const pair = setCookiesOf({ headers: registered.headers })
    .map((header) => header.split(';')[0])
    .find((value) => value.startsWith('qb_sess_'));
  assert.ok(pair, 'register must write one per-tab session cookie');

  customer = {
    cookie: pair,
    token: pair.slice(pair.indexOf('=') + 1),
    user: registered.body.user,
    session: registered.body.session.id,
  };

  burger = await login(ctx.baseUrl, 'burger@quickbite.com');
  pasta = await login(ctx.baseUrl, 'pasta@quickbite.com');
  admin = await login(ctx.baseUrl, 'admin@quickbite.com');
});

after(async () => {
  if (createdUserIds.length) {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }
  await ctx.close();
});

// ── Cookie shape and attributes ─────────────────────────────────────────────

test('P2.0 — a login writes one httpOnly per-tab cookie and returns its id', async () => {
  const res = await rawLogin('burger@quickbite.com', 'password');
  assert.equal(res.status, 200);

  const headers = setCookiesOf(res);
  const names = headers.map((header) => header.split(';')[0].split('=')[0]);
  const body = await res.json();

  assert.equal(names.length, 1, `expected exactly one cookie, got ${names.join(', ')}`);
  assert.match(names[0], SID_IN_NAME, `unexpected cookie name: ${names[0]}`);
  assert.equal(names[0], `qb_sess_${body.session.id}`);
  assert.match(body.session.id, /^[0-9a-f]{32}$/);

  // No shared group cookies are written any more.
  for (const legacy of ['qb_customer_token', 'qb_staff_token', 'token']) {
    assert.ok(!names.includes(legacy), `login must not write ${legacy}`);
  }

  const raw = headers[0];
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);
  assert.match(raw, /Path=\//i);
  assert.match(raw, /Max-Age=604800/i);
});

// ── Three tabs, refreshes, identity ─────────────────────────────────────────

test('P2.0 — customer + Burger + Pasta keep their own identities across refreshes', async () => {
  const jar = jarOf(customer, burger, pasta);
  const cookie = jarHeader(jar);

  const expected = [
    [customer, customer.session, 'customer', CUSTOMER_EMAIL],
    [burger, burger.session, 'employee', 'burger@quickbite.com'],
    [pasta, pasta.session, 'employee', 'pasta@quickbite.com'],
  ];

  for (const [, sid, role, email] of expected) {
    // Each pass is a refresh: same sid, same jar, same result.
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const res = await me(sid, cookie);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.user.role, role);
      assert.equal(res.body.user.email, email);
      assert.equal(res.body.session.id, sid, 'the server should echo the tab sid');
    }
  }

  // Every login is still present in the browser jar.
  assert.equal(Object.keys(jar).length, 3);
});

test('P2.0 — a sid can only select its own cookie, never another tab\'s', async () => {
  // Customer tab names its sid, but the browser only holds Burger's cookie.
  const asCustomer = await me(customer.session, burger.cookie);
  assert.equal(asCustomer.status, 401, asCustomer.text);

  // Mirror: employee tab, only the customer cookie.
  const asBurger = await me(burger.session, customer.cookie);
  assert.equal(asBurger.status, 401, asBurger.text);

  // A valid sid that is not in the jar at all.
  const unknown = 'f'.repeat(32);
  const asUnknown = await me(unknown, jarHeader(jarOf(customer, burger, pasta)));
  assert.equal(asUnknown.status, 401, asUnknown.text);
});

test('P2.0 — missing, malformed and tampered sids are refused', async () => {
  const jar = jarHeader(jarOf(customer, burger, pasta));

  // No selector at all: no silent fallback to a cookie.
  for (const path of ['/api/auth/me', '/api/orders', '/api/employee/orders']) {
    const res = await api(ctx.baseUrl, 'GET', path, { cookie: jar, noHint: true });
    assert.equal(res.status, 401, `${path}: ${res.text}`);
  }

  // An invalid header does not fall through to a cookie or the query string.
  const malformed = await me('not-a-session-id', jar);
  assert.equal(malformed.status, 401, malformed.text);
  assert.match(malformed.body.message, /authentication required/i);

  // A legacy group hint must not read a per-tab cookie.
  const groupWithSids = await me('customer', jar);
  assert.equal(groupWithSids.status, 401, groupWithSids.text);

  // Tampered value under the right cookie name.
  const tampered = `qb_sess_${burger.session}=not-a-jwt`;
  const bad = await me(burger.session, tampered);
  assert.equal(bad.status, 401, bad.text);
  assert.match(bad.body.message, /invalid/i);
});

// ── Logout isolation ────────────────────────────────────────────────────────

test('P2.0 — logging out one tab clears only that sid', async () => {
  const jar = jarOf(customer, burger, pasta);

  const logout = async (sid) => {
    const res = await rawPost('/api/auth/logout', { cookie: jarHeader(jar), session: sid });
    assert.equal(res.status, 200);

    const cleared = clearedCookieNames(res);
    const expected = `qb_sess_${sid}`;
    assert.deepEqual(cleared, [expected], `expected only ${expected} to be cleared`);
    applySetCookies(jar, res);
    return res;
  };

  // Burger signs out: customer and Pasta stay signed in.
  await logout(burger.session);
  assert.equal((await me(burger.session, jarHeader(jar))).status, 401);
  assert.equal((await me(customer.session, jarHeader(jar))).status, 200);
  assert.equal((await me(pasta.session, jarHeader(jar))).status, 200);

  // Customer signs out: Pasta stays signed in.
  await logout(customer.session);
  assert.equal((await me(customer.session, jarHeader(jar))).status, 401);
  assert.equal((await me(pasta.session, jarHeader(jar))).status, 200);

  // Pasta signs out: nothing left.
  await logout(pasta.session);
  assert.equal((await me(pasta.session, jarHeader(jar))).status, 401);
  assert.equal(Object.keys(jar).length, 0);
});

test('P2.0 — two tabs signed in as the same employee are independent', async () => {
  const second = await login(ctx.baseUrl, 'burger@quickbite.com');
  const jar = jarOf(burger, second);
  assert.notEqual(burger.session, second.session);

  const res = await rawPost('/api/auth/logout', {
    cookie: jarHeader(jar),
    session: burger.session,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(clearedCookieNames(res), [`qb_sess_${burger.session}`]);
  applySetCookies(jar, res);

  // The duplicate login is untouched.
  assert.equal((await me(burger.session, jarHeader(jar))).status, 401);
  const still = await me(second.session, jarHeader(jar));
  assert.equal(still.status, 200, still.text);
  assert.equal(still.body.user.email, 'burger@quickbite.com');
});

// ── Role isolation ──────────────────────────────────────────────────────────

test('P2.0 — role isolation is unchanged and the JWT role wins over the sid', async () => {
  // Customer cannot reach staff or admin routes.
  assert.equal(
    (await api(ctx.baseUrl, 'GET', '/api/employee/orders', {
      cookie: customer.cookie,
      headers: { 'X-QB-Session': customer.session },
    })).status,
    401,
  );
  assert.equal(
    (await api(ctx.baseUrl, 'GET', '/api/admin/orders/00000000-0000-0000-0000-000000000000', {
      cookie: customer.cookie,
      headers: { 'X-QB-Session': customer.session },
    })).status,
    401,
  );

  // Employees/admins cannot use the customer-only list.
  for (const auth of [burger, pasta, admin]) {
    const res = await api(ctx.baseUrl, 'GET', '/api/orders', {
      cookie: auth.cookie,
      headers: { 'X-QB-Session': auth.session },
    });
    assert.equal(res.status, 401, `${auth.user.email}: ${res.text}`);
  }

  // A token is bound to the sid it was issued for. Putting a valid customer
  // JWT under another `qb_sess_<sid>` name is refused even though the token
  // signature is valid.
  const sid = 'c'.repeat(32);
  const swapped = `qb_sess_${sid}=${customer.token}`;
  const identity = await me(sid, swapped);
  assert.equal(identity.status, 401, identity.text);

  const staffRoute = await api(ctx.baseUrl, 'GET', '/api/employee/orders', {
    cookie: swapped,
    headers: { 'X-QB-Session': sid },
  });
  assert.equal(staffRoute.status, 401, staffRoute.text);
});

// ── Removed legacy migration path ───────────────────────────────────────────

test('P2.0 — obsolete shared cookies are rejected and cleared on login', async () => {
  // Old group cookies are no longer accepted, even when named explicitly.
  const legacyCustomer = `qb_customer_token=${customer.token}`;
  for (const path of ['/api/auth/me', '/api/orders']) {
    const res = await api(ctx.baseUrl, 'GET', path, {
      cookie: legacyCustomer,
      headers: { 'X-QB-Session': 'customer' },
    });
    assert.equal(res.status, 401, `${path}: ${res.text}`);
  }

  const legacyStaff = `qb_staff_token=${burger.token}`;
  const staffList = await api(ctx.baseUrl, 'GET', '/api/employee/orders', {
    cookie: legacyStaff,
    headers: { 'X-QB-Session': 'staff' },
  });
  assert.equal(staffList.status, 401, staffList.text);

  // The query-string group hint was only for the removed migration path.
  const viaQuery = await api(ctx.baseUrl, 'GET', '/api/auth/me?session=customer', {
    cookie: legacyCustomer,
    noHint: true,
  });
  assert.equal(viaQuery.status, 401, viaQuery.text);

  // A login clears every obsolete cookie still present in the browser jar.
  const login = await rawLogin(
    'burger@quickbite.com',
    'password',
    `qb_customer_token=${customer.token}; qb_staff_token=${burger.token}; token=${customer.token}`,
  );
  assert.equal(login.status, 200);
  const cleared = clearedCookieNames(login);
  for (const name of ['qb_customer_token', 'qb_staff_token', 'token']) {
    assert.ok(cleared.includes(name), `${name} should be cleared`);
  }
});

// ── Expiry and the active-session cap ───────────────────────────────────────

test('P2.0 — expired session cookies are cleared on login', async () => {
  const expiredSid = 'e'.repeat(32);
  const expiredToken = jwt.sign(
    {
      id: customer.user.id,
      name: customer.user.name,
      email: customer.user.email,
      role: 'customer',
      outletId: null,
    },
    env.jwt.secret,
    { expiresIn: -60 },
  );

  const res = await rawLogin(
    'burger@quickbite.com',
    'password',
    `qb_sess_${expiredSid}=${expiredToken}`,
  );
  assert.equal(res.status, 200);

  assert.ok(
    clearedCookieNames(res).includes(`qb_sess_${expiredSid}`),
    'the expired cookie should be removed',
  );

  const body = await res.json();
  const names = setCookieNames(res);
  assert.ok(names.includes(`qb_sess_${body.session.id}`), 'the new session cookie is written');
});

test('P2.0 — the session-cookie cap evicts the oldest login, not a valid tab at random', async () => {
  const logins = [];
  for (let i = 0; i < 8; i += 1) {
    logins.push(await login(ctx.baseUrl, 'burger@quickbite.com'));
  }

  const jar = jarOf(...logins);
  assert.equal(Object.keys(jar).length, 8);

  const res = await rawLogin('burger@quickbite.com', 'password', jarHeader(jar));
  assert.equal(res.status, 200);

  const cleared = clearedCookieNames(res).filter((name) => sidOfCookieName(name));
  assert.equal(cleared.length, 1, `expected exactly one eviction, got ${cleared.join(', ')}`);
  assert.ok(jar[cleared[0]], 'the evicted cookie must be one that was present');

  applySetCookies(jar, res);
  assert.equal(Object.keys(jar).length, 8, 'the new login replaces the evicted one');

  const evictedSid = sidOfCookieName(cleared[0]);
  const body = await res.json();

  const evicted = await me(evictedSid, jarHeader(jar));
  assert.equal(evicted.status, 401, 'the evicted tab is signed out');

  const newest = await me(body.session.id, jarHeader(jar));
  assert.equal(newest.status, 200, newest.text);
  assert.equal(newest.body.user.email, 'burger@quickbite.com');
});
