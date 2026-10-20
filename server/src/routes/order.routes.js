const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate, requireSession } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { uuidParam } = require('../middleware/validate');

// Authenticate before anything else so an unauthenticated request is a 401 even
// when its URL is malformed (`router.param` runs before route handlers).
router.use(authenticate);

// Reject malformed ids before they reach PostgreSQL (which would 500)
router.param('id', uuidParam('id'));

// POST /api/orders — place a new order (customers only)
// Pinned to the customer session: a staff tab in the same browser presents a
// different cookie, so it cannot reach a customer-only endpoint.
router.post('/', requireSession('customer'), authorize('customer'), orderController.placeOrder);

// GET /api/orders — get all orders for the logged-in customer (customers only)
router.get('/', requireSession('customer'), authorize('customer'), orderController.getMyOrders);

// GET /api/orders/:id — get a specific order (customer sees own orders, admin sees all)
// Customers and admins share this endpoint, so the tab declares its session and
// the controller enforces ownership for customers.
router.get('/:id', authorize('customer', 'admin'), orderController.getOrderById);

// DELETE /api/orders/:id/history — archive a completed order from my history
// Customer-only and pinned to the customer session. The controller enforces
// ownership and the 'collected' status; nothing is deleted.
router.delete(
  '/:id/history',
  requireSession('customer'),
  authorize('customer'),
  orderController.archiveOrder
);

module.exports = router;
