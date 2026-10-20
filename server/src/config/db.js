/**
 * db.js — PostgreSQL connection pool.
 *
 * We use a pool (not a single client) so that multiple concurrent requests
 * can each grab a connection, use it, and return it — without waiting.
 *
 * Usage in model files:
 *   const { query } = require('../config/db');
 *   const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
 */

const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  // Max connections in the pool (default 10 is fine for development)
  max: 10,
  // Milliseconds a client must sit idle before being closed
  idleTimeoutMillis: 30000,
  // Milliseconds to wait before timing out when connecting a new client
  connectionTimeoutMillis: 2000,
});

// Log when a new client connects (development only)
pool.on('connect', () => {
  if (env.nodeEnv === 'development') {
    console.log('[DB] New client connected to PostgreSQL pool');
  }
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle pool client:', err.message);
  process.exit(1);
});

/**
 * Runs a single SQL query using a pool connection.
 * @param {string} text  - SQL query string with $1, $2 … placeholders
 * @param {Array}  params - Values for the placeholders
 * @returns {Promise<pg.QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

/**
 * For transactions: grab a dedicated client, run queries, then release.
 * Usage:
 *   const client = await getClient();
 *   try {
 *     await client.query('BEGIN');
 *     await client.query('INSERT ...');
 *     await client.query('COMMIT');
 *   } catch (err) {
 *     await client.query('ROLLBACK');
 *     throw err;
 *   } finally {
 *     client.release();
 *   }
 */
const getClient = () => pool.connect();

module.exports = { query, getClient };
