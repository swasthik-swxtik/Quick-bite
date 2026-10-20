/**
 * validate.js — Joi request validation middleware factory.
 *
 * Usage:
 *   const { validate } = require('../middleware/validate');
 *   const schema = Joi.object({ email: Joi.string().email().required() });
 *   router.post('/login', validate(schema), authController.login);
 *
 * On validation failure: responds with 400 and a list of error messages.
 * On success: calls next() and the validated/sanitized body replaces req.body.
 */

const Joi = require('joi');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {Joi.Schema} schema - A Joi schema to validate req.body against
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      // Strip unknown fields (prevents extra fields sneaking through)
      stripUnknown: true,
      // Report all errors at once, not just the first
      abortEarly: false,
    });

    if (error) {
      const details = error.details.map((d) => d.message);
      return res.status(400).json({
        message: 'Validation failed.',
        details,
      });
    }

    // Replace req.body with the sanitized/validated value
    req.body = value;
    next();
  };
};

/**
 * Express `router.param` callback that rejects a malformed UUID.
 *
 * Used as:
 *   router.param('id', uuidParam('id'));
 *
 * Note: a router-level `router.use(...)` middleware cannot do this, because
 * `req.params` is only populated for the layer whose path declares the param.
 *
 * @param {string} name - the param name — used in the error message
 */
const uuidParam = (name) => (req, res, next, value) => {
  if (!UUID_RE.test(value)) {
    return res.status(400).json({
      message: 'Validation failed.',
      details: [`"${name}" must be a valid UUID.`],
    });
  }
  next();
};

module.exports = { validate, uuidParam, UUID_RE };
