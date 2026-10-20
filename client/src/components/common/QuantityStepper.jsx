/**
 * QuantityStepper.jsx — − / value / + control.
 *
 * Shared by the outlet menu page and the cart page so both behave identically.
 *
 * `max` defaults to 50, matching the API's validation cap
 * (quantity: integer, min 1, max 50) — the UI therefore cannot build a cart the
 * server would reject. Decrementing past 1 is allowed: the caller removes the
 * line when the quantity reaches 0.
 */

import styles from './QuantityStepper.module.css';

const QuantityStepper = ({
  name,
  quantity,
  onIncrease,
  onDecrease,
  max = 50,
  disabled = false,
}) => (
  <div className={styles.stepper}>
    <button
      type="button"
      className={styles.btn}
      onClick={onDecrease}
      disabled={disabled}
      aria-label={`Remove one ${name}`}
    >
      −
    </button>
    <span className={styles.value} aria-live="polite">
      {quantity}
    </span>
    <button
      type="button"
      className={styles.btn}
      onClick={onIncrease}
      disabled={disabled || quantity >= max}
      aria-label={`Add another ${name}`}
      title={quantity >= max ? `Maximum ${max} per item` : undefined}
    >
      +
    </button>
  </div>
);

export default QuantityStepper;
