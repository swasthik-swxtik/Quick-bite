/**
 * P1.5 — Socket.IO authentication.
 *
 * The JWT lives in an httpOnly cookie, so browser JavaScript can never read
 * it. The handshake must therefore accept the cookie, while still allowing
 * an explicit auth token for non-browser clients.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  startServer,
  login,
  connectSocket,
  expectConnection,
  expectConnectionError,
} = require('./helpers/server');

let ctx;
let admin;

before(async () => {
  ctx = await startServer();
  admin = await login(ctx.baseUrl, 'admin@quickbite.com');
});

after(async () => {
  await ctx.close();
});

test('rejects a handshake with neither cookie nor auth token', async () => {
  const socket = connectSocket(ctx.baseUrl);
  const err = await expectConnectionError(socket);

  assert.match(err.message, /authentication required/i);
  assert.equal(socket.connected, false);
  socket.close();
});

test('authenticates using the httpOnly session cookie (polling transport)', async () => {
  const socket = connectSocket(ctx.baseUrl, { cookie: admin.cookie });
  await expectConnection(socket);

  assert.equal(socket.connected, true);
  socket.close();
});

test('authenticates using the httpOnly session cookie (websocket transport)', { skip: 'engine.io-client under Node ≥21 uses the built-in global WebSocket, whose constructor (uri, protocols) cannot carry a Cookie header — the browser websocket path is verified in the browser instead' }, async () => {
  const socket = connectSocket(ctx.baseUrl, { cookie: admin.cookie, transports: ['websocket'] });
  await expectConnection(socket);

  assert.equal(socket.connected, true);
  socket.close();
});

test('reads only the cookie of the per-tab session the handshake declares', async () => {
  const burger = await login(ctx.baseUrl, 'burger@quickbite.com');
  const pasta = await login(ctx.baseUrl, 'pasta@quickbite.com');
  const both = `${burger.cookie}; ${pasta.cookie}`;

  const asBurger = connectSocket(ctx.baseUrl, { cookie: both, session: burger.session });
  await expectConnection(asBurger);
  assert.equal(asBurger.connected, true);
  asBurger.close();

  const asPasta = connectSocket(ctx.baseUrl, { cookie: both, session: pasta.session });
  await expectConnection(asPasta);
  assert.equal(asPasta.connected, true);
  asPasta.close();

  // Legacy group hints are no longer accepted.
  const legacy = connectSocket(ctx.baseUrl, {
    cookie: `qb_staff_token=${admin.token}`,
    session: 'staff',
  });
  const legacyErr = await expectConnectionError(legacy);
  assert.match(legacyErr.message, /authentication required/i);
  legacy.close();
});

test('still accepts an explicit auth token for non-browser clients', async () => {
  const socket = connectSocket(ctx.baseUrl, { token: admin.token });
  await expectConnection(socket);

  assert.equal(socket.connected, true);
  socket.close();
});

test('rejects an invalid/expired token', async () => {
  const sid = 'a'.repeat(32);
  const socket = connectSocket(ctx.baseUrl, {
    cookie: `qb_sess_${sid}=not-a-real-jwt`,
    session: sid,
  });
  const err = await expectConnectionError(socket);

  assert.match(err.message, /invalid or expired/i);
  socket.close();
});

test('rejects a valid cookie sent with an unrelated name', async () => {
  const socket = connectSocket(ctx.baseUrl, { cookie: `session=${admin.token}` });
  const err = await expectConnectionError(socket);

  assert.match(err.message, /authentication required/i);
  socket.close();
});

// ── Per-tab sessions ────────────────────────────────────────────────────────

/** Emit join_outlet_room and resolve with its acknowledgement. */
const joinOutlet = (socket, outletId) =>
  new Promise((resolve) => socket.emit('join_outlet_room', outletId, resolve));

test('two employee sids in one jar keep their outlet rooms separate', async () => {
  const burger = await login(ctx.baseUrl, 'burger@quickbite.com');
  const pasta = await login(ctx.baseUrl, 'pasta@quickbite.com');
  assert.ok(burger.session && pasta.session);
  assert.notEqual(burger.user.outletId, pasta.user.outletId);

  const jar = `${burger.cookie}; ${pasta.cookie}`;

  const burgerSocket = connectSocket(ctx.baseUrl, { cookie: jar, session: burger.session });
  await expectConnection(burgerSocket);

  assert.deepEqual(await joinOutlet(burgerSocket, burger.user.outletId), {
    ok: true,
    room: `outlet:${burger.user.outletId}`,
  });
  assert.deepEqual(await joinOutlet(burgerSocket, pasta.user.outletId), {
    ok: false,
    reason: 'forbidden',
  });
  burgerSocket.close();

  const pastaSocket = connectSocket(ctx.baseUrl, { cookie: jar, session: pasta.session });
  await expectConnection(pastaSocket);

  assert.deepEqual(await joinOutlet(pastaSocket, pasta.user.outletId), {
    ok: true,
    room: `outlet:${pasta.user.outletId}`,
  });
  assert.deepEqual(await joinOutlet(pastaSocket, burger.user.outletId), {
    ok: false,
    reason: 'forbidden',
  });
  pastaSocket.close();
});

test('a missing, unknown or tampered sid never falls back to a cookie', async () => {
  const burger = await login(ctx.baseUrl, 'burger@quickbite.com');
  const pasta = await login(ctx.baseUrl, 'pasta@quickbite.com');
  const jar = `${burger.cookie}; ${pasta.cookie}`;

  // Two valid cookies but no selector: the server must not guess.
  const ambiguous = connectSocket(ctx.baseUrl, { cookie: jar });
  const ambiguousErr = await expectConnectionError(ambiguous);
  assert.match(ambiguousErr.message, /authentication required/i);
  ambiguous.close();

  // A valid cookie with an explicitly malformed selector.
  const malformed = connectSocket(ctx.baseUrl, { cookie: jar, session: 'none' });
  const malformedErr = await expectConnectionError(malformed);
  assert.match(malformedErr.message, /authentication required/i);
  malformed.close();

  // A well-formed sid that names no cookie in the jar.
  const unknown = connectSocket(ctx.baseUrl, { cookie: jar, session: 'f'.repeat(32) });
  const unknownErr = await expectConnectionError(unknown);
  assert.match(unknownErr.message, /authentication required/i);
  unknown.close();

  // The right cookie name with a tampered value.
  const tampered = connectSocket(ctx.baseUrl, {
    cookie: `qb_sess_${burger.session}=not-a-jwt`,
    session: burger.session,
  });
  const tamperedErr = await expectConnectionError(tampered);
  assert.match(tamperedErr.message, /invalid or expired/i);
  tampered.close();
});
