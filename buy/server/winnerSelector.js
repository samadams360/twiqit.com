/**
 * Winner_Selector
 * Selects a winner from a list of bid entries using a cryptographically
 * seeded random index. Each Twiq bid counts as one ticket, so higher bids
 * get proportionally more chances.
 *
 * Exported as { selectWinner } so the implementation can be swapped in tests.
 */
const crypto = require('crypto');

/**
 * @param {Array<{id: string, userId: string, amount: number}>} bidEntries
 * @returns {{ id: string, userId: string, amount: number }}
 */
function selectWinner(bidEntries) {
  if (!bidEntries || bidEntries.length === 0) {
    throw new Error('Cannot select a winner from an empty bid list.');
  }

  // Build a weighted ticket pool: each Twiq bid = one ticket
  const tickets = [];
  for (const entry of bidEntries) {
    for (let i = 0; i < entry.amount; i++) {
      tickets.push(entry);
    }
  }

  // Cryptographically random index
  const randomBytes = crypto.randomBytes(4);
  const randomUint32 = randomBytes.readUInt32BE(0);
  const index = randomUint32 % tickets.length;

  return tickets[index];
}

module.exports = { selectWinner };
