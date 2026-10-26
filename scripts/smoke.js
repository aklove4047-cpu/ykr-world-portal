// End-to-end acceptance checks. Run: npm test
const os = require('os'), path = require('path'), crypto = require('crypto'), fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ykr-'));
Object.assign(process.env, { DB_PATH: path.join(tmp, 't.db'), DEV_SHOW_OTP: 'true', MOCK_PAYMENTS: 'true', RAZORPAY_KEY_ID: '', RAZORPAY_WEBHOOK_SECRET: 'whsec', NODE_ENV: 'test', JWT_SECRET: 'test-secret' });
const app = require('../server');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };
const srv = app.listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port;
  const call = async (jar, method, p, body) => {
    const r = await fetch(base + '/api' + p, { method, headers: { 'Content-Type': 'application/json', Cookie: jar.c || '' }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.getSetCookie?.()[0]; if (sc) jar.c = sc.split(';')[0];
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
  const login = async (id) => { const j = {}; const a = await call(j, 'POST', '/auth/request-otp', { identifier: id }); const b = await call(j, 'POST', '/auth/verify-otp', { identifier: id, code: a.j.dev_otp }); ok(b.s === 200, 'login ' + id); return j; };
  try {
    const admin = await login('admin@ykrworld.in');
    const mk = async (b) => (await call(admin, 'POST', '/admin/users', b)).j.user_id;
    const comp = (await call(admin, 'POST', '/admin/companies', { name: 'Acme' })).j.company_id;
    const comp2 = (await call(admin, 'POST', '/admin/companies', { name: 'Other Co' })).j.company_id;
    const A = await mk({ name: 'Student A', mobile: '9000000001', roles: 'student' }), B = await mk({ name: 'Student B', mobile: '9000000002', roles: 'student' });
    const course = (await call(admin, 'POST', '/admin/courses', { name: 'Public Speaking', total_sessions: 4, fee: 1000 })).j.course_id;
    await call(admin, 'POST', '/admin/enrol', { student_user_id: A, course_id: course }); await call(admin, 'POST', '/admin/enrol', { student_user_id: B, course_id: course });
    const invA = (await call(admin, 'POST', '/admin/invoices', { user_id: A, description: 'Fees', amount: 1000, tax: 180 })).j.invoice_id;
    const invB = (await call(admin, 'POST', '/admin/invoices', { user_id: B, description: 'Fees', amount: 1000 })).j.invoice_id;
    const a = await login('9000000001');
    ok((await call(a, 'GET', '/invoices')).j.length === 1, 'student A sees only own invoice');
    ok((await call(a, 'POST', `/invoices/${invB}/pay`)).s === 404, 'A cannot pay B invoice');
    ok((await call(a, 'GET', '/admin/users')).s === 403, 'student blocked from admin');
    // Full payment, amount decided by server
    const o = (await call(a, 'POST', `/invoices/${invA}/pay`, { amount: 1 })).j; ok(o.amount === 118000, 'server-decided amount');
    await call(a, 'POST', '/payments/mock-confirm', { order_id: o.order_id }); await call(a, 'POST', '/payments/mock-confirm', { order_id: o.order_id });
    const inv = (await call(a, 'GET', '/invoices')).j[0]; ok(inv.status === 'paid' && inv.paid_paise === 118000, 'invoice paid once');
    ok((await call(a, 'GET', '/my-payments')).j.length === 1, 'one payment + receipt only');
    // Partial manual + webhook
    const inv2 = (await call(admin, 'POST', '/admin/invoices', { user_id: A, description: 'Extra', amount: 500 })).j.invoice_id;
    ok((await call(admin, 'POST', '/admin/payments/manual', { invoice_id: inv2, amount: 200, method: 'cash' })).j.status === 'partially_paid', 'partial payment');
    ok((await call(admin, 'POST', '/admin/payments/manual', { invoice_id: inv2, amount: 999 })).s === 400, 'overpayment blocked');
    const o2 = (await call(a, 'POST', `/invoices/${inv2}/pay`)).j; ok(o2.amount === 30000, 'balance after partial');
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: o2.order_id, amount: 30000, method: 'upi' } } } });
    const wh = (sig, id) => fetch(base + '/api/webhooks/razorpay', { method: 'POST', headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': id }, body });
    const good = crypto.createHmac('sha256', 'whsec').update(body).digest('hex');
    ok((await wh('bad', 'evt_x')).status === 400, 'tampered webhook rejected');
    await wh(good, 'evt_1'); const dup = await (await wh(good, 'evt_1')).json();
    ok(dup.duplicate === true, 'duplicate webhook ignored');
    ok((await call(a, 'GET', '/invoices')).j.find(i => i.invoice_id === inv2).status === 'paid', 'webhook settled invoice');
    // Consultancy visibility
    const bc = await mk({ name: 'Biz Client', mobile: '9000000003', roles: 'business_client', company_id: comp });
    const eng = (await call(admin, 'POST', '/admin/engagements', { company_id: comp, title: 'Process fix' })).j.engagement_id;
    const dg = (await call(admin, 'POST', '/admin/diagnoses', { engagement_id: eng, findings: 'F', internal_notes: 'SECRET' })).j.diagnosis_id;
    const c = await login('9000000003'); ok((await call(c, 'GET', '/client/diagnoses')).j.length === 0, 'unreleased diagnosis hidden');
    await call(admin, 'POST', `/admin/diagnoses/${dg}/release`); const d = (await call(c, 'GET', '/client/diagnoses')).j;
    ok(d.length === 1 && !JSON.stringify(d).includes('SECRET'), 'released diagnosis without internal notes');
    // Recruitment
    await mk({ name: 'Recruiter', mobile: '9000000004', roles: 'employer', company_id: comp2 }); const cand = await mk({ name: 'Cand', mobile: '9000000005', roles: 'job_seeker' });
    const e = await login('9000000004'); const job = (await call(e, 'POST', '/employer/jobs', { title: 'Sales' })).j.job_id;
    const ref = (await call(admin, 'POST', '/admin/referrals', { candidate_user_id: cand, job_id: job })).j.referral_id;
    ok((await call(admin, 'POST', `/admin/referrals/${ref}/send`)).s === 400, 'cannot send without consent');
    const cj = await login('9000000005'); await call(cj, 'POST', `/candidate/referrals/${ref}/consent`); await call(admin, 'POST', `/admin/referrals/${ref}/send`);
    ok((await call(e, 'GET', '/employer/referrals')).j.length === 1, 'employer sees consented candidate');
    await call(e, 'POST', `/employer/referrals/${ref}`, { status: 'shortlisted', notes: 'EMPLOYER-ONLY' });
    ok(!JSON.stringify((await call(cj, 'GET', '/candidate/referrals')).j).includes('EMPLOYER-ONLY'), 'candidate cannot see employer notes');
    // Attendance
    const fac = await mk({ name: 'Faculty', mobile: '9000000006', roles: 'faculty' });
    const ses = (await call(admin, 'POST', '/admin/sessions', { course_id: course, trainer_user_id: fac, scheduled_at: '2026-11-01T10:00' })).j.session_id;
    const f = await login('9000000006'); const stu = (await call(f, 'GET', `/faculty/sessions/${ses}/students`)).j;
    ok((await call(f, 'POST', '/faculty/attendance', { session_id: ses, enrolment_id: stu[0].enrolment_id, status: 'present' })).s === 200, 'faculty marks attendance');
    ok((await call(f, 'POST', '/faculty/attendance', { session_id: ses, enrolment_id: stu[0].enrolment_id, status: 'absent' })).s === 400, 'correction needs reason');
    await call(admin, 'POST', `/admin/sessions/${ses}/status`, { status: 'rescheduled' });
    ok((await call(f, 'POST', '/faculty/attendance', { session_id: ses, enrolment_id: stu[1].enrolment_id, status: 'absent' })).s === 400, 'no absent on rescheduled session');
    ok((await call(f, 'GET', '/admin/payslips')).s === 403, 'faculty blocked from payroll');
    // Payroll maker-checker
    const emp = await mk({ name: 'Emp', mobile: '9000000007', roles: 'employee' }); await mk({ name: 'Accts', mobile: '9000000008', roles: 'accounts' });
    const eid = (await call(admin, 'GET', '/admin/employees')).j.find(x => x.name === 'Emp').employee_id;
    await call(admin, 'POST', '/admin/salary-structures', { employee_id: eid, base: 30000, effective_from: '2026-01-01' });
    const run = (await call(admin, 'POST', '/admin/payroll-runs', { period_start: '2026-10-01', period_end: '2026-10-31' })).j.payroll_run_id;
    ok((await call(admin, 'POST', `/admin/payroll-runs/${run}/approve`)).s === 403, 'preparer cannot approve own run');
    const ac = await login('9000000008'); ok((await call(ac, 'POST', `/admin/payroll-runs/${run}/approve`)).s === 200, 'second user approves');
    const em = await login('9000000007'); const ps = (await call(em, 'GET', '/staff/payslips')).j; ok(ps.length === 1 && ps[0].payment_status === 'pending', 'payslip not auto-paid');
    await call(ac, 'POST', `/admin/payslips/${ps[0].payslip_id}/pay`, { reference: 'UTR1' }); ok((await call(em, 'GET', '/staff/payslips')).j[0].payment_status === 'paid', 'salary paid after recording');
    ok((await call(a, 'GET', '/staff/payslips')).s === 403, 'student cannot read payslips');
    // OTP lockout
    const j = {}; const r1 = await call(j, 'POST', '/auth/request-otp', { identifier: '9000000002' });
    for (let i = 0; i < 5; i++) await call(j, 'POST', '/auth/verify-otp', { identifier: '9000000002', code: '000000' });
    ok((await call(j, 'POST', '/auth/verify-otp', { identifier: '9000000002', code: r1.j.dev_otp })).s === 400, 'OTP locked after 5 attempts');
    ok((await call(admin, 'GET', '/admin/audit')).j.length > 10, 'audit log populated');
  } catch (e) { fail++; console.log('ERROR', e); }
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
});
