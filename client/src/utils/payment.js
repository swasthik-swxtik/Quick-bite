/**
 * payment.js — The simulated payment methods the checkout offers.
 *
 * `value` must match the server's accepted list (the Joi schema in
 * order.controller.js and the chk_orders_payment_method CHECK constraint).
 * No real payment is processed anywhere in this app.
 */

export const PAYMENT_METHODS = [
  { value: 'card', icon: '💳', label: 'Card', hint: 'Debit or credit card' },
  { value: 'upi', icon: '📱', label: 'UPI', hint: 'Pay with a UPI app' },
  { value: 'wallet', icon: '👛', label: 'Wallet', hint: 'QuickBite wallet balance' },
];

/**
 * Human-readable name for a method stored on an order.
 * Falls back to the raw value, so a future method still renders sensibly.
 *
 * @param {string|null|undefined} method - e.g. 'upi'
 * @returns {string} e.g. 'UPI'
 */
export const paymentMethodLabel = (method) => {
  if (!method) return 'Not recorded';
  return PAYMENT_METHODS.find((option) => option.value === method)?.label || method;
};
