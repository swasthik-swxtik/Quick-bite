/**
 * auth.controller.js — Handlers for authentication routes.
 *
 * Routes:
 *   POST /api/auth/register  — Create a new customer account
 *   POST /api/auth/login     — Log in (any role)
 *   POST /api/auth/logout    — Clear only the calling tab's session cookie
 *   GET  /api/auth/me        — Return the logged-in user's profile
 *
 * Each login gets its own httpOnly cookie (`qb_sess_<sid>`), so two tabs — even
 * two employees — keep independent identities in one browser. The sid is
 * returned to the caller so its tab can name it on later requests; the JWT
 * itself is never exposed to JavaScript.
 */

const jwt = require('jsonwebtoken');
const Joi = require('joi');
const userModel = require('../models/user.model');
const authService = require('../services/auth.service');
const sessionService = require('../services/session.service');
const env = require('../config/env');
const {
  LEGACY_COOKIE_NAMES,
  sessionSelectorOf,
  newTabSessionId,
  tabSessionCookieName,
  tabSessionCookiesOf,
  MAX_TAB_SESSIONS,
} = require('../config/session');

// ── Validation schemas ──────────────────────────────────────────────────────

const registerSchema = Joi.object({
  name:     Joi.string().trim().min(2).max(100).required(),
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().min(8).max(72).required()
              .messages({ 'string.min': 'Password must be at least 8 characters.' }),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().lowercase().required(),
  password: Joi.string().required(),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Write the JWT to this login's own cookie. */
const setTabSessionCookie = (res, token, sid) => {
  res.cookie(tabSessionCookieName(sid), token, authService.cookieOptions());
};

/** True when this browser still sends a pre-split shared cookie. */
const hasLegacyCookies = (req) =>
  LEGACY_COOKIE_NAMES.some((name) => typeof req.cookies?.[name] === 'string');

/** Remove obsolete cookies; they are never read for authentication. */
const clearLegacyCookies = (res) => {
  for (const name of LEGACY_COOKIE_NAMES) {
    res.clearCookie(name, authService.cookieClearOptions());
  }
};

/**
 * Clear expired/invalid per-tab cookies, revoke the sessions they named, and
 * optionally make room for a new login.
 *
 * Only names shaped like `qb_sess_<32-hex>` are considered, so the Cookie
 * header can never make the server clear an arbitrary cookie. A cookie is
 * considered active only when its signed `sid` matches the name and it has not
 * expired. Evicted or expired sessions are also revoked in the database, so a
 * copied cookie cannot outlive its browser copy.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ enforceCap: boolean }} options
 */
const pruneTabSessions = async (req, res, { enforceCap }) => {
  const now = Date.now();
  const active = [];
  const revokeSids = new Set();

  for (const { name, sid } of tabSessionCookiesOf(req.cookies)) {
    let payload = null;
    try {
      payload = jwt.verify(req.cookies[name], env.jwt.secret);
    } catch {
      payload = null;
    }

    const expiresAt = payload?.exp ? payload.exp * 1000 : 0;
    const valid = Boolean(payload && payload.sid === sid && expiresAt > now);

    if (!valid) {
      res.clearCookie(name, authService.cookieClearOptions());
      if (payload?.sid === sid) revokeSids.add(sid);
      continue;
    }

    active.push({ name, sid, iat: Number(payload.iat) || 0 });
  }

  if (enforceCap) {
    // Keep at most MAX_TAB_SESSIONS including the one about to be written.
    active.sort((a, b) => a.iat - b.iat);
    while (active.length >= MAX_TAB_SESSIONS) {
      const evicted = active.shift();
      res.clearCookie(evicted.name, authService.cookieClearOptions());
      revokeSids.add(evicted.sid);
    }
  }

  for (const sid of revokeSids) {
    try {
      await sessionService.revokeSession(sid);
    } catch (err) {
      // Housekeeping must not block a fresh login; the cookie is already gone
      // from the browser. Report the failure without logging any token value.
      console.error('[Auth] could not revoke an evicted session:', err.message);
    }
  }
};

/**
 * Issue one login: sign a JWT bound to a fresh sid, persist the allowlist row,
 * clear stale cookies and set only this tab's cookie.
 *
 * The row is written before the cookie, so a token is never handed to a browser
 * without the durable record that makes it revocable.
 */
const issueTabSession = async (req, res, user) => {
  const sid = newTabSessionId();
  const token = authService.signToken(user, sid);
  const decoded = jwt.decode(token);
  if (!decoded?.exp) throw new Error('Could not determine the session expiry.');

  await sessionService.createSession({
    sid,
    userId: user.id,
    expiresAt: new Date(decoded.exp * 1000),
  });

  await pruneTabSessions(req, res, { enforceCap: true });
  setTabSessionCookie(res, token, sid);
  return sid;
};

// ── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Creates a customer account. Employees and admins are created by the admin
 * dashboard, not self-registration.
 */
const register = async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: 'Validation failed.',
        details: error.details.map((d) => d.message),
      });
    }

    const { name, email, password } = value;

    // Check if email is already taken
    const existing = await userModel.findByEmail(email);
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const passwordHash = await authService.hashPassword(password);

    const user = await userModel.createUser({
      name,
      email,
      passwordHash,
      role: 'customer', // self-registration is always a customer
    });

    // Every login gets its own cookie. The browser must not adopt this session
    // in another tab, so no shared group cookie is written.
    if (hasLegacyCookies(req)) clearLegacyCookies(res);
    const sid = await issueTabSession(req, res, user);

    return res.status(201).json({
      message: 'Account created successfully.',
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      session: { id: sid },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 * Authenticates any user (customer, employee, admin) and starts a new,
 * independent tab session.
 */
const login = async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: 'Validation failed.',
        details: error.details.map((d) => d.message),
      });
    }

    const { email, password } = value;

    const user = await userModel.findByEmail(email);

    // Use a generic message to avoid revealing whether the email exists
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordMatch = await authService.verifyPassword(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    if (hasLegacyCookies(req)) clearLegacyCookies(res);
    const sid = await issueTabSession(req, res, user);

    return res.status(200).json({
      message: 'Logged in successfully.',
      user: {
        id:       user.id,
        name:     user.name,
        email:    user.email,
        role:     user.role,
        outletId: user.outletId || null,
      },
      session: { id: sid },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/logout
 * Revokes and clears only the session named by the caller — never other tabs.
 *
 * The server verifies that the JWT in the named cookie actually belongs to the
 * supplied sid before revoking the row. A request with no selector (or with an
 * invalid/mismatched token) still clears obsolete cookies but cannot revoke an
 * arbitrary session id.
 */
const logout = async (req, res, next) => {
  const selector = sessionSelectorOf(req);

  if (selector?.type === 'sid') {
    const cookieName = tabSessionCookieName(selector.sid);
    const token = req.cookies?.[cookieName];

    let payload = null;
    try {
      payload = jwt.verify(token, env.jwt.secret);
    } catch {
      payload = null;
    }

    if (payload?.sid === selector.sid) {
      try {
        await sessionService.revokeSession(selector.sid);
      } catch (err) {
        return next(err);
      }
    }

    res.clearCookie(cookieName, authService.cookieClearOptions());
  }

  if (hasLegacyCookies(req)) clearLegacyCookies(res);

  return res.status(200).json({ message: 'Logged out successfully.' });
};

/**
 * GET /api/auth/me
 * Returns the currently logged-in user's profile.
 * Requires the `authenticateIdentity` middleware.
 */
const getMe = async (req, res, next) => {
  try {
    // Opportunistically drop other tabs' expired cookies. The calling cookie
    // has already been verified, so this cannot sign the caller out.
    await pruneTabSessions(req, res, { enforceCap: false });
    if (hasLegacyCookies(req)) clearLegacyCookies(res);

    // req.user is set by the authenticate middleware
    const user = await userModel.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({
      user,
      ...(req.sessionId ? { session: { id: req.sessionId } } : {}),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, logout, getMe };
