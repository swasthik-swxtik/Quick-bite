/**
 * App.jsx — Root component.
 *
 * Wraps the entire app in AuthProvider and CartProvider,
 * then defines all client-side routes using React Router v6.
 *
 * Route structure:
 *  /                      → customer home (public)
 *  /outlet/:id            → outlet menu page (public)
 *  /login                 → login page (public)
 *  /register              → registration page (public)
 *  /cart                  → cart page (customer only, friendly staff notice)
 *  /checkout              → checkout page (customer only, friendly staff notice)
 *  /order-confirmation/:id → order confirmation (customer only)
 *  /orders                → customer's own order history (customer only)
 *  /track/:orderId        → order tracking (all signed-in roles; the page
 *                            explains to staff that tracking is customer-only,
 *                            and the API still refuses non-customers)
 *  /employee/login        → employee login (public)
 *  /employee/dashboard    → employee dashboard (employee/admin only)
 *  /admin                 → admin dashboard (admin only)
 *  /unauthorized          → 403 page
 *  *                      → 404 page
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import CustomerOnlyRoute from './components/common/CustomerOnlyRoute';
import Navbar from './components/common/Navbar';

// ── Pages ────────────────────────────────────────────────────────────────────
import HomePage from './pages/customer/HomePage';
import LoginPage from './pages/customer/LoginPage';
import RegisterPage from './pages/customer/RegisterPage';
import OutletMenuPage from './pages/customer/OutletMenuPage';
import CartPage from './pages/customer/CartPage';
import CheckoutPage from './pages/customer/CheckoutPage';
import OrderConfirmationPage from './pages/customer/OrderConfirmationPage';
import OrderTrackingPage from './pages/customer/OrderTrackingPage';
import OrdersPage from './pages/customer/OrdersPage';

import EmployeeLoginPage from './pages/employee/EmployeeLoginPage';
import EmployeeDashboardPage from './pages/employee/EmployeeDashboardPage';

import AdminDashboardPage from './pages/admin/AdminDashboardPage';

import UnauthorizedPage from './pages/UnauthorizedPage';
import NotFoundPage from './pages/NotFoundPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Navbar />
          <Routes>
            {/* ── Public customer routes ── */}
            <Route path="/" element={<HomePage />} />
            <Route path="/outlet/:id" element={<OutletMenuPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* ── Authenticated customer routes ── */}
            <Route element={<CustomerOnlyRoute />}>
              <Route path="/cart" element={<CartPage />} />
              <Route path="/checkout" element={<CheckoutPage />} />
            </Route>
            <Route element={<ProtectedRoute allowedRoles={['customer']} />}>
              <Route path="/order-confirmation/:id" element={<OrderConfirmationPage />} />
              <Route path="/orders" element={<OrdersPage />} />
            </Route>

            {/* Tracking holds customer data. Staff may open the URL so the page
                can explain why it is customer-only; the API still refuses them
                (GET /api/orders/:id is authorize('customer', 'admin')). */}
            <Route element={<ProtectedRoute allowedRoles={['customer', 'employee', 'admin']} />}>
              <Route path="/track/:orderId" element={<OrderTrackingPage />} />
            </Route>

            {/* ── Employee routes ── */}
            <Route path="/employee/login" element={<EmployeeLoginPage />} />
            <Route element={<ProtectedRoute allowedRoles={['employee', 'admin']} />}>
              <Route path="/employee/dashboard" element={<EmployeeDashboardPage />} />
            </Route>

            {/* ── Admin routes ── */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
            </Route>

            {/* ── Fallback routes ── */}
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
