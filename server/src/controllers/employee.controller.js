/**
 * employee.controller.js — Handlers for the outlet employee dashboard.
 *
 * Security rules enforced here:
 *  - Only authenticated users with role 'employee' or 'admin' can access these routes
 *  - An employee can ONLY see and update orders for their assigned outlet
 *  - Status transitions are validated (can't jump from 'confirmed' to 'collected')
 *  - 'collected' requires the pickup code stored on THAT outlet order, and
 *    repeated wrong codes lock the attempt out (see middleware/rateLimit.js)
 *  - A pickup code is never echoed back to a staff caller, in a response or in
 *    an error message — the employee has to read it off the customer
 *
 * Routes:
 *   GET    /api/employee/orders                    — Get all outlet orders for employee's outlet
 *   PATCH  /api/employee/outlet-orders/:id         — Update status of a specific outlet order
 *   DELETE /api/employee/outlet-orders/:id/history — Archive a completed order from this outlet's view
 */

const Joi = require('joi');
const orderModel   = require('../models/order.model');
const socketService = require('../services/socket.service');
const { pickupCodeLimiter } = require('../middleware/rateLimit');

// Valid status transitions: each status can only move to the next one in sequence
const VALID_TRANSITIONS = {
  confirmed: ['preparing'],
  preparing: ['ready'],
  ready:     ['collected'],
  collected: [], // terminal state
};

/**
 * Pickup codes are two letters + four digits, with I and O removed because they
 * read as 1 and 0 — exactly the alphabet generatePickupCode() uses in
 * order.service.js. Checking the shape here reports a typo as a format problem
 * instead of spending one of the caller's attempts on it.
 */
const PICKUP_CODE_PATTERN = /^[A-HJ-NP-Z]{2}\d{4}$/;

const updateStatusSchema = Joi.object({
  status:     Joi.string().valid('preparing', 'ready', 'collected').required(),
  pickupCode: Joi.string()
    .trim()
    .uppercase()
    .pattern(PICKUP_CODE_PATTERN)
    .when('status', {
      // Pickup code must be provided when marking as collected
      is: 'collected',
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      'string.pattern.base':
        'A pickup code is two letters followed by four digits (for example QB3821).',
    }),
});

/**
 * Compare codes in one shape: surrounding whitespace and letter case are the
 * customer's typing problem, not a reason to refuse a correct code.
 */
const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

/**
 * GET /api/employee/orders
 * Returns all outlet orders for the logged-in employee's outlet.
 */
const getMyOutletOrders = async (req, res, next) => {
  try {
    const outletId = req.user.outletId;

    if (!outletId) {
      return res.status(400).json({ message: 'Your account is not assigned to any outlet.' });
    }

    const orders = await orderModel.findOutletOrdersByOutletId(outletId);
    return res.status(200).json({ orders });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/employee/outlet-orders/:id
 * Updates the status of a single outlet order.
 *
 * Security checks:
 *  1. The outlet order must belong to the employee's outlet
 *  2. Status must follow the valid transition sequence (so a code can only be
 *     checked on an order that is actually waiting at the counter)
 *  3. The pickup code must match the one stored on this exact outlet order
 *  4. Repeated wrong codes are rate limited per (employee, outlet order)
 *
 * A pickup code is a proof of collection, so it is compared and discarded: it is
 * never written to a log, echoed in an error, or included in the response.
 */
const updateOutletOrderStatus = async (req, res, next) => {
  try {
    const { error, value } = updateStatusSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        message: 'Validation failed.',
        details: error.details.map((d) => d.message),
      });
    }

    const outletOrder = await orderModel.findOutletOrderById(req.params.id);

    if (!outletOrder) {
      return res.status(404).json({ message: 'Outlet order not found.' });
    }

    // ── Security: employee can only touch their own outlet's orders ──────────
    if (req.user.role === 'employee' && outletOrder.outletId !== req.user.outletId) {
      return res.status(403).json({ message: 'Access denied. This order belongs to a different outlet.' });
    }

    // ── Validate status transition ───────────────────────────────────────────
    const allowed = VALID_TRANSITIONS[outletOrder.status];
    if (!allowed || !allowed.includes(value.status)) {
      return res.status(400).json({
        message: `Cannot change status from '${outletOrder.status}' to '${value.status}'.`,
      });
    }

    // ── Pickup code verification before marking collected ────────────────────
    if (value.status === 'collected') {
      // Checked first: while locked out, even a correct-looking code is refused,
      // so guessing cannot continue inside the lockout window.
      const limit = pickupCodeLimiter.check(req.user.id, req.params.id);
      if (!limit.allowed) {
        res.set('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
        return res.status(429).json({
          message:
            'Too many incorrect pickup codes. Please wait a moment and ask the customer to read the code again.',
        });
      }

      if (normalizeCode(value.pickupCode) !== normalizeCode(outletOrder.pickupCode)) {
        pickupCodeLimiter.failure(req.user.id, req.params.id);
        return res.status(400).json({ message: 'Incorrect pickup code. Please verify with the customer.' });
      }

      // The right code clears this order's counter: a mistyped code a moment ago
      // must not count against the order the customer is collecting now.
      pickupCodeLimiter.success(req.user.id, req.params.id);
    }

    const updated = await orderModel.updateOutletOrderStatus(req.params.id, value.status);

    // Push the update to the customer tracking this order and to every
    // employee dashboard of the outlet that owns the sub-order.
    socketService.emitOutletOrderStatusUpdate(updated);

    return res.status(200).json({
      message: `Order status updated to '${value.status}'.`,
      outletOrder: updated,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/employee/outlet-orders/:id/history
 * Archives one completed outlet order from this outlet's History tab.
 *
 * Nothing is deleted: one row lands in `outlet_order_archives`, and the outlet
 * order (including its pickup code), the parent customer order, the items and
 * the payment fields all stay untouched. The parent order keeps appearing in the
 * customer's history, and the other outlets of a multi-outlet order keep their
 * own rows.
 *
 * Archiving is outlet-wide — every employee of the outlet shares one History
 * tab — and only `collected` (completed) orders qualify. Employees may only
 * touch their own outlet; admins may archive any outlet's completed order,
 * matching their existing cross-outlet access on PATCH.
 *
 * Unknown and out-of-scope ids both answer 404, so an employee cannot probe for
 * other outlets' ids. A repeat call is a no-op success (the intent already
 * holds).
 */
const archiveOutletOrder = async (req, res, next) => {
  try {
    const outletOrder = await orderModel.findOutletOrderById(req.params.id);

    if (!outletOrder) {
      return res.status(404).json({ message: 'Outlet order not found.' });
    }

    if (req.user.role === 'employee' && outletOrder.outletId !== req.user.outletId) {
      return res.status(404).json({ message: 'Outlet order not found.' });
    }

    if (outletOrder.status !== 'collected') {
      return res.status(409).json({
        message: 'Only completed orders can be archived from the history.',
      });
    }

    await orderModel.archiveOutletOrder(outletOrder.id, outletOrder.outletId, req.user.id);

    // Drop the row from any other dashboard tab this outlet has open. The
    // payload is ids only — no pickup code ever reaches a staff client.
    socketService.emitOutletOrderArchived(outletOrder.outletId, outletOrder.id);

    return res.status(204).end();
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyOutletOrders, updateOutletOrderStatus, archiveOutletOrder };
