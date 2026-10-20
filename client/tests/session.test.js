/**
 * Tab sessions — the client half of the customer/staff cookie split.
 *
 * The server keeps one cookie per session group, so each tab has to say which
 * of the two it is using. A login in another tab must never change who this tab
 * is, and a hard reload must land on the session its route belongs to.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canShopAs,
  getTabSession,
  isStaffAs,
  readTabSession,
  sessionForPath,
  sessionForRole,
  setTabSession,
} from '../src/utils/session';

/** jsdom keeps window.location, so a route change is just a history update. */
const goto = (path) => window.history.replaceState({}, '', path);

beforeEach(() => {
  window.sessionStorage.clear();
  goto('/');
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('sessionForPath', () => {
  it('treats the customer app as the customer session', () => {
    expect(sessionForPath('/')).toBe('customer');
    expect(sessionForPath('/outlet/abc')).toBe('customer');
    expect(sessionForPath('/orders')).toBe('customer');
    expect(sessionForPath('/login')).toBe('customer');
  });

  it('treats the staff portal as the staff session', () => {
    expect(sessionForPath('/employee')).toBe('staff');
    expect(sessionForPath('/employee/login')).toBe('staff');
    expect(sessionForPath('/employee/dashboard')).toBe('staff');
    expect(sessionForPath('/admin')).toBe('staff');
  });

  it('does not treat a longer word as a staff route', () => {
    expect(sessionForPath('/administrator')).toBe('customer');
    expect(sessionForPath('/employees')).toBe('customer');
  });

  it('falls back to the customer session for a missing path', () => {
    expect(sessionForPath('')).toBe('customer');
    expect(sessionForPath(undefined)).toBe('customer');
  });
});

describe('tab storage', () => {
  it('derives the session from the route when nothing is stored yet', () => {
    goto('/employee/dashboard');

    expect(readTabSession()).toBeNull();
    expect(getTabSession()).toBe('staff');
  });

  it('remembers this tab\'s session across navigation', () => {
    goto('/login');
    setTabSession('customer');

    // Same tab, different route: the tab keeps its own session.
    goto('/employee/login');
    expect(getTabSession()).toBe('customer');
  });

  it('ignores an unknown stored value', () => {
    window.sessionStorage.setItem('qb:session', 'admin');
    goto('/');

    expect(readTabSession()).toBeNull();
    expect(getTabSession()).toBe('customer');
  });

  it('ignores an invalid value passed to setTabSession', () => {
    setTabSession('nope');

    expect(readTabSession()).toBeNull();
  });
});

describe('sessionForRole', () => {
  it('maps each role to its session group', () => {
    expect(sessionForRole('customer')).toBe('customer');
    expect(sessionForRole('employee')).toBe('staff');
    expect(sessionForRole('admin')).toBe('staff');
  });
});

describe('canShopAs', () => {
  it('lets a known customer shop even while auth is still restoring', () => {
    expect(canShopAs({ role: 'customer' }, true)).toBe(true);
  });

  it('keeps known staff read-only while auth is still restoring', () => {
    expect(canShopAs({ role: 'employee' }, true)).toBe(false);
    expect(canShopAs({ role: 'admin' }, true)).toBe(false);
  });

  it('lets a guest shop once auth has settled', () => {
    expect(canShopAs(null, false)).toBe(true);
    expect(canShopAs(null)).toBe(true);
  });

  it('does not let an unknown user shop while auth is loading', () => {
    expect(canShopAs(null, true)).toBe(false);
  });
});

describe('isStaffAs', () => {
  it('is true only for signed-in staff accounts', () => {
    expect(isStaffAs({ role: 'employee' })).toBe(true);
    expect(isStaffAs({ role: 'admin' })).toBe(true);
    expect(isStaffAs({ role: 'customer' })).toBe(false);
    expect(isStaffAs(null)).toBe(false);
  });
});
