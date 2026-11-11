# MilJor — UCP-3/4/5 Combined Source Implementation & Deferred Acceptance

**Repository:** umarjameel12/miljor-b2b-marketplace  
**Implementation branch:** feature/ucp-3-5-integrated  
**Parent:** feature/ucp-unified-supplier-pools (UCP-1/2) → feature/b4-regular-dual-timers (B4 dual clocks) → fix/b6-backend-hardening  
**Status:** Implementation source committed. **NOT production ready; NO database, browser, Safepay, or full regression execution.**  
**Isolation:** B6 buyer-created RFQ, collective buyer procurement and recurring schedules remain independent.

## 1. Completed source changes — UCP-3: delivery and shared stock
- Supplier-only `GET /api/v1/supplier/pools/stock?listing_id=`: tenant-bound listing ownership; exact 4-decimal quantities; derive listed, PENDING+COMMITTED ledger allocations, available unallocated SKU stock. Reject unapproved/legacy/inactive listing and mixed units; no new mutable inventory table. Price/stock allocation still rechecked and locked during B4/B5 publish.
- Supplier-only `GET /api/v1/supplier/pools/fulfillment`: read existing G1/G2 Lahore clusters, standard delivery rates, enabled pickup points and supplier configuration. No fabricated free delivery, global coverage or kilometers. Exposes only eligible standard clusters when standard mode enabled.
- Supplier Create Pool fetches these read models; displays provisional free stock, configured cluster fees, pickup availability. Regular DRAFT save then authoritative `PUT /api/v1/pools/:id/clusters`; published terms/clusters immutable. On partial save failure preserve draft ID and require safe edit, never duplicate silently.
- Flash remains on B5's fixed quoted delivery_fee / DOORSTEP purchase contract. Regular G2 cluster fees **must not** be treated as Flash fees until a separate B5-specific backend contract exists. No B6 delivery job/purchase behavior change.

## 2. Completed source changes — UCP-4: buyer purchase discovery and commitment
- `/pools`: All/Regular/Flash buyer board. Separate B4 `GET /api/v1/pools` and B5 `GET /api/v1/flash-pools`; actual supplier SKU titles and listed prices; authoritative deadline/timer; independent inventory/quantity progress. Dynamic approved category selector (8 categories, 25 family taxonomy) instead of legacy 5-name list.
- B4 buyer discovery fail-closed: verified supplier + profile, ACTIVE exact listing, PUBLISHED supplier product/physical SKU/specification and approved category/family. Historical legacy rows remain in DB, but don't enter live commercial discovery.
- Regular 'Join Pool' calls `POST /reservations` using buyer consent and idempotency, no automatic checkout; B4 individual decision/order workflow surfaced in Orders: final offer, ACCEPT/DECLINE with controlled reason, order-readiness, explicit order creation, then existing Safepay payment deadline.
- Flash buyer card: real remaining stock, WHOLE_LOT vs MULTI_BUYER quantities, verified supplier normal listing price vs discounted unit price, truthful clearance reason/best-before, explicit delivery address, POST `/flash-pools/:id/hold`, separate payment hold deadline, second explicit action POST `/orders/:id/checkout`. Never call payment provider at stock selection without user action.
- Buyer-only `GET /api/v1/flash-pools/holds/mine` provides safe B5 checkout recovery even after page refresh; Orders page displays B4 orders, B4 reservations and B5 holds separately. No B6 awards or collective groups on this buyer pool board.
- Cluster filter applies to Regular via G2. Flash fixed-fee offers are explicitly NOT cluster-qualified; UI labels that limitation and filters Flash only using its supported category/standard display contract. No false doorstep guarantee.
- Expiry clocks in UI never authorize payment, cancel holds or release inventory. Existing B4 15-minute order hold and B5 15-minute purchase hold remain distinct.

## 3. Completed source changes — UCP-5: supplier paid performance and action center
- Supplier-only `GET /api/v1/supplier/pools/analytics`. Tenant-filtered `pools`, `flash_pools`, `orders`, `reservations`, `flash_purchase_holds`.
- Regular/Flash number of verified PAID orders, paid merchandise subtotal and paid quantity; Regular active reservation count/quantity; Flash open and provider-pending hold count; per-pool verified money/quantity. All amounts derived from orders with `payment_status='PAID'`, not estimated conversion or fake full-pool sales.
- Action alerts derived from existing persisted pool lifecycle (draft, deadline within 24h, overdue expiration processing, Flash low remaining stock, Regular target reached). Includes source label `AUTHORITATIVE_POOL_READ_MODEL`. They are **read-only in-app signals**; no claim of email/SMS sent or background job scheduling.
- Supplier dashboard shows real computed data. Does not display other buyers' private contact information or B6 transaction history.

## 4. Additive API contracts
| API | Role | Behavior |
|---|---|---|
| GET /supplier/pools/stock?listing_id=N | SUPPLIER | Own listed / reserved allocations / free inventory, exact unit |
| GET /supplier/pools/fulfillment | SUPPLIER | Existing G2 rates, pickup and approved clusters |
| GET /supplier/pools/analytics | SUPPLIER | Own B4/B5 PAID performance and read-only alerts |
| GET /flash-pools/holds/mine | BUYER | Own Flash hold+order payment status recovery |
| GET /pools | Public | Existing B4, with hardened supplier+SKU+family discovery |
| GET /flash-pools | Public | Existing B5, canonical category filtering |
| POST /reservations | BUYER | Existing B4 reservation guarded by idempotency |
| POST /reservations/:id/final-decision | BUYER | Existing B4 buyer commercial decision |
| POST /reservations/:id/order | BUYER | Existing B4 commitment-to-order conversion |
| POST /flash-pools/:id/hold | BUYER | Existing B5 ready-stock hold |
| POST /orders/:id/checkout | BUYER | Existing Safepay checkout |

## 5. Execution matrix for FINAL TESTING ONLY — none run yet

### Infrastructure/data
- Backup and restore rehearsal; fingerprint `miljor_db` protected data before/after.
- Worktree DB role NODE_ENV=test, `miljor_test_db` only. Verify migrations 001–latest, InnoDB, foreign keys, finance schema, exact decimal and UTC. Do not run `runMigrations` against protected database.
- **Concurrent migration collision BLOCKER:** separate B6 Phase2 branches contain `046_recurring_collective_cycles.sql`, `047_procurement_delivery_runs.sql`, `048_procurement_notification_outbox.sql`; this UCP lineage contains `046_expand_canonical_product_families.sql`, `047_demand_requester_role.sql`, and `048_regular_pool_payment_hold_deadlines.sql`. Release integration MUST assign a collision-free migration order, reconcile dependent table/column assumptions, check runner's migration ledger/hash journal and test fresh + upgrade schemas BEFORE any merge. Do not automatically overwrite other chats' migrations.
- Validate protected DB remains unmodified; never merge draft PR directly while collision unresolved.

### UCP-3 acceptance
- Valid supplier listing; no access to foreign listing/stock; suspended supplier; inactive SKU; unit mismatch; ledger OVERALLOCATED; 0 stock; concurrent Flash+Regular publishing without double stock allocation.
- Enable/disable standard delivery; rates eligibility; all 12 Lahori clusters; pickup allowed only when configured; no out-of-Lahore cluster; draft cluster edit; published terms immutable; staged save recovery; supplier cancellation with outstanding holds refused.
- Flash delivery fee only B5 supplier-approved fixed fee; no false quote.

### UCP-4 acceptance
- Canonical 8 categories / 25 families, actual physical supplier specs; legacy variants hidden from live discovery; disabled/unverified supplier hidden.
- Both mode filters, catalog search, cluster/pickup visibility, no fabricated Flash service area.
- B4 buyer join min/increment/capacity/idempotency/quorum; rejected expired/non-published offers; seller decision and buyer explicit accept/decline; mandatory reason codes; order readiness/amount lock; B4 payment hold 15m.
- B5 WHOLE_LOT and MULTI_BUYER, fractional pack rejection, full/partial stock, direct address, discount evidence, expired/best-before constraints, 15m stock hold, multiple concurrent buyer holds, verified provider payment, safe retries/callback reconciliation. Browser reload recovers holds.
- Buyer/supplier/admin tenancy separation and CSRF/auth protections; no buyer contacts in public data; strict API HTTP errors.
- Responsive desktop/mobile accessibility, loading/empty/error/refetch, Vite build and browser E2E.

### UCP-5 acceptance
- Exact SQL totals in PKR, no float money transitions, paid-only proof, no orders from B6, per-pool grouping, no unauthorized supplier cross-tenant reads. Unpaid Flash holds excluded from paid revenue.
- Alerts at deadline -1 second, exact deadline, after expiry; statuses DRAFT, ACTIVE, CLOSED; no erroneous stock/payment mutation.
- Verify in-app alerts aren't represented as SMS/email; integration to actual notification outbox must be specified/gated separately if outbound delivery is desired.

### Final exit
- Run deferred `node backend/tests/ucp_3_5_source_contract_gate.js` from repo root (or `cd backend && node tests/ucp_3_5_source_contract_gate.js`) alongside existing B4/B5/B6 suites; then MySQL, APIs, concurrency, Safepay provider, frontend build, end-to-end and protected DB checks.
- **Not COMPLETE AND VERIFIED until every applicable gate has real execution evidence.**
- Preserve all branch protection and draft PR status until resolution, no production or cross-chat merges.

## 6. Operational notes and truthful limitations
- UCP-3 stock is a snapshot, not a purchase guarantee; B4/B5 publication transaction remains source of truth.
- UCP-4 buyer B4 decision and order paths are existing engines; their transactional correctness requires final DB tests.
- UCP-5 alerts are operational dashboard signals; no external notification adapter is added in this source phase.
- No production database migration, Safepay transaction, build, server, E2E or regression has been executed in this GitHub-only workflow.
- Existing package E2 legacy pool screens remain source-compatible but all new supplier creation navigation targets unified page. Deleting legacy components requires final UI acceptance.

**Release status: SOURCE COMMITTED / DRAFT / FINAL GATE BLOCKED.**
