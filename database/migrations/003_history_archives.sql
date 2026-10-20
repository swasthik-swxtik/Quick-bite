-- ============================================================
-- Migration 003 — per-view history archives
--
-- Why
-- ---
-- Customers need to remove a completed order from their history, and employees
-- need to clear completed orders out of their History tab. Neither action may
-- delete or rewrite anything: the order, its items, the (simulated) payment
-- facts and the pickup-code verification record must all survive.
--
-- Visibility is therefore stored *beside* the order, not on it: one small
-- archive row per hidden entry. `orders` and `outlet_orders` are never updated,
-- so admin views, the other outlets of a multi-outlet order and the customer's
-- own record of what each counter did stay exactly as they were.
--
-- What this is NOT
-- ----------------
-- No soft-delete column, no status change, no cascade of visibility between
-- roles. A customer hiding a parent order cannot hide any outlet order, and an
-- employee archiving an outlet order cannot hide the customer's order.
--
-- Safety
-- ------
--   * CREATE TABLE/INDEX IF NOT EXISTS, so re-running this file is a no-op.
--   * No existing row is read or written. An empty table means "nothing is
--     hidden", so every order that already exists stays visible.
--   * FKs cascade with the parent rows. The application never deletes orders,
--     but the test suites delete their own throwaway orders/users and must keep
--     working.
--
-- Apply with (psql not on PATH? run the same statements through the pg pool):
--   psql -U postgres -d quickbite -f database/migrations/003_history_archives.sql
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS customer_order_archives (
    order_id     UUID        PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    customer_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports "which orders did this customer hide" audits and keeps the
-- ON DELETE CASCADE from users cheap.
CREATE INDEX IF NOT EXISTS idx_customer_order_archives_customer
    ON customer_order_archives(customer_id);

CREATE TABLE IF NOT EXISTS outlet_order_archives (
    outlet_order_id UUID        PRIMARY KEY REFERENCES outlet_orders(id) ON DELETE CASCADE,
    outlet_id       UUID        NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    archived_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
    archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lets a future "archived at this outlet" query start from the outlet.
CREATE INDEX IF NOT EXISTS idx_outlet_order_archives_outlet
    ON outlet_order_archives(outlet_id);

COMMIT;
