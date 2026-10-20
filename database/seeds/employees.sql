-- ============================================================
-- Seed: Employees and Admin
-- Re-runnable: email is unique, so existing accounts are left untouched.
-- ============================================================

-- Admin user (no outlet assignment)
INSERT INTO users (name, email, password_hash, role, outlet_id) VALUES
(
    'Quick Admin',
    'admin@quickbite.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'admin',
    NULL
)
ON CONFLICT (email) DO NOTHING;

-- Pizza Palace employee
INSERT INTO users (name, email, password_hash, role, outlet_id) VALUES
(
    'Pizza Staff',
    'pizza@quickbite.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'employee',
    '11111111-1111-1111-1111-111111111111'
)
ON CONFLICT (email) DO NOTHING;

-- Pasta Point employee
INSERT INTO users (name, email, password_hash, role, outlet_id) VALUES
(
    'Pasta Staff',
    'pasta@quickbite.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'employee',
    '22222222-2222-2222-2222-222222222222'
)
ON CONFLICT (email) DO NOTHING;

-- Burger Barn employee
INSERT INTO users (name, email, password_hash, role, outlet_id) VALUES
(
    'Burger Staff',
    'burger@quickbite.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'employee',
    '33333333-3333-3333-3333-333333333333'
)
ON CONFLICT (email) DO NOTHING;

-- Biryani Box employee
INSERT INTO users (name, email, password_hash, role, outlet_id) VALUES
(
    'Biryani Staff',
    'biryani@quickbite.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'employee',
    '44444444-4444-4444-4444-444444444444'
)
ON CONFLICT (email) DO NOTHING;
