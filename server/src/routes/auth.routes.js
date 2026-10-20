const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticateIdentity } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', authController.register);

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/logout
router.post('/logout', authController.logout);

// GET /api/auth/me  (requires a valid session)
router.get('/me', authenticateIdentity, authController.getMe);

module.exports = router;
