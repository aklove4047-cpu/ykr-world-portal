// YKR World - Express + SQLite Self-Hosted Server
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Database initialization: Use Node 22+ built-in node:sqlite or fallback to better-sqlite3
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(path.join(__dirname, 'ykr.db'));
} catch (e) {
  try {
    const BetterSqlite3 = require('better-sqlite3');
    db = new BetterSqlite3(path.join(__dirname, 'ykr.db'));
  } catch (err) {
    console.error('Failed to load SQLite module:', err);
    process.exit(1);
  }
}

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  });
}

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'ykr-world-secret-change-in-prod';
const DEMO_OTP = process.env.DEMO_OTP !== undefined ? process.env.DEMO_OTP : '123456';
const FAST2SMS_API_KEY = process.env.FAST2SMS_API_KEY || process.env.SMS_API_KEY || '';
const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY || '';
const SMS_GATEWAY_URL = process.env.SMS_GATEWAY_URL || '';

const ROLES = [
  'Student',
  'Business client',
  'Employer / recruiter',
  'Job seeker',
  'Digital / IT client',
  'Admin',
  'Manager',
  'Faculty',
  'Employee',
  'HR',
  'Accounts'
];

const MODULES = {
  'Student': ['My courses', 'Sessions & Attendance', 'Certificates', 'Placement Cell'],
  'Business client': ['Consulting Projects', 'SPANCO Pipeline', 'Invoices', 'Reports'],
  'Employer / recruiter': ['Post Requirement', 'Candidate Directory', 'Interview Requests'],
  'Job seeker': ['My Profile', 'Resume Vault', 'Job Applications', 'Pre-joining Bootcamp'],
  'Digital / IT client': ['Active Projects', 'SEO & Social Reports', 'Invoices', 'Support'],
  'Admin': ['Dashboard Overview', 'Leads CRM', 'Candidates Approval', 'Users & Roles', 'SMS / OTP Gateway'],
  'Manager': ['Team Overview', 'Client Projects', 'Branch Reports'],
  'Faculty': ['Active Batches', 'Student Attendance', 'Training Materials'],
  'Employee': ['Assigned Tasks', 'Daily Attendance', 'Payslips'],
  'HR': ['Candidate Approvals', 'Placements', 'Interviews', 'Staff Records'],
  'Accounts': ['Invoices & Billing', 'Receipts', 'Staff Payroll']
};

const schemaFile = path.join(__dirname, 'schema.sql');
if (fs.existsSync(schemaFile)) {
  db.exec(fs.readFileSync(schemaFile, 'utf8'));
} else {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, mobile TEXT NOT NULL, role TEXT NOT NULL, name TEXT DEFAULT 'Member', created TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(mobile, role));
    CREATE TABLE IF NOT EXISTS otps (mobile TEXT PRIMARY KEY, code TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, win INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS candidates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, qualification TEXT, experience TEXT, area TEXT, skills TEXT, approved INTEGER DEFAULT 1, created TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY, name TEXT NOT NULL, mobile TEXT NOT NULL, vertical TEXT, message TEXT, status TEXT DEFAULT 'new', notes TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
}

// Token helper
const signToken = payload => {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return b + '.' + sig;
};

const verifyToken = token => {
  const [b, s] = (token || '').split('.');
  if (!b || !s) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
};

const validMobile = m => /^[6-9]\d{9}$/.test(String(m || '').trim());
const randOtp = () => String(crypto.randomInt(100000, 1000000));

// Fast SMS OTP Sender
async function sendSmsOtp(mobile, code, role) {
  let providerUsed = 'console_log';
  let success = false;
  let errorMsg = '';
  let rawResponse = null;

  // 1. Fast2SMS
  if (FAST2SMS_API_KEY && FAST2SMS_API_KEY.trim() !== '') {
    try {
      const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': FAST2SMS_API_KEY.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: String(code),
          numbers: String(mobile)
        })
      });
      const data = await res.json().catch(() => ({}));
      rawResponse = data;

      if (data.return === true || (data.status_code === 200 && data.return)) {
        providerUsed = 'Fast2SMS';
        success = true;
      } else {
        errorMsg = data.message || `Fast2SMS Code ${data.status_code || res.status}`;
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  // 2. 2Factor.in
  if (!success && TWOFACTOR_API_KEY && TWOFACTOR_API_KEY.trim() !== '') {
    try {
      const url = `https://2factor.in/v1/${encodeURIComponent(TWOFACTOR_API_KEY)}/SMS/${mobile}/${code}/OTP1`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      rawResponse = data;
      if (data.Status === 'Success' || res.ok) {
        providerUsed = '2Factor';
        success = true;
      } else {
        errorMsg = data.Details || '2Factor API failed';
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  // 3. Custom Gateway URL
  if (!success && SMS_GATEWAY_URL && SMS_GATEWAY_URL.trim() !== '') {
    try {
      const url = SMS_GATEWAY_URL.replace('{mobile}', mobile).replace('{otp}', code);
      const res = await fetch(url);
      if (res.ok) {
        providerUsed = 'CustomGateway';
        success = true;
      } else {
        errorMsg = `Gateway HTTP ${res.status}`;
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  console.log(`[YKR-OTP] Mobile: ${mobile} | Role: ${role} | Code: ${code} | Provider: ${providerUsed} | Success: ${success} ${errorMsg ? `| Msg: ${errorMsg}` : ''}`);
  return { success, providerUsed, errorMsg, rawResponse };
}

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware Helper
const getAuthUser = req => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const decoded = verifyToken(token);
  if (!decoded) return null;
  return db.prepare('SELECT id, mobile, role, name FROM users WHERE id=?').get(decoded.id);
};

// 1. STATS
app.get('/api/stats', (_, res) => {
  const leadCount = db.prepare('SELECT COUNT(*) as c FROM leads').get()?.c || 0;
  const candCount = db.prepare('SELECT COUNT(*) as c FROM candidates WHERE approved=1').get()?.c || 0;
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
  res.json({
    verticals: 4,
    branches: 6,
    loginTypes: ROLES.length,
    years: '6+',
    leads: leadCount,
    candidates: candCount,
    users: userCount
  });
});

// 2. CANDIDATES
app.get('/api/candidates', (req, res) => {
  const authUser = getAuthUser(req);
  const isAdminOrHr = authUser && (authUser.role === 'Admin' || authUser.role === 'HR');
  const skill = '%' + (req.query.skill || '') + '%';

  if (isAdminOrHr && req.query.all === 'true') {
    return res.json(db.prepare('SELECT * FROM candidates WHERE skills LIKE ? ORDER BY id DESC').all(skill));
  }
  return res.json(db.prepare('SELECT id, name, qualification, experience, area, skills, approved FROM candidates WHERE approved=1 AND skills LIKE ? ORDER BY id DESC').all(skill));
});

app.post('/api/candidates', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
    return res.status(403).json({ error: 'Unauthorized: Admin or HR access required.' });
  }
  const { name, qualification, experience, area, skills, approved } = req.body || {};
  if (!name || !skills) {
    return res.status(400).json({ error: 'Name and skills are required.' });
  }
  const isAppr = approved === false || approved === 0 ? 0 : 1;
  const info = db.prepare('INSERT INTO candidates(name, qualification, experience, area, skills, approved) VALUES(?,?,?,?,?,?)')
    .run(String(name).slice(0, 100), String(qualification || '').slice(0, 50), String(experience || '').slice(0, 50), String(area || '').slice(0, 50), String(skills).slice(0, 200), isAppr);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/candidates/:id/approve', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const current = db.prepare('SELECT approved FROM candidates WHERE id=?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Candidate not found.' });
  const newStatus = current.approved ? 0 : 1;
  db.prepare('UPDATE candidates SET approved=? WHERE id=?').run(newStatus, req.params.id);
  res.json({ ok: true, approved: newStatus });
});

app.delete('/api/candidates/:id', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  db.prepare('DELETE FROM candidates WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 3. LEADS
app.post('/api/leads', (req, res) => {
  const { name, mobile, vertical, message } = req.body || {};
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!name || !validMobile(cleanMobile)) {
    return res.status(400).json({ error: 'Enter a valid name and 10-digit mobile number.' });
  }
  db.prepare('INSERT INTO leads(name, mobile, vertical, message, status) VALUES(?,?,?,?,?)')
    .run(String(name).slice(0, 80), cleanMobile, String(vertical || '').slice(0, 50), String(message || '').slice(0, 500), 'new');
  res.json({ ok: true, message: 'Thank you! Your enquiry has been received. Our team will contact you shortly.' });
});

app.get('/api/leads', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'Manager' && authUser.role !== 'HR')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json(db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 500').all());
});

app.patch('/api/leads/:id', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'Manager' && authUser.role !== 'HR')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { status, notes } = req.body || {};
  if (status) db.prepare('UPDATE leads SET status=? WHERE id=?').run(status, req.params.id);
  if (notes !== undefined) db.prepare('UPDATE leads SET notes=? WHERE id=?').run(notes, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/leads/:id', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  db.prepare('DELETE FROM leads WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 4. USERS
app.get('/api/users', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json(db.prepare('SELECT id, mobile, role, name, created FROM users ORDER BY id DESC').all());
});

app.post('/api/users', (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { mobile, role, name } = req.body || {};
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Valid mobile and role are required.' });
  }
  db.prepare('INSERT OR REPLACE INTO users(mobile, role, name) VALUES(?,?,?)')
    .run(cleanMobile, role, String(name || 'Member').slice(0, 80));
  res.json({ ok: true });
});

// 5. OTP SEND
app.post('/api/otp/send', async (req, res) => {
  const { mobile, role } = req.body || {};
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

  if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
    return res.status(400).json({ error: 'Please choose your login role and enter a valid 10-digit mobile.' });
  }

  const now = Date.now();
  const row = db.prepare('SELECT * FROM otps WHERE mobile=?').get(cleanMobile);
  let sent = 1, win = now;

  if (row && now - row.win < 15 * 60 * 1000) {
    if (row.sent >= 5) {
      return res.json({ ok: true, message: 'If this number is registered, an OTP has been dispatched (Rate limit active).' });
    }
    sent = row.sent + 1;
    win = row.win;
  }

  const isDemo = DEMO_OTP && DEMO_OTP.trim() !== '';
  const code = isDemo ? DEMO_OTP.trim() : randOtp();

  db.prepare('INSERT OR REPLACE INTO otps(mobile, code, expires, tries, sent, win) VALUES(?,?,?,?,?,?)')
    .run(cleanMobile, code, now + 5 * 60 * 1000, 0, sent, win);

  // Send via Fast SMS
  const smsResult = await sendSmsOtp(cleanMobile, code, role);

  if (smsResult.success) {
    return res.json({
      ok: true,
      message: `OTP sent via SMS to +91 ${cleanMobile}. Please enter code below.`,
      provider: smsResult.providerUsed
    });
  }

  const returnCode = isDemo ? code : (smsResult.errorMsg ? code : undefined);
  res.json({
    ok: true,
    message: smsResult.errorMsg
      ? `Notice: ${smsResult.errorMsg} (OTP Code: ${code})`
      : `OTP sent to +91 ${cleanMobile}. (Demo Code: ${code})`,
    demoOtp: returnCode,
    providerNotice: smsResult.errorMsg || undefined
  });
});

// 6. OTP VERIFY
app.post('/api/otp/verify', (req, res) => {
  const { mobile, role, code } = req.body || {};
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  const bad = (msg = 'Invalid or expired OTP code.') => res.status(401).json({ error: msg });

  if (!validMobile(cleanMobile) || !ROLES.includes(role)) return bad('Invalid mobile or role.');

  const row = db.prepare('SELECT * FROM otps WHERE mobile=?').get(cleanMobile);
  if (!row || row.expires < Date.now() || row.tries >= 5) return bad('Code expired or too many attempts.');

  db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').run(cleanMobile);
  if (String(row.code).trim() !== String(code).trim()) return bad('Incorrect OTP code entered.');

  db.prepare('DELETE FROM otps WHERE mobile=?').run(cleanMobile);
  db.prepare('INSERT OR IGNORE INTO users(mobile, role, name) VALUES(?,?,?)').run(cleanMobile, role, 'Member');
  const user = db.prepare('SELECT id, mobile, role, name FROM users WHERE mobile=? AND role=?').get(cleanMobile, role);

  const token = signToken({ id: user.id, role: user.role, exp: Date.now() + 8 * 3600 * 1000 });
  res.json({ token, user, modules: MODULES[user.role] || [] });
});

// 7. ME
app.get('/api/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in.' });

  const responseData = {
    user,
    modules: MODULES[user.role] || []
  };

  if (user.role === 'Admin' || user.role === 'HR' || user.role === 'Manager') {
    const leadCount = db.prepare('SELECT COUNT(*) as c FROM leads').get()?.c || 0;
    const newLeads = db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='new'").get()?.c || 0;
    const candCount = db.prepare('SELECT COUNT(*) as c FROM candidates').get()?.c || 0;
    const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0;
    responseData.adminStats = {
      totalLeads: leadCount,
      newLeads,
      totalCandidates: candCount,
      totalUsers: userCount
    };
  }

  res.json(responseData);
});

// 8. SMS STATUS & WALLET (Admin endpoint)
app.get('/api/sms/status', async (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  let wallet = null;
  if (FAST2SMS_API_KEY) {
    try {
      const wRes = await fetch('https://www.fast2sms.com/dev/wallet', {
        headers: { 'authorization': FAST2SMS_API_KEY.trim() }
      });
      wallet = await wRes.json().catch(() => ({}));
    } catch (e) {
      wallet = { error: e.message };
    }
  }
  res.json({
    hasKey: !!FAST2SMS_API_KEY,
    provider: 'Fast2SMS',
    wallet,
    demoMode: DEMO_OTP && DEMO_OTP.trim() !== ''
  });
});

// 9. TEST SMS (Admin)
app.post('/api/test-sms', async (req, res) => {
  const authUser = getAuthUser(req);
  if (!authUser || authUser.role !== 'Admin') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const cleanMobile = String(req.body?.mobile || '').replace(/\D/g, '').slice(-10);
  if (!validMobile(cleanMobile)) return res.status(400).json({ error: 'Invalid 10-digit mobile number' });

  const testOtp = randOtp();
  const result = await sendSmsOtp(cleanMobile, testOtp, 'AdminTest');
  res.json({ ok: true, result, code: testOtp });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` YKR World Platform running on http://localhost:${PORT}`);
  console.log(` DEMO_OTP: ${DEMO_OTP ? DEMO_OTP : 'DISABLED (Real SMS Only)'}`);
  console.log(` Fast2SMS Configured: ${FAST2SMS_API_KEY ? 'YES (Key Loaded)' : 'NO'}`);
  console.log(` 2Factor Configured: ${TWOFACTOR_API_KEY ? 'YES' : 'NO'}`);
  console.log(` Custom SMS Gateway: ${SMS_GATEWAY_URL ? 'YES' : 'NO'}`);
  console.log(`===============================================`);
});
