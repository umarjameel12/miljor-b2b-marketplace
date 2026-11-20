# MILJOR — PR #61 REMAINING WORK: THREE-PART CANONICAL IMPLEMENTATION PLAN
Date: 2026-11-16
Applies to: PR #61, feature/pr60-canonical-release-hardening
Baseline: exact verified executable SHA 973a8fe403ab7c85b97fb536d7dcfb450d43d3b4 (eight existing CI workflows SUCCESS at that SHA).
Status: PLAN / UNIMPLEMENTED REMAINING WORK; existing passing baseline preserved; draft PR, no main merge.

## Non-negotiable architecture and guardrails
- ONE buyer Smart Procurement Hub. Its procurement modes are Unified Pool (Regular + Flash already combined), Personalized Quote (single buyer / RFQ), Recurring (WEEKLY / BIWEEKLY / MONTHLY), and Collective/Grouped Quote. These are internal paths, not separate competing buyer apps.
- ONE supplier Procurement Opportunities workspace, filters All / Single / Grouped and useful status filters. Supplier's other major domains are Products/Inventory, Orders/Fulfillment, Deliveries/Logistics, Finance/Settlements, Subscription, Reviews, Notifications, Analytics; no duplicate hub or fake inventory/orders.
- A Single request is one buyer's tailored quote; a Grouped request aggregates several independently consented buyers and invites competing suppliers. Unified Pool is an advertised supplier-side supply/price-tier flow; do not relabel a Collective Quote as a new UCP pool.
- Use canonical DB tables, immutable SKU/spec/quotation snapshots, idempotent operations, buyer-specific order/payment ledger, existing RBAC/stock/fulfillment/finance services. No direct external buyer/supplier contact details or buyer PII in supplier group preview.
- Design language: Swiss-minimal, warm neutrals/champagne gold #C8B276, light/dark responsive. Body labels and KPI numerals use readable sans/tabular numerals; display type only where editorial hierarchy suits. Do not add unnecessary 'Share' buttons/features, fake demand, redundant cards, flashy colors or unrelated copy.
- No real money. Safepay SANDBOX only. DO NOT modify protected miljor_db, secrets, main, or merge draft PRs. PR53/PR54 migrations 092/093 conflict: keep canonical 090, 091, 094, 095, 096, 097 sequence and reconciled journal with forward-only changes after explicit migration-history audit. Never blindly overwrite PR61 with upstream branch.
- Each part ends with **PASS / FAIL / BLOCKED** evidence at a specific Git SHA; a feature is VERIFIED only if database, backend, HTTP API, authorization, errors, browser and isolated tests agree. Do not call the entire release production-ready merely because CI is green.

# PART 1 — Secure Supplier Onboarding + ONE Unified Opportunities Inbox (PRIORITY P0/P1)

## 1A. Correct supplier verification and admin workflow
Current facts: admin UI has exactly Approve / Request Info / Reject; UNDER_REVIEW is a status, not a fourth decision. Existing submitVerification is idempotent for PENDING_REVIEW/UNDER_REVIEW and VERIFIED. Preserve these safeguards.

Target state machine:
NOT_SUBMITTED → PENDING_REVIEW → UNDER_REVIEW → (VERIFIED | MORE_INFORMATION_REQUIRED | REJECTED).
MORE_INFORMATION_REQUIRED → supplier corrects only flagged items → PENDING_REVIEW with next immutable revision → UNDER_REVIEW.
VERIFIED material identity/bank change → separate controlled re-review without automatically stripping paid plan or silently disclosing bank data.
REJECTED = final decision unless explicit admin-authorized appeal case is opened; no automatic reset or unrestricted resubmit.
SUSPENDED = separate compliance/security action, not a 'Request Info' synonym.

Implement:
1. Supplier fills business details once. Atomically save an immutable submitted revision, list of document reference IDs + digests, timestamp and exact profile fields. Preserve all previously valid details and attachments across review cycles.
2. Disable duplicate submission while PENDING_REVIEW/UNDER_REVIEW; return existing receipt, submitted_at and revision on double click/replayed requests. Lock material fields while in review; supplier can see a readable, masked immutable submitted snapshot.
3. Admin review uses stored revision with an explicit review owner/optimistic revision or transaction lock; Approve must verify that the reviewed revision equals current revision, that submission is eligible and that review has not been decided concurrently. Reject requires meaningful reason and audit. Request Info requires explicit selectable field/document IDs, field-specific actionable instructions, review revision, and notification. Do not require supplier to refill/reupload unaffected data.
4. Supplier sees ONLY requested fields enabled, existing details prefilled and previous valid attachments retained. Only those revisions allowed; optimistic version+idempotency key on Submit Corrections. New revision returns to PENDING_REVIEW with clear history and admin alert.
5. Fix admin verification finance contamination: current controller defaults plan to GROWTH and transaction rate to 1.50 and updates caps, profile and users flags for every decision. **Request Info/Reject/Under Review MUST NOT mutate subscription_plan, paid subscription rows, commercial fee, listing caps or unrelated user verification/trust status.** Approval must not grant a paid GROWTH/BUSINESS plan without independently confirmed subscription payment; Starter onboarding does not auto-charge. Apply separate explicit suspension policy only to proven compliance cases. Preserve immutability and audit.
6. Keep SUPER_ADMIN/ADMIN authorization and forbid supplier self approval; masked payout/IBAN in ordinary admin lists, least-privilege authorized review detail; immutable admin decision actor/time/reason, notifications to supplier (submitted, under review, correction request, correction received, approved, rejected).
7. Suppress unconfigured verification ETA claims (existing code mentions '2 business days') unless a real governed SLA exists.
8. Resolve onboarding UX error/loading/empty states and review timeline; do not expose secret document URLs.

## 1B. One supplier Procurement Opportunities workspace
1. One backend owner-scoped aggregation/read API of (a) single personalized quote supplier invitations and (b) collective group bid invitations. Provide standardized type, request_id, group_id if any, request status, quote deadline, item summary, buyer count, aggregate quantities, version and supplier-specific next action. Avoid 2 separate competing supplier inbox pages.
2. UI tabs All / Single / Grouped; statuses New, Interested, Quoted, Awaiting Buyer, Qualified, Paid/Order Created, Expired/Closed/Action Needed; clear quote deadline/countdown, counts, server pagination/search/sort, responsive table/cards and safe deep links. No invented business demand.
3. Single card: one buyer's request item quantities/specs/area, supplier listing eligibility, Accept Interest/Decline, Quote/Requote, numeric product-wise counteroffers, buyer-approved delivery terms, final quote/award status.
4. Grouped card: minimum buyers, CURRENT joined consenting business count, aggregate demand item-by-item with physical SKU/unit requirements, delivery-area clusters (no private recipient addresses), joining and bid deadlines, invitation status, supplier eligibility, stock availability, total bid and delivery-fee-per-buyer, Submit Group Bid / Revise Bid / Track Buyer Consents. Buyer participation requires join consent; bid consent separately confirms exact price/physical spec/fee.
5. Match invited suppliers on verified identity, published SKU/family, compatible unit/grade/pack specs, stock, MOQ/buyer minimum and supported delivery zones **before invitations**, revalidate during quote/award. Current group invitation checks verification but item/area matching occurs mostly at bid time; close this gap. No supplier can fetch another supplier's invitation/bid or private buyer address/contact.
6. Preserve one buyer Smart Procurement Hub with unified procurement modes and linked supplier responses; no standalone RFQ buyer subsystem.
7. Distinguish group qualified vs payable: show 'Qualified — awaiting individual payments' rather than 'Paid'. Do not allow 'Confirm Group Delivered' as substitute for individual buyer confirmation.

### PART 1 required acceptance
- Real isolated MySQL: first submit, double-submit same record, UNDER_REVIEW freeze, specific field correction (old files retained), revision conflict, approval of current revision, reject no resubmit, material change re-review, self-approval/cross-role denied, no plan/fee or paid entitlement mutations on Request Info/Reject.
- Real API and Chromium: same actual supplier sees Single+Grouped cards under All and correctly filtered tabs; other supplier cannot access records; invalid/deadline/unauthorized cases fail closed; pending/empty/error/mobile/dark/light, no Share or fake cards; buyer hub stays single.
- Source + DB tests: no raw buyer identities/phones/addresses in group invitation response, notification dedupe and review audit.
- **Gate 1:** PASS only if actual schema+backend+API+browser all pass and no money or old supplier data mutated. Otherwise FAIL/BLOCKED before Part 2.

# PART 2 — Collective Group Conversion → Payment → Delivery → Dispute → Settlement (CORE P0)

## 2A. Quote and qualification rules
1. Buyer Smart Procurement Hub creates one collective group draft; private invitation join, each buyer's chosen quantities/units and explicit join consent; minimum buyers, cutoff/quote deadlines and cancellation/replacement policy.
2. Suppliers receive owner-scoped group invitations, quote same immutable physical SKU/version across buyers (no mixed incompatible SKU/unit), itemized aggregate quantity, buyer-minimum/MOQ and tier prices if applicable; supplier may update quote before cutoff but old buyer consents invalidate and require reapproval.
3. Each buyer previews their OWN exact item subtotal, delivery fee, MilJor processing fee, tax (only if configured) and total; buyer consents to exact bid version only. Organizer does NOT pay on other buyers' behalf. Every joined buyer must consent before qualification.
4. Explicitly handle group 0 eligible suppliers, minimum buyers not met, supplier decline, bid expiry, organizer unavailable, group expiry, quote revision after consent, participant withdrawal, wrong physical pack/unit and multiple bidders. No fabricated successful group.

## 2B. Qualification-to-orders and payments (currently MISSING)
1. Existing qualifyGroup only checks stock and records QUALIFIED with stock_reserved:false, orders_created:false, payment_authorized:false. Implement separate idempotent, atomic **collective award conversion** into per-buyer owned pending-payment orders using canonical order/commission/delivery/ledger services; immutable group/bid/consent snapshots, deterministic per-buyer order mapping and NO duplicate reservation on retry.
2. Cross-check available_stock minus other RESERVED/COMMITTED allocations under same MySQL row locks before creating holds; enforce group reserve policy, payment deadline, expiry/release, buyer failure/partial group funding and supplier commitment. No stock double-spend with Regular, Flash, RFQ or Recurring.
3. Each buyer explicitly starts own Safepay SANDBOX checkout; provider-origin callback verification + server-side reconciliation, strict expected order/currency/amount/state, replay-safe ledger; never activate from browser redirect, synthetic client field or bid approval.
4. Define and test group behavior if some pay and some do not: group contract threshold, supplier MOQ/capacity, recompute tiers, consent of affected buyers to any price change, refund/unlock if cancellation required; never silently charge extra, use transparent countdown and actionable notifications.
5. Immutable supplier commission per order, per-buyer processing fee and fixed supplier delivery fee, exact line item invoice, funded vs failed vs refunded states, available vs held funds ledger reconciliation. No unaudited admin money adjustments.

## 2C. Supplier fulfillment and clustered logistics
1. Convert only reconciled PAID orders into supplier fulfillment queue. Consolidate preparation across group but maintain independent buyer_id, order item, quantity, invoice and delivery-stop IDs. Supplier packing, acknowledgement, ready, dispatch; supplier must never unilaterally mark buyer received/settled.
2. Cluster buyer delivery stops by verified service area, supplier coverage, delivery windows, SKU handling class and agreed fees; preserve route assignment and pickup fallback, optional fast delivery surcharge with explicit buyer consent; no forced shared drop. Different buyer addresses and zone pricing cannot be silently flattened into a single fee.
3. Per-stop proof of delivery, recipient confirmation or disputed quantity, timestamp/evidence, retries and reassignment/cancellation. Delivery exceptions do not mark all other buyers complete.
4. Verify 100kg ordered / 80kg received / 20kg missing for a single buyer; line-level shortage dispute, evidence, exact partial refund, supplier resolution, no double refund or full-order accidental settlement. Other buyers' paid items remain separately eligible.
5. Release only eligible settlement after independent buyer confirmation, dispute hold/partial refund resolution, immutable commission snapshot and finance ledger reconciliation. External payouts remain sandbox-only and MUST require real sandbox evidence/explicit release approval.

## 2D. Four procurement origins share one downstream order system
- Unified Pool (Regular + Flash, NOT duplicated), Personalized Quote/Single RFQ, Recurring cycles, Collective Group must all converge on same canonical order/payment/fulfillment/delivery/finance state machine.
- Recurring generated cycle is a draft, not a payment; weekly/biweekly/monthly schedule with fresh stock and delivery quote, opt-in modifications, skip/cancel cutoff; do not authorize automatic recurring charges absent explicit consent.
- Supplier notifications at opportunity, new/changed bid, grouping, approval, payment deadline, payment confirmation/failure, delivery assignment, dispute, refund, settlement.

### PART 2 required acceptance
- Isolated MySQL transaction/stock concurrency (2/10/50/100 competing buyers/orders) with retries, unique order mapping, idempotency and rollback; immutable price/fees, no understock, separate buyer balances.
- Actual Chromium multi-role scenario (2+ buyers + supplier + admin): group invitation → supplier bid → individual consents → qualified → each payment → fulfillment → clustered multi-stop POD → buyer confirmations/100-80-20 shortage dispute → refund → settlement; negative tests for unpaid, fraud, wrong owner and interrupted callbacks.
- Repeat same complete downstream route for Regular/Flash/Single RFQ/Recurring origins; no provider-origin PASS unless genuine Sandbox events proven. Until then mark external parts BLOCKED, not PASS.
- **Gate 2:** group end-to-end PASS only with real DB/API/browser evidence, provider provenance and finance invariants; otherwise BLOCKED and keep main untouched.

# PART 3 — Notifications, Subscriptions, Premium Frontend + Final Release Hardening (P0/P1/P2)

## 3A. One canonical notification system
1. Reconcile PR53 procurement notifications/email queue and PR54 typed UCP transactional event catalog without duplicate sends or divergent event names. Bind each committed domain transition to one exact recipient-owned event (buyer, supplier, ADMIN/SUPER_ADMIN) in SAME DB transaction.
2. Map ALL critical actions: account/email verification, supplier submit/review/request-info/correct/approve/reject, SKU publication, single/group invite and bid, collective join/cutoff/consent/qualification, UCP reserve/confirm/expiry, recurring schedule/skip, payment success/failure/unknown, fulfillment, route/POD/ETA/partial delivery, dispute, refund, settlement, subscription renewal/cancellation/reversal.
3. Add authoritative tenant ownership, idempotency keys, retries, outbox worker leases, failure reconciliation, stale notification suppression, user locale (English/Urdu), recipient preference; mandatory financial/security messages not silently opted out. Do not leak another user's price, phone, bank, addresses or private dispute details.
4. SMTP/SMS integration is not proven by synthetic in-app receipts; demonstrate sandbox/real transport provider-accepted delivery, bounce/deadletter, retry and duplicate delivery handling; email accepted ≠ inbox delivered.

## 3B. Safepay & subscription lifecycle
1. Genuine Safepay SANDBOX-origin subscription/payment tracker, provider-signed callback or authoritative fetch, reconciliation, failed/cancelled/refunded/chargeback states; no production money or secret posting to PR.
2. Defined paid-to-paid GROWTH↔BUSINESS upgrade/downgrade, effective billing dates, explicit user consent, proration/refund policy, renewal opt-in/out, missed payment, end-of-period downgrade. Never auto-enable paid plan from admin verification or unsigned redirect.
3. Fail-closed entitlement expiry even before scheduled worker, quotas and family caps, existing active pools/order grandfathering boundaries; enforce change transaction locks, audit, invoice, notices and correct commission snapshot.

## 3C. Release experience and operations
1. Premium minimalist supplier/buyer/Admin UX, correct hierarchy/fonts, responsive mobile/desktop, both themes, keyboard/ARIA, error/retry/loading/empty states and working CTA routes; remove fake pools, dead buttons, redundant Share controls, green-heavy decorative statuses. Keep gold only as restrained accent.
2. Verify reviews/ratings/disputes reliability, owner-scoped analytics and empty/nonempty KPI correctness; real data only.
3. Migration journal historical checksums and conflicts (53/54 092/093), clean isolated install plus staging backup/restore rehearsal; do not edit applied migration files. Exact sha verification, zero leak of secrets, rotate any historically exposed Docker credentials out of band, review security/rate limits/CSRF/callback signature/tenant authorization.
4. Automated tests: independent isolated MySQL + unit/contract + auth/RBAC + stock concurrency + browser cross-role full journey + frontend build + a11y/responsive + Safepay provider-origin SANDBOX. Capture PASS/FAIL/BLOCKED and links at exact source SHA. Only after every mandatory release gate PASS consider merging PR61 to main (never silently); no live payments.

### PART 3 acceptance
- Complete action→notification matrix with actual recipient and event-key evidence; no duplicate, wrong tenant or stale notices.
- Correct subscription billing and time-bound entitlements with genuine provider-origin Sandbox events.
- Clean migration install, backup restore, smoke/regression and cross-role real Chromium; no unapproved external money.
- **Gate 3:** all mandatory release blockers PASS; otherwise overall release remains BLOCKED even if prior 8/8 baseline workflows were green.

## Execution order and accountability
PART 1 (supplier identity + unified inbox) → gate 1 → PART 2 (group-to-money/fulfillment) → gate 2 → PART 3 (notifications/provider/subscriptions/security) → gate 3.

Part 2/3 may implement shared infrastructure on an isolated integration branch, but MUST NOT call a part complete ahead of upstream dependencies or skip test evidence. Every subtask gets issue tracking: code file/schema delta, API owner, migration number, negative tests, browser screenshot/log, exact CI run, remaining blocker and rollback strategy.

**Current work represented by this file is PLANNED ONLY.** Earlier PR61 qualified code `973a8fe...` achieved 8/8 existing workflows SUCCESS, not verification of these additional tests. The PR is kept draft until all gates pass.
