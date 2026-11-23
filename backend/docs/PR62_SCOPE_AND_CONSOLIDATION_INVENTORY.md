# MilJor PR #54 + PR #61 Consolidation Inventory & PR #62 Scope

**Integration Branch:** `integration/pr54-pr61-consolidation`  
**Starting Consolidation SHA:** `a6df2446f4c8ffe48bb688ff681cdc5f7135ec8b`  
**PR #54 Baseline Merged (`plan/ucp-resilience-notification-coverage`):** `d73e4da27125eafb24d164bf55226655a0d2b8fd`  
**Main (`origin/main`, includes PR #53):** `9e7a6d3c4fa3d6b0d4f27e9e9993599bfcd48a97`  
**PR #61 Source (`feature/pr60-canonical-release-hardening`):** `b778d2730cf2f6e6353e397620816b9c16c143cf`

---

## 1. Module Boundaries Preserved

- **Smart Procurement Hub (`/procurement`):** Preserves PR #53 RFQ, Collective Quotes / Buying, Recurring procurement, supplier quotations, product-wise numeric counteroffers, accept/reject/counter-again workflow, grouped delivery, and notifications. No chat-based counteroffer system.
- **UCP (`/pools`, `/pools?type=FLASH`):** Preserves PR #54 single-page UCP architecture with Regular and Flash categories/subcategories, pool participation, deadlines, recovery, supplier replacement/recontracting, delivery reliability, and `ucpNotificationEventCatalog`.

---

## 2. Migration Reconciliation Summary

| Version | Filename | Source | Disposition | Reason |
| :--- | :--- | :--- | :--- | :--- |
| `001`–`055`, `090`–`095`, `102`–`106` | Canonical main / Smart Hub migrations | `main` / PR #54 | **Preserved** | Already-applied canonical history; checksums untouched. |
| `096`–`101` | UCP recovery, notification controls, phase C delivery, supplier replacement | PR #54 | **Preserved** | Canonical UCP schema; checksums untouched. |
| `107` | `107_collective_payment_hold_deadlines.sql` | PR #61 (adapted to `collective_payment_holds`) | **Imported (Forward-Only)** | Adds bounded 15-min per-buyer collective payment leases linked to `orders`, `procurement_collective_groups`, `procurement_collective_commitments`, `users`. |
| `108` | `108_safepay_v3_payment_contract.sql` | PR #61 `104_safepay_v3_payment_contract.sql` | **Imported & Renumbered** | PR #54 already uses `104` (`104_individual_procurement_delivery_pricing.sql`). Renumbered forward-only to `108` to pin `provider_contract` on `payment_attempts`. |
| `090`–`103` (PR #61 branch) | Smart Hub / UCP / Collective duplicates | PR #61 | **Excluded** | Superseded by PR #53 (`main`) and PR #54 canonical migrations `090`–`106`. |
| `061`, `062`, `105`, `106` | Supplier subscription scheduled changes & Safepay v3 subscription checkout | PR #61 | **Deferred to PR #62** | Independent subscription billing track; requires renumbering above `108` and dedicated subscription E2E acceptance. |
| `098`–`100` (PR #61 branch) | Supplier verification revisions, replay hash, documents | PR #61 | **Deferred to PR #62** | Conflicts with UCP `098`–`100`; independent supplier verification enhancement. |

---

## 3. Selective PR #61 Integration vs Exclusions

### Imported into `integration/pr54-pr61-consolidation`
1. `backend/database/migrations/107_collective_payment_hold_deadlines.sql` + `backend/src/services/collectivePaymentHoldService.js`: Bounded 15-min collective payment leases, `INITIATED`/`RECONCILIATION_REQUIRED` guard, wired into `procurementAwardService.js`, `safepayCheckoutService.js`, and `schedulerService.js`, plus pure/DB **Hybrid Collective Payment-Failure Policy** (`evaluateHybridGroupOutcome`).
2. `backend/database/migrations/108_safepay_v3_payment_contract.sql` + `backend/src/services/safepayV3ContractService.js` + `backend/src/services/safepayV3SandboxClient.js`: Precision-safe PKR minor-unit contract and read-only sandbox tracker/reporter validation, wired into `safepayCheckoutService.js`.
3. `backend/src/services/safepayRefundReadinessService.js` + `GET /api/v1/settlements/refunds/:id/provider-readiness` in `financialSettlementController.js` / `financialSettlementRoutes.js`: Read-only admin refund readiness assessment (`external_execution_status: DISABLED`).
4. `backend/src/services/notificationEventPolicy.js`: Merged PR #61 `REFUND_ASSESSED`, `REFUND_APPROVED`, `DISPUTE_RESPONSE_RECEIVED`, `SUBSCRIPTION_*`, `VERIFICATION_*` into PR #54's `ucpNotificationEventCatalog`-backed policy.
5. Consolidated `schedulerService.js`: Added `collectivePaymentHoldService.processExpiredBatch(100)` alongside all PR #54 UCP, collective commitment, recurring, and notification workers.

---

## 4. Recommended PR #62 Scope (Independent Follow-Up — Not Created Yet)

1. **Supplier Subscription Safepay v3 & Period-End Downgrade:**
   - Renumber PR #61 `061`, `062`, `105`, `106` forward-only (`109+`).
   - Port `supplierSubscriptionCheckoutService.js`, `subscriptionController.js` / `subscriptionEntitlementService.js` scheduled downgrade worker (`processScheduledStarterChanges`), and `SupplierSubscriptionPage.jsx` updates.
2. **Supplier Verification Revisions & Document Malware Scanning:**
   - Renumber PR #61 `098`–`100` forward-only (`113+`).
   - Port `documentMalwareScanService.js`, `supplierVerificationDocumentService.js`, `SupplierVerificationCorrections.jsx`, `SupplierVerificationDocuments.jsx`, and `AdminVerificationPage.jsx` / `supplierProfileController.js` extensions.
3. **Independent Admin & Supplier Portal Pages:**
   - `frontend/src/pages/AdminFinancePage.jsx` (read-only provider-readiness UI).
   - `frontend/src/pages/SupplierAnalyticsPage.jsx`, `SupplierOpportunitiesPage.jsx`, `SupplierDeliveryPage.jsx`, `SupplierDisputesPage.jsx`, `SupplierSettlementsPage.jsx`, and `supplierDashboardService.js` / `supplierOperationsService.js`.
4. **Dependencies & Blockers:**
   - Requires PR #54 / consolidation branch merge first so forward-only migration numbering starts cleanly at `109+`.
   - External Safepay live webhook/refund execution remains `DISABLED` (`ALLOW_EXTERNAL_MONEY_MOVEMENT=false`).
