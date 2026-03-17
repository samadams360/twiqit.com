/**
 * Quick smoke test for Slice 3 admin endpoints.
 * Run with: node buy/server/test-admin.js
 */
const http = require('http');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json', ...(data && { 'Content-Length': Buffer.byteLength(data) }) },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  let passed = 0; let failed = 0;

  function assert(label, condition, got) {
    if (condition) { console.log(`  ✓ ${label}`); passed++; }
    else { console.error(`  ✗ ${label} — got: ${JSON.stringify(got)}`); failed++; }
  }

  // 1. GET active raffle
  console.log('\n1. GET /buy/api/raffle/active');
  const active = await request('GET', '/buy/api/raffle/active');
  assert('returns 200', active.status === 200, active.status);
  assert('has raffle + drop', active.body && active.body.raffle && active.body.drop, active.body);
  const raffleId = active.body?.raffle?.id;
  const dropId = active.body?.raffle?.dropId;

  // 2. POST /admin/raffle — missing fields → 400
  console.log('\n2. POST /buy/api/admin/raffle — missing fields');
  const r2 = await request('POST', '/buy/api/admin/raffle', { dropId });
  assert('returns 400', r2.status === 400, r2.status);
  assert('error code MISSING_FIELDS', r2.body?.error?.code === 'MISSING_FIELDS', r2.body);

  // 3. POST /admin/raffle — already active → 409
  console.log('\n3. POST /buy/api/admin/raffle — already active');
  const r3 = await request('POST', '/buy/api/admin/raffle', {
    dropId, minTwiqThreshold: 100, maxTwiqThreshold: 1000, expiresAt: '2026-12-31T00:00:00Z'
  });
  assert('returns 409', r3.status === 409, r3.status);
  assert('error code ACTIVE_RAFFLE_EXISTS', r3.body?.error?.code === 'ACTIVE_RAFFLE_EXISTS', r3.body);

  // 4. PUT /admin/raffle/:id — update active raffle
  console.log('\n4. PUT /buy/api/admin/raffle/:id — update');
  const r4 = await request('PUT', `/buy/api/admin/raffle/${raffleId}`, {
    minTwiqThreshold: 200, maxTwiqThreshold: 2000
  });
  assert('returns 200', r4.status === 200, r4.status);
  assert('minTwiqThreshold updated', r4.body?.minTwiqThreshold === 200, r4.body);
  assert('maxTwiqThreshold updated', r4.body?.maxTwiqThreshold === 2000, r4.body);

  // 5. PUT /admin/raffle/:id — not found → 404
  console.log('\n5. PUT /buy/api/admin/raffle/:id — not found');
  const r5 = await request('PUT', '/buy/api/admin/raffle/00000000-0000-0000-0000-000000000000', {});
  assert('returns 404', r5.status === 404, r5.status);

  // 6. POST /admin/raffle/:id/replace — missing fields → 400
  console.log('\n6. POST /buy/api/admin/raffle/:id/replace — missing fields');
  const r6 = await request('POST', `/buy/api/admin/raffle/${raffleId}/replace`, { dropId });
  assert('returns 400', r6.status === 400, r6.status);

  // 7. POST /admin/raffle/:id/replace — valid replace
  console.log('\n7. POST /buy/api/admin/raffle/:id/replace — valid');
  const r7 = await request('POST', `/buy/api/admin/raffle/${raffleId}/replace`, {
    dropId, minTwiqThreshold: 300, maxTwiqThreshold: 3000, expiresAt: '2027-01-01T00:00:00Z'
  });
  assert('returns 201', r7.status === 201, r7.status);
  assert('new raffle is active', r7.body?.status === 'active', r7.body);
  assert('new raffle has different id', r7.body?.id !== raffleId, r7.body);

  // 8. Old raffle should now be closed
  console.log('\n8. Old raffle should be closed');
  const r8 = await request('GET', '/buy/api/raffle/active');
  assert('active raffle is the new one', r8.body?.raffle?.id === r7.body?.id, r8.body?.raffle?.id);

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
