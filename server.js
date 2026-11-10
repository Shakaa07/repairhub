// RepairHub MVP — a dependency-free Node.js server.
// Run:  node server.js   (then open http://localhost:3000)
// Admin dashboard: http://localhost:3000/admin.html  (password: ADMIN_PASSWORD, default "repairhub")

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'repairhub';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Reference data ----------
// Starting prices come from public market data (see README "Sources").
const CATEGORIES = {
  plumbing:   { label: 'Plumbing',               fromPrice: 9000,  source: 'Naimi.kz catalog, Astana' },
  electrical: { label: 'Electrical',             fromPrice: 5000,  source: 'Kazinform, 2025' },
  appliance:  { label: 'Appliance installation', fromPrice: null,  source: null },
  furniture:  { label: 'Furniture assembly',     fromPrice: null,  source: null },
  renovation: { label: 'Minor renovation',       fromPrice: null,  source: null },
};
const STATUSES = ['new', 'matched', 'in_progress', 'done', 'cancelled'];
const EVENT_TYPES = ['visit', 'form_open', 'form_submit', 'track_open', 'specialist_open'];

// ---------- Storage (single JSON file, atomic writes) ----------
const EMPTY_DB = { requests: [], specialists: [], feedback: [], claims: [], events: {} };

function loadDb() {
  try {
    return { ...EMPTY_DB, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return structuredClone(EMPTY_DB);
  }
}
let db = loadDb();

function saveDb() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- Helpers ----------
const newId = (prefix) => prefix + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const now = () => new Date().toISOString();
const clean = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normPhone = (p) => clean(p, 30).replace(/[^\d+]/g, '');

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function isAdmin(req) {
  const given = Buffer.from(String(req.headers['x-admin-password'] || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function estimateFor(category) {
  const c = CATEGORIES[category];
  if (!c) return null;
  return c.fromPrice
    ? { text: `from ${c.fromPrice.toLocaleString('en-US')} ₸`, fromPrice: c.fromPrice, source: c.source }
    : { text: 'fixed price after photo review', fromPrice: null, source: null };
}

function metrics() {
  const e = db.events;
  const visits = e.visit || 0;
  const opens = e.form_open || 0;
  const submitted = db.requests.length;
  const done = db.requests.filter((r) => r.status === 'done').length;
  const ratings = db.feedback.map((f) => f.rating).filter(Boolean);
  const wouldPay = db.feedback.filter((f) => f.wouldPayInApp === 'yes').length;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return {
    visits, formOpens: opens, requests: submitted,
    visitToRequestPct: pct(submitted, visits),
    formOpenToRequestPct: pct(submitted, opens),
    completed: done,
    specialistsApplied: db.specialists.length,
    specialistsApproved: db.specialists.filter((s) => s.status === 'approved').length,
    feedbackCount: db.feedback.length,
    avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null,
    wouldPayInAppPct: pct(wouldPay, db.feedback.length),
    guaranteeClaims: db.claims.length,
    byRole: countBy(db.requests, 'role'),
    byCategory: countBy(db.requests, 'category'),
  };
}
const countBy = (rows, key) => rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] || 0) + 1), acc), {});

function toCsv(rows, fields) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [fields.join(','), ...rows.map((r) => fields.map((f) => esc(r[f])).join(','))].join('\n');
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/categories') {
    return send(res, 200, Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c, estimate: estimateFor(id).text })));
  }

  if (method === 'POST' && pathname === '/api/events') {
    const { type } = await readBody(req);
    if (!EVENT_TYPES.includes(type)) return send(res, 400, { error: 'Unknown event type' });
    db.events[type] = (db.events[type] || 0) + 1;
    saveDb();
    return send(res, 200, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/requests') {
    const b = await readBody(req);
    const errors = [];
    if (!CATEGORIES[b.category]) errors.push('Choose a category.');
    if (clean(b.description).length < 10) errors.push('Describe the problem (at least 10 characters).');
    if (!clean(b.name, 80)) errors.push('Enter your name.');
    if (normPhone(b.phone).length < 10) errors.push('Enter a valid phone number.');
    if (!['owner', 'tenant', 'landlord'].includes(b.role)) errors.push('Choose who you are.');
    if (b.consent !== true) errors.push('Please agree to be contacted.');
    if (errors.length) return send(res, 400, { errors });

    const request = {
      id: newId('RH'),
      createdAt: now(),
      status: 'new',
      category: b.category,
      description: clean(b.description, 1000),
      district: clean(b.district, 80),
      property: clean(b.property, 80) || 'My flat',
      urgency: ['today', 'this_week', 'flexible'].includes(b.urgency) ? b.urgency : 'flexible',
      role: b.role,
      name: clean(b.name, 80),
      phone: normPhone(b.phone),
      estimate: estimateFor(b.category).text,
      specialistId: null,
      history: [{ at: now(), status: 'new' }],
    };
    db.requests.push(request);
    db.events.form_submit = (db.events.form_submit || 0) + 1;
    saveDb();
    return send(res, 201, { id: request.id, estimate: request.estimate });
  }

  // Customer tracking: all requests for a phone number, grouped on the client by property.
  if (method === 'GET' && pathname === '/api/track') {
    const phone = normPhone(url.searchParams.get('phone'));
    if (phone.length < 10) return send(res, 400, { error: 'Enter the phone number used in your request.' });
    const mine = db.requests
      .filter((r) => r.phone === phone)
      .map((r) => {
        const s = db.specialists.find((x) => x.id === r.specialistId);
        return {
          id: r.id, createdAt: r.createdAt, status: r.status, category: CATEGORIES[r.category].label,
          property: r.property, description: r.description, estimate: r.estimate,
          specialist: s ? { name: s.name, phone: s.phone } : null,
          hasFeedback: db.feedback.some((f) => f.requestId === r.id),
          hasClaim: db.claims.some((c) => c.requestId === r.id),
        };
      });
    return send(res, 200, mine);
  }

  if (method === 'POST' && pathname === '/api/feedback') {
    const b = await readBody(req);
    const r = db.requests.find((x) => x.id === b.requestId && x.phone === normPhone(b.phone));
    if (!r) return send(res, 404, { error: 'Request not found.' });
    const rating = Number(b.rating);
    if (!(rating >= 1 && rating <= 5)) return send(res, 400, { error: 'Rating must be 1–5.' });
    db.feedback = db.feedback.filter((f) => f.requestId !== r.id);
    db.feedback.push({
      requestId: r.id, createdAt: now(), rating,
      wouldUseAgain: ['yes', 'no', 'maybe'].includes(b.wouldUseAgain) ? b.wouldUseAgain : 'maybe',
      wouldPayInApp: ['yes', 'no', 'maybe'].includes(b.wouldPayInApp) ? b.wouldPayInApp : 'maybe',
      comment: clean(b.comment, 1000),
    });
    saveDb();
    return send(res, 201, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/claims') {
    const b = await readBody(req);
    const r = db.requests.find((x) => x.id === b.requestId && x.phone === normPhone(b.phone));
    if (!r) return send(res, 404, { error: 'Request not found.' });
    if (r.status !== 'done') return send(res, 400, { error: 'A claim can be opened after the job is marked done.' });
    if (clean(b.problem).length < 10) return send(res, 400, { error: 'Describe what went wrong.' });
    db.claims.push({ id: newId('CL'), requestId: r.id, createdAt: now(), problem: clean(b.problem, 1000), status: 'open' });
    saveDb();
    return send(res, 201, { ok: true });
  }

  if (method === 'POST' && pathname === '/api/specialists') {
    const b = await readBody(req);
    const categories = Array.isArray(b.categories) ? b.categories.filter((c) => CATEGORIES[c]) : [];
    const errors = [];
    if (!clean(b.name, 80)) errors.push('Enter your name.');
    if (normPhone(b.phone).length < 10) errors.push('Enter a valid phone number.');
    if (!categories.length) errors.push('Choose at least one category.');
    if (b.consent !== true) errors.push('Please agree to identity and experience checks.');
    if (errors.length) return send(res, 400, { errors });
    const s = {
      id: newId('SP'), createdAt: now(), status: 'pending',
      name: clean(b.name, 80), phone: normPhone(b.phone), categories,
      experienceYears: Math.max(0, Math.min(60, Number(b.experienceYears) || 0)),
      district: clean(b.district, 80), about: clean(b.about, 500),
    };
    db.specialists.push(s);
    saveDb();
    return send(res, 201, { id: s.id });
  }

  // ----- Admin (team) endpoints -----
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Wrong password.' });

    if (method === 'GET' && pathname === '/api/admin/overview') {
      return send(res, 200, { metrics: metrics(), requests: [...db.requests].reverse(),
        specialists: [...db.specialists].reverse(), feedback: db.feedback, claims: db.claims,
        categories: CATEGORIES, statuses: STATUSES });
    }

    const reqMatch = pathname.match(/^\/api\/admin\/requests\/([\w-]+)$/);
    if (method === 'PATCH' && reqMatch) {
      const r = db.requests.find((x) => x.id === reqMatch[1]);
      if (!r) return send(res, 404, { error: 'Not found' });
      const b = await readBody(req);
      if (b.status && STATUSES.includes(b.status) && b.status !== r.status) {
        r.status = b.status;
        r.history.push({ at: now(), status: b.status });
      }
      if (b.specialistId !== undefined) {
        const ok = b.specialistId === null || db.specialists.some((s) => s.id === b.specialistId && s.status === 'approved');
        if (!ok) return send(res, 400, { error: 'Only approved specialists can be assigned.' });
        r.specialistId = b.specialistId;
        if (b.specialistId && r.status === 'new') { r.status = 'matched'; r.history.push({ at: now(), status: 'matched' }); }
      }
      saveDb();
      return send(res, 200, r);
    }

    const spMatch = pathname.match(/^\/api\/admin\/specialists\/([\w-]+)$/);
    if (method === 'PATCH' && spMatch) {
      const s = db.specialists.find((x) => x.id === spMatch[1]);
      if (!s) return send(res, 404, { error: 'Not found' });
      const b = await readBody(req);
      if (['pending', 'approved', 'rejected'].includes(b.status)) s.status = b.status;
      saveDb();
      return send(res, 200, s);
    }

    if (method === 'GET' && pathname === '/api/admin/export.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="repairhub-requests.csv"' });
      return res.end(toCsv(db.requests, ['id', 'createdAt', 'status', 'role', 'category', 'district', 'property', 'urgency', 'estimate', 'description']));
    }
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- Static files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, content) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(res, decodeURIComponent(url.pathname));
  } catch (err) {
    return send(res, 400, { error: err.message || 'Bad request' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    console.log(`RepairHub MVP running at http://localhost:${PORT}`);
    if (lan) console.log(`On the same Wi-Fi, open http://${lan.address}:${PORT} on a phone`);
    console.log(`Team dashboard: http://localhost:${PORT}/admin.html`);
  });
}

module.exports = { server };
