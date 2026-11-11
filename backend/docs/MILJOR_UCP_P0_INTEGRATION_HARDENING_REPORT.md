# MilJor UCP-3/4/5 — P0 Reconciliation and Retry Hardening Implementation Report

**Workstream:** THIS CHAT only.  
**Base:** `feature/ucp-3-5-integrated`.  
**Branch:** `fix/ucp-3-5-integration-hardening-local`.  
**Release status:** SOURCE CHANGES COMMITTED; **BLOCKED** until consolidated migration, MySQL, API, Vite, concurrency and Safepay acceptance.

## Implemented against frozen plan

### I1. Buyer mutation idempotency and retry recovery
- B4 `RegularBuyerReservation`: stable per-action key across network retries and matching payload; rejects changing quantity after an uncertain outcome. No automatic second reservation.
- B5 `FlashBuyerPoolCard`: stable quantity/address/hold key across retries and independent stable checkout key; warns when network result is unknown. Buyer cannot silently change purchase quantity or destination while original hold status might be unresolved.
- B4 `RegularReservationWorkflow`: durable in-page keys for immutable ACCEPT/DECLINE and eligible commitment-to-order; controlled decline reason preserved, no automatic payment. A different payload cannot be sent under the same unresolved intent.
- B4 `RegularPaymentHoldCard` and B5 `FlashPaymentHoldCard`: original checkout retry key reused, rather than generating a distinct Safepay attempt on every network error.
- UCP supplier `SupplierPoolsPage`: stable Regular draft/publish idempotency keys, explicit ambiguous-response warning, block blind duplicate Flash draft on uncertain creation. Known partial Regular draft cluster-save failure retains original draft ID for safe update. Existing engine authority unchanged.

### I2. Server-authoritative Flash countdown
- Existing B5 `reserveFlashPool` returns additive read-only `server_time` from DB UTC alongside the hold response.
- UCP Flash buyer card syncs independent payment hold countdown to this timestamp; pool expiration countdown remains separate. Neither timer creates/settles/cancels/refunds payments or mutates inventory.
- Existing Safepay verified callbacks and in-flight attempt protection remain authoritative; no payment success claimed from browser UI.

### I3. Supplier inventory read model identity safeguards
- Supplier stock read endpoint joins supplier listing to specification and supplier physical SKU; requires matching supplier and SKU identities, published SKU/spec, active/approved listing before displaying advisory available stock.
- Allocations still derive from authoritative shared `supplier_inventory_allocations` PENDING+COMMITTED and precise decimal math, never a parallel stock balance.
- Existing UCP Regular clusters and Flash fixed-fee delivery separation retained; published terms still immutable.

### I4. Deferred verification and migration blocker
- Prepared `backend/tests/ucp_p0_integration_retry_source_gate.js`, **not executed**, to use alongside B4/B5/B6, Vite and MySQL final acceptance.
- Existing parallel PR #5 (UCP-3/4/5 implementation) and PR #6 (separate independent audit-repair) are not merged/cherry-picked or overwritten in this branch.
- **P0 migration reconciliation pending:** branch-local names 046, 047, 048 conflict numerically with B6 phase2 046, 047, 048 on parallel branches. That track has already prepared 051/052/053 renumbering in PR #6. A combined branch must verify the actual `schema_migrations` ledger, select ONE collision-free canonical migration set, and prove fresh and upgrade paths on disposable `miljor_test_db` before any deployment. Do not blindly reapply renumbered statements or mark ledger versions by hand.

### I5. Release gate
- Source edits committed to a distinct branch; request draft PR only, no production merge.
- No database migration executed. No protected `miljor_db` or sandbox database mutated. No Safepay charge/settlement initiated.
- No Vite, MySQL, API E2E, concurrent stock or complete financial regression test executed; static source checks do not substitute for these.

## Explicit final acceptance (deferred at owner's request)
1. Reconcile B6 and UCP migration versions and SHA lineage; verify `miljor_test_db` only, protected DB fingerprint.
2. B4 supplier SKU listing → Regular draft → clusters → publication → buyer reservation → supplier decision → buyer final offer/decision → order → 15-minute payment hold → Safepay verified PAID; retry identical key on duplicate/outage.
3. B5 supplier SKU listing → Flash draft → publish → whole-lot or multi buyer hold with address → 15-minute checkout → provider reconciliation; verify expired/pending/no double sale.
4. Simultaneous Regular and Flash publications against same SKU; exact unit conversion and shared inventory ledger 0.0001 boundaries.
5. Supplier/other-supplier/buyer/unauthenticated tenant and role negative tests; no B6 cohort/private RFQ data in pool screens/analytics.
6. Delivery cluster enable/disable, pickup eligibility, actual rates and explicit Flash fixed-fee contract; no fabricated delivery promises.
7. Vite production build, mobile/browser keyboard/accessibility, page refresh/timeout/ambiguous request, countdown UTC and Asia/Karachi.
8. Compare actual PAID order totals and provider evidence, refunds and escrow, outbox no duplicate send; record PASS/FAIL/BLOCKED per applicable gate.

**Conclusion:** P0 retry and read-contract hardening has been implemented at source level. Integrated release remains BLOCKED until final executed evidence, especially migration lineage and provider-backed E2E.
