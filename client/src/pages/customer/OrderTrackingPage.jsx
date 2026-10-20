/**
 * OrderTrackingPage.jsx — Live progress of a placed order.
 *
 * Loads GET /api/orders/:id (owner-scoped on the server: a customer can only
 * read their own order) and then subscribes to `order:<orderId>` so the status
 * of each outlet's sub-order updates the moment the kitchen changes it.
 *
 * The order is split per outlet, so this page shows one card per counter, each
 * with its own status, pickup code and progress track. The overall status comes
 * from the server (it recalculates it); nothing is inferred client-side.
 *
 * Pickup codes are read from the order loaded above, never from the socket
 * event: the same event is broadcast to the outlet's kitchen screens, so it
 * carries no code (see utils/orderNotices.js).
 *
 * Tracking is customer data: the API allows only the owning customer (and an
 * admin). Staff who open a tracking URL are not shown a load error — the page
 * explains that tracking needs the customer account and offers to sign in.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import * as orderService from '../../services/orderService';
import { createSocket, joinFailureMessage, joinOrderRoom } from '../../services/socket';
import {
  clockTime,
  formatPrice,
  shortId,
  statusBadgeClass,
  statusLabel,
  timeAgo,
} from '../../utils/format';
import { paymentMethodLabel } from '../../utils/payment';
import { orderChangeNotice } from '../../utils/orderNotices';
import styles from './OrderTrackingPage.module.css';

/** The lifecycle of a single outlet order, mirroring the server's transitions. */
const STEPS = [
  { id: 'confirmed', label: 'Order received' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'ready',     label: 'Ready to collect' },
  { id: 'collected', label: 'Collected' },
];

/**
 * One-line summary of where the whole order stands, derived from its sub-orders
 * (an order is only as ready as its slowest kitchen).
 */
const headlineFor = ({ total, ready, collected, preparing }) => {
  if (total === 0) return 'Your order is on its way';
  if (collected === total) return 'Nothing left to collect — enjoy your meal!';
  if (ready + collected === total) return 'Your order is ready at every counter';
  if (ready > 0) return `${ready} of ${total} ${total === 1 ? 'counter is' : 'counters are'} ready`;
  if (collected > 0) return `${collected} of ${total} collected — ${total - collected} still in the kitchen`;
  if (preparing > 0) return 'The kitchens are preparing your order';
  return 'Your order has been sent to the kitchens';
};

const OrderTrackingPage = () => {
  const { orderId } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Only the customer who owns an order may see it. Staff can reach this route
  // so they get an explanation instead of a 403 page, but they never fetch.
  const isCustomer = user?.role === 'customer';

  const [order, setOrder] = useState(null);
  // A staff visitor never loads, so don't show the loading state at all.
  const [isLoading, setIsLoading] = useState(isCustomer);
  const [error, setError] = useState('');

  const [live, setLive] = useState('connecting'); // connecting | live | unavailable
  const [liveMessage, setLiveMessage] = useState('');
  const [notice, setNotice] = useState(null);
  const [flashId, setFlashId] = useState(null);

  // The socket handler needs the current order without re-subscribing on every
  // update, so keep a ref alongside the state.
  const orderRef = useRef(null);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const noticeTimer = useRef(null);
  const flashTimer = useRef(null);

  useEffect(
    () => () => {
      clearTimeout(noticeTimer.current);
      clearTimeout(flashTimer.current);
    },
    []
  );

  // ── Load the order ────────────────────────────────────────────────────────
  // Customers start with `isLoading` true (state is only touched from async
  // callbacks, so the effect never triggers a cascading render). Staff never
  // fetch: the API would answer 403 by design.
  useEffect(() => {
    if (!isCustomer) return undefined;

    let cancelled = false;

    orderService
      .getOrderById(orderId)
      .then((data) => {
        if (cancelled) return;
        setOrder(data.order);
        setError('');
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId, isCustomer]);

  /** Manual refresh (the header button) — an event, so touching state is fine. */
  const handleRefresh = async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await orderService.getOrderById(orderId);
      setOrder(data.order);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Staff on a tracking URL: sign out of the staff account, then land on the
   * customer sign-in page. LoginPage redirects signed-in users away, so the
   * sign-out has to happen first.
   */
  const switchToCustomer = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // ── Live updates ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isCustomer || !orderId) return undefined;

    const socket = createSocket();
    let cancelled = false;

    socket.on('connect', async () => {
      try {
        const ack = await joinOrderRoom(socket, orderId);
        if (cancelled) return;

        if (ack?.ok) {
          setLive('live');
          setLiveMessage('');
        } else {
          setLive('unavailable');
          setLiveMessage(joinFailureMessage(ack?.reason));
        }
      } catch (err) {
        if (!cancelled) {
          setLive('unavailable');
          setLiveMessage(err.message);
        }
      }
    });

    socket.on('disconnect', () => {
      if (!cancelled) setLive('connecting');
    });

    socket.on('connect_error', (err) => {
      if (!cancelled) {
        setLive('unavailable');
        setLiveMessage(`Live updates unavailable: ${err.message}`);
      }
    });

    socket.on('outlet_order_status_updated', (payload) => {
      if (cancelled) return;

      const current = orderRef.current;
      const changed = current?.outletOrders.find((oo) => oo.id === payload.outletOrderId);

      setOrder((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          // The server recalculates the overall status — use it as-is.
          status: payload.orderStatus ?? prev.status,
          outletOrders: prev.outletOrders.map((oo) =>
            oo.id === payload.outletOrderId ? { ...oo, status: payload.status } : oo
          ),
        };
      });

      // Nothing changed (a repeat event) — don't announce it twice.
      if (!changed || changed.status === payload.status) return;

      const outletName = changed.outletName;
      const message = orderChangeNotice({
        status: payload.status,
        outletName,
        // From the order this page loaded, not from the event: the payload is
        // shared with the kitchen screens and never carries pickup codes.
        pickupCode: changed.pickupCode,
      });

      setNotice({ id: `${payload.outletOrderId}-${payload.status}`, message });
      setFlashId(payload.outletOrderId);

      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 8000);

      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 4000);
    });

    return () => {
      cancelled = true;
      clearTimeout(noticeTimer.current);
      clearTimeout(flashTimer.current);
      socket.close();
    };
  }, [orderId, isCustomer]);

  // ── Derived summary ───────────────────────────────────────────────────────
  const progress = useMemo(() => {
    const outletOrders = order?.outletOrders ?? [];
    const total = outletOrders.length;

    return {
      total,
      collected: outletOrders.filter((oo) => oo.status === 'collected').length,
      ready: outletOrders.filter((oo) => oo.status === 'ready').length,
      preparing: outletOrders.filter((oo) => oo.status === 'preparing').length,
    };
  }, [order]);

  // ── States that replace the whole page ────────────────────────────────────
  // Staff (or an admin) opened a customer tracking URL. Explain the rule rather
  // than showing a load error: nothing was fetched for them.
  if (!isCustomer) {
    const dashboardPath = user?.role === 'admin' ? '/admin' : '/employee/dashboard';
    const roleLabel = user?.role === 'admin' ? 'an administrator' : 'staff';

    return (
      <div className="page-content">
        <div className={`container ${styles.stateBox}`}>
          <span className={styles.stateIcon} aria-hidden="true">
            🔒
          </span>
          <h1>Customer tracking is for customer accounts</h1>
          <p className={styles.stateText}>
            You&apos;re signed in as {roleLabel}
            {user?.name ? ` (${user.name})` : ''}. An order&apos;s live tracking belongs to the
            customer who placed it, so this page isn&apos;t available to staff accounts. Sign in
            with the customer account to follow the order.
          </p>
          <div className={styles.stateActions}>
            <button type="button" className="btn btn-primary" onClick={switchToCustomer}>
              Sign out and sign in as a customer
            </button>
            <Link to={dashboardPath} className="btn btn-secondary">
              {user?.role === 'admin' ? 'Admin dashboard' : 'Kitchen dashboard'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
          <h1>We couldn&apos;t load this order</h1>
          <p className={styles.stateText}>{error || 'Order not found.'}</p>
          <Link to="/" className="btn btn-primary">
            Back to outlets
          </Link>
        </div>
      </div>
    );
  }

  const headline = headlineFor(progress);

  const liveClass =
    live === 'live' ? styles.liveOn : live === 'connecting' ? styles.liveWait : styles.liveOff;
  const liveText = live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Offline';

  return (
    <div className="page-content">
      <div className="container">
        {/* ── Header ── */}
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <p className={styles.kicker}>Order #{shortId(order.id)}</p>
              <h1>{headline}</h1>
              <p className={styles.headerMeta}>
                Placed {timeAgo(order.createdAt)} at {clockTime(order.createdAt)} ·{' '}
                {formatPrice(order.totalAmount)} · {paymentMethodLabel(order.paymentMethod)}
              </p>
            </div>

            <div className={styles.headerActions}>
              <span className={statusBadgeClass(order.status)}>{statusLabel(order.status)}</span>
              <span className={liveClass} title={liveMessage || 'Real-time connection'}>
                <span className={styles.liveDot} aria-hidden="true" />
                {liveText}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                Refresh
              </button>
            </div>
          </div>

          {liveMessage && (
            <div className={styles.banner} role="status">
              {liveMessage}
            </div>
          )}
        </header>

        {/* ── Transient announcement ── */}
        <div className={styles.noticeSlot} aria-live="polite">
          {notice && (
            <div key={notice.id} className={`alert alert-info ${styles.notice}`}>
              {notice.message}
            </div>
          )}
        </div>

        {/* ── One card per outlet ── */}
        <div className={styles.grid}>
          {order.outletOrders.map((outletOrder) => {
            const currentStep = STEPS.findIndex((step) => step.id === outletOrder.status);

            return (
              <article
                key={outletOrder.id}
                className={[
                  'card',
                  styles.card,
                  outletOrder.status === 'ready' ? styles.cardReady : '',
                  flashId === outletOrder.id ? styles.cardFlash : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <header className={styles.cardHead}>
                  <h2 className={styles.outletName}>{outletOrder.outletName}</h2>
                  <span className={statusBadgeClass(outletOrder.status)}>
                    {statusLabel(outletOrder.status)}
                  </span>
                </header>

                {outletOrder.counterInfo && (
                  <p className={styles.counter}>
                    <span aria-hidden="true">📍</span> {outletOrder.counterInfo}
                  </p>
                )}

                <div className={styles.pickup}>
                  <span className={styles.pickupLabel}>Pickup code</span>
                  <strong className={styles.pickupCode}>{outletOrder.pickupCode}</strong>
                  <span className={styles.pickupHint}>
                    {outletOrder.status === 'ready'
                      ? 'Ready now — show this code at the counter.'
                      : 'Show this code at the counter when your order is ready.'}
                  </span>
                </div>

                {/* ── Progress track ── */}
                <ol className={styles.steps}>
                  {STEPS.map((step, index) => {
                    const state =
                      index < currentStep ? 'done' : index === currentStep ? 'current' : 'todo';

                    return (
                      <li key={step.id} className={`${styles.step} ${styles[state]}`}>
                        <span className={styles.stepDot} aria-hidden="true">
                          {state === 'done' ? '✓' : index + 1}
                        </span>
                        <span className={styles.stepLabel}>{step.label}</span>
                      </li>
                    );
                  })}
                </ol>

                <ul className={styles.items}>
                  {outletOrder.items.map((item) => (
                    <li key={item.id} className={styles.item}>
                      <span className={styles.itemName}>
                        <span className={styles.qty}>{item.quantity}×</span> {item.name}
                      </span>
                      <span className={styles.itemPrice}>
                        {formatPrice(Number(item.unitPrice) * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <footer className={styles.cardFoot}>
                  <span>Subtotal</span>
                  <strong>{formatPrice(outletOrder.subtotal)}</strong>
                </footer>
              </article>
            );
          })}
        </div>

        {/* ── Actions ── */}
        <div className={styles.actions}>
          <Link to={`/order-confirmation/${order.id}`} className="btn btn-secondary">
            View receipt
          </Link>
          <Link to="/" className="btn btn-primary">
            Order something else
          </Link>
        </div>

        <p className={styles.note}>
          This page updates itself as each kitchen works on your order — you can leave it open.
        </p>
      </div>
    </div>
  );
};

export default OrderTrackingPage;
