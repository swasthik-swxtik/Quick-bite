/**
 * Test helpers — boot the real Express app + Socket.IO on an ephemeral port
 * and expose cookie-aware HTTP / Socket.IO clients.
 *
 * These tests run against the real PostgreSQL database configured in
 * server/.env. They never reset the schema; any rows they create are
 * removed again by the individual test files.
 */

const http = require('http');
const { io: ioClient } = require('socket.io-client');

const app = require('../../src/app');
const { initSocket } = require('../../socket');
const { query } = require('../../src/config/db');

/** Logins made through this helper, removed again when the test server closes. */
const trackedSessionIds = new Set();

/** Start the full server (HTTP + Socket.IO) on a random free port. */
const startServer = async () => {
  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);

  // Wait for the optional PostgreSQL LISTEN connection so tests can exercise
  // cross-instance revocation deterministically. It resolves false (never
  // rejects) when the listener cannot connect.
  if (io.sessionRevocationReady) await io.sessionRevocationReady;

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  return {
    io,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      // Remove only sessions created by test logins; user/order rows are never
      // touched. Do this before closing so a slow keep-alive socket cannot
      // prevent cleanup when the runner force-exits.
      if (trackedSessionIds.size > 0) {
        try {
          await query('DELETE FROM user_sessions WHERE sid = ANY($1::varchar[])', [
            [...trackedSessionIds],
          ]);
        } catch (err) {
          console.error('[Test] could not clean up test sessions:', err.message);
        }
        trackedSessionIds.clear();
      }

      if (typeof io.sessionRevocationCleanup === 'function') {
        io.sessionRevocationCleanup();
      }
      io.close();
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        httpServer.close(finish);
        // The test runner can force-exit; do not wait out an idle keep-alive
        // socket forever. Production shutdown still uses the real callback.
        const fallback = setTimeout(finish, 1000);
        fallback.unref?.();
      });
    },
  };
};

/** Extract the `Set-Cookie` values across Node versions. */
const setCookiesOf = (res) => {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
};

/**
 * Work out the session selector a browser tab would send for a cookie jar.
 *
 * Tests pass a `Cookie` header; production clients store the sid separately.
 * This helper keeps every test explicit: exactly one per-tab session cookie
 * selects that sid, while a jar with several requires the test to name one
 * (otherwise the server correctly refuses to guess). Legacy shared cookies are
 * no longer recognised.
 */
const sessionHintForCookie = (cookie) => {
  if (!cookie || typeof cookie !== 'string') return null;

  const sids = [...cookie.matchAll(/(?:^|;\s*)qb_sess_([0-9a-f]{32})=/g)].map((m) => m[1]);
  return sids.length === 1 ? sids[0] : null;
};

/**
 * Log in and return the auth cookie + the raw JWT.
 * Defaults to the development password used by the seeds.
 */
const trackSession = (sid) => {
  if (sid) trackedSessionIds.add(sid);
};

const login = async (baseUrl, email, password = 'password') => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed for ${email} (${res.status}): ${body.message || ''}`);

  const cookie = setCookiesOf(res).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login succeeded but no auth cookie was set');

  // The raw JWT, for non-browser clients (`auth.token`). Every login now lives
  // in qb_sess_<sid>; legacy shared cookies are no longer accepted.
  const token =
    /(?:^|;\s*)qb_sess_[0-9a-f]{32}=([^;]*)/.exec(cookie)?.[1] || null;
  const session = body.session?.id || null;
  trackSession(session);

  return { cookie, token, user: body.user, session };
};

/** Minimal cookie-aware JSON client. Never throws on non-2xx. */
const api = async (baseUrl, method, path, { cookie, body, headers, noHint } = {}) => {
  const explicitHint = headers
    && Object.keys(headers).some((key) => key.toLowerCase() === 'x-qb-session');
  const selector = !noHint && !explicitHint && cookie ? sessionHintForCookie(cookie) : null;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(selector ? { 'X-QB-Session': selector } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: res.status, body: json, text, headers: res.headers };
};

/**
 * Open a Socket.IO client.
 * `cookie` mimics a browser handshake; `token` mimics a non-browser client;
 * `session` is a per-tab sid (or a legacy group, for migration tests).
 */
const connectSocket = (baseUrl, { cookie, token, session, transports = ['polling'] } = {}) => {
  const selector = session || (cookie ? sessionHintForCookie(cookie) : null);

  return ioClient(baseUrl, {
    transports,
    forceNew: true,
    reconnection: false,
    withCredentials: true,
    extraHeaders: cookie ? { Cookie: cookie } : {},
    auth: {
      ...(token ? { token } : {}),
      ...(selector ? { session: selector } : {}),
    },
  });
};

const expectConnection = (socket) =>
  new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', (err) => reject(new Error(`connect_error: ${err.message}`)));
  });

const expectConnectionError = (socket) =>
  new Promise((resolve) => socket.on('connect_error', (err) => resolve(err)));

const waitForEvent = (socket, event, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

/** Resolve after `ms`, used to assert that an event does NOT arrive. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  startServer,
  login,
  trackSession,
  api,
  sessionHintForCookie,
  connectSocket,
  expectConnection,
  expectConnectionError,
  waitForEvent,
  sleep,
  setCookiesOf,
};
