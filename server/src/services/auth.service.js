/**
 * auth.service.js — Business logic for authentication.
 *
 * Responsibilities:
 *  - Hash passwords before storing
 *  - Compare a plain password against a hash
 *  - Sign a JWT with the user's identity payload
 *  - Build the cookie options
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

const SALT_ROUNDS = 10;

/**
 * Hash a plain-text password.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
const hashPassword = (password) => bcrypt.hash(password, SALT_ROUNDS);

/**
 * Compare a plain-text password against a stored bcrypt hash.
 * @param {string} password   - The plain-text password from the login form
 * @param {string} hash       - The hash stored in the database
 * @returns {Promise<boolean>}
 */
const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

/**
 * Sign a JWT containing the user's id, role, outletId and the per-tab sid.
 *
 * The sid is what ties the token to the durable `user_sessions` row. A token
 * is accepted only under the matching `qb_sess_<sid>` cookie and only while
 * that row is active. The token itself is stored in an httpOnly cookie — never
 * exposed to JavaScript.
 *
 * @param {{ id, name, email, role, outletId }} user
 * @param {string} sid - 128-bit per-login session id (32 lowercase hex)
 * @returns {string} Signed JWT
 */
const signToken = (user, sid) => {
  return jwt.sign(
    {
      id:       user.id,
      name:     user.name,
      email:    user.email,
      role:     user.role,
      outletId: user.outletId || null,
      sid,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );
};

/**
 * Returns the options object to use when setting the JWT cookie.
 * httpOnly prevents JavaScript access (XSS protection).
 * sameSite + secure prevent CSRF in production.
 */
const cookieOptions = () => ({
  httpOnly: true,
  // Secure should be true in production (requires HTTPS)
  secure: env.nodeEnv === 'production',
  // 'lax' allows the cookie to be sent with top-level navigation
  sameSite: 'lax',
  // Match the JWT expiry (7 days in milliseconds)
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

/**
 * Returns the options object to use when clearing a cookie.
 * A browser only drops a cookie when the clearing options match the ones it
 * was set with, so reuse every option except `maxAge`.
 */
const cookieClearOptions = () => {
  const { maxAge, ...rest } = cookieOptions();
  return rest;
};

module.exports = { hashPassword, verifyPassword, signToken, cookieOptions, cookieClearOptions };
