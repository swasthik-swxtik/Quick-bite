/**
 * Employee shopping UX.
 *
 * Staff may browse outlet menus, but they must never get shopping controls.
 * The customer-only cart/checkout routes must explain the account rule instead
 * of rendering the generic 403 page or mounting the customer page.
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from '../src/context/CartContext';
import OutletMenuPage from '../src/pages/customer/OutletMenuPage';
import CustomerOnlyRoute from '../src/components/common/CustomerOnlyRoute';

let mockUser = null;
let mockIsLoading = false;

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isLoading: mockIsLoading,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

const mockGetOutletMenu = vi.fn();
vi.mock('../src/services/outletService', () => ({
  getOutletMenu: (...args) => mockGetOutletMenu(...args),
}));

const EMPLOYEE = {
  id: 'employee-1',
  name: 'Pizza Staff',
  email: 'pizza@quickbite.com',
  role: 'employee',
  outletId: 'outlet-1',
};
const ADMIN = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@quickbite.com',
  role: 'admin',
};
const CUSTOMER = {
  id: 'customer-1',
  name: 'Customer',
  email: 'customer@example.com',
  role: 'customer',
};

const OUTLET = {
  id: 'outlet-1',
  name: 'Pizza Palace',
  description: 'Fresh pizza',
  counterInfo: 'Counter 1',
};
const ITEM = {
  id: 'item-1',
  name: 'Margherita Pizza',
  description: 'Tomato and mozzarella',
  price: '299.00',
  isAvailable: true,
};

const renderMenu = (outletId = 'outlet-1') =>
  render(
    <MemoryRouter initialEntries={[`/outlet/${outletId}`]}>
      <CartProvider>
        <Routes>
          <Route path="/outlet/:id" element={<OutletMenuPage />} />
          <Route path="/employee/dashboard" element={<p>employee dashboard page</p>} />
          <Route path="/admin" element={<p>admin dashboard page</p>} />
          <Route path="/cart" element={<p>customer cart page</p>} />
        </Routes>
      </CartProvider>
    </MemoryRouter>
  );

const renderGuarded = (path, withCartLink = false) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      {withCartLink && <Link to="/cart">Cart</Link>}
      <Routes>
        <Route element={<CustomerOnlyRoute />}>
          <Route path="/cart" element={<p>customer cart page</p>} />
          <Route path="/checkout" element={<p>customer checkout page</p>} />
        </Route>
        <Route path="/employee/dashboard" element={<p>employee dashboard page</p>} />
        <Route path="/admin" element={<p>admin dashboard page</p>} />
        <Route path="/login" element={<p>customer login page</p>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  mockUser = null;
  mockIsLoading = false;
  vi.clearAllMocks();
  mockGetOutletMenu.mockResolvedValue({ outlet: OUTLET, items: [ITEM] });
});

afterEach(() => {
  cleanup();
});

// ── Outlet menu ──────────────────────────────────────────────────────────────

test('employees can browse the menu but get no cart controls', async () => {
  mockUser = EMPLOYEE;
  renderMenu();

  expect(await screen.findByText('Margherita Pizza')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^add$/i })).toBeNull();
  expect(screen.getByText(/shopping cart is available to customer accounts only/i)).toBeTruthy();
  expect(screen.getByText('Customer accounts only')).toBeTruthy();
  expect(screen.getByRole('link', { name: /go to your dashboard/i }).getAttribute('href')).toBe(
    '/employee/dashboard'
  );
});

test('admins can browse the menu read-only and are pointed at the admin dashboard', async () => {
  mockUser = ADMIN;
  renderMenu();

  expect(await screen.findByText('Margherita Pizza')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^add$/i })).toBeNull();
  expect(screen.getByText(/shopping cart is available to customer accounts only/i)).toBeTruthy();
  expect(screen.getByRole('link', { name: /go to your dashboard/i }).getAttribute('href')).toBe(
    '/admin'
  );
});

test('customers can add, change quantity, and remove items', async () => {
  mockUser = CUSTOMER;
  renderMenu();

  const add = await screen.findByRole('button', { name: /^add$/i });
  fireEvent.click(add);

  expect(screen.getByText('1 item')).toBeTruthy();
  expect(screen.getByRole('link', { name: /view cart/i }).getAttribute('href')).toBe('/cart');
  expect(screen.queryByText(/shopping cart is available to customer accounts only/i)).toBeNull();

  // Quantity controls work normally for a customer.
  fireEvent.click(screen.getByRole('button', { name: /add another margherita pizza/i }));
  expect(screen.getByText('2 items')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /remove one margherita pizza/i }));
  fireEvent.click(screen.getByRole('button', { name: /remove one margherita pizza/i }));
  expect(screen.getByRole('button', { name: /^add$/i })).toBeTruthy();
});

test('a known customer keeps shopping controls while auth is still restoring', async () => {
  mockUser = CUSTOMER;
  mockIsLoading = true;
  renderMenu();

  const add = await screen.findByRole('button', { name: /^add$/i });
  fireEvent.click(add);

  expect(screen.getByText('1 item')).toBeTruthy();
  expect(screen.queryByText(/shopping cart is available to customer accounts only/i)).toBeNull();
});

test('a known employee stays read-only while auth is still restoring', async () => {
  mockUser = EMPLOYEE;
  mockIsLoading = true;
  renderMenu();

  expect(await screen.findByText('Margherita Pizza')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^add$/i })).toBeNull();
  expect(screen.getByText(/shopping cart is available to customer accounts only/i)).toBeTruthy();
  expect(screen.getByText('Customer accounts only')).toBeTruthy();
});

test('guests can still build a cart before signing in', async () => {
  renderMenu();

  const add = await screen.findByRole('button', { name: /^add$/i });
  fireEvent.click(add);

  expect(screen.getByText('1 item')).toBeTruthy();
  expect(screen.getByRole('link', { name: /view cart/i })).toBeTruthy();
});

test('the shared menu component gives a customer controls at another outlet', async () => {
  mockUser = CUSTOMER;
  mockGetOutletMenu.mockResolvedValue({
    outlet: { ...OUTLET, id: 'outlet-2', name: 'Burger Barn' },
    items: [{ ...ITEM, id: 'item-2', name: 'Classic Burger' }],
  });

  renderMenu('outlet-2');

  expect(await screen.findByText('Classic Burger')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^add$/i })).toBeTruthy();
  expect(screen.getByText('Burger Barn')).toBeTruthy();
});

// ── Customer-only routes ─────────────────────────────────────────────────────

test('an employee following a cart link gets the friendly account notice', async () => {
  mockUser = EMPLOYEE;
  renderGuarded('/', true);

  fireEvent.click(screen.getByRole('link', { name: /^cart$/i }));

  expect(
    await screen.findByRole('heading', {
      name: /shopping cart is available to customer accounts only/i,
    })
  ).toBeTruthy();
  expect(screen.queryByText('customer cart page')).toBeNull();
  expect(screen.queryByText(/403|access denied/i)).toBeNull();
  expect(screen.getByRole('link', { name: /go to kitchen dashboard/i }).getAttribute('href')).toBe(
    '/employee/dashboard'
  );
});

test('an employee navigating directly to /checkout gets the friendly account notice', () => {
  mockUser = EMPLOYEE;
  renderGuarded('/checkout');

  expect(
    screen.getByRole('heading', {
      name: /shopping cart is available to customer accounts only/i,
    })
  ).toBeTruthy();
  expect(screen.queryByText('customer checkout page')).toBeNull();
  expect(screen.queryByText(/403|access denied/i)).toBeNull();
});

test('an admin gets the friendly notice and the admin dashboard link', () => {
  mockUser = ADMIN;
  renderGuarded('/cart');

  expect(
    screen.getByRole('heading', {
      name: /shopping cart is available to customer accounts only/i,
    })
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: /go to admin dashboard/i }).getAttribute('href')).toBe(
    '/admin'
  );
});

test('customers still reach the real cart and checkout pages', () => {
  mockUser = CUSTOMER;
  renderGuarded('/cart');

  expect(screen.getByText('customer cart page')).toBeTruthy();
  expect(screen.queryByText(/shopping cart is available to customer accounts only/i)).toBeNull();
});

test('a known customer reaches the cart while auth is still restoring', () => {
  mockUser = CUSTOMER;
  mockIsLoading = true;
  renderGuarded('/checkout');

  expect(screen.getByText('customer checkout page')).toBeTruthy();
  expect(screen.queryByText(/shopping cart is available to customer accounts only/i)).toBeNull();
});

test('a known employee gets the notice while auth is still restoring', () => {
  mockUser = EMPLOYEE;
  mockIsLoading = true;
  renderGuarded('/cart');

  expect(
    screen.getByRole('heading', {
      name: /shopping cart is available to customer accounts only/i,
    })
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: /go to kitchen dashboard/i })).toBeTruthy();
});

test('a signed-out visitor still goes to the customer login page', () => {
  renderGuarded('/cart');

  expect(screen.getByText('customer login page')).toBeTruthy();
});
