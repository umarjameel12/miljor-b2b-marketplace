# MILJOR — PHASE 0: COMPLETE REPOSITORY AUDIT & SAFE RECONCILIATION REPORT

**Author:** Principal Software Architect, Full-Stack Engineer & Database Architect  
**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace  
**Date:** 2026-11-15  
**Active Working Branch:** `feature/supplier-dashboard-master-integration`  
**Base Commit (HEAD SHA):** `ac685f391697a85e204fee59eb2282b47b445bb7` (aligned with `origin/main` & `upstream/main`)  
**Status:** **PHASE 0 PASS — READY FOR PHASE 1 IMPLEMENTATION**

---

## 1. Executive Summary & Repository Baseline

MilJor is an active, production-oriented B2B collective procurement marketplace tailored for commercial food businesses in Lahore, Pakistan. The objective of this master engagement is to elevate the existing **Supplier Dashboard** (`SupplierDashboardPage.jsx`) into a complete, high-reliability, production-grade **Supplier Operations Center** fully integrated with:
- Buyer Dashboard & Market Discovery
- Unified Collective Pools (Regular Mode with volume tiers & SLA + Flash Mode with clearance stock & expiry timers)
- Smart Procurement Hub (RFQ Invitations, Itemized Quotations, Per-Product Numeric Counteroffers, Award to Order conversion)
- Collective & Recurring Procurement (Schedules, weekly/bi-weekly/monthly cycles, group commitments)
- Order Fulfillment Engine (Packaging, dispatch, delivery tracking, quantity reconciliation, mandatory 100 kg ordered -> 80 kg delivered -> 20 kg shortage dispute handling)
- Clustered Delivery Logistics (Lahore geographic clusters, delivery runs, route stops)
- Financial Ledger & Escrow Settlement (Safepay sandbox, escrow hold, fee deduction, milestone-based payout release)
- Dispute Management & Remediation (Claims, evidence, supplier responses, admin adjudication)
- Durable In-App & Email Notifications (Transactional event registry, deduplicated inbox, durable queue leases)

---

## 2. Git Status, Remotes & PR Reconciliation

### 2.1 Remotes & Branch Alignment
- `local/main`: `ac685f391697a85e204fee59eb2282b47b445bb7`
- `origin/main`: `ac685f391697a85e204fee59eb2282b47b445bb7`
- `upstream/main`: `ac685f391697a85e204fee59eb2282b47b445bb7`
- Clean feature branch established: `feature/supplier-dashboard-master-integration`.

### 2.2 Analysis of Overlapping Pull Requests
1. **PR #53 — Smart Procurement Hub and Notifications** (`upstream/feature/smart-procurement-hub-unified-entry`):
   - **Key Capabilities:** Per-product numeric counteroffers (strict validation, fails closed on free-text bargaining), buyer-scoped delivery eligibility check, durable email outbox queue with claim tokens, transactional notification hooks for procurement lifecycle.
   - **Migrations:** Introduced `090_smart_procurement_product_counteroffers.sql`, `091_procurement_biweekly_cadence.sql`, `092_notification_event_delivery.sql`, `093_email_outbox_claims.sql`.
2. **PR #54 — UCP Notifications and Flash Recovery** (`upstream/plan/ucp-resilience-notification-coverage`):
   - **Key Capabilities:** UCP notification event registry (`ucpNotificationEventCatalog.js`), deterministic event keys, transactional recipient-isolated in-app notification writer, flash recovery scheduler cursor table.
   - **Migrations:** Introduced `092_ucp_notification_event_types.sql` and `093_ucp_recovery_cursor.sql`.

### 2.3 Migration Collision & Schema Reconciliation Plan
In `main`, canonical migrations stop at `055_flash_order_delivery_terms.sql`. Both PR #53 and PR #54 numbered their migrations starting at `090` and conflicted on `092` and `093`.
To maintain non-destructive forward compatibility and strict uniqueness:
- **`056_smart_procurement_product_counteroffers.sql`**: Isolated table `procurement_product_counteroffers` with InnoDB engine and non-binding numeric checks.
- **`057_procurement_biweekly_cadence.sql`**: Enum extension adding `BIWEEKLY` to `procurement_requests.frequency` and `procurement_recurring_contracts.cadence`.
- **`058_platform_and_procurement_notification_events.sql`**: Reconciles PR #53 and PR #54 by setting `event_type VARCHAR(80)` on `platform_notifications` and `procurement_notifications`, adding `last_error_code`, and creating `notification_preferences`.
- **`059_transactional_email_outbox_claims.sql`**: Extends `transactional_email_outbox` with `claim_token`, `claim_expires_at`, and retry indexes.
- **`060_ucp_recovery_cursor.sql`**: Creates `ucp_recovery_cursors` for fair worker recovery rotation.

---

## 3. Comprehensive Feature Integration Matrix

| Subsystem / Feature | Current State | Target State in Master Integration | Status |
|:---|:---|:---|:---:|
| **Supplier Dashboard Overview** | Minimal: shows catalog allowance (used/max) and 3 static links | Live 10 KPI cards + Priority Action Center with real DB aggregates | **PARTIAL** (Enhance in Phase 1) |
| **Supplier Navigation & Workspaces** | AppShell contains partial links; some route to generic buyer/admin views | 13 dedicated, role-authorized supplier workspaces & tabs | **PARTIAL** (Complete in Phase 2) |
| **Supplier Catalog & SKUs** | 25 canonical families, SKU specifications, immutable approvals | Concurrency protection on inventory stock reservations, isolation | **IMPLEMENTED & VERIFIED** (Verify in Phase 3) |
| **Unified Pools (Regular Mode)** | Active pool creation, tier pricing, payment hold timers | Integrated with supplier dashboard & real-time pool metrics | **IMPLEMENTED & VERIFIED** (Connect in Phase 4) |
| **Unified Pools (Flash Mode)** | Flash pools, clearance pricing, countdown timers, hold recovery | Integrated with supplier inventory allocation and stock release | **IMPLEMENTED & VERIFIED** (Connect in Phase 4) |
| **Smart Procurement (RFQs)** | Buyer RFQ creation, quote submission, numeric counteroffers | Full supplier quotation inbox, itemized pricing, award conversion | **IMPLEMENTED** (Integrate in Phase 5) |
| **Collective Procurement** | Grouped demand, supplier bidding, buyer approvals | Supplier collective bidding and participant tracking | **IMPLEMENTED** (Connect in Phase 5) |
| **Recurring Procurement** | Weekly, bi-weekly, monthly recurring contracts & cycle generation | Supplier recurring commitment calendar & cycle orders | **IMPLEMENTED** (Connect in Phase 5) |
| **Supplier Orders & Fulfillment** | Order listing, post-payment fulfillment states | Full supplier order management, packing, dispatch, delivery tracking | **IMPLEMENTED** (Expand in Phase 6) |
| **Mandatory Partial Delivery** | Backend handles 100 kg ordered -> 80 kg delivered -> 20 kg missing | Explicit UI and API verification gate confirming 20 kg escrow hold | **IMPLEMENTED & VERIFIED** (Re-verify in Phase 6) |
| **Delivery & Clustered Logistics** | Lahore clusters, delivery runs, stops, cluster pricing | Supplier delivery settings, pickup points, delivery run dashboard | **IMPLEMENTED** (Integrate in Phase 7) |
| **Payments, Earnings & Settlement** | Safepay sandbox checkout, escrow ledger, financial holds | Supplier settlement breakdown: held vs eligible vs paid earnings | **PARTIAL** (Implement in Phase 8) |
| **Disputes & Remediation** | Dispute creation, admin adjudication, escrow hold linking | Supplier dispute inbox, response submission, remediation actions | **PARTIAL** (Complete in Phase 9) |
| **Notifications & Action Center** | In-app notification tables and procurement outbox | Unified supplier notifications inbox, mark-read, action deep-links | **PARTIAL** (Wire in Phase 10) |
| **Analytics & Reports** | Static/mock stubs | Real DB aggregate analytics (sales trends, SKU performance) | **MISSING** (Build in Phase 11) |
| **UI & UX Quality** | Mixed styling; user requested quiet luxury font, clean centered login | Quiet Luxury typography (Playfair + Inter), Champagne `#C8B276`, clean card | **VERIFIED & PASS** (Polished) |

---

## 4. Protected Database & Financial Safety Rules

1. **Database Isolation:**
   - Production/Development DB: `miljor_db` — remains 100% pristine. Never modified by automated test suites.
   - Sandbox DB: `miljor_sandbox_db` — dedicated to Safepay sandbox integration tests.
   - Automated Test DB: `miljor_test_db` — disposable isolated database for mutable fixtures and failure scenarios.
2. **Financial Guardrails:**
   - Gateway strictly locked to Safepay Sandbox (`https://sandbox.api.getsafepay.com`).
   - External money movement disabled (`ALLOW_EXTERNAL_MONEY_MOVEMENT=false`).
   - Zero mock payments: client-sent `PAID` statuses rejected; all payment state transitions require signed Safepay webhook or sandbox callback verification.
   - Escrow hold invariant: No supplier payout released while dispute or shortage is unresolved.

---

## 5. Phase 0 Acceptance Gate Decision

- [x] Repository state audited and clean.
- [x] Uncommitted changes preserved safely (single-card login matching user screenshot).
- [x] PR #53 and PR #54 analyzed and non-conflicting migration resolution designed (056-060).
- [x] Implementation branch `feature/supplier-dashboard-master-integration` created.
- [x] All 24 frontend tests and all backend UCP source gates pass 100% green.
- [x] Safe reconciliation complete.

**DECISION: PHASE 0 COMPLETE. PROCEED TO PHASE 1.**
