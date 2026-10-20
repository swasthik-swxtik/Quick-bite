/**
 * Navbar.jsx — Global top navigation.
 *
 * Mounted once in App.jsx so it appears on every route. It is fixed to the top
 * of the viewport; pages reserve its height via the `.page-content` class
 * (which uses the --navbar-height design token).
 *
 * Contents:
 *  - brand → home
 *  - "Browse outlets" link
 *  - "My orders" link for signed-in customers
 *  - dashboard link for staff (employee/admin)
 *  - cart link with a live item-count badge (customers and guests only)
 *  - auth area: signed-in name + sign out, or sign in / sign up
 *
 * Below 860px the links collapse behind a toggle button.
 */

import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import styles from './Navbar.module.css';

/** Where each staff role's dashboard lives (customers have none). */
const dashboardPathFor = (role) => {
  if (role === 'admin') return '/admin';
  if (role === 'employee') return '/employee/dashboard';
  return null;
};

const Navbar = () => {
  const { user, logout } = useAuth();
  const { cartCount } = useCart();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Close the collapsed menu from the event that causes navigation
  const closeMenu = () => setMenuOpen(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      navigate('/', { replace: true });
    } finally {
      setSigningOut(false);
      closeMenu();
    }
  };

  const linkClass = ({ isActive }) =>
    isActive ? `${styles.link} ${styles.linkActive}` : styles.link;

  const dashboardPath = user ? dashboardPathFor(user.role) : null;
  // The cart is a customer feature; staff never order anything
  const showCart = !user || user.role === 'customer';

  return (
    <header className={styles.navbar}>
      <div className={`container ${styles.inner}`}>
        <Link to="/" className={styles.brand}>
          <span aria-hidden="true">🍽️</span>
          <span className="gradient-text">QuickBite</span>
        </Link>

        <button
          type="button"
          className={styles.toggle}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className={styles.toggleBar} />
          <span className={styles.toggleBar} />
          <span className={styles.toggleBar} />
        </button>

        <nav
          id="primary-navigation"
          className={`${styles.nav} ${menuOpen ? styles.navOpen : ''}`}
        >
          <NavLink to="/" end className={linkClass} onClick={closeMenu}>
            Browse outlets
          </NavLink>

          {dashboardPath && (
            <NavLink to={dashboardPath} className={linkClass} onClick={closeMenu}>
              Dashboard
            </NavLink>
          )}

          {user?.role === 'customer' && (
            <NavLink to="/orders" className={linkClass} onClick={closeMenu}>
              My orders
            </NavLink>
          )}

          {showCart && (
            <Link
              to="/cart"
              className={styles.cartLink}
              onClick={closeMenu}
              aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
            >
              <span aria-hidden="true">🛒</span>
              <span>Cart</span>
              {cartCount > 0 && <span className={styles.cartBadge}>{cartCount}</span>}
            </Link>
          )}

          {user ? (
            <div className={styles.userArea}>
              <span className={styles.userName} title={user.email}>
                {user.name}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : (
            <div className={styles.authArea}>
              <Link to="/login" className="btn btn-secondary btn-sm" onClick={closeMenu}>
                Sign in
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm" onClick={closeMenu}>
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Navbar;
