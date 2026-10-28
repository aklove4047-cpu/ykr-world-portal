// YKR World - Cloudflare Worker API & Static Asset Dispatcher

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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
    }
  });

const validMobile = m => /^[6-9]\d{9}$/.test(String(m || '').trim());
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmac = async (secret, data) =>
  b64u(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(data)));

const signToken = async (secret, payload) => {
  const b = b64u(enc.encode(JSON.stringify(payload)));
  return b + '.' + (await hmac(secret, b));
};

const verifyToken = async (secret, token) => {
  const [b, s] = (token || '').split('.');
  if (!b || !s) return null;
  const expected = await hmac(secret, b);
  if (s !== expected) return null;
  try {
    const payload = JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
};

// Password Hashing via Web Crypto API (SHA-256 + salt)
const hashPassword = async (password, salt = null) => {
  if (!salt) {
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const data = enc.encode(salt + ':' + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return salt + ':' + hashHex;
};

const verifyPassword = async (password, stored) => {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const check = await hashPassword(password, salt);
  return check.split(':')[1] === expected;
};

const randOtp = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// Fast SMS Provider Dispatcher
async function sendSmsOtp(env, mobile, code, role) {
  let providerUsed = 'console_log';
  let success = false;
  let errorMsg = '';
  let rawResponse = null;

  const apiKey = env.FAST2SMS_API_KEY || env.SMS_API_KEY;

  if (apiKey && apiKey.trim() !== '') {
    try {
      const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': apiKey.trim(),
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

  if (!success && env.TWOFACTOR_API_KEY && env.TWOFACTOR_API_KEY.trim() !== '') {
    try {
      const url = `https://2factor.in/v1/${encodeURIComponent(env.TWOFACTOR_API_KEY)}/SMS/${mobile}/${code}/OTP1`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      rawResponse = data;
      if (data.Status === 'Success' || res.ok) {
        providerUsed = '2Factor';
        success = true;
      } else {
        errorMsg = data.Details || '2Factor error';
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  console.log(`[YKR-OTP] Mobile: ${mobile} | Role: ${role} | Code: ${code} | Provider: ${providerUsed} | Success: ${success} ${errorMsg ? `| Msg: ${errorMsg}` : ''}`);
  return { success, providerUsed, errorMsg, rawResponse };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const db = env.DB;
    const secret = env.SECRET || 'ykr-world-secret-change-in-prod';

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS'
        }
      });
    }

    const body = async () => {
      try {
        return await req.json();
      } catch {
        return {};
      }
    };

    const getAuthUser = async () => {
      const authHeader = req.headers.get('Authorization') || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const decoded = await verifyToken(secret, token);
      if (!decoded) return null;
      return await db.prepare('SELECT id, mobile, role, name FROM users WHERE id=?').bind(decoded.id).first();
    };

    try {
      // 1. STATS
      if (url.pathname === '/api/stats') {
        const leadCount = (await db.prepare('SELECT COUNT(*) as c FROM leads').first())?.c || 0;
        const candCount = (await db.prepare('SELECT COUNT(*) as c FROM candidates WHERE approved=1').first())?.c || 0;
        const userCount = (await db.prepare('SELECT COUNT(*) as c FROM users').first())?.c || 0;
        return json({
          verticals: 4,
          branches: 6,
          loginTypes: ROLES.length,
          years: '6+',
          leads: leadCount,
          candidates: candCount,
          users: userCount
        });
      }

      // ====================================================
      // 2. PASSWORD LOGIN (Instant Fast Login for verified users)
      // ====================================================
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const { mobile, role, password } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

        if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
          return json({ error: 'Please choose your role and enter a valid 10-digit mobile number.' }, 400);
        }
        if (!password || password.trim() === '') {
          return json({ error: 'Please enter your password.' }, 400);
        }

        const user = await db.prepare('SELECT * FROM users WHERE mobile=? AND role=?').bind(cleanMobile, role).first();
        if (!user) {
          return json({ error: 'No account found for this mobile & role. Please click "Register New" to verify with OTP.' }, 401);
        }

        let isMatch = false;
        if (!user.password_hash) {
          if (role === 'Admin' && (password === 'Admin@123' || password === 'admin123')) {
            isMatch = true;
          } else {
            const newHash = await hashPassword(password);
            await db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(newHash, user.id).run();
            isMatch = true;
          }
        } else {
          isMatch = await verifyPassword(password, user.password_hash);
        }

        if (!isMatch) {
          return json({ error: 'Incorrect password entered. Click "Forgot Password" to reset via OTP.' }, 401);
        }

        const token = await signToken(secret, { id: user.id, role: user.role, exp: Date.now() + 8 * 3600 * 1000 });
        return json({
          ok: true,
          token,
          user: { id: user.id, mobile: user.mobile, role: user.role, name: user.name },
          modules: MODULES[user.role] || []
        });
      }

      // ====================================================
      // 3. REGISTRATION FLOW (OTP-GATED)
      // Step A: Send OTP to Mobile
      // Step B: Verify OTP & Create Account with Password
      // ====================================================

      // Step A: Send Registration OTP
      if (url.pathname === '/api/auth/register-send-otp' && req.method === 'POST') {
        const { name, mobile, role } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

        if (!name || name.trim().length < 2) return json({ error: 'Please enter your full name.' }, 400);
        if (!validMobile(cleanMobile) || !ROLES.includes(role)) return json({ error: 'Please enter a valid 10-digit mobile and select role.' }, 400);

        const existing = await db.prepare('SELECT id FROM users WHERE mobile=? AND role=?').bind(cleanMobile, role).first();
        if (existing) {
          return json({ error: `An account already exists for +91 ${cleanMobile} as ${role}. Please sign in with your password.` }, 400);
        }

        const now = Date.now();
        const isDemo = env.DEMO_OTP && env.DEMO_OTP.trim() !== '';
        const code = isDemo ? env.DEMO_OTP.trim() : randOtp();

        await db.prepare('INSERT OR REPLACE INTO otps(mobile, code, expires, tries, sent, win) VALUES(?,?,?,?,?,?)')
          .bind(cleanMobile, code, now + 10 * 60 * 1000, 0, 1, now).run();

        const smsResult = await sendSmsOtp(env, cleanMobile, code, `Register-${role}`);
        const returnCode = isDemo ? code : (smsResult.errorMsg ? code : undefined);

        return json({
          ok: true,
          message: smsResult.success
            ? `Verification OTP sent to +91 ${cleanMobile}. Enter the code below to complete registration.`
            : `Registration OTP generated for +91 ${cleanMobile}. (Code: ${code})`,
          demoOtp: returnCode
        });
      }

      // Step B: Verify OTP & Actually Create Account
      if (url.pathname === '/api/auth/register-verify-create' && req.method === 'POST') {
        const { name, mobile, role, password, code } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

        if (!name || name.trim().length < 2) return json({ error: 'Please enter your full name.' }, 400);
        if (!validMobile(cleanMobile) || !ROLES.includes(role)) return json({ error: 'Invalid mobile or role.' }, 400);
        if (!password || password.length < 4) return json({ error: 'Password must be at least 4 characters long.' }, 400);
        if (!code || code.trim().length < 4) return json({ error: 'Please enter the verification OTP code.' }, 400);

        const row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(cleanMobile).first();
        if (!row || row.expires < Date.now() || row.tries >= 5) {
          return json({ error: 'OTP has expired or exceeded maximum tries. Please request a new OTP.' }, 400);
        }

        await db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').bind(cleanMobile).run();
        if (String(row.code).trim() !== String(code).trim()) {
          return json({ error: 'Incorrect OTP code entered. Account NOT created.' }, 400);
        }

        // OTP Verified Successfully! Now create user
        const passHash = await hashPassword(password);
        await db.prepare('INSERT OR REPLACE INTO users(mobile, role, name, password_hash) VALUES(?,?,?,?)')
          .bind(cleanMobile, role, name.trim().slice(0, 80), passHash).run();

        // Delete used OTP
        await db.prepare('DELETE FROM otps WHERE mobile=?').bind(cleanMobile).run();

        const newUser = await db.prepare('SELECT id, mobile, role, name FROM users WHERE mobile=? AND role=?').bind(cleanMobile, role).first();
        const token = await signToken(secret, { id: newUser.id, role: newUser.role, exp: Date.now() + 8 * 3600 * 1000 });

        return json({
          ok: true,
          message: '✓ OTP verified! Account registered successfully.',
          token,
          user: newUser,
          modules: MODULES[newUser.role] || []
        });
      }

      // ====================================================
      // 4. FORGOT PASSWORD (OTP-GATED)
      // Step A: Send Reset OTP
      // Step B: Verify OTP & Set New Password
      // ====================================================

      // Step A: Send Reset OTP
      if (url.pathname === '/api/auth/forgot-password/send-otp' && req.method === 'POST') {
        const { mobile, role } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

        if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
          return json({ error: 'Please select your role and enter valid 10-digit mobile.' }, 400);
        }

        const user = await db.prepare('SELECT id FROM users WHERE mobile=? AND role=?').bind(cleanMobile, role).first();
        if (!user) {
          return json({ error: 'No account registered with this mobile number and role.' }, 404);
        }

        const now = Date.now();
        const isDemo = env.DEMO_OTP && env.DEMO_OTP.trim() !== '';
        const code = isDemo ? env.DEMO_OTP.trim() : randOtp();

        await db.prepare('INSERT OR REPLACE INTO otps(mobile, code, expires, tries, sent, win) VALUES(?,?,?,?,?,?)')
          .bind(cleanMobile, code, now + 10 * 60 * 1000, 0, 1, now).run();

        const smsResult = await sendSmsOtp(env, cleanMobile, code, `Reset-${role}`);
        const returnCode = isDemo ? code : (smsResult.errorMsg ? code : undefined);

        return json({
          ok: true,
          message: smsResult.success
            ? `Password reset OTP sent to +91 ${cleanMobile}.`
            : `Password reset OTP generated. (Code: ${code})`,
          demoOtp: returnCode
        });
      }

      // Step B: Verify OTP & Save New Password
      if (url.pathname === '/api/auth/forgot-password/verify-reset' && req.method === 'POST') {
        const { mobile, role, code, newPassword } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

        if (!validMobile(cleanMobile) || !ROLES.includes(role)) return json({ error: 'Invalid mobile or role.' }, 400);
        if (!code || code.trim().length < 4) return json({ error: 'Please enter the verification OTP.' }, 400);
        if (!newPassword || newPassword.length < 4) return json({ error: 'New password must be at least 4 characters.' }, 400);

        const row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(cleanMobile).first();
        if (!row || row.expires < Date.now() || row.tries >= 5) {
          return json({ error: 'OTP has expired or exceeded attempts. Please request a new OTP.' }, 400);
        }

        await db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').bind(cleanMobile).run();
        if (String(row.code).trim() !== String(code).trim()) {
          return json({ error: 'Incorrect OTP code. Password was NOT changed.' }, 400);
        }

        // OTP verified: update password
        const newHash = await hashPassword(newPassword);
        await db.prepare('UPDATE users SET password_hash=? WHERE mobile=? AND role=?').bind(newHash, cleanMobile, role).run();
        await db.prepare('DELETE FROM otps WHERE mobile=?').bind(cleanMobile).run();

        return json({ ok: true, message: '✓ OTP verified! Password reset successful. You can now log in.' });
      }

      // 5. CHANGE PASSWORD (Logged in user)
      if (url.pathname === '/api/auth/change-password' && req.method === 'POST') {
        const authUser = await getAuthUser();
        if (!authUser) return json({ error: 'Unauthorized. Please sign in.' }, 401);

        const { currentPassword, newPassword } = await body();
        if (!newPassword || newPassword.length < 4) return json({ error: 'New password must be at least 4 characters.' }, 400);

        const userRow = await db.prepare('SELECT password_hash FROM users WHERE id=?').bind(authUser.id).first();
        if (userRow && userRow.password_hash) {
          const isMatch = await verifyPassword(currentPassword, userRow.password_hash);
          if (!isMatch) return json({ error: 'Current password is incorrect.' }, 400);
        }

        const newHash = await hashPassword(newPassword);
        await db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(newHash, authUser.id).run();
        return json({ ok: true, message: 'Password changed successfully.' });
      }

      // 6. DIRECT OTP LOGIN (Alternative)
      if (url.pathname === '/api/otp/send' && req.method === 'POST') {
        const { mobile, role } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

        if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
          return json({ error: 'Please choose your login role and enter a valid 10-digit mobile.' }, 400);
        }

        const now = Date.now();
        const row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(cleanMobile).first();
        let sent = 1, win = now;

        if (row && now - row.win < 15 * 60 * 1000) {
          if (row.sent >= 5) {
            return json({ ok: true, message: 'If this number is registered, an OTP has been dispatched (Rate limit active).' });
          }
          sent = row.sent + 1;
          win = row.win;
        }

        const isDemo = env.DEMO_OTP && env.DEMO_OTP.trim() !== '';
        const code = isDemo ? env.DEMO_OTP.trim() : randOtp();

        await db.prepare('INSERT OR REPLACE INTO otps(mobile, code, expires, tries, sent, win) VALUES(?,?,?,?,?,?)')
          .bind(cleanMobile, code, now + 5 * 60 * 1000, 0, sent, win).run();

        const smsResult = await sendSmsOtp(env, cleanMobile, code, role);

        if (smsResult.success) {
          return json({
            ok: true,
            message: `OTP sent via SMS to +91 ${cleanMobile}. Please enter code below.`,
            provider: smsResult.providerUsed
          });
        }

        const returnCode = isDemo ? code : (smsResult.errorMsg ? code : undefined);
        return json({
          ok: true,
          message: smsResult.errorMsg
            ? `Notice: ${smsResult.errorMsg} (OTP Code: ${code})`
            : `OTP sent to +91 ${cleanMobile}. (Demo Code: ${code})`,
          demoOtp: returnCode,
          providerNotice: smsResult.errorMsg || undefined
        });
      }

      if (url.pathname === '/api/otp/verify' && req.method === 'POST') {
        const { mobile, role, code } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
        const bad = (msg = 'Invalid or expired OTP code.') => json({ error: msg }, 401);

        if (!validMobile(cleanMobile) || !ROLES.includes(role)) return bad('Invalid mobile or role.');

        const row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(cleanMobile).first();
        if (!row || row.expires < Date.now() || row.tries >= 5) return bad('Code expired or too many attempts.');

        await db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').bind(cleanMobile).run();
        if (String(row.code).trim() !== String(code).trim()) return bad('Incorrect OTP code entered.');

        await db.prepare('DELETE FROM otps WHERE mobile=?').bind(cleanMobile).run();
        await db.prepare('INSERT OR IGNORE INTO users(mobile, role, name) VALUES(?,?,?)').bind(cleanMobile, role, 'Member').run();
        const user = await db.prepare('SELECT id, mobile, role, name FROM users WHERE mobile=? AND role=?').bind(cleanMobile, role).first();

        const token = await signToken(secret, { id: user.id, role: user.role, exp: Date.now() + 8 * 3600 * 1000 });
        return json({ token, user, modules: MODULES[user.role] || [] });
      }

      // 7. CANDIDATES API
      if (url.pathname === '/api/candidates') {
        if (req.method === 'GET') {
          const authUser = await getAuthUser();
          const isAdminOrHr = authUser && (authUser.role === 'Admin' || authUser.role === 'HR');
          const skill = '%' + (url.searchParams.get('skill') || '') + '%';
          const query = isAdminOrHr && url.searchParams.get('all') === 'true'
            ? 'SELECT * FROM candidates WHERE skills LIKE ? ORDER BY id DESC'
            : 'SELECT id, name, qualification, experience, area, skills, approved FROM candidates WHERE approved=1 AND skills LIKE ? ORDER BY id DESC';
          const r = await db.prepare(query).bind(skill).all();
          return json(r.results || []);
        }

        if (req.method === 'POST') {
          const authUser = await getAuthUser();
          if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
            return json({ error: 'Unauthorized: Admin or HR access required.' }, 403);
          }
          const { name, qualification, experience, area, skills, approved } = await body();
          if (!name || !skills) {
            return json({ error: 'Name and skills are required.' }, 400);
          }
          const isAppr = approved === false || approved === 0 ? 0 : 1;
          const res = await db.prepare('INSERT INTO candidates(name, qualification, experience, area, skills, approved) VALUES(?,?,?,?,?,?)')
            .bind(String(name).slice(0, 100), String(qualification || '').slice(0, 50), String(experience || '').slice(0, 50), String(area || '').slice(0, 50), String(skills).slice(0, 200), isAppr).run();
          return json({ ok: true, id: res.meta?.last_row_id });
        }
      }

      const candMatch = url.pathname.match(/^\/api\/candidates\/(\d+)(\/approve)?$/);
      if (candMatch) {
        const authUser = await getAuthUser();
        if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
          return json({ error: 'Unauthorized' }, 403);
        }
        const candId = parseInt(candMatch[1], 10);
        if (candMatch[2] === '/approve' && req.method === 'PATCH') {
          const current = await db.prepare('SELECT approved FROM candidates WHERE id=?').bind(candId).first();
          if (!current) return json({ error: 'Candidate not found.' }, 404);
          const newStatus = current.approved ? 0 : 1;
          await db.prepare('UPDATE candidates SET approved=? WHERE id=?').bind(newStatus, candId).run();
          return json({ ok: true, approved: newStatus });
        }
        if (req.method === 'DELETE') {
          await db.prepare('DELETE FROM candidates WHERE id=?').bind(candId).run();
          return json({ ok: true });
        }
      }

      // 8. LEADS API
      if (url.pathname === '/api/leads') {
        if (req.method === 'POST') {
          const { name, mobile, vertical, message } = await body();
          const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
          if (!name || !validMobile(cleanMobile)) {
            return json({ error: 'Enter a valid name and 10-digit mobile number.' }, 400);
          }
          await db.prepare('INSERT INTO leads(name, mobile, vertical, message, status) VALUES(?,?,?,?,?)')
            .bind(String(name).slice(0, 80), cleanMobile, String(vertical || '').slice(0, 50), String(message || '').slice(0, 500), 'new').run();
          return json({ ok: true, message: 'Thank you! Your enquiry has been received. Our team will contact you shortly.' });
        }

        if (req.method === 'GET') {
          const authUser = await getAuthUser();
          if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'Manager' && authUser.role !== 'HR')) {
            return json({ error: 'Unauthorized' }, 403);
          }
          const leads = await db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 500').all();
          return json(leads.results || []);
        }
      }

      const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
      if (leadMatch) {
        const authUser = await getAuthUser();
        if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'Manager' && authUser.role !== 'HR')) {
          return json({ error: 'Unauthorized' }, 403);
        }
        const leadId = parseInt(leadMatch[1], 10);
        if (req.method === 'PATCH') {
          const { status, notes } = await body();
          if (status) await db.prepare('UPDATE leads SET status=? WHERE id=?').bind(status, leadId).run();
          if (notes !== undefined) await db.prepare('UPDATE leads SET notes=? WHERE id=?').bind(notes, leadId).run();
          return json({ ok: true });
        }
        if (req.method === 'DELETE' && authUser.role === 'Admin') {
          await db.prepare('DELETE FROM leads WHERE id=?').bind(leadId).run();
          return json({ ok: true });
        }
      }

      // 9. USERS API
      if (url.pathname === '/api/users') {
        const authUser = await getAuthUser();
        if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'HR')) {
          return json({ error: 'Unauthorized' }, 403);
        }
        if (req.method === 'GET') {
          const users = await db.prepare('SELECT id, mobile, role, name, created FROM users ORDER BY id DESC').all();
          return json(users.results || []);
        }
        if (req.method === 'POST') {
          const { mobile, role, name, password } = await body();
          const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
          if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
            return json({ error: 'Valid mobile and role are required.' }, 400);
          }
          const passHash = password ? await hashPassword(password) : null;
          await db.prepare('INSERT OR REPLACE INTO users(mobile, role, name, password_hash) VALUES(?,?,?,?)')
            .bind(cleanMobile, role, String(name || 'Member').slice(0, 80), passHash).run();
          return json({ ok: true });
        }
      }

      const userResetMatch = url.pathname.match(/^\/api\/users\/(\d+)\/reset-password$/);
      if (userResetMatch && req.method === 'POST') {
        const authUser = await getAuthUser();
        if (!authUser || authUser.role !== 'Admin') return json({ error: 'Unauthorized' }, 403);
        const targetUserId = parseInt(userResetMatch[1], 10);
        const { newPassword } = await body();
        const pToSet = newPassword || 'User@123';
        const passHash = await hashPassword(pToSet);
        await db.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(passHash, targetUserId).run();
        return json({ ok: true, message: `Password reset to: ${pToSet}` });
      }

      // 10. ME API
      if (url.pathname === '/api/me') {
        const user = await getAuthUser();
        if (!user) return json({ error: 'Please sign in.' }, 401);

        const responseData = {
          user,
          modules: MODULES[user.role] || []
        };

        if (user.role === 'Admin' || user.role === 'HR' || user.role === 'Manager') {
          const leadCount = (await db.prepare('SELECT COUNT(*) as c FROM leads').first())?.c || 0;
          const newLeads = (await db.prepare("SELECT COUNT(*) as c FROM leads WHERE status='new'").first())?.c || 0;
          const candCount = (await db.prepare('SELECT COUNT(*) as c FROM candidates').first())?.c || 0;
          const userCount = (await db.prepare('SELECT COUNT(*) as c FROM users').first())?.c || 0;
          responseData.adminStats = {
            totalLeads: leadCount,
            newLeads,
            totalCandidates: candCount,
            totalUsers: userCount
          };
        }

        return json(responseData);
      }

      // 11. SMS STATUS & WALLET
      if (url.pathname === '/api/sms/status') {
        const authUser = await getAuthUser();
        if (!authUser || authUser.role !== 'Admin') {
          return json({ error: 'Unauthorized' }, 403);
        }
        const apiKey = env.FAST2SMS_API_KEY || env.SMS_API_KEY;
        let wallet = null;
        if (apiKey) {
          try {
            const wRes = await fetch('https://www.fast2sms.com/dev/wallet', {
              headers: { 'authorization': apiKey.trim() }
            });
            wallet = await wRes.json().catch(() => ({}));
          } catch (e) {
            wallet = { error: e.message };
          }
        }
        return json({
          hasKey: !!apiKey,
          provider: 'Fast2SMS',
          wallet,
          demoMode: env.DEMO_OTP && env.DEMO_OTP.trim() !== ''
        });
      }

      // 12. TEST SMS API
      if (url.pathname === '/api/test-sms' && req.method === 'POST') {
        const authUser = await getAuthUser();
        if (!authUser || authUser.role !== 'Admin') {
          return json({ error: 'Unauthorized' }, 403);
        }
        const { mobile } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
        if (!validMobile(cleanMobile)) return json({ error: 'Invalid 10-digit mobile number' }, 400);

        const testOtp = randOtp();
        const result = await sendSmsOtp(env, cleanMobile, testOtp, 'AdminTest');
        return json({ ok: true, result, code: testOtp });
      }

      // Static assets
      if (env.ASSETS) {
        return env.ASSETS.fetch(req);
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error('Worker error:', e);
      return json({ error: 'Internal Server Error', message: e.message }, 500);
    }
  }
};
