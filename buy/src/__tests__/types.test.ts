import type { User, Raffle, Drop, BidEntry, TwiqTransaction } from '../types';

describe('types module', () => {
  it('loads without errors', () => {
    // If this file compiles and runs, the types module is wired up correctly.
    expect(true).toBe(true);
  });

  it('User shape is assignable', () => {
    const user: User = {
      id: '00000000-0000-0000-0000-000000000001',
      googleId: 'google-sub-123',
      email: 'test@example.com',
      displayName: 'Test User',
      isAdmin: false,
      twiqBalance: 0,
      bankAccountInfo: null,
      lastAdWatchedAt: null,
      createdAt: new Date(),
    };
    expect(user.twiqBalance).toBe(0);
  });

  it('Raffle shape is assignable', () => {
    const raffle: Raffle = {
      id: '00000000-0000-0000-0000-000000000002',
      dropId: '00000000-0000-0000-0000-000000000003',
      status: 'active',
      minTwiqThreshold: 100,
      maxTwiqThreshold: 1000,
      expiresAt: new Date(Date.now() + 86400000),
      totalTwiqsBid: 0,
      winnerId: null,
      winningBidId: null,
      createdAt: new Date(),
      closedAt: null,
    };
    expect(raffle.status).toBe('active');
  });

  it('Drop shape is assignable', () => {
    const drop: Drop = {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'Test Item',
      description: 'A test drop item',
      imageUrl: 'https://example.com/image.jpg',
      retailValue: 9999,
      createdAt: new Date(),
    };
    expect(drop.retailValue).toBe(9999);
  });

  it('BidEntry shape is assignable', () => {
    const bid: BidEntry = {
      id: '00000000-0000-0000-0000-000000000005',
      raffleId: '00000000-0000-0000-0000-000000000002',
      userId: '00000000-0000-0000-0000-000000000001',
      twiqAmount: 50,
      createdAt: new Date(),
    };
    expect(bid.twiqAmount).toBe(50);
  });

  it('TwiqTransaction shape is assignable', () => {
    const tx: TwiqTransaction = {
      id: '00000000-0000-0000-0000-000000000006',
      userId: '00000000-0000-0000-0000-000000000001',
      type: 'ad_watch',
      amount: 100,
      referenceId: null,
      createdAt: new Date(),
    };
    expect(tx.amount).toBe(100);
  });
});
