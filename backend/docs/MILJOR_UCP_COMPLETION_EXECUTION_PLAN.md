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

## Acceptance and evidence

- All mutable tests only on isolated `miljor_test_db`; protected original database read-only checksums before/after.
- One consolidated affected gate after stabilization; targeted reruns for actual failures only. Preserve the prior accepted evidence separately.
- Replay/ownership/negative/concurrent stock and financial checks, real migration install/idempotent replay/backup restore, real provider sandbox/email evidence where available, production frontend build and browser journeys.
- Update the existing implementation report and phase log, then commit/push verified changes on the approved branch. Report PASS/FAIL/BLOCKED honestly; catalog presence and mock callback success are not actual provider acceptance.

Status: Smart Hub integration explicitly approved by the user ("Approve integration into PR #54"). Source integration and the implemented reliability/notification increment have passed the local affected gate. Full master-plan release remains PARTIAL/BLOCKED; see the current dated section in the existing implementation report. No main merge or shared database migration authorized. CAN START NEXT PHASE: NO.
