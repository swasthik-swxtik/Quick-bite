/**
 * session.js — Which login session the current tab belongs to.
 *
 * Every login gets its own httpOnly cookie (`qb_sess_<sid>`). A browser shares
 * one cookie jar across all of its tabs, so the tab keeps the opaque session id
 * — never the JWT — in sessionStorage and names it on every request. A missing
 * or invalid id is signed out; it never falls back to another tab's cookie.
 *
 * The older customer/staff helpers remain for route defaults and the migration
 * window, but they are no longer used to choose the auth cookie for a request.
 */

const STORAGE_KEY = 'qb:session';
const SESSION_ID_KEY = 'qb:sessionId';

const SESSIONS = ['customer', 'staff'];

/** The server's per-login session id: 128 bits, lowercase hex. */
const SESSION_ID_RE = /^[0-9a-f]{32}$/;

/** Route prefixes that belong to the staff portal. */
const STAFF_ROUTE_PREFIXES = ['/employee', '/admin'];

/** Which session a route belongs to. */
export const sessionForPath = (pathname) => {
  const path = typeof pathname === 'string' && pathname ? pathname : '/';
  const isStaff = STAFF_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
  return isStaff ? 'staff' : 'customer';
};

const isSession = (value) => SESSIONS.includes(value);

/** The session stored for this tab, or null when it has not been decided yet. */
export const readTabSession = () => {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    return isSession(value) ? value : null;
  } catch {
    // Storage can be unavailable (private mode / disabled cookies+storage)
    return null;
  }
};

/** The session to use for requests and sockets from this tab. */
export const getTabSession = () =>
  readTabSession() || sessionForPath(window.location.pathname);

/** Remember which session this tab is using. */
export const setTabSession = (session) => {
  if (!isSession(session)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, session);
  } catch {
    // Ignore: the route-derived fallback still resolves a sane session
  }
};

/** The session a user's role belongs to. */
export const sessionForRole = (role) => (role === 'customer' ? 'customer' : 'staff');

// ── Shopping permission ─────────────────────────────────────────────────────

/**
 * Whether the current auth state may shop.
 *
 * A resolved role is authoritative and must not be overridden by the startup
 * `isLoading` flag: a customer can already be known (for example, just signed
 * in on this tab) while the initial session check is still in flight. Staff
 * never shop; a guest may build a cart until they sign in.
 */
export const canShopAs = (user, isLoading = false) =>
  user ? user.role === 'customer' : !isLoading;

/** True only for signed-in staff accounts (employee/admin). */
export const isStaffAs = (user) => !!user && user.role !== 'customer';

// ── Per-login (per-tab) session id ──────────────────────────────────────────

/** This tab's opaque session id, or null when it has none / it is malformed. */
export const readTabSessionId = () => {
  try {
    const value = window.sessionStorage.getItem(SESSION_ID_KEY);
    return typeof value === 'string' && SESSION_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
};

/** The id to send as `X-QB-Session` / `auth.session`. Never the JWT. */
export const getTabSessionId = () => readTabSessionId();

/** Remember the session id the server returned for this login. */
export const setTabSessionId = (id) => {
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return;
  try {
    window.sessionStorage.setItem(SESSION_ID_KEY, id);
  } catch {
    // Without storage this tab cannot name its session; it stays signed out.
  }
};

/** Forget this tab's session id (logout). Other tabs keep theirs. */
export const clearTabSessionId = () => {
  try {
    window.sessionStorage.removeItem(SESSION_ID_KEY);
  } catch {
    // Nothing to clear.
  }
};

/** Forget the legacy group marker as well; it no longer selects a cookie. */
export const clearTabSession = () => {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
};
