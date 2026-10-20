import api from './api';

/**
 * orderService.js — HTTP calls for placing and tracking orders.
 */

/**
 * Place a new order.
 * @param {{ menuItemId: string, quantity: number }[]} items
 * @param {{ method: string }} payment
 */
export const placeOrder = (items, payment) =>
  api.post('/orders', { items, payment });

export const getMyOrders = () =>
  api.get('/orders');

export const getOrderById = (id) =>
  api.get(`/orders/${id}`);

/**
 * Remove one completed order from my history.
 *
 * The server archives the entry (one row beside the order) instead of deleting
 * anything: the order, its items, the payment fields and every pickup code are
 * kept, and staff dashboards are untouched. Only `collected` orders qualify.
 */
export const archiveOrder = (id) =>
  api.delete(`/orders/${id}/history`);
