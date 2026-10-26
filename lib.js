const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET required in production');

const STAFF = ['admin', 'manager', 'hr', 'accounts', 'faculty', 'employee'];
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => new Date().toISOString();
const normMobile = (m) => { const d = String(m || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? d : null; };

function audit(actor, action, type, id, meta) {
  db.prepare('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,meta) VALUES(?,?,?,?,?)')
    .run(actor || null, action, type, String(id ?? ''), meta ? JSON.stringify(meta) : null);
}
function notify(userId, type, message) {
  if (userId) db.prepare('INSERT INTO notifications(user_id,type,message) VALUES(?,?,?)').run(userId, type, message);
}
const rolesOf = (uid) => db.prepare('SELECT role_code FROM user_roles WHERE user_id=?').all(uid).map(r => r.role_code);
const has = (u, ...codes) => u.roles.includes('admin') || codes.some(c => u.roles.includes(c));

function sign(user) {
  return jwt.sign({ uid: user.user_id }, SECRET, { expiresIn: '8h' });
}
// Loads the user fresh from DB on every request, so deactivation/role changes apply immediately.
function auth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies.token || '', SECRET);
    const u = db.prepare("SELECT user_id,name,email,mobile FROM users WHERE user_id=? AND status='active'").get(uid);
    if (!u) throw new Error('inactive');
    req.user = { ...u, roles: rolesOf(uid) };
    next();
  } catch { res.status(401).json({ error: 'Please log in' }); }
}
const need = (...codes) => (req, res, next) =>
  has(req.user, ...codes) ? next() : res.status(403).json({ error: 'Not allowed' });

// Does this user own / belong to the company?
const companyIds = (uid) => db.prepare('SELECT company_id FROM company_users WHERE user_id=?').all(uid).map(r => r.company_id);
const studentOf = (uid) => db.prepare('SELECT * FROM student_profiles WHERE user_id=?').get(uid);
const candidateOf = (uid) => db.prepare('SELECT * FROM candidate_profiles WHERE user_id=?').get(uid);
const employeeOf = (uid) => db.prepare('SELECT * FROM employees WHERE user_id=?').get(uid);

function canSeeInvoice(u, inv) {
  if (has(u, 'accounts')) return true;
  if (inv.user_id === u.user_id) return true;
  return !!inv.company_id && companyIds(u.user_id).includes(inv.company_id);
}
const paidSum = (invoiceId) =>
  db.prepare("SELECT COALESCE(SUM(amount_paise),0) s FROM payments WHERE invoice_id=? AND status='paid'").get(invoiceId).s;
function refreshInvoice(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE invoice_id=?').get(invoiceId);
  if (!inv || inv.status === 'cancelled') return inv;
  const paid = paidSum(invoiceId);
  const status = paid >= inv.total_paise ? 'paid' : paid > 0 ? 'partially_paid' : 'pending';
  db.prepare('UPDATE invoices SET status=? WHERE invoice_id=?').run(status, invoiceId);
  return { ...inv, status };
}
// Delivery of OTP: replace with your SMS / email provider.
function sendOtp(identifier, code) {
  console.log(`[OTP] ${identifier}: ${code}`);
}
module.exports = { db, STAFF, sha, now, normMobile, audit, notify, rolesOf, has, sign, auth, need, companyIds, studentOf,
  candidateOf, employeeOf, canSeeInvoice, paidSum, refreshInvoice, sendOtp };
