/**
 * CustomerOnlyRoute.jsx — Friendly guard for shopping routes.
 *
 * /cart and /checkout belong to customer accounts. Staff can still browse
 * outlet menus, but rendering the customer pages (or the generic 403 page) for
 * them is confusing. This guard explains the rule and points staff back to
 * their dashboard without mounting the customer page or making an API call.
 *
 * A resolved role is handled before the startup loading flag: a user can be
 * known (signed in on this tab) while the initial session check is in flight,
 * and must still get the right page or notice instead of a spinner or 403.
 */

import { Link, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const CustomerOnlyRoute = () => {
  const { user, isLoading } = useAuth();

  if (user) {
    if (user.role === 'customer') {
      return <Outlet />;
    }

    const isAdmin = user.role === 'admin';
    const dashboardPath = isAdmin ? '/admin' : '/employee/dashboard';

    return (
      <div className="page-content">
        <div className="container">
          <div
            className="alert alert-info"
            role="status"
            style={{
              padding: 'var(--space-8)',
              maxWidth: '720px',
              margin: '0 auto',
            }}
          >
            <h1
              style={{
                fontSize: 'clamp(1.4rem, 3vw, 2rem)',
                marginBottom: 'var(--space-3)',
              }}
            >
              Shopping cart is available to customer accounts only
            </h1>
            <p style={{ marginBottom: 'var(--space-6)' }}>
              You&apos;re signed in as {isAdmin ? 'an administrator' : 'an employee'}
              {user.name ? ` (${user.name})` : ''}. You can still browse outlet menus, but
              adding items and checkout require a customer account.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                flexWrap: 'wrap',
              }}
            >
              <Link to={dashboardPath} className="btn btn-primary">
                {isAdmin ? 'Go to admin dashboard' : 'Go to kitchen dashboard'}
              </Link>
              <Link to="/" className="btn btn-secondary">
                Browse outlets
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  return <Navigate to="/login" replace />;
};

export default CustomerOnlyRoute;
