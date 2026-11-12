# MilJor — Master E2E Acceptance Bug Register & Resolution Log

**Date:** 2026-11-12  
**Suite:** Master E2E Implementation & Final Acceptance  
**Status:** All Identified Defects Root-Caused, Repaired, and Verified

---

## Bug Register Summary

| Bug ID | Component | Defect Observed | Root Cause | Fix & Verification | Status |
|:---|:---|:---|:---|:---|:---:|
| **BUG-E2E-01** | `authController` | Login returning 400 Bad Request on `{ email, password }` | Controller expects payload key `{ identifier, password }` to support email or phone | Updated test fixture and client payloads to `{ identifier, password }`. Verified 200 OK. | **RESOLVED** |
| **BUG-E2E-02** | `pools` (Test DB) | Pool discovery returned 0 active pools | Pool 1 in `miljor_test_db` had unlinked `product_spec_id = null` and unpublished listing | Linked Pool 1 to verified listing 32, spec 78, sku 82, and set status='ACTIVE'. Pool discoverable with authoritative server time. | **RESOLVED** |
| **BUG-E2E-03** | `reservationController` | Reservation endpoint URL mismatch | Runner called `/api/v1/pools/:id/reserve` instead of canonical `/api/v1/reservations` | Updated endpoint to `POST /api/v1/reservations` with `X-Idempotency-Key` and body `{ pool_id, quantity }`. Verified 201 Created. | **RESOLVED** |
| **BUG-E2E-04** | `reservationDemandPolicy`| Reservation rejected with `BUYER_MIN_QTY_NOT_MET` | Quantity 2 below pool minimum order quantity of 25 bags | Updated quantity to 25 to satisfy pool MOQ constraint. Verified reservation ID 509 created. | **RESOLVED** |
| **BUG-E2E-05** | `orders` Schema | `ER_BAD_FIELD_ERROR: Unknown column 'status' in 'field list'` | Column name in `orders` table is `order_status` | Updated SQL to `order_status` and matching enum `'AWAITING_PAYMENT'`. Verified order created. | **RESOLVED** |
| **BUG-E2E-06** | `orders` Schema | `ER_DATA_TOO_LONG: Data too long for column 'order_code'` | `orders.order_code` schema limit is `VARCHAR(20)` | Constrained `order_code` to short unique format `ORD-${shortRand}` (12 chars). Verified. | **RESOLVED** |
| **BUG-E2E-07** | `orders` Schema | `WARN_DATA_TRUNCATED for column 'order_status'` | Target value `'CONFIRMED'` not in MySQL ENUM | Updated target state to `'PAID'` (part of `order_status` enum). Verified transition. | **RESOLVED** |
| **BUG-E2E-08** | `safepayAdapter` | `TypeError: safepayAdapter.getCheckoutUrl is not a function` | Adapter method name is `constructCheckoutUrl({ trackerToken, orderCode, webhooks })` | Updated method invocation to `constructCheckoutUrl`. Hosted sandbox URL verified. | **RESOLVED** |
| **BUG-E2E-09** | `safepayAdapter` | `AssertionError: Valid HMAC signature must verify true` | `verifyWebhookSignature` expects single object argument `{ rawBody, signature }` | Changed parameter structure to `{ rawBody, signature }`. Verified HMAC-SHA512 validation. | **RESOLVED** |
| **BUG-E2E-10** | `paymentProviderService` | Refund call failed on adapter | `safepayAdapter` does not export `initiateRefund`; method resides in `paymentProviderService` | Routed refund through `paymentProviderService.initiateRefund({ provider: 'SAFEPAY', ... })`. Verified fail-closed stub. | **RESOLVED** |
| **BUG-E2E-11** | `product_specifications` | `ER_BAD_FIELD_ERROR: Unknown column 'product_title'` | Column name in `product_specifications` is `title` | Corrected query to `SELECT id, title, brand, variety, quality_grade, pack_size, pack_unit`. Verified. | **RESOLVED** |
| **BUG-E2E-12** | `order_disputes` | `WARN_DATA_TRUNCATED for column 'reason'` | Target value `'SHORTAGE'` not in enum | Enum requires `'SHORTAGE_IN_QUANTITY'`. Updated dispute fixture. Verified dispute created. | **RESOLVED** |
| **BUG-E2E-13** | `rfqs` Schema | `ER_NO_DEFAULT_FOR_FIELD: delivery_date` | Fields `delivery_date` and `quote_expiry_date` are non-null | Added interval-based delivery date and expiry dates. Verified RFQ creation. | **RESOLVED** |
| **BUG-E2E-14** | `adminRoutes` | Admin verification route returned 404 on `/api/v1/admin/verifications` | Route mounted at `/api/v1/admin/suppliers/pending` with strict admin RBAC | Updated RBAC negative test path to `/api/v1/admin/suppliers/pending`. Buyer (403), Supplier (403), and Unauth (401) verified. | **RESOLVED** |
| **BUG-E2E-15** | `miljor_test_db.users` | Admin login returned 401 Unauthorized for `admin@miljor.com` in test DB | Demo password `admin123` had only been set in `miljor_db` in prior task | Updated `miljor_test_db.users` (id=1) with bcrypt hash of `admin123` (12 rounds). Verified admin login (200 OK, `SUPER_ADMIN`). | **RESOLVED** |
