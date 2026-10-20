/**
 * orderHistory.js — when may an order leave a history list?
 *
 * The server is the authority: both archive endpoints re-check ownership, the
 * outlet and the status inside the SQL statement. This helper only decides
 * whether the UI offers the action, so a stale page can't suggest something the
 * API will refuse.
 *
 * Only fully completed orders may be hidden. An order still being prepared, ready
 * for pickup or awaiting collection must stay in the history, and for a
 * multi-outlet order the parent only counts as completed once every counter has
 * finished (the parent status is recomputed server-side).
 */

/**
 * @param {string} status - parent order status (customer) or outlet order status
 * @returns {boolean}
 */
export const canArchiveOrder = (status) => status === 'collected';
