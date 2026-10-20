/**
 * CartContext.jsx — Global shopping cart state.
 *
 * The cart is mirrored into Web Storage (see utils/cartStorage.js) so it survives
 * navigation AND a full page load, and it is scoped to the signed-in identity:
 * a guest cart, then one bucket per account. Switching accounts in the same
 * browser therefore never shows one person's cart to another. The cart is only
 * cleared when checkout succeeds (CheckoutPage calls clearCart after the order
 * has been created), never on a failed checkout.
 *
 * Provides:
 *  - items: [{ menuItem, outletId, outletName, quantity }]
 *  - addItem(menuItem, outletId, outletName): add or increment
 *  - removeItem(menuItemId): remove entirely
 *  - updateQuantity(menuItemId, quantity): set exact quantity
 *  - clearCart(): empty the cart after checkout
 *  - cartTotal: sum of all item prices
 *  - cartCount: total number of individual items
 *  - outletCount: number of distinct outlets in the cart
 */

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from './AuthContext';
import { canShopAs } from '../utils/session';
import {
  GUEST_OWNER,
  ownerForUser,
  readCart,
  writeCart,
  resolveOwnerItems,
} from '../utils/cartStorage';

const CartContext = createContext(null);

/**
 * The browser's persistent storage, or null where it is unavailable (private
 * browsing, blocked cookies, non-browser environments). Reading the property can
 * itself throw, so it is guarded.
 */
const browserStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const CartProvider = ({ children }) => {
  const { user, isLoading } = useAuth();
  const owner = ownerForUser(user);

  // Shopping is a customer feature. Guests may build a cart before signing in;
  // staff accounts may not add anything, even if a stale staff bucket exists.
  // A known role wins over the startup loading flag (see canShopAs).
  const canShop = canShopAs(user, isLoading);

  const [storage] = useState(browserStorage);

  // The items and the bucket they belong to move together, so a write can never
  // save one account's cart under another account's key.
  const [cart, setCart] = useState(() => ({
    owner: GUEST_OWNER,
    items: readCart(storage, GUEST_OWNER),
  }));

  // Lets the identity effect see the current cart without re-running on every
  // cart change.
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  /** Apply a change to the items, keeping the owner they belong to. */
  const updateItems = useCallback((updater) => {
    setCart((prev) => ({ ...prev, items: updater(prev.items) }));
  }, []);

  // ── Follow the signed-in identity ─────────────────────────────────────────
  // Signed out → guest cart. Signing in as a customer adopts the guest cart once
  // (so a cart built before logging in is not lost); any other switch loads that
  // account's own cart.
  useEffect(() => {
    const prev = cartRef.current;
    if (prev.owner === owner) return;

    const next = {
      owner,
      items: resolveOwnerItems(storage, {
        prevOwner: prev.owner,
        prevItems: prev.items,
        nextOwner: owner,
        adoptGuest: prev.owner === GUEST_OWNER && user?.role === 'customer',
      }),
    };

    cartRef.current = next;
    setCart(next);
  }, [owner, user?.role, storage]);

  // ── Persist ───────────────────────────────────────────────────────────────
  // Keyed by the pair in state, so it always writes under the right owner. The
  // guard skips the commit in which the identity effect is mid-switch, so the
  // outgoing cart (e.g. an adopted guest cart) is never written back.
  useEffect(() => {
    if (cartRef.current !== cart) return;
    writeCart(storage, cart.owner, cart.items);
  }, [storage, cart]);

  const { items } = cart;

  /**
   * Add a menu item to the cart.
   * If the item already exists, increment its quantity.
   * Staff accounts are refused before the state is touched.
   */
  const addItem = useCallback((menuItem, outletId, outletName) => {
    if (!canShop) return;

    updateItems((prev) => {
      const existing = prev.find((i) => i.menuItem.id === menuItem.id);
      if (existing) {
        return prev.map((i) =>
          i.menuItem.id === menuItem.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [...prev, { menuItem, outletId, outletName, quantity: 1 }];
    });
  }, [canShop, updateItems]);

  /**
   * Remove a menu item from the cart entirely.
   */
  const removeItem = useCallback((menuItemId) => {
    updateItems((prev) => prev.filter((i) => i.menuItem.id !== menuItemId));
  }, [updateItems]);

  /**
   * Set the exact quantity for a menu item.
   * If quantity is 0 or less, removes the item.
   */
  const updateQuantity = useCallback((menuItemId, quantity) => {
    if (quantity <= 0) {
      updateItems((prev) => prev.filter((i) => i.menuItem.id !== menuItemId));
    } else {
      updateItems((prev) =>
        prev.map((i) =>
          i.menuItem.id === menuItemId ? { ...i, quantity } : i
        )
      );
    }
  }, [updateItems]);

  const clearCart = useCallback(() => updateItems(() => []), [updateItems]);

  // Derived values — recalculated only when items change
  const cartTotal = useMemo(
    () => items.reduce((sum, i) => sum + parseFloat(i.menuItem.price) * i.quantity, 0),
    [items]
  );

  const cartCount = useMemo(
    () => items.reduce((sum, i) => sum + i.quantity, 0),
    [items]
  );

  const outletCount = useMemo(
    () => new Set(items.map((i) => i.outletId)).size,
    [items]
  );

  return (
    <CartContext.Provider
      value={{ items, addItem, removeItem, updateQuantity, clearCart, cartTotal, cartCount, outletCount }}
    >
      {children}
    </CartContext.Provider>
  );
};

/**
 * useCart — convenience hook.
 */
export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
};
