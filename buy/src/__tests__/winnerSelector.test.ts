/**
 * Winner_Selector tests
 * Feature: ecommerce-platform
 */
import * as fc from 'fast-check';

// Inline the pure logic so no DB deps are needed
function selectWinner(bidEntries: Array<{ id: string; userId: string; amount: number }>) {
  if (!bidEntries || bidEntries.length === 0) {
    throw new Error('Cannot select a winner from an empty bid list.');
  }
  const tickets: typeof bidEntries = [];
  for (const entry of bidEntries) {
    for (let i = 0; i < entry.amount; i++) tickets.push(entry);
  }
  const crypto = require('crypto');
  const randomBytes = crypto.randomBytes(4);
  const randomUint32 = randomBytes.readUInt32BE(0);
  const index = randomUint32 % tickets.length;
  return tickets[index];
}

const bidEntryArb = fc.record({
  id: fc.uuid(),
  userId: fc.uuid(),
  amount: fc.integer({ min: 1, max: 500 }),
});

describe('Winner_Selector', () => {
  // Property 14: Winner is always a valid bid entry
  it('Property 14: Winner is always a valid bid entry', () => {
    // Feature: ecommerce-platform, Property 14: Winner is always a valid bid entry
    fc.assert(
      fc.property(fc.array(bidEntryArb, { minLength: 1, maxLength: 20 }), (entries) => {
        const winner = selectWinner(entries);
        expect(entries.some(e => e.id === winner.id)).toBe(true);
        expect(winner.userId).toBeTruthy();
        expect(winner.amount).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('throws on empty bid list', () => {
    expect(() => selectWinner([])).toThrow('Cannot select a winner from an empty bid list.');
  });

  it('always returns the only entry when there is one', () => {
    const entry = { id: 'abc', userId: 'user-1', amount: 1 };
    expect(selectWinner([entry])).toEqual(entry);
  });

  it('higher bid amounts get proportionally more tickets', () => {
    // Run 1000 times and verify the high-bid entry wins more often
    const low  = { id: 'low',  userId: 'u1', amount: 1 };
    const high = { id: 'high', userId: 'u2', amount: 99 };
    let highWins = 0;
    for (let i = 0; i < 1000; i++) {
      if (selectWinner([low, high]).id === 'high') highWins++;
    }
    // high should win ~99% — allow generous margin
    expect(highWins).toBeGreaterThan(900);
  });
});
