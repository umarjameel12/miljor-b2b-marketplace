# MilJor — Supplier Release Hardening / Subscription Checkout

**Date:** 2026-11-16
**Qualified application+test code commit:** `a15dc187921f7f8325d91e1a7d639274f504b585`
**Review branch:** `feature/supplier-provider-billing-hardening`
**PR:** #58 (draft). **Not merged to main.**
**Gate:** PARTIAL — focused verification PASS; overall launch blocked by provider, full logistics, and conflicting PR integrations.

## Implemented (on top of supplier dashboard PR #57)

1. **Separate subscription Safepay Sandbox payment model:** Migration 062 creates `supplier_subscription_checkout_attempts`; no reuse of buyer order payments or escrow.
2. **Paid checkout:** Supplier ownership and verification, plan/price from locked DB, X-Idempotency-Key, one active unresolved attempt, Safepay tracker creation outside MySQL locks, safe local/HTTPS redirect allowlist and recoverable uncertain tracker handling.
3. **Server-authoritative reconciliation:** Fetch Safepay tracker; verify exact identity, PKR amount, captured state and refusal of failed/reversed transaction states. Activate exactly once inside an InnoDB transaction with plan, supplier profile, audit record and journal update. Browser redirect alone never activates plan. No manual client supplied payment amount accepted.
4. **Period end:** Paid subscriptions without verified renewal automatically return to Starter at the actual end date; no automatic charges, and historical orders/pools retained. Paid-to-paid midperiod changes remain disabled pending commercial proration/renewal policy.
5. **Premium subscription UI:** Real priced plan cards, supplier entitlements, Sandbox checkout, pending/retry provider verification, cancellation confirmation and billing status. Playfair headings with Inter body/KPI, warm neutrals and Champagne Gold; no invented payment success.
6. **Notification security:** Fixed `markAsRead(userId,notificationId)` argument order in the authenticated route. Real MySQL HTTP recipient-isolation test added.
7. **Browser and SQL acceptance:** Added supplier subscription page to real Chromium journey; dedicated real MySQL checkout/expiry gate with synthetic provider readback, plus focused mock negative conditions and replay tests.

## Exact qualified-head GitHub Actions evidence (all SUCCESS)

- Supplier Subscription Period-End Contract: https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43756849451
- E3 Disposable Entitlement + supplier checkout MySQL: https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43756849416
- UCP Canonical + source/build + Chromium auth/browser: https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43756849481
- P0 Payment Fulfillment Settlement Combined E2E: https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43756849392
- Demo Delivery Quantity Safety: https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43756849396
- Admin Supplier Approval + Frontend Build: https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43756849394

**Boundary:** Synthetic provider tracker and signed-fixture tests do NOT prove a real Safepay-origin charge, subscription refund, renewal charge, or bank payout. Chromium checks do not cover every grouped recurring/refund journey.

## Explicit remaining blockers (no false completion)

- **External subscription provider acceptance:** Genuine configured Safepay Sandbox checkout + provider-origin tracker capture/reconciliation + refunds/failed/cancelled flows. Requires eligible verified credentials and external runtime.
- **Recurring subscription billing/proration:** No automatic charge or paid-to-paid upgrade/downgrade until separate commercial policy, consent and tested payment schedule are implemented.
- **Notifications:** PR #53 and #54 overlap in the same notification routes/services, email, fulfillment and financial services; migrations 092/093 are conflicting names and cannot both be applied as written. Source-by-source reconciliation + forward-only migration journal audit required; do not blind merge.
- **Full browser E2E:** Buyer UCP → supplier → clustered delivery/POD → partial dispute/refund → provider-verified settlement for all procurement origins is not yet fully verified in one UI-driven run.
- **Secrets:** Docker credential literals removed from new branch, but historically exposed DB credentials must be rotated outside version control.
- **Release operations:** Backup restore/replay, actual SMTP delivery, full mobile visual accessibility acceptance and staging payment evidence remain unverified.

## Safety
No protected `miljor_db` or `miljor_sandbox_db` modifications or actual external funds movement by this ChatGPT session; CI mutable integration runs use disposable `miljor_test_db`.

**Result:** Implementation increment TESTED/PASS at qualified source head. Overall release **PARTIAL/BLOCKED**. Keep PR #58 draft; do not merge main yet.
