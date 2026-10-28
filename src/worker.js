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

const randOtp = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// Fast SMS Provider Sender Function
async function sendSmsOtp(env, mobile, code, role) {
  let providerUsed = 'console_log';
  let success = false;
  let errorMsg = '';

  // 1. Fast2SMS
  if (env.FAST2SMS_API_KEY && env.FAST2SMS_API_KEY.trim() !== '') {
    try {
      const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(env.FAST2SMS_API_KEY)}&route=otp&variables_values=${code}&numbers=${mobile}`;
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      const data = await res.json().catch(() => ({}));
      if (data.return === true || res.ok) {
        providerUsed = 'Fast2SMS';
        success = true;
      } else {
        errorMsg = data.message || 'Fast2SMS error';
      }
    } catch (e) {
      errorMsg = e.message;
    }
  }

  // 2. 2Factor.in (Fallback or primary if configured)
  if (!success && env.TWOFACTOR_API_KEY && env.TWOFACTOR_API_KEY.trim() !== '') {
    try {
      const url = `https://2factor.in/v1/${encodeURIComponent(env.TWOFACTOR_API_KEY)}/SMS/${mobile}/${code}/OTP1`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
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

  // 3. Custom Gateway URL
  if (!success && env.SMS_GATEWAY_URL && env.SMS_GATEWAY_URL.trim() !== '') {
    try {
      const url = env.SMS_GATEWAY_URL.replace('{mobile}', mobile).replace('{otp}', code);
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

  console.log(`[YKR-OTP] Mobile: ${mobile} | Role: ${role} | Code: ${code} | Provider: ${providerUsed} | Success: ${success} ${errorMsg ? `| Error: ${errorMsg}` : ''}`);
  return { success, providerUsed, errorMsg };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const db = env.DB;
    const secret = env.SECRET || 'ykr-world-secret-change-in-prod';

    // Handle CORS preflight
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
      // 1. STATS API
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

      // 2. CANDIDATES API
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

      // Candidate toggle approval / delete
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

      // 3. LEADS API
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

      // Lead status patch / delete
      const leadMatch = url.pathname.match(/^\/api\/leads\/(\d+)$/);
      if (leadMatch) {
        const authUser = await getAuthUser();
        if (!authUser || (authUser.role !== 'Admin' && authUser.role !== 'Manager' && authUser.role !== 'HR')) {
          return json({ error: 'Unauthorized' }, 403);
        }
        const leadId = parseInt(leadMatch[1], 10);
        if (req.method === 'PATCH') {
          const { status, notes } = await body();
          if (status) {
            await db.prepare('UPDATE leads SET status=? WHERE id=?').bind(status, leadId).run();
          }
          if (notes !== undefined) {
            await db.prepare('UPDATE leads SET notes=? WHERE id=?').bind(notes, leadId).run();
          }
          return json({ ok: true });
        }
        if (req.method === 'DELETE' && authUser.role === 'Admin') {
          await db.prepare('DELETE FROM leads WHERE id=?').bind(leadId).run();
          return json({ ok: true });
        }
      }

      // 4. USERS API
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
          const { mobile, role, name } = await body();
          const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
          if (!validMobile(cleanMobile) || !ROLES.includes(role)) {
            return json({ error: 'Valid mobile and role are required.' }, 400);
          }
          await db.prepare('INSERT OR REPLACE INTO users(mobile, role, name) VALUES(?,?,?)')
            .bind(cleanMobile, role, String(name || 'Member').slice(0, 80)).run();
          return json({ ok: true });
        }
      }

      // 5. OTP SEND API
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

        // Generate Code: If DEMO_OTP is set to a code, use that; else generate random 6 digits
        const isDemo = env.DEMO_OTP && env.DEMO_OTP.trim() !== '';
        const code = isDemo ? env.DEMO_OTP.trim() : randOtp();

        await db.prepare('INSERT OR REPLACE INTO otps(mobile, code, expires, tries, sent, win) VALUES(?,?,?,?,?,?)')
          .bind(cleanMobile, code, now + 5 * 60 * 1000, 0, sent, win).run();

        // Dispatch real SMS
        const smsResult = await sendSmsOtp(env, cleanMobile, code, role);

        const respMsg = isDemo
          ? `OTP sent to +91 ${cleanMobile}. (Demo Mode OTP: ${code})`
          : `OTP sent successfully to +91 ${cleanMobile}.`;

        return json({
          ok: true,
          message: respMsg,
          demo: isDemo ? true : undefined,
          demoOtp: isDemo ? code : undefined
        });
      }

      // 6. OTP VERIFY API
      if (url.pathname === '/api/otp/verify' && req.method === 'POST') {
        const { mobile, role, code } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
        const bad = (msg = 'Invalid or expired OTP code.') => json({ error: msg }, 401);

        if (!validMobile(cleanMobile) || !ROLES.includes(role)) return bad('Invalid mobile or role.');

        const row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(cleanMobile).first();
        if (!row || row.expires < Date.now() || row.tries >= 5) return bad('Code expired or too many attempts. Request a new OTP.');

        await db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').bind(cleanMobile).run();
        if (String(row.code).trim() !== String(code).trim()) return bad('Incorrect OTP code entered.');

        // OTP verified successfully: delete consumed OTP
        await db.prepare('DELETE FROM otps WHERE mobile=?').bind(cleanMobile).run();

        // Insert user if not exists
        await db.prepare('INSERT OR IGNORE INTO users(mobile, role, name) VALUES(?,?,?)').bind(cleanMobile, role, 'Member').run();
        const user = await db.prepare('SELECT id, mobile, role, name FROM users WHERE mobile=? AND role=?').bind(cleanMobile, role).first();

        // Create 8-hour auth token
        const token = await signToken(secret, { id: user.id, role: user.role, exp: Date.now() + 8 * 3600 * 1000 });
        return json({ token, user, modules: MODULES[user.role] || [] });
      }

      // 7. ME API (Current Session Details)
      if (url.pathname === '/api/me') {
        const user = await getAuthUser();
        if (!user) return json({ error: 'Please sign in.' }, 401);

        const responseData = {
          user,
          modules: MODULES[user.role] || []
        };

        // If Admin, attach aggregate summary
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

      // 8. TEST SMS API (Admin tool)
      if (url.pathname === '/api/test-sms' && req.method === 'POST') {
        const authUser = await getAuthUser();
        if (!authUser || authUser.role !== 'Admin') {
          return json({ error: 'Unauthorized' }, 403);
        }
        const { mobile, message } = await body();
        const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
        if (!validMobile(cleanMobile)) return json({ error: 'Invalid 10-digit mobile number' }, 400);

        const testOtp = randOtp();
        const result = await sendSmsOtp(env, cleanMobile, testOtp, 'AdminTest');
        return json({ ok: true, result, code: testOtp });
      }

      // Static assets pass-through for Cloudflare Assets
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
