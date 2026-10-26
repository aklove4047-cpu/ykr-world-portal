'use strict';
const $app = document.getElementById('app');
const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  c.flat(9).forEach(x => { if (x !== null && x !== undefined && x !== false) e.append(x.nodeType ? x : document.createTextNode(String(x))); });
  return e;
};
const api = async (path, method = 'GET', body) => {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/me') { state.user = null; go('login'); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
};
const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const state = { user: null, view: 'home', menu: null };
const go = (v) => { state.view = v; render(); };
const msg = (el, text, ok) => { el.replaceChildren(h('div', { class: 'msg ' + (ok ? 'ok' : 'err') }, text)); };

// ---------- Generic table ----------
const label = (k) => k.replace(/_paise$/, '').replace(/_/g, ' ');
function cell(k, v, row) {
  if (v === null || v === undefined || v === '') return '–';
  if (k.endsWith('_paise')) return rupees(v);
  if (k === 'file_id' || k === 'resume_file_id') return h('a', { href: '/api/files/' + v, target: '_blank', rel: 'noopener' }, 'Download');
  if (/status$|^attendance$/.test(k)) return h('span', { class: 'pill ' + String(v).replace(/ /g, '_') }, String(v).replace(/_/g, ' '));
  if (k === 'progress_pct') { const i = h('i'); i.style.width = v + '%'; return h('div', {}, h('div', { class: 'bar' }, i), v + '%'); }
  return String(v);
}
function table(rows, actions) {
  if (!rows.length) return h('div', { class: 'empty' }, 'Nothing here yet.');
  const hide = new Set(['internal_score', 'storage_key']);
  const keys = Object.keys(rows[0]).filter(k => !hide.has(k));
  return h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, keys.map(k => h('th', {}, label(k))), actions ? h('th', {}, '') : null)),
    h('tbody', {}, rows.map(r => h('tr', {}, keys.map(k => h('td', {}, cell(k, r[k], r))),
      actions ? h('td', {}, (actions(r) || []).map(([t, fn]) => h('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { await fn(r); } catch (x) { alert(x.message); } show(state.current); } }, t))) : null)))));
}

// ---------- Payments ----------
function loadRazorpay() {
  return new Promise((ok, no) => { if (window.Razorpay) return ok();
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load Razorpay')); document.head.append(s); });
}
async function payNow(inv) {
  const o = await api(`/invoices/${inv.invoice_id}/pay`, 'POST');
  if (o.mock) { if (confirm(`TEST MODE: pay ${rupees(o.amount)} for ${o.invoice_number}?`)) await api('/payments/mock-confirm', 'POST', { order_id: o.order_id }); return; }
  await loadRazorpay();
  await new Promise((done) => new window.Razorpay({
    key: o.key, amount: o.amount, currency: o.currency, order_id: o.order_id, name: 'YKR World', description: o.invoice_number, prefill: { name: o.name },
    handler: async (resp) => { try { await api('/payments/verify', 'POST', resp); alert('Payment successful. Receipt issued.'); } catch (e) { alert(e.message); } done(); },
    modal: { ondismiss: done }
  }).open());
}

// ---------- Forms ----------
const f = (n, l, type = 'text', extra = {}) => ({ n, l, type, ...extra });
const FORMS = {
  user: { t: 'Create user', p: '/admin/users', fields: [f('name', 'Full name'), f('email', 'Email', 'email'), f('mobile', 'Mobile (10 digits)'), f('roles', 'Roles (comma separated)', 'text', { ph: 'student, business_client, employer, job_seeker, digital_client, faculty, employee, manager, hr, accounts' }), f('company_id', 'Company ID (customers)', 'number'), f('department', 'Department (staff)'), f('designation', 'Designation (staff)'), f('manager_user_id', 'Manager user ID (staff)', 'number')] },
  userStatus: { t: 'Activate / deactivate user', p: v => `/admin/users/${v.user_id}/status`, fields: [f('user_id', 'User ID', 'number'), f('status', 'Status', 'select', { opts: ['active', 'inactive'] })] },
  company: { t: 'Add company', p: '/admin/companies', fields: [f('name', 'Company name'), f('industry', 'Industry'), f('address', 'Address'), f('size', 'Team size')] },
  link: { t: 'Link user to company', p: v => `/admin/companies/${v.company_id}/users`, fields: [f('company_id', 'Company ID', 'number'), f('user_id', 'User ID', 'number')] },
  course: { t: 'Add course', p: '/admin/courses', fields: [f('name', 'Course name'), f('category', 'Category'), f('duration_hours', 'Duration (hours)', 'number'), f('total_sessions', 'Total sessions', 'number'), f('fee', 'Fee (₹)', 'number')] },
  session: { t: 'Schedule class session', p: '/admin/sessions', fields: [f('course_id', 'Course ID', 'number'), f('trainer_user_id', 'Trainer user ID', 'number'), f('scheduled_at', 'Date & time', 'datetime-local'), f('location', 'Location / online link')] },
  sessionStatus: { t: 'Set session status', p: v => `/admin/sessions/${v.id}/status`, fields: [f('id', 'Session ID', 'number'), f('status', 'Status', 'select', { opts: ['scheduled', 'completed', 'cancelled', 'rescheduled'] })] },
  enrol: { t: 'Enrol student', p: '/admin/enrol', fields: [f('student_user_id', 'Student user ID', 'number'), f('course_id', 'Course ID', 'number'), f('fee', 'Fee ₹ (blank = course fee)', 'number')] },
  cert: { t: 'Issue certificate', p: '/admin/certificates', fields: [f('enrolment_id', 'Enrolment ID', 'number')] },
  engagement: { t: 'New consultancy engagement', p: '/admin/engagements', fields: [f('company_id', 'Company ID', 'number'), f('title', 'Title'), f('scope', 'Scope', 'textarea'), f('start_date', 'Start', 'date'), f('end_date', 'End', 'date'), f('amount', 'Amount (₹)', 'number')] },
  diagnosis: { t: 'Add diagnosis (internal)', p: '/admin/diagnoses', fields: [f('engagement_id', 'Engagement ID', 'number'), f('issue_area', 'Issue area'), f('findings', 'Findings', 'textarea'), f('solution', 'Solution plan', 'textarea'), f('internal_notes', 'Internal notes (never shown to client)', 'textarea')] },
  release: { t: 'Release diagnosis to client', p: v => `/admin/diagnoses/${v.id}/release`, fields: [f('id', 'Diagnosis ID', 'number')] },
  csession: { t: 'Add consultancy session', p: '/admin/consultancy-sessions', fields: [f('engagement_id', 'Engagement ID', 'number'), f('topic', 'Topic'), f('scheduled_at', 'Date & time', 'datetime-local')] },
  match: { t: 'Match candidate to job', p: '/admin/referrals', fields: [f('candidate_user_id', 'Candidate user ID', 'number'), f('job_id', 'Job ID', 'number')] },
  project: { t: 'New digital/IT project', p: '/admin/projects', fields: [f('name', 'Project name'), f('company_id', 'Company ID', 'number'), f('client_user_id', 'Client user ID', 'number'), f('scope', 'Scope', 'textarea'), f('start_date', 'Start', 'date'), f('end_date', 'End', 'date')] },
  task: { t: 'Add project task', p: '/admin/tasks', fields: [f('project_id', 'Project ID', 'number'), f('title', 'Title'), f('due_date', 'Due', 'date'), f('status', 'Status', 'select', { opts: ['todo', 'in_progress', 'done'] }), f('notes', 'Notes')] },
  deliverable: { t: 'Add deliverable', p: '/admin/deliverables', fields: [f('project_id', 'Project ID', 'number'), f('title', 'Title'), f('link', 'Link (optional)'), f('file_id', 'Uploaded file ID (optional)', 'number'), f('status', 'Status', 'select', { opts: ['draft', 'submitted'] })] },
  invoice: { t: 'Create invoice', p: '/admin/invoices', fields: [f('user_id', 'Bill to user ID (or company)', 'number'), f('company_id', 'Bill to company ID', 'number'), f('description', 'Description'), f('amount', 'Amount ₹ (before tax)', 'number'), f('tax', 'Tax ₹', 'number'), f('due_date', 'Due date', 'date')] },
  cancelInv: { t: 'Cancel unpaid invoice', p: v => `/admin/invoices/${v.id}/cancel`, fields: [f('id', 'Invoice ID', 'number')] },
  manual: { t: 'Record manual payment', p: '/admin/payments/manual', fields: [f('invoice_id', 'Invoice ID', 'number'), f('amount', 'Amount ₹', 'number'), f('method', 'Method (cash/bank/UPI)'), f('reference', 'Reference no.')] },
  reply: { t: 'Reply to ticket', p: v => `/admin/tickets/${v.id}`, fields: [f('id', 'Ticket ID', 'number'), f('reply', 'Reply', 'textarea'), f('status', 'Status', 'select', { opts: ['open', 'in_progress', 'resolved'] })] },
  staffAtt: { t: 'Mark staff attendance', p: '/admin/staff-attendance', fields: [f('employee_id', 'Employee ID', 'number'), f('date', 'Date', 'date'), f('status', 'Status', 'select', { opts: ['present', 'absent', 'late', 'half_day', 'remote', 'holiday', 'leave'] })] },
  salary: { t: 'Set salary structure', p: '/admin/salary-structures', fields: [f('employee_id', 'Employee ID', 'number'), f('base', 'Base ₹/month', 'number'), f('allowances', 'Allowances ₹', 'number'), f('deductions', 'Fixed deductions ₹', 'number'), f('effective_from', 'Effective from', 'date')] },
  payroll: { t: 'Prepare payroll run', p: '/admin/payroll-runs', fields: [f('period_start', 'Period start', 'date'), f('period_end', 'Period end', 'date')] },
  approve: { t: 'Approve payroll run (different user from preparer)', p: v => `/admin/payroll-runs/${v.id}/approve`, fields: [f('id', 'Payroll run ID', 'number')] },
  payslipPay: { t: 'Record salary payment', p: v => `/admin/payslips/${v.id}/pay`, fields: [f('id', 'Payslip ID', 'number'), f('paid_on', 'Paid on', 'date'), f('method', 'Method'), f('reference', 'Bank reference')] },
  upload: { t: 'Upload document', p: null, upload: true, fields: [f('visibility', 'Visible to', 'select', { opts: ['private', 'owner', 'company', 'course'] }), f('owner_user_id', 'Owner user ID (for "owner")', 'number'), f('company_id', 'Company ID (for "company")', 'number'), f('course_id', 'Course ID (for "course")', 'number')] },
  job: { t: 'Post a job requirement', p: '/employer/jobs', fields: [f('title', 'Job title'), f('vacancies', 'Vacancies', 'number'), f('skills', 'Skills'), f('location', 'Location'), f('salary_range', 'Salary range')] },
  leave: { t: 'Request leave', p: '/staff/leaves', fields: [f('leave_type', 'Type', 'select', { opts: ['casual', 'sick', 'earned', 'unpaid'] }), f('from_date', 'From', 'date'), f('to_date', 'To', 'date'), f('reason', 'Reason')] },
  ticket: { t: 'New support ticket', p: '/tickets', fields: [f('module', 'Area (fees, attendance, project…)'), f('subject', 'Subject'), f('message', 'Message', 'textarea'), f('priority', 'Priority', 'select', { opts: ['low', 'normal', 'high'] })] },
  profile: { t: 'My profile', p: '/candidate/profile', method: 'PUT', load: '/candidate/profile', fields: [f('education', 'Education'), f('experience', 'Experience'), f('skills', 'Skills'), f('location', 'Preferred location'), f('expected_salary', 'Expected salary'), f('availability', 'Availability')] },
  resume: { t: 'Upload resume (PDF/DOC)', p: '/candidate/resume', upload: true, fields: [] }
};
function formView(key) {
  const F = FORMS[key]; const out = h('div'); const form = h('form', { class: 'glass form' });
  const inputs = {};
  F.fields.forEach(x => {
    const el = x.type === 'select' ? h('select', {}, x.opts.map(o => h('option', { value: o }, o))) : x.type === 'textarea' ? h('textarea', { rows: 3 }) : h('input', { type: x.type, placeholder: x.ph || '' });
    inputs[x.n] = el; form.append(h('label', {}, x.l), el);
  });
  let fileEl; if (F.upload) { fileEl = h('input', { type: 'file' }); form.append(h('label', {}, 'File'), fileEl); }
  const res = h('div'); form.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Submit')), res);
  if (F.load) api(F.load).then(d => Object.entries(inputs).forEach(([k, el]) => { if (d[k] != null) el.value = d[k]; })).catch(() => {});
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const v = {};
    for (const [k, el] of Object.entries(inputs)) if (el.value !== '') v[k] = el.value;
    try {
      let r;
      if (F.upload) {
        if (!fileEl.files[0]) throw new Error('Choose a file');
        const fd = new FormData(); fd.append('file', fileEl.files[0]); Object.entries(v).forEach(([k, x]) => fd.append(k, x));
        const resp = await fetch('/api' + (F.p || '/files'), { method: 'POST', body: fd }); r = await resp.json(); if (!resp.ok) throw new Error(r.error);
      } else r = await api(typeof F.p === 'function' ? F.p(v) : F.p, F.method || 'POST', v);
      msg(res, 'Saved. ' + Object.entries(r).filter(([k]) => k !== 'ok').map(([k, x]) => `${k}: ${x}`).join(' · '), true);
      if (!F.load) form.reset();
    } catch (x) { msg(res, x.message, false); }
  });
  out.append(form); return out;
}

// ---------- Menus ----------
const T = (l, p, o = {}) => ({ l, p, ...o });
const FM = (l, k) => ({ l, form: k });
const invoiceItem = T('Invoices', '/invoices', { actions: r => (r.balance_paise > 0 && r.status !== 'cancelled') ? [['Pay Now', () => payNow(r)]] : [] });
const payItem = T('Payments & receipts', '/my-payments');
const supportItems = [T('My tickets', '/tickets'), FM('New ticket', 'ticket')];
const attendanceMark = {
  l: 'Mark attendance', custom: async (box) => {
    const rows = await api('/faculty/sessions');
    const detail = h('div');
    box.append(table(rows, r => [['Open', async () => {
      const st = await api(`/faculty/sessions/${r.session_id}/students`);
      detail.replaceChildren(h('h3', {}, `${r.course} — ${r.scheduled_at}`), table(st, s => ['present', 'absent', 'leave'].map(x => [x, async () => {
        const body = { session_id: r.session_id, enrolment_id: s.enrolment_id, status: x };
        if (s.status && s.status !== x) { body.reason = prompt('Reason for correcting attendance?'); if (!body.reason) return; }
        await api('/faculty/attendance', 'POST', body);
        r.session_id && detail.replaceChildren();
      }])));
    }]]), detail);
  }
};
const MENUS = {
  student: [T('My courses', '/student/courses'), T('Attendance', '/student/attendance'), T('Schedule', '/student/schedule'), T('Learning material', '/student/materials'), T('Certificates', '/student/certificates'), invoiceItem, payItem, ...supportItems],
  business_client: [T('Engagements', '/client/engagements'), T('Diagnosis & solution', '/client/diagnoses'), T('Sessions', '/client/sessions'), T('Documents', '/client/documents'), invoiceItem, payItem, ...supportItems],
  employer: [T('My jobs', '/employer/jobs'), FM('Post a job', 'job'),
    T('Candidates', '/employer/referrals', { actions: r => [['Shortlist', () => api('/employer/referrals/' + r.referral_id, 'POST', { status: 'shortlisted' })],
      ['Interview', async () => { const d = prompt('Interview date/time (YYYY-MM-DD HH:MM)'); if (d) await api('/employer/referrals/' + r.referral_id, 'POST', { status: 'interview_scheduled', interview_at: d }); }],
      ['Select', () => api('/employer/referrals/' + r.referral_id, 'POST', { status: 'selected' })], ['Reject', () => api('/employer/referrals/' + r.referral_id, 'POST', { status: 'rejected' })],
      ['Offer', () => api('/employer/referrals/' + r.referral_id, 'POST', { status: 'offer' })], ['Joined', () => api('/employer/referrals/' + r.referral_id, 'POST', { status: 'joined' })]] }),
    T('Documents', '/client/documents'), invoiceItem, payItem, ...supportItems],
  job_seeker: [FM('My profile', 'profile'), FM('Upload resume', 'resume'),
    T('My applications', '/candidate/referrals', { actions: r => r.consent_at ? [] : [['Give consent', () => api(`/candidate/referrals/${r.referral_id}/consent`, 'POST')]] }), ...supportItems],
  digital_client: [T('Projects', '/digital/projects'), T('Tasks', '/digital/tasks'),
    T('Deliverables', '/digital/deliverables', { actions: r => r.status === 'submitted' ? [['Approve', () => api(`/digital/deliverables/${r.deliverable_id}/decision`, 'POST', { decision: 'approved' })],
      ['Request changes', async () => { const fb = prompt('What should change?'); if (fb) await api(`/digital/deliverables/${r.deliverable_id}/decision`, 'POST', { decision: 'revision', feedback: fb }); }]] : [] }),
    T('Documents', '/client/documents'), invoiceItem, payItem, ...supportItems],
  faculty: [attendanceMark, T('Class sessions', '/faculty/sessions')],
  employee: [T('My attendance', '/staff/attendance'), T('My leave', '/staff/leaves'), FM('Request leave', 'leave'), T('My payslips', '/staff/payslips'), ...supportItems],
  manager: [T('Leave approvals', '/manager/leaves', { actions: r => [['Approve', () => api('/manager/leaves/' + r.leave_id, 'POST', { decision: 'approved' })], ['Reject', () => api('/manager/leaves/' + r.leave_id, 'POST', { decision: 'rejected' })]] }),
    FM('Mark staff attendance', 'staffAtt'), T('Summary report', '/admin/reports/summary', { kv: true })],
  hr: [T('Users', '/admin/users'), FM('Create user', 'user'), FM('Link user to company', 'link'), T('Companies', '/admin/companies'), FM('Add company', 'company'),
    T('Courses', '/admin/courses'), FM('Add course', 'course'), FM('Schedule session', 'session'), FM('Set session status', 'sessionStatus'), FM('Enrol student', 'enrol'), FM('Issue certificate', 'cert'),
    FM('New engagement', 'engagement'), FM('Add diagnosis', 'diagnosis'), FM('Release diagnosis', 'release'), FM('Consultancy session', 'csession'),
    T('Referrals', '/admin/referrals', { actions: r => r.current_status === 'matched' ? [['Send to employer', () => api(`/admin/referrals/${r.referral_id}/send`, 'POST')]] : [] }), FM('Match candidate', 'match'),
    FM('New project', 'project'), FM('Add task', 'task'), FM('Add deliverable', 'deliverable'), FM('Upload document', 'upload'), T('Enquiries', '/admin/enquiries'),
    T('Support tickets', '/tickets'), FM('Reply to ticket', 'reply'), T('Employees', '/admin/employees'), FM('Mark staff attendance', 'staffAtt'),
    T('Leave approvals', '/manager/leaves', { actions: r => [['Approve', () => api('/manager/leaves/' + r.leave_id, 'POST', { decision: 'approved' })], ['Reject', () => api('/manager/leaves/' + r.leave_id, 'POST', { decision: 'rejected' })]] }),
    T('Summary report', '/admin/reports/summary', { kv: true })],
  accounts: [T('All invoices', '/admin/invoices'), FM('Create invoice', 'invoice'), FM('Cancel invoice', 'cancelInv'), FM('Record manual payment', 'manual'), T('All payments', '/admin/payments'),
    T('Employees', '/admin/employees'), FM('Set salary structure', 'salary'), FM('Prepare payroll', 'payroll'), FM('Approve payroll', 'approve'), T('Payslips', '/admin/payslips'), FM('Record salary payment', 'payslipPay'),
    T('Summary report', '/admin/reports/summary', { kv: true })],
  admin: [FM('Activate / deactivate user', 'userStatus'), T('Audit log', '/admin/audit')]
};
const menuFor = (roles) => {
  const seen = new Set(), out = [];
  const order = ['admin', 'hr', 'accounts', 'manager', 'faculty', 'employee', 'student', 'business_client', 'employer', 'job_seeker', 'digital_client'];
  const eff = roles.includes('admin') ? ['admin', 'hr', 'accounts', 'manager', 'faculty'] : roles;
  order.filter(r => eff.includes(r)).forEach(r => (MENUS[r] || []).forEach(m => { const k = m.l; if (!seen.has(k)) { seen.add(k); out.push(m); } }));
  return out;
};

async function show(item) {
  state.current = item; const box = $app.querySelector('#content'); if (!box) return;
  box.replaceChildren(h('h2', {}, item.l), h('div', { class: 'empty' }, 'Loading…'));
  const body = h('div');
  try {
    if (item.form) body.append(formView(item.form));
    else if (item.custom) await item.custom(body);
    else {
      let data = await api(item.p);
      if (item.kv) data = Object.entries(data).map(([k, v]) => ({ metric: label(k), value: Array.isArray(v) ? v.map(x => `${x.role_code}: ${x.n}`).join(', ') : k.endsWith('_paise') ? rupees(v) : v }));
      body.append(table(data, item.actions));
    }
  } catch (e) { body.append(h('div', { class: 'msg err' }, e.message)); }
  box.replaceChildren(h('h2', {}, item.l), body);
  $app.querySelectorAll('.side button').forEach(b => b.classList.toggle('on', b.dataset.l === item.l));
}

// ---------- Views ----------
function nav() {
  return h('div', { class: 'glass nav' }, h('div', { class: 'brand', onclick: () => go('home') }, 'YKR WORLD'),
    h('div', { class: 'row' }, state.user ? [h('span', {}, state.user.name), h('button', { class: 'btn', onclick: async () => { await api('/auth/logout', 'POST').catch(() => {}); state.user = null; go('home'); } }, 'Log out')]
      : h('button', { class: 'btn primary', onclick: () => go('login') }, 'Login')));
}
function simpleForm(title, fields, endpoint, okText, extra = {}) {
  const res = h('div'); const inputs = {};
  const form = h('form', { class: 'glass form' }, h('h3', {}, title));
  fields.forEach(x => { const el = x.type === 'textarea' ? h('textarea', { rows: 3 }) : x.type === 'select' ? h('select', {}, x.opts.map(o => h('option', {}, o))) : h('input', { type: x.type || 'text' }); inputs[x.n] = el; form.append(h('label', {}, x.l), el); });
  let consent; if (extra.consent) { consent = h('input', { type: 'checkbox' }); form.append(h('label', {}, consent, ' ' + extra.consent)); }
  form.append(h('button', { class: 'btn primary', type: 'submit' }, 'Submit'), res);
  form.addEventListener('submit', async (e) => { e.preventDefault(); const v = {}; for (const [k, el] of Object.entries(inputs)) v[k] = el.value; if (consent) v.consent = consent.checked;
    try { await api(endpoint, 'POST', v); msg(res, okText, true); form.reset(); } catch (x) { msg(res, x.message, false); } });
  return form;
}
function home() {
  const V = [['Individual Training', 'Public speaking, Business English, accent, interview and leadership development.'], ['Business Training & Consultancy', 'We diagnose root causes and deliver practical, customised solutions.'],
    ['HR Recruitment & Placement', 'We match the right candidates to your hiring needs and track every step.'], ['Digital Marketing & IT', 'Branding, social media, SEO and website development.']];
  return [nav(), h('div', { class: 'wrap' },
    h('div', { class: 'glass hero' }, h('h1', {}, 'Grow your skills. Fix your business. Hire and get hired.'), h('p', {}, 'YKR World brings training, consultancy, recruitment and digital services together with a secure client portal.'),
      h('button', { class: 'btn primary', onclick: () => go('login') }, 'Open your portal')),
    h('div', { class: 'grid' }, V.map(([t, d]) => h('div', { class: 'glass card' }, h('h3', {}, t), h('p', {}, d)))),
    h('div', { class: 'grid' },
      simpleForm('Send an enquiry', [{ n: 'vertical', l: 'Service', type: 'select', opts: V.map(x => x[0]) }, { n: 'name', l: 'Your name' }, { n: 'mobile', l: 'Mobile' }, { n: 'email', l: 'Email', type: 'email' }, { n: 'message', l: 'How can we help?', type: 'textarea' }], '/public/enquiry', 'Thank you! We will contact you soon.'),
      simpleForm('Job seeker registration', [{ n: 'name', l: 'Full name' }, { n: 'mobile', l: 'Mobile' }, { n: 'email', l: 'Email', type: 'email' }], '/public/register-candidate', 'Registered. Log in with OTP to complete your profile.', { consent: 'I agree that YKR World may store my details and share my profile with employers only after I give consent for each job.' })),
    h('footer', {}, '© YKR World · Privacy · Terms'))];
}
function login() {
  const res = h('div'); let step = 1, ident = '';
  const idEl = h('input', { type: 'text', placeholder: 'Registered mobile or email', autocomplete: 'username' });
  const codeEl = h('input', { type: 'text', inputmode: 'numeric', placeholder: '6-digit code', autocomplete: 'one-time-code', maxlength: 6 });
  const codeBox = h('div', { class: 'hide' }); const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Send OTP');
  codeBox.hidden = true; codeBox.append(h('label', {}, 'Enter OTP'), codeEl);
  const form = h('form', { class: 'glass form' }, h('h3', {}, 'Login'), h('label', {}, 'Mobile or email'), idEl, codeBox, h('div', { class: 'row' }, btn), res);
  form.addEventListener('submit', async (e) => { e.preventDefault();
    try {
      if (step === 1) { ident = idEl.value; const r = await api('/auth/request-otp', 'POST', { identifier: ident }); step = 2; codeBox.hidden = false; btn.textContent = 'Verify & login'; msg(res, r.message + (r.dev_otp ? ` (dev OTP: ${r.dev_otp})` : ''), true); }
      else { const r = await api('/auth/verify-otp', 'POST', { identifier: ident, code: codeEl.value }); state.user = r.user; go('app'); }
    } catch (x) { msg(res, x.message, false); } });
  return [nav(), h('div', { class: 'wrap' }, form)];
}
async function dash() {
  const u = await api('/me').catch(() => null); if (!u) { state.user = null; return go('login'); } state.user = u;
  const items = menuFor(u.roles); const bell = h('button', { class: 'btn', onclick: async () => { await show(T('Notifications', '/notifications')); api('/notifications/read', 'POST'); bell.replaceChildren('🔔'); } }, '🔔');
  api('/notifications').then(n => { const c = n.filter(x => !x.read_at).length; if (c) bell.append(h('span', { class: 'badge' }, c)); });
  const side = h('div', { class: 'glass side' }, items.map(m => h('button', { 'data-l': m.l, onclick: () => show(m) }, m.l)));
  $app.replaceChildren(nav(), h('div', { class: 'wrap row' }, bell, h('span', {}, 'Roles: ' + u.roles.join(', '))), h('div', { class: 'layout' }, side, h('div', { class: 'glass main', id: 'content' })));
  if (items[0]) show(items[0]);
}
function render() {
  if (state.view === 'app') { dash(); return; }
  $app.replaceChildren(...(state.view === 'login' ? login() : home()));
}
api('/me').then(u => { state.user = u; state.view = 'app'; render(); }).catch(() => render());
