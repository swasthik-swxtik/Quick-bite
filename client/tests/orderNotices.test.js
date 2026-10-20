/**
 * orderNotices — the message shown when an outlet order changes.
 *
 * The rule this pins down: a "ready" announcement carries the pickup code of
 * the order the page loaded over its owner-scoped HTTP request, never a code
 * from the real-time event (that payload also reaches the kitchen screens and
 * has no code to give).
 */

import { describe, expect, it } from 'vitest';
import { orderChangeNotice } from '../src/utils/orderNotices';

describe('orderChangeNotice', () => {
  it('names the counter and the code when an order becomes ready', () => {
    const message = orderChangeNotice({
      status: 'ready',
      outletName: 'Pizza Palace',
      pickupCode: 'QB3821',
    });

    expect(message).toBe('Pizza Palace is ready — collect it with code QB3821.');
  });

  it('still reads correctly when the loaded order had no code', () => {
    const message = orderChangeNotice({ status: 'ready', outletName: 'Pizza Palace' });

    expect(message).toBe('Pizza Palace is ready to collect.');
    expect(message).not.toMatch(/code/i);
  });

  it('never mentions a code for any other status', () => {
    for (const status of ['preparing', 'collected', 'confirmed']) {
      const message = orderChangeNotice({
        status,
        outletName: 'Pizza Palace',
        pickupCode: 'QB3821',
      });

      expect(message).not.toContain('QB3821');
    }
  });

  it('falls back to a generic counter name and label', () => {
    expect(orderChangeNotice({ status: 'preparing' })).toBe(
      'This counter has started preparing your order.'
    );
    expect(orderChangeNotice({ status: 'confirmed', outletName: 'Pasta Point' })).toBe(
      'Pasta Point is now confirmed.'
    );
  });
});
