-- ============================================================
-- QuickBite Database Schema
-- Safe to run against an existing database: every statement below is
-- idempotent, so re-running this file is a no-op.
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- Stores customers, outlet employees, and administrators.
-- role: 'customer' | 'employee' | 'admin'
-- outlet_id is only set for employees (links them to one outlet)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(100)  NOT NULL,
    email         VARCHAR(150)  NOT NULL UNIQUE,
    password_hash TEXT          NOT NULL,
    role          VARCHAR(20)   NOT NULL CHECK (role IN ('customer', 'employee', 'admin')),
    outlet_id     UUID,                         -- FK added after outlets table
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USER SESSIONS
-- One row per login/tab. The JWT carries the same `sid`; a token is
-- accepted only while this row exists, belongs to the token's user, has not
-- expired, and has not been revoked. This is what makes logout and role
-- changes effective server-side instead of only clearing a browser cookie.
-- No JWT or password is stored here — only the opaque session id.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    sid         VARCHAR(32) PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,

    CONSTRAINT chk_user_sessions_sid
        CHECK (sid ~ '^[0-9a-f]{32}$')
);

-- ============================================================
-- OUTLETS
-- Represents a food stall / restaurant inside the food court.
-- ============================================================
CREATE TABLE IF NOT EXISTS outlets (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100)  NOT NULL,
    description    TEXT,
    cuisine_type   VARCHAR(50)   NOT NULL,
    image_url      TEXT,
    counter_info   VARCHAR(100),               -- e.g. "Counter A, Level 2"
    is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MENU ITEMS
-- Each item belongs to one outlet.
-- price stored in paise/cents as INTEGER to avoid float errors.
-- We store it as NUMERIC(10,2) for readability.
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_items (
    id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id    UUID           NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    name         VARCHAR(100)   NOT NULL,
    description  TEXT,
    price        NUMERIC(10,2)  NOT NULL CHECK (price >= 0),
    image_url    TEXT,
    is_available BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ORDERS
-- One row per customer checkout (the "umbrella" order).
-- status mirrors the worst-case outlet_order status for display.
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
    id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    total_amount  NUMERIC(10,2)  NOT NULL CHECK (total_amount >= 0),
    status        VARCHAR(30)    NOT NULL DEFAULT 'confirmed'
                                 CHECK (status IN ('confirmed','preparing','partially_ready','ready','collected')),
    -- Which "payment method" the customer simulated at checkout.
    -- Simulated only: no gateway, no card data. NULL is allowed so orders
    -- created before this column existed remain valid.
    payment_method VARCHAR(20),
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    -- Named to match database/migrations/002 for already-existing databases.
    CONSTRAINT chk_orders_payment_method
        CHECK (payment_method IS NULL OR payment_method IN ('card', 'upi', 'wallet'))
);

-- ============================================================
-- OUTLET ORDERS
-- One row per outlet that has items in a parent order.
-- Each has its own lifecycle (status + pickup_code).
-- ============================================================
CREATE TABLE IF NOT EXISTS outlet_orders (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID          NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    outlet_id     UUID          NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
    pickup_code   VARCHAR(10)   NOT NULL,
    status        VARCHAR(30)   NOT NULL DEFAULT 'confirmed'
                                CHECK (status IN ('confirmed','preparing','ready','collected')),
    subtotal      NUMERIC(10,2) NOT NULL CHECK (subtotal >= 0),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- OUTLET ORDER ITEMS
-- Snapshot of what was ordered (price locked at order time).
-- ============================================================
CREATE TABLE IF NOT EXISTS outlet_order_items (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_order_id  UUID          NOT NULL REFERENCES outlet_orders(id) ON DELETE CASCADE,
    menu_item_id     UUID          NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
    name             VARCHAR(100)  NOT NULL,    -- snapshot of name at order time
    unit_price       NUMERIC(10,2) NOT NULL,    -- snapshot of price at order time
    quantity         INTEGER       NOT NULL CHECK (quantity > 0),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- HISTORY ARCHIVES
-- "Delete from history" is a view preference, not a data change: hiding an
-- entry inserts one row here and never touches orders / outlet_orders /
-- outlet_order_items. An empty table means "nothing hidden".
--
--   customer_order_archives — a customer hid a completed parent order.
--   outlet_order_archives   — an outlet hid one of its completed outlet orders
--                             (outlet-wide: every employee of that outlet sees
--                             the same History tab).
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_order_archives (
    order_id     UUID        PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    customer_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archived_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outlet_order_archives (
    outlet_order_id UUID        PRIMARY KEY REFERENCES outlet_orders(id) ON DELETE CASCADE,
    outlet_id       UUID        NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
    archived_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
    archived_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FOREIGN KEY: users.outlet_id → outlets.id
-- Added after outlets table to avoid forward-reference issues.
-- Wrapped in a DO block so re-running the schema does not fail with
-- "constraint already exists" (duplicate_object).
-- ============================================================
DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT fk_users_outlet
        FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE SET NULL;
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint fk_users_outlet already exists — skipping.';
END $$;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_menu_items_outlet     ON menu_items(outlet_id);
CREATE INDEX IF NOT EXISTS idx_outlet_orders_order   ON outlet_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_outlet_orders_outlet  ON outlet_orders(outlet_id);
CREATE INDEX IF NOT EXISTS idx_oo_items_outlet_order ON outlet_order_items(outlet_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer       ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_users_email           ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user    ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_order_archives_customer
    ON customer_order_archives(customer_id);
CREATE INDEX IF NOT EXISTS idx_outlet_order_archives_outlet
    ON outlet_order_archives(outlet_id);

-- A pickup code identifies exactly ONE outlet order, so it is unique
-- platform-wide (not just within a single order).
-- Already-populated databases should run
-- database/migrations/001_pickup_code_uniqueness.sql instead of relying on
-- this line: that script repairs any existing duplicates first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_outlet_orders_pickup_code
    ON outlet_orders(pickup_code);

-- ============================================================
-- TRIGGER: auto-update updated_at on row changes
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- CREATE OR REPLACE TRIGGER requires PostgreSQL 14+ (we target 16), and makes
-- this section safe to re-run.
CREATE OR REPLACE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CREATE OR REPLACE TRIGGER requires PostgreSQL 14+ (we target 16), and makes
-- this section safe to re-run.
CREATE OR REPLACE TRIGGER trg_outlets_updated_at
    BEFORE UPDATE ON outlets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CREATE OR REPLACE TRIGGER requires PostgreSQL 14+ (we target 16), and makes
-- this section safe to re-run.
CREATE OR REPLACE TRIGGER trg_menu_items_updated_at
    BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CREATE OR REPLACE TRIGGER requires PostgreSQL 14+ (we target 16), and makes
-- this section safe to re-run.
CREATE OR REPLACE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CREATE OR REPLACE TRIGGER requires PostgreSQL 14+ (we target 16), and makes
-- this section safe to re-run.
CREATE OR REPLACE TRIGGER trg_outlet_orders_updated_at
    BEFORE UPDATE ON outlet_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
