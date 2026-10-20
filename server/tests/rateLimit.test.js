/**
 * Unit tests for the pickup-code attempt limiter (middleware/rateLimit.js).
 *
 * Pure logic with an injected clock — no database, no HTTP. The endpoint-level
 * behaviour (429 + Retry-After, and the fact that a correct code is refused
 * while locked) is covered in employee.test.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createAttemptLimiter } = require('../src/middleware/rateLimit');

const EMPLOYEE = 'employee-1';
const OTHER_EMPLOYEE = 'employee-2';
const ORDER_A = 'order-a';
const ORDER_B = 'order-b';

/** A limiter plus a hand-cranked clock. */
const setup = (options = {}) => {
  let now = 0;
  const limiter = createAttemptLimiter({ clock: () => now, ...options });
  return {
    limiter,
    advance: (ms) => {
      now += ms;
    },
  };
};

test('attempts are allowed until the pair runs out of failures', () => {
  const { limiter } = setup({ maxFailures: 3, maxFailuresPerEmployee: 99 });

  assert.equal(limiter.check(EMPLOYEE, ORDER_A).allowed, true);

  limiter.failure(EMPLOYEE, ORDER_A);
  limiter.failure(EMPLOYEE, ORDER_A);
  assert.equal(
    limiter.check(EMPLOYEE, ORDER_A).allowed,
    true,
    'two wrong codes are still within the allowance'
  );

  limiter.failure(EMPLOYEE, ORDER_A);
  const locked = limiter.check(EMPLOYEE, ORDER_A);
  assert.equal(locked.allowed, false);
  assert.equal(locked.scope, 'pair');
  assert.ok(locked.retryAfterMs > 0, 'the caller needs a Retry-After value');

  // The lock is per (employee, order): another order is untouched.
  assert.equal(limiter.check(EMPLOYEE, ORDER_B).allowed, true);
  assert.equal(limiter.check(OTHER_EMPLOYEE, ORDER_A).allowed, true);
});

test('a correct code clears the pair, and a lock expires', () => {
  const { limiter, advance } = setup({
    maxFailures: 2,
    lockoutMs: 1000,
    maxFailuresPerEmployee: 99,
  });

  limiter.failure(EMPLOYEE, ORDER_A);
  limiter.success(EMPLOYEE, ORDER_A);
  limiter.failure(EMPLOYEE, ORDER_A);
  assert.equal(limiter.check(EMPLOYEE, ORDER_A).allowed, true, 'the success reset the counter');

  limiter.failure(EMPLOYEE, ORDER_A);
  assert.equal(limiter.check(EMPLOYEE, ORDER_A).allowed, false);

  advance(1000);
  assert.equal(limiter.check(EMPLOYEE, ORDER_A).allowed, true, 'the lock expires on its own');
});

test('the employee budget stops guesses spread over many orders', () => {
  const { limiter, advance } = setup({
    maxFailures: 100,
    maxFailuresPerEmployee: 3,
    employeeWindowMs: 5000,
    lockoutMs: 1000,
  });

  limiter.failure(EMPLOYEE, ORDER_A);
  limiter.failure(EMPLOYEE, ORDER_B);
  limiter.failure(EMPLOYEE, 'order-c');

  const locked = limiter.check(EMPLOYEE, 'order-d');
  assert.equal(locked.allowed, false, 'rotating orders must not multiply the guesses');
  assert.equal(locked.scope, 'employee');

  // Another employee is unaffected.
  assert.equal(limiter.check(OTHER_EMPLOYEE, ORDER_A).allowed, true);

  // Once the lockout and the window have passed, the budget is usable again.
  advance(6000);
  assert.equal(limiter.check(EMPLOYEE, ORDER_A).allowed, true);
});

test('expired entries are swept, so the maps stay bounded', () => {
  const { limiter, advance } = setup({
    maxFailures: 2,
    lockoutMs: 1000,
    employeeWindowMs: 1000,
  });

  limiter.failure(EMPLOYEE, ORDER_A);
  assert.deepEqual(limiter.size(), { pairs: 1, employees: 1 });

  advance(2000);
  limiter.check(EMPLOYEE, ORDER_B); // any call prunes what can no longer matter
  assert.deepEqual(limiter.size(), { pairs: 0, employees: 0 });
});
