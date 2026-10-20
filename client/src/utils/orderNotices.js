/**
 * orderNotices.js — The one-line announcement shown over the tracking page when
 * an outlet order changes.
 *
 * The pickup code in a "ready" notice comes from the order the page loaded over
 * its owner-scoped GET /api/orders/:id. It is deliberately not read from the
 * real-time payload: that same payload is broadcast to the outlet's kitchen
 * screens, so it no longer carries a pickup code at all. Keeping the message
 * building here makes that rule testable without a socket.
 */

import { statusLabel } from './format';

/**
 * @param {Object} change
 * @param {string} change.status      - the outlet order's new status
 * @param {string} [change.outletName] - the counter's name
 * @param {string} [change.pickupCode] - code of the LOADED order, never of the event
 * @returns {string}
 */
export const orderChangeNotice = ({ status, outletName, pickupCode }) => {
  const outlet = outletName || 'This counter';

  if (status === 'ready') {
    return pickupCode
      ? `${outlet} is ready — collect it with code ${pickupCode}.`
      : `${outlet} is ready to collect.`;
  }

  if (status === 'preparing') return `${outlet} has started preparing your order.`;
  if (status === 'collected') return `${outlet} order collected. Enjoy!`;

  return `${outlet} is now ${statusLabel(status).toLowerCase()}.`;
};
