/**
 * outlet.model.js — SQL queries for the outlets table.
 */

const { query } = require('../config/db');

/**
 * Get all active outlets (for customers browsing the food court).
 */
const findAllActive = async () => {
  const sql = `
    SELECT id, name, description, cuisine_type AS "cuisineType",
           image_url AS "imageUrl", counter_info AS "counterInfo",
           is_active AS "isActive"
    FROM outlets
    WHERE is_active = TRUE
    ORDER BY name ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

/**
 * Get all outlets (for admin dashboard — includes inactive).
 */
const findAll = async () => {
  const sql = `
    SELECT id, name, description, cuisine_type AS "cuisineType",
           image_url AS "imageUrl", counter_info AS "counterInfo",
           is_active AS "isActive", created_at AS "createdAt"
    FROM outlets
    ORDER BY created_at DESC
  `;
  const { rows } = await query(sql);
  return rows;
};

/**
 * Find a single outlet by ID.
 */
const findById = async (id) => {
  const sql = `
    SELECT id, name, description, cuisine_type AS "cuisineType",
           image_url AS "imageUrl", counter_info AS "counterInfo",
           is_active AS "isActive"
    FROM outlets
    WHERE id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

/**
 * Create a new outlet (admin operation).
 */
const createOutlet = async ({ name, description, cuisineType, imageUrl, counterInfo }) => {
  const sql = `
    INSERT INTO outlets (name, description, cuisine_type, image_url, counter_info)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, description, cuisine_type AS "cuisineType",
              image_url AS "imageUrl", counter_info AS "counterInfo", is_active AS "isActive"
  `;
  const { rows } = await query(sql, [name, description, cuisineType, imageUrl, counterInfo]);
  return rows[0];
};

/**
 * Update an outlet (admin operation).
 */
const updateOutlet = async (id, { name, description, cuisineType, imageUrl, counterInfo, isActive }) => {
  const sql = `
    UPDATE outlets
    SET name          = COALESCE($1, name),
        description   = COALESCE($2, description),
        cuisine_type  = COALESCE($3, cuisine_type),
        image_url     = COALESCE($4, image_url),
        counter_info  = COALESCE($5, counter_info),
        is_active     = COALESCE($6, is_active)
    WHERE id = $7
    RETURNING id, name, description, cuisine_type AS "cuisineType",
              image_url AS "imageUrl", counter_info AS "counterInfo", is_active AS "isActive"
  `;
  const { rows } = await query(sql, [name, description, cuisineType, imageUrl, counterInfo, isActive, id]);
  return rows[0] || null;
};

/**
 * Delete an outlet (admin operation).
 */
const deleteOutlet = async (id) => {
  await query('DELETE FROM outlets WHERE id = $1', [id]);
};

module.exports = { findAllActive, findAll, findById, createOutlet, updateOutlet, deleteOutlet };
