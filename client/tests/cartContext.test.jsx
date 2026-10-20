/**
 * CartContext + CheckoutPage tests — persistence, restoration, account switching
 * and the checkout clear-on-success rule, exercised through React.
 *
 * A "page reload" is simulated by unmounting the tree and mounting a fresh one on
 * top of the same jsdom localStorage, which is exactly what a refresh does to the
 * old in-memory implementation.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CartProvider, useCart } from '../src/context/CartContext';
import CheckoutPage from '../src/pages/customer/CheckoutPage';
import { CART_STORAGE_PREFIX, cartStorageKey } from '../src/utils/cartStorage';

// ── Test doubles ──────────────────────────────────────────────────────────────
// The auth user is the only thing the tests need to control, and placeOrder is
// the only network call CheckoutPage makes.
let mockUser = null;
vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, isLoading: false, login: vi.fn(), register: vi.fn(), logout: vi.fn() }),
}));

const mockPlaceOrder = vi.fn();
vi.mock('../src/services/orderService', () => ({
  placeOrder: (...args) => mockPlaceOrder(...args),
}));

const CUSTOMER_A = { id: 'cart-user-a', role: 'customer', name: 'Customer A' };
const CUSTOMER_B = { id: 'cart-user-b', role: 'customer', name: 'Customer B' };
const EMPLOYEE = { id: 'cart-staff-1', role: 'employee', name: 'Staff' };

const OUTLET = { id: '22222222-2222-2222-2222-222222222222', name: 'Pasta Point' };
const ITEM_A = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Fettuccine Alfredo', price: '299.00', imageUrl: 'a.jpg' };
const ITEM_B = { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'Garlic Bread', price: '149.50', imageUrl: 'b.jpg' };

const TOTAL_A2_B1 = 299 * 2 + 149.5;

/** Small consumer of the cart so tests can read and change it. */
const Harness = () => {
  const cart = useCart();
  return (
    <div>
      <span data-testid="count">{cart.cartCount}</span>
      <span data-testid="total">{cart.cartTotal}</span>
      <span data-testid="outlets">{cart.outletCount}</span>
      <ul data-testid="lines">
        {cart.items.map((line) => (
          <li key={line.menuItem.id}>{`${line.menuItem.name} x${line.quantity}`}</li>
        ))}
      </ul>
      <button type="button" onClick={() => cart.addItem(ITEM_A, OUTLET.id, OUTLET.name)}>
        add-a
      </button>
      <button type="button" onClick={() => cart.addItem(ITEM_B, OUTLET.id, OUTLET.name)}>
        add-b
      </button>
      <button type="button" onClick={() => cart.updateQuantity(ITEM_A.id, 3)}>
        qty-3
      </button>
      <button type="button" onClick={cart.clearCart}>
        clear
      </button>
    </div>
  );
};

const renderCart = () =>
  render(
    <CartProvider>
      <Harness />
    </CartProvider>
  );

const withCheckout = () =>
  render(
    <MemoryRouter>
      <CartProvider>
        <Harness />
        <CheckoutPage />
      </CartProvider>
    </MemoryRouter>
  );

const readCount = () => Number(screen.getByTestId('count').textContent);
const readTotal = () => Number(screen.getByTestId('total').textContent);
const readLineLabels = () => [...screen.getByTestId('lines').querySelectorAll('li')].map((li) => li.textContent);
const storedCart = (owner) => localStorage.getItem(cartStorageKey(owner));
const cartKeys = () => Object.keys(localStorage).filter((key) => key.startsWith(CART_STORAGE_PREFIX));

/** Reload the page: tear the tree down and mount a fresh one. */
const reload = () => {
  cleanup();
  renderCart();
};

beforeEach(() => {
  localStorage.clear();
  mockUser = null;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

// ── Persistence and restoration ───────────────────────────────────────────────

test('restores items, quantities and totals after a reload', () => {
  mockUser = CUSTOMER_A;
  renderCart();

  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-b'));

  expect(readCount()).toBe(3);
  expect(readTotal()).toBe(TOTAL_A2_B1);
  expect(readLineLabels()).toEqual(['Fettuccine Alfredo x2', 'Garlic Bread x1']);

  // A refresh used to empty the cart — it must come back exactly as it was.
  reload();

  expect(readCount()).toBe(3);
  expect(readTotal()).toBe(TOTAL_A2_B1);
  expect(readLineLabels()).toEqual(['Fettuccine Alfredo x2', 'Garlic Bread x1']);
  expect(readTotal()).toBe(299 * 2 + 149.5);
});

test('survives repeated reloads and quantity changes', () => {
  mockUser = CUSTOMER_A;
  renderCart();

  fireEvent.click(screen.getByText('add-a'));
  reload();
  expect(readCount()).toBe(1);

  fireEvent.click(screen.getByText('qty-3'));
  reload();
  expect(readCount()).toBe(3);
  expect(readTotal()).toBe(299 * 3);

  fireEvent.click(screen.getByText('clear'));
  expect(cartKeys()).toEqual([]);
  reload();
  expect(readCount()).toBe(0);
});

test('keeps a guest cart across a reload too', () => {
  renderCart();

  fireEvent.click(screen.getByText('add-a'));
  expect(readCount()).toBe(1);
  expect(storedCart('guest')).not.toBeNull();

  reload();
  expect(readCount()).toBe(1);
  expect(readLineLabels()).toEqual(['Fettuccine Alfredo x1']);
});

// ── Account switching ─────────────────────────────────────────────────────────

test('does not show one account the cart of another', () => {
  mockUser = CUSTOMER_A;
  renderCart();
  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-b'));
  expect(readCount()).toBe(2);

  // Customer B signs in on the same browser.
  cleanup();
  mockUser = CUSTOMER_B;
  renderCart();
  expect(readCount()).toBe(0);
  expect(readLineLabels()).toEqual([]);

  // An employee signs in — the cart UI is hidden for staff, and the bucket is
  // empty rather than someone else's cart.
  cleanup();
  mockUser = EMPLOYEE;
  renderCart();
  expect(readCount()).toBe(0);

  // Customer A signs back in and gets their own cart back.
  cleanup();
  mockUser = CUSTOMER_A;
  renderCart();
  expect(readCount()).toBe(2);
  expect(readLineLabels()).toEqual(['Fettuccine Alfredo x1', 'Garlic Bread x1']);

  // Customer B never saw A's items.
  cleanup();
  mockUser = CUSTOMER_B;
  renderCart();
  expect(readCount()).toBe(0);
});

test('signing out does not leave the customer cart for the next guest', () => {
  mockUser = CUSTOMER_A;
  renderCart();
  fireEvent.click(screen.getByText('add-a'));
  expect(readCount()).toBe(1);

  cleanup();
  mockUser = null;
  renderCart();

  expect(readCount()).toBe(0);
  expect(storedCart('guest')).toBeNull();
  // The account's own cart is untouched, ready for their next sign-in.
  expect(storedCart('user:cart-user-a')).not.toBeNull();
});

test('adopts a guest cart when a customer signs in, exactly once', () => {
  renderCart();
  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-a'));
  expect(readCount()).toBe(2);

  cleanup();
  mockUser = CUSTOMER_A;
  renderCart();
  expect(readCount()).toBe(2);

  // The guest bucket is gone, so it cannot be adopted again or leak onwards.
  expect(storedCart('guest')).toBeNull();
  expect(storedCart('user:cart-user-a')).not.toBeNull();

  reload();
  expect(readCount()).toBe(2);

  cleanup();
  mockUser = null;
  renderCart();
  expect(readCount()).toBe(0);
});

test('an employee sign-in does not adopt the guest cart', () => {
  renderCart();
  fireEvent.click(screen.getByText('add-a'));

  cleanup();
  mockUser = EMPLOYEE;
  renderCart();

  expect(readCount()).toBe(0);
  // Still available for a customer sign-in.
  expect(storedCart('guest')).not.toBeNull();
});

test('an employee cannot add items to a cart', () => {
  mockUser = EMPLOYEE;
  renderCart();

  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-b'));

  expect(readCount()).toBe(0);
  expect(readLineLabels()).toEqual([]);
  expect(storedCart('user:cart-staff-1')).toBeNull();
});

// ── Checkout: clear only on success ───────────────────────────────────────────

test('clears the cart after a successful checkout', async () => {
  mockUser = CUSTOMER_A;
  mockPlaceOrder.mockResolvedValue({ orderId: 'order-1', orderStatus: 'pending' });

  withCheckout();
  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-a'));
  expect(readCount()).toBe(2);

  fireEvent.click(screen.getByRole('button', { name: /place order/i }));

  await waitFor(() => expect(mockPlaceOrder).toHaveBeenCalledTimes(1));
  expect(mockPlaceOrder).toHaveBeenCalledWith(
    [{ menuItemId: ITEM_A.id, quantity: 2 }],
    { method: 'card' }
  );

  await waitFor(() => expect(readCount()).toBe(0));
  expect(cartKeys()).toEqual([]);
});

test('keeps the cart when checkout fails', async () => {
  mockUser = CUSTOMER_A;
  mockPlaceOrder.mockRejectedValue(new Error('Fettuccine Alfredo is currently unavailable.'));

  withCheckout();
  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-a'));
  fireEvent.click(screen.getByText('add-b'));

  fireEvent.click(screen.getByRole('button', { name: /place order/i }));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('currently unavailable');

  // Nothing was created, so nothing may be thrown away.
  expect(readCount()).toBe(3);
  expect(readLineLabels()).toEqual(['Fettuccine Alfredo x2', 'Garlic Bread x1']);

  const persisted = JSON.parse(storedCart('user:cart-user-a'));
  expect(persisted).toHaveLength(2);
  expect(persisted[0].quantity).toBe(2);

  // And the cart is still there after a reload.
  reload();
  expect(readCount()).toBe(3);
});
