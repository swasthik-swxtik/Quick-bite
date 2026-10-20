/**
 * OutletMenuPage.jsx — A single outlet's menu.
 *
 * Data comes from GET /api/outlets/:id/menu (public), which returns
 * { outlet, items }. Items are added to the cart (CartContext, persisted in Web
 * Storage and scoped to the signed-in user), which the navbar badge and the
 * sticky summary bar reflect immediately.
 *
 * Unavailable items are listed but cannot be added (the API returns them with
 * isAvailable: false).
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as outletService from '../../services/outletService';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { canShopAs, isStaffAs } from '../../utils/session';
import SmartImage from '../../components/common/SmartImage';
import QuantityStepper from '../../components/common/QuantityStepper';
import { formatPrice } from '../../utils/format';
import styles from './OutletMenuPage.module.css';

const OutletMenuPage = () => {
  const { id } = useParams();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { items: cartItems, addItem, updateQuantity, cartCount, cartTotal, outletCount } = useCart();

  // A known role wins over the startup loading flag: a customer signed in on
  // this tab may be known while the initial session check is still in flight.
  const canShop = canShopAs(user, isAuthLoading);
  const isStaff = isStaffAs(user);
  const dashboardPath = user?.role === 'admin' ? '/admin' : '/employee/dashboard';

  const [outlet, setOutlet] = useState(null);
  const [menuItems, setMenuItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadMenu = async () => {
      setIsLoading(true);
      setError('');
      try {
        const data = await outletService.getOutletMenu(id);
        if (cancelled) return;
        setOutlet(data.outlet);
        setMenuItems(data.items || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadMenu();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** How many of this menu item are already in the cart. */
  const quantityOf = (menuItemId) => {
    const line = cartItems.find((i) => i.menuItem.id === menuItemId);
    return line ? line.quantity : 0;
  };

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="page-content">
        <div className={styles.stateBox}>
          <div className="spinner" />
          <p>Loading menu…</p>
        </div>
      </div>
    );
  }

  // ── Error / not found ──
  if (error) {
    return (
      <div className="page-content">
        <div className={`container ${styles.stateBox}`} role="alert">
          <h2 className={styles.errorTitle}>We couldn't load this outlet</h2>
          <p className={styles.errorDetail}>{error}</p>
          <Link to="/" className="btn btn-primary">
            Back to all outlets
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`page-content ${canShop && cartCount > 0 ? styles.withSummaryBar : ''}`}>
      {/* ── Outlet header ── */}
      <section className={`container ${styles.header}`}>
        <Link to="/" className={styles.backLink}>
          ← All outlets
        </Link>

        <div className={styles.headerCard}>
          <div className={styles.headerImageWrap}>
            <SmartImage
              src={outlet?.imageUrl}
              alt=""
              name={outlet?.name || ''}
              imgClassName={styles.headerImage}
              fallbackClassName={styles.headerImageFallback}
            />
          </div>

          <div className={styles.headerBody}>
            {outlet?.cuisineType && (
              <span className={`badge badge-confirmed ${styles.cuisineBadge}`}>
                {outlet.cuisineType}
              </span>
            )}
            <h1 className={styles.headerTitle}>{outlet?.name}</h1>
            {outlet?.description && <p className={styles.headerText}>{outlet.description}</p>}
            {outlet?.counterInfo && (
              <p className={styles.counter}>
                <span aria-hidden="true">📍</span> {outlet.counterInfo}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Menu ── */}
      <section className={`container ${styles.menuSection}`}>
        <h2 className={styles.menuHeading}>Menu</h2>

        {isStaff && (
          <div className={`alert alert-info ${styles.shopNotice}`} role="status">
            <strong>Shopping cart is available to customer accounts only.</strong>{' '}
            You can still browse the menu.{' '}
            <Link to={dashboardPath}>Go to your dashboard</Link>
          </div>
        )}

        {menuItems.length === 0 ? (
          <div className={styles.stateBox}>
            <p>This outlet hasn't published any dishes yet.</p>
          </div>
        ) : (
          <ul className={styles.menuList}>
            {menuItems.map((item) => {
              const quantity = quantityOf(item.id);
              const available = item.isAvailable !== false;

              return (
                <li
                  key={item.id}
                  className={`${styles.menuRow} ${available ? '' : styles.menuRowDisabled}`}
                >
                  <div className={styles.menuThumb}>
                    <SmartImage
                      src={item.imageUrl}
                      alt=""
                      name={item.name}
                      imgClassName={styles.menuThumbImg}
                      fallbackClassName={styles.menuThumbFallback}
                    />
                  </div>

                  <div className={styles.menuInfo}>
                    <div className={styles.menuTitleRow}>
                      <h3 className={styles.menuName}>{item.name}</h3>
                      {!available && <span className="badge badge-collected">Unavailable</span>}
                    </div>
                    {item.description && <p className={styles.menuDesc}>{item.description}</p>}
                    <span className={styles.menuPrice}>{formatPrice(item.price)}</span>
                  </div>

                  <div className={styles.menuAction}>
                    {!canShop ? (
                      isStaff ? (
                        <span className={styles.staffNote}>Customer accounts only</span>
                      ) : null
                    ) : quantity === 0 ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => addItem(item, outlet.id, outlet.name)}
                        disabled={!available}
                      >
                        Add
                      </button>
                    ) : (
                      <QuantityStepper
                        name={item.name}
                        quantity={quantity}
                        onIncrease={() => updateQuantity(item.id, quantity + 1)}
                        onDecrease={() => updateQuantity(item.id, quantity - 1)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Sticky cart summary ── */}
      {canShop && cartCount > 0 && (
        <div className={styles.summaryBar}>
          <div className={`container ${styles.summaryInner}`}>
            <div>
              <strong className={styles.summaryCount}>
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </strong>
              <span className={styles.summaryMeta}>
                from {outletCount} {outletCount === 1 ? 'outlet' : 'outlets'} · {formatPrice(cartTotal)}
              </span>
            </div>
            <Link to="/cart" className="btn btn-primary">
              View cart
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutletMenuPage;
