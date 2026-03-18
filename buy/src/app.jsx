/* global React, ReactDOM */
const { useState, useEffect } = React;

const USER_KEY = 'twiqit_user';

function getSavedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function saveUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function clearUser() { localStorage.removeItem(USER_KEY); }

function formatCurrency(cents) { return '$' + (cents / 100).toFixed(2); }
function formatExpiry(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ---- Telemetry ----
const SESSION_ID = Math.random().toString(36).slice(2);
function telemetry(type, data = {}) {
  const user = getSavedUser();
  fetch('/buy/api/telemetry/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, userId: user?.id ?? null, sessionId: SESSION_ID, data }),
  }).catch(() => {});
}
window.addEventListener('error', e => {
  telemetry('js_error', { message: e.message, source: e.filename, line: e.lineno });
});

// ---- Balance bar ----
function BalanceBar({ user, externalBalance, onCashout, onProfile }) {
  const [balance, setBalance] = useState(null);
  const [cooldown, setCooldown] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [watching, setWatching] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [cashoutMsg, setCashoutMsg] = useState(null);

  useEffect(() => {
    if (!user) return;
    fetch(`/buy/api/twiqs/balance?userId=${user.id}`)
      .then(r => r.json())
      .then(d => setBalance(d.balance ?? 0))
      .catch(() => setBalance(0));
  }, [user]);

  useEffect(() => {
    if (externalBalance !== null && externalBalance !== undefined) setBalance(externalBalance);
  }, [externalBalance]);

  useEffect(() => {
    if (!cooldown) { setRemaining(null); return; }
    function tick() {
      const ms = new Date(cooldown) - Date.now();
      if (ms <= 0) { setCooldown(null); setRemaining(null); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${m}m ${String(s).padStart(2, '0')}s`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function watchAd() {
    setWatching(true);
    try {
      const r = await fetch('/buy/api/twiqs/watch-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await r.json();
      if (r.status === 429) { setCooldown(data.error.eligibleAt); setWatching(false); return; }
      if (r.ok) { setBalance(data.balance); setCooldown(null); telemetry('ad_watch_start'); }
    } catch { /* ignore */ }
    setWatching(false);
  }

  async function cashOut() {
    setCashingOut(true); setCashoutMsg(null);
    try {
      const r = await fetch('/buy/api/twiqs/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data?.error?.code === 'NO_PAYMENT_HANDLE') {
          setCashoutMsg({ type: 'error', msg: 'Set your Venmo handle in your profile first.' });
          onProfile && onProfile();
        } else {
          setCashoutMsg({ type: 'error', msg: data?.error?.message || 'Cashout failed.' });
        }
      } else {
        setCashoutMsg({ type: 'success', msg: data.message });
      }
    } catch { setCashoutMsg({ type: 'error', msg: 'Connection error.' }); }
    setCashingOut(false);
  }

  const onCooldown = !!remaining;
  const el = document.getElementById('balance-bar-root');
  if (!el || !user || balance === null) return null;
  return ReactDOM.createPortal(
    <div className="balance-bar">
      <div>
        <div className="balance-label">Your Twiqs</div>
        <div className="balance-amount">{balance}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <button className="btn-watch-ad" onClick={watchAd} disabled={watching || onCooldown}>
          {watching ? 'Loading…' : onCooldown ? 'Ad watched' : '▶ Watch Ad +100'}
        </button>
        {onCooldown && <div className="cooldown-msg">Next ad in {remaining}</div>}
        {cashoutMsg && (
          <div className="cooldown-msg" style={{ color: cashoutMsg.type === 'error' ? '#fca5a5' : '#86efac', maxWidth: '200px' }}>
            {cashoutMsg.msg}
          </div>
        )}
      </div>
    </div>,
    el
  );
}

function Header({ user, onSignOut, onProfile, onHome }) {
  const el = document.getElementById('header-right');
  const logo = document.getElementById('logo-link');
  useEffect(() => {
    if (logo) logo.href = onHome ? '/buy' : '/';
  }, [onHome]);
  if (!el || !user) return null;
  return ReactDOM.createPortal(
    <>
      <span className="user-name" onClick={onProfile} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{user.displayName}</span>
      <button className="btn-sign-out" onClick={onSignOut}>Change</button>
    </>,
    el
  );
}

function UsernamePrompt({ onSuccess }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true); setError('');
    try {
      const r = await fetch('/buy/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data?.error?.message || 'Something went wrong.'); setLoading(false); return; }
      saveUser(data);
      telemetry('user_registered', { displayName: data.displayName });
      onSuccess(data);
    } catch { setError('Connection error. Try again.'); }
    setLoading(false);
  }

  return (
    <div className="signin-card">
      <p className="signin-title">Welcome to Twiqit</p>
      <p className="signin-sub">What should we call you?</p>
      <form onSubmit={handleSubmit}>
        <input
          className="signin-input"
          type="text"
          placeholder="Your name"
          maxLength={32}
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
        <button className="btn-signin" type="submit" disabled={loading || !name.trim()}>
          {loading ? 'Just a sec…' : "Let's go →"}
        </button>
        {error && <p className="signin-error">{error}</p>}
      </form>
    </div>
  );
}

function WinnerBanner({ user, winRaffle, onConfirmed }) {
  const [confirming, setConfirming] = useState(false);
  if (winRaffle.status !== 'winner_selected') return null;

  async function confirmReceipt() {
    setConfirming(true);
    try {
      const r = await fetch(`/buy/api/raffle/${winRaffle.id}/confirm-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (r.ok) { onConfirmed && onConfirmed(); }
    } catch { /* ignore */ }
    setConfirming(false);
  }

  return (
    <div className="winner-strip">
      <span className="winner-strip-text">🏆 You won {winRaffle.dropName}</span>
      <button className="btn-confirm" onClick={confirmReceipt} disabled={confirming}>
        {confirming ? 'Confirming…' : 'Confirm Receipt'}
      </button>
    </div>
  );
}

function TwiqProgress({ total, min, max }) {
  const pct = max > 0 ? Math.min((total / max) * 100, 100) : 0;
  const minPct = max > 0 ? Math.min((min / max) * 100, 100) : 0;
  const atMax = total >= max;
  return (
    <div className="twiq-progress">
      <div className="twiq-progress-header">
        <span className="twiq-progress-label">Twiqs Bid</span>
        <span className="twiq-progress-count">{total.toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <div className="twiq-track">
        <div className={`twiq-fill${atMax ? ' at-max' : ''}`} style={{ width: `${pct}%` }} />
        <div className="twiq-marker" style={{ left: `${minPct}%` }}>
          <div className="twiq-marker-label">min</div>
        </div>
      </div>
      <div className="twiq-thresholds">
        <span>Min to close: <strong>{min.toLocaleString()}</strong></span>
        <span>Max (instant close): <strong>{max.toLocaleString()}</strong></span>
      </div>
    </div>
  );
}

function DropCard({ drop, raffle, user, onBidSuccess }) {
  const [bidAmount, setBidAmount] = useState('');
  const [bidding, setBidding] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [totalBid, setTotalBid] = useState(raffle.totalTwiqsBid ?? 0);
  const [myBids, setMyBids] = useState(null);
  const isActive = raffle.status === 'active';

  useEffect(() => {
    if (!user) return;
    fetch(`/buy/api/raffle/${raffle.id}/my-bids?userId=${user.id}`)
      .then(r => r.json())
      .then(d => setMyBids(d.totalBid ?? 0))
      .catch(() => setMyBids(0));
  }, [user, raffle.id]);

  async function placeBid(e) {
    e.preventDefault();
    const amount = parseInt(bidAmount, 10);
    if (!amount || amount <= 0) return;
    setBidding(true); setFeedback(null);
    try {
      const r = await fetch(`/buy/api/raffle/${raffle.id}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, amount }),
      });
      const data = await r.json();
      if (!r.ok) {
        setFeedback({ type: 'error', msg: data?.error?.message || 'Something went wrong.' });
      } else {
        setFeedback({ type: 'success', msg: `Bid placed! New balance: ${data.balance} Twiqs` });
        setBidAmount('');
        setTotalBid(data.raffle?.totalTwiqsBid ?? totalBid + amount);
        setMyBids(prev => (prev ?? 0) + amount);
        telemetry('bid_placed', { raffleId: raffle.id, amount });
        onBidSuccess(data.balance);
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Connection error. Try again.' });
    }
    setBidding(false);
  }

  return (
    <>
      {drop.imageUrl && <img className="drop-image" src={drop.imageUrl} alt={drop.name} />}
      <div className="card-body">
        <p className="drop-label">{isActive ? 'Active Product' : 'Past Product'}</p>
        <h1 className="drop-name">{drop.name}</h1>
        <p className="drop-desc">{drop.description}</p>
        <div className="drop-meta">
          <div><strong>{formatCurrency(drop.retailValue)}</strong>Retail Value</div>
          <div><strong>{formatExpiry(raffle.expiresAt)}</strong>Raffle Closes</div>
          {raffle.creatorName && <div><strong>{raffle.creatorName}</strong>Hosted by</div>}
          {myBids !== null && <div><strong>{myBids.toLocaleString()}</strong>Your Twiqs Bid</div>}
        </div>
        <TwiqProgress total={totalBid} min={raffle.minTwiqThreshold} max={raffle.maxTwiqThreshold} />
        {isActive ? (
          <form onSubmit={placeBid}>
            <div className="bid-row">
              <input
                className="bid-input"
                type="number" min="1" step="1"
                placeholder="Twiqs to bid"
                value={bidAmount}
                onChange={e => setBidAmount(e.target.value)}
              />
              <button className="btn-bid" type="submit" disabled={bidding || !bidAmount}>
                {bidding ? 'Placing…' : 'Place Bid'}
              </button>
            </div>
            {feedback && <p className={`bid-feedback ${feedback.type}`}>{feedback.msg}</p>}
          </form>
        ) : (
          <div>
            <span className="raffle-closed-badge">Raffle Closed</span>
            {raffle.winnerName && (
              <span style={{ marginLeft: '10px', fontSize: '13px', color: '#555' }}>
                🏆 Won by <strong>{raffle.winnerName}</strong>
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">🎁</div>
      <h2 className="empty-title">No product right now</h2>
      <p className="empty-sub">Check back soon — something good is coming.</p>
    </div>
  );
}

function ProfilePage({ user, onBack }) {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [history, setHistory] = useState(null);
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    fetch(`/buy/api/user/profile?userId=${user.id}`)
      .then(r => r.json())
      .then(d => { setHandle(d.venmoHandle || ''); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`/buy/api/raffle/my-history?userId=${user.id}`)
      .then(r => r.json())
      .then(d => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]));
  }, [user.id]);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setFeedback(null);
    try {
      const r = await fetch('/buy/api/user/payment-handle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, venmoHandle: handle }),
      });
      const data = await r.json();
      if (!r.ok) setFeedback({ type: 'error', msg: data?.error?.message || 'Failed to save.' });
      else setFeedback({ type: 'success', msg: 'Venmo handle saved.' });
    } catch { setFeedback({ type: 'error', msg: 'Connection error.' }); }
    setSaving(false);
  }

  async function confirmWin(raffleId) {
    try {
      const r = await fetch(`/buy/api/raffle/${raffleId}/confirm-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      if (r.ok) setHistory(prev => prev.map(w => w.id === raffleId ? { ...w, status: 'receipt_confirmed' } : w));
    } catch { /* ignore */ }
  }

  function toggleSort(field) {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(field); setSortDir('desc'); }
  }

  const STATUS_ORDER = { winner_selected: 0, active: 1, receipt_confirmed: 2, closed: 3 };
  const sorted = history ? [...history].sort((a, b) => {
    let cmp = sortBy === 'date'
      ? new Date(a.createdAt) - new Date(b.createdAt)
      : (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    return sortDir === 'asc' ? cmp : -cmp;
  }) : [];

  const outstanding = history ? history.filter(r => r.isWinner && r.status === 'winner_selected') : [];

  function formatDate(d) {
    return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }

  function statusLabel(r) {
    if (r.isWinner) {
      if (r.status === 'winner_selected') return 'Won — Pending Receipt';
      if (r.status === 'receipt_confirmed') return 'Won — Receipt Confirmed';
    }
    if (r.status === 'active') return 'Active';
    if (['closed', 'winner_selected', 'receipt_confirmed'].includes(r.status)) return 'Closed';
    return r.status;
  }

  function RaffleRow({ r, onConfirm }) {
    const [copied, setCopied] = useState(false);
    function copyId() {
      navigator.clipboard.writeText(r.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
    }
    return (
      <div className="win-row">
        <div className="win-row-info">
          <div className="win-row-name">{r.dropName}</div>
          <div className="win-row-meta">
            {formatDate(r.closedAt || r.createdAt)} · {r.userBidTotal.toLocaleString()} Twiqs bid
            {r.isWinner ? ' · 🏆 Winner' : ''}
          </div>
          <div className="win-row-id" onClick={copyId} title="Click to copy raffle ID">
            {r.id.slice(0, 8)}… {copied ? '✓ copied' : '📋'}
          </div>
        </div>
        {r.isWinner && r.status === 'winner_selected' ? (
          <button className="win-row-confirm" onClick={() => onConfirm(r.id)}>Confirm Receipt</button>
        ) : (
          <span className={`win-row-status ${r.isWinner ? r.status : 'closed'}`}>{statusLabel(r)}</span>
        )}
      </div>
    );
  }

  return (
    <div className="profile-card">
      <p className="profile-title">Your Profile</p>
      <p className="profile-sub">Hi, {user.displayName}</p>
      {loading ? <p style={{ color: '#888', fontSize: '14px' }}>Loading…</p> : (
        <form onSubmit={save}>
          <div className="profile-field">
            <div className="profile-label">Venmo Handle</div>
            <input
              className="profile-input"
              type="text"
              placeholder="@your-venmo"
              maxLength={64}
              value={handle}
              onChange={e => setHandle(e.target.value.replace(/^@+/, ''))}
            />
            <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>
              Used for Twiq cashouts. No payment is processed in Alpha.
            </div>
          </div>
          <button className="btn-profile-save" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {feedback && <p className={`profile-feedback ${feedback.type}`}>{feedback.msg}</p>}
        </form>
      )}
      {history !== null && (
        <div className="win-history">
          {outstanding.length > 0 && (
            <div className="outstanding-section">
              <p className="outstanding-title">⚠ Outstanding — Action Required</p>
              {outstanding.map(r => <RaffleRow key={r.id} r={r} onConfirm={confirmWin} />)}
            </div>
          )}
          <p className="win-history-title">Raffle History</p>
          <div className="history-controls">
            <span className="history-sort-label">Sort:</span>
            <button className={`history-sort-btn${sortBy === 'date' ? ' active' : ''}`} onClick={() => toggleSort('date')}>
              Date {sortBy === 'date' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
            </button>
            <button className={`history-sort-btn${sortBy === 'status' ? ' active' : ''}`} onClick={() => toggleSort('status')}>
              Status {sortBy === 'status' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
            </button>
          </div>
          {sorted.length === 0
            ? <p style={{ fontSize: '13px', color: '#aaa' }}>No raffle activity yet.</p>
            : sorted.map(r => <RaffleRow key={r.id} r={r} onConfirm={confirmWin} />)
          }
        </div>
      )}
      <div style={{ marginTop: '24px' }}>
        <button className="btn-sign-out" onClick={onBack}>← Back to Twiqit Commerce</button>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(getSavedUser);
  const [drop, setDrop] = useState({ status: 'loading', data: null });
  const [bidBalance, setBidBalance] = useState(null);
  const [winRaffle, setWinRaffle] = useState(null);

  const [view, setViewState] = useState(() =>
    window.location.pathname === '/buy/profile' ? 'profile' : 'home'
  );

  function setView(v) {
    window.history.pushState({ view: v }, '', v === 'profile' ? '/buy/profile' : '/buy');
    setViewState(v);
  }

  useEffect(() => {
    function onPop(e) {
      const v = e.state?.view ?? (window.location.pathname === '/buy/profile' ? 'profile' : 'home');
      setViewState(v);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    telemetry('page_view', { path: window.location.pathname });
    fetch('/buy/api/raffle/active')
      .then(r => r.json())
      .then(data => {
        if (data) {
          setDrop({ status: 'done', data });
        } else {
          return fetch('/buy/api/raffle/recent')
            .then(r => r.json())
            .then(recent => setDrop({ status: 'done', data: recent }));
        }
      })
      .catch(() => setDrop({ status: 'error', data: null }));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch(`/buy/api/raffle/my-win?userId=${user.id}`)
      .then(r => r.json())
      .then(data => { if (data) setWinRaffle(data); })
      .catch(() => {});
  }, [user]);

  function handleSignOut() { clearUser(); setUser(null); setWinRaffle(null); }

  if (!user) {
    return (
      <>
        <Header user={null} />
        <UsernamePrompt onSuccess={u => { saveUser(u); setUser(u); }} />
      </>
    );
  }

  if (view === 'profile') {
    return (
      <>
        <Header user={user} onSignOut={handleSignOut} onProfile={() => setView('profile')} onHome={() => setView('home')} />
        <BalanceBar user={user} externalBalance={bidBalance} onProfile={() => setView('profile')} />
        <ProfilePage user={user} onBack={() => setView('home')} />
      </>
    );
  }

  return (
    <>
      <Header user={user} onSignOut={handleSignOut} onProfile={() => setView('profile')} onHome={() => setView('home')} />
      <BalanceBar user={user} externalBalance={bidBalance} onProfile={() => setView('profile')} />
      {winRaffle && (
        <WinnerBanner user={user} winRaffle={winRaffle} onConfirmed={() => setWinRaffle(null)} />
      )}
      {drop.data
        ? <DropCard drop={drop.data.drop} raffle={drop.data.raffle} user={user} onBidSuccess={bal => setBidBalance(bal)} />
        : <EmptyState />}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('card'));
root.render(<App />);
