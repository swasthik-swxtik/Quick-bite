-- ============================================================
-- Migration 004 — durable per-tab session registry
--
-- Why
-- ---
-- The JWT alone is stateless: a logout only cleared the browser cookie, so a
-- copied cookie stayed valid until its 7-day expiry and an already-connected
-- Socket.IO client kept receiving events. A server-side allowlist makes the
-- token revocable and lets logout/role changes take effect everywhere.
--
-- What this does
-- --------------
-- One row per login/tab, keyed by the existing opaque `sid` (128-bit hex):
--
--   sid         the id in `qb_sess_<sid>` and `X-QB-Session`
--   user_id     the signed-in user
--   expires_at  the JWT's own expiry
--   revoked_at  set on logout, role/outlet/password change, or deletion
--
-- A token is accepted only while its sid row exists, belongs to the token's
-- user, is not revoked, and has not expired. Rows are removed with the user
-- (ON DELETE CASCADE) and expired rows are cleaned up opportunistically.
--
-- No JWT or password is stored here. The sid is already present in the cookie
-- name and is never the bearer credential by itself.
--
-- Safety
-- ------
--   * CREATE TABLE/INDEX IF NOT EXISTS: re-running this file is a no-op.
--   * No existing row is read or written. Orders, users and pickup codes are
--     untouched.
--   * Deploying this migration with the matching server invalidates JWTs
--     issued before the upgrade (they contain no `sid`). Users sign in once;
--     accounts and data remain intact. This is intentional: an old token
--     cannot be revoked without a session row.
--
-- Apply with (psql not on PATH? run the same statements through the pg pool):
--   psql -U postgres -d quickbite -f database/migrations/004_user_sessions.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_sessions (
    sid         VARCHAR(32) PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,

    CONSTRAINT chk_user_sessions_sid
        CHECK (sid ~ '^[0-9a-f]{32}$')
);

-- "Revoke every session for this user" (role/outlet/password change, delete).
CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions(user_id);

-- Opportunistic cleanup of expired rows.
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
    ON user_sessions(expires_at);

COMMIT;
