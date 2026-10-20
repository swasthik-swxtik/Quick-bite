-- ============================================================
-- Seed: Outlets
-- Four food-court stalls covering a range of cuisines.
-- Re-runnable: ids are fixed, so an existing row is left untouched.
-- ============================================================

INSERT INTO outlets (id, name, description, cuisine_type, image_url, counter_info, is_active) VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'Pizza Palace',
    'Authentic wood-fired pizzas with fresh toppings and hand-tossed bases.',
    'Pizza',
    'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop',
    'Counter A, Level 1',
    TRUE
),
(
    '22222222-2222-2222-2222-222222222222',
    'Pasta Point',
    'Classic Italian pasta dishes made with imported pasta and house-crafted sauces.',
    'Italian',
    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800&auto=format&fit=crop',
    'Counter B, Level 1',
    TRUE
),
(
    '33333333-3333-3333-3333-333333333333',
    'Burger Barn',
    'Juicy gourmet burgers, crispy fries, and thick milkshakes.',
    'Burgers',
    'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop',
    'Counter C, Level 1',
    TRUE
),
(
    '44444444-4444-4444-4444-444444444444',
    'Biryani Box',
    'Fragrant dum biryani and rich curries prepared fresh every hour.',
    'Indian',
    'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=800&auto=format&fit=crop',
    'Counter D, Level 1',
    TRUE
)
ON CONFLICT (id) DO NOTHING;
