/**
 * EmployeeDashboardPage.jsx — Live kitchen queue for one outlet.
 *
 * This is the employee's working screen:
 *   1. Every outlet order for the employee's OWN outlet is listed, newest first
 *      (GET /api/employee/orders — the server scopes it by the JWT, not by
 *      anything the client sends).
 *   2. New orders appear instantly: the browser joins the `outlet:<id>` room and
 *      the checkout pushes `new_outlet_order` to it.
 *   3. The employee advances the status one step at a time. The server validates
 *      every transition and requires the customer's pickup code before an order
 *      can be marked collected — the UI only mirrors those rules to label the
 *      buttons. Every other screen of this outlet hears `outlet_order_status_updated`
 *      so two tabs never disagree.
 *   4. This screen never receives a pickup code: the customer reads theirs out
 *      and the employee types it in. A dashboard that displayed the code would
 *      make the collection check meaningless.
 *   5. Completed orders stay in the "History" filter until an employee archives
 *      them. Archiving is outlet-wide and non-destructive: the outlet order, its
 *      pickup code, the parent customer order and the payment records are kept,
 *      and only this outlet's own list changes.
 *
 * Prices and statuses shown here always come from the server; nothing is
 * calculated client-side except line totals for display.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import * as employeeService from '../../services/employeeService';
import * as outletService from '../../services/outletService';
import { createSocket, joinOutletRoom, joinFailureMessage } from '../../services/socket';
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
import styles from './EmployeeDashboardPage.module.css';

/**
 * The one allowed next step for each status. This mirrors VALID_TRANSITIONS in
 * server/src/controllers/employee.controller.js — the server is the authority,
 * this only decides which button to show.
 */
const NEXT_STEP = {
  confirmed: { status: 'preparing', label: 'Start preparing' },
  preparing: { status: 'ready', label: 'Mark ready' },
  ready:     { status: 'collected', label: 'Mark collected', needsCode: true },
  collected: null,
};

const FILTERS = [
  { id: 'active',   label: 'Active' },
  { id: 'ready',    label: 'Ready' },
  // Completed orders. Archiving removes them from this list only.
  { id: 'collected', label: 'History' },
  { id: 'all',      label: 'All' },
];

const EmployeeDashboardPage = () => {
  const { user } = useAuth();
  const outletId = user?.outletId || null;

  const [outlet, setOutlet] = useState(null);
  const [orders, setOrders] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('active');

  // Real-time connection state, so the dashboard can say "Offline" rather than
  // silently showing stale data.
  const [live, setLive] = useState('connecting'); // connecting | live | unavailable
  const [liveMessage, setLiveMessage] = useState('');

  // Per-order request state, so one slow order never blocks the rest.
  const [pendingId, setPendingId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const [collectingId, setCollectingId] = useState(null);
  const [codeDraft, setCodeDraft] = useState('');
  const [flashId, setFlashId] = useState(null);

  // Archiving a completed order from this outlet's History tab.
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [archiveNotice, setArchiveNotice] = useState('');

  const flashTimer = useRef(null);
  const noticeTimer = useRef(null);

  // ── Load the queue ────────────────────────────────────────────────────────
  // State is only touched from async callbacks, so mounting never triggers a
  // cascading render (`isLoading` already starts as true).
  useEffect(() => {
    if (!outletId) return undefined;

    let cancelled = false;

    employeeService
      .getMyOutletOrders()
      .then((data) => {
        if (cancelled) return;
        setOrders(data.orders || []);
        setLoadError('');
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [outletId]);

  /** Manual refresh (the header button) — an event, so touching state is fine. */
  const refresh = async () => {
    setIsLoading(true);
    setLoadError('');

    try {
      const data = await employeeService.getMyOutletOrders();
      setOrders(data.orders || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Outlet name / counter for the header (public endpoint) ────────────────
  useEffect(() => {
    if (!outletId) return undefined;

    let cancelled = false;
    outletService
      .getOutletById(outletId)
      .then((data) => {
        if (!cancelled) setOutlet(data.outlet);
      })
      .catch(() => {
        // Non-essential: the header falls back to a generic title.
      });

    return () => {
      cancelled = true;
    };
  }, [outletId]);

  // ── Real-time: join this outlet's room and receive new orders ─────────────
  useEffect(() => {
    if (!outletId) return undefined;

    const socket = createSocket();
    let cancelled = false;

    socket.on('connect', async () => {
      try {
        const ack = await joinOutletRoom(socket, outletId);
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

    // The payload has the same shape as one row of GET /api/employee/orders.
    socket.on('new_outlet_order', (outletOrder) => {
      if (cancelled) return;

      setOrders((prev) =>
        prev.some((o) => o.id === outletOrder.id) ? prev : [outletOrder, ...prev]
      );
      setFlashId(outletOrder.id);

      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 6000);
    });

    // A status advanced elsewhere — another tab of this dashboard, or another
    // employee at the same counter. Update only the matching row; the room is
    // per-outlet and the server already scopes the emit, but check the outlet id
    // anyway so a malformed event can never touch someone else's row.
    socket.on('outlet_order_status_updated', (payload) => {
      if (cancelled || !payload) return;
      if (payload.outletId && payload.outletId !== outletId) return;

      setOrders((prev) =>
        prev.map((o) => (o.id === payload.outletOrderId ? { ...o, status: payload.status } : o))
      );
      setFlashId(payload.outletOrderId);

      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 6000);
    });

    // Another employee at this counter archived a completed order: drop the row
    // here too, so two tabs never disagree. Ids only — no customer data.
    socket.on('outlet_order_archived', (payload) => {
      if (cancelled || !payload) return;
      setOrders((prev) => prev.filter((o) => o.id !== payload.outletOrderId));
    });

    return () => {
      cancelled = true;
      clearTimeout(flashTimer.current);
      clearTimeout(noticeTimer.current);
      socket.close();
    };
  }, [outletId]);

  // ── Advance one order's status ────────────────────────────────────────────
  const advance = async (outletOrder, pickupCode) => {
    const step = NEXT_STEP[outletOrder.status];
    if (!step) return;

    setPendingId(outletOrder.id);
    setRowErrors((prev) => ({ ...prev, [outletOrder.id]: '' }));

    try {
      const data = await employeeService.updateOutletOrderStatus(
        outletOrder.id,
        step.status,
        pickupCode
      );

      const updated = data.outletOrder;
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      setCollectingId(null);
      setCodeDraft('');
    } catch (err) {
      // e.g. "Incorrect pickup code." or an invalid transition
      setRowErrors((prev) => ({ ...prev, [outletOrder.id]: err.message }));
    } finally {
      setPendingId(null);
    }
  };

  // ── Archive a completed order (History tab) ───────────────────────────────
  const confirmArchive = async () => {
    if (!archiveTarget) return;

    setArchiving(true);
    setArchiveError('');

    try {
      await employeeService.archiveOutletOrder(archiveTarget.id);

      setOrders((prev) => prev.filter((o) => o.id !== archiveTarget.id));
      setArchiveNotice(
        `Order #${shortId(archiveTarget.orderId)} archived from this outlet's history. The order and pickup records are kept.`
      );
      setArchiveTarget(null);

      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setArchiveNotice(''), 6000);
    } catch (err) {
      // 409 when the order is not collected (a stale page); the row stays put.
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

  // ── Derived data ──────────────────────────────────────────────────────────
  const counts = useMemo(
    () => ({
      confirmed: orders.filter((o) => o.status === 'confirmed').length,
      preparing: orders.filter((o) => o.status === 'preparing').length,
      ready:     orders.filter((o) => o.status === 'ready').length,
      collected: orders.filter((o) => o.status === 'collected').length,
    }),
    [orders]
  );

  const visibleOrders = useMemo(() => {
    switch (filter) {
      case 'active':    return orders.filter((o) => o.status !== 'collected');
      case 'ready':     return orders.filter((o) => o.status === 'ready');
      case 'collected': return orders.filter((o) => o.status === 'collected');
      default:          return orders;
    }
  }, [orders, filter]);

  const countFor = (id) => {
    if (id === 'all') return orders.length;
    if (id === 'active') return orders.length - counts.collected;
    return counts[id] ?? 0;
  };

  // ── States that replace the whole page ────────────────────────────────────
  if (!outletId) {
    return (
      <div className="page-content">
        <div className={`container ${styles.stateBox}`}>
          <h1>No outlet assigned</h1>
          <p className={styles.stateText}>
            This dashboard shows a single outlet&apos;s queue, and your account is not linked to
            one yet. An administrator can assign you to an outlet.
          </p>
          <Link to="/" className="btn btn-primary">
            Browse outlets
          </Link>
        </div>
      </div>
    );
  }

  const liveClass =
    live === 'live' ? styles.liveOn : live === 'connecting' ? styles.liveWait : styles.liveOff;
  const liveText = live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Offline';

  return (
    <div className="page-content">
      <div className="container">
        {/* ── Header ── */}
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>Kitchen queue</p>
            <h1>{outlet ? outlet.name : 'Your outlet'}</h1>
            <p className={styles.headerMeta}>
              {outlet?.counterInfo ? <span>{outlet.counterInfo} · </span> : null}
              <span className={liveClass} title={liveMessage || 'Real-time connection'}>
                <span className={styles.liveDot} aria-hidden="true" />
                {liveText}
              </span>
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

        {liveMessage && (
          <div className={`alert alert-error ${styles.banner}`} role="status">
            {liveMessage}
          </div>
        )}

        {loadError && (
          <div className={`alert alert-error ${styles.banner}`} role="alert">
            {loadError}
          </div>
        )}

        {archiveNotice && (
          <div className={`alert alert-success ${styles.banner}`} role="status">
            {archiveNotice}
          </div>
        )}

        {/* ── Counters ── */}
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{counts.confirmed}</span>
            <span className={styles.statLabel}>New</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{counts.preparing}</span>
            <span className={styles.statLabel}>Preparing</span>
          </div>
          <div className={`${styles.stat} ${styles.statReady}`}>
            <span className={styles.statValue}>{counts.ready}</span>
            <span className={styles.statLabel}>Ready to collect</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{counts.collected}</span>
            <span className={styles.statLabel}>Collected</span>
          </div>
        </div>

        {/* ── Filters ── */}
        <nav className={styles.filters} aria-label="Filter orders">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`${styles.filter} ${filter === option.id ? styles.filterActive : ''}`}
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
              <span className={styles.filterCount}>{countFor(option.id)}</span>
            </button>
          ))}
        </nav>

        {filter === 'collected' && (
          <p className={styles.filterHint}>
            Completed orders stay here until someone at this counter archives them.
            Archiving is outlet-wide and never deletes the order, its payment record or
            its pickup-code verification.
          </p>
        )}

        {/* ── The queue ── */}
        {isLoading ? (
          <div className={styles.stateBox}>
            <div className="spinner" />
            <p>Loading the queue…</p>
          </div>
        ) : visibleOrders.length === 0 ? (
          <div className={styles.stateBox}>
            <span className={styles.stateIcon} aria-hidden="true">
              🍽️
            </span>
            <h2>
              {filter === 'active'
                ? 'No orders waiting'
                : `Nothing in "${FILTERS.find((f) => f.id === filter)?.label}"`}
            </h2>
            <p className={styles.stateText}>
              New orders appear here the moment a customer checks out — no need to refresh.
            </p>
          </div>
        ) : (
          <div className={styles.grid}>
            {visibleOrders.map((order) => {
              const step = NEXT_STEP[order.status];
              const isPending = pendingId === order.id;
              const isCollecting = collectingId === order.id;
              const rowError = rowErrors[order.id];

              return (
                <article
                  key={order.id}
                  className={[
                    'card',
                    styles.card,
                    order.status === 'ready' ? styles.cardReady : '',
                    flashId === order.id ? styles.cardFlash : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <header className={styles.cardHead}>
                    <div className={styles.headRight}>
                      <span className={statusBadgeClass(order.status)}>
                        {statusLabel(order.status)}
                      </span>
                      <span
                        className={styles.time}
                        title={new Date(order.createdAt).toLocaleString()}
                      >
                        {clockTime(order.createdAt)} · {timeAgo(order.createdAt)}
                      </span>
                    </div>
                  </header>

                  <p className={styles.orderRef}>Order #{shortId(order.orderId)}</p>

                  <ul className={styles.items}>
                    {order.items.map((item, index) => (
                      <li key={`${item.name}-${index}`} className={styles.item}>
                        <span className={styles.qty}>{item.quantity}×</span>
                        <span className={styles.itemName}>{item.name}</span>
                        <span className={styles.itemPrice}>
                          {formatPrice(Number(item.unitPrice) * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <footer className={styles.cardFoot}>
                    <span className={styles.subtotal}>
                      Subtotal <strong>{formatPrice(order.subtotal)}</strong>
                    </span>

                    <div className={styles.footActions}>
                      {step && !step.needsCode && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => advance(order)}
                          disabled={isPending}
                        >
                          {isPending ? 'Saving…' : step.label}
                        </button>
                      )}

                      {step && step.needsCode && !isCollecting && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setCollectingId(order.id);
                            setCodeDraft('');
                            setRowErrors((prev) => ({ ...prev, [order.id]: '' }));
                          }}
                        >
                          {step.label}
                        </button>
                      )}

                      {!step && <span className={styles.doneMark}>✓ Handed over</span>}

                      {/* Only completed orders: the server re-checks the status
                          and the outlet, and refuses anything else with a 409. */}
                      {canArchiveOrder(order.status) && (
                        <button
                          type="button"
                          className={`btn btn-ghost btn-sm ${styles.archiveBtn}`}
                          onClick={() => {
                            setArchiveError('');
                            setArchiveNotice('');
                            setArchiveTarget(order);
                          }}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </footer>

                  {step && step.needsCode && isCollecting && (
                    <form
                      className={styles.codeForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        advance(order, codeDraft.trim().toUpperCase());
                      }}
                    >
                      <label className={styles.codeFormLabel} htmlFor={`code-${order.id}`}>
                        Ask the customer for their pickup code
                      </label>
                      <div className={styles.codeFormRow}>
                        <input
                          id={`code-${order.id}`}
                          className={`form-input ${styles.codeInput}`}
                          value={codeDraft}
                          onChange={(event) => setCodeDraft(event.target.value)}
                          placeholder="e.g. QB3821"
                          maxLength={10}
                          autoComplete="off"
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={isPending || codeDraft.trim().length === 0}
                        >
                          {isPending ? 'Checking…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setCollectingId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {rowError && (
                    <p className={styles.rowError} role="alert">
                      {rowError}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {archiveTarget && (
          <ConfirmDialog
            title="Archive this order from the history?"
            message={`Order #${shortId(archiveTarget.orderId)} will disappear from this outlet's History tab.`}
            details={[
              'Every employee of this outlet stops seeing it in this list.',
              'The customer order, its items and the payment record are kept.',
              'The pickup code and its verification record are kept.',
              'Other outlets of a shared order are not affected.',
            ]}
            warning="Archiving is outlet-wide, not per employee."
            confirmLabel="Archive order"
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

export default EmployeeDashboardPage;
