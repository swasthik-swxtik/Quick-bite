/**
 * user.model.js — SQL queries related to the users table.
 *
 * Rule: No business logic here. Only data access.
 * Rule: Never return password_hash to the caller.
 */

const { query } = require('../config/db');

/**
 * Create a new user.
 * @param {{ name, email, passwordHash, role, outletId? }} data
 * @returns {Promise<Object>} The created user (without password_hash)
 */
const createUser = async ({ name, email, passwordHash, role, outletId = null }) => {
  const sql = `
    INSERT INTO users (name, email, password_hash, role, outlet_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, name, email, role, outlet_id AS "outletId", created_at AS "createdAt"
  `;
  const { rows } = await query(sql, [name, email, passwordHash, role, outletId]);
  return rows[0];
};

/**
 * Find a user by email — includes password_hash for authentication only.
 * Only call this in auth.service.js where the hash is compared then discarded.
 */
const findByEmail = async (email) => {
  const sql = `
    SELECT id, name, email, password_hash AS "passwordHash", role, outlet_id AS "outletId"
    FROM users
    WHERE email = $1
  `;
  const { rows } = await query(sql, [email]);
  return rows[0] || null;
};

/**
 * Find a user by ID — does NOT include password_hash.
 */
const findById = async (id) => {
  const sql = `
    SELECT id, name, email, role, outlet_id AS "outletId", created_at AS "createdAt"
    FROM users
    WHERE id = $1
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

/**
 * Get all employees (for admin dashboard).
 */
const findAllEmployees = async () => {
  const sql = `
    SELECT u.id, u.name, u.email, u.role, u.outlet_id AS "outletId",
           o.name AS "outletName", u.created_at AS "createdAt"
    FROM users u
    LEFT JOIN outlets o ON o.id = u.outlet_id
    WHERE u.role = 'employee'
    ORDER BY u.created_at DESC
  `;
  const { rows } = await query(sql);
  return rows;
};

/**
 * Update a user's details (admin operation).
 *
 * Only the fields actually present in `patch` are written, so an update that
 * omits `outletId` never clears the assignment. Passing `outletId: null`
 * explicitly does clear it. `passwordHash` is applied when supplied.
 *
 * @param {string} id
 * @param {{ name?, email?, role?, outletId?, passwordHash? }} patch
 * @returns {Promise<Object|null>}
 */
const updateUser = async (id, patch = {}) => {
  const fields = [];
  const values = [];

  const addField = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (patch.name       !== undefined) addField('name', patch.name);
  if (patch.email      !== undefined) addField('email', patch.email);
  if (patch.role       !== undefined) addField('role', patch.role);
  if (patch.outletId   !== undefined) addField('outlet_id', patch.outletId);
  if (patch.passwordHash !== undefined) addField('password_hash', patch.passwordHash);

  // Nothing to update — return the current row instead of issuing invalid SQL
  if (fields.length === 0) return findById(id);

  values.push(id);
  const sql = `
    UPDATE users
    SET ${fields.join(', ')}
    WHERE id = $${values.length}
    RETURNING id, name, email, role, outlet_id AS "outletId"
  `;

  const { rows } = await query(sql, values);
  return rows[0] || null;
};

/**
 * Delete a user by ID (admin operation).
 */
const deleteUser = async (id) => {
  await query('DELETE FROM users WHERE id = $1', [id]);
};

module.exports = { createUser, findByEmail, findById, findAllEmployees, updateUser, deleteUser };
