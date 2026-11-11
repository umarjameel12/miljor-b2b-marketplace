# MilJor — Remaining secondary reconciliation: partial tested-scope handoff (2026-11-12)

## Canonical baseline
- Parent `main` at `a8fb3321fa026e77d7b3a8325f4d9aae7fe0a109` (UCP PR #13 merged; 3/3 acceptance PASS on its own integration SHA).
- Branch `integration/remaining-ucp-b7-finance-demo-20261112` is isolated. It MUST NOT silently merge into main before this branch's own green tests.
- Existing business contract: Lahore B2B, immutable supplier-specific physical SKU, single buyer/supplier Pool marketplace, server-authoritative payment/stock, no external money movement.
- Protected `miljor_db` and `miljor_sandbox_db` untouched. No local MySQL reads/writes, no external Safepay traffic.

## Integration deltas implemented (candidate, awaiting current-head CI)
1. `frontend/src/pages/PoolsPage.jsx`: one public buyer marketplace and all-pool discovery; no separate Flash/Regular public filter tabs. Legacy `?type=FLASH` query is ignored to prevent separate workflows.
2. `frontend/src/pages/FlashPoolsPage.jsx`: legacy `/flash-pools` deep link redirects to `/pools`.
3. `frontend/src/components/pools/BuyerPoolCard.jsx`, `frontend/src/pages/SupplierPoolsPage.jsx`, `frontend/src/pages/OrdersPage.jsx`, `frontend/src/components/pools/FlashBuyerOrdersPanel.jsx`, `frontend/src/components/supplier/SupplierPoolOperationsPanel.jsx`, and `frontend/src/pages/SupplierDashboardPage.jsx`: unified pool card, orders, supplier insights and create-pool workspace terminology. Actual backend B4 volume-tier offer/commitment and B5 verified ready-stock 15-minute hold remain separate authoritative engines, not misrepresented as a single financial transaction model.
4. `backend/src/services/financialConservationService.js`: finance-scoped, read-only consistent order ledger snapshot imported selectively from the isolated F4 branch. Checks exact PKR order components, immutable supplier commission, captured-payment count, refund ceiling, supplier entitlement and external payout flag. `GET /api/v1/settlements/admin/orders/:id/integrity` routed with finance-admin-only authorization.
5. `backend/src/services/financialSettlementService.js`: deliberately blocks admin-entered confirmed refund and settlement batch reconciliation without genuine provider evidence. Finance roles see `PROVIDER_REFUND_VERIFICATION_REQUIRED` or `PROVIDER_SETTLEMENT_EVIDENCE_REQUIRED`; support/operations denied. No payout enabled.
6. `backend/tests/b7_postpurchase_readonly_contract_gate.js`: 12 source boundary assertions imported selectively from isolated B7 branch; source existence inventory only, explicitly NOT delivery E2E.
7. `backend/tests/p0_unified_pool_ui_source_gate.js` and `backend/tests/p0_finance_readonly_integrity_gate.js`: new source/runtime-vm negative tests; existing CI workflow now runs them on this branch.
  
## Cross-branch classification (no blind merge)
- `feature/unified-pool-only-workflow`: 3 older frontend files changed, behavior selectively incorporated without overwriting current network idempotency/role fixes.
- `feature/b6-nq-complete-reconciliation`: 7 additional services, 10+ tests, advanced RFQ frontend and controller/routes edits **not yet in main**. Separate schema/API reconciliation and full branch tests required; do NOT copy legacy 046–048 migration files over canonical journal. B6 N–Q is not certified complete on main.
- `feature/b7-postpurchase-acceptance-isolated`: gap-map and read-only test only; real partial delivery 100kg→80kg, supplier fulfillment, multi-item invoice, escrow/dispute and buyer confirmation browser/MySQL E2E remain **BLOCKED/UNRUN**.
- `fix/p0-financial-f1-f5-closure-isolated`: selective F4 read-only audit and F2 admin-entry fail-closed corrections integrated. Other refund/payout/ledger methods diverge with main and have only isolated fake-DB tests; full source wholesale merge prohibited until real MySQL callback concurrency and financial conservation.
- `fix/p0-safepay-refund-evidence-isolated`: real provider-signed refund callback schema/amount-unit and live provider-origin evidence remain **BLOCKED**; do not declare refunded funds from a synthetic HMAC.
- Concurrent PR #17 buyer discovery and PR #16 E3 catalog corrections are external owners. Overlapping writes avoided.
  
## Acceptance gate
- CI workflow: `.github/workflows/ucp-canonical-acceptance.yml` on this branch. Tests: source/production Vite, `p0_unified_pool_ui_source_gate.js`, `b7_postpurchase_readonly_contract_gate.js`, `p0_finance_readonly_integrity_gate.js`, disposable MySQL 8.0 historic upgrade/stock stress/B6, actual Chromium.
- **As authored:** latest workflow currently QUEUED on GitHub; no PASS has been observed for this branch. If CI FAIL, fix root cause in isolated branch and reverify. Do not merge main before PASS.
- Full unified domain-engine replacement, genuine Safepay sandbox refunds/payouts, B7 browser purchase-through-settlement and B6 N–Q are *not* covered by existing CI. All remain separate release blockers.

**Phase gate: PARTIAL IMPLEMENTATION; CI PENDING; MAIN MERGE BLOCKED.**