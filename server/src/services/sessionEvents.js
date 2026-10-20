/**
 * sessionEvents.js — In-process fan-out for session revocations.
 *
 * HTTP revocation is durable in PostgreSQL. Socket.IO lives in each server
 * process, so socket.js also listens to this emitter (the current instance)
 * and to PostgreSQL LISTEN/NOTIFY (other instances).
 */

const { EventEmitter } = require('events');

const events = new EventEmitter();
events.setMaxListeners(50);
events.CHANNEL = 'qb_session_revoked';

module.exports = events;
