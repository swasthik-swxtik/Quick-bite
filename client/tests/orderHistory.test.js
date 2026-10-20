/**
 * orderHistory.js — the UI's copy of the "can this leave the history?" rule.
 *
 * The server is the authority; this only decides whether the action is offered.
 */

import { expect, test } from 'vitest';
import { canArchiveOrder } from '../src/utils/orderHistory';

test('only a fully completed order can leave a history list', () => {
  expect(canArchiveOrder('collected')).toBe(true);
});

test('active orders must stay in the history', () => {
  for (const status of ['confirmed', 'preparing', 'partially_ready', 'ready']) {
    expect(canArchiveOrder(status), `${status} must not be archivable`).toBe(false);
  }
});

test('unknown or missing statuses are not archivable', () => {
  expect(canArchiveOrder(undefined)).toBe(false);
  expect(canArchiveOrder(null)).toBe(false);
  expect(canArchiveOrder('')).toBe(false);
  expect(canArchiveOrder('cancelled')).toBe(false);
});
