/**
 * CartPage.jsx — Cart review before checkout.
 *
 * The cart can hold items from several outlets at once, so it is grouped per
 * outlet: each group shows what that kitchen will prepare, which is the unit
 * that gets its own pickup code after checkout.
 *
 * The cart itself lives in CartContext (persisted in Web Storage, keyed to the
 * signed-in account). Prices shown here are only
 * for display — the server recalculates every price from the database when the
 * order is placed and rejects anything the client tries to send.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import QuantityStepper from '../../components/common/QuantityStepper';
import SmartImage from '../../components/common/SmartImage';
import { formatPrice } from '../../utils/format';
import { groupByOutlet, subtotalOf } from '../../utils/cart';
import styles from './CartPage.module.css';

const CartPage = () => {
  const { items, removeItem, updateQuantity, cartCount, cartTotal, outletCount } = useCart();

  const groups = useMemo(() => groupByOutlet(items), [items]);

  // ── Empty cart ──
  if (items.length === 0) {
    return (
      <div className="page-content">
        <div className={`container ${styles.empty}`}>
          <span className={styles.emptyIcon} aria-hidden="true">
            🛒
          </span>
          <h1>Your cart is empty</h1>
          <p className={styles.emptyText}>
            Add dishes from any outlet in the food court — you can mix as many outlets as you like
            and pay once.
          </p>
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
          <h1>Your cart</h1>
          <p className={styles.pageMeta}>
            {cartCount} {cartCount === 1 ? 'item' : 'items'} from {outletCount}{' '}
            {outletCount === 1 ? 'outlet' : 'outlets'} — each outlet gets its own pickup code.
          </p>
        </header>

        <div className={styles.layout}>
          {/* ── Per-outlet groups ── */}
          <div className={styles.groups}>
            {groups.map((group) => {
              const groupSubtotal = subtotalOf(group.items);

              return (
                <section key={group.outletId} className={`card ${styles.group}`}>
                  <header className={styles.groupHead}>
                    <h2 className={styles.groupTitle}>
                      <Link to={`/outlet/${group.outletId}`}>{group.outletName}</Link>
                    </h2>
                    <span className={styles.groupMeta}>Prepared separately</span>
                  </header>

                  <ul className={styles.lines}>
                    {group.items.map((line) => (
                      <li key={line.menuItem.id} className={styles.line}>
                        <div className={styles.lineThumb}>
                          <SmartImage
                            src={line.menuItem.imageUrl}
                            alt=""
                            name={line.menuItem.name}
                            imgClassName={styles.lineThumbImg}
                            fallbackClassName={styles.lineThumbFallback}
                          />
                        </div>

                        <div className={styles.lineInfo}>
                          <h3 className={styles.lineName}>{line.menuItem.name}</h3>
                          <span className={styles.lineUnit}>
                            {formatPrice(line.menuItem.price)} each
                          </span>
                        </div>

                        <QuantityStepper
                          name={line.menuItem.name}
                          quantity={line.quantity}
                          onIncrease={() => updateQuantity(line.menuItem.id, line.quantity + 1)}
                          onDecrease={() => updateQuantity(line.menuItem.id, line.quantity - 1)}
                        />

                        <div className={styles.lineTotal}>
                          {formatPrice(Number(line.menuItem.price) * line.quantity)}
                        </div>

                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => removeItem(line.menuItem.id)}
                          aria-label={`Remove ${line.menuItem.name} from the cart`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>

                  <footer className={styles.groupFoot}>
                    <span>{group.outletName} subtotal</span>
                    <strong>{formatPrice(groupSubtotal)}</strong>
                  </footer>
                </section>
              );
            })}
          </div>

          {/* ── Summary ── */}
          <aside className={`card ${styles.summary}`}>
            <h2 className={styles.summaryTitle}>Order summary</h2>

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
                <dt>Payment</dt>
                <dd className={styles.summaryMuted}>Simulated at checkout</dd>
              </div>
              <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
                <dt>Total</dt>
                <dd>{formatPrice(cartTotal)}</dd>
              </div>
            </dl>

            <Link to="/checkout" className="btn btn-primary btn-lg">
              Proceed to checkout
            </Link>
            <Link to="/" className="btn btn-ghost">
              Add more items
            </Link>

            <p className={styles.summaryNote}>
              Final prices are recalculated from the menu when you place the order.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default CartPage;
