/**
 * cartStorage.js — Persistence for the cart.
 *
 * The cart used to live only in React state, so any full document load — a
 * refresh, opening the app in a new tab, or Vite's HMR reload in development —
 * threw it away. These helpers keep it in Web Storage and scope it to whoever is
 * signed in:
 *
 *   quickbite:cart:v1:guest      → items added while signed out
 *   quickbite:cart:v1:user:<id>  → that account's own cart
 *
 * Guests and every account get their own bucket, so switching accounts in one
 * browser can never show one person's cart to another. When a guest signs in as
 * a customer their cart is adopted once, and the guest bucket is deleted so it
 * cannot leak into the next person's session.
 *
 * Everything here is framework-free and defensive: storage may be missing or
 * throw (private browsing, blocked cookies), and the stored JSON may be corrupt
 * or hand-edited, so reads always return a valid cart array — worst case empty.
 */

export const CART_STORAGE_PREFIX = 'quickbite:cart:v1:';
export const GUEST_OWNER = 'guest';

/** Bound on what we will restore, so a hand-edited blob cannot blow up the UI. */
export const MAX_STORED_LINES = 100;

/** Storage key for one owner: `guest` or `user:<id>`. */
export const cartStorageKey = (owner) => `${CART_STORAGE_PREFIX}${owner}`;

/**
 * Which bucket a session's cart belongs to.
 *
 * Signed out → the guest bucket. Signed in → their own bucket, keyed by user id,
 * so two accounts sharing a browser never share a cart.
 *
 * @param {{ id?: string, role?: string }|null|undefined} user
 */
export const ownerForUser = (user) => {
  if (!user) return GUEST_OWNER;
  // A staff account without an id still gets a bucket of its own rather than
  // falling back to the guest one.
  return user.id ? `user:${user.id}` : 'staff';
};

/** Non-empty string id, or null. */
const asId = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** Finite, non-negative price, or null. */
const asPrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

/**
 * Coerce arbitrary parsed JSON into valid cart lines.
 *
 * Anything unrecognisable is dropped rather than trusted: a corrupt or
 * hand-edited entry must never break the cart, the totals, or checkout. Duplicate
 * menu item ids are merged, and only the fields the cart actually renders are
 * kept.
 *
 * @param {unknown} value
 * @returns {Array<{ menuItem: object, outletId: string, outletName: string, quantity: number }>}
 */
export const normalizeItems = (value) => {
  if (!Array.isArray(value)) return [];

  const lines = new Map();

  for (const raw of value.slice(0, MAX_STORED_LINES)) {
    if (!raw || typeof raw !== 'object') continue;

    const item = raw.menuItem;
    if (!item || typeof item !== 'object') continue;

    const id = asId(item.id);
    const outletId = asId(raw.outletId);
    const price = asPrice(item.price);
    const quantity = Number(raw.quantity);

    if (!id || !outletId || price === null) continue;
    if (!Number.isInteger(quantity) || quantity < 1) continue;

    const existing = lines.get(id);
    if (existing) {
      existing.quantity += quantity;
      continue;
    }

    lines.set(id, {
      menuItem: {
        id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Menu item',
        price,
        imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : '',
      },
      outletId,
      outletName: typeof raw.outletName === 'string' ? raw.outletName : '',
      quantity,
    });
  }

  return [...lines.values()];
};

/**
 * Merge `incoming` lines into `base`, adding quantities for the same item.
 * Order is preserved (base first, then new items).
 */
export const mergeCartLines = (base, incoming) => {
  const merged = [...base];

  for (const line of incoming) {
    const existing = merged.find((l) => l.menuItem.id === line.menuItem.id);
    if (existing) existing.quantity += line.quantity;
    else merged.push({ ...line });
  }

  return merged;
};

/** Read one owner's cart. Never throws; returns [] when absent or unusable. */
export const readCart = (storage, owner) => {
  if (!storage) return [];

  try {
    const raw = storage.getItem(cartStorageKey(owner));
    if (!raw) return [];
    return normalizeItems(JSON.parse(raw));
  } catch {
    // Unreadable storage or corrupt JSON — start from an empty cart.
    return [];
  }
};

/**
 * Write one owner's cart. An empty cart removes the entry instead of storing an
 * empty array, so signing out (or checking out) leaves nothing behind.
 */
export const writeCart = (storage, owner, items) => {
  if (!storage) return;

  try {
    if (!Array.isArray(items) || items.length === 0) {
      storage.removeItem(cartStorageKey(owner));
      return;
    }
    storage.setItem(cartStorageKey(owner), JSON.stringify(items));
  } catch {
    // Quota exceeded or storage disabled — the cart still works in memory.
  }
};

/** Forget one owner's cart entirely. */
export const removeCart = (storage, owner) => {
  if (!storage) return;

  try {
    storage.removeItem(cartStorageKey(owner));
  } catch {
    // Nothing to do.
  }
};

/**
 * The cart lines to show after the signed-in identity changes.
 *
 * - same owner → keep what is on screen (no state churn)
 * - guest signing in as a customer → adopt the guest cart into their own, and
 *   delete the guest bucket so it can never appear for anyone else
 * - anything else (sign out, account switch, staff) → that owner's own cart
 *
 * @param {Storage|null} storage
 * @param {{ prevOwner: string, prevItems: Array, nextOwner: string, adoptGuest: boolean }} args
 */
export const resolveOwnerItems = (storage, { prevOwner, prevItems, nextOwner, adoptGuest }) => {
  if (prevOwner === nextOwner) return prevItems;

  if (adoptGuest && prevOwner === GUEST_OWNER) {
    const own = readCart(storage, nextOwner);
    const adopted = mergeCartLines(own, prevItems);
    removeCart(storage, GUEST_OWNER);
    return adopted;
  }

  return readCart(storage, nextOwner);
};
