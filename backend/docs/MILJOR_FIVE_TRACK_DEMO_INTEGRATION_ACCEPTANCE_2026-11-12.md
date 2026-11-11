# MilJor — Five-Track Demo Integration, Regression and Safe Release Gate
Date: 2026-11-12
Source baseline: integration/demo-all-heads-acceptance-20261112 @ 947a1314c03313bbc79f0f8f0cdd7a42647fee30 (PR #23)
This change branch: fix/demo-partial-delivery-quantity-20261112

## Objective and order
**Do not merge / deploy / touch protected DB** until independently executed full acceptance. Reuse B4 Regular and B5 Flash authoritative stock/payment engines behind the unified pool UX; B6 contract remains supplier-specific award/order. Provider-issued Safepay evidence is separate from synthetic signed HMAC.

| Track | Existing implementation | This branch or pending action | Required PASS | Status |
|---|---|---|---|---|
| T1 E3 + migrations + stock | canonical migrations 046–054; test-only E3 and 2/10/50/100 stress workflows | run exact merged-head E3 test with isolated MySQL 8, historical upgrade and allocation audit | zero duplicate migration IDs, 4/13/25 family limits, no oversubscription, no protected writes | BLOCKED: CI jobs queued / no local MySQL access |
| T2 Frontend + buyer/supplier | Vite, shared pool UI, real Chromium auth/offline baseline | build and browse supplier SKU -> pool -> buyer reserve/hold -> checkout -> paid order -> postpurchase, separate tenant contexts | no runtime errors, correct role isolation, server UTC timers, checkout recovery | BLOCKED: full end-to-end browser test not executed |
| T3 B6 RFQ award -> paid supplier fulfillment | procurementAwardService.accept/reconcilePaidOrder; fulfillmentService paid-only supplier order list via LEFT JOIN pool | verify B6 multi-supplier award produces a separate paid order for each assigned supplier and visible fulfillment task | one award per key, paid-only, correct supplier and immutable SKU lines | IMPLEMENTED_SOURCE / runtime BLOCKED |
| T4 100/80/20 partial delivery -> dispute/refund | fulfillmentService discrepancy, disputeService and financialSettlementService hold/refund | **This branch:** exact quantity evidence (100,80,20), reject over-receipt and invalid decimals, prevent client metadata override; fail-closed B6 aggregate receipt/refund pending line-level contract | single-product shortage evidence and idempotency; no auto settlement, no refund without authorized workflow | PURE POLICY 13/13 PASS; DB/API E2E BLOCKED; B6 line-level still missing |
| T5 invoice + real Safepay | invoiceService reads immutable B6 award lines; server-side payment reconciliation services | test sum(order lines)=subtotal; per-supplier separate orders; fee and exact refund/conservation; provider-origin sandbox signature/amount/callback only after authorization | no wrong line item, no cross-tenant access, no fabricated provider success | source present, provider E2E BLOCKED |

## T4 precise implemented behavior
1. Buyer may report QUANTITY_MISMATCH on a *single-line* paid dispatched/supplier-delivered order. The exact decimal receipt policy requires an ordered quantity >0 and a received quantity >=0 and strictly less than ordered. Example: 100.00 ordered, 80.00 received, 20.00 short.
2. The service stores immutable event/outbox evidence with authoritative `ordered_quantity`/ `received_quantity`/ `short_quantity`. Client-supplied metadata cannot override these calculated fields. This is evidence, not an inventory or cash mutation.
3. Buyer quantity > ordered, invalid precision, exponent notation, negative or zero-shortfall claims fail closed.
4. Existing fulfillment transition to EXCEPTION and idempotent event remain unchanged; supplier-only DELIVERY is never buyer acceptance and does not itself release supplier funds.
5. B6 awarded multi-line orders need a dedicated **per-award-line** receipt ledger (line identifier, ordered/received/short in that line's purchasing unit), later dispute reference and exact item-level refund. Aggregate order.qty is ambiguous; the service returns 409 LINE_ITEM_RECEIPT_REQUIRED rather than fabricate short. Likewise B6 partial refund returns 409 LINE_ITEM_REFUND_ALLOCATION_REQUIRED instead of multiplying a mixed-SKU aggregate by order.unit_price.
6. The existing single-product partial refund service still requires a verified paid order, authenticated actor and established approval. This branch does **not** claim refund execution or exact dispute synchronization complete. The existing refund assessment must be additionally tested against captured payment, actual shortage evidence and idempotency before release.

## Tests executed in this assistant runtime
- Exact fetched GitHub `deliveryQuantityPolicy.js` executed in JS runtime with the committed 13 policy assertions: **13/13 PASS**, including 100/80/20, fractional amounts, 0 received, over-report, equality, invalid decimals, scientific notation, empty input, huge precision and immutability.
- Static JavaScript parser: **4/4 PASS** on changed policy/service/finance/test files.
- Cross-file source safeguards: **6/6 PASS** for exact-shortage evidence, B6 missing-line guards, metadata precedence, order row lock and manual refund restriction.
- Executed **4/4 mocked transaction service scenarios** against the actual fetched FulfillmentService: exact 100/80/20 EXCEPTION evidence and one committed event; over-receipt rollback with zero updates; B6 aggregate receipt fail-closed rollback; other-buyer 403 rollback. This is service-level logic verification using an in-memory SQL adapter, **not real MySQL**.
- **Not run:** MySQL, HTTP, actual Vite build, hosted Chromium, provider-issued Safepay callback. Never interpret static/pure PASS as full stack PASS.

## Next detailed acceptance implementation steps (uncompleted)
### A. Disposable DB isolation
1. Verify DB name = miljor_test_db via SELECT DATABASE() and test-only environment.
2. Install canonical migrations in clean MySQL 8 and audit checksums; then test upgrade from older journal with historical rows preserved.
3. Run E3 gate (entitlements), buyer discovery, same-SKU 2/10/50/100 client stress including cross-B4/B5 concurrent calls.
4. Confirm transaction rollback, stock allocated+available <= physical stock, supplier ownership, lifecycle expiry, no protected DB connection.

### B. Buyer/supplier browser journey
1. Build frontend, start Express and Vite on test-only MySQL with mock external money movement.
2. Supplier verified login, SKU publish, unified pool draft/publish, buyer discovery + reservation/hold, payment hold countdown, exact fees, retry with same key.
3. Real provider payments are **not** simulated as verified funds. In isolated mock tests label synthetic state clearly.
4. Supplier paid order queue, dispatch, delivered claim, buyer confirm or dispute; order reload and tenant separation.

### C. B6 award->fulfillment
1. Seed two suppliers, two products, one buyer, independent quotes and accepted award with known line snapshots.
2. Verify each supplier has its own order and that paid status alone controls fulfillment queue; no parent pool required (LEFT JOIN).
3. Ensure awarded-order allocations move COMMITTED once on verified paid callback; replay is idempotent; supplier cannot fetch other's order.
4. Check invoices itemize all exact award lines; verify sum of lines equals order subtotal and supplier/fee delivery charges.

### D. Partial delivery and resolution
1. Single-line 100kg order, supplier claims delivery, buyer reports 80kg; assert event outbox `short_quantity=20.00`, order EXCEPTION, receipt confirmation prevented while dispute unresolved.
2. Open dispute linked to order and evidence. Verify exact outstanding liability and financial hold; buyer must not trigger arbitrary refund while unrelated dispute or unverified payment.
3. Resolve via remaining-20kg delivery or exact authorized 20kg refund; verify accounting and no negative stock/double payout.
4. For B6 multi-line implement additive per-line receipts/shortage/refund schema on a NEW migration number only after history audit and approved policies, then itemized 100/80/20 contract. Until then remain fail-closed.

### E. Safepay + final release
1. Get actual provider-issued signed webhook in authorized sandbox with HTTPS callback and reconciliation readback.
2. Verify exact amount, currency, tracker, ownership, replay, invalid signature rejection, delayed/reordered callback, ledger and escrow conservation.
3. Never claim real payout/refund unless provider result and reconciliation prove it.
4. Re-run all modules on the proposed exact integration head; merge only when PASS gates signed off and main HEAD unchanged.

## Git/local handoff
Treat PR #23 as demo candidate, this branch as a focused child PR (no blind merging). Do not overwrite another agent's work. On user's machine, make a clean worktree and secure DB backup outside repository, then fetch chosen accepted branch after tests. No live DB or local files were accessed by this assistant.
