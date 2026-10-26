# YKR World Portal (v1.1)

Node.js + Express + SQLite. Free, self-hostable. UI is plain HTML/CSS/JS (glassmorphism), no build step.

## Run locally
```bash
npm install
cp .env.example .env      # edit JWT_SECRET
npm start                 # http://localhost:3000
npm test                  # 36 end-to-end acceptance checks
```
First start seeds an admin from ADMIN_EMAIL / ADMIN_MOBILE. Log in with that email, then the OTP (shown on screen while DEV_SHOW_OTP=true, and printed in the server console).

## Go live checklist
1. `NODE_ENV=production`, a long random `JWT_SECRET`, `DEV_SHOW_OTP=false`, `MOCK_PAYMENTS=false`.
2. Put it behind HTTPS (Caddy or nginx reverse proxy to port 3000). Cookies are `secure` in production.
3. **OTP delivery**: edit `sendOtp()` in `lib.js` and call your SMS/email provider. Until you do, OTPs only print in the console.
4. **Razorpay**: put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` in `.env`. In the Razorpay dashboard add a webhook to `https://YOUR-DOMAIN/api/webhooks/razorpay` for `payment.captured`, `payment.failed`, `order.paid`; set the same secret as `RAZORPAY_WEBHOOK_SECRET`. Test in test mode first.
5. Daily backup: `0 2 * * * cd /path/ykr-world && npm run backup` (keeps the last 14; also copy `backups/` and `storage/` off the server).
6. Confirm GST/invoice rules with your accountant; the tax field is a plain amount you enter.

## Roles
student, business_client, employer, job_seeker, digital_client, admin, manager, hr, accounts, faculty, employee. Create users in the dashboard (HR/Admin → Create user). One person can hold several roles.

## What is built / not built
Built: OTP login, role guards and ownership checks, all 5 customer dashboards, admin forms, attendance with correction history, consultancy release flow, consented recruitment pipeline, deliverable approvals, invoices/partial payments/receipts, Razorpay order + signature verify + idempotent webhook, private file storage, support tickets, notifications, audit log, staff attendance/leave/payroll with maker-checker, backups.
Not built (planned for the next phase): PDF report/certificate/receipt generation, SMS/email/WhatsApp providers, refunds screen, live chat, biometric attendance, editing/deleting records from the UI (create/update flows exist; add edit screens as needed), multi-language UI.

## Known limits
- Admin screens are form-based (enter IDs). A searchable picker UI is a good next improvement.
- Files are served only after a permission check; files are not virus-scanned. Add ClamAV if you accept uploads from the public.
- SQLite suits one server and moderate traffic. If you outgrow it, the schema ports to PostgreSQL with small changes.
