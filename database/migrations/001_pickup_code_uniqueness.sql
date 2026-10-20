-- ============================================================
-- Migration 001 — enforce uniqueness of outlet_orders.pickup_code
--
-- Why
-- ---
-- Pickup codes are generated randomly (2 letters + 4 digits) and were never
-- checked against the database, so two outlet orders could in principle share
-- a code. The code is what the customer shows at the counter, so it must
-- identify exactly one outlet order.
--
-- What this does
-- --------------
--   1. Reassigns a fresh code to every row that duplicates an earlier row,
--      keeping the OLDEST row of each group on its original code.
--   2. Creates the UNIQUE index. This also acts as the proof that step 1 left
--      no duplicates behind: if any remained, this statement would fail.
--
-- Safety
-- ------
--   * Nothing is dropped, recreated or reset.
--   * Both steps run in one transaction: either the codes are repaired AND the
--     constraint exists, or neither happens.
--   * Safe to run more than once (the de-duplication finds nothing to do and
--     the index creation is IF NOT EXISTS).
--
-- Apply with:
--   psql -U postgres -d quickbite -f database/migrations/001_pickup_code_uniqueness.sql
-- ============================================================

BEGIN;

-- ── Step 1: repair any existing duplicates ──────────────────────────────────
-- Ordering by created_at (then id as a tie-breaker) means the customer who
-- already collected / is holding the older slip keeps the code they were given.
DO $$
DECLARE
    duplicate  RECORD;
    candidate  TEXT;
    letters    CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- 24 chars, no I/O
BEGIN
    FOR duplicate IN
        SELECT id
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY pickup_code
                       ORDER BY created_at ASC, id ASC
                   ) AS position
            FROM outlet_orders
        ) ranked
        WHERE position > 1
    LOOP
        -- Same format the application uses: two letters (no I/O) + four digits.
        -- The inner loop guarantees the replacement is not already taken.
        LOOP
            candidate :=
                substr(letters, 1 + floor(random() * length(letters))::int, 1) ||
                substr(letters, 1 + floor(random() * length(letters))::int, 1) ||
                lpad(floor(random() * 10000)::int::text, 4, '0');

            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM outlet_orders WHERE pickup_code = candidate
            );
        END LOOP;

        UPDATE outlet_orders
        SET pickup_code = candidate
        WHERE id = duplicate.id;
    END LOOP;
END $$;

-- ── Step 2: enforce the invariant ───────────────────────────────────────────
-- The name is referenced by server/src/services/order.service.js, which retries
-- the whole checkout if a newly generated code collides with this index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_orders_pickup_code
    ON outlet_orders (pickup_code);

COMMIT;
