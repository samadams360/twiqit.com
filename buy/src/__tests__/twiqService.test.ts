/**
 * Twiq_Service property tests (pure, no DB)
 * Feature: ecommerce-platform
 */
import * as fc from 'fast-check';

const AD_WATCH_AMOUNT = 100;
const AD_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Pure logic mirrors of twiqRouter.js
// ---------------------------------------------------------------------------
function canWatchAd(lastWatchedAt: Date | null, now: Date): { allowed: boolean; eligibleAt?: Date } {
  if (!lastWatchedAt) return { allowed: true };
  const elapsed = now.getTime() - lastWatchedAt.getTime();
  if (elapsed < AD_COOLDOWN_MS) {
    return { allowed: false, eligibleAt: new Date(lastWatchedAt.getTime() + AD_COOLDOWN_MS) };
  }
  return { allowed: true };
}

function applyAdWatch(balance: number): number {
  return balance + AD_WATCH_AMOUNT;
}

function applyCashout(balance: number, amount: number): { newBalance: number } | { error: string } {
  if (amount <= 0) return { error: 'INVALID_AMOUNT' };
  if (balance < amount) return { error: 'INSUFFICIENT_BALANCE' };
  return { newBalance: balance - amount };
}

// ---------------------------------------------------------------------------
// Property 2: Ad watch credits exactly 100 Twiqs
// ---------------------------------------------------------------------------
describe('Property 2: Ad watch credits exactly 100 Twiqs', () => {
  // Feature: ecommerce-platform, Property 2: Ad watch credits exactly 100 Twiqs
  it('watching an ad always adds exactly 100 to the balance', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (balance) => {
        const newBalance = applyAdWatch(balance);
        expect(newBalance).toBe(balance + 100);
        expect(newBalance - balance).toBe(100);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Ad watch 30-min cooldown enforcement
// ---------------------------------------------------------------------------
describe('Property 3: Ad watch 30-min cooldown enforcement', () => {
  // Feature: ecommerce-platform, Property 3: Ad watch 30-min cooldown enforcement
  it('blocks ad watch if less than 30 minutes have elapsed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: AD_COOLDOWN_MS - 1 }),
        (elapsedMs) => {
          const now = new Date(1_700_000_000_000);
          const lastWatched = new Date(now.getTime() - elapsedMs);
          const result = canWatchAd(lastWatched, now);
          expect(result.allowed).toBe(false);
          expect(result.eligibleAt).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('allows ad watch if 30 or more minutes have elapsed', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: AD_COOLDOWN_MS, max: AD_COOLDOWN_MS * 100 }),
        (elapsedMs) => {
          const now = new Date(1_700_000_000_000);
          const lastWatched = new Date(now.getTime() - elapsedMs);
          const result = canWatchAd(lastWatched, now);
          expect(result.allowed).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('allows ad watch when no previous watch exists', () => {
    const result = canWatchAd(null, new Date());
    expect(result.allowed).toBe(true);
  });

  it('eligibleAt is exactly lastWatched + 30 minutes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: AD_COOLDOWN_MS - 1 }),
        (elapsedMs) => {
          const now = new Date(1_700_000_000_000);
          const lastWatched = new Date(now.getTime() - elapsedMs);
          const result = canWatchAd(lastWatched, now);
          if (!result.allowed && result.eligibleAt) {
            expect(result.eligibleAt.getTime()).toBe(lastWatched.getTime() + AD_COOLDOWN_MS);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Cashout balance invariant
// ---------------------------------------------------------------------------
describe('Property 4: Cashout balance invariant', () => {
  // Feature: ecommerce-platform, Property 4: Cashout balance invariant
  it('cashout deducts exactly the requested amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (balance, amount) => {
          fc.pre(balance >= amount);
          const result = applyCashout(balance, amount);
          if (!('error' in result)) {
            expect(result.newBalance).toBe(balance - amount);
            expect(result.newBalance).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cashout fails when balance is insufficient', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999 }),
        fc.integer({ min: 1, max: 100_000 }),
        (balance, extra) => {
          const amount = balance + extra;
          const result = applyCashout(balance, amount);
          expect('error' in result).toBe(true);
          if ('error' in result) expect(result.error).toBe('INSUFFICIENT_BALANCE');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cashout never results in a negative balance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (balance, amount) => {
          const result = applyCashout(balance, amount);
          if (!('error' in result)) {
            expect(result.newBalance).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
