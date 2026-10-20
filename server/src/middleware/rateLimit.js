/**
 * rateLimit.js — Attempt limiting for pickup-code verification.
 *
 * The collection check compares a 6-character code (2 letters from a 24-letter
 * alphabet + 4 digits = 5,760,000 combinations) against the one stored on the
 * counter's sub-order. An employee session that could guess without limit would
 * eventually stumble onto a code and collect somebody else's food, so wrong
 * codes are counted and an over-eager session is locked out.
 *
 * This is deliberately dependency-free and in-process:
 *   - no schema, no migration, no extra service to run
 *   - express-rate-limit is not a dependency of this project
 *   - the app runs as a single Node process (see server.js / nodemon)
 *
 * Two counters apply, both counting *failed verifications* only:
 *   - pair:     keyed by (employeeId, outletOrderId) — locks the pair after
 *               `maxFailures` wrong codes
 *   - employee: keyed by employeeId — a rolling window, so rotating between
 *               outlet orders does not multiply the number of guesses
 *
 * A successful verification clears the pair counter. Only ids are ever stored:
 * a submitted code is compared and discarded, never kept.
 *
 * The limiter is a module-level singleton (`pickupCodeLimiter`) so state is
 * shared by every request in the process. Tests build their own instance with
 * `createAttemptLimiter` and a fake clock.
 */

/**
 * @param {Object} [options]
 * @param {number} [options.maxFailures]            wrong codes before a pair locks
 * @param {number} [options.lockoutMs]              how long a lock lasts
 * @param {number} [options.maxFailuresPerEmployee] wrong codes before an employee locks
 * @param {number} [options.employeeWindowMs]       rolling window of the employee budget
 * @param {() => number} [options.clock]            injectable for tests
 */
const createAttemptLimiter = ({
  maxFailures = 5,
  lockoutMs = 15 * 60 * 1000,
  maxFailuresPerEmployee = 20,
  employeeWindowMs = 60 * 60 * 1000,
  clock = () => Date.now(),
} = {}) => {
  /** pair key -> { failures, lastFailureAt, lockedUntil } */
  const pairs = new Map();
  /** employeeId -> { failures, windowStart, lockedUntil } */
  const employees = new Map();

  const pairKey = (employeeId, outletOrderId) => `${employeeId}:${outletOrderId}`;

  /** Drop entries that can no longer influence a decision, so the maps stay bounded. */
  const sweep = () => {
    const now = clock();
    for (const [key, entry] of pairs) {
      const quiet = now - entry.lastFailureAt >= lockoutMs;
      if (entry.lockedUntil <= now && quiet) pairs.delete(key);
    }
    for (const [key, entry] of employees) {
      const quiet = now - entry.windowStart >= employeeWindowMs;
      if (entry.lockedUntil <= now && quiet) employees.delete(key);
    }
  };

  /**
   * @returns {{ allowed: boolean, retryAfterMs: number, scope?: 'pair'|'employee' }}
   */
  const check = (employeeId, outletOrderId) => {
    sweep();
    const now = clock();

    const pair = pairs.get(pairKey(employeeId, outletOrderId));
    if (pair && pair.lockedUntil > now) {
      return { allowed: false, retryAfterMs: pair.lockedUntil - now, scope: 'pair' };
    }

    const employee = employees.get(employeeId);
    if (employee && employee.lockedUntil > now) {
      return { allowed: false, retryAfterMs: employee.lockedUntil - now, scope: 'employee' };
    }

    return { allowed: true, retryAfterMs: 0 };
  };

  /** Count one wrong code against both the pair and the employee. */
  const failure = (employeeId, outletOrderId) => {
    const now = clock();

    const key = pairKey(employeeId, outletOrderId);
    const pair = pairs.get(key) || { failures: 0, lastFailureAt: now, lockedUntil: 0 };
    pair.failures += 1;
    pair.lastFailureAt = now;
    if (pair.failures >= maxFailures) pair.lockedUntil = now + lockoutMs;
    pairs.set(key, pair);

    const employee = employees.get(employeeId) || { failures: 0, windowStart: now, lockedUntil: 0 };
    if (now - employee.windowStart >= employeeWindowMs) {
      employee.failures = 0;
      employee.windowStart = now;
      employee.lockedUntil = 0;
    }
    employee.failures += 1;
    if (employee.failures >= maxFailuresPerEmployee) employee.lockedUntil = now + lockoutMs;
    employees.set(employeeId, employee);
  };

  /** A correct code proves the attempt was legitimate: clear the pair counter. */
  const success = (employeeId, outletOrderId) => {
    pairs.delete(pairKey(employeeId, outletOrderId));
  };

  /** Test helper — not called in production code paths. */
  const reset = () => {
    pairs.clear();
    employees.clear();
  };

  const size = () => ({ pairs: pairs.size, employees: employees.size });

  return { check, failure, success, reset, size };
};

/**
 * The limiter used by the collection endpoint: five wrong codes lock the
 * (employee, outlet order) pair for 15 minutes, and twenty wrong codes in an
 * hour lock the employee regardless of which order they were guessing.
 */
const pickupCodeLimiter = createAttemptLimiter();

module.exports = { createAttemptLimiter, pickupCodeLimiter };
