# MILJOR — GOOGLE AUTHENTICATION & TRANSACTIONAL EMAIL SETUP GUIDE
**Authoritative Operational Setup & Production Deployment Manual**  
*Document Version: 1.0 (Part 4E.11)*  
*Target Environments: Local Development, Staging, and Production*

---

## 1. Google Cloud Console Setup (OpenID Connect / OAuth 2.0)

MilJor uses **Google Identity Services (GSI)** with server-side OpenID Connect (OIDC) ID token verification via the official `google-auth-library`.

### 1.1 Project Creation & OAuth Consent Screen
1. Navigate to the **[Google Cloud Console](https://console.cloud.google.com/)**.
2. Create a new Google Cloud Project or select an existing one (e.g., `miljor-marketplace`).
3. In the left navigation bar, go to **APIs & Services** > **OAuth consent screen**.
4. Choose User Type:
   - **External** (standard for B2B marketplaces allowing any commercial Google account).
5. Fill in the App Information:
   - **App name:** `MilJor B2B Food Procurement`
   - **User support email:** Choose your administrator/support email.
   - **App logo:** (Optional in development, recommended for production verification).
   - **Developer contact information:** Your technical lead email.
6. Scopes:
   - Click **Add or Remove Scopes**.
   - Select the 3 standard OpenID Connect non-sensitive scopes:
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `openid`
7. Test Users:
   - While the app publishing status is **Testing**, add all test Gmail addresses under **Test users**.

### 1.2 Create OAuth 2.0 Web Client Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**.
3. Select Application type: **Web application**.
4. Set Name: `MilJor Web Client`.
5. **Authorized JavaScript origins:**
   Add all URLs where the frontend Google Sign-In button or One Tap will be rendered:
   - `http://localhost:5173` (Vite dev server)
   - `http://localhost:3000` (Local production preview)
   - `http://localhost:5000` (Direct backend API server)
   - `https://app.miljor.com` (Production web app)
   - `https://api.miljor.com` (Production API server)
6. **Authorized redirect URIs** (required if using redirect/code flow or standard popup callbacks):
   - `http://localhost:5173/auth/google/callback`
   - `http://localhost:5000/api/v1/auth/google/callback`
   - `https://app.miljor.com/auth/google/callback`
7. Click **CREATE**.
8. Copy the generated **Client ID** (e.g. `123456789-abcdef.apps.googleusercontent.com`).
9. Copy the **Client Secret** if your architecture uses server authorization code exchange.

### 1.3 Backend Environment Configuration
Add the client credentials to `backend/.env`:
```env
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID="YOUR_COPIED_CLIENT_ID.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="YOUR_COPIED_CLIENT_SECRET"
```

> [!CAUTION]
> **Strict Secret Boundary:**
> Never expose `GOOGLE_CLIENT_SECRET` in frontend files or Vite environment variables prefixed with `VITE_`. The frontend only needs `GOOGLE_CLIENT_ID`.

---

## 2. Transactional Email & Outbox Delivery Setup

MilJor routes all transactional emails (registration OTP, password reset OTP, security notifications) through a durable database outbox (`transactional_email_outbox`) and dispatches them using `nodemailer`.

### 2.1 Option A: Gmail SMTP with Google App Password (Fastest for Dev/Pilot)
Legitimate Gmail accounts require an **App Password** for SMTP authentication (direct account passwords will be rejected by Google security).

1. Log into the Google Account designating your sending address (e.g. `notifications@miljor.com` or personal test Gmail).
2. Go to **[Google Account Security](https://myaccount.google.com/security)**.
3. Ensure **2-Step Verification** is turned **ON**.
4. In the search bar at the top of Google Account, type **"App passwords"** and click on it.
5. Create a new App Password:
   - App name: `MilJor Backend Engine`
   - Click **Create**.
6. Google displays a 16-character password (e.g. `abcd efgh ijkl mnop`). Copy it without spaces.
7. Configure `backend/.env`:
   ```env
   TRANSACTIONAL_EMAIL_MODE=smtp
   EMAIL_FROM="MilJor B2B Procurement" <your_email@gmail.com>
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=abcdefghijklmnop
   ```

### 2.2 Option B: Enterprise Transactional Mail Relay (Recommended for Production)
For high-volume deliverability, dedicated domain reputation, and avoiding Gmail consumer sending limits (500/day):

- **SendGrid:**
  `SMTP_HOST=smtp.sendgrid.net`, `SMTP_PORT=587`, `SMTP_USER=apikey`, `SMTP_PASS=<SendGrid_API_Key>`
- **AWS SES:**
  `SMTP_HOST=email-smtp.us-east-1.amazonaws.com`, `SMTP_PORT=587`, `SMTP_USER=<SES_SMTP_User>`, `SMTP_PASS=<SES_SMTP_Pass>`
- **Mailtrap (Staging Sandbox):**
  `SMTP_HOST=sandbox.smtp.mailtrap.io`, `SMTP_PORT=2525`, `SMTP_USER=<Mailtrap_User>`, `SMTP_PASS=<Mailtrap_Pass>`

---

## 3. Production Deliverability: SPF, DKIM & DMARC DNS Records

To guarantee that MilJor transactional emails do not land in Spam or Quarantine inboxes:

### 3.1 SPF (Sender Policy Framework)
Add or update the TXT record at your apex domain (`miljor.com`):
```
Type:  TXT
Host:  @
Value: v=spf1 include:_spf.google.com ~all
```
*(If using SendGrid/SES, include their respective SPF include strings: `include:sendgrid.net`).*

### 3.2 DKIM (DomainKeys Identified Mail)
- For Google Workspace: In the **Google Workspace Admin Console**, go to **Apps** > **Google Workspace** > **Gmail** > **Authenticate email**. Generate a 2048-bit DKIM key and publish the TXT record at `google._domainkey.miljor.com`.
- Start authentication once DNS propagates.

### 3.3 DMARC (Domain-based Message Authentication)
Add the TXT record at `_dmarc.miljor.com`:
```
Type:  TXT
Host:  _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@miljor.com; pct=100; adkim=r; aspf=r
```

---

## 4. Local Development & Testing Modes

### 4.1 Mock Email Mode (Zero Third-Party Dependency)
When running automated tests or developing without internet access, set:
```env
TRANSACTIONAL_EMAIL_MODE=mock
```
In mock mode:
- Transporter logs sent messages to an in-memory buffer (`emailService.mockSentEmails`).
- Durable database outbox records are populated with status `PROVIDER_ACCEPTED`.
- Zero external network connections are made.

### 4.2 Verifying Live Gmail Inbox Delivery (Safe Protocol)
When credentials are added and you want to verify actual inbox delivery:
1. Ensure `TRANSACTIONAL_EMAIL_MODE=smtp` and real credentials are in `backend/.env`.
2. Start the local server: `npm start` (or `node server.js`).
3. Make an authorized request to `/api/v1/auth/request-password-reset` with your personal test email address:
   ```bash
   curl -X POST http://localhost:5000/api/v1/auth/request-password-reset \
     -H "Content-Type: application/json" \
     -d '{"email":"your_test_email@gmail.com"}'
   ```
4. Check your Gmail inbox for subject `"Reset Your MilJor Account Password"`.
5. Observe the 6-digit OTP code and inspect headers to verify SPF and DKIM pass.

---

## 5. Security & Operation Checklist

- [ ] `JWT_SECRET` is at least 32 cryptographically random characters.
- [ ] `OTP_HMAC_SECRET` is configured with a dedicated 32+ character secret.
- [ ] `GOOGLE_AUTH_ENABLED` is set to `true` when live testing is intended.
- [ ] `GOOGLE_CLIENT_ID` matches the web client ID in Google Cloud Console.
- [ ] `SMTP_USER` and `SMTP_PASS` use a secure 16-character App Password (not personal account password).
- [ ] `ALLOW_EXTERNAL_MONEY_MOVEMENT` remains `false`.
