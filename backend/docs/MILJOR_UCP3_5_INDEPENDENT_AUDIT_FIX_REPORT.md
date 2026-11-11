# MILJOR — UCP-3/4/5 Independent Audit & Fixation Report

**Date:** 2026-11-11  
**Branch:** `fix/ucp3-5-audit-repair` based on `feature/ucp3-5-delivery-marketplace-ops`  
**Gate:** SOURCE AUDIT AND REPAIRS COMMITTED; **RELEASE BLOCKED** pending isolated MySQL, Express, frontend Vite, Safepay and concurrency acceptance.  
**Production & protected databases:** No changes applied; no PR merge.

## Scope and factual audit

Inspected GitHub source across B4 Regular Pool creation/commitment/payment holds, B5 Flash offer/hold/checkouts, unified supplier management, Lahore delivery and ledger, buyer pool discovery, B6 isolation, migrations and release gates. Validated existing B4 server side auto-resolves `product_id` from a published supplier-owned physical SKU, so the frontend must NOT invent an ID.

### Confirmed defects repaired

1. **B5 Flash best-before validation:** The previous createDraft regex used a literal backslash-d and rejected legitimate ISO food best-before dates. Repaired numeric `YYYY-MM-DD` regex and added strict calendar-date validation (e.g. February 31 rejected), including edit-draft supplied date validation. Published terms remain immutable.
2. **Buyer Flash hold deadline field:** Buyer card incorrectly referenced `holdState.expires_at` although B5 API returns `hold_expires_at`. Reconciled the field, refreshed server status when countdown reaches zero, and removed stale payment CTA on expired hold. Pending provider confirmations remain separately protected.
3. **Misleading buyer dashboard commitment counter:** Active commitments previously reported all Regular orders, including paid ones, and ignored Flash holds. Counter now uses Regular unpaid statuses plus non-paid active Flash holds, with no payment mutation.
4. **Regular checkout retry idempotency:** UCP buyer Regular payment card previously minted a new key on each network retry. It now retains a stable checkout idempotency key per order page instance.
5. **Migration conflicts (P0):** Compared the actual branch migration trees. UCP's `046_expand_canonical_product_families`, `047_demand_requester_role` and `048_regular_pool_payment_hold_deadlines` collided **numerically** with the parallel B6 Phase 2 `046_recurring_collective_cycles`, `047_procurement_delivery_runs`, and `048_procurement_notification_outbox`. UCP migrations, which were **not applied on this implementation branch**, were moved to `051`, `052`, `053` respectively. B6 Phase 2's 046/047/048 remain untouched. All identified local code/tests/docs references were updated.
6. **Fail-closed migration runner:** Global duplicate numeric version check happens **before** any migration SQL is applied, including versions marked already applied. Old UCP 046/047/048 names recorded in `schema_migrations` trigger `MIGRATION_RENUMBERED_HISTORY_REQUIRES_RECONCILIATION`, not blind replay under 051/052/053. Do not force or drop migration ledger rows.
7. **Release gate preflight:** Requires 051/052/053 on isolated test DB before allowing source/integration suites. Added independent audit source assertions to `npm run test:ucp`.

### Existing behavior preserved

- B4 Regular: supplier-owned SKU resolution, original price tier engine, participation deadline, supplier/buyer commitments and separate 15-minute order payment-hold policy. No auto final buyer decision or auto-payment.
- B5 Flash: original stock hold/concurrency, price snapshots, 15-minute checkout initiation, provider verified reconciliation and whole-lot purchase behavior. No unauthorized stock release on pending payment.
- G2 supplier delivery areas & buyer verified address: current read-only operations remain, B5 delivery stays published fixed-fee/doorstep, not falsely advertised as dynamic G2 express/pickup quotation.
- B6 Private RFQ, Collective Procurement, Recurring and Collective Quotes remain distinct buyer-created procurement state machines; no backend replacement or cross-mode conversion.
- Canonical 8-category/25-family supplier-owned physical SKU model and English-only discovery.

## Evidenced audit operations

- GitHub inspection confirmed **two branch migration sets sharing 046/047/048**.
- The earlier UCP code audit successfully syntax-parsed **18/18 selected backend JS files** using JavaScript parser. This is not HTTP, DB or browser acceptance.
- A new deferred `backend/tests/ucp_independent_audit_source_gate.js` checks source invariants for Flash dates, buyer payment expiry/retries, B6 isolation and UCP migration numbering.
- No MySQL, E2E, Vite build, Safepay transaction or automation test was executed as part of this GitHub-only audit. The new source gate is prepared, **not executed in a Node runtime**.

## Known remaining blockers / next safe execution

1. **Isolated migrations reconciliation:** Apply B6 Phase 2 046/047/048 then UCP 051/052/053 in a disposable `miljor_test_db` only after integration of correct B6 source branch and schema snapshots. Verify any DB that previously applied 046/047/048 UCP names manually; fail closed.
2. **API/schema verification:** Confirm all normalized supplier overview/discovery/insights SQL columns/joins against actual schema; first test GET endpoints as own supplier, other supplier, buyer, unauthenticated.
3. **B4/B5 runtime:** Regular draft+publish+buyer reservation+buyer final decision+order creation+hold+Safepay; Flash draft+publish+hold+checkout+webhook/reconciliation, including expiration boundaries and duplicate retries.
4. **Inventory concurrency:** Two parallel B4/B5 publishes against one SKU; stock ledger unit mismatch, decimal boundaries, no over-allocation and no premature release.
5. **Delivery and buyer eligibility:** Lahore verified address ownership, rate disabling, cluster mismatch, food expiry and wrong-category/family filters, all with negative HTTP assertions.
6. **Frontend acceptance:** Vite build, both supplier/buyer dashboards, create/edit/publish, filters/search/pagination, expiring countdown and order page recovery on mobile and desktop. Source parsing cannot certify JSX compilation.
7. **Business/payment gates:** Safepay signed callbacks and duplicate events, pending provider reconciliation after hold expiry, escrow/order balances, B6 independence, protected DB fingerprint.
8. **Release:** Update the phase log PASS/FAIL/BLOCKED only with actual test results; no production merge or release beforehand.

**Conclusion:** Several concrete bugs and a high-severity migration integration blocker were repaired at source level; **end-to-end functional completeness is not certified**.
