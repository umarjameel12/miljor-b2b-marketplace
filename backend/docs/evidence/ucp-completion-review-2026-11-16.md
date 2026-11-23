# UCP completion: bounded independent review — 2026-11-16

Reviewed the current working copies of `notificationService.js`, `emailService.js`, `schedulerService.js`, `ucpTransactionalNotifications.js`, and migrations 095–097. HEAD: `7df58aaccec63645c7fbdaf8bcc23db26d0402d7`; findings concern the uncommitted overlay. Direct policy/caller dependencies were read only to confirm behavior. No suites, database access, provider calls, or implementation edits were performed. This report is the only review artifact written. Skill applied: `security-review`, for source tracing and distinguishing confirmed paths from speculation.

## Actionable findings

### 1. [P1] A poison digest can indefinitely prevent unrelated email delivery

**Locations:** `backend/src/services/notificationService.js:179–197`; `backend/src/services/schedulerService.js:95–101`.

With digest and email delivery enabled, `processDigests()` runs before `processOutboxBatch()` inside the scheduler's single try block. A nonempty malformed recipient email passes the digest's `!user?.email` check, then fails `enqueueEmail()`'s stricter validation (`emailService.js:520–522`). The outer catch rolls back the entire digest transaction and rethrows. The same early due rows remain PENDING and are selected again next tick. Every such exception skips the email outbox worker, including unrelated mandatory mail. A persistent per-recipient queue error or `OPTIONAL_EMAIL_BACKLOG_LIMIT` follows the same path.

**Fix direction:** Persist bounded per-recipient digest failures without poisoning subsequent groups, and isolate scheduler steps so optional digest errors cannot prevent mandatory outbox processing. This is a concrete exception/retry path, not a claim that malformed recipients currently exist in the database.

### 2. [P2] Pool-wide adapter notifications exclude actual CONFIRMED buyers

**Location:** `backend/src/services/ucpTransactionalNotifications.js:90–94`.

The nonindividual recipient query uses `status IN ('RESERVED','PRICE_LOCKED','ORDERED')`. The existing reservation state machine and actual acceptance write use `CONFIRMED` (`commercialLifecycleService.js:69–79,2093–2105`); the demand policy also recognizes CONFIRMED commitments. Thus, when a mapped pool-wide event is recorded for a pool containing those commitments, its confirmed buyers are silently omitted even though the supplier notification commits successfully. PRICE_LOCKED/ORDERED are not substitutes for the persisted reservation statuses used by this implementation.

**Fix direction:** Resolve recipients using the existing authoritative reservation states/cohort appropriate to each mapped event. Preserve the individual-event buyer restriction; do not indiscriminately include cancelled historical reservations.

### 3. [P2] OTP retries can deliver already invalidated challenges

**Locations:** `backend/src/services/emailService.js:706–712,742–758,921–927,962–971`.

Superseded queued OTP messages are marked FAILED, but the worker's FAILED predicate does not exclude `SUPERSEDED_BY_NEWER_REQUEST`; a row with fewer than three attempts and null retry/last-attempt timestamps is immediately eligible. There is also an ordinary immediate-send failure path: `createAndSendOtp()` consumes the failed challenge, while its FAILED outbox row retains a retry schedule. `processOutboxBatch()` subsequently renders and sends the stored OTP without checking whether the challenge was consumed, replaced, or expired. These are invalid-code emails, not evidence that an invalid OTP can authenticate.

**Fix direction:** Make supersession terminal for automatic retries, and check OTP challenge validity before retry dispatch (or explicitly retire its outbox row when burning the challenge). Keep retry behavior for unrelated transactional templates.

### 4. [P2] Optional email retries/backlogs bypass configured quiet hours

**Locations:** `backend/src/services/notificationService.js:98–100,133–151,185–190`; `backend/src/services/emailService.js:921–927,962–971,994–997`.

Quiet hours are applied while assigning the initial outbox schedule. Actual dispatch checks only due time/status/attempt count. For example, an optional email scheduled before a 22:00 quiet period can fail at 21:58; its five-minute retry is sent at 22:03. A worker outage that delays an earlier scheduled message into quiet hours has the same result. Neither the worker claim nor send path rechecks the optional recipient's quiet window. Mandatory messages must remain exempt.

**Fix direction:** Apply the existing optional-delivery policy at dispatch/retry scheduling as well, without delaying mandatory messages or holding database locks over transport calls.

## Scope boundaries and nonfindings

- No additional actionable defect identified in migrations 095–097 from this static review. This is not migration execution or rollback proof.
- The latest scheduler working copy includes `alertExhaustedEvents()`; its earlier omission is not an outstanding finding.
- Claim-token fencing, same-transaction domain enqueueing, parameterized recipient queries, and documented at-least-once email transport are not reported as defects. Duplicate transport after an acceptance/persistence crash remains a documented limitation, not an invented exactly-once guarantee.
- Master-plan completeness (all domain hooks, channels, acceptance coverage, deployment switches) was not audited. Unimplemented requirements must be tracked separately from these four implementation findings.
- No additional speculative race/security issue is asserted. Runtime reproduction of these source-backed cases remains for the parent; no tests or database checks were run in this review.

**RESULT:** Four actionable static findings; implementation unchanged. CAN START NEXT PHASE: NO.

## Remediation observed after this review

All four findings were addressed in the reviewed increment: per-recipient digest savepoints and independent scheduler steps; authoritative RESERVED/CONFIRMED/PAID recipient policy; terminal stale OTPs with latest-challenge dispatch validation; and dispatch-time optional quiet-hours checks with mandatory/legacy-critical bypass. The original findings above remain as review history.

Actual focused evidence: 3/3 `ucp_review_regressions.test.js`; 30/30 shared email queue tests; actual MySQL digest poison isolation and audited retry checks in `ucp_notification_controls_mysql_gate.js`. The final affected gate includes these tests and passed all 13 groups. This closes these four implementation findings, not the remaining master-plan release requirements.
