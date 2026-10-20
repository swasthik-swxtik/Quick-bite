/**
 * OrdersPage.jsx — The signed-in customer's order history.
 *
 * Loads GET /api/orders. Ownership is enforced on the server: the route is
 * `authorize('customer')` and the query is scoped to `req.user.id`
 * (findOrdersByCustomerId), so the client never sends a customer id and cannot
 * ask for somebody else's orders.
 *
 * Each row links to /track/:orderId for the live per-outlet progress.
 *
 * The response also carries each outlet's pickup code (findOrdersByCustomerId),
 * so the customer can read the code at the counter without opening the tracking
 * page. These codes are customer-only: the server never sends them to staff.
 *
 * A completed order can be removed from this list. That is an archive, not a
 * delete: the server keeps the order, its items, the payment fields and every
 * pickup code, and only hides the entry from this customer's history.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as orderService from '../../services/orderService';
import { ConfirmDialog } from '../../components/common/Modal';
import { canArchiveOrder } from '../../utils/orderHistory';
import {
  clockTime,
  formatPrice,
  shortId,
  statusBadgeClass,
  statusLabel,
  timeAgo,
} from '../../utils/format';
import styles from './OrdersPage.module.css';

const OrdersPage = () => {
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Removal from history: the dialog target, its in-flight/error state, and the
  // success banner.
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [notice, setNotice] = useState('');

  // `isLoading` already starts as true, and state is only touched from async
  // callbacks, so mounting never triggers a cascading render.
  useEffect(() => {
    let cancelled = false;

    orderService
      .getMyOrders()
      .then((data) => {
        if (cancelled) return;
        setOrders(data.orders || []);
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
  }, []);

  /** Manual refresh (the header button) — an event, so touching state is fine. */
  const refresh = async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await orderService.getMyOrders();
      setOrders(data.orders || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  /** The customer confirmed: hide the completed order from their history. */
  const confirmArchive = async () => {
    if (!archiveTarget) return;

    setArchiving(true);
    setArchiveError('');

    try {
      await orderService.archiveOrder(archiveTarget.id);

      // The row is gone from the list immediately; the server already excluded
      // it from the next fetch as well.
      setOrders((prev) => prev.filter((order) => order.id !== archiveTarget.id));
      setNotice(
        `Order #${shortId(archiveTarget.id)} was removed from your history. The order and payment records are kept.`
      );
      setArchiveTarget(null);
    } catch (err) {
      // 409 means the order is not fully completed yet (or a stale page): show
      // the server's explanation and leave the row in place.
      setArchiveError(err.message);
    } finally {
      setArchiving(false);
    }
  };

  const closeArchiveDialog = () => {
    if (archiving) return;
    setArchiveTarget(null);
    setArchiveError('');
  };

  return (
    <div className="page-content">
      <div className="container">
        {/* ── Header ── */}
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Your account</p>
            <h1>My orders</h1>
            <p className={styles.headerMeta}>
              Every order you have placed, newest first. Completed orders can be
              removed from this list.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={refresh}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </header>

        {error && (
          <div className={`alert alert-error ${styles.banner}`} role="alert">
            {error}
          </div>
        )}

        {notice && (
          <div className={`alert alert-success ${styles.banner}`} role="status">
            {notice}
          </div>
        )}

        {isLoading ? (
          <div className={styles.stateBox}>
            <div className="spinner" />
            <p>Loading your orders…</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={styles.stateBox}>
            <span className={styles.stateIcon} aria-hidden="true">
              🧾
            </span>
            <h2>No orders yet</h2>
            <p className={styles.stateText}>
              Once you check out, your orders appear here so you can track them any time.
            </p>
            <Link to="/" className="btn btn-primary">
              Browse outlets
            </Link>
          </div>
        ) : (
          <ul className={styles.list}>
            {orders.map((order) => (
              <li key={order.id} className={`card ${styles.row}`}>
                <div className={styles.rowMain}>
                  <div className={styles.rowTop}>
                    <span className={styles.orderRef}>Order #{shortId(order.id)}</span>
                    <span className={statusBadgeClass(order.status)}>
                      {statusLabel(order.status)}
                    </span>
                  </div>

                  <p className={styles.rowMeta}>
                    Placed {timeAgo(order.createdAt)} at {clockTime(order.createdAt)}
                  </p>

                  {order.outletOrders?.length > 0 && (
                    <ul className={styles.codes} aria-label="Pickup codes">
                      {order.outletOrders.map((sub) => (
                        <li key={sub.id} className={styles.codeChip}>
                          <span className={styles.codeOutlet}>{sub.outletName}</span>
                          <span className={styles.codeValue}>{sub.pickupCode}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={styles.rowSide}>
                  <span className={styles.total}>{formatPrice(order.totalAmount)}</span>
                  <Link to={`/track/${order.id}`} className="btn btn-secondary btn-sm">
                    Track order
                  </Link>

                  {/* Only fully completed orders may leave the history; the API
                      enforces the same rule (409 for anything still active). */}
                  {canArchiveOrder(order.status) && (
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${styles.removeBtn}`}
                      onClick={() => {
                        setArchiveError('');
                        setNotice('');
                        setArchiveTarget(order);
                      }}
                    >
                      Delete from history
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {archiveTarget && (
          <ConfirmDialog
            title="Remove this order from your history?"
            message={`Order #${shortId(archiveTarget.id)} will disappear from My orders.`}
            details={[
              'The order, its items and the payment record are kept.',
              'Each counter keeps its own record and pickup-code verification.',
            ]}
            warning="You will not be able to open it from My orders again."
            confirmLabel="Remove from history"
            busy={archiving}
            error={archiveError}
            onConfirm={confirmArchive}
            onCancel={closeArchiveDialog}
          />
        )}
      </div>
    </div>
  );
};

export default OrdersPage;
