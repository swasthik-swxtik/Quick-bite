-- ============================================================
-- Migration 002 — record the (simulated) payment method on orders
--
-- Why
-- ---
-- Checkout validates a payment method (card | upi | wallet) and then threw it
-- away, because there was nowhere to store it. Recording which method the
-- customer picked is the smallest useful step towards a real integration.
--
-- What this is NOT
-- ----------------
-- There is no payment integration here: no gateway, no card data, no amounts,
-- no payment status. Just one column naming the method that was simulated.
--
-- Safety
-- ------
--   * The column is NULLABLE, so orders created before this migration stay valid.
--   * ADD COLUMN IF NOT EXISTS + a guarded constraint make it re-runnable.
--   * No row is updated, so no existing data changes.
--
-- Apply with:
--   psql -U postgres -d quickbite -f database/migrations/002_orders_payment_method.sql
-- ============================================================

BEGIN;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

-- Named identically to the constraint declared in database/schema.sql so a
-- migrated database and a freshly created one end up with the same shape.
DO $$
BEGIN
    ALTER TABLE orders
        ADD CONSTRAINT chk_orders_payment_method
        CHECK (payment_method IS NULL OR payment_method IN ('card', 'upi', 'wallet'));
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint chk_orders_payment_method already exists — skipping.';
END $$;

COMMIT;
