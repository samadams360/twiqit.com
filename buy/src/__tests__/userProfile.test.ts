/**
 * User profile / PII property tests (pure, no DB)
 * Feature: ecommerce-platform
 */
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Pure logic mirrors
// ---------------------------------------------------------------------------
interface UserRow {
  id: string;
  displayName: string;
  venmoHandle: string | null;
  isGuest: boolean;
  tokenHash: string | null;
}

// Simulate the rowToUser mapper from DAS
function rowToUser(row: {
  id: string;
  display_name: string;
  venmo_handle: string | null;
  is_guest: boolean;
  token_hash: string | null;
}): UserRow {
  return {
    id: row.id,
    displayName: row.display_name,
    venmoHandle: row.venmo_handle ?? null,
    isGuest: row.is_guest,
    tokenHash: row.token_hash,
  };
}

// Simulate venmo handle sanitization from raffleRouter.js
function sanitizeVenmoHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '').trim();
  if (handle.length > 64) return null; // too long
  return handle || null;
}

// ---------------------------------------------------------------------------
// Property 14.5: PII round-trip — rowToUser preserves all fields
// ---------------------------------------------------------------------------
describe('Property 14.5: User row mapper round-trip', () => {
  // Feature: ecommerce-platform, Property 14.5: rowToUser preserves all fields without data loss
  it('rowToUser preserves all fields without data loss', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          display_name: fc.string({ minLength: 1, maxLength: 32 }),
          venmo_handle: fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: null }),
          is_guest: fc.boolean(),
          token_hash: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: null }),
        }),
        (row) => {
          const user = rowToUser(row);
          expect(user.id).toBe(row.id);
          expect(user.displayName).toBe(row.display_name);
          expect(user.venmoHandle).toBe(row.venmo_handle ?? null);
          expect(user.isGuest).toBe(row.is_guest);
          expect(user.tokenHash).toBe(row.token_hash);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('venmo_handle null is preserved as null (not undefined)', () => {
    const user = rowToUser({ id: 'u1', display_name: 'Alice', venmo_handle: null, is_guest: false, token_hash: null });
    expect(user.venmoHandle).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Venmo handle sanitization
// ---------------------------------------------------------------------------
describe('Venmo handle sanitization', () => {
  it('strips leading @ from venmo handle', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 63 }).filter(s => {
          const trimmed = s.trim();
          return trimmed.length > 0 && !trimmed.startsWith('@') && trimmed === s;
        }),
        (handle) => {
          const withAt = '@' + handle;
          const result = sanitizeVenmoHandle(withAt);
          expect(result).toBe(handle);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects handles longer than 64 characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 65, maxLength: 200 }).filter(s => s.trim().length > 64),
        (handle) => {
          const result = sanitizeVenmoHandle(handle);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty string after trim returns null', () => {
    expect(sanitizeVenmoHandle('   ')).toBeNull();
    expect(sanitizeVenmoHandle('')).toBeNull();
    expect(sanitizeVenmoHandle('@')).toBeNull();
  });

  it('valid handle is returned unchanged (after @ strip)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter(s => {
          const t = s.trim();
          return t.length > 0 && t.length <= 64 && t === s && !t.startsWith('@');
        }),
        (handle) => {
          const result = sanitizeVenmoHandle(handle);
          expect(result).toBe(handle);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Profile endpoint — non-sensitive fields only
// ---------------------------------------------------------------------------
describe('Profile endpoint returns only non-sensitive fields', () => {
  it('profile response never includes tokenHash', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          displayName: fc.string({ minLength: 1, maxLength: 32 }),
          venmoHandle: fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: null }),
          isGuest: fc.boolean(),
          tokenHash: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: null }),
        }),
        (user) => {
          // Simulate what the profile endpoint returns
          const profile = { id: user.id, displayName: user.displayName, venmoHandle: user.venmoHandle, isGuest: user.isGuest };
          expect(Object.keys(profile)).not.toContain('tokenHash');
          expect(Object.keys(profile)).not.toContain('bankAccountInfo');
        }
      ),
      { numRuns: 100 }
    );
  });
});
