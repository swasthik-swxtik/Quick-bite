/**
 * ProtectedRoute.jsx — Guards routes that require authentication.
 *
 * Usage:
 *   <Route element={<ProtectedRoute allowedRoles={['customer']} />}>
 *     <Route path="/orders" element={<OrdersPage />} />
 *   </Route>
 *
 * Behaviour:
 *  - While loading (checking cookie): show spinner
 *  - Not logged in: redirect to /login
 *  - Wrong role: redirect to /unauthorized
 *  - Otherwise: render the child route
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const ProtectedRoute = ({ allowedRoles }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
