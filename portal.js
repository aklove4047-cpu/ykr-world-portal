const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const L = require('./lib');
const { db } = L;
const r = express.Router();
const all = (sql, ...p) => db.prepare(sql).all(...p);
const one = (sql, ...p) => db.prepare(sql).get(...p);
const inList = (a) => a.map(() => '?').join(',') || 'NULL';
r.use(L.auth);

r.get('/me', (req, res) => res.json(req.user));

// ---------- Student ----------
r.get('/student/courses', L.need('student'), (req, res) => {
  const s = L.studentOf(req.user.user_id); if (!s) return res.json([]);
  res.json(all(`SELECT e.enrolment_id, c.name course, e.start_date, e.end_date, e.status, e.fee_paise, c.total_sessions,
      (SELECT COUNT(*) FROM course_sessions cs WHERE cs.course_id=c.course_id AND cs.status='completed') completed_sessions,
      (SELECT COUNT(*) FROM attendance a WHERE a.enrolment_id=e.enrolment_id AND a.status='present') attended
    FROM enrolments e JOIN courses c ON c.course_id=e.course_id WHERE e.student_id=?`, s.student_id)
    .map(x => ({ ...x, progress_pct: Math.min(100, Math.round(100 * x.completed_sessions / Math.max(1, x.total_sessions))) })));
});
r.get('/student/attendance', L.need('student'), (req, res) => {
  const s = L.studentOf(req.user.user_id); if (!s) return res.json([]);
  res.json(all(`SELECT c.name course, cs.scheduled_at, cs.status session_status, a.status attendance
    FROM enrolments e JOIN course_sessions cs ON cs.course_id=e.course_id JOIN courses c ON c.course_id=e.course_id
    LEFT JOIN attendance a ON a.enrolment_id=e.enrolment_id AND a.session_id=cs.session_id
    WHERE e.student_id=? ORDER BY cs.scheduled_at DESC`, s.student_id)
    .map(x => ({ ...x, attendance: x.session_status === 'cancelled' || x.session_status === 'rescheduled' ? 'session not conducted' : (x.attendance || 'not marked') })));
});
r.get('/student/schedule', L.need('student'), (req, res) => {
  const s = L.studentOf(req.user.user_id); if (!s) return res.json([]);
  res.json(all(`SELECT c.name course, cs.scheduled_at, cs.location, u.name trainer, cs.status FROM enrolments e
    JOIN course_sessions cs ON cs.course_id=e.course_id JOIN courses c ON c.course_id=e.course_id
    LEFT JOIN users u ON u.user_id=cs.trainer_user_id WHERE e.student_id=? AND cs.scheduled_at>=date('now') ORDER BY cs.scheduled_at`, s.student_id));
});
r.get('/student/materials', L.need('student'), (req, res) => {
  const s = L.studentOf(req.user.user_id); if (!s) return res.json([]);
  res.json(all(`SELECT f.file_id, f.file_name, c.name course, f.created_at FROM files f JOIN courses c ON c.course_id=f.course_id
    WHERE f.visibility='course' AND f.course_id IN (SELECT course_id FROM enrolments WHERE student_id=?)`, s.student_id));
});
r.get('/student/certificates', L.need('student'), (req, res) => {
  const s = L.studentOf(req.user.user_id); if (!s) return res.json([]);
  res.json(all(`SELECT c.name course, ce.certificate_code, ce.issued_at FROM certificates ce JOIN enrolments e ON e.enrolment_id=ce.enrolment_id
    JOIN courses c ON c.course_id=e.course_id WHERE e.student_id=? AND ce.status='issued'`, s.student_id));
});

// ---------- Business consultancy client ----------
r.get('/client/engagements', L.need('business_client'), (req, res) => {
  const ids = L.companyIds(req.user.user_id);
  res.json(all(`SELECT * FROM consultancy_engagements WHERE company_id IN (${inList(ids)})`, ...ids));
});
r.get('/client/diagnoses', L.need('business_client'), (req, res) => {
  const ids = L.companyIds(req.user.user_id); // internal_notes are never selected
  res.json(all(`SELECT d.diagnosis_id, d.engagement_id, d.issue_area, d.findings, d.solution, d.status FROM diagnoses d
    JOIN consultancy_engagements e ON e.engagement_id=d.engagement_id
    WHERE d.visibility='client' AND e.company_id IN (${inList(ids)})`, ...ids));
});
r.get('/client/sessions', L.need('business_client'), (req, res) => {
  const ids = L.companyIds(req.user.user_id);
  res.json(all(`SELECT s.* FROM consultancy_sessions s JOIN consultancy_engagements e ON e.engagement_id=s.engagement_id
    WHERE e.company_id IN (${inList(ids)}) ORDER BY s.scheduled_at`, ...ids));
});
r.get('/client/documents', L.need('business_client', 'digital_client', 'employer'), (req, res) => {
  const ids = L.companyIds(req.user.user_id);
  res.json(all(`SELECT file_id, file_name, created_at FROM files WHERE visibility='company' AND company_id IN (${inList(ids)})`, ...ids));
});

// ---------- Employer ----------
r.get('/employer/jobs', L.need('employer'), (req, res) => {
  const ids = L.companyIds(req.user.user_id);
  res.json(all(`SELECT * FROM job_requirements WHERE company_id IN (${inList(ids)}) ORDER BY job_id DESC`, ...ids));
});
r.post('/employer/jobs', L.need('employer'), (req, res) => {
  const ids = L.companyIds(req.user.user_id); const b = req.body || {};
  if (!ids.length || !b.title) return res.status(400).json({ error: 'Title required / no company linked' });
  const id = db.prepare('INSERT INTO job_requirements(company_id,title,vacancies,skills,location,salary_range) VALUES(?,?,?,?,?,?)')
    .run(ids[0], b.title, +b.vacancies || 1, b.skills || '', b.location || '', b.salary_range || '').lastInsertRowid;
  L.audit(req.user.user_id, 'job_create', 'job', id); res.json({ job_id: id });
});
// Only consented, sent-on candidates; no contact details, no internal score.
r.get('/employer/referrals', L.need('employer'), (req, res) => {
  const ids = L.companyIds(req.user.user_id);
  res.json(all(`SELECT r.referral_id, j.title job, u.name candidate, cp.education, cp.experience, cp.skills, cp.location,
      cp.expected_salary, cp.availability, r.current_status, r.interview_at, r.employer_notes,
      CASE WHEN cp.resume_file_id IS NOT NULL THEN cp.resume_file_id END resume_file_id
    FROM candidate_referrals r JOIN job_requirements j ON j.job_id=r.job_id JOIN candidate_profiles cp ON cp.candidate_id=r.candidate_id
    JOIN users u ON u.user_id=cp.user_id WHERE j.company_id IN (${inList(ids)}) AND r.consent_at IS NOT NULL AND r.current_status!='matched'`, ...ids));
});
const EMP_STATUS = ['shortlisted', 'interview_scheduled', 'selected', 'rejected', 'offer', 'joined'];
r.post('/employer/referrals/:id', L.need('employer'), (req, res) => {
  const ids = L.companyIds(req.user.user_id); const b = req.body || {};
  const ref = one(`SELECT r.*, j.company_id, cp.user_id cuid FROM candidate_referrals r JOIN job_requirements j ON j.job_id=r.job_id
    JOIN candidate_profiles cp ON cp.candidate_id=r.candidate_id WHERE r.referral_id=?`, req.params.id);
  if (!ref || !ids.includes(ref.company_id) || !ref.consent_at || ref.current_status === 'matched') return res.status(404).json({ error: 'Not found' });
  if (b.status && !EMP_STATUS.includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
  db.transaction(() => {
    db.prepare('UPDATE candidate_referrals SET current_status=COALESCE(?,current_status), interview_at=COALESCE(?,interview_at), employer_notes=COALESCE(?,employer_notes) WHERE referral_id=?')
      .run(b.status || null, b.interview_at || null, b.notes ?? null, ref.referral_id);
    if (b.status && b.status !== ref.current_status) {
      db.prepare('INSERT INTO referral_history(referral_id,old_status,new_status,changed_by) VALUES(?,?,?,?)').run(ref.referral_id, ref.current_status, b.status, req.user.user_id);
      L.notify(ref.cuid, 'referral', `Your application status is now: ${b.status.replace('_', ' ')}`);
    }
    L.audit(req.user.user_id, 'referral_update', 'referral', ref.referral_id, { status: b.status });
  })();
  res.json({ ok: true });
});

// ---------- Job seeker ----------
r.get('/candidate/profile', L.need('job_seeker'), (req, res) => res.json(L.candidateOf(req.user.user_id) || {}));
r.put('/candidate/profile', L.need('job_seeker'), (req, res) => {
  const b = req.body || {}; const c = L.candidateOf(req.user.user_id);
  const f = ['education', 'experience', 'skills', 'location', 'expected_salary', 'availability'].map(k => String(b[k] ?? c?.[k] ?? '').slice(0, 500));
  if (c) db.prepare('UPDATE candidate_profiles SET education=?,experience=?,skills=?,location=?,expected_salary=?,availability=? WHERE user_id=?').run(...f, req.user.user_id);
  else db.prepare('INSERT INTO candidate_profiles(education,experience,skills,location,expected_salary,availability,user_id) VALUES(?,?,?,?,?,?,?)').run(...f, req.user.user_id);
  res.json({ ok: true });
});
// Candidate-facing view: no employer notes, no internal score, no fee.
r.get('/candidate/referrals', L.need('job_seeker'), (req, res) => {
  const c = L.candidateOf(req.user.user_id); if (!c) return res.json([]);
  res.json(all(`SELECT r.referral_id, j.title job, co.name company, r.current_status status, r.interview_at, r.consent_at
    FROM candidate_referrals r JOIN job_requirements j ON j.job_id=r.job_id JOIN companies co ON co.company_id=j.company_id WHERE r.candidate_id=?`, c.candidate_id));
});
r.post('/candidate/referrals/:id/consent', L.need('job_seeker'), (req, res) => {
  const c = L.candidateOf(req.user.user_id); if (!c) return res.status(404).json({ error: 'Not found' });
  const x = db.prepare('UPDATE candidate_referrals SET consent_at=? WHERE referral_id=? AND candidate_id=? AND consent_at IS NULL').run(L.now(), req.params.id, c.candidate_id);
  if (!x.changes) return res.status(404).json({ error: 'Not found' });
  L.audit(req.user.user_id, 'referral_consent', 'referral', req.params.id); res.json({ ok: true });
});

// ---------- Digital / IT client ----------
const myProjects = (u) => { const ids = L.companyIds(u.user_id);
  return all(`SELECT * FROM digital_projects WHERE client_user_id=? OR company_id IN (${inList(ids)})`, u.user_id, ...ids); };
r.get('/digital/projects', L.need('digital_client'), (req, res) => res.json(myProjects(req.user)));
r.get('/digital/tasks', L.need('digital_client'), (req, res) => {
  const ids = myProjects(req.user).map(p => p.project_id);
  res.json(all(`SELECT * FROM project_tasks WHERE project_id IN (${inList(ids)}) ORDER BY due_date`, ...ids));
});
r.get('/digital/deliverables', L.need('digital_client'), (req, res) => {
  const ids = myProjects(req.user).map(p => p.project_id);
  res.json(all(`SELECT * FROM deliverables WHERE status!='draft' AND project_id IN (${inList(ids)})`, ...ids));
});
r.post('/digital/deliverables/:id/decision', L.need('digital_client'), (req, res) => {
  const ids = myProjects(req.user).map(p => p.project_id); const { decision, feedback } = req.body || {};
  if (!['approved', 'revision'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  const d = one('SELECT * FROM deliverables WHERE deliverable_id=?', req.params.id);
  if (!d || !ids.includes(d.project_id) || d.status !== 'submitted') return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE deliverables SET status=?, feedback=?, approved_by=?, approved_at=? WHERE deliverable_id=?')
    .run(decision, feedback || null, decision === 'approved' ? req.user.user_id : null, decision === 'approved' ? L.now() : null, d.deliverable_id);
  L.audit(req.user.user_id, 'deliverable_' + decision, 'deliverable', d.deliverable_id); res.json({ ok: true });
});

// ---------- Faculty attendance ----------
r.get('/faculty/sessions', L.need('faculty'), (req, res) => {
  const admin = L.has(req.user, 'admin') ? '' : 'WHERE cs.trainer_user_id=?';
  res.json(all(`SELECT cs.session_id, c.name course, cs.scheduled_at, cs.status FROM course_sessions cs JOIN courses c ON c.course_id=cs.course_id ${admin} ORDER BY cs.scheduled_at DESC LIMIT 100`, ...(admin ? [req.user.user_id] : [])));
});
r.get('/faculty/sessions/:id/students', L.need('faculty'), (req, res) => {
  const s = one('SELECT * FROM course_sessions WHERE session_id=?', req.params.id);
  if (!s || (!L.has(req.user, 'admin') && s.trainer_user_id !== req.user.user_id)) return res.status(404).json({ error: 'Not found' });
  res.json(all(`SELECT e.enrolment_id, u.name, a.status FROM enrolments e JOIN student_profiles sp ON sp.student_id=e.student_id
    JOIN users u ON u.user_id=sp.user_id LEFT JOIN attendance a ON a.enrolment_id=e.enrolment_id AND a.session_id=? WHERE e.course_id=? AND e.status='active'`, s.session_id, s.course_id));
});
r.post('/faculty/attendance', L.need('faculty'), (req, res) => {
  const { session_id, enrolment_id, status, reason } = req.body || {};
  if (!['present', 'absent', 'leave'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const s = one('SELECT * FROM course_sessions WHERE session_id=?', session_id);
  if (!s || (!L.has(req.user, 'admin') && s.trainer_user_id !== req.user.user_id)) return res.status(404).json({ error: 'Session not found' });
  if (s.status === 'cancelled' || s.status === 'rescheduled') return res.status(400).json({ error: 'Session was not conducted' });
  const e = one('SELECT * FROM enrolments WHERE enrolment_id=? AND course_id=?', enrolment_id, s.course_id);
  if (!e) return res.status(404).json({ error: 'Enrolment not found' });
  db.transaction(() => {
    const old = one('SELECT * FROM attendance WHERE enrolment_id=? AND session_id=?', enrolment_id, session_id);
    if (old && old.status !== status && !reason) throw new Error('REASON');
    if (old) {
      db.prepare('UPDATE attendance SET status=?, marked_by=?, marked_at=? WHERE attendance_id=?').run(status, req.user.user_id, L.now(), old.attendance_id);
      db.prepare('INSERT INTO attendance_history(attendance_id,old_status,new_status,changed_by,reason) VALUES(?,?,?,?,?)').run(old.attendance_id, old.status, status, req.user.user_id, reason);
      L.audit(req.user.user_id, 'attendance_correct', 'attendance', old.attendance_id, { from: old.status, to: status, reason });
    } else db.prepare('INSERT INTO attendance(enrolment_id,session_id,status,marked_by) VALUES(?,?,?,?)').run(enrolment_id, session_id, status, req.user.user_id);
  })();
  res.json({ ok: true });
});

// ---------- Staff (employee / manager / hr / accounts) ----------
r.get('/staff/attendance', L.need('employee', 'faculty', 'manager', 'hr', 'accounts'), (req, res) => {
  const e = L.employeeOf(req.user.user_id); if (!e) return res.json([]);
  res.json(all('SELECT date,status,check_in,check_out FROM staff_attendance WHERE employee_id=? ORDER BY date DESC LIMIT 62', e.employee_id));
});
r.get('/staff/leaves', L.need('employee', 'faculty', 'manager', 'hr', 'accounts'), (req, res) => {
  const e = L.employeeOf(req.user.user_id); if (!e) return res.json([]);
  res.json(all('SELECT * FROM leave_requests WHERE employee_id=? ORDER BY leave_id DESC', e.employee_id));
});
r.post('/staff/leaves', L.need('employee', 'faculty', 'manager', 'hr', 'accounts'), (req, res) => {
  const e = L.employeeOf(req.user.user_id); const b = req.body || {};
  if (!e || !b.from_date || !b.to_date) return res.status(400).json({ error: 'Dates required / no employee record' });
  db.prepare('INSERT INTO leave_requests(employee_id,leave_type,from_date,to_date,reason) VALUES(?,?,?,?,?)').run(e.employee_id, b.leave_type || 'casual', b.from_date, b.to_date, b.reason || '');
  if (e.manager_user_id) L.notify(e.manager_user_id, 'leave', `${req.user.name} requested leave ${b.from_date} to ${b.to_date}`);
  res.json({ ok: true });
});
r.get('/staff/payslips', L.need('employee', 'faculty', 'manager', 'hr', 'accounts'), (req, res) => {
  const e = L.employeeOf(req.user.user_id); if (!e) return res.json([]);
  res.json(all(`SELECT p.payslip_id, pr.period_start, pr.period_end, p.gross_paise, p.deductions_paise, p.net_paise, p.payment_status
    FROM payslips p JOIN payroll_runs pr ON pr.payroll_run_id=p.payroll_run_id WHERE p.employee_id=? AND pr.status='approved' ORDER BY pr.period_end DESC`, e.employee_id));
});
r.get('/manager/leaves', L.need('manager', 'hr'), (req, res) => {
  const scope = L.has(req.user, 'hr') ? '' : 'AND e.manager_user_id=?';
  res.json(all(`SELECT l.*, u.name employee FROM leave_requests l JOIN employees e ON e.employee_id=l.employee_id JOIN users u ON u.user_id=e.user_id
    WHERE l.status='pending' ${scope}`, ...(scope ? [req.user.user_id] : [])));
});
r.post('/manager/leaves/:id', L.need('manager', 'hr'), (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  const l = one('SELECT l.*, e.manager_user_id, e.user_id euid FROM leave_requests l JOIN employees e ON e.employee_id=l.employee_id WHERE leave_id=? AND l.status=\'pending\'', req.params.id);
  if (!l || (!L.has(req.user, 'hr') && l.manager_user_id !== req.user.user_id)) return res.status(404).json({ error: 'Not found' });
  if (l.euid === req.user.user_id && !L.has(req.user, 'admin')) return res.status(403).json({ error: 'Cannot approve own leave' });
  db.prepare('UPDATE leave_requests SET status=?, decided_by=?, decided_at=? WHERE leave_id=?').run(decision, req.user.user_id, L.now(), l.leave_id);
  L.audit(req.user.user_id, 'leave_' + decision, 'leave', l.leave_id); L.notify(l.euid, 'leave', `Your leave was ${decision}`);
  res.json({ ok: true });
});

// ---------- Tickets & notifications ----------
r.get('/tickets', (req, res) => res.json(L.has(req.user, 'hr', 'accounts', 'manager')
  ? all('SELECT t.*, u.name creator FROM support_tickets t JOIN users u ON u.user_id=t.created_by ORDER BY ticket_id DESC LIMIT 200')
  : all('SELECT * FROM support_tickets WHERE created_by=? ORDER BY ticket_id DESC', req.user.user_id)));
r.post('/tickets', (req, res) => {
  const b = req.body || {}; if (!b.subject) return res.status(400).json({ error: 'Subject required' });
  const id = db.prepare('INSERT INTO support_tickets(created_by,module,subject,message,priority) VALUES(?,?,?,?,?)')
    .run(req.user.user_id, String(b.module || '').slice(0, 40), String(b.subject).slice(0, 200), String(b.message || '').slice(0, 2000), ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal').lastInsertRowid;
  res.json({ ticket_id: id });
});
r.get('/notifications', (req, res) => res.json(all('SELECT * FROM notifications WHERE user_id=? ORDER BY notification_id DESC LIMIT 100', req.user.user_id)));
r.post('/notifications/read', (req, res) => { db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(L.now(), req.user.user_id); res.json({ ok: true }); });

// ---------- Files (private; every download re-checks permission) ----------
const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'video/mp4', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain']);
const STORE = path.join(__dirname, 'storage');
const upload = multer({
  storage: multer.diskStorage({ destination: STORE, filename: (q, f, cb) => cb(null, crypto.randomBytes(16).toString('hex')) }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(ALLOWED.has(f.mimetype) ? null : new Error('File type not allowed'), ALLOWED.has(f.mimetype))
});
function canSeeFile(u, f) {
  if (L.has(u, 'hr', 'accounts') || f.uploaded_by === u.user_id || f.owner_user_id === u.user_id) return true;
  if (f.visibility === 'company' && f.company_id && L.companyIds(u.user_id).includes(f.company_id)) return true;
  if (f.visibility === 'course' && f.course_id) {
    const s = L.studentOf(u.user_id);
    if (s && one('SELECT 1 FROM enrolments WHERE student_id=? AND course_id=?', s.student_id, f.course_id)) return true;
    if (L.has(u, 'faculty') && one('SELECT 1 FROM course_sessions WHERE course_id=? AND trainer_user_id=?', f.course_id, u.user_id)) return true;
  }
  if (L.has(u, 'employer')) { // resume of a candidate referred with consent to one of my companies
    const ids = L.companyIds(u.user_id);
    if (one(`SELECT 1 FROM candidate_profiles cp JOIN candidate_referrals r ON r.candidate_id=cp.candidate_id JOIN job_requirements j ON j.job_id=r.job_id
      WHERE cp.resume_file_id=? AND r.consent_at IS NOT NULL AND r.current_status!='matched' AND j.company_id IN (${inList(ids)})`, f.file_id, ...ids)) return true;
  }
  return false;
}
const wrapUpload = (fn) => (req, res, next) => fn(req, res, (e) => e ? res.status(400).json({ error: e.message }) : next());
r.post('/files', L.need('hr', 'faculty'), wrapUpload(upload.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const b = req.body; const vis = ['private', 'owner', 'company', 'course'].includes(b.visibility) ? b.visibility : 'private';
  const id = db.prepare('INSERT INTO files(storage_key,file_name,mime,size,uploaded_by,owner_user_id,company_id,visibility,course_id) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.user_id, +b.owner_user_id || null, +b.company_id || null, vis, +b.course_id || null).lastInsertRowid;
  L.audit(req.user.user_id, 'file_upload', 'file', id, { vis }); res.json({ file_id: id });
});
r.post('/candidate/resume', L.need('job_seeker'), wrapUpload(upload.single('file')), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const id = db.prepare("INSERT INTO files(storage_key,file_name,mime,size,uploaded_by,owner_user_id,visibility) VALUES(?,?,?,?,?,?,'owner')")
    .run(req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.user_id, req.user.user_id).lastInsertRowid;
  if (!L.candidateOf(req.user.user_id)) db.prepare('INSERT INTO candidate_profiles(user_id) VALUES(?)').run(req.user.user_id);
  db.prepare('UPDATE candidate_profiles SET resume_file_id=? WHERE user_id=?').run(id, req.user.user_id);
  res.json({ file_id: id });
});
r.get('/files/:id', (req, res) => {
  const f = one('SELECT * FROM files WHERE file_id=?', req.params.id);
  if (!f || !canSeeFile(req.user, f)) return res.status(404).json({ error: 'Not found' });
  if (f.owner_user_id !== req.user.user_id) L.audit(req.user.user_id, 'file_download', 'file', f.file_id);
  res.download(path.join(STORE, f.storage_key), f.file_name);
});
module.exports = r;
