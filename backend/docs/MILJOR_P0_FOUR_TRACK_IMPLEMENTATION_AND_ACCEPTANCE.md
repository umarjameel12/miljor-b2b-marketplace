# MilJor — Four P0 acceptance tracks (isolated, DO NOT MERGE)

Baseline: PR #9 head b33cd29f; protected `miljor_db` and `miljor_sandbox_db` MUST NOT be changed. Target `miljor_test_db` only. No blind merge with PR #5/#6/#8, finance branch or independent B6. Existing B4 Regular and B5 Flash remain distinct authoritative financial/stock engines behind the unified buyer/supplier UX; B6 RFQ/Collective/Recurring remain separate.

## P0-A: Actual Safepay signed callback and reconciliation
Preconditions: authorized Safepay sandbox account, nonproduction merchant credentials, configured public HTTPS callback endpoint, isolated buyer/supplier fixtures, approved minimal-value test payment; `ALLOW_EXTERNAL_MONEY_MOVEMENT` must remain off until separately authorized. Do not treat locally computed HMAC as a real provider callback. Verify Safepay event payload contract and key rotation from provider's actual sandbox documentation/configuration.
1. Create order and checkout; capture order id, provider tracker, payment attempt id, amount/currency, order owner and immutable timestamp.
2. Dispatch genuine provider-signed success event and separately use provider API fetch/reconcile; assert one PAID payment, one ledger credit, one escrow allocation, no duplicated stock movement.
3. Replay byte-identical signed callback 2x/10x under concurrency; assert exactly-once. Invalid signature, stale timestamp (if supported by provider), unknown tracker, wrong amount/currency, other-tenant tracker and wrong event status MUST NOT advance payment.
4. Simulate callback-before-redirect, redirect-before-callback, browser disconnect after checkout creation, delayed callback after hold expiration and provider API timeout. Uncertain status remains pending/reconcilable; never mark paid solely from redirect or timeout.
5. Failed/cancelled/refund and reconciliation replay must converge to a single authoritative state; verify audit/outbox and no negative balance.
Evidence: provider-issued callback headers/body (redacted), provider reference, SQL before/after, order/payment/ledger assertions, idempotency outcome. Gate: BLOCKED without actual Safepay sandbox credentials and endpoint.

## P0-B: Real browser buyer/supplier journey
Run actual Chromium using Playwright against Vite + Express + isolated MySQL. Use separate authenticated browser contexts for supplier and buyer. Test supplier SKU publish -> B4 draft/publish, B5 draft/publish, combined pool discovery, accurate tiers and time counters, buyer address, B4 reserve/decision/order and B5 stock hold/order, Safepay checkout and authoritative callback, paid order, supplier fulfillment, buyer delivery confirmation and dispute.
Refresh each route after key mutations; browser back/forward, double click, duplicate tabs, interrupted POST response, slow network/offline during checkout, retry with SAME idempotency key, re-login and a new device session. No extra reservation, order, Flash hold, provider checkout or settlement may appear. Ensure real displayed countdown uses server UTC; payment expiry distinct from pool expiry. Inspect HTTP 401/403 tenant isolation and sensitive data leaks.
Evidence: browser trace, screenshots, network HAR with secrets removed, backend request IDs, database idempotency rows, no console errors.

## P0-C: B4 + B5 same-SKU concurrent publication
Seed ONE published supplier-owned SKU/listing, physical stock S in isolated DB. Prepare B4 Regular draft commitment R and B5 Flash draft allocation F.
- R+F<=S: both may publish, allocations sum <=S.
- R+F>S: exactly one may succeed (or safe rejection of both); no oversubscription; identical unit and same listing identity.
- Repeat at 2, 10, 50, 100 parallel clients, plus retry and mixed cancellation, expirations and inventory updates. Use a two-client barrier to race the allocation check, and an independent SQL invariant read.
- Verify lock order and deadlock retries, allocation reference uniqueness, no duplicate publication, optimistic status constraints, and that cancellation releases only eligible uncommitted allocation. Separate suppliers' same-named SKU are NOT interchangeable.
- Under failure injection, transaction must roll back both pool status and inventory allocation together.
Evidence: per-run S/R/F, winner, loser 409/422, SQL SUM(allocated_qty) and stock, lock waits/deadlocks, repeatability.

## P0-D: Collision-free supplier commission
Current branch adds canonical forward-only migration `054_order_supplier_commission_snapshot.sql` after B6 046-048/UCP 051-053, without copying competing finance 052. The previous finance 049-052 filenames MUST NOT be replayed or silently journal-renamed. Historical NULL snapshots MUST NOT be backfilled from today's supplier profile.
Regular order conversion reads validated supplier_profiles.transaction_fee_percent under the transaction and persists immutable order.supplier_commission_percent; financialSettlementService accrues only using this snapshot and rejects NULL/invalid values (no 2.50 fallback). Supplier rate change after accepted order must not change previous payable. No commission on delivery unless an explicitly approved policy says otherwise.
**Remaining integration requirement:** enumerate EVERY other order creator (Flash, B6 RFQ, recurring, admin/manual, imports), ensure new orders persist commission or fail closed; inspect all settlement/refund/ledger readers; verify clean install, historical upgrade and rollback rehearsal. Existing historical orders with NULL snapshot require separately documented contract evidence and audited remediation, not inferred values.
- Fresh disposable migration 001..054; twice-run idempotency; exact SQL journal SHA checks.
- Upgrade from actual sanitized historical fixture with 046-048 and 051-053 already applied; ensure 054 applies once and no existing rows change; replay of finance-alias 049-052 fails closed.
- Commit order at X%; later change supplier profile to Y%; settle and assert payable at X%. Historic NULL -> explicit COMMISSION_SNAPSHOT_REQUIRED and no payable row.
- Test edge rates 0, 2.50, 100 and invalid -1, 100.01, NULL; exact decimal rounding; tenant boundaries.
Evidence: migration hash map, SQL journal, pre/post row count and checksums, order/payable snapshots, source+integration gate.

## Completion policy
Only real executions count as PASS. Source gate != MySQL concurrency; HMAC fixture != provider-issued callback; HTTP mock != browser E2E. Any unrun subgate is BLOCKED. Keep branch and resulting PR DRAFT. Do not merge/deploy unless four tracks and B4/B5/B6 regression all PASS and protected DB fingerprints unchanged.
