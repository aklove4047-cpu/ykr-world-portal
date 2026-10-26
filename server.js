require('fs').existsSync('.env') && require('fs').readFileSync('.env', 'utf8').split('\n').forEach(l => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
});
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const L = require('./lib');
const { db } = L;
const pay = require('./payments');

const app = express();
const PROD = process.env.NODE_ENV === 'production';
if (PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://checkout.razorpay.com'], styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", 'https://*.razorpay.com'],
  frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'], formAction: ["'self'"],
  upgradeInsecureRequests: PROD ? [] : null } } }));
app.use(cookieParser());

// Razorpay webhook needs the raw body for signature checking, so it is mounted before express.json().
app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), pay.webhook);

app.use(express.json({ limit: '200kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));
// CSRF defence in depth: SameSite cookie + reject cross-origin state changes.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.get('origin');
  try { if (o && new URL(o).host !== req.get('host')) return res.status(403).json({ error: 'Cross-origin request blocked' }); } catch { return res.status(403).end(); }
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const idOf = (s) => { s = String(s || '').trim(); return s.includes('@') ? { email: s.toLowerCase() } : { mobile: L.normMobile(s) }; };
const findUser = (identifier) => {
  const k = idOf(identifier); if (!k.email && !k.mobile) return null;
  return db.prepare(`SELECT * FROM users WHERE status='active' AND ${k.email ? 'email=?' : 'mobile=?'}`).get(k.email || k.mobile);
};

// Same response whether or not the account exists.
app.post('/api/auth/request-otp', authLimiter, (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase();
  const out = { ok: true, message: 'If this account is registered, a code has been sent.' };
  const u = findUser(identifier);
  if (u) {
    const recent = db.prepare('SELECT COUNT(*) n FROM otp_codes WHERE identifier=? AND expires_at>?').get(identifier, Date.now() - 5 * 60 * 1000).n;
    if (recent < 3) {
      const code = String(crypto.randomInt(100000, 1000000));
      db.prepare('UPDATE otp_codes SET used=1 WHERE identifier=?').run(identifier);
      db.prepare('INSERT INTO otp_codes(identifier,code_hash,expires_at) VALUES(?,?,?)').run(identifier, L.sha(code + ':' + identifier), Date.now() + 5 * 60 * 1000);
      L.sendOtp(identifier, code, u);
      if (!PROD && process.env.DEV_SHOW_OTP === 'true') out.dev_otp = code; // development convenience only
    }
  }
  res.json(out);
});
app.post('/api/auth/verify-otp', authLimiter, (req, res) => {
  const identifier = String(req.body?.identifier || '').trim().toLowerCase(), code = String(req.body?.code || '');
  const fail = () => res.status(400).json({ error: 'Invalid or expired code' });
  const row = db.prepare('SELECT * FROM otp_codes WHERE identifier=? AND used=0 ORDER BY id DESC LIMIT 1').get(identifier);
  const u = findUser(identifier);
  if (!row || !u || row.expires_at < Date.now() || row.attempts >= 5) return fail();
  db.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
  const a = Buffer.from(L.sha(code + ':' + identifier)), b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return fail();
  db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(row.id);
  res.cookie('token', L.sign(u), { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 8 * 3600 * 1000 });
  L.audit(u.user_id, 'login', 'user', u.user_id);
  res.json({ ok: true, user: { name: u.name, roles: L.rolesOf(u.user_id) } });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

// Public site forms
app.post('/api/public/enquiry', authLimiter, (req, res) => {
  const b = req.body || {}; if (!b.name || (!b.mobile && !b.email)) return res.status(400).json({ error: 'Name and contact required' });
  db.prepare('INSERT INTO enquiries(vertical,name,mobile,email,message) VALUES(?,?,?,?,?)')
    .run(String(b.vertical || '').slice(0, 40), String(b.name).slice(0, 100), String(b.mobile || '').slice(0, 20), String(b.email || '').slice(0, 100), String(b.message || '').slice(0, 1000));
  res.json({ ok: true });
});
app.post('/api/public/register-candidate', authLimiter, (req, res) => {
  const b = req.body || {}; const mobile = L.normMobile(b.mobile), email = String(b.email || '').trim().toLowerCase() || null;
  if (!b.name || (!mobile && !email) || b.consent !== true) return res.status(400).json({ error: 'Name, contact and consent are required' });
  try {
    db.transaction(() => {
      const id = db.prepare('INSERT INTO users(name,email,mobile) VALUES(?,?,?)').run(String(b.name).slice(0, 100), email, mobile).lastInsertRowid;
      db.prepare("INSERT INTO user_roles(user_id,role_code) VALUES(?, 'job_seeker')").run(id);
      db.prepare('INSERT INTO candidate_profiles(user_id,consent_at) VALUES(?,?)').run(id, L.now());
    })();
  } catch { /* already registered: same response, no information leaked */ }
  res.json({ ok: true, message: 'Registration received. You can log in with OTP.' });
});

app.use('/api', require('./portal'), pay.router);
app.use('/api/admin', require('./admin'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use((err, req, res, next) => {
  if (err.message === 'REASON') return res.status(400).json({ error: 'A reason is required to correct attendance' });
  console.error(err); res.status(500).json({ error: 'Something went wrong' });
});

// Seed first admin
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const id = db.prepare('INSERT INTO users(name,email,mobile) VALUES(?,?,?)').run(process.env.ADMIN_NAME || 'YKR Admin',
    (process.env.ADMIN_EMAIL || 'admin@ykrworld.in').toLowerCase(), L.normMobile(process.env.ADMIN_MOBILE || '9999999999')).lastInsertRowid;
  db.prepare("INSERT INTO user_roles(user_id,role_code) VALUES(?, 'admin')").run(id);
  console.log('Seeded admin user:', process.env.ADMIN_EMAIL || 'admin@ykrworld.in');
}
const port = process.env.PORT || 3000;
if (require.main === module) app.listen(port, () => console.log(`YKR World portal on http://localhost:${port}`));
module.exports = app;
