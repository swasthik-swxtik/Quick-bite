/**
 * auth.js middleware — Verifies the JWT stored in an httpOnly session cookie.
 *
 * Every login owns one cookie: `qb_sess_<sid>`. A tab names its own sid in
 * `X-QB-Session`, and the middleware reads exactly that cookie. The selector is
 * never allowed to fall back to another cookie:
 *
 *   missing / malformed selector   -> 401
 *   valid sid, cookie missing      -> 401
 *   valid sid, token invalid       -> 401 (expired or tampered)
 *   token issued for another sid   -> 401
 *   sid missing/revoked/expired    -> 401 (durable user_sessions row)
 *   valid sid, token of another role -> 401 on a route pinned to that role
 *
 * The JWT signature is the source of identity and role. The sid merely chooses
 * which signed token to verify and which durable allowlist row must be active,
 * so it can never grant a permission the token does not already carry.
 *
 * Legacy `customer` / `staff` group hints are no longer accepted.
 */

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const {
  sessionForRole,
  sessionSelectorOf,
  tabSessionCookieName,
  isTabSessionId,
} = require('../config/session');
const sessionModel = require('../models/session.model');

const AUTH_REQUIRED = 'Authentication required.';
const SESSION_INVALID = 'Session is invalid or has expired. Please sign in again.';

/** Read the first present cookie from an allowlist. */
const readCookie = (cookies, names) => {
  for (const name of names) {
    const value = cookies?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

/**
 * Resolve the tab selector and the one cookie it names.
 * The selector must come from the header; a malformed value is not allowed to
 * fall through to another cookie.
 */
const resolve = (req) => {
  const selector = sessionSelectorOf(req);
  if (!selector) return { selector: null, token: null };

  return {
    selector,
    token: readCookie(req.cookies, [tabSessionCookieName(selector.sid)]),
  };
};

/** Verify a token, its sid binding and the durable session row. */
const verifyToken = async (token, req, res, next, { selector, requiredSession = null } = {}) => {
  if (!token) {
    return res.status(401).json({ message: AUTH_REQUIRED });
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.secret);
  } catch {
    return res.status(401).json({ message: SESSION_INVALID });
  }

  // Tokens issued before the durable-session upgrade have no sid and cannot be
  // revoked; they must sign in once. A token can only be used under its own
  // cookie name.
  if (!payload.sid || !isTabSessionId(payload.sid)) {
    return res.status(401).json({ message: SESSION_INVALID });
  }
  if (!selector || selector.type !== 'sid' || payload.sid !== selector.sid) {
    return res.status(401).json({ message: AUTH_REQUIRED });
  }

  // A pinned route must belong to the role group carried by the signed token.
  if (requiredSession && sessionForRole(payload.role) !== requiredSession) {
    return res.status(401).json({ message: AUTH_REQUIRED });
  }

  // The durable row is authoritative for logout, role/outlet/password changes
  // and deletion. A DB failure is a server error, not an unauthenticated user.
  let session;
  try {
    session = await sessionModel.findActiveById(payload.sid);
  } catch (err) {
    return next(err);
  }

  if (!session || session.userId !== payload.id) {
    return res.status(401).json({ message: SESSION_INVALID });
  }

  // Attach a clean user object — never trust data the client sends.
  req.user = {
    id:       payload.id,
    name:     payload.name,
    email:    payload.email,
    role:     payload.role,
    outletId: payload.outletId || null,
  };
  req.sessionSelector = selector;
  req.sessionId = payload.sid;

  return next();
};

/**
 * Pin a route group to one role group.
 *
 * @param {'customer'|'staff'} session
 */
const requireSession = (session) => (req, res, next) => {
  const { selector, token } = resolve(req);
  if (!selector) {
    return res.status(401).json({ message: AUTH_REQUIRED });
  }

  return verifyToken(token, req, res, next, { selector, requiredSession: session });
};

/** Session-agnostic authentication: the selector picks the cookie, the JWT role decides the rest. */
const authenticate = (req, res, next) => {
  const { selector, token } = resolve(req);
  if (!selector) {
    return res.status(401).json({ message: AUTH_REQUIRED });
  }
  return verifyToken(token, req, res, next, { selector });
};

/** Identity lookup for `/me`; same strict selector resolution. */
const authenticateIdentity = (req, res, next) => {
  const { selector, token } = resolve(req);
  if (!selector) {
    return res.status(401).json({ message: AUTH_REQUIRED });
  }
  return verifyToken(token, req, res, next, { selector });
};

module.exports = { authenticate, authenticateIdentity, requireSession };
