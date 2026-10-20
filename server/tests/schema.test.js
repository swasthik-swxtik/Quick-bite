/**
 * P1.12 — The schema and seed files are re-runnable.
 *
 * Creates a throwaway database, applies schema.sql and every seed file TWICE,
 * and asserts the second pass is a no-op (no error, no duplicated rows), then
 * drops the throwaway database again.
 *
 * The development database is never touched.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const env = require('../src/config/env');
const { query, getClient } = require('../src/config/db');

const UNIQUE = `${Date.now()}`;
const PIZZA_OUTLET = '11111111-1111-1111-1111-111111111111';
const PASTA_OUTLET = '22222222-2222-2222-2222-222222222222';

const DB_DIR = path.resolve(__dirname, '../../database');

const schemaSql = fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8');

const seedFiles = ['outlets.sql', 'menu_items.sql', 'employees.sql'].map((name) => ({
  name,
  sql: fs.readFileSync(path.join(DB_DIR, 'seeds', name), 'utf8'),
}));

const scratchName = `quickbite_schema_check_${Date.now()}`;

const counts = async (client) => {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users)      AS users,
      (SELECT COUNT(*)::int FROM outlets)    AS outlets,
      (SELECT COUNT(*)::int FROM menu_items) AS menu_items,
      (SELECT COUNT(*)::int FROM orders)     AS orders
  `);
  return rows[0];
};

const applyAll = async (client) => {
  await client.query(schemaSql);
  for (const seed of seedFiles) {
    await client.query(seed.sql);
  }
};

test('P1.12 — schema.sql and the seeds can be applied twice without error or duplication', async () => {
  const admin = new Client({ ...env.db, database: 'postgres' });
  let scratch;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${scratchName}"`);

    scratch = new Client({ ...env.db, database: scratchName });
    await scratch.connect();

    // ── First application: creates everything ──────────────────────────────
    await applyAll(scratch);
    const first = await counts(scratch);
    assert.deepEqual(first, { users: 5, outlets: 4, menu_items: 20, orders: 0 });

    // ── Second application: must be a clean no-op ──────────────────────────
    await applyAll(scratch);
    const second = await counts(scratch);

    assert.deepEqual(second, first, 're-running schema + seeds must not change row counts');
  } finally {
    if (scratch) await scratch.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }
});

/**
 * Stage 3 fix (1) — a pickup code identifies exactly ONE outlet order.
 *
 * The migration that introduces this (database/migrations/001) repairs existing
 * duplicates before creating the index; this test proves the resulting
 * guarantee holds in the live database: the index exists, no duplicate codes
 * are stored, and a duplicate insert is refused even when the application layer
 * is bypassed.
 *
 * Everything that writes happens in a transaction that is rolled back, so the
 * development database is left exactly as it was found.
 */
test('Stage 3 fix (1) — outlet_orders.pickup_code is unique across orders', async () => {
  // ── the index exists and is unique ────────────────────────────────────────
  const index = await query(
    `SELECT indexdef FROM pg_indexes
     WHERE tablename = 'outlet_orders' AND indexname = 'uq_outlet_orders_pickup_code'`
  );
  assert.equal(index.rowCount, 1, 'expected uq_outlet_orders_pickup_code to exist');
  assert.match(index.rows[0].indexdef, /UNIQUE/);

  // ── and no duplicate codes are present today ─────────────────────────────
  const duplicates = await query(
    `SELECT COUNT(*)::int AS n
     FROM (
       SELECT pickup_code FROM outlet_orders GROUP BY pickup_code HAVING COUNT(*) > 1
     ) d`
  );
  assert.equal(duplicates.rows[0].n, 0, 'no two outlet orders may share a pickup code');

  // ── the database refuses a duplicate that the app never generated ────────
  let code;
  for (let attempt = 0; attempt < 20 && !code; attempt += 1) {
    const candidate = `TY${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    const taken = await query('SELECT 1 FROM outlet_orders WHERE pickup_code = $1', [candidate]);
    if (taken.rowCount === 0) code = candidate;
  }
  assert.ok(code, 'could not find a free pickup code for the probe');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const buyer = (
      await client.query(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ('Pickup Code Probe', $1, 'not-a-real-hash', 'customer')
         RETURNING id`,
        [`pickup-probe-${UNIQUE}@example.com`]
      )
    ).rows[0];

    const order = (
      await client.query(
        `INSERT INTO orders (customer_id, total_amount, status)
         VALUES ($1, 1.00, 'confirmed') RETURNING id`,
        [buyer.id]
      )
    ).rows[0];

    const insertOutletOrder = (outletId) =>
      client.query(
        `INSERT INTO outlet_orders (order_id, outlet_id, pickup_code, subtotal)
         VALUES ($1, $2, $3, 1.00)`,
        [order.id, outletId, code]
      );

    await insertOutletOrder(PIZZA_OUTLET); // the first one is fine
    await assert.rejects(
      () => insertOutletOrder(PASTA_OUTLET), // the second must be refused
      (err) => err.code === '23505',
      'a duplicate pickup code must raise a unique violation'
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
});
