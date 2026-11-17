# UCP remaining-work execution — 2026-11-16

Authorized scope: complete the remaining existing resilience/notification master plan on PR #54; preserve original source, data, financial evidence and all existing behavior. No main merge or real money movement.

## Audited source-integration proposal

- Current UCP starting SHA: `7df58aaccec63645c7fbdaf8bcc23db26d0402d7`.
- Existing committed Smart Hub source: `08a9d87809a1c3683074500d20f6a14fb5c41781`, branch `feature/smart-procurement-hub-unified-entry`.
- Existing main SHA inspected: `9fb07cf9274509c1686b68b5bf8bdd91bd26718f`.
- Smart Hub already supplies persistent notification projection/preferences, localized event templates, email claim/retry safety, delivery binding and action hooks. Reuse these instead of recreating the same engines.
- A read-only `git merge-tree --write-tree` preview found actual conflicts in `.gitattributes`, phase log, notification routes, dispute/email/financial/fulfillment/Safepay services, and two service-test adapters. No branch/worktree merge was executed.
- Its migrations090–094 collide by version with this unmerged PR's 092/093. Preserve already applied original-branch history. Proposed reconciliation: retain the original committed Smart Hub migrations exactly, move PR-only migrations to unused canonical versions with recorded provenance, and prove a fresh install plus repeat run on an isolated `miljor_test_db`. Do not rewrite any existing database journal or historical test evidence.
- Actual cross-branch integration requires the user's explicit merge authorization under AGENTS.md section 2.3.4. Main remains untouched. Uncommitted worker edits must be checkpointed/preserved before any integration.

## Concurrent implementation boundaries

1. Frontend: persistent role-independent inbox, real read/unread ownership, mobile/accessibility, preferences for locale/email/mute/quiet hours. Reuse the already committed Smart Hub implementation where applicable. No restyling.
2. Regular recovery: authoritative deadline processing and pending-payment protection, bounded leased worker, supplier timeout/admin exception recovery, explicit buyer consent, append-only audit. No forged actor decisions, replacement/charge/refund/payout without authorized evidence.
3. Integration/notifications/provider proof: reconcile source and migration history, reuse the existing projector/outbox, connect remaining supported domain actions, implement delivery/admin monitoring, validate provider capabilities and record actual runtime results separately from synthetic acceptance.

## Selected cost and consent policy — 2026-11-17

The user delegated selection of the most feasible approach. The following conservative policy is selected for Phase C/D implementation; it is a business decision, not evidence that those workflows are already implemented.

- **Locked original terms:** Preserve the original order, accepted quote, charges, physical SKU/specifications and history. No silent repricing or replacement.
- **Buyer-requested change:** Address, mode, timing or other buyer-requested changes require a fresh supplier quote showing the original amount, new amount, exact difference, delivery terms/ETA and expiry. An extra buyer charge requires explicit acceptance of that exact quote/version. Acceptance alone does not prove payment or authorize execution outside existing financial gates.
- **Supplier/carrier failure:** Do not add a compulsory buyer charge to remedy the failed original service. Attribute supplier/carrier costs only through existing accepted contracts or a separately authorized, recorded resolution; do not invent or automatically debit a supplier liability.
- **Platform/provider fault or disputed responsibility:** Do not automatically charge the buyer or grant a platform subsidy. Open an audited support resolution using existing exception/dispute paths; responsibility and any commercial concession must be explicitly recorded and authorized.
- **Cancellation:** Introduce no new automatic cancellation penalty. Any previously agreed non-recoverable cost requires the recorded prior terms, evidence and existing authorized financial-review path. Never silently pass through guessed provider fees or perform a live refund/payout.
- **Replacement:** A proposal or buyer consent record alone must not substitute suppliers. Require eligible replacement supplier terms, an immutable fresh quote and explicit owning-buyer acceptance of the exact SKU, charges and delivery conditions. Preserve the old contract/payment evidence and use the existing gated re-contracting/refund/new-order boundaries.
- **Decline, expiry or silence:** None is consent. Leave original terms unchanged where still fulfillable; otherwise route to the existing failure/dispute/refund-resolution path. Do not auto-charge, auto-substitute or erase the original obligation.
- **Acceptance evidence:** Persist quote/version/hash, initiating actor and reason, cost responsibility, old/new breakdown, buyer decision/time and idempotency identity. Notify only affected parties. Revalidate ownership, eligibility, quote expiry and consent after locks.

This resolves the previously pending fresh-quote/buyer-acceptance policy choice. Phase C/D implementation and verification, provider capability and other release gates remain outstanding. No Phase C execution, main merge, original database change or external money movement is performed by this documentation update.

## Acceptance and evidence

- All mutable tests only on isolated `miljor_test_db`; protected original database read-only checksums before/after.
- One consolidated affected gate after stabilization; targeted reruns for actual failures only. Preserve the prior accepted evidence separately.
- Replay/ownership/negative/concurrent stock and financial checks, real migration install/idempotent replay/backup restore, real provider sandbox/email evidence where available, production frontend build and browser journeys.
- Update the existing implementation report and phase log, then commit/push verified changes on the approved branch. Report PASS/FAIL/BLOCKED honestly; catalog presence and mock callback success are not actual provider acceptance.

Status: Smart Hub integration explicitly approved by the user ("Approve integration into PR #54"). Source integration and the implemented reliability/notification increment have passed the local affected gate. Full master-plan release remains PARTIAL/BLOCKED; see the current dated section in the existing implementation report. No main merge or shared database migration authorized. CAN START NEXT PHASE: NO.
