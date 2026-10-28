# YKR World – Website & Client Portal (PRD v1.0, build from prototype video)

## 1. Goal
One mobile-first website + secure portal for YKR World: "Transforming businesses, empowering people." Four verticals, one login system, zero-cost self-hostable stack.

## 2. Users & 11 login types
Customers: Student, Business client, Employer/recruiter, Job seeker, Digital/IT client.
Staff & management: Admin, Manager, Faculty, Employee, HR, Accounts.

## 3. Scope (as seen in prototype)
- **Home**: hero, CTAs (Explore courses / Hire or get placed / Client & staff login), stats (4 verticals, 6 branches in PCMC, 11 login types, 6+ yrs), mission & values.
- **Individual Training**: Spoken English, Public Speaking, Soft Skills & Etiquette, Career & Interviews (resume, LinkedIn, mock interviews, salary negotiation), Political Leadership Development Programme.
- **Business Training & Consultancy**: Diagnose → Plan → Deliver → Review; SPANCO pipeline (Suspect, Prospect, Approach, Negotiate, Close, Order); Eliminate time-wasters; workshops.
- **HR Recruitment & Placement**: Register as Candidate, Hire From Us / Company login; precision sourcing, pre-joining bootcamp, onboarding; public candidate list (skill summary only, resume/contact locked until authorised); placed students & partner logos (after approval).
- **Digital & IT**: websites, SEO, social media, short video, monthly reports.
- **Sign-in**: choose login type, mobile number, 6-digit OTP, "Forgot access" never reveals whether an account exists.
- **Footer**: +91 7218550652, ykrtraininginstitute@gmail.com, HQ Talwade IT Park; branches Dehugaon, Talwade, Chikhali, Sane Chowk, Chinchwad, Bhosari.

## 4. Functional requirements
1. OTP login by mobile + role; generic error messages; rate limit (5 OTP/15 min/number).
2. Public candidate API returns only name-initial, qualification, experience, area, skills.
3. Lead/enquiry form saves to DB (name, mobile, vertical, message).
4. Role dashboard after login (v1: greeting + role modules list).
5. Admin can approve candidates and logos (v2).

## 5. Non-functional
Free stack: Node.js 18+, Express, SQLite (better-sqlite3). No paid SMS in v1: OTP printed to server console (`DEMO_OTP=123456` for demo). Mobile-first, glassmorphism UI, HTTPS via Caddy/Nginx + Let's Encrypt. Backup = copy `ykr.db`.

## 6. Data model
users(id, mobile, role, name) · otps(mobile, code, expires, tries) · candidates(id, name, qualification, experience, area, skills, approved) · leads(id, name, mobile, vertical, message, created)

## 7. API
GET /api/stats · GET /api/candidates?skill= · POST /api/leads · POST /api/otp/send · POST /api/otp/verify · GET /api/me (Bearer token)

## 8. Roadmap (not in this build)
Razorpay payments, staff/faculty/HR payroll, course enrolment & attendance, resume vault with consent, SMS OTP provider, admin approval panel.

## 9. Run
`npm install && npm start` → http://localhost:3000

## 10. Deployment (free)
Primary: GitHub → Cloudflare Workers (static site via Workers Assets + API in a Worker + D1 SQLite). Alternative: self-host `server.js` on any VPS behind Caddy/Nginx or a Cloudflare Tunnel. See README.md.

---
# 11. Full Code (copy-paste each file into the same path)

## File: README.md
~~~markdown
# YKR World – GitHub + Cloudflare deploy guide

Two ways to run the same site:
- **Cloudflare (free):** `src/worker.js` + D1 database + `public/` (this guide)
- **Self-host / VPS:** `server.js` (Express + SQLite) → `npm install && DEMO_OTP=123456 npm start`

## 1. Push to GitHub
1. On github.com create a new EMPTY repo named `ykr-world` (no README).
2. In the project folder:
```
git init
git add .
git commit -m "YKR World v1"
git branch -M main
git remote add origin https://github.com/<your-username>/ykr-world.git
git push -u origin main
```

## 2. One-time Cloudflare setup (run in project folder)
```
npm install
npx wrangler login
npx wrangler d1 create ykr-db
```
Copy the `database_id` it prints into `wrangler.toml` (replace PASTE_DATABASE_ID_HERE), then:
```
npx wrangler d1 execute ykr-db --remote --file=schema.sql
npx wrangler secret put SECRET
npx wrangler deploy
```
(`SECRET`: type any long random string. Run schema.sql only ONCE, it inserts sample candidates.)
Site goes live at https://ykr-world.<your-subdomain>.workers.dev

## 3. Auto-deploy on every GitHub push
Commit the updated `wrangler.toml` (with your database_id) and push. Then in the Cloudflare dashboard:
Workers & Pages → Create → Import a repository → pick `ykr-world` → Build command: leave empty → Deploy command: `npx wrangler deploy` → Save and Deploy.
Add the `SECRET` under Settings → Variables and Secrets if the dashboard asks.

## 4. Custom domain
Workers & Pages → ykr-world → Settings → Domains & Routes → Add → Custom domain.

## 5. Before real users
- `DEMO_OTP` in wrangler.toml lets anyone sign in with 123456. Set it to "" and add an SMS provider call in `src/worker.js` (marked comment) first.
- Change SECRET (never commit it).

## Local test
```
npx wrangler d1 execute ykr-db --local --file=schema.sql
npx wrangler dev
```
~~~

## File: package.json
```json
{
  "name": "ykr-world",
  "version": "1.1.0",
  "private": true,
  "scripts": {
    "start": "node server.js",
    "cf:dev": "wrangler dev",
    "cf:deploy": "wrangler deploy"
  },
  "dependencies": { "better-sqlite3": "^11.0.0", "express": "^4.19.2" },
  "devDependencies": { "wrangler": "^4.0.0" }
}
```

## File: wrangler.toml
```toml
name = "ykr-world"
main = "src/worker.js"
compatibility_date = "2026-10-01"

[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = ["/api/*"]

[vars]
DEMO_OTP = "123456"   # prototype only. Remove/empty once a real SMS provider is added.

[[d1_databases]]
binding = "DB"
database_name = "ykr-db"
database_id = "PASTE_DATABASE_ID_HERE"
```

## File: schema.sql
```sql
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, mobile TEXT, role TEXT, name TEXT, UNIQUE(mobile, role));
CREATE TABLE IF NOT EXISTS otps(mobile TEXT PRIMARY KEY, code TEXT, expires INTEGER, tries INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, win INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS candidates(id INTEGER PRIMARY KEY, name TEXT, qualification TEXT, experience TEXT, area TEXT, skills TEXT, approved INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY, name TEXT, mobile TEXT, vertical TEXT, message TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO candidates(name,qualification,experience,area,skills) VALUES
('Aditi S.','B.Com','2 yrs','Pune','Sales, Communication'),
('Rohan K.','BBA','fresher','Pimpri-Chinchwad','Digital Marketing'),
('Sneha M.','BA','1 yr','Chikhali','Customer Support'),
('Vikram J.','MBA','4 yrs','Chinchwad','Sales');
```

## File: .gitignore
```
node_modules/
ykr.db
.wrangler/
.dev.vars
```

## File: src/worker.js
```javascript
const ROLES = ['Student','Business client','Employer / recruiter','Job seeker','Digital / IT client','Admin','Manager','Faculty','Employee','HR','Accounts'];
const MODULES = {
  'Student':['My courses','Sessions','Certificates','Placement cell'],'Business client':['Projects','Sessions','Invoices','Reports'],
  'Employer / recruiter':['Post requirement','Candidates','Interviews'],'Job seeker':['My profile','Resume','Applications'],
  'Digital / IT client':['Projects','Monthly reports','Invoices'],'Admin':['Users','Approvals','Leads','Settings'],
  'Manager':['Team','Projects','Reports'],'Faculty':['Batches','Attendance','Materials'],'Employee':['Tasks','Attendance','Payslips'],
  'HR':['Candidates','Placements','Payroll'],'Accounts':['Payments','Invoices','Payroll']
};
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const validMobile = m => /^[6-9]\d{9}$/.test(m || '');
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hmac = async (secret, data) => b64u(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']), enc.encode(data)));
const sign = async (secret, p) => { const b = b64u(enc.encode(JSON.stringify(p))); return b + '.' + await hmac(secret, b); };
const verify = async (secret, t) => {
  const [b, s] = (t || '').split('.'); if (!b || !s || s !== await hmac(secret, b)) return null;
  try { const p = JSON.parse(atob(b.replace(/-/g,'+').replace(/_/g,'/'))); return p.exp > Date.now() ? p : null; } catch { return null; }
};
const randOtp = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

export default {
  async fetch(req, env) {
    const url = new URL(req.url), db = env.DB, secret = env.SECRET || 'change-this-secret';
    const body = async () => { try { return await req.json(); } catch { return {}; } };
    try {
      if (url.pathname === '/api/stats') return json({ verticals: 4, branches: 6, loginTypes: ROLES.length, years: '6+' });

      if (url.pathname === '/api/candidates') {
        const r = await db.prepare('SELECT name,qualification,experience,area,skills FROM candidates WHERE approved=1 AND skills LIKE ?')
          .bind('%' + (url.searchParams.get('skill') || '') + '%').all();
        return json(r.results);
      }

      if (url.pathname === '/api/leads' && req.method === 'POST') {
        const { name, mobile, vertical, message } = await body();
        if (!name || !validMobile(mobile)) return json({ error: 'Enter a valid name and 10-digit mobile.' }, 400);
        await db.prepare('INSERT INTO leads(name,mobile,vertical,message) VALUES(?,?,?,?)')
          .bind(String(name).slice(0,80), mobile, String(vertical||'').slice(0,40), String(message||'').slice(0,500)).run();
        return json({ ok: true });
      }

      if (url.pathname === '/api/otp/send' && req.method === 'POST') {
        const { mobile, role } = await body();
        const generic = { ok: true, message: 'If this number is eligible, an OTP has been sent.' };
        if (!validMobile(mobile) || !ROLES.includes(role)) return json({ error: 'Choose a login type and enter a valid mobile.' }, 400);
        const now = Date.now(), row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(mobile).first();
        let sent = 1, win = now;
        if (row && now - row.win < 900000) { if (row.sent >= 5) return json(generic); sent = row.sent + 1; win = row.win; }
        const code = env.DEMO_OTP || randOtp();
        await db.prepare('INSERT OR REPLACE INTO otps(mobile,code,expires,tries,sent,win) VALUES(?,?,?,?,?,?)').bind(mobile, code, now + 300000, 0, sent, win).run();
        console.log(`[OTP] ${mobile} (${role})`); // add SMS provider call here
        return json(generic);
      }

      if (url.pathname === '/api/otp/verify' && req.method === 'POST') {
        const { mobile, role, code } = await body();
        const bad = () => json({ error: 'Invalid or expired code.' }, 401);
        if (!validMobile(mobile) || !ROLES.includes(role)) return bad();
        const row = await db.prepare('SELECT * FROM otps WHERE mobile=?').bind(mobile).first();
        if (!row || row.expires < Date.now() || row.tries >= 5) return bad();
        await db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').bind(mobile).run();
        if (row.code !== String(code)) return bad();
        await db.prepare('DELETE FROM otps WHERE mobile=?').bind(mobile).run();
        await db.prepare('INSERT OR IGNORE INTO users(mobile,role,name) VALUES(?,?,?)').bind(mobile, role, 'Member').run();
        const u = await db.prepare('SELECT id,mobile,role,name FROM users WHERE mobile=? AND role=?').bind(mobile, role).first();
        return json({ token: await sign(secret, { id: u.id, role: u.role, exp: Date.now() + 8 * 3600000 }), user: u });
      }

      if (url.pathname === '/api/me') {
        const p = await verify(secret, (req.headers.get('Authorization') || '').replace('Bearer ', ''));
        if (!p) return json({ error: 'Please sign in.' }, 401);
        const u = await db.prepare('SELECT id,mobile,role,name FROM users WHERE id=?').bind(p.id).first();
        if (!u) return json({ error: 'Please sign in.' }, 401);
        return json({ user: u, modules: MODULES[u.role] || [] });
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) { console.error(e); return json({ error: 'Server error' }, 500); }
  }
};
```

## File: server.js
```javascript
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const SECRET = process.env.SECRET || 'change-this-secret';
const DEMO_OTP = process.env.DEMO_OTP || '';
const ROLES = ['Student','Business client','Employer / recruiter','Job seeker','Digital / IT client','Admin','Manager','Faculty','Employee','HR','Accounts'];

const db = new Database(path.join(__dirname, 'ykr.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, mobile TEXT, role TEXT, name TEXT, UNIQUE(mobile, role));
CREATE TABLE IF NOT EXISTS otps(mobile TEXT PRIMARY KEY, code TEXT, expires INTEGER, tries INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, window INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS candidates(id INTEGER PRIMARY KEY, name TEXT, qualification TEXT, experience TEXT, area TEXT, skills TEXT, approved INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS leads(id INTEGER PRIMARY KEY, name TEXT, mobile TEXT, vertical TEXT, message TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
`);
if (!db.prepare('SELECT COUNT(*) c FROM candidates').get().c) {
  const ins = db.prepare('INSERT INTO candidates(name,qualification,experience,area,skills) VALUES(?,?,?,?,?)');
  [['Aditi S.','B.Com','2 yrs','Pune','Sales, Communication'],
   ['Rohan K.','BBA','fresher','Pimpri-Chinchwad','Digital Marketing'],
   ['Sneha M.','BA','1 yr','Chikhali','Customer Support'],
   ['Vikram J.','MBA','4 yrs','Chinchwad','Sales']].forEach(r => ins.run(...r));
}

const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = t => { const [b, s] = (t || '').split('.'); if (!b || !s) return null;
  const ok = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== ok.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(ok))) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; };

const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const validMobile = m => /^[6-9]\d{9}$/.test(m || '');

app.get('/api/stats', (_, res) => res.json({ verticals: 4, branches: 6, loginTypes: ROLES.length, years: '6+' }));

app.get('/api/candidates', (req, res) => {
  const skill = '%' + (req.query.skill || '') + '%';
  res.json(db.prepare('SELECT name,qualification,experience,area,skills FROM candidates WHERE approved=1 AND skills LIKE ?').all(skill));
});

app.post('/api/leads', (req, res) => {
  const { name, mobile, vertical, message } = req.body || {};
  if (!name || !validMobile(mobile)) return res.status(400).json({ error: 'Enter a valid name and 10-digit mobile.' });
  db.prepare('INSERT INTO leads(name,mobile,vertical,message) VALUES(?,?,?,?)').run(String(name).slice(0,80), mobile, String(vertical||'').slice(0,40), String(message||'').slice(0,500));
  res.json({ ok: true });
});

app.post('/api/otp/send', (req, res) => {
  const { mobile, role } = req.body || {};
  const generic = { ok: true, message: 'If this number is eligible, an OTP has been sent.' };
  if (!validMobile(mobile) || !ROLES.includes(role)) return res.status(400).json({ error: 'Choose a login type and enter a valid mobile.' });
  const now = Date.now(); const row = db.prepare('SELECT * FROM otps WHERE mobile=?').get(mobile);
  let sent = 1, win = now;
  if (row && now - row.window < 15 * 60000) { if (row.sent >= 5) return res.json(generic); sent = row.sent + 1; win = row.window; }
  const code = DEMO_OTP || String(crypto.randomInt(100000, 1000000));
  db.prepare('INSERT OR REPLACE INTO otps(mobile,code,expires,tries,sent,window) VALUES(?,?,?,?,?,?)').run(mobile, code, now + 5 * 60000, 0, sent, win);
  console.log(`[OTP] ${mobile} (${role}) -> ${code}`); // replace with free/low-cost SMS provider later
  res.json(generic);
});

app.post('/api/otp/verify', (req, res) => {
  const { mobile, role, code } = req.body || {};
  const bad = () => res.status(401).json({ error: 'Invalid or expired code.' });
  if (!validMobile(mobile) || !ROLES.includes(role)) return bad();
  const row = db.prepare('SELECT * FROM otps WHERE mobile=?').get(mobile);
  if (!row || row.expires < Date.now() || row.tries >= 5) return bad();
  db.prepare('UPDATE otps SET tries=tries+1 WHERE mobile=?').run(mobile);
  if (row.code !== String(code)) return bad();
  db.prepare('DELETE FROM otps WHERE mobile=?').run(mobile);
  db.prepare('INSERT OR IGNORE INTO users(mobile,role,name) VALUES(?,?,?)').run(mobile, role, 'Member');
  const u = db.prepare('SELECT id,mobile,role,name FROM users WHERE mobile=? AND role=?').get(mobile, role);
  res.json({ token: sign({ id: u.id, role: u.role, exp: Date.now() + 8 * 3600000 }), user: u });
});

const MODULES = {
  'Student': ['My courses','Sessions','Certificates','Placement cell'],
  'Business client': ['Projects','Sessions','Invoices','Reports'],
  'Employer / recruiter': ['Post requirement','Candidates','Interviews'],
  'Job seeker': ['My profile','Resume','Applications'],
  'Digital / IT client': ['Projects','Monthly reports','Invoices'],
  'Admin': ['Users','Approvals','Leads','Settings'],
  'Manager': ['Team','Projects','Reports'],
  'Faculty': ['Batches','Attendance','Materials'],
  'Employee': ['Tasks','Attendance','Payslips'],
  'HR': ['Candidates','Placements','Payroll'],
  'Accounts': ['Payments','Invoices','Payroll']
};
app.get('/api/me', (req, res) => {
  const p = verify((req.headers.authorization || '').replace('Bearer ', ''));
  if (!p) return res.status(401).json({ error: 'Please sign in.' });
  const u = db.prepare('SELECT id,mobile,role,name FROM users WHERE id=?').get(p.id);
  res.json({ user: u, modules: MODULES[u.role] || [] });
});

app.listen(process.env.PORT || 3000, () => console.log('YKR World running on http://localhost:' + (process.env.PORT || 3000)));
```

## File: public/index.html
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YKR World – Transforming businesses, empowering people</title>
<style>
:root{--navy:#0b2447;--blue:#1d5fc4;--gold:#f5b02e;--bg:#eef2f9;--ink:#10213f;--mut:#51607a}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--navy);color:#fff}
.logo{font-weight:800;font-size:1.1rem;flex:1}.logo b{color:var(--gold)}
.btn{border:0;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;background:var(--gold);color:#1b1b1b;text-decoration:none;display:inline-block}
.btn.ghost{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.5)}.btn.blue{background:var(--blue);color:#fff}
nav{display:none;position:absolute;top:100%;left:0;right:0;background:var(--navy);padding:8px}nav.open{display:block}
nav a{display:block;color:#fff;padding:12px;text-decoration:none;border-radius:8px}nav a:hover{background:rgba(255,255,255,.1)}
.hero{background:radial-gradient(circle at 80% 10%,#2f6fe0,transparent 55%),linear-gradient(160deg,#0b2447,#16408a);color:#fff;padding:36px 18px 44px}
.hero h1{font-size:2.1rem;line-height:1.15;margin:0 0 12px}.hero .row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.glass{background:rgba(255,255,255,.14);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.3);border-radius:16px;padding:16px;margin-top:18px}
.glass h4{margin:0 0 4px;color:var(--gold)}
section{padding:26px 16px;max-width:900px;margin:auto}h2{margin:0 0 6px}p.sub{color:var(--mut);margin:0 0 14px}
.stats{display:grid;grid-template-columns:1fr 1fr;background:#fff;border-radius:16px;box-shadow:0 10px 30px #0b244722;margin:-24px 16px 0;position:relative;max-width:520px}
.stats div{padding:16px;text-align:center}.stats b{display:block;font-size:1.8rem;color:var(--blue)}.stats span{font-size:.8rem;color:var(--mut)}
.card{background:#fff;border-radius:14px;padding:16px;margin-bottom:14px;box-shadow:0 4px 14px #0b244714;border-top:4px solid var(--c,var(--blue))}
.card h3{margin:0 0 6px}.card ul{padding-left:18px;margin:6px 0}
.pill{display:inline-block;background:#e4ecfa;color:var(--blue);padding:4px 10px;border-radius:99px;font-size:.8rem;margin:2px 2px 0 0}
.steps{background:#e4ecfa;border-radius:14px;padding:6px 16px}.steps div{padding:9px 0;border-bottom:1px solid #fff}.steps div:last-child{border:0}
input,select,textarea{width:100%;padding:12px;border:1.5px solid #cdd7ea;border-radius:10px;font:inherit;margin:6px 0;background:#fff}
.roles{display:grid;gap:8px;margin:8px 0}.roles button{text-align:left;padding:12px;border:1.5px solid #cdd7ea;border-radius:10px;background:#fff;font:inherit;cursor:pointer}
.roles button.on{border-color:var(--blue);background:#e4ecfa}.note{background:#e4ecfa;border-radius:10px;padding:10px;font-size:.9rem;color:var(--mut)}
.err{color:#b3261e;font-size:.9rem}footer{background:var(--navy);color:#fff;padding:22px 16px}footer h5{margin:14px 0 4px}
</style>
</head>
<body>
<header>
  <div class="logo"><b>Y</b> YKR <b>WORLD</b></div>
  <a class="btn" href="#signin">Login</a>
  <button class="btn ghost" id="menu" aria-label="Menu">☰</button>
  <nav id="nav"><a href="#home">Home</a><a href="#training">Individual Training</a><a href="#consult">Business Consultancy</a><a href="#hr">HR Placement</a><a href="#digital">Digital &amp; IT</a><a href="#contact">Contact</a></nav>
</header>

<div class="hero" id="home">
  <h1>Transforming businesses, empowering people.</h1>
  <p>Practical training, business consultancy, recruitment with pre-joining bootcamps and digital growth, with one secure portal to track sessions, projects and payments.</p>
  <div class="row"><a class="btn" href="#training">Explore courses</a><a class="btn ghost" href="#hr">Hire or get placed</a><a class="btn ghost" href="#signin">Client &amp; staff login</a></div>
  <div class="glass"><h4>Our mission</h4>Empower individuals and organisations for a better life.<h4 style="margin-top:10px">For every student</h4>Empowering students for a bright career: train, practise, get certified, get placed.</div>
</div>
<div class="stats" id="stats"><div><b>4</b><span>Business verticals</span></div><div><b>6</b><span>Branches in PCMC</span></div><div><b>11</b><span>Secure login types</span></div><div><b>6+ yrs</b><span>Training experience</span></div></div>

<section><h2>Four verticals, one team</h2><p class="sub">Every service runs on the same promise: practical results you can measure.</p>
  <div class="card" style="--c:#1d5fc4"><h3>Individual Training</h3>Spoken English, public speaking, soft skills, interview coaching and Political Leadership Development.<br><br><a class="btn pill" href="#training">View programmes</a></div>
  <div class="card" style="--c:#f5b02e"><h3>Business Training &amp; Consultancy</h3>Diagnose the root cause, build SOPs, train teams and lift sales with the SPANCO method.<br><br><a class="btn pill" href="#consult">See the method</a></div>
  <div class="card" style="--c:#1e8e6b"><h3>HR Recruitment &amp; Placement</h3>We select the right candidate and train them before they join.<br><br><a class="btn pill" href="#hr">YKR Placement Cell</a></div>
  <div class="card" style="--c:#6b4fc8"><h3>Digital Marketing &amp; IT</h3>Websites, SEO, social media and short-form video that bring leads.<br><br><a class="btn pill" href="#digital">View services</a></div>
  <p><b>Mission:</b> to empower individuals and organisations for a better life. We help students build a bright career and help businesses grow through capable people.</p>
</section>

<section id="training"><h2>Individual Training</h2><p class="sub">Confidence, communication and leadership for professionals, students, job seekers and managers.</p>
  <div class="card" style="--c:#f5b02e"><h3>New: Political Leadership Development Programme</h3>For aspiring and serving leaders, party workers and student leaders who need to speak, organise and lead with credibility.<ul><li>Public speaking for rallies, assemblies and press interactions</li><li>Constituency communication and public relations</li><li>Media handling, debate and crisis response</li><li>Policy messaging, storytelling and social media presence</li><li>Ethics, governance basics</li></ul></div>
  <div class="card"><h3>Spoken English</h3><ul><li>Fluency and grammar</li><li>Corporate vocabulary</li><li>Accent neutralisation</li></ul></div>
  <div class="card"><h3>Public Speaking</h3><ul><li>Overcome stage fear</li><li>Speech structure</li><li>Body language, voice</li></ul></div>
  <div class="card"><h3>Soft Skills &amp; Etiquette</h3><ul><li>Professional email writing</li><li>Conflict resolution</li><li>Grooming, presentation</li></ul></div>
  <div class="card"><h3>Career &amp; Interviews</h3><ul><li>Resume, LinkedIn</li><li>Mock interviews</li><li>Salary negotiation</li></ul></div>
</section>

<section id="consult"><h2>Business Training &amp; Consultancy</h2><p class="sub">Move from doing everything yourself to leading through systems.</p>
  <div class="steps"><div><b>1 Diagnose</b><br>Capture problem and evidence</div><div><b>2 Plan</b><br>Root cause, solution, scope</div><div><b>3 Deliver</b><br>Sessions, implementation</div><div><b>4 Review</b><br>Measure results</div></div>
  <div class="card" style="margin-top:14px"><h3>SPANCO sales pipeline</h3><span class="pill">Suspect</span><span class="pill">Prospect</span><span class="pill">Approach</span><span class="pill">Negotiate</span><span class="pill">Close</span><span class="pill">Order</span></div>
  <div class="card"><h3>Eliminate</h3>Time wasters, redundant meetings.<br>Hackathons, role-play simulations, outdoor workshops.<br><br><a class="btn blue" href="#signin">Company login</a></div>
</section>

<section id="hr"><h2>HR Recruitment &amp; Placement</h2><p class="sub">YKR Placement Cell: we train and we place.</p>
  <div class="row" style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="#signin">Register as Candidate</a><a class="btn blue" href="#signin">Hire From Us / Company Login</a></div>
  <div class="steps" style="margin-top:14px"><div><b>Precision sourcing</b><br>Skill and culture-fit screening</div><div><b>Practical training</b><br>Pre-joining bootcamp</div><div><b>Seamless integration</b><br>Onboarding support</div></div>
  <h3>Available candidates</h3><p class="sub">Public profiles show only skill summaries. Resumes and contacts unlock after authorisation.</p>
  <label>Filter by skill</label><select id="skill"><option value="">All skills</option><option>Sales</option><option>Communication</option><option>Digital Marketing</option><option>Customer Support</option></select>
  <div id="cands"></div>
  <div class="card"><h3>Placed students</h3>Company logos appear here once approved.</div>
  <div class="card"><h3>Hiring partners</h3>Partner logos appear here once approved.</div>
</section>

<section id="digital"><h2>Digital Marketing &amp; IT</h2><p class="sub">Growth you can see in leads and reports.</p>
  <div class="card"><h3>Websites</h3><ul><li>High-converting landing pages</li><li>Responsive corporate sites</li><li>UI/UX design</li></ul></div>
  <div class="card"><h3>Social media</h3><ul><li>Personal and business brands</li><li>Short-form video</li><li>Monthly reports</li></ul><a class="btn blue" href="#signin">Client login</a></div>
  <div class="card"><h3>Send an enquiry</h3><input id="ln" placeholder="Your name"><input id="lm" placeholder="Mobile (10 digits)" inputmode="numeric"><select id="lv"><option>Individual Training</option><option>Business Consultancy</option><option>HR Placement</option><option>Digital &amp; IT</option></select><textarea id="lt" rows="3" placeholder="Message"></textarea><button class="btn blue" id="lsend">Send</button> <span id="lmsg"></span></div>
</section>

<section id="signin"><h2>One portal for every client and team</h2>
  <div class="card" id="auth"><h3>Sign in</h3><div class="note">OTP login. In demo mode use code 123456 (start server with DEMO_OTP=123456).</div>
    <small><b>CUSTOMERS</b></small><div class="roles" id="r1"></div><small><b>STAFF AND MANAGEMENT</b></small><div class="roles" id="r2"></div>
    <input id="mob" placeholder="+91 mobile number" inputmode="numeric"><button class="btn blue" id="send">Send OTP</button>
    <div id="otpbox" hidden><input id="otp" placeholder="6-digit code" inputmode="numeric" maxlength="6"><button class="btn" id="verify">Verify &amp; sign in</button></div>
    <p class="err" id="aerr"></p><small>Lost access? Use Forgot access: we verify by OTP and never reveal whether an account exists.</small></div>
  <div class="card" id="dash" hidden><h3 id="hello"></h3><div id="mods"></div><br><button class="btn ghost" style="color:#1d5fc4;border-color:#1d5fc4" id="out">Sign out</button></div>
</section>

<footer id="contact"><b>YKR World</b><br>Transforming businesses, empowering people.
<h5>Contact</h5>+91 7218550652<br>ykrtraininginstitute@gmail.com
<h5>Locations</h5>HQ Talwade IT Park. Branches: Dehugaon, Talwade, Chikhali, Sane Chowk, Chinchwad, Bhosari.</footer>

<script>
const $=id=>document.getElementById(id);let role='Student',token=localStorage.getItem('ykr_token');
const R1=['Student','Business client','Employer / recruiter','Job seeker','Digital / IT client'],R2=['Admin','Manager','Faculty','Employee','HR','Accounts'];
function roles(el,list){list.forEach(r=>{const b=document.createElement('button');b.textContent=r;b.onclick=()=>{role=r;document.querySelectorAll('.roles button').forEach(x=>x.classList.remove('on'));b.classList.add('on')};if(r===role)b.classList.add('on');el.appendChild(b)})}
roles($('r1'),R1);roles($('r2'),R2);
$('menu').onclick=()=>$('nav').classList.toggle('open');document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>$('nav').classList.remove('open'));
const post=(u,b)=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(async r=>({ok:r.ok,d:await r.json()}));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function cands(){const d=await (await fetch('/api/candidates?skill='+encodeURIComponent($('skill').value))).json();
  $('cands').innerHTML=d.map(c=>`<div class="card"><h3>${esc(c.name)}</h3>${esc(c.qualification)}, ${esc(c.experience)}, ${esc(c.area)}<br>${c.skills.split(',').map(s=>`<span class="pill">${esc(s.trim())}</span>`).join('')}</div>`).join('')||'<p>No candidates found.</p>'}
$('skill').onchange=cands;cands();
$('lsend').onclick=async()=>{const r=await post('/api/leads',{name:$('ln').value,mobile:$('lm').value,vertical:$('lv').value,message:$('lt').value});$('lmsg').textContent=r.ok?'Thank you! We will call you.':r.d.error};
$('send').onclick=async()=>{$('aerr').textContent='';const r=await post('/api/otp/send',{mobile:$('mob').value.replace(/\D/g,'').slice(-10),role});if(r.ok)$('otpbox').hidden=false;else $('aerr').textContent=r.d.error};
$('verify').onclick=async()=>{const r=await post('/api/otp/verify',{mobile:$('mob').value.replace(/\D/g,'').slice(-10),role,code:$('otp').value});if(r.ok){token=r.d.token;localStorage.setItem('ykr_token',token);me()}else $('aerr').textContent=r.d.error};
async function me(){if(!token)return;const r=await fetch('/api/me',{headers:{Authorization:'Bearer '+token}});if(!r.ok){localStorage.removeItem('ykr_token');return}
  const d=await r.json();$('auth').hidden=true;$('dash').hidden=false;$('hello').textContent='Welcome, '+d.user.role;$('mods').innerHTML=d.modules.map(m=>`<span class="pill">${esc(m)}</span>`).join('')}
$('out').onclick=()=>{localStorage.removeItem('ykr_token');location.reload()};me();
</script>
</body>
</html>
```
