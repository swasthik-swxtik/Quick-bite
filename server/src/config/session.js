/**
 * session.js — Where each login session lives.
 *
 * A browser shares one cookie jar across all of its tabs, so a single cookie
 * can only ever hold one identity. QuickBite therefore gives every login its
 * own cookie:
 *
 *   qb_sess_<sid>   — one httpOnly JWT cookie per login (customer, employee or
 *                     admin); <sid> is 128 bits of cryptographic randomness.
 *
 * A tab remembers its <sid> in sessionStorage (never the JWT) and names it in
 * `X-QB-Session` / `auth.session`. The server reads exactly that cookie. A
 * missing, invalid or tampered sid is a 401 — it never falls back to another
 * tab's cookie. The JWT signature decides the role; the durable
 * `user_sessions` row decides whether that login is still allowed.
 *
 * The pre-split `qb_customer_token`, `qb_staff_token` and `token` cookies are
 * obsolete: they are no longer read. They are cleared on login/register/logout
 * so old browsers do not keep sending them.
 */

const crypto = require('crypto');

/** Header a tab uses to declare which per-tab session it belongs to. */
const SESSION_HINT_HEADER = 'x-qb-session';

/** Obsolete shared cookies; never read, cleared at the next auth action. */
const LEGACY_COOKIE_NAMES = Object.freeze([
  'qb_customer_token',
  'qb_staff_token',
  'token',
]);

/** Per-tab session cookies: qb_sess_<32 lowercase hex characters>. */
const TAB_SESSION_PREFIX = 'qb_sess_';
const TAB_SESSION_ID_BYTES = 16;
const TAB_SESSION_ID_RE = /^[0-9a-f]{32}$/;

/**
 * How many per-tab sessions one browser may keep. Each JWT is a few hundred
 * bytes, so eight keeps the Cookie header comfortably below common proxy and
 * Node limits; the oldest session is evicted when a new login exceeds it.
 */
const MAX_TAB_SESSIONS = 8;

/** Which route group a user's role belongs to (customer vs staff routes). */
const sessionForRole = (role) => (role === 'customer' ? 'customer' : 'staff');

/** A fresh, unguessable session id (128 bits, hex). */
const newTabSessionId = () => crypto.randomBytes(TAB_SESSION_ID_BYTES).toString('hex');

/** True only for a well-formed session id. Never a cookie name or JWT. */
const isTabSessionId = (value) => typeof value === 'string' && TAB_SESSION_ID_RE.test(value);

/** The cookie that stores a particular login's JWT. */
const tabSessionCookieName = (sid) => `${TAB_SESSION_PREFIX}${sid}`;

/** The sid encoded in a cookie name, or null when the name is not ours. */
const tabSessionIdFromCookieName = (name) => {
  if (typeof name !== 'string' || !name.startsWith(TAB_SESSION_PREFIX)) return null;
  const sid = name.slice(TAB_SESSION_PREFIX.length);
  return isTabSessionId(sid) ? sid : null;
};

/** All per-tab session cookies in a parsed cookie jar. */
const tabSessionCookiesOf = (cookies) =>
  Object.keys(cookies || {})
    .map((name) => {
      const sid = tabSessionIdFromCookieName(name);
      return sid ? { name, sid } : null;
    })
    .filter(Boolean);

/**
 * Read the request's session selector.
 *
 * Only a per-tab sid in the dedicated header is accepted. It is never read
 * from a query string (that would leak it through logs/history/Referer), and
 * legacy `customer`/`staff` hints are no longer recognised.
 *
 * An explicitly invalid header is treated as "no usable selector", so the
 * caller answers 401 rather than guessing a cookie.
 *
 * @returns {{type:'sid', sid:string}|null}
 */
const sessionSelectorOf = (req) => {
  const raw = req?.get?.(SESSION_HINT_HEADER);
  const header = typeof raw === 'string' ? raw.trim() : '';
  return isTabSessionId(header) ? { type: 'sid', sid: header } : null;
};

module.exports = {
  SESSION_HINT_HEADER,
  LEGACY_COOKIE_NAMES,

  // Route groups
  sessionForRole,

  // Per-tab sessions
  TAB_SESSION_PREFIX,
  MAX_TAB_SESSIONS,
  newTabSessionId,
  isTabSessionId,
  tabSessionCookieName,
  tabSessionIdFromCookieName,
  tabSessionCookiesOf,
  sessionSelectorOf,
};
