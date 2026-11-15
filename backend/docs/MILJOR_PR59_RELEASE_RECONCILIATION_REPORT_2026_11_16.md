# MilJor PR #59 — Supplier + UCP + Notifications Release Reconciliation

**Date:** 2026-11-16  
**Branch:** `feature/miljor-release-reconciliation`  
**PR:** #59 (draft; not merged)  
**Qualified application + test SHA:** `a478d28eeef5fd524d15bc821e96685f7a06a036`  
**Release gate:** **PARTIAL / BLOCKED**, despite all nine scoped CI workflows succeeding.

## Implementation completed on this review branch

### 1. Canonical migration reconciliation
- Introduced reviewed 090–094 Smart Procurement migrations from PR #53 and relocated PR #54's UCP recovery-cursor migration to 095, avoiding duplicate 092/093 version numbers in the *new canonical tree*.
- Preserved PR #53's `092_notification_event_delivery.sql` VARCHAR(80) event column, which accommodates PR #54's narrower VARCHAR(64) requirement.
- Pinned expected 090–095 filenames in `backend/database/migrationManifest.js`; preserved fail-closed applied-history/checksum validation.
- Reworked the adversarial finance-collision test fixture to include the extended pinned manifest while still asserting that a competing 049 is rejected.
- **IMPORTANT:** Environments that already applied PR #54's differently named 092/093 MUST NOT run this proposed sequence as-is. Inspect their applied journal and history, make a backup, and perform operator-reviewed forward reconciliation. Never rename/rewrite applied migrations or their journal records.

### 2. Flash UCP crash recovery
- Integrated leased, fair-cursor Flash recovery from PR #54 via `ucpRecoveryService.js`, forward migration 095 and scheduler guard.
- Added `expireOfferForRecovery()` system-only path to preserve committed or unresolved-payment inventory even when supplier verification is suspended.
- Kept scheduled worker opt-in with `UCP_FLASH_RECOVERY_WORKER_ENABLED` AND `UCP_FLASH_RECOVERY_RUNTIME_APPROVED`; no automatic external payments or money movement.
- Recovery and transactional-notification contract tests run separately in GitHub CI.

### 3. Transactional notifications and email
- Added canonical UCP notification catalogue and transaction-bound receipt service.
- Integrated notification hooks in reservation, Flash, order, Safepay payment, fulfillment, dispute and settlement services, plus connection-scoped fee calculation fixes.
- Integrated PR #53 notification event policy, recipient-isolated inbox processing, English/Urdu preferences, recurring reminder staleness checks, and durable queue projection.
- Integrated PR #53's leased email outbox retry and crash handling while preserving branded OTP templates. `UCP_NOTIFICATION` uses its validated notification template.
- Worker guarded with `NOTIFICATION_WORKER_ENABLED` and `NOTIFICATION_RUNTIME_APPROVED`. External transport additionally guarded by `NOTIFICATION_EMAIL_DELIVERY_ENABLED`.
- Corrected notification numeric ID validation and ensured read operations use authenticated user ownership.

### 4. Buyer/supplier regression and premium dashboard coverage
- Previous PR #58 paid-plan Safepay Sandbox one-time checkout, verify, cancel and Starter-expiry work remains inherited; paid-to-paid midperiod changes remain disabled without pricing/proration policy.
- Updated deterministic fulfillment and refund/dispute fixtures to assert transactional notification on valid transitions and no notification on rejected transitions.
- Added real Chromium supplier navigation checks for delivery, earnings, disputes, analytics, notifications and subscription pages. These checks use a disposable database and are **not** a full real paid clustered-delivery journey.

## CI evidence — ALL PASS on exact qualified source SHA a478d28

| Workflow | Result | Evidence |
|---|---|---|
| UCP Canonical Reconciliation (MySQL, frontend build, Chromium) | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365151 |
| P0 payment / fulfillment / settlement integration | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365123 |
| E3 disposable MySQL / entitlements / subscription | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365143 |
| Delivery quantity safety | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365182 |
| Notification and email outbox reconciliation | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365247 |
| UCP recovery reconciliation | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365141 |
| Branded OTP email quality | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365191 |
| Supplier subscription period-end contract | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365149 |
| Admin and supplier approval | SUCCESS | https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43760365177 |

## Not yet proven / release blockers

1. **Genuine external Safepay Sandbox transaction** initiated from a configured merchant account, provider-origin signed webhook / authoritative reconciliation, real sandbox refund and payout evidence. GitHub synthetic tracker/HMAC fixtures do not demonstrate these external outcomes.
2. **Recurring paid subscription billing**, renewal, cancellation with provider subscription IDs, and paid-to-paid upgrade/downgrade with consent/proration are not implemented/verified. Existing paid supplier checkout is a prepaid period without automatic charges, not an externally verified recurring billing plan.
3. **Complete all-origin UI-driven buyer→supplier→clustered delivery→POD→partial dispute/refund→settlement** browser acceptance; current Chromium proof verifies auth, navigation, and selected real backend interactions, not every business journey.
4. **Complete Smart Procurement PR #53 R2–R6 functionality**, collective payable commitments, grouped recurring deliveries, delivery quote/choice binding, full event producers, savings/reliability claims. Source changes were partially reconciled for migrations and notifications, not every Smart Hub controller/service.
5. **Existing alternate migration history audit** and production backup/restore verification before deploying 090–095 on any persistent database.
6. **External email provider/SMS evidence**; isolated mocked outbox processing is not evidence of delivered emails/SMS.
7. **Credential rotation** for historically exposed Docker password(s) in external secret store / MySQL, plus staging security/backup and mobile visual accessibility acceptance.

## Protected environment and merge decision

The session did NOT run destructive statements on `miljor_db` or `miljor_sandbox_db`; mutable GitHub acceptance used disposable `miljor_test_db`. No real external financial movement took place.

**Verdict:** The listed implementation increments are TESTED/PASS at exact qualified SHA; **OVERALL RELEASE BLOCKED**. Keep PR #59 draft. Do not blindly merge PR #53/#54, rewrite already-applied migration history, enable runtime workers, or merge to main until provider, operations, migration and full business E2E acceptance are verified.
