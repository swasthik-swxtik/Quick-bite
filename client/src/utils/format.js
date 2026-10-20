/**
 * format.js — Small shared formatting helpers.
 */

/**
 * Format a price for display.
 *
 * PostgreSQL returns NUMERIC columns as strings (e.g. "249.00"), so this
 * accepts both strings and numbers.
 *
 * @param {string|number} value
 * @returns {string} e.g. "₹249.00"
 */
export const formatPrice = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `₹${amount.toFixed(2)}`;
};

/**
 * Map an order / outlet-order status to its badge class from the global design
 * system, e.g. "confirmed" → "badge badge-confirmed",
 * "partially_ready" → "badge badge-partially-ready".
 */
export const statusBadgeClass = (status) => `badge badge-${String(status).replace(/_/g, '-')}`;

/** Human-readable status label, e.g. "partially_ready" → "Partially ready". */
export const statusLabel = (status) => {
  const text = String(status).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** Short, quotable reference for a UUID, e.g. "9f1c4a2b". */
export const shortId = (id) => String(id ?? '').slice(0, 8).toUpperCase();

/**
 * Relative time label for an order timestamp.
 * @param {string|number|Date} value
 * @returns {string} e.g. "just now", "5 min ago", "2 h ago"
 */
export const timeAgo = (value) => {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.round(hours / 24)} d ago`;
};

/** Clock time for an order timestamp, e.g. "15:42". */
export const clockTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
