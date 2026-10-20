/**
 * socket.js — Socket.IO client for real-time order updates.
 *
 * Authentication uses the same httpOnly JWT cookie as the REST API, so the
 * handshake must include credentials (`withCredentials: true`); the server
 * rejects an unauthenticated handshake outright.
 *
 * The handshake also names the page's per-tab session id (`qb_sess_<sid>`),
 * because one browser holds every login's cookie: this is how a staff tab reads
 * its own cookie instead of another employee's. The id is opaque and is never
 * the JWT.
 *
 * Rooms are joined explicitly and acknowledged, which is also how the server
 * enforces access:
 *   `order:<orderId>`   — a customer tracking their own order (owner only)
 *   `outlet:<outletId>` — an employee watching their own outlet's orders
 *
 * An acknowledgement is `{ ok: true, room }` or `{ ok: false, reason }`.
 */

import { io } from 'socket.io-client';
import { getTabSessionId } from '../utils/session';

/**
 * The REST base URL ends in `/api` (e.g. http://localhost:3000/api) but the
 * Socket.IO endpoint lives on the origin, so strip that suffix.
 */
const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(
  /\/api\/?$/,
  ''
);

/**
 * Create a connection. Callers must `close()` it when they unmount.
 *
 * `session` is this tab's opaque session id (`qb_sess_<sid>`); without one the
 * handshake carries no selector and the server refuses it. Authorization still
 * comes from the signed token, never from the id.
 */
export const createSocket = (session = getTabSessionId()) =>
  io(SOCKET_URL, {
    withCredentials: true, // send the httpOnly auth cookie with the handshake
    transports: ['websocket', 'polling'],
    auth: session ? { session } : {},
  });

/**
 * Emit a room join and resolve with the server's acknowledgement.
 * If the socket is still connecting, Socket.IO buffers the emit until it is.
 */
const joinRoom = (socket, event, id) =>
  new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, id, (err, ack) => {
      if (err) reject(new Error('The server did not respond. Please try again.'));
      else resolve(ack);
    });
  });

/** Join `order:<orderId>` — resolves `{ ok, room }` or `{ ok: false, reason }`. */
export const joinOrderRoom = (socket, orderId) => joinRoom(socket, 'join_order_room', orderId);

/** Join `outlet:<outletId>` — resolves `{ ok, room }` or `{ ok: false, reason }`. */
export const joinOutletRoom = (socket, outletId) => joinRoom(socket, 'join_outlet_room', outletId);

/** Human-readable reason for a refused room join. */
export const joinFailureMessage = (reason) => {
  switch (reason) {
    case 'forbidden':
      return 'You do not have access to these live updates.';
    case 'not_found':
      return 'This order no longer exists.';
    case 'invalid_order_id':
    case 'invalid_outlet_id':
      return 'Live updates are not available for this page.';
    default:
      return 'Live updates could not be started.';
  }
};
