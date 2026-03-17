export interface User {
  id: string;                     // UUID
  googleId: string;               // Google OAuth subject identifier
  email: string;                  // encrypted at rest
  displayName: string;            // from Google profile
  isAdmin: boolean;
  twiqBalance: number;            // integer, non-negative
  bankAccountInfo: string | null; // encrypted at rest
  lastAdWatchedAt: Date | null;
  createdAt: Date;
}

export interface Raffle {
  id: string;                     // UUID
  dropId: string;                 // FK to Drop
  status: 'active' | 'closed' | 'winner_selected' | 'receipt_confirmed' | 'no_winner';
  minTwiqThreshold: number;       // minimum total bids to select a winner
  maxTwiqThreshold: number;       // total bids that trigger immediate close
  expiresAt: Date;                // time-based expiration
  totalTwiqsBid: number;          // running total
  winnerId: string | null;        // FK to User
  winningBidId: string | null;    // FK to BidEntry
  createdAt: Date;
  closedAt: Date | null;
}

export interface Drop {
  id: string;                     // UUID
  name: string;
  description: string;
  imageUrl: string;
  retailValue: number;            // in cents
  createdAt: Date;
}

export interface BidEntry {
  id: string;                     // UUID
  raffleId: string;               // FK to Raffle
  userId: string;                 // FK to User
  twiqAmount: number;             // amount bid
  createdAt: Date;
}

export interface TwiqTransaction {
  id: string;                     // UUID
  userId: string;                 // FK to User
  type: 'ad_watch' | 'bid' | 'cashout' | 'cashout_reversal';
  amount: number;                 // positive = credit, negative = debit
  referenceId: string | null;     // e.g. raffleId, bidEntryId
  createdAt: Date;
}
