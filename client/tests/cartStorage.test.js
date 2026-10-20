/**
 * cartStorage tests — the persistence/scoping rules behind CartContext.
 *
 * These are pure functions, so they run without React: a fake storage object
 * stands in for the browser's localStorage.
 */

import { beforeEach, describe, expect, test } from 'vitest';
import {
  CART_STORAGE_PREFIX,
  GUEST_OWNER,
  MAX_STORED_LINES,
  cartStorageKey,
  mergeCartLines,
  normalizeItems,
  ownerForUser,
  readCart,
  removeCart,
  resolveOwnerItems,
  writeCart,
} from '../src/utils/cartStorage';

/** Minimal in-memory stand-in for window.localStorage. */
const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    has: (key) => map.has(key),
    size: () => map.size,
  };
};

/** Storage whose reads and writes always throw (e.g. blocked cookies). */
const brokenStorage = () => ({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
});

const line = (id, quantity, { price = '299.00', name = 'Fettuccine Alfredo', outletId = 'outlet-1' } = {}) => ({
  menuItem: { id, name, price, imageUrl: `${id}.jpg` },
  outletId,
  outletName: 'Pasta Point',
  quantity,
});

/** Same formula CartContext uses for the total. */
const totalOf = (items) => items.reduce((sum, i) => sum + parseFloat(i.menuItem.price) * i.quantity, 0);

const USER_A = { id: 'user-a', role: 'customer' };
const USER_B = { id: 'user-b', role: 'customer' };
const EMPLOYEE = { id: 'staff-1', role: 'employee' };

describe('ownerForUser', () => {
  test('scopes each account (and guests) to its own key', () => {
    expect(ownerForUser(null)).toBe(GUEST_OWNER);
    expect(ownerForUser(undefined)).toBe(GUEST_OWNER);
    expect(ownerForUser(USER_A)).toBe('user:user-a');
    expect(ownerForUser(USER_B)).toBe('user:user-b');
    expect(ownerForUser(EMPLOYEE)).toBe('user:staff-1');
    // No id (should not happen): still never the guest bucket.
    expect(ownerForUser({ role: 'customer' })).toBe('staff');
  });

  test('builds prefixed storage keys', () => {
    expect(cartStorageKey(GUEST_OWNER)).toBe(`${CART_STORAGE_PREFIX}guest`);
    expect(cartStorageKey('user:user-a')).toBe(`${CART_STORAGE_PREFIX}user:user-a`);
  });
});

describe('persistence and restoration', () => {
  test('round-trips items and quantities through storage', () => {
    const storage = fakeStorage();
    const items = [line('a', 2), line('b', 1, { name: 'Garlic Bread', price: '149.50' })];

    writeCart(storage, 'user:user-a', items);

    expect(storage.has(cartStorageKey('user:user-a'))).toBe(true);
    const restored = readCart(storage, 'user:user-a');

    expect(restored).toHaveLength(2);
    expect(restored.map((i) => i.menuItem.id)).toEqual(['a', 'b']);
    expect(restored.map((i) => i.quantity)).toEqual([2, 1]);
  });

  test('restored totals match the original cart', () => {
    const storage = fakeStorage();
    const items = [line('a', 3), line('b', 2, { price: '149.50' })];

    writeCart(storage, 'user:user-a', items);
    const restored = readCart(storage, 'user:user-a');

    expect(totalOf(restored)).toBe(totalOf(items));
    expect(totalOf(restored)).toBe(299 * 3 + 149.5 * 2);
  });

  test('stores prices as numbers without changing the total', () => {
    const storage = fakeStorage();
    writeCart(storage, 'user:user-a', [line('a', 1, { price: '299.00' })]);

    const restored = readCart(storage, 'user:user-a');
    expect(restored[0].menuItem.price).toBe(299);
    expect(totalOf(restored)).toBe(299);
  });

  test('an empty cart removes the entry instead of storing an empty array', () => {
    const storage = fakeStorage();
    writeCart(storage, 'user:user-a', [line('a', 1)]);
    expect(storage.size()).toBe(1);

    writeCart(storage, 'user:user-a', []);
    expect(storage.size()).toBe(0);
    expect(readCart(storage, 'user:user-a')).toEqual([]);

    removeCart(storage, 'user:user-a');
    expect(storage.size()).toBe(0);
  });

  test('each owner reads only its own cart', () => {
    const storage = fakeStorage();
    writeCart(storage, 'user:user-a', [line('a', 2)]);

    expect(readCart(storage, 'user:user-a')).toHaveLength(1);
    expect(readCart(storage, 'user:user-b')).toEqual([]);
    expect(readCart(storage, GUEST_OWNER)).toEqual([]);
  });
});

describe('missing or invalid stored data', () => {
  test('absent storage and absent values read as an empty cart', () => {
    expect(readCart(null, 'user:user-a')).toEqual([]);
    expect(readCart(fakeStorage(), 'user:user-a')).toEqual([]);

    const storage = fakeStorage();
    storage.setItem(cartStorageKey('user:user-a'), '');
    expect(readCart(storage, 'user:user-a')).toEqual([]);
  });

  test('corrupt JSON and non-array payloads are ignored', () => {
    const storage = fakeStorage();

    for (const raw of ['{not json', '{}{}', 'null', '"a string"', '42', '{}', '{"items":[]}']) {
      storage.setItem(cartStorageKey('user:user-a'), raw);
      expect(readCart(storage, 'user:user-a')).toEqual([]);
    }
  });

  test('malformed lines are dropped, valid ones kept', () => {
    const storage = fakeStorage();
    storage.setItem(
      cartStorageKey('user:user-a'),
      JSON.stringify([
        line('keep', 2),
        null,
        'nope',
        { menuItem: null, outletId: 'outlet-1', quantity: 1 },
        { menuItem: { id: 'x', price: '1.00' }, quantity: 1 }, // no outletId
        { ...line('x', 1), quantity: 0 }, // zero quantity
        { ...line('x', 1), quantity: -3 },
        { ...line('x', 1), quantity: 1.5 },
        { ...line('x', 1), quantity: 'two' },
        { ...line('x', 1), menuItem: { id: 'x', name: 'X', price: 'free' } },
        { ...line('x', 1), menuItem: { id: 'x', name: 'X', price: -5 } },
        { ...line('x', 1), menuItem: { id: '   ', name: 'X', price: '5.00' } },
      ])
    );

    const restored = readCart(storage, 'user:user-a');
    expect(restored).toHaveLength(1);
    expect(restored[0].menuItem.id).toBe('keep');
    expect(restored[0].quantity).toBe(2);
  });

  test('duplicate lines for one item are merged', () => {
    const items = normalizeItems([line('dup', 1), line('dup', 4)]);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(5);
  });

  test('unknown fields are stripped and names are made presentable', () => {
    const items = normalizeItems([
      { ...line('a', 1), extra: 'ignored', outletName: 42, menuItem: { id: 'a', name: '  ', price: '9.99', junk: true } },
    ]);

    expect(items[0].menuItem).toEqual({ id: 'a', name: 'Menu item', price: 9.99, imageUrl: '' });
    expect(items[0].outletName).toBe('');
    expect(items[0].extra).toBeUndefined();
  });

  test('an oversized payload is truncated rather than trusted', () => {
    const huge = Array.from({ length: MAX_STORED_LINES + 25 }, (_, i) => line(`item-${i}`, 1));
    expect(normalizeItems(huge)).toHaveLength(MAX_STORED_LINES);
  });

  test('storage that throws never breaks the cart', () => {
    const storage = brokenStorage();

    expect(readCart(storage, 'user:user-a')).toEqual([]);
    expect(() => writeCart(storage, 'user:user-a', [line('a', 1)])).not.toThrow();
    expect(() => removeCart(storage, 'user:user-a')).not.toThrow();
    expect(
      resolveOwnerItems(storage, {
        prevOwner: GUEST_OWNER,
        prevItems: [line('a', 1)],
        nextOwner: 'user:user-a',
        adoptGuest: true,
      })
    ).toHaveLength(1);
  });
});

describe('account switching', () => {
  let storage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  const adopt = (prevOwner, prevItems, nextOwner) =>
    resolveOwnerItems(storage, { prevOwner, prevItems, nextOwner, adoptGuest: true });

  test('a guest cart is adopted once when a customer signs in', () => {
    writeCart(storage, 'user:user-a', [line('existing', 1)]);
    const guestItems = [line('guest-1', 2), line('existing', 3)];

    const adopted = adopt(GUEST_OWNER, guestItems, 'user:user-a');

    // Own items stay put, guest lines are appended, shared items add up.
    expect(adopted.map((i) => [i.menuItem.id, i.quantity])).toEqual([
      ['existing', 4],
      ['guest-1', 2],
    ]);
    // The guest bucket is deleted so it cannot be adopted again.
    expect(storage.has(cartStorageKey(GUEST_OWNER))).toBe(false);
  });

  test('adopting twice does not duplicate the guest items', () => {
    const guestItems = [line('guest-1', 2)];
    writeCart(storage, GUEST_OWNER, guestItems);

    const first = adopt(GUEST_OWNER, guestItems, 'user:user-a');
    const second = adopt(GUEST_OWNER, guestItems, 'user:user-a');

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0].quantity).toBe(2);
  });

  test('signing out does not hand the account cart to the guest bucket', () => {
    const accountItems = [line('a', 2)];

    const guestView = resolveOwnerItems(storage, {
      prevOwner: 'user:user-a',
      prevItems: accountItems,
      nextOwner: GUEST_OWNER,
      adoptGuest: false,
    });

    expect(guestView).toEqual([]);
  });

  test('switching accounts shows each account only its own cart', () => {
    writeCart(storage, 'user:user-a', [line('a-only', 2)]);
    writeCart(storage, 'user:user-b', [line('b-only', 5)]);

    const forA = resolveOwnerItems(storage, {
      prevOwner: 'user:user-b',
      prevItems: [line('b-only', 5)],
      nextOwner: 'user:user-a',
      adoptGuest: false,
    });
    expect(forA.map((i) => i.menuItem.id)).toEqual(['a-only']);
    expect(forA[0].quantity).toBe(2);

    const forB = resolveOwnerItems(storage, {
      prevOwner: 'user:user-a',
      prevItems: forA,
      nextOwner: 'user:user-b',
      adoptGuest: false,
    });
    expect(forB.map((i) => [i.menuItem.id, i.quantity])).toEqual([['b-only', 5]]);
  });

  test('a customer cart is never adopted by the next staff account', () => {
    writeCart(storage, 'user:user-a', [line('a-only', 2)]);

    // Customer signs out, then an employee signs in (staff carts are not adopted
    // from the guest bucket either).
    const forEmployee = resolveOwnerItems(storage, {
      prevOwner: GUEST_OWNER,
      prevItems: [],
      nextOwner: 'user:staff-1',
      adoptGuest: false,
    });

    expect(forEmployee).toEqual([]);
    // And the customer's cart is still intact for their next sign-in.
    expect(readCart(storage, 'user:user-a')).toHaveLength(1);
  });

  test('returning to an account restores its cart after a reload', () => {
    writeCart(storage, 'user:user-a', [line('a-only', 3)]);

    // Fresh page load signed in as A: guest bucket is empty, A's own cart wins.
    const onReload = resolveOwnerItems(storage, {
      prevOwner: GUEST_OWNER,
      prevItems: [],
      nextOwner: 'user:user-a',
      adoptGuest: true,
    });

    expect(onReload.map((i) => [i.menuItem.id, i.quantity])).toEqual([['a-only', 3]]);
  });
});

describe('mergeCartLines', () => {
  test('adds quantities for the same item and keeps the original order', () => {
    const merged = mergeCartLines([line('a', 1), line('b', 2)], [line('b', 3), line('c', 1)]);

    expect(merged.map((i) => [i.menuItem.id, i.quantity])).toEqual([
      ['a', 1],
      ['b', 5],
      ['c', 1],
    ]);
  });
});
