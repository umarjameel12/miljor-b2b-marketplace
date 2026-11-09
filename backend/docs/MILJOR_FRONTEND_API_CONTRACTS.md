# MILJOR B2B MARKETPLACE: FRONTEND API CONTRACTS & INTEGRATION GUIDE
**MilJor Platform API Version 1.0 (Development Baseline)**  
*Authoritative Reference for Frontend Engineers (React / React Native / Web)*

---

## 1. Architectural Foundations & Integration Standards

### 1.1 Base URL & Environment Configuration
- **Development / Vite Proxy:** `/api/v1` (proxied to `http://localhost:5000`)
- **Direct Backend URL:** `http://localhost:5000/api/v1`
- **Content-Type:** `application/json` (strictly required on all POST / PUT requests)

### 1.2 Authentication & Token Transport
- **Mechanism:** JSON Web Token (JWT) using HMAC-SHA256 (`HS256`).
- **Header:** `Authorization: Bearer <jwt_token>`
- **Token Storage:** Store in `localStorage` under key `miljor_token`.
- **Session Expiration:** On HTTP `401 Unauthorized`, frontend clients MUST clear `miljor_token` and dispatch event `miljor:auth-expired` to trigger redirect to `/login`.

### 1.3 State-Guiding Pattern: `allowed_actions`
To decouple frontend conditional logic from complex backend state machine rules, MilJor returns an authoritative `allowed_actions: string[]` array in resource payloads (`pools`, `reservations`, `orders`).
Frontend components SHOULD inspect `allowed_actions.includes('ACTION_NAME')` to enable, disable, or render action buttons.

### 1.4 Mutation Idempotency (`X-Idempotency-Key`)
Every mutating POST/PUT operation that alters commercial state or financial obligations **REQUIRES** an `X-Idempotency-Key` UUID header.
- **Header:** `X-Idempotency-Key: <v4-uuid>`
- Retrying an operation with the same idempotency key safely returns the identical cached response without duplicate side effects.

### 1.5 Standard Response Envelopes

#### Success Envelope
```json
{
  "success": true,
  "count": 10,
  "data": { ... }
}
```

#### Error Envelope
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human readable descriptive message"
  }
}
```

---

## 2. Authentication & Identity Endpoints

### 2.1 Register (`POST /api/v1/auth/register`)
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "phone": "03001234567",
    "password": "Password123",
    "full_name": "Muhammad Ali",
    "email": "ali@gourmet.pk",
    "role": "BUYER",
    "business_name": "Lahore Gourmet Catering",
    "business_type": "RESTAURANT",
    "area": "Gulberg III",
    "city": "Lahore"
  }
  ```
- **Success (201 Created):**
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "data": {
      "token": "eyJhbGciOiJIUzI1Ni...",
      "user": {
        "id": 14,
        "phone": "03001234567",
        "email": "ali@gourmet.pk",
        "full_name": "Muhammad Ali",
        "business_name": "Lahore Gourmet Catering",
        "role": "BUYER",
        "verification_status": "UNVERIFIED"
      }
    }
  }
  ```

### 2.2 Login (`POST /api/v1/auth/login`)
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "identifier": "03001000005",
    "password": "Password123"
  }
  ```
  *(Note: `identifier` accepts either registered phone number or email address).*
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "token": "eyJhbGciOiJIUzI1Ni...",
      "user": {
        "id": 5,
        "phone": "03001000005",
        "email": "buyer1@miljor.com",
        "full_name": "Asif Khan",
        "business_name": "Khan Foods",
        "role": "BUYER",
        "verification_status": "VERIFIED"
      }
    }
  }
  ```

### 2.3 Current Session Profile (`GET /api/v1/auth/me`)
- **Auth:** Bearer Token
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "user": {
        "id": 5,
        "phone": "03001000005",
        "email": "buyer1@miljor.com",
        "full_name": "Asif Khan",
        "business_name": "Khan Foods",
        "role": "BUYER",
        "verification_status": "VERIFIED",
        "is_verified": 1,
        "email_verified": true,
        "google_linked": false
      },
      "supplier_profile": null
    }
  }
  ```

### 2.4 Google Sign-In & Sign-Up (`POST /api/v1/auth/google`)
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI...",
    "credential": "eyJhbGciOiJSUzI1Ni...", // Optional alias for id_token
    "g_csrf_token": "csrf_cookie_value" // Optional double-submit token when using Google HTML One-Tap POST
  }
  ```
- **CSRF Double-Submit Verification:**
  When `g_csrf_token` is included in the body, the backend verifies that it matches the `g_csrf_token` cookie or `x-g-csrf-token` header using constant-time evaluation. Mismatch returns HTTP 403 `CSRF_TOKEN_MISMATCH`.
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Google authentication successful",
    "data": {
      "token": "eyJhbGciOiJIUzI1Ni...",
      "user": {
        "id": 18,
        "phone": null,
        "email": "buyer@example.com",
        "full_name": "Verified User",
        "role": "BUYER",
        "verification_status": "VERIFIED",
        "email_verified": true,
        "google_linked": true
      },
      "is_new_user": false
    }
  }
  ```
- **Error (403 Forbidden - Account Suspended):**
  ```json
  {
    "success": false,
    "error": {
      "code": "ACCOUNT_SUSPENDED",
      "message": "Your account has been suspended or blocked. Please contact support."
    }
  }
  ```
- **Error (409 Conflict - Account Linking Required):**
  Triggered when a local password account exists with the same email address, but is not yet linked. Prevents account takeover attacks.
  ```json
  {
    "success": false,
    "error": {
      "code": "ACCOUNT_LINKING_REQUIRED",
      "message": "An account with this email already exists. To connect your Google account, please log in with your password and link Google in Account Settings."
    }
  }
  ```

### 2.5 Google Account Linking (`POST /api/v1/auth/google/link`)
- **Auth:** Bearer Token (Authenticated user)
- **Request Body:**
  ```json
  {
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI..."
  }
  ```
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Google account linked successfully",
    "data": {
      "user": { ... }
    }
  }
  ```

### 2.6 Google Account Unlinking (`POST /api/v1/auth/google/unlink`)
- **Auth:** Bearer Token (Authenticated user)
- **Rules:** Cannot unlink Google account if the user has no password configured (prevents permanent account lockout).
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Google account unlinked successfully",
    "data": {
      "user": { ... }
    }
  }
  ```

### 2.7 Email Verification (`POST /api/v1/auth/verify-email`)
- **Auth:** Optional Bearer Token or provide `email` in body
- **Request Body:**
  ```json
  {
    "email": "buyer@example.com",
    "otp": "492018"
  }
  ```
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Email verified successfully",
    "data": {
      "email_verified": true
    }
  }
  ```

### 2.8 Resend Email Verification OTP (`POST /api/v1/auth/resend-otp`)
- **Auth:** Optional Bearer Token or provide `email` in body
- **Rate Limit:** 1 request per 60 seconds.
- **Request Body:**
  ```json
  {
    "email": "buyer@example.com"
  }
  ```
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Verification code sent to your email"
  }
  ```
- **Error (429 Too Many Requests):**
  ```json
  {
    "success": false,
    "error": {
      "code": "RATE_LIMITED",
      "message": "Please wait 60 seconds before requesting a new code"
    }
  }
  ```

### 2.9 Request Password Reset OTP (`POST /api/v1/auth/request-password-reset`)
- **Auth:** Public (Anti-enumeration: returns identical success message even if email is unmapped)
- **Request Body:**
  ```json
  {
    "email": "buyer@example.com"
  }
  ```
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "If an account exists with this email, a reset code has been sent"
  }
  ```

### 2.10 Reset Password with OTP (`POST /api/v1/auth/reset-password`)
- **Auth:** Public
- **Request Body:**
  ```json
  {
    "email": "buyer@example.com",
    "otp": "492018",
    "new_password": "NewSecurePassword123!"
  }
  ```
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Password reset successfully. Please log in with your new password."
  }
  ```
- **Account Method Distinctions & Lifecycle:**
  - **Password-Only Account:** User registered via phone/email + password (`google_linked: false`). Can link Google in settings via `POST /api/v1/auth/google/link`.
  - **Google-Only Account:** User onboarded via Google (`password_hash: null`, `google_linked: true`). Cannot unlink Google unless a password is set first (prevents permanent lockout). To establish a password, the Google-only user requests a password reset code to their verified email and submits `POST /api/v1/auth/reset-password`.
  - **Dual-Auth Account:** User has both a password and a linked Google account. Can log in via either method. Can unlink Google at will.
  - **Suspended Accounts:** Users with `verification_status = 'BLOCKED'` or `buyer_trust_status = 'SUSPENDED'` are strictly blocked from Google sign-in, account linking, and password reset (returns HTTP 403 `ACCOUNT_SUSPENDED`).
- **Error (409 Conflict - Code Already Consumed):**
  ```json
  {
    "success": false,
    "error": {
      "code": "OTP_ALREADY_CONSUMED",
      "message": "Verification code has already been consumed."
    }
  }
  ```

---

## 2.11 Frontend Google & Email Integration Blueprint (React)

### Google Sign-In Component (`@react-oauth/google`)
```tsx
import { GoogleLogin } from '@react-oauth/google';

export function GoogleAuthButton({ onSuccess, onError }) {
  const handleSuccess = async (credentialResponse) => {
    try {
      const res = await fetch('/api/v1/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: credentialResponse.credential })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.code === 'ACCOUNT_LINKING_REQUIRED') {
          // Open password login prompt and inform user to link account in settings
          alert(data.error.message);
          return;
        }
        throw new Error(data.error?.message || 'Google authentication failed');
      }
      localStorage.setItem('miljor_token', data.data.token);
      onSuccess(data.data.user);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <GoogleLogin
      onSuccess={handleSuccess}
      onError={() => onError(new Error('Google login prompt failed'))}
      useOneTap={false}
      theme="outline"
      shape="rectangular"
      text="continue_with"
    />
  );
}
```

### Email OTP Verification Modal Pattern
```tsx
export function EmailOtpModal({ email, onVerified, onCancel }) {
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState(null);

  const handleVerify = async () => {
    setError(null);
    const res = await fetch('/api/v1/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error?.message || 'Invalid or expired code');
      return;
    }
    onVerified();
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError(null);
    const res = await fetch('/api/v1/auth/resend-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (res.ok) {
      setCooldown(60);
      const timer = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) clearInterval(timer);
          return prev - 1;
        });
      }, 1000);
    } else {
      const data = await res.json();
      setError(data.error?.message || 'Failed to resend code');
    }
  };

  return (
    <div className="otp-modal">
      <h3>Verify Your Email</h3>
      <p>Enter the 6-digit code sent to <b>{email}</b></p>
      <input
        type="text"
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\\D/g, ''))}
        placeholder="123456"
      />
      {error && <p className="error-text">{error}</p>}
      <button onClick={handleVerify} disabled={otp.length !== 6}>Verify</button>
      <button onClick={handleResend} disabled={cooldown > 0}>
        {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
      </button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}
```

---

## 3. Pooled Demand Discovery & Lifecycle

### 3.1 Public Pool Discovery (`GET /api/v1/pools`)
- **Auth:** Public
- **Query Parameters:**
  - `category` (optional string): Filter by product category (e.g., `GRAINS`).
  - `min_price` / `max_price` (optional numbers): Filter by unit price.
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "count": 3,
    "data": {
      "pools": [
        {
          "id": 1,
          "pool_code": "MJ-POOL-0001",
          "status": "ACTIVE",
          "product_title": "Super Basmati Rice 50kg",
          "category": "GRAINS",
          "pool_unit": "BAG",
          "target_qty": 500.0,
          "current_qty": 120.0,
          "remaining_qty": 380.0,
          "fill_percentage": 24.0,
          "current_price_per_unit": 165.0,
          "supplier_name": "Punjab Agro Supplies",
          "supplier_area": "Depalpur"
        }
      ]
    }
  }
  ```

### 3.2 Single Pool Snapshot (`GET /api/v1/pools/:id`)
- **Auth:** Public
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "pool": {
        "id": 1,
        "pool_code": "MJ-POOL-0001",
        "status": "ACTIVE",
        "target_qty": 500.0,
        "current_qty": 120.0,
        "supplier_min_qty": 100.0,
        "buyer_min_qty": 5.0,
        "max_capacity": 600.0,
        "estimated_unit_price": 165.0,
        "pricing_mode": "TIERED",
        "is_conditional_pricing": true,
        "can_join": true,
        "participation_status": "OPEN",
        "allowed_actions": ["RESERVE"],
        "specification": {
          "id": 1,
          "product_title": "Super Basmati Rice 50kg",
          "category": "GRAINS",
          "quality_grade": "GRADE_A",
          "packaging_type": "PP_WOVEN_BAG"
        },
        "supplier": {
          "id": 2,
          "business_name": "Punjab Agro Supplies",
          "verification_status": "VERIFIED"
        }
      }
    }
  }
  ```

### 3.3 Supplier Pools (`GET /api/v1/pools/supplier/my`)
- **Auth:** Bearer Token (SUPPLIER role required)
- **Success (200 OK):** Returns all pools owned by the authenticated supplier (including `DRAFT` and closed pools).

---

## 4. Buyer Reservations & Commitment Lifecycle

### 4.1 Join Pool (`POST /api/v1/reservations`)
- **Auth:** Bearer Token (BUYER role required)
- **Headers:** `X-Idempotency-Key: <uuid>`
- **Request Body:**
  ```json
  {
    "pool_id": 1,
    "quantity": 25.0
  }
  ```

### 4.2 My Reservations (`GET /api/v1/reservations/my`)
- **Auth:** Bearer Token (BUYER role required)
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "count": 1,
    "data": {
      "reservations": [
        {
          "id": 10,
          "reservation_code": "MJ-RES-0010",
          "pool_id": 1,
          "pool_code": "MJ-POOL-0001",
          "product_title": "Super Basmati Rice 50kg",
          "quantity": 25.0,
          "unit_price": 165.0,
          "total_price": 4125.0,
          "status": "RESERVED"
        }
      ]
    }
  }
  ```

### 4.3 Reservation Detail (`GET /api/v1/reservations/:id`)
- **Auth:** Bearer Token (Owning Buyer or Admin)
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "reservation": {
        "id": 10,
        "reservation_code": "MJ-RES-0010",
        "quantity": 25.0,
        "unit_price": 165.0,
        "total_price": 4125.0,
        "status": "RESERVED",
        "allowed_actions": ["MODIFY_RESERVATION", "CANCEL_RESERVATION"],
        "permissions": {
          "can_modify": true,
          "can_cancel": true,
          "blocked_reason": null
        }
      }
    }
  }
  ```

### 4.4 Convert Commitment to Order (`POST /api/v1/reservations/:id/order`)
- **Auth:** Bearer Token (BUYER role required)
- **Headers:** `X-Idempotency-Key: <uuid>`
- **Request Body:**
  ```json
  {
    "delivery_type": "DOORSTEP",
    "delivery_address": "Plot 45, Industrial Area, Kot Lakhpat, Lahore",
    "notes": "Deliver before 11:00 AM"
  }
  ```
- **Success (201 Created):** Creates order in `AWAITING_PAYMENT` / `UNPAID` status.

---

## 5. Orders, Invoicing & Checkout Lifecycle

### 5.1 List Orders (`GET /api/v1/orders` or `GET /api/v1/orders/my`)
- **Auth:** Bearer Token (BUYER sees own orders, SUPPLIER sees pool orders, ADMIN sees all)
- **Query Parameters:**
  - `page` (number, default: 1)
  - `limit` (number, default: 20)
  - `status` (string, optional: `AWAITING_PAYMENT`, `PAID`, `COMPLETED`, etc.)
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "count": 1,
    "data": {
      "orders": [
        {
          "id": 12,
          "order_code": "MJ-ORD-0012",
          "reservation_id": 10,
          "pool_id": 1,
          "product_title": "Super Basmati Rice 50kg",
          "purchasing_unit": "BAG",
          "buyer_id": 5,
          "supplier_id": 2,
          "total_qty": 20.0,
          "unit_price": 150.0,
          "subtotal_amount": 3000.0,
          "delivery_fee": 50.0,
          "buyer_platform_fee": 30.0,
          "total_amount": 3080.0,
          "currency": "PKR",
          "delivery_type": "DOORSTEP",
          "payment_status": "AWAITING_PAYMENT",
          "order_status": "AWAITING_PAYMENT",
          "fulfillment_status": "UNPAID",
          "allowed_actions": ["CHECKOUT"],
          "created_at": "2026-11-04T12:00:00.000Z"
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 20,
        "total_records": 1,
        "total_pages": 1
      }
    }
  }
  ```

### 5.2 Single Order Detail (`GET /api/v1/orders/:id`)
- **Auth:** Bearer Token (Owning Buyer, Assigned Supplier, or Admin)
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "order": {
        "id": 12,
        "order_code": "MJ-ORD-0012",
        "product_title": "Super Basmati Rice 50kg",
        "purchasing_unit": "BAG",
        "total_qty": 20.0,
        "unit_price": 150.0,
        "subtotal_amount": 3000.0,
        "delivery_fee": 50.0,
        "buyer_platform_fee": 30.0,
        "total_amount": 3080.0,
        "currency": "PKR",
        "payment_status": "AWAITING_PAYMENT",
        "order_status": "AWAITING_PAYMENT",
        "fulfillment_status": "UNPAID",
        "allowed_actions": ["CHECKOUT"],
        "financial_breakdown": {
          "total_qty": 20.0,
          "unit_price": 150.0,
          "subtotal_amount": 3000.0,
          "delivery_fee": 50.0,
          "buyer_platform_fee": 30.0,
          "tax_amount": 0.0,
          "tax_status": "EXEMPT_OR_NOT_APPLICABLE",
          "total_payable_amount": 3080.0,
          "currency": "PKR"
        }
      }
    }
  }
  ```

### 5.3 Initiate Safepay Sandbox Checkout (`POST /api/v1/orders/:id/checkout`)
- **Auth:** Bearer Token (BUYER role required)
- **Headers:** `X-Idempotency-Key: <uuid>`
- **Request Body:**
  ```json
  {
    "redirect_url": "http://localhost:5173/orders/12/payment-callback",
    "cancel_url": "http://localhost:5173/orders/12"
  }
  ```
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "message": "Checkout session initiated successfully",
    "data": {
      "order_id": 12,
      "tracker_token": "track_sbx_...",
      "checkout_url": "https://sandbox.api.getsafepay.com/checkout/pay?beacon=track_sbx_..."
    }
  }
  ```

### 5.4 Order Payment Status (`GET /api/v1/orders/:id/payment-status`)
- **Auth:** Bearer Token (Owning Buyer or Admin)
- **Success (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "order_id": 12,
      "order_status": "PAID",
      "payment_status": "PAID",
      "tracker_token": "track_sbx_...",
      "amount": 3080.0,
      "currency": "PKR"
    }
  }
  ```

---

## 6. Post-Payment Fulfillment & Delivery Tracking

### 6.1 Buyer Fulfillment Orders (`GET /api/v1/fulfillment/buyer/orders`)
- **Auth:** Bearer Token (BUYER role required)
- **Success (200 OK):** Lists all paid orders currently in the fulfillment pipeline with milestone timestamps.

### 6.2 Buyer Confirms Delivery Receipt (`POST /api/v1/fulfillment/buyer/orders/:id/confirm-receipt`)
- **Auth:** Bearer Token (BUYER role required)
- **Headers:** `X-Idempotency-Key: <uuid>`
- **Prerequisite:** Order must be in `SUPPLIER_DELIVERED` status.
- **Success (200 OK):** Transitions fulfillment status to `BUYER_CONFIRMED` / `COMPLETED`.

### 6.3 Supplier Fulfillment Queue (`GET /api/v1/fulfillment/supplier/orders`)
- **Auth:** Bearer Token (SUPPLIER role required)
- **Success (200 OK):** Lists paid orders assigned to supplier for preparation and delivery.

### 6.4 Supplier Fulfillment Milestone Transition (`POST /api/v1/fulfillment/supplier/orders/:id/transition`)
- **Auth:** Bearer Token (SUPPLIER role required)
- **Headers:** `X-Idempotency-Key: <uuid>`
- **Request Body:**
  ```json
  {
    "target_status": "DISPATCHED",
    "delivery_method": "SUPPLIER_FLEET",
    "delivery_reference": "TRUCK-LHR-9821",
    "notes": "Driver contact: 0300-9998877"
  }
  ```
- **Allowed Transitions:**
  - `AWAITING_SUPPLIER_ACKNOWLEDGEMENT` -> `PREPARING`
  - `PREPARING` -> `READY_FOR_DISPATCH`
  - `READY_FOR_DISPATCH` -> `DISPATCHED`
  - `DISPATCHED` -> `SUPPLIER_DELIVERED`

---

## 7. Buyer Protection & Dispute Resolution

### 7.1 File Dispute (`POST /api/v1/disputes`)
- **Auth:** Bearer Token (BUYER role required)
- **Headers:** `X-Idempotency-Key: <uuid>`
- **Request Body:**
  ```json
  {
    "order_id": 12,
    "reason": "DAMAGED_GOODS",
    "dispute_category": "QUALITY_DEFECT",
    "description": "5 bags of rice arrived water-damaged and torn during transit.",
    "disputed_quantity": 5.0,
    "evidence_image_url": "https://storage.miljor.com/disputes/img_102.jpg"
  }
  ```
- **Success (201 Created):** Creates dispute, places order into `EXCEPTION` status, and places automatic financial hold on supplier payable.

### 7.2 My Disputes (`GET /api/v1/disputes/my`)
- **Auth:** Bearer Token (BUYER role required)
- **Success (200 OK):** Returns array of disputes filed by buyer.

### 7.3 View Dispute Detail (`GET /api/v1/disputes/:id`)
- **Auth:** Bearer Token (Buyer, Supplier, or Admin)
- **Success (200 OK):** Returns dispute details, supplier remediation proposal, and admin arbitration events.

---

## 8. Settlements, Payables & Refunds

### 8.1 Supplier Payables (`GET /api/v1/settlements/payables/supplier`)
- **Auth:** Bearer Token (SUPPLIER role required)
- **Success (200 OK):** Returns list of accrued payables, net amounts (Gross + Delivery - Fee), held amounts, and settlement status.

### 8.2 Buyer Refund Obligations (`GET /api/v1/settlements/refunds/my`)
- **Auth:** Bearer Token (BUYER role required)
- **Success (200 OK):** Returns approved refunds for buyer orders.

---

## 9. Comprehensive Error Code Catalog

| HTTP Status | Error Code | Description / UI Action |
|:---|:---|:---|
| 400 | `INVALID_INPUT` / `VALIDATION_ERROR` | Required fields missing or out of bounds. Show inline field errors. |
| 401 | `UNAUTHORIZED` / `INVALID_TOKEN` | Bearer token expired or missing. Clear token, redirect to `/login`. |
| 401 | `INVALID_CREDENTIALS` | Incorrect phone/email or password. Display "Invalid phone or password". |
| 403 | `FORBIDDEN` | Insufficient role or cross-tenant boundary breach (IDOR attempt). |
| 403 | `ACCOUNT_SUSPENDED` | Account suspended by platform admin. Show contact support prompt. |
| 404 | `NOT_FOUND` / `ORDER_NOT_FOUND` | Resource ID does not exist or has been removed. Show 404 error page. |
| 409 | `CONFLICT` / `DUPLICATE_IDENTIFIER` | Phone or email already registered. Prompt user to login instead. |
| 409 | `ORDER_ALREADY_PAID` | Checkout attempted on an already paid order. Redirect to order detail. |
| 422 | `CAPACITY_EXCEEDED` | Reservation exceeds remaining pool capacity. Suggest lower quantity. |
| 422 | `INVALID_ORDER_STATUS` | State machine transition not allowed from current order status. |
| 502 | `SAFEPAY_API_ERROR` | Payment gateway network error. Prompt user to retry in a moment. |
| 500 | `SERVER_ERROR` | Internal server exception. Show generic fallback error alert. |
