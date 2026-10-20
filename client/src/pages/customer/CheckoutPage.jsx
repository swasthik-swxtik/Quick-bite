/**
 * CheckoutPage.jsx — Simulated payment and order placement.
 *
 * The flow:
 *   1. Review the multi-outlet breakdown (what each kitchen will prepare)
 *   2. Pick a simulated payment method
 *   3. POST /api/orders — the server recalculates every price from the database,
 *      creates one parent order plus one sub-order per outlet (transactionally),
 *      and issues a pickup code per outlet
 *   4. Clear the cart and go to the confirmation page
 *
 * No real payment is processed. The server validates the method and simulates
 * success; card details are deliberately not collected or sent (the API rejects
 * unknown fields, and there is nothing to charge).
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import * as orderService from '../../services/orderService';
import { formatPrice } from '../../utils/format';
import { groupByOutlet, subtotalOf } from '../../utils/cart';
import { PAYMENT_METHODS } from '../../utils/payment';
import styles from './CheckoutPage.module.css';

const CheckoutPage = () => {
  const { items, cartCount, cartTotal, outletCount, clearCart } = useCart();
  const navigate = useNavigate();

  const [method, setMethod] = useState('card');
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState('');

  const groups = useMemo(() => groupByOutlet(items), [items]);

  const handlePlaceOrder = async (event) => {
    event.preventDefault();
    setError('');
    setIsPlacing(true);

    try {
      // The API only ever receives item ids + quantities, never prices.
      const payload = items.map((line) => ({
        menuItemId: line.menuItem.id,
        quantity: line.quantity,
      }));

      const result = await orderService.placeOrder(payload, { method });

      // Replace this page in history so "back" cannot return to a spent cart.
      navigate(`/order-confirmation/${result.orderId}`, { replace: true });
      clearCart();
    } catch (err) {
      setError(err.message);
      setIsPlacing(false);
    }
  };

  // ── Nothing to pay for ──
  if (items.length === 0) {
    return (
      <div className="page-content">
        <div className={`container ${styles.empty}`}>
          <h1>Nothing to check out</h1>
          <p className={styles.emptyText}>Your cart is empty.</p>
          <Link to="/" className="btn btn-primary btn-lg">
            Browse outlets
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="container">
        <header className={styles.pageHead}>
          <Link to="/cart" className={styles.backLink}>
            ← Back to cart
          </Link>
          <h1>Checkout</h1>
          <p className={styles.pageMeta}>
            One payment for {outletCount} {outletCount === 1 ? 'outlet' : 'outlets'}. Each part of
            the order is prepared separately and has its own pickup code.
          </p>
        </header>

        <form className={styles.layout} onSubmit={handlePlaceOrder}>
          <div className={styles.main}>
            {error && (
              <div className={`alert alert-error ${styles.error}`} role="alert">
                <strong>We couldn't place your order.</strong>
                <span className={styles.errorDetail}>{error}</span>
                <Link to="/cart" className={styles.errorLink}>
                  Review your cart
                </Link>
              </div>
            )}

            {/* ── Payment method (simulated) ── */}
            <section className={`card ${styles.section}`}>
              <h2 className={styles.sectionTitle}>Payment method</h2>

              <div className="alert alert-info" role="note">
                Simulated payment — this demo checkout does not charge any real money.
              </div>

              <fieldset className={styles.methods} disabled={isPlacing}>
                <legend className={styles.srOnly}>Payment method</legend>
                {PAYMENT_METHODS.map((option) => (
                  <label
                    key={option.value}
                    className={`${styles.method} ${
                      method === option.value ? styles.methodActive : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      value={option.value}
                      checked={method === option.value}
                      onChange={() => setMethod(option.value)}
                      className={styles.radio}
                    />
                    <span className={styles.methodIcon} aria-hidden="true">
                      {option.icon}
                    </span>
                    <span className={styles.methodBody}>
                      <span className={styles.methodLabel}>{option.label}</span>
                      <span className={styles.methodHint}>{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>

            {/* ── What each outlet will prepare ── */}
            <section className={`card ${styles.section}`}>
              <h2 className={styles.sectionTitle}>Your order</h2>

              <div className={styles.outlets}>
                {groups.map((group) => (
                  <article key={group.outletId} className={styles.outlet}>
                    <header className={styles.outletHead}>
                      <h3 className={styles.outletName}>{group.outletName}</h3>
                      <span className="badge badge-confirmed">Own pickup code</span>
                    </header>

                    <ul className={styles.items}>
                      {group.items.map((line) => (
                        <li key={line.menuItem.id} className={styles.item}>
                          <span className={styles.itemName}>
                            <span className={styles.itemQty}>{line.quantity}×</span>{' '}
                            {line.menuItem.name}
                          </span>
                          <span className={styles.itemPrice}>
                            {formatPrice(Number(line.menuItem.price) * line.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <footer className={styles.outletFoot}>
                      <span>Subtotal</span>
                      <strong>{formatPrice(subtotalOf(group.items))}</strong>
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          </div>

          {/* ── Summary ── */}
          <aside className={`card ${styles.summary}`}>
            <h2 className={styles.summaryTitle}>Summary</h2>

            <dl className={styles.summaryList}>
              <div className={styles.summaryRow}>
                <dt>Items</dt>
                <dd>{cartCount}</dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>Outlets</dt>
                <dd>{outletCount}</dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>Pickup codes</dt>
                <dd>{outletCount}</dd>
              </div>
              <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
                <dt>Total</dt>
                <dd>{formatPrice(cartTotal)}</dd>
              </div>
            </dl>

            <button type="submit" className="btn btn-primary btn-lg" disabled={isPlacing}>
              {isPlacing ? 'Placing order…' : `Place order · ${formatPrice(cartTotal)}`}
            </button>

            <p className={styles.summaryNote}>
              Prices are recalculated from the menu by the server when the order is placed.
            </p>
          </aside>
        </form>
      </div>
    </div>
  );
};

export default CheckoutPage;
