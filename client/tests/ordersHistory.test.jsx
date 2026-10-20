/**
 * OrdersPage — "Delete from history" flow.
 *
 * Verifies the customer-facing contract:
 *   - only completed (collected) orders offer the action
 *   - the action always goes through a confirmation dialog
 *   - cancelling never calls the API
 *   - a success removes the row and confirms that the records are kept
 *   - a refusal (409: not completed any more) keeps the row and shows the message
 *   - pickup codes stay visible for the orders that are still listed
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrdersPage from '../src/pages/customer/OrdersPage';

const mockGetMyOrders = vi.fn();
const mockArchiveOrder = vi.fn();

vi.mock('../src/services/orderService', () => ({
  getMyOrders: (...args) => mockGetMyOrders(...args),
  archiveOrder: (...args) => mockArchiveOrder(...args),
}));

const COLLECTED_ORDER = {
  id: '11111111-1111-4111-8111-111111111111',
  totalAmount: '448.00',
  status: 'collected',
  createdAt: new Date().toISOString(),
  outletOrders: [
    {
      id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      outletId: 'pizza',
      outletName: 'Pizza Palace',
      pickupCode: 'PF2128',
      status: 'collected',
    },
  ],
};

const ACTIVE_ORDER = {
  id: '22222222-2222-4222-8222-222222222222',
  totalAmount: '299.00',
  status: 'preparing',
  createdAt: new Date().toISOString(),
  outletOrders: [
    {
      id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      outletId: 'pasta',
      outletName: 'Pasta Point',
      pickupCode: 'SL2625',
      status: 'preparing',
    },
  ],
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <OrdersPage />
    </MemoryRouter>
  );

const deleteButtons = () => screen.queryAllByRole('button', { name: /delete from history/i });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMyOrders.mockResolvedValue({ orders: [COLLECTED_ORDER, ACTIVE_ORDER] });
});

afterEach(() => {
  cleanup();
});

test('only completed orders offer "Delete from history"', async () => {
  renderPage();

  // Both rows load...
  expect(await screen.findByText('Pizza Palace')).toBeTruthy();
  expect(screen.getByText('Pasta Point')).toBeTruthy();

  // ...but only the collected one offers the action.
  expect(deleteButtons()).toHaveLength(1);

  // The customer still sees every pickup code (this page is customer-only).
  expect(screen.getByText('PF2128')).toBeTruthy();
  expect(screen.getByText('SL2625')).toBeTruthy();
});

test('asks for confirmation, then removes the row on success', async () => {
  mockArchiveOrder.mockResolvedValue(undefined);

  renderPage();
  await screen.findByText('Pizza Palace');

  fireEvent.click(deleteButtons()[0]);

  // The dialog names the consequence before anything is sent.
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText(/remove this order from your history\?/i)).toBeTruthy();
  expect(screen.getByText(/the order, its items and the payment record are kept/i)).toBeTruthy();
  expect(mockArchiveOrder).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: /^remove from history$/i }));

  await waitFor(() => expect(mockArchiveOrder).toHaveBeenCalledWith(COLLECTED_ORDER.id));

  // The archived row is gone; the active one is untouched.
  await waitFor(() => expect(screen.queryByText('Pizza Palace')).toBeNull());
  expect(screen.getByText('Pasta Point')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();

  const notice = screen.getByRole('status');
  expect(notice.textContent).toContain('removed from your history');
  expect(notice.textContent).toContain('records are kept');
});

test('cancelling closes the dialog without calling the API', async () => {
  renderPage();
  await screen.findByText('Pizza Palace');

  fireEvent.click(deleteButtons()[0]);
  expect(screen.getByRole('dialog')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockArchiveOrder).not.toHaveBeenCalled();
  expect(screen.getByText('Pizza Palace')).toBeTruthy();
});

test('keeps the row and shows the server message when the order is not completed', async () => {
  mockArchiveOrder.mockRejectedValue(
    new Error('Only completed orders can be removed from your history.')
  );

  renderPage();
  await screen.findByText('Pizza Palace');

  fireEvent.click(deleteButtons()[0]);
  fireEvent.click(screen.getByRole('button', { name: /^remove from history$/i }));

  expect(
    await screen.findByText('Only completed orders can be removed from your history.')
  ).toBeTruthy();

  // Nothing disappeared: the server refused, so the row must stay.
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('Pizza Palace')).toBeTruthy();
  expect(screen.getByText('PF2128')).toBeTruthy();
});
