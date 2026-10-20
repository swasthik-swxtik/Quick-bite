/**
 * orderView.js — Response shaping shared by the order endpoints.
 *
 * A pickup code is the customer's proof of collection: the customer shows it at
 * the counter, the employee types it in, and the server compares it with the
 * code stored on that outlet order. It must therefore reach the customer and
 * nobody else. Staff surfaces (the kitchen dashboard, its API responses and its
 * socket payloads) are built without it — otherwise the collection check
 * collapses into reading the code off the staff screen.
 *
 * Customer-scoped responses are untouched: the owning customer keeps seeing the
 * code on the confirmation page, in their order history and on the tracking page.
 */

/**
 * Copy of `order` with every outlet order's `pickupCode` removed.
 * Returns the input unchanged when it does not look like an order.
 *
 * @param {Object|null} order - an order as returned by order.model.js
 * @returns {Object|null}
 */
const withoutPickupCodes = (order) => {
  if (!order || !Array.isArray(order.outletOrders)) return order;

  return {
    ...order,
    outletOrders: order.outletOrders.map((outletOrder) => {
      const copy = { ...outletOrder };
      delete copy.pickupCode;
      return copy;
    }),
  };
};

module.exports = { withoutPickupCodes };
