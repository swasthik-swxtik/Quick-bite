import api from './api';

/**
 * employeeService.js — HTTP calls used by the outlet employee dashboard.
 * The server scopes every call to the employee's own outlet.
 */

/** GET /api/employee/orders — all outlet orders belonging to my outlet. */
export const getMyOutletOrders = () => api.get('/employee/orders');

/**
 * PATCH /api/employee/outlet-orders/:id — advance one outlet order's status.
 *
 * The server validates the transition and requires the customer's pickup code
 * before an order can be marked `collected`.
 */
export const updateOutletOrderStatus = (id, status, pickupCode) =>
  api.patch(`/employee/outlet-orders/${id}`, pickupCode ? { status, pickupCode } : { status });

/**
 * DELETE /api/employee/outlet-orders/:id/history — archive one completed outlet
 * order from this outlet's History tab.
 *
 * Outlet-wide and non-destructive: the outlet order, its pickup code, the parent
 * customer order and the payment records are all kept. Only `collected` orders
 * qualify, and employees can only reach their own outlet's rows.
 */
export const archiveOutletOrder = (id) =>
  api.delete(`/employee/outlet-orders/${id}/history`);
