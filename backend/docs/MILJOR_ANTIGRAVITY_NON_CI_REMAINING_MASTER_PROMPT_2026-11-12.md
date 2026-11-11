# MILJOR — ANTIGRAVITY MASTER EXECUTION PROMPT
## Remaining NON-CI Implementation, Integration and Business Acceptance
**Version:** 2026-11-12 | **Owner:** MilJor | **Execution mode:** sequential, evidence-led, safe Git commits and draft PRs  
**Repository:** `umarjameel12/miljor-b2b-marketplace`  
**THIS FILE IS AN EXECUTION INSTRUCTION, NOT EVIDENCE THAT ITS TASKS ARE COMPLETE.**

> **Launch instruction for Antigravity:** Read this document in full, scan repository and current open PRs, and implement the remaining NON-CI MilJor functionality phase by phase. Do the actual code, schema, backend, API, frontend, role permissions, integration, database tests and business-workflow verification where safe and possible. Do not stop after writing a plan. Never pretend an unexecuted test passed. Keep a phase log and safe, traceable commits. **CI pipeline/runner/Chromium CI repairs are being handled elsewhere: excluded from this execution.**

---

# 0. HARD SCOPE BOUNDARY / NON-NEGOTIABLE RULES

## 0.1 Work that must NOT be duplicated
This assignment EXCLUDES the following already-running **CI-focused repair/acceptance** track:
1. GitHub Actions workflow/runner configuration, triggers, mail notification suppression, lint and build CI failures, CI job scripts, hosted Chromium CI setup and flaky offline auth CI gate.
2. PR #11 single-flight refresh and publication `409 POOL_PUBLICATION_RETRYABLE_CONFLICT` CI fixes, browser offline recovery acceptance work.
3. PR #10's existing CI workflow wiring, automated 2/10/50/100 simultaneous publication stress gate and historical-migration CI gate. Do not take ownership of these gates or rewrite them.
4. PR #9 source/build, disposable MySQL, migration journal and finance compatibility **CI automation**.
5. Existing real Safepay provider-issued callback **CI/sandbox certification track**: it must remain a separate release gate; you MAY implement missing application payment/refund business logic in this assignment but must not fabricate genuine provider callbacks or mark provider certification passed.
6. No automatic merge or rebase of PR #2–#11; no re-numbering or editing canonical migration 046–054 without independent audit and written justification.

**Important distinction:** NON-CI functional tests, isolated MySQL/API integration, business acceptance fixtures and source-level checks that validate the code you implement ARE in scope. Only the separate CI repair and CI pipeline work is excluded. If an activity depends on a CI gate, mark `BLOCKED_EXTERNAL_CI` and continue with independent work. Never remove/skip security checks to manufacture success.

## 0.2 Read-only discovery before any mutation
- Print current branch, clean/dirty Git state, remote, HEAD SHA, open PR references, migration inventory, existing phase logs, backend/frontend package scripts and MySQL configuration.
- Inspect `AGENTS.md` and project skills already installed; follow applicable instructions where consistent with these constraints.
- Inspect key work from PR #2–#11, especially PR #6/#8/#9/#10/#11; do not blindly assume features are absent or present.
- Read existing documents under `backend/docs/`, source controllers/services/routes, frontend route tree, tests and actual schema.
- Produce a **GAP MATRIX**: requirement -> existing source -> branch/PR -> conflict risk -> implementation step -> acceptance test -> owner (this work / external CI) -> status.
- Mark `ALREADY_IMPLEMENTED` only with source evidence and `VERIFIED` only after an actual test.
- Preserve branch boundaries. Choose an isolated feature branch based on the approved canonical integration baseline only after examining Git ancestry/diffs. The docs branch containing this prompt is NOT automatically the implementation base.
- If a concurrent chat updates a branch, re-fetch and compare HEAD before committing. Never force push, never overwrite colleagues' commits, never silently cherry-pick competing implementations.

## 0.3 Data and security policy
- **Never write to, drop, migrate, truncate, seed, or otherwise alter `miljor_db` or `miljor_sandbox_db`.**
- Local/test mutations permitted only on explicit isolated `miljor_test_db` (or disposable containers) with `NODE_ENV=test`, `MILJOR_TEST_ONLY_MIGRATIONS=1`, and `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`.
- Strict tenant isolation and least-privilege for Buyer, Supplier and Admin roles. Every record read and write needs authorization and scoped ownership.
- Use integer minor currency units or exact decimal arithmetic; no floating-point money aggregation; no hidden default finance commissions.
- Never directly change PAID, SETTLED, DELIVERED, DISPUTED, REFUNDED, or inventory ledger status without authorized state transitions, durable audit data and idempotency.
- No new live payment/notification/third-party service calls without sandbox authorization; no secrets in commits or logs. Do not put actual personal contact details or protected DB backups in repo.
- Schema changes must be additive, forward-only, unique migration IDs after auditing canonical history, guarded and tested. Historical contracts/invoices/specs are immutable snapshots.
- Do not claim production ready until all relevant external provider and CI gates pass.

## 0.4 Parallelism and speed without corruption
- Work **serially** for schema/payment/stock/order state machines; parallelize only non-overlapping discovery, UI, documentation and read-only test preparation.
- Prefer focused 1-3 file changes per commit, quick targeted tests, then cumulative integration tests. Batch independent read-only inspections and test queries; do not batch destructive operations.
- Automatically advance to the next implementation substep *after* its local PASS; if FAIL, fix and re-run. If BLOCKED by third-party credentials, report exact missing precondition and continue unaffected independent tasks. Keep a concise running progress summary.
- Do not ask for approval for routine code changes in a private feature branch. Require explicit approval for production/protected DB changes, real-money operations, deploying, or merging into main; those are disallowed by default.
- No uncontrolled repeated GitHub Actions reruns; do not edit CI triggers.

# 1. CANONICAL BUSINESS CONTRACT / LATEST DECISIONS

MilJor is a **Lahore-first, B2B food procurement marketplace** for small restaurants, caterers, kiryana shops/general stores, bakeries, with verified suppliers; consumer households are NOT part of initial buyer scope. Market benefit: group demand for wholesale-scale procurement with transparent tiers and fair delivery costs.

### 1.1 Pool UX vs financial engines
- An **integrated, single buyer/supplier pool experience** is desired: one supplier Pool Management/Create flow, one buyer Pool Marketplace/Orders flow, unified status/timers/filters/display and consistent operations.
- **Do not blindly merge or replace B4 Regular and B5 Flash authoritative stock/payment engines.** Existing PR descriptions explicitly keep these two distinct under shared UX. If latest owner-approved plan has since requested a true single domain model, first record exact product semantics and safe compatibility migration; this instruction cannot authorize destructive replacement without documented consensus. For now keep core accounting engines distinct behind one user experience.
- Regular: supplier MOQ, tier price ladders, buyer reservation, supplier offer/buyer final commercial decision and order conversion, independent pool expiry and **15-minute payment hold** from order creation where existing contract requires it, explicit Safepay checkout, escrow only after provider verification.
- Flash: clearance/whole-lot specifications, stock hold, explicit checkout, separate **hold/payment expiry** and pool expiry; timer must use authoritative server UTC, not invented local countdown.
- Buyer sees progress, tier prices, total payable breakdown, pool cutoff time, payment-hold cutoff, delivery/pickup and terms, actual state. Progress is not fabricated from unrelated reservations.
- Supplier sees own SKUs, published pools, liabilities, stock allocated/unallocated, buyer commitments; NEVER other suppliers' private data.
- Pool creation requested by either buyer or supplier only when role rules and workflow explicitly authorize it; buyer pool requests are demand signals rather than unauthorized supply-side publication.

### 1.2 Catalog / SKU latest rule
- **Latest supplier-specific catalog choice: Option B, physical specifications locked after publish.** Each supplier owns its physical SKU/listing/specifications; changes to brand, variety, grade, origin, pack size, physical quality attributes require a **new SKU/versioned identity** and moderation as appropriate. Price, available physical stock and permitted commercial terms may be edited with history, but NEVER retroactively alter existing pools/orders/invoices/spec snapshots.
- Historical 16 demo variants are NOT authoritative production catalog restrictions: PR #2 indicates a newer **25-family supplier-owned** catalog and removal of legacy hard-coded 16-staple UI. Inspect actual canonical schema and project decision before adding any family/variant; do not reintroduce retired fixed-catalog assumptions.
- Admin moderation for prohibited/fraudulent/unapproved listings and SKU ownership; never allow users to bypass approval by editing a published listing.

### 1.3 Procurement types and marketplace rules
- B4 Regular pooled orders; B5 Flash allocation/checkout; B6 RFQ / Personalized Quote, Recurring Procurement, Collective Quote are distinct contracting workflows. Reuse common UI primitives and payment/fulfillment contract only when proven compatible.
- RFQ: buyer specifications, multi-supplier bid comparisons, bid expiry/eligibility, buyer acceptance, award, exact contractual line item price and supplier identity, converted order; no duplicate award upon retries.
- Recurring: weekly/monthly schedule, cutoff and future occurrence generation, buyer pause/resume/cancel permissions, clear one-off versus collective pricing.
- Collective Quote: aggregate recurring demand within authorized compatible buyer/product/delivery windows; supplier quote and final acceptance without unauthorized mixing of products, buyers or prices.
- Supplier directly fulfills; platform coordinates delivery, tracking, disputes and money release; no unverified automatic settlement.

### 1.4 Pricing, revenue, payments and trust
- Transparent buyer processing fee plus supplier-declared per-buyer delivery; delivery clusters by Lahore service area; permitted pickup or optional fast delivery with explicit extra fee; out-of-area surcharge only if supplier-disclosed and validated. Never charge a fee not explicitly shown at confirmation.
- Supplier subscription/listing, transaction fee, verified badge, promotional visibility, ads need contractual entitlement, unique billing records and disclosure; do not invent numeric fees when latest policy is unknown. Historical draft example fees are NOT silently charged. Finance snapshot MUST be immutable at order time; PR #10 contains canonical migration 054 and no historical NULL backfill.
- Safepay sandbox checkout must be server-authoritative; callback and reconciliation idempotent, ledger/escrow settlement only on verified payment state. A successful redirect or UI toast is not proof of PAID.
- Money release must await buyer acceptance / explicit contract-based dispute-free resolution; logistics supplier completion alone must not release escrow.
- Allow verified, legitimate post-delivery ratings/reviews, dispute evidence, admin audits, fraud flags and privacy-constrained in-app chat. Buyer/supplier direct contact leakage discouraged, but do not claim automated perfect prevention.

# 2. REQUIRED OUTPUT ARTIFACTS AND CHECKPOINTS

Create/update under `backend/docs/` (or matching established documentation convention):
1. `MILJOR_NON_CI_GAP_MATRIX.md`: module-by-module provenance and branch overlaps.
2. `MILJOR_NON_CI_PHASE_LOG.md`: dated log with per-step commits, tests, result and blockers.
3. `MILJOR_NON_CI_BUSINESS_ACCEPTANCE.md`: reproducible API/UI/DB manual and automated cases, test fixture IDs, expected vs actual; no false PASS.
4. `MILJOR_NON_CI_FINAL_HANDOFF.md`: PR links, changed paths, migration safety, unfinished external CI/provider gates and exact merge prerequisites.
5. For each nontrivial change: code, relevant migration if required, targeted tests and updated API/UI contract docs.
6. Maintain a machine-readable coverage matrix if repository already uses one; otherwise Markdown is fine.

**Phase completion must meet six layers:** DB invariant + service/business logic + API/validation + role/authorization + user-facing UI (where applicable) + executed test evidence. Partial work = IMPLEMENTED_UNVERIFIED or BLOCKED, never VERIFIED.

# 3. EXECUTION PHASES — RUN IN ORDER

## Phase N0 — Audit, boundaries and precise gap inventory
1. Enumerate active branches/PRs #2–#11, note head SHA, source files and overlaps. Specifically isolate CI changes to PRs #9–#11.
2. Inspect catalog owner rules, B4/B5 workflow routes, B6 RFQ/recurring/collective/order-award routes, finance settlement, delivery, invoice, dispute, notification, subscription and admin modules. Identify each real source file before edits.
3. Inspect schema migrations 046–054 and applied history ONLY in disposable DB; NEVER tamper with historical journal.
4. Trace end-to-end lifecycle graph: SKU -> pool/RFQ -> buyer commitment/quote award -> order -> payment -> fulfillment -> delivered -> buyer accepted/disputed -> settlement/refund -> invoice/review/analytics.
5. Produce feature-level functional status. Determine whether frontend calls match backend contracts. Map overlapping PR code to one canonical implementation; no blind merges.
6. Prioritize P0 data integrity and missing routes before visual polish. Record a phase-gate summary.

**Gate N0:** COMPLETE only after gap matrix identifies actual missing functionality and safe source branch. No code mutation to product behavior before audit.

## Phase N1 — Supplier-owned SKU specification & moderation (Option B)
1. Confirm latest 25-family approved supplier-owned canonical category catalog. Preserve existing seeded historical SKUs.
2. Supplier draft new SKU with precise physical specs and optional proof/attachments; edit in DRAFT, submit for moderation; admin approve/reject with reason and audit.
3. After publication, freeze physical spec fingerprint (brand/variety/grade/pack/quality attributes). Prevent direct edits in API/service/SQL-backed rules. A major physical change creates new SKU linked to superseded SKU, with its own moderation and stock identity; never convert existing stock automatically across incompatible packaging or units.
4. Allow only explicitly authorized commercial edits (price, availability, service conditions); snapshot their effective version for future pools; historical pool/order snapshots remain byte-for-byte unchanged.
5. Delete/deprecate unsafe legacy hard-coded listings only through forward-compatible routes; preserve historical ID resolution and invoice views.
6. Tests: unauthorized edit 403, published physical spec alteration 409, admin approval 200, old pool unchanged after supersede, no cross-supplier SKU reuse, robust quantity/unit validation, duplicate create idempotency, invalid spec rejected.
**Gate:** all above on disposable test DB/API plus UI readback; no migration conflict.

## Phase N2 — Unified operational pool marketplace and remaining UX
1. Respect existing UCP #3–#5 implementations; only fill gaps verified by audit, don't duplicate supplier overview, combined buyer discovery or retry logic.
2. Supplier: one Pool Management dashboard; status/type filter, create draft, tier and MOQ editor, Flash clearance validation, review and publish, cancellation eligibility, snapshot of committed vs free stock, server-derived expiry, delivery cluster eligibility, price breakdown, errors with retry guidance.
3. Buyer: one pool listing and detail; supplier SKU identity, category/cluster filters, clear Regular vs Flash terms where legally/operationally necessary, join/reserve vs hold semantics, confirmation and payment cutoff, server time sync, address and pickup options, order recovery, no fabricated success.
4. Integrate buyer Request-a-Pool demand request (if absent) with dedupe, service-area info, supplier visibility boundaries, reject unauthorized supply commitments.
5. Preserve locked buyer order/price/fees despite supplier future updates. Handle near-expiry, stock exhaustion, closing without target and partial permitted tier transparently.
6. Validations: MOQ, min buyer quantity (business decision pending—do not invent enforced threshold), tier changes, no new commitment after expiry, no duplicate charge or reservation on retry.
7. Tests: timed state transitions under fake clock, DST-free UTC rendering, accessibility/mobile layout, manual click flows, role isolation and fee math.
**Gate:** cross-screen data consistency, no semantic changes to authoritative B4/B5 accounting.

## Phase N3 — B6 RFQ, comparison, award → paid order → supplier fulfillment
1. Find canonical B6 workflow from existing branches. Trace supplier quote ownership, bid prices, expiry, buyer selection and award transaction with atomic order creation.
2. Verify award idempotency; concurrent accept only one award; rejection/expired bids never create orders; quote snapshots immutable.
3. Convert awarded RFQ/collective/recurring occurrence to actual order lines, allocations, supplier fulfilment tasks, delivery destinations, invoices and immutable payment breakdown.
4. Supplier fulfillment work queue MUST include successfully paid orders from every supported procurement mode, including awarded RFQs; never show unpaid orders as fulfillable unless explicitly permitted by contract.
5. Support split supplier/multi-product orders with explicit parent-child or per-supplier fulfillment units. Prevent wrong supplier seeing another supplier's stock/order/price.
6. UI: buyer quote comparison, selected award summary, payment view, buyer order tracking; supplier incoming awarded order, acceptance/status, packing, dispatch, proof. No fake data substitutions.
7. Tests: single supplier/multi supplier, multi-line, bid expiry, double click/retry, buyer/supplier isolation, canceled award, pricing rounding, order→fulfillment queue, order counts and transitions.
**Gate:** disposable DB/API and real app-level journey where local tools permit. CI hosted Chromium itself is EXCLUDED.

## Phase N4 — Delivery, partial delivery, buyer acceptance & dispute synchronization
1. Supplier logistics: Lahore service clusters, fees, available delivery windows, optional pickup, disclosed outside-area surcharge and fast-delivery eligibility. Validate eligibility and price BEFORE buyer pays.
2. Delivery state model: packed -> dispatched -> supplier delivered claim -> buyer confirms whole or partial; supplier claim alone must NOT settle funds.
3. **Required example:** buyer orders 100 kg and receives 80 kg. Persist ordered_qty=100, received_qty=80, short_qty=20, delivery proof/evidence, dispute case, affected line/SKU, buyer/supplier statements, timestamps, financial consequence and resolution (fulfill 20 later / partial refund 20 / agreed substitution where allowed).
4. Split partial deliveries into durable fulfillment attempts; no negative quantity, no >ordered cumulative received, no duplicate proofs, and order-level status must reflect remaining items and unresolved issues.
5. Payment escrow hold on buyer-unconfirmed, disputed and rejected deliveries. Partial release only if policy and exact line accounting allow it; no automatic full settlement for supplier-completed UI status.
6. Dispute lifecycle: open, evidence submitted, under review, admin resolution, authorized refund/replacement, closed and audit. Both parties get scoped state changes/notifications.
7. Inventory and money consistency through cancellation, return, short delivery and refund, no double release or double refund.
8. Tests: 100/80/20, full acceptance, zero delivery, overdelivery rejection, duplicate submit, disputes with mixed items, supplier-only completion, buyer no-response expiry policy (do NOT invent auto-settlement timer), concurrent confirm/dispute race.
**Gate:** same ledger/order/dispute reality across backend, API and buyer/supplier/admin UIs.

## Phase N5 — Invoices, receipts and exact financial calculations
1. Define immutable invoice line items by purchase/order line and fulfillment supplier; do not flatten split-supplier/multi-product orders into misleading single total.
2. Show units, quantity, unit price, tier discount, supplier delivery, buyer processing fee, optional fast/outside-area fee, tax if valid configured rule, promotion credit and exact grand total. No invented savings.
3. Snapshot commission at order conversion: honor existing canonical `054_order_supplier_commission_snapshot.sql` migration and PR #10 implementation; do not clone this migration. Historical NULL means **unverified**, fail closed, never backfill from today's supplier profile. Check B4/B5/B6 order-writer coverage without taking over CI gate.
4. Settlement: exact supplier payable, platform fee/commission, escrow release and refund, ledger double-entry balancing, idempotency, currency consistency. Reject invalid/negative fees, over-refund and mismatched payment amount.
5. Invoice downloadable view, per-supplier sub-invoice where appropriate, receipt after verified payment only, historical no-mutation on later supplier spec/fee change.
6. Tests: split supplier; multi-product; partial delivery; cancellation; refunded tax/fee treatment as current approved policy (unresolved -> hold); rounding 0.01; replay callbacks simulated only for local logic; concurrent settlement prevention.
**Gate:** independent exact arithmetic and ledger audit; actual provider certification remains separate.

## Phase N6 — Recurring procurement and Collective Quote scheduling
1. Audit existing B6 recurring/collective data/services first; fill absent or broken real paths only.
2. Weekly/monthly recurring agreements: buyer specs, supplier, recurrence rule, start/end/cutoff, quantity, optional price tolerance, paused/cancelled/active state, demand forecast without treating it as paid revenue.
3. Occurrence generator must be idempotent for same schedule/date; timezone Asia/Karachi for user display but persist UTC, handle end-of-month edge cases and clock drift.
4. Buyer can pause future only; existing paid/locked orders retain binding contract, cancellation policy and evidence. Pricing changes require consent before an upcoming occurrence is locked.
5. Collective Quote groups compatible procurement demand (SKU/spec/quality units/date geography/delivery terms). Do not commingle incompatible requests or allow one buyer to see another buyer's identities/order details.
6. Supplier quotes with snapshot, compare/award, buyer accept/pay, fulfill, invoices. Never fabricate grouped discounts absent supplier agreement.
7. Tests: duplicate scheduler run, end-of-month, schedule pause/cancel, supplier quote expiry, group eligibility/tenant isolation, unmatched quote handling and payment linkage.
**Gate:** future scheduled occurrence lifecycle to real order without double purchases.

## Phase N7 — Trust, verification, ratings, fraud and in-app communication
1. Seller/buyer business verification with approval/rejection, evidence minimization, expiry/review, visible status. Paid `verified` promotional badge must not misrepresent identity vetting.
2. Buyer reviews only actual eligible received orders. One review per allowed order/line policy; detect coordinated suspicious reviews; admins can moderate with evidence and appeal trail.
3. Reliability metrics computed from genuine completed/late/disputed/fulfilled history, no synthetic numbers, clear sample thresholds and rate protections.
4. In-app chat scoped to existing transaction/RFQ and users, attachment type/size validation, abuse reports, no disclosure of unapproved private contact details; avoid claiming perfectly enforceable no-off-platform communication.
5. Fraud/risk checks: duplicate suspicious orders, rapid cancellation/abnormal claims, forged evidence, settlement attempt during dispute, admin escalation. Non-blocking flags vs automatic blocking must be documented.
6. Test unauthorized messages, fraud policy privacy, badge expiry, unverified seller behavior, no review on unpaid order, review edit/moderation audit.
**Gate:** authorized privacy-safe views, moderation evidence, no paid status forged.

## Phase N8 — Notifications, subscriptions, analytics, admin operations
1. Transactional **in-app** notifications for pool expiry, buyer payment expiry, quote acceptance, delivery claim, buyer confirmation, dispute decision, refund and supplier payouts; deduplicate events, mark-as-read role-safely.
2. Email/SMS only if actual transport integrated and authorized; mock delivery must be labeled mock; never claim sent or received unless provider confirms. Implement durable outbox/retry logic safely.
3. Subscription/listing entitlement and supplier onboarding promotions: historical examples (initial six-month discount, grandfathered rates) may require policy confirmation. Do not hard-code ambiguous prices; use admin-approved versioned plan catalog and contract snapshot.
4. Ads and verified paid visibility: moderation, billing, start/end, separate sponsored disclosure and correct placement. No free unpaid ad entitlements.
5. Savings engine: compare against **verified reference price** with provenance and date; if absent show `Savings unavailable`, never invented market rates. Buyer analytics paid purchases; supplier analytics paid orders, fulfilled quantities, true net receipts.
6. Admin dashboard: supplier moderation, disputes, audit logs, fee policies, refunds requiring proper permissions, catalog and buyer pool-request oversight. Never expose secrets/other tenants.
7. Tests: message outbox idempotency, entitlement expiry, invoice-backed analytics, role scoping, fake savings prevention, admin approval and immutable finance snapshots.
**Gate:** accurate business reporting and safe operations.

## Phase N9 — Product finishing, local acceptance and release handoff (NON-CI)
1. Integrate frontend/API for all completed phases with responsive Lahore B2B user journeys (English/Urdu only where actual localization exists; avoid mixed/untranslated misleading labels).
2. Correct empty/error/loading states, recover from API errors, navigation, browser refresh within local manual testing (do not duplicate hosted CI Chromium remediation), keyboard/mobile basics and screen-readable status/timer text.
3. Re-run targeted unit/source/API/MySQL integration tests in isolated `miljor_test_db`. Perform a safe local real buyer/supplier/admin walkthrough if environment available; explicitly report what was not verified.
4. Reconcile PR diff and migration manifest before writing any new migration. Confirm no edits to protected DB and no unexpected financial side effects.
5. Write risk register: open B6↔UCP integration mismatches, financial commission NULL history, unresolved min buyer quantity, service surcharge and refund rules, real Safepay callback, CI/browser/stress gates.
6. Prepare draft PR(s) with change summary, exact HEAD SHA, acceptance results, known BLOCKED items and user-visible navigation notes. Push committed isolated branch; never merge/main/deploy automatically.
7. Declare `NON_CI_FUNCTIONAL_COMPLETE` only if N0–N8 functional gates passed; `RELEASE_READY` only after external CI and genuine Safepay gates pass separately.

# 4. CROSS-MODULE MUST-PASS BUSINESS SCENARIOS

**S1 Regular pool:** supplier creates approved SKU + Regular draft, publishes with minimum and tier; buyer reserves, supplier offer accepted, order locked, payment hold shows 15m independently from pool timer, verified simulated local paid ledger, supplier fulfills, buyer accepts, settlement and invoice correct.

**S2 Flash:** approved clearance SKU + truthful best-before/quality terms; exact physical stock hold and separate hold/payment expiry; checkout/recovery, paid order, delivery, dispute or confirmation; no double allocation.

**S3 B6 RFQ:** buyer 2-line RFQ, 2 suppliers quote, one selected award; correct paid order(s) in supplier fulfillment work queue; exact fee and invoice line per supplier; quote expiry and retry protections.

**S4 Partial delivery:** 100kg ordered, 80kg received, 20kg shortage; buyer disputes 20; supplier claim not enough to release full escrow; admin resolution produces exact remaining stock/refund/replacement and immutable record.

**S5 Multi-supplier / multi-product:** correct ownership per supplier, subtotal/discount/charges/fees, invoice and ledger reconciliation, no buyer cross-tenant leak.

**S6 Recurring:** Monday scheduled 100kg for authorized buyer, cutoff and price acceptance; duplicate generator cannot create second order; pausing next week does not cancel already-paid occurrence.

**S7 Catalog Option B:** published pack changes 25kg->50kg creates separate SKU; prior pools, payment receipts and old invoice keep 25kg snapshot.

**S8 Delivery economics:** supplier-declared cluster versus pickup/faster/out-of-area charges shown BEFORE pay, recomputation yields same exact total at payment, no surprise charge.

**S9 Trust:** only delivered eligible orders can review, verified status clear, complaint state tracked, role isolation and audit throughout.

**S10 Failure cases:** authorization 401/403, expired quote/hold/pool, duplicate requests, provider unknown pending state, stock mismatch rollback, partial refund idempotency, no premature settlement.

For each scenario record prerequisites, API calls, UI screens, DB assertions, exact money invariants, expected error codes, negative/replay case, log paths and `PASS / FAIL / BLOCKED`. Include reconciliation query outputs on disposable DB without secrets.

# 5. ANTIGRAVITY IMPLEMENTATION LOOP (MUST EXECUTE, NOT JUST EXPLAIN)

Repeat for N0 -> N9 and each listed substep:

```text
A. READ: inspect actual code + decision/PR provenance, recent branch heads and test fixtures.
B. PLAN: list exact files/DB/API/UI touched, dependency order, risk and acceptance criteria.
C. IMPLEMENT: smallest coherent change on isolated branch with secure authorization/idempotency.
D. TEST: targeted unit/source -> isolated DB/API -> local UI business check if applicable.
E. FIX: diagnose failures, patch root cause, rerun; do not relabel failure PASS.
F. LOG: record command, exact results/count, evidence, commit SHA, conflicts, blocker.
G. PUSH: safe branch push and draft PR (no merge/deploy); continue next independent substep.
```

### Minimal status format after every phase
```text
PHASE: N#
BASE / HEAD SHA:
IMPLEMENTED:
CHANGED FILES:
DATABASE: isolated test only / no protected mutation
EXECUTED TESTS: exact command + PASS/FAIL counts
BUSINESS SCENARIOS VERIFIED:
FAILED / BLOCKED (with exact reason):
EXTERNAL CI / PROVIDER DEPENDENCY:
NEXT PHASE:
GATE: PASS / FAIL / BLOCKED
```

### Stop / escalation conditions
- Protected DB target, unauthorized production credentials, real-money movement, schema collision/historical ledger mismatch, potential loss of paid-order history or supplier inventory: **STOP that hazardous operation**, mark blocker and continue harmless tasks.
- Unknown latest business fee/rule: implement configurable rule schema and clear `UNCONFIGURED` rather than silently making up a charge; log decision needed.
- Existing concurrent branch modifies same file: compare and avoid overwriting; make additive isolated patch or defer merge conflict.
- Third-party provider API cannot be tested: keep `BLOCKED_PROVIDER`, do not simulate as if actual provider signed.
- CI-owned tasks discovered: label `EXCLUDED_CI`, assign to PR #9/#10/#11 and do not edit their pipelines.

# 6. GIT SAFETY AND FINAL HANDOFF

1. `git fetch --all --prune` and inspect branch graph/read-only provenance first. Work in separate branch `feature/non-ci-business-completion-<date>` based on verified approved canonical integration baseline. Do not change the branch hosting this prompt except reading it.
2. Use traceable commits: `feat(non-ci-n1): ...`, `fix(non-ci-n4): ...`, `test(non-ci): ...`; each with verification evidence in phase log.
3. Open **DRAFT** PR to appropriate integration branch with no automatic merge. If target base cannot be selected safely, create isolated feature branch and document exact unresolved base conflict rather than pretending integration.
4. Do not use `git push --force`, destructive migration rollback, `reset --hard` on other agents' work, blind cherry-pick, blind PR merge or deletion of predecessor work.
5. Report EXACT artifacts and links, measured tests, blockers and remaining work. Mention external CI PRs #9/#10/#11 independently.
6. Final release checklist: no cross-supplier leakage, no negative stock, no duplicate order/award/settlement, no unverified provider payment marked paid, exact invoices, partial delivery unresolved != settled, historical snapshots immutable, migration history reconciled, all local acceptance evidence; CI and genuine Safepay certification separately required.

---

## IMMEDIATE FIRST ACTION FOR ANTIGRAVITY

**Start with N0 NOW, then N1–N9 automatically, using the real repository.** Do not waste a full run rewriting this prompt or only providing recommendations. Audit what is already done and implement only missing or defective non-CI functionality. Preserve UCP/B4/B5/B6 financial semantics; honor latest supplier-owned SKU Option B and Lahore-first B2B scope. Keep returning concise, evidence-based status checkpoints and push safe commits on your own isolated branch. Do not modify main or production databases.
