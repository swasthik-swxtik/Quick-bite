/**
 * socket.service.js — Helpers for emitting Socket.IO events.
 *
 * Controllers call these functions to push real-time updates to clients.
 * The Socket.IO server instance (io) is injected once during server startup.
 *
 * Room naming convention:
 *   order:<orderId>   — joined by the customer tracking that specific order
 *   outlet:<outletId> — joined by that outlet's employee dashboards
 *
 * Usage in controllers:
 *   const socketService = require('../services/socket.service');
 *   socketService.emitOutletOrderStatusUpdate(outletOrder);
 *
 * Payload rule: an event that reaches a kitchen screen must never carry a
 * pickup code. The code is the customer's proof of collection, so it lives only
 * in customer-scoped HTTP responses (the customer's own order) and never in the
 * shared room payloads below.
 */

let io = null;

/**
 * Called once in socket.js to give this service access to the io instance.
 * @param {import('socket.io').Server} ioInstance
 */
const init = (ioInstance) => {
  io = ioInstance;
};

/**
 * Emit an outlet order status update to everyone who must see it:
 *  - the customer tracking that order (`order:<orderId>`)
 *  - every kitchen screen of the outlet that owns the sub-order
 *    (`outlet:<outletId>`) so a second employee tab is never stale
 *
 * `orderStatus` is the parent order's recalculated status, so the tracking page
 * applies both without duplicating the aggregation rule in the browser.
 *
 * Room membership is authorised by the socket handshake/join handlers, so an
 * employee of a different outlet cannot be in `outlet:<outletId>` and therefore
 * never receives these events.
 *
 * Both rooms get the same payload, which is why it must stay free of customer
 * secrets: the tracking page reads the pickup code from the order it already
 * loaded over its owner-scoped HTTP request.
 *
 * @param {{ orderId, id, outletId, outletName, status, orderStatus }} outletOrder
 */
const emitOutletOrderStatusUpdate = (outletOrder) => {
  if (!io) return;

  const payload = {
    outletOrderId: outletOrder.id,
    outletId:      outletOrder.outletId,
    status:        outletOrder.status,
    orderStatus:   outletOrder.orderStatus,
  };

  io.to(`order:${outletOrder.orderId}`).emit('outlet_order_status_updated', payload);
  io.to(`outlet:${outletOrder.outletId}`).emit('outlet_order_status_updated', payload);
};

/**
 * Emit a new incoming order to the outlet's employee dashboard.
 * The employee's browser has joined the room `outlet:<outletId>`.
 *
 * The payload is built field by field on purpose: the freshly created outlet
 * order still carries its pickup code, and a spread of the row would hand the
 * code straight to the kitchen screen.
 *
 * @param {string} outletId
 * @param {Object} outletOrder - The newly created outlet order
 */
const emitNewOutletOrder = (outletId, outletOrder) => {
  if (!io) return;

  io.to(`outlet:${outletId}`).emit('new_outlet_order', {
    id:        outletOrder.id,
    orderId:   outletOrder.orderId,
    outletId:  outletOrder.outletId,
    status:    outletOrder.status,
    subtotal:  outletOrder.subtotal,
    createdAt: outletOrder.createdAt,
    items:     outletOrder.items,
  });
};

/**
 * Tell an outlet's open dashboards that a completed order was archived, so a
 * second tab drops the row without waiting for a refresh.
 *
 * Emitted to the outlet room only: the customer's list must not change because
 * a counter tidied its own History. Ids only — never a pickup code.
 *
 * @param {string} outletId
 * @param {string} outletOrderId
 */
const emitOutletOrderArchived = (outletId, outletOrderId) => {
  if (!io) return;

  io.to(`outlet:${outletId}`).emit('outlet_order_archived', { outletOrderId });
};

module.exports = {
  init,
  emitOutletOrderStatusUpdate,
  emitNewOutletOrder,
  emitOutletOrderArchived,
};
