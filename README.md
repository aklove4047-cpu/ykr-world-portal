# YKR World – Website, Client Portal & Admin Panel

> **"Transforming businesses, empowering people."**  
> One unified mobile-first website, 4 verticals, 11 login roles, instant SMS OTP authentication, interactive Admin CRM, and zero-cost self-hostable stack (Cloudflare Workers + D1 or Node.js Express + SQLite).

---

## 🌟 Key Features

1. **Four Verticals**:
   - **Individual Training**: Spoken English, Public Speaking, Soft Skills & Corporate Etiquette, Career & Interviews, and the Flagship **Political Leadership Development Programme**.
   - **Business Training & Consultancy**: The 4-step framework (Diagnose → Plan → Deliver → Review), SPANCO sales pipeline (Suspect, Prospect, Approach, Negotiate, Close, Order), and corporate hackathons.
   - **HR Recruitment & Placement**: YKR Placement Cell with precision sourcing, 15-day pre-joining bootcamp, public candidate pool with skill filters, and hiring partner showcases.
   - **Digital Marketing & IT**: High-converting websites, corporate portals, SEO, social media brand growth, short-form video reels, and instant enquiry lead capture.

2. **Unified Login for 11 Roles**:
   - **Customers**: `Student`, `Business client`, `Employer / recruiter`, `Job seeker`, `Digital / IT client`
   - **Staff & Management**: `Admin`, `Manager`, `Faculty`, `Employee`, `HR`, `Accounts`

3. **High-Speed SMS OTP**:
   - Mobile-number based OTP login (no passwords required).
   - Built-in multi-provider support:
     - **Fast2SMS** (Instant Indian SMS OTP route)
     - **2Factor.in** (High-priority Indian transactional OTP)
     - **Custom SMS Gateway** (Any third-party HTTP GET/POST API)
     - **Demo Mode Fallback**: Code `123456` for immediate testing.

4. **Interactive Admin Panel & CRM**:
   - **Leads CRM**: Track all website enquiries in real time with 1-click **WhatsApp** chat and 1-click **Phone Call** actions.
   - **Candidate Approvals**: View candidate pool, 1-click toggle public approval status, and add new candidates.
   - **User Directory**: View registered members across all 11 roles.
   - **SMS Gateway Tester**: Send test OTP to any number right from the dashboard.

---

## 🚀 Fast SMS OTP Setup (How to get OTP API)

To get real SMS delivered instantly to Indian mobile numbers:

### Option 1: Fast2SMS (Recommended - Fastest & Easiest)
1. Go to [https://www.fast2sms.com](https://www.fast2sms.com) and create an account.
2. Complete quick verification (you get free bonus wallet credits).
3. Go to **Dev API** in the sidebar.
4. Copy your **API Authorization Key**.
5. Paste it in `.env` (or in Cloudflare variables):
   ```env
   FAST2SMS_API_KEY=your_authorization_key_here
   ```
   *Fast2SMS uses the Quick OTP route which requires NO complicated DLT registration for OTP testing.*

### Option 2: 2Factor.in
1. Go to [https://2factor.in](https://2factor.in) and register.
2. Copy your **API Key** from the dashboard.
3. Paste it in `.env` (or Cloudflare variables):
   ```env
   TWOFACTOR_API_KEY=your_2factor_key_here
   ```

### Option 3: Custom SMS Gateway URL
If you have any other SMS gateway (e.g. MSG91, Textlocal, Kaleyra):
```env
SMS_GATEWAY_URL=https://api.yourprovider.com/send?apikey=KEY&number={mobile}&message=Your+YKR+World+OTP+is+{otp}
```

---

## 💻 Option A: Self-Host / Run Locally (Node.js + Express)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` if you want to add your `FAST2SMS_API_KEY` or custom `SECRET`.

3. **Start the server**:
   ```bash
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Option B: Deploy to Cloudflare Workers (Free Global Edge)

1. **Cloudflare D1 Database**:
   Already created and configured in `wrangler.toml`:
   - Database name: `ykr-db`
   - Database ID: `f2360ca7-0b1a-4bd0-9be2-80956886ad71`

2. **Deploy with Wrangler**:
   ```bash
   npx wrangler deploy
   ```

3. **Set Secrets (Production)**:
   ```bash
   npx wrangler secret put SECRET
   ```

---

## 📦 Push to GitHub

```bash
git add .
git commit -m "feat: complete YKR World portal with full admin panel and fast SMS OTP"
git push origin main
```
