/**
 * Login pages — cross-tab redirect rules.
 *
 * A browser shares one cookie jar, so a customer tab and a staff tab can be
 * signed in at the same time. A login page belongs to one session group and
 * must only redirect users whose role belongs to that page; the other group's
 * session (normally signed in from another tab) must never hide the form.
 *
 * Covered here:
 *   - a customer session does not block /employee/login
 *   - a staff session does not block /login
 *   - each page still redirects its own, already-signed-in audience
 *   - signing in from those pages actually works and sets the tab session
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import LoginPage from '../src/pages/customer/LoginPage';
import EmployeeLoginPage from '../src/pages/employee/EmployeeLoginPage';
import * as authService from '../src/services/authService';

vi.mock('../src/services/authService', () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

const CUSTOMER = {
  id: 'c1',
  name: 'Customer',
  email: 'customer@example.com',
  role: 'customer',
};
const EMPLOYEE = {
  id: 'e1',
  name: 'Pizza Staff',
  email: 'pizza@quickbite.com',
  role: 'employee',
  outletId: 'o1',
};
const ADMIN = { id: 'a1', name: 'Admin', email: 'admin@quickbite.com', role: 'admin' };

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<p>customer home</p>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/employee/login" element={<EmployeeLoginPage />} />
          <Route path="/employee/dashboard" element={<p>staff dashboard</p>} />
          <Route path="/admin" element={<p>admin dashboard</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );

const signIn = (label, email, password) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('cross-tab login', () => {
  it('shows the staff form when a customer is signed in in another tab', async () => {
    authService.getMe.mockResolvedValue({ user: CUSTOMER });

    renderAt('/employee/login');

    expect(await screen.findByText('Staff Sign In')).toBeTruthy();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.queryByText('customer home')).toBeNull();
  });

  it('shows the customer form when an employee is signed in in another tab', async () => {
    authService.getMe.mockResolvedValue({ user: EMPLOYEE });

    renderAt('/login');

    expect(await screen.findByText('Welcome back')).toBeTruthy();
    expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    expect(screen.queryByText('staff dashboard')).toBeNull();
  });

  it('signs in as staff from the staff form while a customer is signed in', async () => {
    authService.getMe.mockResolvedValue({ user: CUSTOMER });
    authService.login.mockResolvedValue({ user: EMPLOYEE });

    renderAt('/employee/login');
    await screen.findByText('Staff Sign In');

    signIn(/email address/i, EMPLOYEE.email, 'password');

    expect(await screen.findByText('staff dashboard')).toBeTruthy();
    expect(authService.login).toHaveBeenCalledWith(EMPLOYEE.email, 'password');
    // The tab now reads the staff cookie; the customer session is untouched.
    expect(window.sessionStorage.getItem('qb:session')).toBe('staff');
  });

  it('signs in as a customer from the customer form while an employee is signed in', async () => {
    authService.getMe.mockResolvedValue({ user: EMPLOYEE });
    authService.login.mockResolvedValue({ user: CUSTOMER });

    renderAt('/login');
    await screen.findByText('Welcome back');

    signIn(/email address/i, CUSTOMER.email, 'password');

    expect(await screen.findByText('customer home')).toBeTruthy();
    expect(authService.login).toHaveBeenCalledWith(CUSTOMER.email, 'password');
    expect(window.sessionStorage.getItem('qb:session')).toBe('customer');
  });
});

describe('redirects when the page\'s own role is signed in', () => {
  it('sends a signed-in customer from /login to the customer app', async () => {
    authService.getMe.mockResolvedValue({ user: CUSTOMER });

    renderAt('/login');

    expect(await screen.findByText('customer home')).toBeTruthy();
    expect(screen.queryByText('Welcome back')).toBeNull();
  });

  it('sends a signed-in employee from /employee/login to the dashboard', async () => {
    authService.getMe.mockResolvedValue({ user: EMPLOYEE });

    renderAt('/employee/login');

    expect(await screen.findByText('staff dashboard')).toBeTruthy();
    expect(screen.queryByText('Staff Sign In')).toBeNull();
  });

  it('sends a signed-in admin from /employee/login to the admin dashboard', async () => {
    authService.getMe.mockResolvedValue({ user: ADMIN });

    renderAt('/employee/login');

    expect(await screen.findByText('admin dashboard')).toBeTruthy();
    expect(screen.queryByText('Staff Sign In')).toBeNull();
  });
});
