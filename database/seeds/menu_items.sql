-- ============================================================
-- Seed: Menu Items
-- Prices are in INR (stored as NUMERIC(10,2)).
--
-- Re-runnable: items use generated UUIDs and have no natural unique key, so
-- each insert is guarded with NOT EXISTS on (outlet_id, name).
-- ============================================================

-- ── Pizza Palace ────────────────────────────────────────────
INSERT INTO menu_items (outlet_id, name, description, price, image_url, is_available)
SELECT v.outlet_id::uuid, v.name, v.description, v.price::numeric(10,2), v.image_url, v.is_available
FROM (VALUES
(
    '11111111-1111-1111-1111-111111111111',
    'Margherita Pizza',
    'Classic tomato sauce, fresh mozzarella, and basil on a crispy base.',
    249.00,
    'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=600&auto=format&fit=crop',
    TRUE
),
(
    '11111111-1111-1111-1111-111111111111',
    'Pepperoni Feast',
    'Loaded with generous pepperoni slices and melted cheddar.',
    329.00,
    'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=600&auto=format&fit=crop',
    TRUE
),
(
    '11111111-1111-1111-1111-111111111111',
    'BBQ Chicken Pizza',
    'Smoky BBQ sauce, grilled chicken, red onions, and cheddar.',
    349.00,
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&auto=format&fit=crop',
    TRUE
),
(
    '11111111-1111-1111-1111-111111111111',
    'Veggie Supreme',
    'Bell peppers, mushrooms, olives, and sun-dried tomatoes.',
    279.00,
    'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?w=600&auto=format&fit=crop',
    TRUE
),
(
    '11111111-1111-1111-1111-111111111111',
    'Garlic Bread',
    'Toasted sourdough with herb butter and melted mozzarella.',
    99.00,
    'https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?w=600&auto=format&fit=crop',
    TRUE
)
) AS v(outlet_id, name, description, price, image_url, is_available)
WHERE NOT EXISTS (
    SELECT 1 FROM menu_items m
    WHERE m.outlet_id = v.outlet_id::uuid AND m.name = v.name
);

-- ── Pasta Point ─────────────────────────────────────────────
INSERT INTO menu_items (outlet_id, name, description, price, image_url, is_available)
SELECT v.outlet_id::uuid, v.name, v.description, v.price::numeric(10,2), v.image_url, v.is_available
FROM (VALUES
(
    '22222222-2222-2222-2222-222222222222',
    'Spaghetti Bolognese',
    'Slow-cooked minced beef ragù with a rich tomato sauce.',
    279.00,
    'https://images.unsplash.com/photo-1555949258-eb67b1ef0ceb?w=600&auto=format&fit=crop',
    TRUE
),
(
    '22222222-2222-2222-2222-222222222222',
    'Penne Arrabbiata',
    'Penne in a spicy tomato sauce with garlic and fresh chilli.',
    229.00,
    'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=600&auto=format&fit=crop',
    TRUE
),
(
    '22222222-2222-2222-2222-222222222222',
    'Fettuccine Alfredo',
    'Silky cream sauce with parmesan, tossed with fettuccine.',
    299.00,
    'https://images.unsplash.com/photo-1645112411341-6c4fd023714a?w=600&auto=format&fit=crop',
    TRUE
),
(
    '22222222-2222-2222-2222-222222222222',
    'Pesto Pasta',
    'Al dente pasta tossed in house-made basil pesto and pine nuts.',
    259.00,
    'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=600&auto=format&fit=crop',
    TRUE
),
(
    '22222222-2222-2222-2222-222222222222',
    'Garlic Focaccia',
    'Soft Italian flatbread with rosemary, sea salt, and olive oil.',
    89.00,
    'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=600&auto=format&fit=crop',
    TRUE
)
) AS v(outlet_id, name, description, price, image_url, is_available)
WHERE NOT EXISTS (
    SELECT 1 FROM menu_items m
    WHERE m.outlet_id = v.outlet_id::uuid AND m.name = v.name
);

-- ── Burger Barn ─────────────────────────────────────────────
INSERT INTO menu_items (outlet_id, name, description, price, image_url, is_available)
SELECT v.outlet_id::uuid, v.name, v.description, v.price::numeric(10,2), v.image_url, v.is_available
FROM (VALUES
(
    '33333333-3333-3333-3333-333333333333',
    'Classic Cheeseburger',
    'Beef patty, cheddar, lettuce, tomato, pickles, and special sauce.',
    219.00,
    'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop',
    TRUE
),
(
    '33333333-3333-3333-3333-333333333333',
    'Double Smash Burger',
    'Two smashed patties, American cheese, caramelised onions, sriracha mayo.',
    299.00,
    'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=600&auto=format&fit=crop',
    TRUE
),
(
    '33333333-3333-3333-3333-333333333333',
    'Crispy Chicken Burger',
    'Southern-fried chicken breast, coleslaw, pickles, and honey mustard.',
    249.00,
    'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=600&auto=format&fit=crop',
    TRUE
),
(
    '33333333-3333-3333-3333-333333333333',
    'Loaded Fries',
    'Crispy fries topped with cheese sauce, jalapeños, and bacon bits.',
    149.00,
    'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop',
    TRUE
),
(
    '33333333-3333-3333-3333-333333333333',
    'Chocolate Milkshake',
    'Thick, creamy shake blended with premium chocolate ice cream.',
    129.00,
    'https://images.unsplash.com/photo-1572490122747-3e9bc92fa7f9?w=600&auto=format&fit=crop',
    TRUE
)
) AS v(outlet_id, name, description, price, image_url, is_available)
WHERE NOT EXISTS (
    SELECT 1 FROM menu_items m
    WHERE m.outlet_id = v.outlet_id::uuid AND m.name = v.name
);

-- ── Biryani Box ─────────────────────────────────────────────
INSERT INTO menu_items (outlet_id, name, description, price, image_url, is_available)
SELECT v.outlet_id::uuid, v.name, v.description, v.price::numeric(10,2), v.image_url, v.is_available
FROM (VALUES
(
    '44444444-4444-4444-4444-444444444444',
    'Chicken Dum Biryani',
    'Aromatic basmati rice slow-cooked with tender chicken and whole spices.',
    299.00,
    'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop',
    TRUE
),
(
    '44444444-4444-4444-4444-444444444444',
    'Mutton Biryani',
    'Rich, fall-off-the-bone mutton pieces in saffron-infused dum biryani.',
    379.00,
    'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600&auto=format&fit=crop',
    TRUE
),
(
    '44444444-4444-4444-4444-444444444444',
    'Veg Biryani',
    'Fresh seasonal vegetables and paneer in a flavourful biryani masala.',
    249.00,
    'https://images.unsplash.com/photo-1645177628172-a94c1f96debb?w=600&auto=format&fit=crop',
    TRUE
),
(
    '44444444-4444-4444-4444-444444444444',
    'Butter Chicken',
    'Creamy tomato-based curry with tender chicken pieces. Served with naan.',
    319.00,
    'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&auto=format&fit=crop',
    TRUE
),
(
    '44444444-4444-4444-4444-444444444444',
    'Raita',
    'Chilled yoghurt with cucumber, mint, and roasted cumin.',
    59.00,
    'https://images.unsplash.com/photo-1606491048802-8342506d6471?w=600&auto=format&fit=crop',
    TRUE
)
) AS v(outlet_id, name, description, price, image_url, is_available)
WHERE NOT EXISTS (
    SELECT 1 FROM menu_items m
    WHERE m.outlet_id = v.outlet_id::uuid AND m.name = v.name
);
