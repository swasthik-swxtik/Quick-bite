/**
 * session.model.js — SQL for the durable per-tab session allowlist.
 *
 * `user_sessions` stores only the opaque sid (the value in `qb_sess_<sid>`),
 * the owning user, the JWT expiry and the revocation time. The JWT itself is
 * never stored here.
 */

const { query } = require('../config/db');

/** Run through a transaction client when one is supplied. */
const runner = (client) => (client ? client.query.bind(client) : query);

/**
 * Register a newly issued login. The caller has already signed the JWT with
 * the same sid, so this row is what makes that token acceptable.
 */
const create = async ({ sid, userId, expiresAt }) => {
  const { rows: [row] } = await query(
    `INSERT INTO user_sessions (sid, user_id, expires_at)
     VALUES ($1, $2, $3)
     RETURNING sid, user_id AS "userId", created_at AS "createdAt",
               expires_at AS "expiresAt", revoked_at AS "revokedAt"`,
    [sid, userId, expiresAt]
  );
  return row;
};

/** The row that makes a token usable right now, or null. */
const findActiveById = async (sid) => {
  const { rows: [row] } = await query(
    `SELECT sid, user_id AS "userId", expires_at AS "expiresAt"
     FROM user_sessions
     WHERE sid = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [sid]
  );
  return row || null;
};

/** Revoke one tab. Returns its sid when a row changed. */
const revoke = async (sid, client = null) => {
  const { rows } = await runner(client)(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE sid = $1 AND revoked_at IS NULL
     RETURNING sid`,
    [sid]
  );
  return rows[0]?.sid || null;
};

/** Revoke every session belonging to one user. */
const revokeAllForUser = async (userId, client = null) => {
  const { rows } = await runner(client)(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL
     RETURNING sid`,
    [userId]
  );
  return rows.map((row) => row.sid);
};

/**
 * Remove rows that can never authenticate again. Keeping revoked rows briefly
 * preserves a useful audit trail; a missing row is still a 401, so deleting
 * one is safe.
 */
const deleteExpired = async () => {
  await query(
    `DELETE FROM user_sessions
     WHERE expires_at < NOW() - INTERVAL '1 day'
        OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day')`
  );
};

module.exports = {
  create,
  findActiveById,
  revoke,
  revokeAllForUser,
  deleteExpired,
};
