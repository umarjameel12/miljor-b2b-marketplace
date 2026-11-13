# MilJor remaining work — current-main audit (2026-11-13)

## Baseline / invariant
Audited main SHA a7fcd3af09357e727ef1c6750eb6696f9b42ef88. No local MySQL or live money actions. A green synthetic webhook is not evidence of provider-origin money receipt. Keep buyer/supplier/admin authorization, supplier-owned SKU specifications, 25 catalog families, price snapshots, financial conservation and sandbox-only restrictions unchanged.

## Confirmed in current main
- Single buyer `/pools` page has All / Regular / Flash subcategory filter. Supplier `/supplier/pools` creates and manages Regular/Flash with separate internal stock/payment engines.
- Flash standard clustered / pickup / express delivery is quoted from supplier options and stored in immutable `flash_order_delivery_terms` migration 055. New MySQL suite passed 47/47 in earlier PR #44.
- Safepay HMAC-SHA512 payment callback amount/currency, exactly-once payment records, invoice and retry stress have succeeded on isolated MySQL. PR #45 verified 30 concurrent callbacks, 50 retries and prevented duplicate payment inserts; PR #46 verified 20 concurrent refund assessments -> exactly one obligation.
- Internal full refund assessment and approval are supported, but external execution is DISABLED and `recordManualConfirmedRefund` intentionally refuses references without real provider evidence.
- PR #45/46 payment/settlement CI, UCP/Chromium/auth, admin approval, migration and delivery safety gates passed on their branch heads before merge.

## Remaining acceptance gaps — sorted by business impact
| Priority | Gap / exact evidence | Required pass gate |
| --- | --- | --- |
| P0 EXTERNAL | Safepay Sandbox genuine hosted checkout card authorization, decline/cancel/return and provider-origin signed webhook not certified on **current main**; existing CI signs its own synthetic events | Merchant-authorized sandbox-only credentials, true provider-origin webhook signature, tracker and order amount/currency match; cancelled/failed never PAID; webhook replay; exact order/invoice |
| P0 EXTERNAL | Refund *returned amount* not executed or provider-confirmed; `paymentProviderService.initiateRefund` is a pending gateway stub, `recordManualConfirmedRefund` rejects manual reference | Genuine sandbox merchant dashboard refund or documented provider-authenticated API/event, full/partial amount exactly allocated, refund status only on verified evidence, disbursement held |
| P0 EXTERNAL | Supplier bank payouts have no verified Safepay sandbox contract; internal PREPARED or APPROVED != funds sent | Provider-supported explicit sandbox payout endpoint and provider-origin reconciliation; never real IBAN/external movement |
| P0 E2E | Chromium CI verifies login/session/retry/role journey, not a complete browser Flash/Regular purchase -> real sandbox checkout -> supplier fulfillment -> buyer confirmation -> refund/settlement, per p0_real_browser_journey.js | New real UI cross-role browser test with isolated MySQL/eligible products/addresses and explicit provider-origin vs synthetic labels |
| P0 POSTPURCHASE | Partial 100/80/20 plus B6 multi-product/split-supplier invoice/dispute/refund invariants need latest-main end-to-end browser-level evidence (historical isolated tests exist) | Recheck exact immutable quantities, allocations, buyer confirmation and supplier payout blocks in current-head real MySQL + Chromium |
| P1 UX | `/rfqs` still renders separate 1534-line RFQ/Recurring/Collective/Negotiation page, whereas agreed Smart Procurement Hub is one buyer entry for single/multi buyer & product and quote/counter-offer, no free chat | Plan one unified workspace with clear single/multi choice, multi-SKU cart, buyer counter-offer per chosen items, supplier quote revision, RFQ/Recurring/Collective under one hub route; keep underlying B6 contracts |
| P1 LEGACY | `/flash-pools` still has a separate route opening legacy page despite one canonical `/pools` marketplace; source gate did not protect route | Redirect to `/pools?type=FLASH`; consume type query; no independent Flash discovery page |
| P1 OPS | Supplier clustered and pickup/express delivery requires a dedicated browser journey proving actual handoff and immutable fee/point after supplier edits | Run supplier setting change / quote/hold / fulfillment / invoice and buyer pickup confirmation browser suite |
| P1 QA | 25+ historical open draft/audit PRs (notably #2-#29, #37, #39), several stale bases; risk accidental blind merge | Inventory PRs, compare to main by changed files and close only after explicit reconciliation and owner-safe documentation; never mass-merge stale branches |
| P2 PRODUCT | UI polish, professional email template / spam deliverability and screenshots require live visual mobile and desktop acceptance, not source-only | Chrome real breakpoints, no overflow, no duplicate messaging, sender SPF/DKIM/DMARC validation with domain owner |

## Current-branch bounded fix
Legacy `/flash-pools` redirects to `/pools?type=FLASH` and query drives the single marketplace subcategory. No payment, migrations, stock, or B6 contracts changed.

## Release rule
Use PASS / FAIL / BLOCKED on exact SHA with CI log URLs. Do not call app 'perfect/error-free' or claim refunded funds. Provider-dependent P0 gaps are BLOCKED when merchant credentials, hosted test-card input, or authoritative refund callback evidence is not available. Only `miljor_test_db` for tests; never modify `miljor_db` or `miljor_sandbox_db` in CI.
