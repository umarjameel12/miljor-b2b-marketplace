# MilJor Overall Verification Master Gate — 2026-11-13

Candidate: PR #41, fix/ucp-flash-delivery-authoritative-20261113 -> main.
Safety: test only against isolated miljor_test_db (disposable MySQL 8); NEVER mutate miljor_db / miljor_sandbox_db. Sandbox/synthetic Safepay only; ALLOW_EXTERNAL_MONEY_MOVEMENT=false. Do not merge prior to final acceptance.

## Gate definitions
PASS means CI and API/browser/database tests on the exact head commit have evidence.
FAIL means reproduced mismatch with error and fix tracked.
BLOCKED means missing environment, provider integration or an unimplemented feature.
UNVERIFIED means source or historical earlier-commit PASS exists but candidate not run.

## Overall verification gates
V0: Canonical migrations 046–048, 051–054; schema history, conflicts, protected DB fingerprints, branch/PR review.
V1: Buyer/supplier/admin authentication, active approval, RBAC, token/session failures, cross-owner negatives.
V2: Single /pools buyer and /supplier/pools supplier page with Regular+Flash subcategories; no separate Flash routes in navigation; B4/B5 MOQ, discount tiers, stock, expiry/payment timers, cancel, idempotency and oversell concurrency.
V3: Shared Smart Delivery eligibility, standard clustered, pickup, express, verified buyer address, supplier rates, anti-tamper fees, immutable order mode, pickup location and source of each charge.
V4: Safepay sandbox attempts, provider-origin signed callback versus synthetic signing, reconciliation, locked amounts, ledger, refunds and payout disabled/live-money guard.
V5: Paid fulfillment, supplier tracking, buyer delivery confirmation, partial 100/80/20 and dispute, exact multi-item invoice, settlement only after authorization.
V6: Vite production build, Chromium buyer/supplier/admin full browsing, UCP checkout, B6 flows, security, 2/10/50/100 stock stress, final release checks.

## Evidence found before this plan commit
PR #41 earlier commit 4f994105 had successful UCP canonical reconciliation, delivery quantity, admin approval and payment-fulfillment-settlement workflow results.
Another earlier commit 21e528040 passed B5 Flash disposable MySQL regression 39/39.
Latest previous head 99205e4d lacked a returned CI run; cannot count earlier PASS as latest certification.
Flash standard clustered verified-address fee is recalculated at hold; Flash buyer preview is read-only. Flash Pickup and Express lifecycle NOT implemented; do not advertise supported.
Provider-origin Safepay certification and full cross-role postpurchase E2E remain unproven.

## Mandatory sequence
1. Run CI against exact candidate head with source/build, disposable migrations, B4/B5/B6, real HTTP, negative auth and Chromium buyer/supplier.
2. Resolve each failure with a regression test; rerun on changed head.
3. Implement or explicitly mark BLOCKED Flash pickup/express order and fulfillment semantics, including immutable mode/location/fee records.
4. Test Safepay sandbox, refunds, partial delivery and supplier/buyer confirmation end to end. Never use production credentials or live money.
5. Record run URLs, SHA and PASS/FAIL/BLOCKED for each gate. Do not merge to main without approved full green acceptance.

CURRENT RELEASE STATUS: BLOCKED (full delivery mode parity and latest SHA E2E/provider evidence missing).
