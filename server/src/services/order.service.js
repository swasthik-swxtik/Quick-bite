/**
 * order.service.js — Core business logic for order creation.
 *
 * This is the most critical service in the app.
 *
 * Responsibilities:
 *  1. Receive the cart from the frontend (item IDs + quantities)
 *  2. Re-fetch prices from the database — NEVER trust client-sent prices
 *  3. Verify that every item is available AND that its outlet is accepting orders
 *  4. Group items by outlet
 *  5. Generate a unique pickup code for each outlet sub-order
 *  6. Calculate per-outlet subtotals and the total order amount
 *  7. Persist everything in a single database transaction
 */

const menuItemModel = require('../models/menuItem.model');
const orderModel = require('../models/order.model');

// Maximum quantity per item, mirrored by the Joi schema in order.controller.js.
// Enforced here too so the rule holds for any caller of this service.
const MENU_ITEM_MAX_QUANTITY = 50;

// The only simulated payment methods we accept (mirrored by the DB CHECK
// constraint chk_orders_payment_method and by the client's checkout form).
const ALLOWED_PAYMENT_METHODS = ['card', 'upi', 'wallet'];

// Name of the unique index created by database/migrations/001 (and schema.sql).
// PostgreSQL reports it in err.constraint when a duplicate pickup code is inserted.
const PICKUP_CODE_CONSTRAINT = 'uq_outlet_orders_pickup_code';

// A collision is astronomically unlikely (24*24*10000 codes), but the database
// now guarantees uniqueness, so a collision must not fail the customer's order:
// regenerate the codes and retry the whole transaction.
const MAX_PICKUP_CODE_ATTEMPTS = 5;

// Belt-and-braces bound on the in-order code search, so a broken source of
// randomness can never spin forever.
const PICKUP_CODE_GENERATION_TRIES = 50;

/** Build an Error that the central error handler turns into an HTTP response. */
const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/** Round a money amount to 2 decimal places. */
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Generate a short, human-readable pickup code.
 * Format: two uppercase letters + four digits, e.g. "QB3821"
 * The employee will ask the customer to show this code before marking Collected.
 */
const generatePickupCode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  const digits = '0123456789';
  const l1 = letters[Math.floor(Math.random() * letters.length)];
  const l2 = letters[Math.floor(Math.random() * letters.length)];
  const nums = Array.from({ length: 4 }, () => digits[Math.floor(Math.random() * 10)]).join('');
  return `${l1}${l2}${nums}`;
};

/**
 * Generate a pickup code that no other outlet order in THIS checkout is using.
 *
 * The codes are random, so a collision between two sub-orders of the same order
 * is unlikely but possible; retrying against a Set makes "one distinct pickup
 * code per outlet" a guarantee rather than a probability.
 *
 * (Uniqueness against codes from *other* orders is enforced by the database —
 * see PICKUP_CODE_CONSTRAINT.)
 *
 * @param {Set<string>} usedCodes - codes already handed out in this checkout
 */
const generateDistinctPickupCode = (usedCodes) => {
  for (let attempt = 0; attempt < PICKUP_CODE_GENERATION_TRIES; attempt += 1) {
    const code = generatePickupCode();
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }
  throw httpError(500, 'Could not generate a unique pickup code. Please try again.');
};

/**
 * Collapse duplicate cart entries and validate the quantities.
 *
 * The same menu item may legitimately arrive twice (e.g. the customer clicked
 * "add" twice). Ordering it as two identical lines would store a quantity that
 * never went through the per-item cap, so entries are merged and only the sum
 * is used downstream.
 *
 * @param {Array} cartItems - [{ menuItemId, quantity }]
 * @returns {Array<{ menuItemId: string, quantity: number }>} one entry per item
 */
const mergeCartItems = (cartItems) => {
  const merged = new Map();

  for (const cartItem of cartItems) {
    const menuItemId = cartItem && cartItem.menuItemId;
    const quantity = cartItem && cartItem.quantity;

    if (typeof menuItemId !== 'string' || menuItemId.trim() === '') {
      throw httpError(400, 'Every cart item needs a menu item id.');
    }

    // Checked per entry, before merging: a fractional quantity is invalid even
    // if two entries would happen to add up to a whole number.
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw httpError(
        400,
        `Invalid quantity for menu item ${menuItemId}. Quantity must be a whole number of at least 1.`
      );
    }

    merged.set(menuItemId, (merged.get(menuItemId) || 0) + quantity);
  }

  return [...merged.entries()].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
};

/**
 * Re-check, INSIDE the checkout transaction, that every item may be ordered:
 * it exists, it is available, and its outlet is active.
 *
 * This runs after BEGIN with the rows locked FOR SHARE, so it cannot be
 * invalidated by a concurrent admin change between the check and the insert.
 * It is the authoritative check; the checks in placeOrder() only exist to fail
 * fast with a friendlier message.
 *
 * @param {Object} client - pg client inside an open transaction
 * @param {string[]} menuItemIds - distinct ids being ordered
 */
const assertItemsOrderable = async (client, menuItemIds) => {
  const rows = await orderModel.lockItemsForOrdering(client, menuItemIds);
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const menuItemId of menuItemIds) {
    const row = byId.get(menuItemId);

    if (!row) {
      throw httpError(404, `Menu item not found: ${menuItemId}`);
    }

    if (!row.isAvailable) {
      throw httpError(400, `"${row.name}" is currently unavailable.`);
    }

    if (!row.isActive) {
      throw httpError(
        400,
        `"${row.name}" can't be ordered right now — ${row.outletName} is not accepting orders.`
      );
    }
  }
};

/**
 * Turn the grouped items into the payload the model inserts.
 * Called once per checkout attempt, so each attempt gets fresh pickup codes.
 *
 * @param {Map<string, Array>} outletGroups - outletId → items
 * @returns {{ outletOrders: Array, totalAmount: number }}
 */
const buildOutletOrders = (outletGroups) => {
  const usedPickupCodes = new Set();
  let totalAmount = 0;

  const outletOrders = [...outletGroups.entries()].map(([outletId, items]) => {
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    totalAmount += subtotal;

    return {
      outletId,
      pickupCode: generateDistinctPickupCode(usedPickupCodes),
      subtotal: round2(subtotal),
      items,
    };
  });

  return { outletOrders, totalAmount: round2(totalAmount) };
};

/**
 * Process a customer's cart and create the order.
 *
 * @param {string} customerId
 * @param {Array}  cartItems - [{ menuItemId: string, quantity: number }]
 * @param {string} paymentMethod - 'card' | 'upi' | 'wallet' (simulated payment)
 * @returns {Promise<{ order, outletOrders }>}
 */
const placeOrder = async (customerId, cartItems, paymentMethod) => {
  // ── Step 0: the cart must have something in it ─────────────────────────────
  if (!cartItems || cartItems.length === 0) {
    throw httpError(400, 'Cart is empty.');
  }

  // Merge duplicate ids and reject unusable quantities.
  const items = mergeCartItems(cartItems);

  // Only the methods we actually simulate are accepted. (Joi rejects others
  // over HTTP; this keeps the service safe for any other caller.)
  if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
    throw httpError(400, 'Unsupported payment method.');
  }

  // ── Step 1: Fetch all menu items from DB in one query ──────────────────────
  const menuItemIds = items.map((item) => item.menuItemId);
  const dbItems = await menuItemModel.findManyByIds(menuItemIds);

  // Build a map for fast lookups: id → dbItem
  const dbItemMap = new Map(dbItems.map((item) => [item.id, item]));

  // ── Step 2: Fail fast on obvious problems, with a readable message ─────────
  for (const { menuItemId, quantity } of items) {
    const dbItem = dbItemMap.get(menuItemId);

    if (!dbItem) {
      throw httpError(404, `Menu item not found: ${menuItemId}`);
    }

    if (!dbItem.isAvailable) {
      throw httpError(400, `"${dbItem.name}" is currently unavailable.`);
    }

    // Checked on the MERGED quantity: 30 + 30 of one item is 60, which is over
    // the cap even though neither entry broke it on its own.
    if (quantity > MENU_ITEM_MAX_QUANTITY) {
      throw httpError(
        400,
        `Quantity for "${dbItem.name}" exceeds the maximum of ${MENU_ITEM_MAX_QUANTITY} per item.`
      );
    }
  }

  // ── Step 3: Group by outlet ────────────────────────────────────────────────
  const outletGroups = new Map();

  for (const { menuItemId, quantity } of items) {
    const dbItem = dbItemMap.get(menuItemId);

    if (!outletGroups.has(dbItem.outletId)) {
      outletGroups.set(dbItem.outletId, []);
    }

    outletGroups.get(dbItem.outletId).push({
      menuItemId: dbItem.id,
      name:       dbItem.name,
      unitPrice:  Number(dbItem.price), // use the DB price, never a client price
      quantity,
    });
  }

  // ── Step 4: Persist (single DB transaction) ────────────────────────────────
  // The outlet-active / item-available check is repeated inside the transaction
  // (with row locks), and a fresh set of pickup codes is generated per attempt
  // in case the random codes collided with codes already in the database.
  for (let attempt = 1; attempt <= MAX_PICKUP_CODE_ATTEMPTS; attempt += 1) {
    const { outletOrders, totalAmount } = buildOutletOrders(outletGroups);

    try {
      return await orderModel.createOrderWithOutletOrders({
        customerId,
        totalAmount,
        paymentMethod,
        outletOrders,
        validateItems: (client) => assertItemsOrderable(client, menuItemIds),
      });
    } catch (err) {
      const pickupCodeTaken =
        err.code === '23505' && err.constraint === PICKUP_CODE_CONSTRAINT;

      // Anything other than a pickup-code collision is the caller's problem.
      if (!pickupCodeTaken) {
        throw err;
      }

      // Otherwise loop round: new codes, new transaction.
    }
  }

  throw httpError(409, 'Could not allocate a unique pickup code. Please try again.');
};

module.exports = { placeOrder };
