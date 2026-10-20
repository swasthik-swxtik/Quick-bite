const express = require('express');
const router = express.Router();
const outletController = require('../controllers/outlet.controller');
const { uuidParam } = require('../middleware/validate');

// Reject malformed ids before they reach PostgreSQL (which would 500)
router.param('id', uuidParam('id'));

// Public routes — no authentication required for browsing
// GET /api/outlets
router.get('/', outletController.getAllOutlets);

// GET /api/outlets/:id
router.get('/:id', outletController.getOutletById);

// GET /api/outlets/:id/menu
router.get('/:id/menu', outletController.getOutletMenu);

module.exports = router;
