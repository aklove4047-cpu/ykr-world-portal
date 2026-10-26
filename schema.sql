CREATE TABLE IF NOT EXISTS users(
  user_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  email TEXT UNIQUE, mobile TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_roles(
  user_id INTEGER NOT NULL REFERENCES users(user_id), role_code TEXT NOT NULL,
  assigned_by INTEGER, PRIMARY KEY(user_id, role_code));
CREATE TABLE IF NOT EXISTS otp_codes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, identifier TEXT NOT NULL, code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS enquiries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, vertical TEXT, name TEXT, mobile TEXT, email TEXT,
  message TEXT, status TEXT DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS files(
  file_id INTEGER PRIMARY KEY AUTOINCREMENT, storage_key TEXT NOT NULL, file_name TEXT, mime TEXT, size INTEGER,
  uploaded_by INTEGER, owner_user_id INTEGER, company_id INTEGER,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN('private','owner','company','course')),
  course_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS companies(
  company_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, industry TEXT, address TEXT, size TEXT,
  status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS company_users(
  company_id INTEGER NOT NULL REFERENCES companies(company_id), user_id INTEGER NOT NULL REFERENCES users(user_id),
  access_role TEXT DEFAULT 'member', PRIMARY KEY(company_id,user_id));

CREATE TABLE IF NOT EXISTS student_profiles(
  student_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL REFERENCES users(user_id),
  dob TEXT, address TEXT, joining_date TEXT);
CREATE TABLE IF NOT EXISTS courses(
  course_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT, duration_hours INTEGER,
  total_sessions INTEGER DEFAULT 1, fee_paise INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS enrolments(
  enrolment_id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL REFERENCES student_profiles(student_id),
  course_id INTEGER NOT NULL REFERENCES courses(course_id), start_date TEXT, end_date TEXT,
  status TEXT DEFAULT 'active', fee_paise INTEGER DEFAULT 0, UNIQUE(student_id,course_id));
CREATE TABLE IF NOT EXISTS course_sessions(
  session_id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL REFERENCES courses(course_id),
  trainer_user_id INTEGER REFERENCES users(user_id), scheduled_at TEXT NOT NULL, location TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN('scheduled','completed','cancelled','rescheduled')));
CREATE TABLE IF NOT EXISTS attendance(
  attendance_id INTEGER PRIMARY KEY AUTOINCREMENT, enrolment_id INTEGER NOT NULL REFERENCES enrolments(enrolment_id),
  session_id INTEGER NOT NULL REFERENCES course_sessions(session_id),
  status TEXT NOT NULL CHECK(status IN('present','absent','leave')), marked_by INTEGER, marked_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(enrolment_id,session_id));
CREATE TABLE IF NOT EXISTS attendance_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT, attendance_id INTEGER, old_status TEXT, new_status TEXT,
  changed_by INTEGER, reason TEXT, changed_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS certificates(
  certificate_id INTEGER PRIMARY KEY AUTOINCREMENT, enrolment_id INTEGER UNIQUE NOT NULL REFERENCES enrolments(enrolment_id),
  certificate_code TEXT UNIQUE, issued_at TEXT DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT 'issued');

CREATE TABLE IF NOT EXISTS consultancy_engagements(
  engagement_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(company_id),
  title TEXT, scope TEXT, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'enquiry', amount_paise INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS diagnoses(
  diagnosis_id INTEGER PRIMARY KEY AUTOINCREMENT, engagement_id INTEGER NOT NULL REFERENCES consultancy_engagements(engagement_id),
  issue_area TEXT, findings TEXT, solution TEXT, internal_notes TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK(visibility IN('internal','client')), status TEXT DEFAULT 'draft');
CREATE TABLE IF NOT EXISTS consultancy_sessions(
  session_id INTEGER PRIMARY KEY AUTOINCREMENT, engagement_id INTEGER NOT NULL REFERENCES consultancy_engagements(engagement_id),
  topic TEXT, scheduled_at TEXT, status TEXT DEFAULT 'scheduled', summary TEXT);

CREATE TABLE IF NOT EXISTS candidate_profiles(
  candidate_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL REFERENCES users(user_id),
  education TEXT, experience TEXT, skills TEXT, location TEXT, expected_salary TEXT, availability TEXT,
  resume_file_id INTEGER, consent_at TEXT);
CREATE TABLE IF NOT EXISTS job_requirements(
  job_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL REFERENCES companies(company_id),
  title TEXT NOT NULL, vacancies INTEGER DEFAULT 1, skills TEXT, location TEXT, salary_range TEXT, status TEXT DEFAULT 'open');
CREATE TABLE IF NOT EXISTS candidate_referrals(
  referral_id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id INTEGER NOT NULL REFERENCES candidate_profiles(candidate_id),
  job_id INTEGER NOT NULL REFERENCES job_requirements(job_id), consent_at TEXT,
  current_status TEXT NOT NULL DEFAULT 'matched' CHECK(current_status IN('matched','sent','shortlisted','interview_scheduled','selected','rejected','offer','joined')),
  interview_at TEXT, employer_notes TEXT, internal_score INTEGER, UNIQUE(candidate_id,job_id));
CREATE TABLE IF NOT EXISTS referral_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT, referral_id INTEGER, old_status TEXT, new_status TEXT, changed_by INTEGER,
  changed_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS placement_records(
  placement_id INTEGER PRIMARY KEY AUTOINCREMENT, referral_id INTEGER UNIQUE REFERENCES candidate_referrals(referral_id),
  salary TEXT, joining_date TEXT, fee_basis TEXT, status TEXT DEFAULT 'open');

CREATE TABLE IF NOT EXISTS digital_projects(
  project_id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER REFERENCES companies(company_id),
  client_user_id INTEGER REFERENCES users(user_id), name TEXT NOT NULL, scope TEXT, start_date TEXT, end_date TEXT,
  status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS project_tasks(
  task_id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES digital_projects(project_id),
  title TEXT NOT NULL, owner_user_id INTEGER, due_date TEXT, status TEXT DEFAULT 'todo', notes TEXT);
CREATE TABLE IF NOT EXISTS deliverables(
  deliverable_id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES digital_projects(project_id),
  title TEXT, file_id INTEGER, link TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','submitted','revision','approved')),
  feedback TEXT, approved_by INTEGER, approved_at TEXT);

CREATE TABLE IF NOT EXISTS invoices(
  invoice_id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT UNIQUE, user_id INTEGER REFERENCES users(user_id),
  company_id INTEGER REFERENCES companies(company_id), description TEXT, subtotal_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL DEFAULT 0, total_paise INTEGER NOT NULL, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','partially_paid','paid','cancelled')),
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments(
  payment_id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(invoice_id),
  provider TEXT NOT NULL, provider_order_id TEXT UNIQUE, provider_payment_id TEXT UNIQUE,
  amount_paise INTEGER NOT NULL, currency TEXT DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created' CHECK(status IN('created','paid','failed','refunded')),
  method TEXT, reference TEXT, paid_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payment_events(
  event_id INTEGER PRIMARY KEY AUTOINCREMENT, provider_event_id TEXT UNIQUE NOT NULL, event_type TEXT,
  payload TEXT, signature_verified INTEGER, processing_status TEXT, received_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS receipts(
  receipt_id INTEGER PRIMARY KEY AUTOINCREMENT, payment_id INTEGER UNIQUE NOT NULL REFERENCES payments(payment_id),
  receipt_number TEXT UNIQUE, issued_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS support_tickets(
  ticket_id INTEGER PRIMARY KEY AUTOINCREMENT, created_by INTEGER NOT NULL REFERENCES users(user_id), module TEXT,
  subject TEXT NOT NULL, message TEXT, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', reply TEXT,
  assigned_to INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications(
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(user_id), type TEXT,
  message TEXT, read_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id INTEGER, action TEXT, entity_type TEXT, entity_id TEXT,
  meta TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS employees(
  employee_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL REFERENCES users(user_id),
  department TEXT, designation TEXT, manager_user_id INTEGER, joining_date TEXT, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS staff_attendance(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(employee_id), date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('present','absent','late','half_day','remote','holiday','leave')),
  check_in TEXT, check_out TEXT, marked_by INTEGER, UNIQUE(employee_id,date));
CREATE TABLE IF NOT EXISTS leave_requests(
  leave_id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
  leave_type TEXT, from_date TEXT, to_date TEXT, reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')), decided_by INTEGER, decided_at TEXT);
CREATE TABLE IF NOT EXISTS salary_structures(
  id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL REFERENCES employees(employee_id),
  base_paise INTEGER NOT NULL, allowances_paise INTEGER DEFAULT 0, deductions_paise INTEGER DEFAULT 0,
  effective_from TEXT NOT NULL, approved_by INTEGER);
CREATE TABLE IF NOT EXISTS payroll_runs(
  payroll_run_id INTEGER PRIMARY KEY AUTOINCREMENT, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved')), prepared_by INTEGER, approved_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payslips(
  payslip_id INTEGER PRIMARY KEY AUTOINCREMENT, payroll_run_id INTEGER NOT NULL REFERENCES payroll_runs(payroll_run_id),
  employee_id INTEGER NOT NULL REFERENCES employees(employee_id), gross_paise INTEGER, deductions_paise INTEGER, net_paise INTEGER,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN('pending','paid','on_hold')),
  UNIQUE(payroll_run_id,employee_id));
CREATE TABLE IF NOT EXISTS salary_payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, payslip_id INTEGER NOT NULL REFERENCES payslips(payslip_id), amount_paise INTEGER,
  paid_on TEXT, method TEXT, reference TEXT, recorded_by INTEGER);

CREATE INDEX IF NOT EXISTS ix_enrol_student ON enrolments(student_id);
CREATE INDEX IF NOT EXISTS ix_att_enrol ON attendance(enrolment_id);
CREATE INDEX IF NOT EXISTS ix_inv_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS ix_inv_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS ix_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS ix_ref_job ON candidate_referrals(job_id);
CREATE INDEX IF NOT EXISTS ix_task_project ON project_tasks(project_id);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs(entity_type, entity_id);
