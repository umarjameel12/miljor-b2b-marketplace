# MilJor Authentication Frontend & Backend Compatibility Map

**Document Version:** 1.0.0  
**Date:** 2026-11-12  
**Target Repository:** `umarjameel12/miljor-b2b-marketplace`  
**Feature Branch:** `feature/miljor-auth-ui-premium`  

---

## 1. Real Backend Authentication Endpoints

The frontend integrates directly with the verified Express.js authentication routes located at `backend/src/routes/v1/authRoutes.js` and handled by `backend/src/controllers/authController.js`:

| Method | Endpoint | Supported Payload / Query | Response / Token Semantics | Real Backend Validation & Error Codes |
|:---|:---|:---|:---|:---|
| `POST` | `/api/v1/auth/login` | `{ identifier, password, rememberMe }` | `{ success: true, data: { token, user } }` + `miljor_refresh` HttpOnly cookie | `INVALID_CREDENTIALS` (401), `VALIDATION_ERROR` (400), `ACCOUNT_SUSPENDED` (403) |
| `POST` | `/api/v1/auth/register` | `{ full_name, business_name, email, phone, password, role: 'BUYER' \| 'SUPPLIER', city: 'Lahore', base_cluster_id, cluster_id, society_area, full_address }` | `{ success: true, message: '...', data: { token, user } }` | `INVALID_REGISTRATION_ROLE` (422), `OUTSIDE_LAHORE_DISTRICT` (422), `BASE_CLUSTER_REQUIRED` (422), `USER_EXISTS` (409), `VALIDATION_ERROR` (400) |
| `GET` | `/api/v1/auth/me` | Bearer JWT Header | `{ success: true, data: { user } }` | `UNAUTHORIZED` (401), `TOKEN_EXPIRED` (401) |
| `POST` | `/api/v1/auth/logout` | Bearer JWT Header + Cookie | `{ success: true, message: 'Logged out successfully' }` | Revokes DB session and clears HttpOnly refresh cookie |
| `POST` | `/api/v1/auth/request-password-reset` | `{ email }` | `{ success: true, message: 'If an account exists...' }` | Returns generic 200 (prevents user enumeration), `RATE_LIMITED` (429 if <60s) |
| `POST` | `/api/v1/auth/reset-password` | `{ email, otp, new_password }` | `{ success: true, message: 'Password reset successfully' }` | `OTP_EXPIRED` (410), `MAX_ATTEMPTS_EXCEEDED` (429), `INVALID_OTP` (400), `ACCOUNT_SUSPENDED` (403) |
| `GET` | `/api/v1/catalog/clusters` | None (Public) | `{ success: true, data: { clusters: [...] } }` | Retrieves Lahore clusters with active delivery support |

---

## 2. Form Field & Entity Mappings

### 2.1 Login Form (`/login`)
* **Login Identifier (`identifier`):** Accepts either Email Address (e.g., `buyer@example.com`) or Phone Number (e.g., `03001234567`). Sanitized via `.trim()`.
* **Password (`password`):** Required string. Checked against bcrypt hash.
* **Remember Me (`rememberMe`):** Boolean. If true, backend generates a 30-day persistent session; otherwise, an 8-hour browser session.

### 2.2 Buyer Registration Form (`/register?role=BUYER`)
* **Full Name (`full_name`):** Contact person's name. Required.
* **Business Name (`business_name`):** Registered business or restaurant title. Required for B2B procurement.
* **Email (`email`):** Valid email format. Required (or phone).
* **Phone (`phone`):** Pakistani mobile format (`03XX-XXXXXXX` or `+923XXXXXXXXX`). Sanitized by stripping spaces/dashes.
* **Password (`password`):** Minimum 8 characters, must contain at least 1 letter and 1 number (`/^(?=.*[A-Za-z])(?=.*\d).{8,}$/`).
* **Role (`role`):** Strictly `'BUYER'`.
* **City (`city`):** Strictly `'Lahore'` (District Lahore invariant enforced with 422 `OUTSIDE_LAHORE_DISTRICT`).
* **Base Cluster (`base_cluster_id`):** Mandatory for buyers (422 `BASE_CLUSTER_REQUIRED`). Populated from live `/api/v1/catalog/clusters` (e.g., Akbari Mandi, Gulberg, Badami Bagh).
* **Delivery Address (Voluntary):** `society_area` and `full_address` (if provided, both are required; otherwise defaults to `NOT_REQUIRED`).

### 2.3 Supplier Registration Form (`/register?role=SUPPLIER`)
* **Full Name (`full_name`):** Supplier representative name. Required.
* **Business Name (`business_name`):** Mill, wholesale enterprise, or supplier name. Required.
* **Email (`email`):** Valid business email. Required.
* **Phone (`phone`):** Valid Pakistani business phone. Required.
* **Password (`password`):** Minimum 8 characters with letters & numbers.
* **Role (`role`):** Strictly `'SUPPLIER'`.
* **City (`city`):** Strictly `'Lahore'`.
* **Supplier Specifics:** Automatically creates default supplier profile (`verification_level = 'LEVEL_1_CONTACT'`, `verification_status = 'NOT_SUBMITTED'`, `subscription_plan = 'STARTER'`) and initial draft delivery configuration.

---

## 3. Unsupported vs Supported Features

* **Supported & Implemented:**
  * Password show/hide visibility toggles with accessible ARIA attributes.
  * Real-time client-side password strength validation matching backend policy (8+ chars, letters + numbers).
  * Backend error mapping (`INVALID_CREDENTIALS`, `USER_EXISTS`, `OUTSIDE_LAHORE_DISTRICT`, `BASE_CLUSTER_REQUIRED`).
  * Forgot-password OTP request and OTP reset password step with durable cooldown timers.
  * Full Light/Dark theme switching with system detection and persistence.
  * Two-column desktop SaaS layout and single-column mobile layout.
* **Strictly Unsupported (Omitted to prevent deception):**
  * Fake social logins (other than standard Google OAuth hook if configured).
  * Direct self-approval of supplier accounts (suppliers clearly informed of `PENDING_REVIEW` onboarding state).
  * Household/consumer signup options (strictly B2B procurement).
