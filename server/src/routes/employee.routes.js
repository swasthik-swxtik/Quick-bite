const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employee.controller');
const { requireSession } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { uuidParam } = require('../middleware/validate');

// All employee routes require authentication + employee or admin role.
// Pinned to the staff session: a customer cookie in the same browser is ignored.
router.use(requireSession('staff'));
router.use(authorize('employee', 'admin'));

// Reject malformed ids before they reach PostgreSQL (which would 500)
router.param('id', uuidParam('id'));

// GET /api/employee/orders — get all outlet orders for the employee's outlet
router.get('/orders', employeeController.getMyOutletOrders);

// PATCH /api/employee/outlet-orders/:id — update status of a single outlet order
router.patch('/outlet-orders/:id', employeeController.updateOutletOrderStatus);

// DELETE /api/employee/outlet-orders/:id/history — archive a completed order
router.delete('/outlet-orders/:id/history', employeeController.archiveOutletOrder);

module.exports = router;
