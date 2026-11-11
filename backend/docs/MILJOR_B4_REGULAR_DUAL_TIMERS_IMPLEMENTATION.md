# MilJor B4 — Regular Pool Dual Timers (Expiry + Payment Hold)

**Branch:** `feature/b4-regular-dual-timers`  
**Parent:** `fix/b6-backend-hardening`  
**Scope:** Regular Pool expiry clock and committed-order payment-hold clock **only**. Flash B5 and B6 RFQ/Collective/Recurring untouched. All unified pool management / analytics / other features remain on HOLD.

## Business behavior

1. **Regular Pool participation expiry**: supplier-configured `scheduled_close_at`/`expires_at` remains the source of truth. Existing `PoolCard` countdown shows buyer remaining time. Discovery now supplies database-derived `server_time` in UTC with `pool_type: REGULAR`. Backend independently rejects late new reservations; the clock cannot override status.
2. **Payment-hold expiry (15 minutes)**: starts **only when a confirmed B4 buyer commitment is converted into an authoritative order**. Not at pool draft creation, pool publication, or reservation. Each new order receives exactly one `regular_pool_payment_holds` row in the order transaction.
3. `HELD`: buyer can start checkout before `expires_at`. Browser shows an independent `CountdownTimer` using `server_time`. Checkout start atomically claims `PAYMENT_PENDING`.
4. **Payment initiated**: payment-attempt/provider reconciliation remains authoritative; countdown reaching zero must NEVER silently cancel a pending Safepay payment, refund funds or free committed stock.
5. **No checkout started and deadline passed**: new Safepay checkout sessions are blocked by `REGULAR_PAYMENT_HOLD_EXPIRED`; the hold can be marked `EXPIRED` when checkout is next attempted. Reauthorization must go through a future explicitly audited resolution flow, not a self-service timer reset.
6. **Safepay verified PAID**: webhook or trusted provider reconciliation sets the regular hold `PAID` inside the same verified payment transaction. The escrow/payment, reservation and pool commitment engines are NOT replaced.
7. **Historical B4 orders** created before migration 053 have no retroactively invented 15-minute hold. They remain eligible for existing historical payment/reconciliation paths and are labeled appropriately in UI.
8. **B5 Flash** maintains its preexisting distinct 15-minute purchase hold; **B6 buyer-created RFQ, collective and recurring** remain entirely separate.
9. Real-time display has no authority to expire an order, release a buyer allocation or confirm payments.

## Files

- `backend/database/migrations/053_regular_pool_payment_hold_deadlines.sql`
- `backend/src/services/regularPoolPaymentHoldService.js`
- `backend/src/services/orderService.js` (transactional hold creation)
- `backend/src/services/safepayCheckoutService.js` (gated checkout + provider-paid transition + status)
- `backend/src/controllers/poolController.js` (regular pool server UTC)
- `frontend/src/components/PoolCard.jsx` (existing pool countdown reused)
- `frontend/src/components/RegularPaymentHoldCard.jsx` (new live buyer payment countdown)
- `frontend/src/pages/OrdersPage.jsx` (real B4 order integration)
- `backend/tests/b4_regular_dual_timer_source_gate.js` (prepared, not run)

## API contract

Public `GET /api/v1/pools` returns each Regular Pool with `pool_type: REGULAR`, `server_time: ISO_UTC`, and the existing `scheduled_close_at/expires_at` fields.

Authenticated buyer `GET /api/v1/orders/:id/payment-status` includes:
```json
{
  "regular_pool_payment_hold": {
    "kind": "REGULAR",
    "status": "HELD",
    "expires_at": "2026-11-11T16:00:00Z",
    "server_time": "2026-11-11T15:48:00Z",
    "checkout_started": false,
    "can_start_checkout": true
  }
}
```
This is an example schema, not a reported live payment.

## Final acceptance — NOT RUN

After the user's remaining requested features are completed, run the final test suite **only on `miljor_test_db`** with migrations through 053:

- No regular order creation unless migration 053 exists; order and hold must commit/rollback atomically.
- Verify server-clock countdown with UTC/Asia-Karachi and refresh/reload.
- Check original pool expiry vs payment-hold expiry independence; no payment hold before order conversion.
- Buyer cannot checkout before commitment conversion or after expiry.
- Checkout initiated at deadline - 1 second remains safely reconcilable after expiry; fresh attempt at deadline + 1 second fails.
- Provider tracker creation failure safely returns to HELD if clock still valid or EXPIRED if deadline elapsed.
- Authorized buyer/admin access only; other buyers/suppliers cannot read payment tracker.
- Duplicate checkout keys and two concurrent buyer checkout attempts; repeat paid callbacks and provider reconciliation exactly once.
- No release/refund while a provider attempt is in-flight; no interference with Flash or B6 inventory allocations.
- Historical orders remain accessible; B4 order list and payment hold UI show only real server data.
- Verify production build, frontend countdown UI, full B4/B5/B6 regression, and protected DB fingerprints.

**Release gate: SOURCE CODE COMMITTED / FULL REGRESSION NOT EXECUTED / DATABASE MIGRATION NOT APPLIED.**
