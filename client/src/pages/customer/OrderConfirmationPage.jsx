/**
 * OrderConfirmationPage.jsx — Receipt for a placed order.
 *
 * Loads GET /api/orders/:id (owner-scoped on the server) rather than reading the
 * checkout response from router state, so the page survives a reload and cannot
 * be spoofed by a crafted URL.
 *
 * Shows the pickup code for each outlet sub-order — the code the customer shows
 * at that outlet's counter.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as orderService from '../../services/orderService';
import { formatPrice, shortId, statusBadgeClass, statusLabel } from '../../utils/format';
import { paymentMethodLabel } from '../../utils/payment';
import styles from './OrderConfirmationPage.module.css';

const OrderConfirmationPage = () => {
  const { id } = useParams();

  const [order, setOrder] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadOrder = async () => {
      setIsLoading(true);
      setError('');
      try {
        const data = await orderService.getOrderById(id);
        if (cancelled) return;
        setOrder(data.order);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadOrder();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="page-content">
        <div className={styles.stateBox}>
          <div className="spinner" />
          <p>Loading your order…</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="page-content">
        <div className={`container ${styles.stateBox}`} role="alert">
          <h2>We couldn't load this order</h2>
          <p className={styles.errorDetail}>{error || 'Order not found.'}</p>
          <Link to="/" className="btn btn-primary">
            Back to outlets
          </Link>
        </div>
      </div>
    );
  }

  const placedAt = new Date(order.createdAt).toLocaleString();

  return (
    <div className="page-content">
      <div className="container">
        {/* ── Header ── */}
        <header className={styles.header}>
          <span className={styles.tick} aria-hidden="true">
            ✅
          </span>
          <h1>Order confirmed</h1>
          <p className={styles.headerText}>
            {order.outletOrders.length === 1
              ? 'Your order was sent to the kitchen.'
              : `Your order was split across ${order.outletOrders.length} kitchens — each one has its own pickup code.`}
          </p>

          <dl className={styles.meta}>
            <div className={styles.metaItem}>
              <dt>Order</dt>
              <dd>#{shortId(order.id)}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>Placed</dt>
              <dd>{placedAt}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>Total</dt>
              <dd>{formatPrice(order.totalAmount)}</dd>
            </div>
            <div className={styles.metaItem}>
              <dt>Status</dt>
              <dd>
                <span className={statusBadgeClass(order.status)}>{statusLabel(order.status)}</span>
              </dd>
            </div>
            <div className={styles.metaItem}>
              <dt>Payment</dt>
              <dd>
                {paymentMethodLabel(order.paymentMethod)}
                <span className={styles.simulated}> (simulated)</span>
              </dd>
            </div>
          </dl>
        </header>

        {/* ── Pickup codes, one per outlet ── */}
        <section className={styles.outlets}>
          <h2 className={styles.sectionTitle}>Collect from each counter</h2>

          <div className={styles.outletGrid}>
            {order.outletOrders.map((outletOrder) => (
              <article key={outletOrder.id} className={`card ${styles.outletCard}`}>
                <header className={styles.outletHead}>
                  <h3 className={styles.outletName}>{outletOrder.outletName}</h3>
                  <span className={statusBadgeClass(outletOrder.status)}>
                    {statusLabel(outletOrder.status)}
                  </span>
                </header>

                {outletOrder.counterInfo && (
                  <p className={styles.outletCounter}>
                    <span aria-hidden="true">📍</span> {outletOrder.counterInfo}
                  </p>
                )}

                <div className={styles.pickup}>
                  <span className={styles.pickupLabel}>Pickup code</span>
                  <strong className={styles.pickupCode}>{outletOrder.pickupCode}</strong>
                  <span className={styles.pickupHint}>
                    Show this code at the counter to collect this part of the order.
                  </span>
                </div>

                <ul className={styles.items}>
                  {outletOrder.items.map((item) => (
                    <li key={item.id} className={styles.item}>
                      <span className={styles.itemName}>
                        <span className={styles.itemQty}>{item.quantity}×</span> {item.name}
                      </span>
                      <span className={styles.itemPrice}>
                        {formatPrice(Number(item.unitPrice) * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <footer className={styles.outletFoot}>
                  <span>Subtotal</span>
                  <strong>{formatPrice(outletOrder.subtotal)}</strong>
                </footer>
              </article>
            ))}
          </div>
        </section>

        {/* ── Actions ── */}
        <div className={styles.actions}>
          <Link to={`/track/${order.id}`} className="btn btn-primary">
            Track this order
          </Link>
          <Link to="/" className="btn btn-secondary">
            Order something else
          </Link>
        </div>

        <p className={styles.note}>
          Payment was simulated for this demo order — no money changed hands.
        </p>
      </div>
    </div>
  );
};

export default OrderConfirmationPage;
