/**
 * socket.js — Socket.IO server setup.
 *
 * This module attaches Socket.IO to the existing HTTP server and defines
 * all socket event handlers.
 *
 * Rooms used:
 *  - `order:<orderId>`   — Customer joins this room to track their order
 *  - `outlet:<outletId>` — Employee (assigned outlet) or admin (any existing
 *                          outlet) joins this room to receive new orders
 *  - `session:<sid>`     — Internal room for one login/tab (revocation)
 *  - `user:<userId>`     — Internal room for all of a user's sockets
 *
 * Security:
 *  - We verify the user's JWT cookie when they connect
 *  - The token must name an active `user_sessions` row
 *  - Invalid/missing/revoked/expired tokens cause an immediate disconnect
 *  - A timer disconnects the socket at the token's own expiry
 *  - Logout/role/outlet/password changes revoke the row and notify every
 *    server instance over PostgreSQL LISTEN/NOTIFY, so established sockets
 *    are disconnected too
 */

const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');
const { Client } = require('pg');

const env        = require('./src/config/env');
const {
  tabSessionCookieName,
  isTabSessionId,
} = require('./src/config/session');
const socketService = require('./src/services/socket.service');
const sessionModel  = require('./src/models/session.model');
const sessionEvents = require('./src/services/sessionEvents');
const orderModel    = require('./src/models/order.model');
const outletModel   = require('./src/models/outlet.model');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a single cookie value out of a raw `Cookie` header.
 *
 * We deliberately do not use a general cookie parser here: a handshake can
 * carry many per-tab cookies, and only the one named by the connecting tab is
 * allowed to authenticate it.
 */
const readCookie = (cookieHeader, name) => {
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;

  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;

    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    if (value) return value;
  }

  return null;
};

/** First present cookie from an allowlist. */
const readFirstCookie = (cookieHeader, names) => {
  for (const name of names) {
    const value = readCookie(cookieHeader, name);
    if (value) return value;
  }
  return null;
};

/**
 * Disconnect the sockets affected by a revocation message.
 * No token, sid or cookie is logged.
 */
const disconnectRevoked = (io, payload) => {
  if (!payload || typeof payload !== 'object') return;

  if (isTabSessionId(payload.sid)) {
    io.in(`session:${payload.sid}`).disconnectSockets(true);
  }
  if (typeof payload.userId === 'string' && payload.userId) {
    io.in(`user:${payload.userId}`).disconnectSockets(true);
  }
};

/**
 * Listen for revocations from this process and from other server instances.
 *
 * Local revocations are emitted immediately through sessionEvents. Other
 * instances publish with PostgreSQL `pg_notify`; every instance keeps one
 * dedicated LISTEN connection. If that connection drops, it is retried while
 * the server is running. The database row is still authoritative for HTTP and
 * new socket handshakes even during a listener outage.
 */
const startRevocationListener = (io, httpServer) => {
  let stopped = false;
  let connecting = false;
  let client = null;
  let retryTimer = null;

  const onLocalRevocation = (payload) => disconnectRevoked(io, payload);
  sessionEvents.on('revoked', onLocalRevocation);

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, 5000);
    retryTimer.unref?.();
  };

  const connect = async () => {
    if (stopped || connecting) return false;
    connecting = true;

    const nextClient = new Client(env.db);
    client = nextClient;

    nextClient.on('notification', (message) => {
      if (message.channel !== sessionEvents.CHANNEL) return;
      try {
        disconnectRevoked(io, JSON.parse(message.payload));
      } catch {
        console.error('[Session] ignored a malformed revocation notification');
      }
    });

    nextClient.on('error', (err) => {
      if (!stopped) console.error('[Session] listener error:', err.message);
    });

    nextClient.on('end', () => {
      if (client === nextClient) client = null;
      if (!stopped) scheduleReconnect();
    });

    try {
      await nextClient.connect();
      if (stopped) {
        await nextClient.end().catch(() => {});
        return false;
      }
      await nextClient.query(`LISTEN ${sessionEvents.CHANNEL}`);
      connecting = false;
      return true;
    } catch (err) {
      connecting = false;
      console.error('[Session] listener connect failed:', err.message);
      if (client === nextClient) client = null;
      await nextClient.end().catch(() => {});
      scheduleReconnect();
      return false;
    }
  };

  const cleanup = () => {
    stopped = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    sessionEvents.off('revoked', onLocalRevocation);

    const current = client;
    client = null;
    if (current) current.end().catch(() => {});
  };

  httpServer.once('close', cleanup);
  io.sessionRevocationReady = connect();
  return cleanup;
};

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ── Authentication middleware for Socket.IO connections ──────────────────
  io.use(async (socket, next) => {
    // The JWT is stored in an httpOnly cookie, so it is not readable by the
    // page's JavaScript. Browsers therefore authenticate the handshake with
    // the cookie itself. An explicit `auth.token` is still accepted as a
    // fallback for non-browser clients (scripts, tests, native apps).
    //
    // Each login owns its own cookie (`qb_sess_<sid>`). The tab names its sid
    // in `auth.session`; the server reads exactly that cookie. The sid is not
    // accepted from the query string (that would leak it into logs/history).
    // Legacy `customer`/`staff` values are no longer accepted.
    const rawAuth = socket.handshake.auth?.session;
    const authHint = typeof rawAuth === 'string' ? rawAuth.trim() : '';

    if (authHint && !isTabSessionId(authHint)) {
      return next(new Error('Authentication required.'));
    }

    const cookieNames = authHint ? [tabSessionCookieName(authHint)] : null;
    const token =
      (cookieNames ? readFirstCookie(socket.handshake.headers?.cookie, cookieNames) : null) ||
      socket.handshake.auth?.token;

    if (!token) {
      return next(new Error('Authentication required.'));
    }

    let payload;
    try {
      payload = jwt.verify(token, env.jwt.secret);
    } catch {
      return next(new Error('Invalid or expired token.'));
    }

    // A token can only be used under its own cookie name. Tokens issued before
    // the durable-session upgrade have no sid and must sign in again.
    if (!payload.sid || !isTabSessionId(payload.sid)) {
      return next(new Error('Invalid or expired token.'));
    }
    if (authHint && payload.sid !== authHint) {
      return next(new Error('Authentication required.'));
    }
    if (!payload.exp) {
      return next(new Error('Invalid or expired token.'));
    }

    // The durable row is authoritative for logout, role/outlet/password
    // changes and deletion. A DB outage must not authenticate anyone.
    let session;
    try {
      session = await sessionModel.findActiveById(payload.sid);
    } catch (err) {
      console.error('[Socket] session lookup failed:', err.message);
      return next(new Error('Authentication unavailable.'));
    }

    if (!session || session.userId !== payload.id) {
      return next(new Error('Invalid or expired token.'));
    }

    socket.user = payload;
    socket.sessionId = payload.sid;
    return next();
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id: userId, role, sid: sessionId, exp } = socket.user;
    console.log(`[Socket] Connected: user=${userId} role=${role}`);

    // Internal rooms make revocation efficient: logout closes one session room,
    // while a role/outlet/password change closes every socket for the user.
    socket.join(`session:${sessionId}`);
    socket.join(`user:${userId}`);

    // A long-lived socket must not outlive its JWT. The timer is unref()'d so a
    // test/dev process is not kept alive for the remaining token lifetime.
    const expiresIn = Number(exp) * 1000 - Date.now();
    let expiryTimer = null;
    if (expiresIn <= 0) {
      socket.disconnect(true);
      return;
    }
    expiryTimer = setTimeout(() => socket.disconnect(true), expiresIn);
    expiryTimer.unref?.();

    /**
     * Customer: join the room for a specific order to receive status updates.
     *
     * Authorisation: only the order's owner may subscribe. This room carries the
     * customer's own order (including the pickup code they show at the counter),
     * so staff are not allowed to join it even though they may read outlet
     * queues elsewhere. The room join is confirmed (or refused) through the
     * optional acknowledgement callback.
     */
    socket.on('join_order_room', async (orderId, ack) => {
      const reply = (payload) => { if (typeof ack === 'function') ack(payload); };

      if (!orderId || typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
        return reply({ ok: false, reason: 'invalid_order_id' });
      }

      try {
        const order = await orderModel.findOrderOwner(orderId);
        if (!order) {
          return reply({ ok: false, reason: 'not_found' });
        }

        // Owner only: customers may subscribe to their own orders, nobody else.
        if (order.customerId !== userId) {
          return reply({ ok: false, reason: 'forbidden' });
        }

        socket.join(`order:${orderId}`);
        console.log(`[Socket] User ${userId} joined room order:${orderId}`);
        reply({ ok: true, room: `order:${orderId}` });
      } catch (err) {
        console.error('[Socket] join_order_room failed:', err.message);
        reply({ ok: false, reason: 'error' });
      }
    });

    /**
     * Outlet room subscription.
     *
     * Policy:
     *  - admin: any *existing* outlet, for global oversight (outlet payloads
     *    contain no pickup codes or customer identity)
     *  - employee: only the outlet assigned in their signed session
     *  - customer / any other role: never
     *
     * Calls the optional acknowledgement with the join result.
     */
    socket.on('join_outlet_room', async (outletId, ack) => {
      const reply = (payload) => { if (typeof ack === 'function') ack(payload); };

      if (role !== 'admin' && role !== 'employee') {
        return reply({ ok: false, reason: 'forbidden' });
      }

      if (!outletId || typeof outletId !== 'string') {
        return reply({ ok: false, reason: 'invalid_outlet_id' });
      }
      if (!UUID_RE.test(outletId)) {
        return reply({ ok: false, reason: 'invalid_outlet_id' });
      }

      if (role === 'employee' && socket.user.outletId !== outletId) {
        return reply({ ok: false, reason: 'forbidden' });
      }

      try {
        // Admins may observe any real outlet; a random/malformed id must not
        // create an arbitrary room. Employees' own assignments also resolve to
        // a row, so a deleted outlet cannot leave a stale room subscribable.
        const outlet = await outletModel.findById(outletId);
        if (!outlet) {
          return reply({ ok: false, reason: 'not_found' });
        }
      } catch (err) {
        console.error('[Socket] outlet lookup failed:', err.message);
        return reply({ ok: false, reason: 'error' });
      }

      socket.join(`outlet:${outletId}`);
      console.log(`[Socket] User ${userId} joined room outlet:${outletId}`);
      reply({ ok: true, room: `outlet:${outletId}` });
    });

    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      console.log(`[Socket] Disconnected: user=${userId}`);
    });
  });

  // Give the socket service access to io so it can emit events from controllers
  socketService.init(io);

  // Disconnect established sockets when their session is revoked, including
  // revocations made by another server instance.
  io.sessionRevocationCleanup = startRevocationListener(io, httpServer);

  return io;
};

module.exports = { initSocket };
