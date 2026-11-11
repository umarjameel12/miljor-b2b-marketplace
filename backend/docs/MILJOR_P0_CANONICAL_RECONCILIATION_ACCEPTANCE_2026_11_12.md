# MilJor P0 Canonical Reconciliation — 2026-11-12

## Decision and scope

**Canonical integration candidate:** `fix/p0-morning-demo-canonical-gates` (PR #12), based on `fix/p0-provider-browser-stock-finance-acceptance` (PR #10), which extends PR #9's reconciliation lineage.

**Release status:** DRAFT / NOT MERGED / NOT PRODUCTION VERIFIED. Passing isolated GitHub Actions CI is not evidence of a real Safepay-originated provider callback, settlement against live money, deployed hosting, or a full purchase and delivery browser journey.

## Exact acceptance evidence (latest evaluated code prior to this documentation commit)

- PR #10 head `fa42f99dbef81b4c1c37cd6dc75224bf28072458`, Actions run `43092073322` (#98): source/frontend PASS; disposable MySQL PASS; Chromium PASS.
- PR #12 head `1f64051f1552947b16d7d7199153f70e49764b93`, Actions run `43092609362` (#101): **all three jobs PASS**.
- MySQL Actions job `130773256137`: canonical history 6 versions PASS; synthetic HTTP signed Safepay negative paths PASS; same-SKU Regular/Flash publication waves: 2 clients (1 success/1 rejected, allocated 120 of 200); 10 (8/2, 200 of 200); 50 (40/10, 200 of 200); 100 (66/34, 198 of 200). The test explicitly checks allocation ledger consistency, no duplicate allocation references, and cancellation release.
- Chromium Actions job `130773256150`: real buyer and supplier login with HttpOnly cookie and no localStorage JWT; supplier and buyer session reload; interrupted pool discovery recovery; offline lost refresh response requires actual credential reauthentication; role isolation and supplier checkout denial; all PASS.
- Source/frontend Actions job `130773256030`: PASS.

All results above are isolated disposable test DB / local Chromium / synthetic Safepay test events. NO real Safepay provider-originated signed webhook assertion.

## Selective reconciliation, not blind merge

1. PR #9: read-only migration audit and finance compatibility remain in lineage.
2. PR #10: migration 054, historical upgrade gate, producer browser/provider/stress testing and settlement contracts remain in lineage.
3. PR #12: collision-resistant 48-bit cryptographic pool code for high-volume draft creation; short synthetic test order code compatible with actual DB constraint; frontend refresh single-flight shared by Auth hydration and Axios interceptor; browser acceptance respects offline race and verifies real credential reauthentication.
4. PR #11 is **not merged**. Its auth single-flight code was selectively incorporated into #12; its additional Regular/Flash `ER_LOCK_WAIT_TIMEOUT` to 409 classification is a separate semantic API change and is not necessary for the currently PASSING 2/10/50/100 inventory test. Preserve as a possible future hardening patch, requiring explicit retry/idempotency contract tests. Do not treat a 409 as stock allocation success and do not mask unexpected 500s.
5. Existing B4 and B5 transactional engines remain separate beneath shared UCP UX until a separately approved business-domain engine migration; don't remove ledger invariants or silently combine financial state machines.
6. Older UCP PRs #5/#6/#7/#8 contain divergent or overlapping changes. This document does **not** assert that every unmerged PR's independent feature work is integrated. Use actual per-file diff + migration history and regression gates before cherry-picking any outstanding features.

## Release-blocking remaining proof

- Real Safepay SANDBOX provider-originated signed callback and provider reconciliation in authorized sandbox (no external money movement in isolated CI).
- Full buyer pool reservation -> checkout -> confirmed paid order -> supplier fulfillment -> buyer delivery confirmation -> financial settlement -> invoice browser E2E. Existing real Chromium job verifies auth, reconnect, role isolation only.
- Final migration and schema journal upgrade path against disposable fresh and representative preexisting history; protected `miljor_db` and `miljor_sandbox_db` must never be modified by CI.
- Verify complete B4/B5/B6/E2/Finance integrated regression, release gates, environment configuration, and demo fixture setup independently of source-only checks.

## Immediate demo acceptance

Show only proven working screens and functions. On a local demo environment use disposable test data and visibly label mocked/synthetic payments; never claim actual paid settlement, production escrow, or a provider callback based on synthetic signatures. Prepare buyer/supplier credentials, no secret keys in documentation.

## Safety policy

Keep PR #12 in DRAFT; no merge to `main`, no production/sandbox protected DB mutation, no live payouts. Use GitHub Actions run URLs and explicit test artifacts for each release claim.
