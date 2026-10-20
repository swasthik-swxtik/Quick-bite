/**
 * session.service.js — Create, validate and revoke per-tab sessions.
 *
 * PostgreSQL is the source of truth (see `user_sessions`). Revocation updates
 * the row and emits a notification in the same transaction:
 *
 *   - an in-process event disconnects sockets on this server immediately
 *   - pg_notify lets every other server instance do the same
 *
 * There is intentionally no in-memory allowlist: a restart cannot resurrect a
 * revoked token, and a second instance sees the same state.
 */

const { getClient } = require('../config/db');
const sessionModel = require('../models/session.model');
const sessionEvents = require('./sessionEvents');

const CHANNEL = sessionEvents.CHANNEL;

const broadcast = (payload) => {
  sessionEvents.emit('revoked', payload);
};

const notify = (client, payload) =>
  client.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(payload)]);

/**
 * Add the allowlist row for a login. Expired/revoked rows are swept
 * opportunistically so the table stays bounded without a background timer.
 */
const createSession = async ({ sid, userId, expiresAt }) => {
  try {
    await sessionModel.deleteExpired();
  } catch (err) {
    // Cleanup is housekeeping; never fail a login because of it.
    console.error('[Session] expired-session cleanup failed:', err.message);
  }

  return sessionModel.create({ sid, userId, expiresAt });
};

/** True while the sid is present, unexpired and not revoked. */
const isActive = async (sid) => Boolean(await sessionModel.findActiveById(sid));

/**
 * Run a revocation and its NOTIFYs atomically. If the transaction fails,
 * neither the database change nor the cross-instance signal happens.
 */
const revokeAtomically = async (work) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Revoke exactly one login/tab. Used by logout and session-cap eviction.
 * The DELETE cookie is handled by the caller; the row is what makes copied
 * cookies stop working.
 */
const revokeSession = async (sid) => {
  const notifications = [{ sid }];

  await revokeAtomically(async (client) => {
    await sessionModel.revoke(sid, client);
    for (const payload of notifications) {
      await notify(client, payload);
    }
  });

  for (const payload of notifications) broadcast(payload);
};

/**
 * Revoke every active login for a user. Used when an admin changes a role,
 * outlet assignment or password, and when an account is deleted.
 *
 * Both the user-scoped room and each sid room are notified: the user room is
 * the efficient path for current sockets; sid notifications also cover a
 * socket that predates the user-room join during a rolling upgrade.
 */
const revokeUserSessions = async (userId) => {
  const notifications = [];

  const sids = await revokeAtomically(async (client) => {
    const revoked = await sessionModel.revokeAllForUser(userId, client);
    notifications.push({ userId }, ...revoked.map((sid) => ({ sid })));
    for (const payload of notifications) {
      await notify(client, payload);
    }
    return revoked;
  });

  for (const payload of notifications) broadcast(payload);
  return sids;
};

module.exports = {
  createSession,
  isActive,
  revokeSession,
  revokeUserSessions,
};
