# MilJor — UCP verified secondary-to-main integration handoff (2026-11-12)

**Scope:** Safe integration of previously tested UCP/B4/B5/B6/auth/stock/commission source from the most recent passing CI candidate into `main`. This file is an evidence ledger, not a claim of production payment certification.

## Immutable sources and collision resolution

- Main before integration: `94a6e5000d8b6118270a9cffc62f86d0c8d6f9a5`.
- Verified secondary baseline: `fix/p0-morning-demo-canonical-gates` at `2030fb7359f596d08bdbea8a5399f466008cec60`.
- Verified source CI runs: [43093840197](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43093840197) and [43093830834](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43093830834), both SUCCESS, full configured 3-job acceptance.
- Canonical source lineage: PR #9 → PR #10 → PR #12. Do not independently re-merge PR #5/#6/#8/#11.
- The sole divergent main change since common ancestor was `frontend/src/components/RegularReservationWorkflow.jsx` added by main. The verified candidate separately added a superseding version of the same file. The candidate implementation is retained because it additionally preserves mutation idempotency keys across retries, uncertain outcomes and explicit decline reason, unlike the old main version. Exact main version can be recovered at `94a6e500`.
- Integration merge object `57a60a5d66c066be764dcafbcd1ebab2831f3ec1` has both parents (verified candidate + main), and the verified candidate tree. It is on an isolated integration branch; this did NOT update main by itself.
- Acceptance workflow extends to the integration branch and PRs targeting main; the fresh integration head SHA needs its own CI PASS before release.

## Already tested (source candidate, not necessarily all future branches)

- MySQL 8.0 disposable `miljor_test_db` fresh install; 053→054 historical order fingerprint and checksum; journal validation and rerun idempotency.
- B4 Regular Pool 25/25; B5 Flash Pool 39/39; B6 HTTP/concurrency 25/25; stock 2/10/50/100 clients (see CI logs).
- Synthetic HMAC-SHA512 signed HTTP payment, signature tampering, amount/currency mismatch, tracker unknown, escrow held, replay idempotency. **Not provider-origin callback evidence.**
- Real Chromium separate buyer/supplier authentication, authorization, offline/refresh handling, secure re-login; frontend production build.

## Out of current verified merge scope — do not claim complete

- `feature/unified-pool-only-workflow`: 3 changed frontend files vs candidate; not absorbed because independent full journey acceptance unverified. Main-facing unified-only UX is a product requirement.
- `feature/b7-postpurchase-acceptance-isolated`: 40 changed files vs candidate; 046–048 migration and procurement service overlap; do not wholesale cherry-pick.
- `fix/p0-financial-f1-f5-closure-isolated`: 37 changed files vs candidate, overlapping payment/settlement controllers, fee service, migration compatibility. Require independent file-by-file financial and migration reconciliation.
- `fix/p0-safepay-refund-evidence-isolated`: 33 changed files vs candidate with overlapping finance services. Do not infer refund/provider certification from source tests.
- `fix/ucp-ci-auth-refresh-singleflight`: overlaps already reconciled PR #12; no blind second merge.
- Genuine Safepay provider-signed sandbox callback, refunds/payouts and final cross-role B7 postpurchase UI E2E remain distinct release gates.

## Main merge safety

Only merge this integration PR after actual full source/build, disposable MySQL, stock stress, synthetic payment and real Chromium checks PASS on the exact integration SHA; confirm branch has not moved; preserve the additive canonical migration lineage 046–048 and 051–054; do not mutate `miljor_db` or `miljor_sandbox_db`. Final release readiness remains BLOCKED for external provider certification and separate B7/finance/full marketplace E2E.

**Current result:** INTEGRATION CANDIDATE, not a final production deployment certificate.
