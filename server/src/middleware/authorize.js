/**
 * authorize.js middleware — Role-Based Access Control (RBAC).
 *
 * Must be used AFTER `authenticate`, because it reads `req.user`.
 *
 * Usage:
 *   router.get('/admin/orders', authenticate, authorize('admin'), handler);
 *   router.get('/dashboard',   authenticate, authorize('employee', 'admin'), handler);
 */

/**
 * Returns a middleware that allows only users whose role is in `allowedRoles`.
 * @param {...string} allowedRoles - e.g. authorize('admin') or authorize('employee', 'admin')
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      // Should not happen if authenticate ran first, but guard anyway
      return res.status(401).json({ message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. This action requires one of: ${allowedRoles.join(', ')}.`,
      });
    }

    next();
  };
};

/**
 * Special middleware: ensures an employee can only access their own outlet's data.
 * Reads `req.params.outletId` and compares to `req.user.outletId`.
 * Admins always pass through.
 */
const authorizeOutletAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  // Admins can access any outlet
  if (req.user.role === 'admin') {
    return next();
  }

  const requestedOutletId = req.params.outletId || req.body.outletId;

  if (req.user.role === 'employee' && req.user.outletId !== requestedOutletId) {
    return res.status(403).json({
      message: 'Access denied. You can only access your assigned outlet.',
    });
  }

  next();
};

module.exports = { authorize, authorizeOutletAccess };
