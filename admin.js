const express = require('express');
const crypto = require('crypto');
const L = require('./lib');
const { settle } = require('./payments');
const { db } = L;
const r = express.Router();
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const paise = (v) => { const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };
const bad = (res, m) => res.status(400).json({ error: m });
r.use(L.auth);

const CUSTOMER = ['student', 'business_client', 'employer', 'job_seeker', 'digital_client'];
const STAFFROLES = ['employee', 'faculty', 'manager', 'hr', 'accounts'];
const ALLROLES = [...CUSTOMER, ...STAFFROLES, 'admin'];

// ---------- Users & roles ----------
r.get('/users', L.need('hr'), (req, res) => res.json(all(`SELECT u.user_id,u.name,u.email,u.mobile,u.status,
  (SELECT GROUP_CONCAT(role_code) FROM user_roles WHERE user_id=u.user_id) roles FROM users u ORDER BY user_id DESC LIMIT 300`)));
r.post('/users', L.need('hr'), (req, res) => {
  const b = req.body || {}; const roles = (Array.isArray(b.roles) ? b.roles : String(b.roles || '').split(',')).map(s => s.trim()).filter(Boolean);
  if (!b.name || (!b.email && !b.mobile) || !roles.length) return bad(res, 'Name, email/mobile and at least one role required');
  if (roles.some(x => !ALLROLES.includes(x))) return bad(res, 'Unknown role');
  if (!L.has(req.user, 'admin') && roles.some(x => ['admin', 'accounts', 'hr', 'manager'].includes(x))) return res.status(403).json({ error: 'Only admin can grant that role' });
  const userPassword = b.password || 'User@123';
  const passHash = L.hashPassword(userPassword);
  try {
    const uid = db.transaction(() => {
      const id = db.prepare('INSERT INTO users(name,email,mobile,password_hash) VALUES(?,?,?,?)').run(b.name, (b.email || '').trim().toLowerCase() || null, L.normMobile(b.mobile), passHash).lastInsertRowid;
      for (const x of roles) db.prepare('INSERT INTO user_roles(user_id,role_code,assigned_by) VALUES(?,?,?)').run(id, x, req.user.user_id);
      if (roles.includes('student')) db.prepare('INSERT INTO student_profiles(user_id,joining_date) VALUES(?,date(\'now\'))').run(id);
      if (roles.includes('job_seeker')) db.prepare('INSERT INTO candidate_profiles(user_id) VALUES(?)').run(id);
      if (roles.some(x => STAFFROLES.includes(x))) db.prepare('INSERT INTO employees(user_id,department,designation,manager_user_id,joining_date) VALUES(?,?,?,?,date(\'now\'))').run(id, b.department || null, b.designation || null, +b.manager_user_id || null);
      if (+b.company_id) db.prepare('INSERT INTO company_users(company_id,user_id) VALUES(?,?)').run(+b.company_id, id);
      L.audit(req.user.user_id, 'user_create', 'user', id, { roles });
      return id;
    })();
    res.json({ user_id: uid });
  } catch (e) { bad(res, String(e.message).includes('UNIQUE') ? 'Email or mobile already registered' : 'Could not create user'); }
});
r.post('/users/:id/status', L.need('admin'), (req, res) => {
  const s = req.body?.status; if (!['active', 'inactive'].includes(s)) return bad(res, 'Invalid status');
  if (+req.params.id === req.user.user_id) return bad(res, 'Cannot change your own status');
  db.prepare('UPDATE users SET status=? WHERE user_id=?').run(s, req.params.id); L.audit(req.user.user_id, 'user_status', 'user', req.params.id, { s }); res.json({ ok: true });
});
r.post('/users/:id/roles', L.need('admin'), (req, res) => {
  const { role, action } = req.body || {}; if (!ALLROLES.includes(role)) return bad(res, 'Unknown role');
  if (action === 'remove') { if (+req.params.id === req.user.user_id && role === 'admin') return bad(res, 'Cannot remove your own admin role'); db.prepare('DELETE FROM user_roles WHERE user_id=? AND role_code=?').run(req.params.id, role); }
  else db.prepare('INSERT OR IGNORE INTO user_roles(user_id,role_code,assigned_by) VALUES(?,?,?)').run(req.params.id, role, req.user.user_id);
  L.audit(req.user.user_id, 'role_' + (action || 'add'), 'user', req.params.id, { role }); res.json({ ok: true });
});

// ---------- Companies ----------
r.get('/companies', L.need('hr'), (req, res) => res.json(all('SELECT * FROM companies ORDER BY company_id DESC')));
r.post('/companies', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!b.name) return bad(res, 'Name required');
  const id = db.prepare('INSERT INTO companies(name,industry,address,size) VALUES(?,?,?,?)').run(b.name, b.industry || null, b.address || null, b.size || null).lastInsertRowid;
  L.audit(req.user.user_id, 'company_create', 'company', id); res.json({ company_id: id });
});
r.post('/companies/:id/users', L.need('hr'), (req, res) => {
  db.prepare('INSERT OR IGNORE INTO company_users(company_id,user_id) VALUES(?,?)').run(req.params.id, +req.body?.user_id);
  L.audit(req.user.user_id, 'company_link_user', 'company', req.params.id, req.body); res.json({ ok: true });
});

// ---------- Training ----------
r.get('/courses', L.need('faculty', 'hr'), (req, res) => res.json(all('SELECT * FROM courses ORDER BY course_id DESC')));
r.post('/courses', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!b.name) return bad(res, 'Name required');
  const id = db.prepare('INSERT INTO courses(name,category,duration_hours,total_sessions,fee_paise) VALUES(?,?,?,?,?)')
    .run(b.name, b.category || null, +b.duration_hours || null, +b.total_sessions || 1, paise(b.fee) || 0).lastInsertRowid;
  L.audit(req.user.user_id, 'course_create', 'course', id); res.json({ course_id: id });
});
r.post('/sessions', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!b.course_id || !b.scheduled_at) return bad(res, 'course_id and scheduled_at required');
  const id = db.prepare('INSERT INTO course_sessions(course_id,trainer_user_id,scheduled_at,location) VALUES(?,?,?,?)').run(+b.course_id, +b.trainer_user_id || null, b.scheduled_at, b.location || null).lastInsertRowid;
  const students = all('SELECT sp.user_id FROM enrolments e JOIN student_profiles sp ON sp.student_id=e.student_id WHERE e.course_id=?', +b.course_id);
  students.forEach(s => L.notify(s.user_id, 'session', `New session scheduled: ${b.scheduled_at}`));
  res.json({ session_id: id });
});
// Cancelling/rescheduling never marks anyone absent.
r.post('/sessions/:id/status', L.need('hr', 'faculty'), (req, res) => {
  const s = req.body?.status; if (!['scheduled', 'completed', 'cancelled', 'rescheduled'].includes(s)) return bad(res, 'Invalid status');
  db.prepare('UPDATE course_sessions SET status=? WHERE session_id=?').run(s, req.params.id);
  L.audit(req.user.user_id, 'session_status', 'session', req.params.id, { s }); res.json({ ok: true });
});
r.post('/enrol', L.need('hr'), (req, res) => {
  const b = req.body || {}; const sp = L.studentOf(+b.student_user_id); const c = one('SELECT * FROM courses WHERE course_id=?', +b.course_id);
  if (!sp || !c) return bad(res, 'Student or course not found');
  const fee = b.fee !== undefined && b.fee !== '' ? paise(b.fee) : c.fee_paise;
  try {
    const id = db.prepare('INSERT INTO enrolments(student_id,course_id,start_date,fee_paise) VALUES(?,?,date(\'now\'),?)').run(sp.student_id, c.course_id, fee).lastInsertRowid;
    L.audit(req.user.user_id, 'enrol', 'enrolment', id); res.json({ enrolment_id: id, fee_paise: fee });
  } catch { bad(res, 'Already enrolled'); }
});
r.post('/certificates', L.need('hr'), (req, res) => {
  const e = one('SELECT * FROM enrolments WHERE enrolment_id=?', +req.body?.enrolment_id); if (!e) return bad(res, 'Enrolment not found');
  const code = 'YKR-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  db.prepare('INSERT OR IGNORE INTO certificates(enrolment_id,certificate_code) VALUES(?,?)').run(e.enrolment_id, code);
  L.audit(req.user.user_id, 'certificate_issue', 'enrolment', e.enrolment_id); res.json({ ok: true });
});

// ---------- Consultancy ----------
r.post('/engagements', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!+b.company_id || !b.title) return bad(res, 'company_id and title required');
  const id = db.prepare('INSERT INTO consultancy_engagements(company_id,title,scope,start_date,end_date,amount_paise) VALUES(?,?,?,?,?,?)').run(+b.company_id, b.title, b.scope || null, b.start_date || null, b.end_date || null, paise(b.amount) || 0).lastInsertRowid;
  L.audit(req.user.user_id, 'engagement_create', 'engagement', id); res.json({ engagement_id: id });
});
r.post('/diagnoses', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!+b.engagement_id) return bad(res, 'engagement_id required');
  const id = db.prepare('INSERT INTO diagnoses(engagement_id,issue_area,findings,solution,internal_notes) VALUES(?,?,?,?,?)').run(+b.engagement_id, b.issue_area || null, b.findings || null, b.solution || null, b.internal_notes || null).lastInsertRowid;
  res.json({ diagnosis_id: id }); // starts as internal: client cannot see it yet
});
r.post('/diagnoses/:id/release', L.need('hr'), (req, res) => {
  const d = one('SELECT d.*, e.company_id FROM diagnoses d JOIN consultancy_engagements e ON e.engagement_id=d.engagement_id WHERE diagnosis_id=?', req.params.id); if (!d) return bad(res, 'Not found');
  db.prepare("UPDATE diagnoses SET visibility='client', status='approved' WHERE diagnosis_id=?").run(d.diagnosis_id);
  all('SELECT user_id FROM company_users WHERE company_id=?', d.company_id).forEach(u => L.notify(u.user_id, 'report', 'A new diagnosis/solution report is available'));
  L.audit(req.user.user_id, 'diagnosis_release', 'diagnosis', d.diagnosis_id); res.json({ ok: true });
});
r.post('/consultancy-sessions', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!+b.engagement_id) return bad(res, 'engagement_id required');
  const id = db.prepare('INSERT INTO consultancy_sessions(engagement_id,topic,scheduled_at) VALUES(?,?,?)').run(+b.engagement_id, b.topic || null, b.scheduled_at || null).lastInsertRowid;
  res.json({ session_id: id });
});

// ---------- Recruitment ----------
r.get('/referrals', L.need('hr'), (req, res) => res.json(all(`SELECT r.referral_id, u.name candidate, j.title job, co.name company, r.current_status, r.consent_at
  FROM candidate_referrals r JOIN candidate_profiles cp ON cp.candidate_id=r.candidate_id JOIN users u ON u.user_id=cp.user_id
  JOIN job_requirements j ON j.job_id=r.job_id JOIN companies co ON co.company_id=j.company_id ORDER BY referral_id DESC LIMIT 200`)));
r.post('/referrals', L.need('hr'), (req, res) => {
  const cp = L.candidateOf(+req.body?.candidate_user_id); const j = one('SELECT * FROM job_requirements WHERE job_id=?', +req.body?.job_id);
  if (!cp || !j) return bad(res, 'Candidate or job not found');
  try {
    const id = db.prepare('INSERT INTO candidate_referrals(candidate_id,job_id) VALUES(?,?)').run(cp.candidate_id, j.job_id).lastInsertRowid;
    L.notify(cp.user_id, 'referral', `You were matched with "${j.title}". Please review and give consent so we can share your profile.`);
    L.audit(req.user.user_id, 'referral_create', 'referral', id); res.json({ referral_id: id });
  } catch { bad(res, 'Already matched'); }
});
r.post('/referrals/:id/send', L.need('hr'), (req, res) => {
  const x = one('SELECT * FROM candidate_referrals WHERE referral_id=?', req.params.id); if (!x) return bad(res, 'Not found');
  if (!x.consent_at) return bad(res, 'Candidate consent is required before sharing the profile');
  db.prepare("UPDATE candidate_referrals SET current_status='sent' WHERE referral_id=? AND current_status='matched'").run(x.referral_id);
  db.prepare('INSERT INTO referral_history(referral_id,old_status,new_status,changed_by) VALUES(?,?,?,?)').run(x.referral_id, 'matched', 'sent', req.user.user_id);
  L.audit(req.user.user_id, 'referral_send', 'referral', x.referral_id); res.json({ ok: true });
});

// ---------- Digital / IT ----------
r.post('/projects', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!b.name) return bad(res, 'Name required');
  const id = db.prepare('INSERT INTO digital_projects(company_id,client_user_id,name,scope,start_date,end_date) VALUES(?,?,?,?,?,?)').run(+b.company_id || null, +b.client_user_id || null, b.name, b.scope || null, b.start_date || null, b.end_date || null).lastInsertRowid;
  L.audit(req.user.user_id, 'project_create', 'project', id); res.json({ project_id: id });
});
r.post('/tasks', L.need('hr', 'manager'), (req, res) => {
  const b = req.body || {}; if (!+b.project_id || !b.title) return bad(res, 'project_id and title required');
  res.json({ task_id: db.prepare('INSERT INTO project_tasks(project_id,title,due_date,status,notes) VALUES(?,?,?,?,?)').run(+b.project_id, b.title, b.due_date || null, b.status || 'todo', b.notes || null).lastInsertRowid });
});
r.post('/deliverables', L.need('hr'), (req, res) => {
  const b = req.body || {}; if (!+b.project_id || !b.title) return bad(res, 'project_id and title required');
  const st = ['draft', 'submitted'].includes(b.status) ? b.status : 'draft';
  const id = db.prepare('INSERT INTO deliverables(project_id,title,link,file_id,status) VALUES(?,?,?,?,?)').run(+b.project_id, b.title, b.link || null, +b.file_id || null, st).lastInsertRowid;
  if (st === 'submitted') { const p = one('SELECT client_user_id FROM digital_projects WHERE project_id=?', +b.project_id); L.notify(p?.client_user_id, 'approval', `New deliverable for review: ${b.title}`); }
  res.json({ deliverable_id: id });
});

// ---------- Finance ----------
r.get('/invoices', L.need('accounts'), (req, res) => res.json(all('SELECT * FROM invoices ORDER BY invoice_id DESC LIMIT 300')));
r.post('/invoices', L.need('accounts'), (req, res) => {
  const b = req.body || {}; const sub = paise(b.amount), tax = b.tax ? paise(b.tax) : 0;
  if (!sub || tax === null || (!+b.user_id && !+b.company_id) || !b.description) return bad(res, 'user_id or company_id, description and valid amount required');
  const id = db.transaction(() => {
    const i = db.prepare('INSERT INTO invoices(invoice_number,user_id,company_id,description,subtotal_paise,tax_paise,total_paise,due_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('TMP' + crypto.randomBytes(4).toString('hex'), +b.user_id || null, +b.company_id || null, b.description, sub, tax, sub + tax, b.due_date || null, req.user.user_id).lastInsertRowid;
    db.prepare('UPDATE invoices SET invoice_number=? WHERE invoice_id=?').run(`INV-${new Date().getFullYear()}-${String(i).padStart(6, '0')}`, i);
    return i;
  })();
  const inv = one('SELECT * FROM invoices WHERE invoice_id=?', id);
  const targets = inv.user_id ? [{ user_id: inv.user_id }] : all('SELECT user_id FROM company_users WHERE company_id=?', inv.company_id);
  targets.forEach(t => L.notify(t.user_id, 'invoice', `Invoice ${inv.invoice_number} issued`));
  L.audit(req.user.user_id, 'invoice_create', 'invoice', id, { total: inv.total_paise }); res.json({ invoice_id: id, invoice_number: inv.invoice_number });
});
r.post('/invoices/:id/cancel', L.need('accounts'), (req, res) => {
  if (L.paidSum(req.params.id) > 0) return bad(res, 'Invoice has payments; cannot cancel');
  db.prepare("UPDATE invoices SET status='cancelled' WHERE invoice_id=?").run(req.params.id); L.audit(req.user.user_id, 'invoice_cancel', 'invoice', req.params.id); res.json({ ok: true });
});
r.post('/payments/manual', L.need('accounts'), (req, res) => {
  const b = req.body || {}; const inv = one('SELECT * FROM invoices WHERE invoice_id=?', +b.invoice_id); const amt = paise(b.amount);
  if (!inv || !amt || inv.status === 'cancelled') return bad(res, 'Valid invoice and amount required');
  if (amt > inv.total_paise - L.paidSum(inv.invoice_id)) return bad(res, 'Amount exceeds outstanding balance');
  const oid = 'manual_' + crypto.randomBytes(8).toString('hex');
  db.prepare("INSERT INTO payments(invoice_id,provider,provider_order_id,amount_paise,status,reference) VALUES(?,'manual',?,?,'created',?)").run(inv.invoice_id, oid, amt, b.reference || null);
  const out = settle(oid, null, b.method || 'manual', req.user.user_id); res.json({ ok: out.ok, status: out.invoice_status, receipt: out.receipt });
});

// ---------- Support, reports, audit ----------
r.post('/tickets/:id', L.need('hr', 'accounts', 'manager'), (req, res) => {
  const b = req.body || {}; const t = one('SELECT * FROM support_tickets WHERE ticket_id=?', req.params.id); if (!t) return bad(res, 'Not found');
  db.prepare('UPDATE support_tickets SET reply=COALESCE(?,reply), status=COALESCE(?,status), assigned_to=? WHERE ticket_id=?').run(b.reply || null, ['open', 'in_progress', 'resolved'].includes(b.status) ? b.status : null, req.user.user_id, t.ticket_id);
  L.notify(t.created_by, 'support', `Update on your ticket: ${t.subject}`); res.json({ ok: true });
});
r.get('/enquiries', L.need('hr'), (req, res) => res.json(all('SELECT * FROM enquiries ORDER BY id DESC LIMIT 200')));
r.get('/audit', L.need('admin'), (req, res) => res.json(all('SELECT a.*, u.name actor FROM audit_logs a LEFT JOIN users u ON u.user_id=a.actor_user_id ORDER BY audit_id DESC LIMIT 300')));
r.get('/reports/summary', L.need('manager', 'hr', 'accounts'), (req, res) => res.json({
  users_by_role: all('SELECT role_code, COUNT(*) n FROM user_roles GROUP BY role_code'),
  active_enrolments: one("SELECT COUNT(*) n FROM enrolments WHERE status='active'").n,
  open_tickets: one("SELECT COUNT(*) n FROM support_tickets WHERE status!='resolved'").n,
  outstanding_paise: one("SELECT COALESCE(SUM(i.total_paise - COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.invoice_id=i.invoice_id AND p.status='paid'),0)),0) n FROM invoices i WHERE i.status IN('pending','partially_paid')").n,
  collected_paise: one("SELECT COALESCE(SUM(amount_paise),0) n FROM payments WHERE status='paid'").n,
  open_referrals: one("SELECT COUNT(*) n FROM candidate_referrals WHERE current_status NOT IN('joined','rejected')").n
}));
r.get('/payments', L.need('accounts'), (req, res) => res.json(all(`SELECT p.payment_id, i.invoice_number, p.provider, p.provider_order_id, p.amount_paise, p.status, p.method, p.paid_at
  FROM payments p JOIN invoices i ON i.invoice_id=p.invoice_id ORDER BY payment_id DESC LIMIT 300`)));

// ---------- Staff: attendance, salary, payroll ----------
r.post('/staff-attendance', L.need('hr', 'manager'), (req, res) => {
  const b = req.body || {}; if (!+b.employee_id || !b.date || !['present', 'absent', 'late', 'half_day', 'remote', 'holiday', 'leave'].includes(b.status)) return bad(res, 'employee_id, date, valid status required');
  db.prepare('INSERT INTO staff_attendance(employee_id,date,status,marked_by) VALUES(?,?,?,?) ON CONFLICT(employee_id,date) DO UPDATE SET status=excluded.status, marked_by=excluded.marked_by').run(+b.employee_id, b.date, b.status, req.user.user_id);
  L.audit(req.user.user_id, 'staff_attendance', 'employee', b.employee_id, { date: b.date, status: b.status }); res.json({ ok: true });
});
r.get('/employees', L.need('hr', 'accounts'), (req, res) => res.json(all('SELECT e.employee_id, u.name, e.department, e.designation, e.status FROM employees e JOIN users u ON u.user_id=e.user_id')));
r.post('/salary-structures', L.need('accounts'), (req, res) => {
  const b = req.body || {}; const base = paise(b.base); if (!+b.employee_id || !base || !b.effective_from) return bad(res, 'employee_id, base, effective_from required');
  db.prepare('INSERT INTO salary_structures(employee_id,base_paise,allowances_paise,deductions_paise,effective_from,approved_by) VALUES(?,?,?,?,?,?)').run(+b.employee_id, base, paise(b.allowances) || 0, paise(b.deductions) || 0, b.effective_from, req.user.user_id);
  L.audit(req.user.user_id, 'salary_structure', 'employee', b.employee_id); res.json({ ok: true });
});
r.post('/payroll-runs', L.need('accounts'), (req, res) => {
  const { period_start, period_end } = req.body || {}; if (!period_start || !period_end) return bad(res, 'Period required');
  const id = db.transaction(() => {
    const run = db.prepare('INSERT INTO payroll_runs(period_start,period_end,prepared_by) VALUES(?,?,?)').run(period_start, period_end, req.user.user_id).lastInsertRowid;
    for (const e of all("SELECT employee_id FROM employees WHERE status='active'")) {
      const s = one('SELECT * FROM salary_structures WHERE employee_id=? AND effective_from<=? ORDER BY effective_from DESC, id DESC LIMIT 1', e.employee_id, period_end); if (!s) continue;
      const absent = one("SELECT COUNT(*) n FROM staff_attendance WHERE employee_id=? AND date BETWEEN ? AND ? AND status='absent'", e.employee_id, period_start, period_end).n;
      const gross = s.base_paise + s.allowances_paise, ded = s.deductions_paise + Math.round(s.base_paise / 30 * absent);
      db.prepare('INSERT INTO payslips(payroll_run_id,employee_id,gross_paise,deductions_paise,net_paise) VALUES(?,?,?,?,?)').run(run, e.employee_id, gross, ded, Math.max(0, gross - ded));
    }
    return run;
  })();
  L.audit(req.user.user_id, 'payroll_prepare', 'payroll_run', id); res.json({ payroll_run_id: id });
});
// Maker-checker: the preparer can never approve their own run.
r.post('/payroll-runs/:id/approve', L.need('accounts'), (req, res) => {
  const run = one("SELECT * FROM payroll_runs WHERE payroll_run_id=? AND status='draft'", req.params.id); if (!run) return bad(res, 'Run not found or already approved');
  if (run.prepared_by === req.user.user_id) return res.status(403).json({ error: 'A different authorised user must approve this run' });
  db.prepare("UPDATE payroll_runs SET status='approved', approved_by=? WHERE payroll_run_id=?").run(req.user.user_id, run.payroll_run_id);
  all('SELECT e.user_id FROM payslips p JOIN employees e ON e.employee_id=p.employee_id WHERE p.payroll_run_id=?', run.payroll_run_id).forEach(x => L.notify(x.user_id, 'payslip', 'Your payslip is available'));
  L.audit(req.user.user_id, 'payroll_approve', 'payroll_run', run.payroll_run_id); res.json({ ok: true });
});
r.get('/payslips', L.need('accounts'), (req, res) => res.json(all(`SELECT p.payslip_id, u.name, pr.period_start, pr.period_end, pr.status run_status, p.gross_paise, p.deductions_paise, p.net_paise, p.payment_status
  FROM payslips p JOIN employees e ON e.employee_id=p.employee_id JOIN users u ON u.user_id=e.user_id JOIN payroll_runs pr ON pr.payroll_run_id=p.payroll_run_id ORDER BY payslip_id DESC LIMIT 300`)));
// Payslip generation never marks salary paid; this separate step records the actual payment.
r.post('/payslips/:id/pay', L.need('accounts'), (req, res) => {
  const b = req.body || {}; const p = one("SELECT p.*, pr.status run_status FROM payslips p JOIN payroll_runs pr ON pr.payroll_run_id=p.payroll_run_id WHERE payslip_id=?", req.params.id);
  if (!p || p.run_status !== 'approved') return bad(res, 'Payroll run must be approved first'); if (p.payment_status === 'paid') return bad(res, 'Already paid');
  db.transaction(() => {
    db.prepare('INSERT INTO salary_payments(payslip_id,amount_paise,paid_on,method,reference,recorded_by) VALUES(?,?,?,?,?,?)').run(p.payslip_id, p.net_paise, b.paid_on || new Date().toISOString().slice(0, 10), b.method || 'bank_transfer', b.reference || null, req.user.user_id);
    db.prepare("UPDATE payslips SET payment_status='paid' WHERE payslip_id=?").run(p.payslip_id);
  })();
  L.audit(req.user.user_id, 'salary_paid', 'payslip', p.payslip_id); res.json({ ok: true });
});
module.exports = r;
