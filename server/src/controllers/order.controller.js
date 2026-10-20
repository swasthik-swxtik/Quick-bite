/**
 * order.controller.js — Handlers for customer order routes.
 *
 * Routes:
 *   POST   /api/orders              — Place a new order (simulated payment)
 *   GET    /api/orders/:id          — Get a full order with all outlet sub-orders
 *   GET    /api/orders              — Get all orders placed by the logged-in customer
 *   DELETE /api/orders/:id/history  — Remove a completed order from my history
 */

const Joi = require('joi');
const orderService = require('../services/order.service');
const orderModel   = require('../models/order.model');
const socketService = require('../services/socket.service');
const { withoutPickupCodes } = require('../utils/orderView');

// ── Validation schema ────────────────────────────────────────────────────────

const placeOrderSchema = Joi.object({
  // The frontend sends only item IDs and quantities
  // Prices are never accepted from the client
  items: Joi.array()
    .items(
      Joi.object({
        menuItemId: Joi.string().uuid().required(),
        quantity:   Joi.number().integer().min(1).max(50).required(),
      })
    )
    .min(1)
    .required(),

  // Simulated payment details — no real payment integration
  payment: Joi.object({
    method: Joi.string().valid('card', 'upi', 'wallet').required(),
    // We accept and ignore the rest; a real implementation would validate card details here
  }).required(),
});

// ── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/orders
 * Simulates checkout. The backend:
 *   1. Validates the cart items against the database
 *   2. Verifies prices (ignores any prices sent by the client)
 *   3. Groups items by outlet and creates outlet sub-orders
 *   4. Returns the full order with pickup codes
 */
const placeOrder = async (req, res, next) => {
  try {
    const { error, value } = placeOrderSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: 'Validation failed.',
        details: error.details.map((d) => d.message),
      });
    }

    // Simulate payment success — in a real app, charge the card here
    // If payment fails, throw an error before creating the order
    const paymentSucceeded = true; // always succeeds for now
    if (!paymentSucceeded) {
      return res.status(402).json({ message: 'Payment failed. Please try again.' });
    }

    // Order is only created AFTER simulated payment succeeds.
    // The chosen method is recorded on the order (no real payment integration).
    const result = await orderService.placeOrder(req.user.id, value.items, value.payment.method);

    // Push each outlet sub-order to its outlet's employee dashboard in real time.
    // The payload matches what GET /api/employee/orders returns for a single
    // outlet order, so the dashboard can insert it without a refetch.
    for (const outletOrder of result.outletOrders) {
      socketService.emitNewOutletOrder(outletOrder.outletId, outletOrder);
    }

    return res.status(201).json({
      message: 'Order placed successfully.',
      orderId: result.order.id,
      order: result.order,
      outletOrders: result.outletOrders,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders/:id
 * Returns full order details including all outlet sub-orders.
 * Customers can only view their own orders.
 *
 * Pickup codes are part of the owning customer's view only. An admin may read
 * this endpoint, but gets the order without the code (they are staff, and the
 * code is the customer's proof of collection).
 *
 * An order the customer removed from their history is gone from their view
 * entirely: the owner gets the same 404 as an unknown id. Only completed
 * (collected) orders can be hidden, so nothing actionable is lost. Admins keep
 * full access to the record.
 */
const getOrderById = async (req, res, next) => {
  try {
    const order = await orderModel.findOrderById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    // Customers can only see their own orders
    if (req.user.role === 'customer' && order.customerId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied.' });
    }

    // ...and not the ones they removed from their history
    if (req.user.role === 'customer' && (await orderModel.isOrderArchived(order.id))) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    return res.status(200).json({
      order: req.user.role === 'customer' ? order : withoutPickupCodes(order),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders
 * Returns all orders placed by the currently logged-in customer.
 */
const getMyOrders = async (req, res, next) => {
  try {
    const orders = await orderModel.findOrdersByCustomerId(req.user.id);
    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/orders/:id/history
 * Removes one completed order from the customer's history.
 *
 * This is an archive, not a delete: one row lands in `customer_order_archives`
 * and the order, its items, the payment fields and every pickup code are left
 * exactly as they are. Staff dashboards, the other outlets of a multi-outlet
 * order and the admin views are unaffected.
 *
 * Only orders that are fully `collected` may be hidden — an order still being
 * prepared, ready for pickup or awaiting collection stays in the list. The
 * completion check and the ownership check are repeated in SQL, so a request
 * that races with a status change cannot archive something it shouldn't.
 *
 * Unknown and not-owned ids both answer 404: a customer must not be able to
 * probe for other people's order ids.
 */
const archiveOrder = async (req, res, next) => {
  try {
    const order = await orderModel.findOrderArchiveState(req.params.id);

    if (!order || order.customerId !== req.user.id) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    if (order.status !== 'collected') {
      return res.status(409).json({
        message: 'Only completed orders can be removed from your history.',
      });
    }

    // A repeat click matches the ON CONFLICT guard and is reported as success:
    // the customer's intent ("it should not be in my history") already holds.
    await orderModel.archiveCustomerOrder(order.id, req.user.id);

    return res.status(204).end();
  } catch (err) {
    next(err);
  }
};

module.exports = { placeOrder, getOrderById, getMyOrders, archiveOrder };
