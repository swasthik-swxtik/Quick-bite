const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { requireSession } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { uuidParam } = require('../middleware/validate');

// All admin routes require authentication + admin role.
// Pinned to the staff session (admin shares it with employees).
router.use(requireSession('staff'));
router.use(authorize('admin'));

// Reject malformed ids before they reach PostgreSQL (which would 500)
router.param('id', uuidParam('id'));
router.param('outletId', uuidParam('outletId'));

// ── Outlets ──────────────────────────────────────────────────────────────────
router.get('/outlets', adminController.getAllOutlets);
router.post('/outlets', adminController.createOutlet);
router.put('/outlets/:id', adminController.updateOutlet);
router.delete('/outlets/:id', adminController.deleteOutlet);

// ── Menu Items ───────────────────────────────────────────────────────────────
router.get('/outlets/:outletId/menu', adminController.getOutletMenu);
router.post('/outlets/:outletId/menu', adminController.createMenuItem);
router.put('/menu-items/:id', adminController.updateMenuItem);
router.delete('/menu-items/:id', adminController.deleteMenuItem);

// ── Employees ────────────────────────────────────────────────────────────────
router.get('/employees', adminController.getAllEmployees);
router.post('/employees', adminController.createEmployee);
router.put('/employees/:id', adminController.updateEmployee);
router.delete('/employees/:id', adminController.deleteEmployee);

// ── Orders ───────────────────────────────────────────────────────────────────
router.get('/orders', adminController.getAllOrders);
router.get('/orders/:id', adminController.getOrderById);

module.exports = router;
