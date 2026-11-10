// End-to-end smoke test of the RepairHub API.
// Run: node --test   (uses a temporary data file, never touches data/db.json)

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repairhub-'));
process.env.DATA_FILE = path.join(tmp, 'db.json');
process.env.ADMIN_PASSWORD = 'test-pass';
const { server } = require('../server');

let base;
before(() => new Promise((resolve) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; resolve(); })));
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const call = async (p, { method = 'GET', body, admin } = {}) => {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin-password': 'test-pass' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('full customer journey: request → match → done → feedback → claim', async () => {
  const bad = await call('/api/requests', { method: 'POST', body: { category: 'plumbing' } });
  assert.strictEqual(bad.status, 400);
  assert.ok(bad.data.errors.length >= 3);

  const sp = await call('/api/specialists', { method: 'POST', body: { name: 'Test Specialist', phone: '+77001112233', categories: ['plumbing'], consent: true } });
  assert.strictEqual(sp.status, 201);

  const created = await call('/api/requests', { method: 'POST', body: {
    category: 'plumbing', description: 'Kitchen tap is leaking', role: 'landlord', property: 'Flat A',
    name: 'Test Customer', phone: '+7 700 999 88 77', consent: true } });
  assert.strictEqual(created.status, 201);
  assert.match(created.data.estimate, /9,000/);

  const unauthorized = await call('/api/admin/overview');
  assert.strictEqual(unauthorized.status, 401);

  const notApproved = await call('/api/admin/requests/' + created.data.id, { method: 'PATCH', admin: true, body: { specialistId: sp.data.id } });
  assert.strictEqual(notApproved.status, 400);

  await call('/api/admin/specialists/' + sp.data.id, { method: 'PATCH', admin: true, body: { status: 'approved' } });
  const matched = await call('/api/admin/requests/' + created.data.id, { method: 'PATCH', admin: true, body: { specialistId: sp.data.id } });
  assert.strictEqual(matched.data.status, 'matched');

  const tracked = await call('/api/track?phone=' + encodeURIComponent('+77009998877'));
  assert.strictEqual(tracked.data.length, 1);
  assert.strictEqual(tracked.data[0].specialist.name, 'Test Specialist');

  const earlyClaim = await call('/api/claims', { method: 'POST', body: { requestId: created.data.id, phone: '+77009998877', problem: 'Still leaking after repair' } });
  assert.strictEqual(earlyClaim.status, 400);

  await call('/api/admin/requests/' + created.data.id, { method: 'PATCH', admin: true, body: { status: 'done' } });
  const fb = await call('/api/feedback', { method: 'POST', body: { requestId: created.data.id, phone: '+77009998877', rating: 5, wouldPayInApp: 'yes' } });
  assert.strictEqual(fb.status, 201);
  const claim = await call('/api/claims', { method: 'POST', body: { requestId: created.data.id, phone: '+77009998877', problem: 'Still leaking after repair' } });
  assert.strictEqual(claim.status, 201);

  await call('/api/events', { method: 'POST', body: { type: 'visit' } });
  const overview = await call('/api/admin/overview', { admin: true });
  const m = overview.data.metrics;
  assert.strictEqual(m.requests, 1);
  assert.strictEqual(m.completed, 1);
  assert.strictEqual(m.avgRating, 5);
  assert.strictEqual(m.wouldPayInAppPct, 100);
  assert.strictEqual(m.guaranteeClaims, 1);
  assert.strictEqual(m.visits, 1);
});

test('static files are served and path traversal is blocked', async () => {
  const home = await fetch(base + '/');
  assert.strictEqual(home.status, 200);
  const evil = await fetch(base + '/..%2Fserver.js');
  assert.notStrictEqual(evil.status, 200);
});
