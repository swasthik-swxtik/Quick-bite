/**
 * app.js — Express application setup.
 *
 * This file wires together:
 *  - Global middleware (CORS, cookies, JSON parsing)
 *  - All API routes
 *  - The central error handler (must be last)
 *
 * The actual HTTP server is created in index.js, not here.
 * This separation makes it easy to test the app without starting a server.
 */

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const env          = require('./config/env');

// ── Route modules ────────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth.routes');
const outletRoutes   = require('./routes/outlet.routes');
const orderRoutes    = require('./routes/order.routes');
const employeeRoutes = require('./routes/employee.routes');
const adminRoutes    = require('./routes/admin.routes');

// ── Error handler (imported last, registered last) ───────────────────────────
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ── Global Middleware ────────────────────────────────────────────────────────

// CORS — only allow requests from the Vite dev server (or the deployed frontend)
app.use(cors({
  origin: env.clientOrigin,
  credentials: true, // required to accept cookies from the frontend
}));

// Parse JSON request bodies
app.use(express.json());

// Parse URL-encoded request bodies (form submissions)
app.use(express.urlencoded({ extended: true }));

// Parse cookies (needed to read the JWT httpOnly cookie)
app.use(cookieParser());

// ── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/outlets',  outletRoutes);
app.use('/api/orders',   orderRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/admin',    adminRoutes);

// ── 404 Handler — catches any unmatched route ─────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
});

// ── Central Error Handler — must be the last middleware ───────────────────────
app.use(errorHandler);

module.exports = app;
