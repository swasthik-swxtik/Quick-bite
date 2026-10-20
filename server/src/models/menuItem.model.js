/**
 * menuItem.model.js — SQL queries for the menu_items table.
 */

const { query } = require('../config/db');

/**
 * Get all available menu items for a specific outlet.
 * Used by customers browsing an outlet's menu.
 */
const findByOutletId = async (outletId) => {
  const sql = `
    SELECT id, outlet_id AS "outletId", name, description,
           price, image_url AS "imageUrl", is_available AS "isAvailable"
    FROM menu_items
    WHERE outlet_id = $1
    ORDER BY name ASC
  `;
  const { rows } = await query(sql, [outletId]);
  return rows;
};

/**
 * Find a single menu item by ID.
 * Used during order placement to verify price and availability.
 */
const findById = async (id) => {
  const sql = `
    SELECT id, outlet_id AS "outletId", name, description,
           price, image_url AS "imageUrl", is_available AS "isAvailable"
    FROM menu_items
    WHERE id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

/**
 * Find multiple menu items by their IDs in one query.
 * Used by order.service.js to verify all cart items at once.
 * @param {string[]} ids - Array of menu item UUIDs
 */
const findManyByIds = async (ids) => {
  if (!ids || ids.length === 0) return [];
  // $1, $2, ... placeholders built dynamically
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `
    SELECT id, outlet_id AS "outletId", name, price, is_available AS "isAvailable"
    FROM menu_items
    WHERE id IN (${placeholders})
  `;
  const { rows } = await query(sql, ids);
  return rows;
};

/**
 * Create a new menu item (admin operation).
 */
const createMenuItem = async ({ outletId, name, description, price, imageUrl }) => {
  const sql = `
    INSERT INTO menu_items (outlet_id, name, description, price, image_url)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, outlet_id AS "outletId", name, description,
              price, image_url AS "imageUrl", is_available AS "isAvailable"
  `;
  const { rows } = await query(sql, [outletId, name, description, price, imageUrl]);
  return rows[0];
};

/**
 * Update a menu item (admin operation).
 */
const updateMenuItem = async (id, { name, description, price, imageUrl, isAvailable }) => {
  const sql = `
    UPDATE menu_items
    SET name         = COALESCE($1, name),
        description  = COALESCE($2, description),
        price        = COALESCE($3, price),
        image_url    = COALESCE($4, image_url),
        is_available = COALESCE($5, is_available)
    WHERE id = $6
    RETURNING id, outlet_id AS "outletId", name, description,
              price, image_url AS "imageUrl", is_available AS "isAvailable"
  `;
  const { rows } = await query(sql, [name, description, price, imageUrl, isAvailable, id]);
  return rows[0] || null;
};

/**
 * Delete a menu item (admin operation).
 */
const deleteMenuItem = async (id) => {
  await query('DELETE FROM menu_items WHERE id = $1', [id]);
};

module.exports = {
  findByOutletId,
  findById,
  findManyByIds,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
};
