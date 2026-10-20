/**
 * order.model.js — SQL queries for orders, outlet_orders, and outlet_order_items.
 *
 * These functions are used by order.service.js inside a single database transaction
 * to ensure that if any step fails, the entire order is rolled back.
 */

const { query, getClient } = require('../config/db');

/**
 * Lock and return the ordering-relevant state of the given menu items.
 *
 * MUST be called with a transaction client. `FOR SHARE` locks both the menu
 * item rows and their outlet rows for the rest of the transaction, so an admin
 * cannot switch an item (or its whole outlet) off between the moment we check
 * and the moment the order is written. Share locks do not block other
 * checkouts, only writers.
 *
 * @param {Object} client - pg client inside an open transaction
 * @param {string[]} menuItemIds
 * @returns {Promise<Array<{ id, name, isAvailable, outletId, outletName, isActive }>>}
 */
const lockItemsForOrdering = async (client, menuItemIds) => {
  const { rows } = await client.query(
    `SELECT mi.id, mi.name, mi.is_available AS "isAvailable",
            o.id AS "outletId", o.name AS "outletName", o.is_active AS "isActive"
     FROM menu_items mi
     JOIN outlets o ON o.id = mi.outlet_id
     WHERE mi.id = ANY($1::uuid[])
     FOR SHARE OF mi, o`,
    [menuItemIds]
  );
  return rows;
};

/**
 * Create the parent order and all its outlet sub-orders in one transaction.
 *
 * @param {Object} params
 * @param {string}   params.customerId
 * @param {number}   params.totalAmount
 * @param {string}   [params.paymentMethod] - 'card' | 'upi' | 'wallet' (simulated)
 * @param {Array}    params.outletOrders - Array of:
 *   { outletId, pickupCode, subtotal, items: [{ menuItemId, name, unitPrice, quantity }] }
 * @param {Function} [params.validateItems] - async (client) => void, awaited
 *   INSIDE the transaction and BEFORE any insert. Throw to abort the checkout:
 *   nothing is written and the transaction is rolled back. This is what makes
 *   item/outlet checks airtight rather than a check-then-act race.
 * @returns {Promise<{ order, outletOrders }>}
 */
const createOrderWithOutletOrders = async ({
  customerId,
  totalAmount,
  paymentMethod = null,
  outletOrders,
  validateItems,
}) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 0. Authoritative validation (inside the transaction, before any write).
    if (validateItems) {
      await validateItems(client);
    }

    // 1. Insert the parent order
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (customer_id, total_amount, status, payment_method)
       VALUES ($1, $2, 'confirmed', $3)
       RETURNING id, customer_id AS "customerId", total_amount AS "totalAmount",
                 status, payment_method AS "paymentMethod", created_at AS "createdAt"`,
      [customerId, totalAmount, paymentMethod]
    );

    const createdOutletOrders = [];

    for (const oo of outletOrders) {
      // 2. Insert each outlet order
      const { rows: [outletOrder] } = await client.query(
        `INSERT INTO outlet_orders (order_id, outlet_id, pickup_code, status, subtotal)
         VALUES ($1, $2, $3, 'confirmed', $4)
         RETURNING id, order_id AS "orderId", outlet_id AS "outletId",
                   pickup_code AS "pickupCode", status, subtotal, created_at AS "createdAt"`,
        [order.id, oo.outletId, oo.pickupCode, oo.subtotal]
      );

      // 3. Insert each item for this outlet order
      for (const item of oo.items) {
        await client.query(
          `INSERT INTO outlet_order_items
             (outlet_order_id, menu_item_id, name, unit_price, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [outletOrder.id, item.menuItemId, item.name, item.unitPrice, item.quantity]
        );
      }

      createdOutletOrders.push({ ...outletOrder, items: oo.items });
    }

    await client.query('COMMIT');
    return { order, outletOrders: createdOutletOrders };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Get a full order with all outlet orders and their items.
 * Used on the customer's order tracking page.
 */
const findOrderById = async (orderId) => {
  // Fetch the parent order
  const { rows: [order] } = await query(
    `SELECT id, customer_id AS "customerId", total_amount AS "totalAmount",
            status, payment_method AS "paymentMethod", created_at AS "createdAt"
     FROM orders
     WHERE id = $1`,
    [orderId]
  );

  if (!order) return null;

  // Fetch all outlet orders for this order
  const { rows: outletOrders } = await query(
    `SELECT oo.id, oo.order_id AS "orderId", oo.outlet_id AS "outletId",
            o.name AS "outletName", o.counter_info AS "counterInfo",
            oo.pickup_code AS "pickupCode", oo.status,
            oo.subtotal, oo.created_at AS "createdAt"
     FROM outlet_orders oo
     JOIN outlets o ON o.id = oo.outlet_id
     WHERE oo.order_id = $1
     ORDER BY oo.created_at ASC`,
    [orderId]
  );

  // Fetch items for each outlet order
  for (const oo of outletOrders) {
    const { rows: items } = await query(
      `SELECT id, menu_item_id AS "menuItemId", name,
              unit_price AS "unitPrice", quantity
       FROM outlet_order_items
       WHERE outlet_order_id = $1`,
      [oo.id]
    );
    oo.items = items;
  }

  return { ...order, outletOrders };
};

/**
 * Get all orders placed by a customer.
 *
 * Each order carries its per-outlet pickup codes: the codes belong to the
 * customer, who shows them at the counter, so the history page must be able to
 * display them without another round trip.
 *
 * Orders the customer removed from their history are excluded here and only
 * here: the archive table is deliberately not consulted by any staff or admin
 * query, and the order rows themselves are never modified.
 */
const findOrdersByCustomerId = async (customerId) => {
  const { rows } = await query(
    `SELECT o.id, o.total_amount AS "totalAmount", o.status, o.created_at AS "createdAt",
            COALESCE(
              (
                SELECT json_agg(
                         json_build_object(
                           'id',         oo.id,
                           'outletId',   oo.outlet_id,
                           'outletName', ot.name,
                           'pickupCode', oo.pickup_code,
                           'status',     oo.status
                         )
                         ORDER BY oo.created_at ASC
                       )
                FROM outlet_orders oo
                JOIN outlets ot ON ot.id = oo.outlet_id
                WHERE oo.order_id = o.id
              ),
              '[]'::json
            ) AS "outletOrders"
     FROM orders o
     WHERE o.customer_id = $1
       AND NOT EXISTS (
             SELECT 1 FROM customer_order_archives a WHERE a.order_id = o.id
           )
     ORDER BY o.created_at DESC`,
    [customerId]
  );
  return rows;
};

/**
 * Get all outlet orders assigned to a specific outlet (employee dashboard).
 * Returns recent orders first.
 *
 * The pickup code is deliberately NOT selected: the employee must read it off
 * the customer's screen or receipt and type it in. A dashboard that displayed
 * the code would turn the collection check into a formality.
 *
 * Outlet orders this outlet archived are excluded. This is outlet-wide on
 * purpose: every employee of the outlet shares one History tab. Archiving is
 * one row in `outlet_order_archives`; the outlet order and the parent customer
 * order are untouched.
 */
const findOutletOrdersByOutletId = async (outletId) => {
  const { rows: outletOrders } = await query(
    `SELECT oo.id, oo.order_id AS "orderId",
            oo.status, oo.subtotal, oo.created_at AS "createdAt"
     FROM outlet_orders oo
     WHERE oo.outlet_id = $1
       AND NOT EXISTS (
             SELECT 1 FROM outlet_order_archives a
             WHERE a.outlet_order_id = oo.id
           )
     ORDER BY oo.created_at DESC`,
    [outletId]
  );

  for (const oo of outletOrders) {
    const { rows: items } = await query(
      `SELECT name, unit_price AS "unitPrice", quantity
       FROM outlet_order_items
       WHERE outlet_order_id = $1`,
      [oo.id]
    );
    oo.items = items;
  }

  return outletOrders;
};

/**
 * Update the status of a single outlet order.
 * Also updates the parent order's aggregate status.
 *
 * The pickup code is not part of the returned row: the response goes to the
 * employee who just collected the order, and staff must never receive codes.
 *
 * @returns {Promise<Object|null>} the updated outlet order, plus `orderStatus`
 *   (the parent order's newly recalculated status) so the caller can push both
 *   to the customer's tracking page. null when the outlet order does not exist.
 */
const updateOutletOrderStatus = async (outletOrderId, status) => {
  // Update the outlet order
  const { rows: [updated] } = await query(
    `UPDATE outlet_orders
     SET status = $1
     WHERE id = $2
     RETURNING id, order_id AS "orderId", outlet_id AS "outletId",
               status, subtotal`,
    [status, outletOrderId]
  );

  if (!updated) return null;

  // Recalculate parent order aggregate status
  const orderStatus = await recalcParentOrderStatus(updated.orderId);

  return { ...updated, orderStatus };
};

/**
 * Recalculates and updates the parent order status based on all its outlet orders.
 *
 * Rules (evaluated in order, first match wins):
 *  - all 'collected'                    → parent = 'collected'
 *  - every outlet order 'ready' or later → parent = 'ready'
 *  - at least one 'ready'               → parent = 'partially_ready'
 *  - at least one 'preparing'           → parent = 'preparing'
 *  - otherwise                          → parent = 'confirmed'
 *
 * @returns {Promise<string>} the parent status that was written
 */
const recalcParentOrderStatus = async (orderId) => {
  const { rows } = await query(
    `SELECT status FROM outlet_orders WHERE order_id = $1`,
    [orderId]
  );

  const statuses = rows.map((r) => r.status);
  const isDone = (s) => s === 'ready' || s === 'collected';
  let parentStatus = 'confirmed';

  if (statuses.every((s) => s === 'collected')) {
    parentStatus = 'collected';
  } else if (statuses.every(isDone)) {
    parentStatus = 'ready';
  } else if (statuses.some((s) => s === 'ready')) {
    parentStatus = 'partially_ready';
  } else if (statuses.some((s) => s === 'preparing')) {
    parentStatus = 'preparing';
  }

  await query(
    `UPDATE orders SET status = $1 WHERE id = $2`,
    [parentStatus, orderId]
  );

  return parentStatus;
};

/**
 * Get a single outlet order by ID (used for status update + pickup code verification).
 */
const findOutletOrderById = async (outletOrderId) => {
  const { rows: [oo] } = await query(
    `SELECT oo.id, oo.order_id AS "orderId", oo.outlet_id AS "outletId",
            oo.pickup_code AS "pickupCode", oo.status, oo.subtotal
     FROM outlet_orders oo
     WHERE oo.id = $1`,
    [outletOrderId]
  );
  return oo || null;
};

/**
 * Lightweight ownership lookup — used to authorise real-time room joins
 * without loading the whole order and all of its items.
 *
 * @param {string} orderId
 * @returns {Promise<{ id: string, customerId: string }|null>}
 */
const findOrderOwner = async (orderId) => {
  const { rows: [order] } = await query(
    `SELECT id, customer_id AS "customerId"
     FROM orders
     WHERE id = $1`,
    [orderId]
  );
  return order || null;
};

/**
 * Lightweight lookup for the customer archive endpoint: ownership + status only.
 *
 * @param {string} orderId
 * @returns {Promise<{ id: string, customerId: string, status: string }|null>}
 */
const findOrderArchiveState = async (orderId) => {
  const { rows: [order] } = await query(
    `SELECT id, customer_id AS "customerId", status
     FROM orders
     WHERE id = $1`,
    [orderId]
  );
  return order || null;
};

/**
 * Has this customer removed the order from their history?
 *
 * Used to make a hidden order behave like a missing one for its owner. Admins
 * never consult this: the record must stay reachable for support.
 */
const isOrderArchived = async (orderId) => {
  const { rows } = await query(
    `SELECT 1 FROM customer_order_archives WHERE order_id = $1`,
    [orderId]
  );
  return rows.length > 0;
};

/**
 * Hide one completed parent order from its owner's history.
 *
 * The predicate lives in SQL so the ownership, completion and "already hidden"
 * checks cannot race with the write: only a `collected` order owned by this
 * customer is matched, and a repeat call is a no-op via the primary key.
 * No order, item, payment or pickup-code row is written.
 *
 * @returns {Promise<{ orderId: string }|null>} the new archive row, or null when
 *   the statement matched nothing (not owned / not completed / already hidden).
 */
const archiveCustomerOrder = async (orderId, customerId) => {
  const { rows: [archived] } = await query(
    `INSERT INTO customer_order_archives (order_id, customer_id)
     SELECT o.id, o.customer_id
     FROM orders o
     WHERE o.id = $1
       AND o.customer_id = $2
       AND o.status = 'collected'
     ON CONFLICT (order_id) DO NOTHING
     RETURNING order_id AS "orderId"`,
    [orderId, customerId]
  );
  return archived || null;
};

/**
 * Hide one completed outlet order from its outlet's History tab.
 *
 * Like the customer variant, every guard is in the statement: the row must
 * still belong to the given outlet and still be `collected`. The caller has
 * already resolved the outlet from the row itself (employees pass their own
 * outlet; admins may pass any outlet), so this is the last line of defence.
 * No outlet order, pickup code, parent order or payment row is written.
 *
 * @returns {Promise<{ outletOrderId: string }|null>}
 */
const archiveOutletOrder = async (outletOrderId, outletId, archivedBy = null) => {
  const { rows: [archived] } = await query(
    `INSERT INTO outlet_order_archives (outlet_order_id, outlet_id, archived_by)
     SELECT oo.id, oo.outlet_id, $3
     FROM outlet_orders oo
     WHERE oo.id = $1
       AND oo.outlet_id = $2
       AND oo.status = 'collected'
     ON CONFLICT (outlet_order_id) DO NOTHING
     RETURNING outlet_order_id AS "outletOrderId"`,
    [outletOrderId, outletId, archivedBy]
  );
  return archived || null;
};

/**
 * Get all orders across the platform (admin dashboard).
 */
const findAllOrders = async ({ limit = 50, offset = 0 } = {}) => {
  const { rows } = await query(
    `SELECT o.id, u.name AS "customerName", u.email AS "customerEmail",
            o.total_amount AS "totalAmount", o.status, o.created_at AS "createdAt"
     FROM orders o
     JOIN users u ON u.id = o.customer_id
     ORDER BY o.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
};

module.exports = {
  createOrderWithOutletOrders,
  lockItemsForOrdering,
  findOrderById,
  findOrderOwner,
  findOrdersByCustomerId,
  findOutletOrdersByOutletId,
  updateOutletOrderStatus,
  findOutletOrderById,
  findAllOrders,
  findOrderArchiveState,
  isOrderArchived,
  archiveCustomerOrder,
  archiveOutletOrder,
};
