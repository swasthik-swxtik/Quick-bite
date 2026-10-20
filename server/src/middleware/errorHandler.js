/**
 * errorHandler.js — Central Express error-handling middleware.
 *
 * Must be registered LAST in app.js (after all routes).
 * Catches errors thrown by `next(err)` calls in controllers, and also maps
 * known PostgreSQL constraint violations onto meaningful HTTP responses so
 * that referential/unique conflicts never surface as a bare 500.
 *
 * All errors are returned as JSON so the frontend can parse them reliably.
 */

const env = require('../config/env');

/**
 * PostgreSQL error codes we translate into client-friendly responses.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_ERROR_MAP = {
  // foreign_key_violation — e.g. deleting a menu item that appears in an order
  23503: {
    status: 409,
    message:
      'This action conflicts with existing records. The item is still referenced by other data.',
  },
  // unique_violation — e.g. reusing an email address
  23505: {
    status: 409,
    message: 'A record with these details already exists.',
  },
  // check_violation / string_data_right_truncation
  23514: { status: 400, message: 'A value violates a database constraint.' },
  22001: { status: 400, message: 'A value is too long for its column.' },
  // invalid_text_representation — e.g. a malformed UUID reaching the database.
  // Routes guard their params, so this is a safety net.
  '22P02': { status: 400, message: 'Invalid identifier format.' },
};

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  // Log the full error in development
  if (env.nodeEnv === 'development') {
    console.error('[Error]', err);
  } else {
    // In production, log only the message (not the full stack)
    console.error('[Error]', err.message);
  }

  // Errors raised deliberately by controllers/services always win
  const explicitStatus = err.status || err.statusCode;
  const pg = !explicitStatus && err.code ? PG_ERROR_MAP[err.code] : undefined;

  const status = explicitStatus || (pg ? pg.status : 500);

  let message;
  if (explicitStatus) {
    message = err.message || 'Request failed.';
  } else if (pg) {
    message = pg.message;
  } else if (env.nodeEnv === 'production') {
    // Don't leak internal error details in production
    message = 'An unexpected error occurred. Please try again later.';
  } else {
    message = err.message || 'Internal Server Error';
  }

  res.status(status).json({
    message,
    // Include validation details only for 400-level errors
    ...(err.details && { details: err.details }),
  });
};

module.exports = { errorHandler, PG_ERROR_MAP };
