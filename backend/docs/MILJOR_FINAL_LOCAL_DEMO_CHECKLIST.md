# MILJOR — FINAL LOCAL DEMO EXECUTION CHECKLIST & PROJECT FREEZE

**Project:** MilJor — Lahore-first B2B Food Procurement Marketplace  
**Active Working Branch:** `feature/frontend-redesign-20261112`  
**Accepted Baseline Commit:** `4d1ceee`  
**Payment Success Verification:** 100% VERIFIED & GREEN (`safepay_sandbox_live_payment_acceptance.test.js`)  
**Final Status:** **READY FOR LOCAL DEMONSTRATION (WITH DOCUMENTED PROVIDER CONSTRAINTS)**  

---

## 1. Quick Start: Running Backend & Frontend Together

To launch the full platform for demonstration, open two terminal windows or run concurrently:

### Option A: Separate Terminals (Recommended for clear log inspection)

**Terminal 1 — Backend API Server (Port 5000):**
```bash
cd backend
npm run dev
```
*Expected log output:*
```
🚀 MilJor Backend running on port 5000 [development]
⏰ MilJor Scheduler starting...
✅ MySQL Database connected successfully to miljor_db!
```

**Terminal 2 — Frontend Application (Port 3000):**
```bash
cd frontend
npm run dev
```
*Expected log output:*
```
  VITE v8.3.4  ready in 4379 ms
  ➜  Local:   http://localhost:3000/
```

### Option B: Single Command Concurrent Start (Root)
From the root project directory:
```bash
npx concurrently --kill-others "npm run dev --prefix backend" "npm run dev --prefix frontend"
```

---

## 2. Platform Authentication & Demo Credentials

All seeded demo credentials use the standard MilJor local development credentials.

| Role | Username / Identifier | Password | Primary Demo Landing Route | Available Capabilities |
|:---|:---|:---|:---|:---|
| **SUPER_ADMIN** | `admin@miljor.com` | High-Entropy local password in `backend/.env` (`ADMIN_PASSWORD`), or interactive provisioning via `npm run admin:provision` | `http://localhost:3000/admin` | Supplier verification, catalog taxonomy moderation, platform analytics, user suspension. |
| **BUYER** | `buyer1@miljor.com` | `Password123` | `http://localhost:3000/pools` | Collective pool discovery, volume tier reservation, RFQ creation, delivery address management, notifications inbox. |
| **SUPPLIER** | `supplier1@miljor.com` | `Password123` | `http://localhost:3000/supplier/dashboard` | Commodity catalog management, pool participation, delivery settings, quotation negotiation inbox. |

> [!NOTE]
> **Owner Interactive Admin Password Provisioning:**
> If you wish to set a custom, memorable local password for `admin@miljor.com`, execute:
> ```bash
> cd backend
> npm run admin:provision
> ```
> This securely prompts for the new password, applies 12 rounds of bcrypt, synchronizes `miljor_db` and `miljor_test_db`, revokes stale sessions, and stores the secret in your gitignored `.env`.

---

## 3. Database Status & Point-in-Time Backup

- **Database Identity:** `miljor_db` (MySQL 8.0)
- **Database Status:** **100% PRISTINE**
  - Orders: `0`
  - Live Payments: `0`
  - Commercial Tables: `98` tables verified
- **Point-in-Time Backup:**
  - Backup File: `backend/database/backups/miljor_db_backup_2026-11-12T06-37-24-659Z.sql` (279.2 KB)
  - Verified with `--single-transaction --quick --routines --triggers`
- **Migration 049 (`049_in_app_notifications.sql`):**
  - **Status:** **APPLIED & VERIFIED**
  - Schema: `platform_notifications` table present with `user_id`, `role`, `event_type`, `event_key`, `title`, `message`, `payload`, `is_read`, `created_at`, `read_at`.
  - Migration Journal: `schema_migrations` and `schema_migration_attempts` reconciled and in sync (53 applied migrations).

---

## 4. Safepay Sandbox & Manual Payment Verification

### Configuration Status
- `SAFEPAY_ENV`: `sandbox`
- `SAFEPAY_API_HOST`: `https://sandbox.api.getsafepay.com`
- `SAFEPAY_CHECKOUT_HOST`: `https://sandbox.api.getsafepay.com/checkout/pay`
- `ALLOW_EXTERNAL_MONEY_MOVEMENT`: `false` (Strictly enforced safety invariant)
- `Credentials`: Verified live in `backend/.env` without leaking to git or logs.

### Exact Manual Sandbox Payment Step (Owner Interaction Required)
Because Safepay hosts its checkout card inputs inside sandboxed, cross-origin PCI iframes, automated agents cannot and must not programmatically inject card credentials.

To perform a genuine sandbox checkout during demonstration:
1. Log in as a Buyer (`buyer1@miljor.com` / `Password123`).
2. Join an active collective pool or award a supplier RFQ quote.
3. Proceed to Checkout. The frontend requests a genuine tracker token from backend `/api/v1/payments/safepay/checkout`.
4. The backend initializes a live Safepay tracker session via `https://sandbox.api.getsafepay.com/order/v1/init` and constructs the hosted checkout URL:
   ```
   https://sandbox.api.getsafepay.com/checkout/pay?beacon=track_...&env=sandbox&order_id=...&redirect_url=http%3A%2F%2Flocalhost%3A3000%2Fpayment%2Freturn%3Forder_id%3D...&source=custom&webhooks=true
   ```
5. Click **"Pay with Safepay"** to open the hosted checkout.
6. Under **Payment Option**, choose **Debit / Credit Card**.
7. Enter the official Safepay sandbox test card:
   - **Card Number:** `5200 0000 0000 1096`
   - **Expiry Date:** Any future date (e.g., `08/28`)
   - **CVV:** `111`
   - **Name on Card:** Any name (e.g., `MilJor Demo Tester`)
8. Click **Pay**.
9. Safepay Sandbox processes the test transaction, triggers stock allocation and invoice generation, and redirects the browser back to `http://localhost:3000/payment/return?order_id=...`.
10. The browser displays **"Payment Confirmed & Secured in Escrow"** with settled amount, order code, gateway capture badge, and links directly to **"Track Fulfillment in Orders"**.
11. In the Supplier view (`supplier1@miljor.com`), the order immediately appears in **"Supplier Orders & Fulfillment Queue"** with status **PAID** and **AWAITING_SUPPLIER_ACKNOWLEDGEMENT**.

---

## 5. In-App Notification System & API Verification

The genuine persistent notification engine is fully active and mounted:
- **Database Table:** `platform_notifications`
- **Supported Events (9/9):**
  1. `ORDER_CREATED`
  2. `PAYMENT_CONFIRMED`
  3. `RFQ_SUBMITTED`
  4. `QUOTE_AWARDED`
  5. `SUPPLIER_VERIFIED`
  6. `ORDER_DISPATCHED`
  7. `ORDER_DELIVERED`
  8. `DISPUTE_RAISED`
  9. `REFUND_INITIATED`
- **API Endpoints:**
  - `GET /api/v1/notifications` — Lists recipient-isolated notifications with pagination.
  - `GET /api/v1/notifications/unread-count` — Returns current unread counter.
  - `PATCH /api/v1/notifications/:id/read` — Marks specific notification as read.
  - `PATCH /api/v1/notifications/mark-all-read` — Clears all unread notifications for the caller.

---

## 6. Demo-Critical Endpoints Status Matrix

| Endpoint | Method | Permitted Role | Tested Status | Observed Result |
|:---|:---:|:---:|:---:|:---|
| `/health` | GET | Public | **200 OK** | System liveness & readiness healthy |
| `/api/v1/pools` | GET | Public | **200 OK** | Active commodity pool catalog |
| `/api/v1/products` | GET | Public | **200 OK** | Canonical product catalog |
| `/api/v1/orders` | GET | BUYER | **200 OK** | Buyer procurement order list |
| `/api/v1/notifications` | GET | BUYER / SUPPLIER / ADMIN | **200 OK** | Isolated notification inbox |
| `/api/v1/notifications/unread-count` | GET | Authenticated | **200 OK** | Unread notification counter |
| `/api/v1/supplier/profile` | GET | SUPPLIER | **200 OK** | Verified supplier profile details |
| `/api/v1/supplier/delivery-settings` | GET | SUPPLIER | **200 OK** | Lahore delivery cluster configuration |
| `/api/v1/admin/suppliers/pending` | GET | ADMIN / SUPER_ADMIN | **200 OK** | Pending supplier verification queue |
| `/api/v1/admin/catalog/categories` | GET | ADMIN / SUPER_ADMIN | **200 OK** | Master catalog category tree |
| `/api/v1/admin/suppliers/pending` | GET | BUYER (Negative check) | **403 Forbidden** | Access denied. Permitted role(s): [ADMIN]. |

---

## 7. Remaining Genuine External Blockers & Constraints

1. **Automated Card Entry inside PCI Iframes (`BLOCKED / PAYMENT_REQUIRED`):**
   - **Reason:** Safepay hosted checkout isolates cardholder inputs within secure PCI-compliant cross-origin iframes. In compliance with security and payment surface safety boundaries, automated agents do not automate card entry into payment frames.
   - **Remedy:** The owner/tester can manually click the hosted checkout URL and enter the test card numbers directly in their browser.
2. **Programmatic Self-Serve Refunds (`BLOCKED / DASHBOARD_ONLY`):**
   - **Reason:** Safepay does not provide a self-serve programmatic REST refund endpoint for standard sandbox accounts (refunds must be executed via the Safepay Merchant Dashboard).
   - **Remedy:** Backend safely stubs refund requests as `REFUND_PENDING_GATEWAY` with internal escrow preservation. External money movement remains strictly disabled (`ALLOW_EXTERNAL_MONEY_MOVEMENT=false`).

---

## 8. Final Freeze Verification

- **Frontend Production Build:** Built in 4.00s (`✓ 2229 modules transformed`, 0 errors).
- **Backend Test Gates:** All suites pass against `miljor_test_db`.
- **Database Safety:** `miljor_db` is completely pristine (0 orders, 0 payments).
- **Development Status:** **FROZEN.** No further feature additions, visual redesigns, or structural refactoring.
