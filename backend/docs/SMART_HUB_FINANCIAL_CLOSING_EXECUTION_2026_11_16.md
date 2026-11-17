# Smart Hub financial and paid-delivery closing execution — 2026-11-16

## Scope and source reconciliation

Continues draft PR #53, `feature/smart-procurement-hub-unified-entry`. Before final verification, safe fetch confirmed HEAD and origin feature both `9be2b73e609cc95d31bfbe05deecde8fddf29183`; origin/main remains `9fb07cf9274509c1686b68b5bf8bdd91bd26718f`. Uncommitted work was preserved. Earlier B/UCP implementations and acceptance reports remain historical evidence, not acceptance of this delta. No main merge is authorized by this report. SMS is explicitly excluded by the user's latest instruction.

## Implemented

- Supplier-configured individual delivery uses the existing eligibility, address, quote and rate-version mechanisms. It defaults off, accepts explicit zero charges, requires renewed consent when the supplier changes the price, supports recurring preferences and uses existing singleton capacity runs. Public pool/UCP mode choices remain scoped to their existing contract.
- Financial administrators can review immutable partial-receipt assessments. Commission follows accepted product value at the signed rate. Exact delivery/processing fee allocation is approved separately; existing invoices and historical commercial terms remain unchanged. Linked refunds, hold disposition, supplier payable, audit and mandatory notifications commit atomically. Canonical payout preparation/approval validates the assessment and prevents duplicate reservations. External refund and bank execution remain DISABLED.
- Supplemental reattempt fees have a separate immutable buyer-approved payment contract and their own purpose-linked Safepay attempt/payment/hold. Original merchandise, invoice, inventory and payment amounts remain unchanged. B6 gates, sandbox-only environment, authenticated raw-body webhook signatures, amount/currency checks, replay protection and reconciliation all remain enforced. Definite initialization rejection permits a new explicit attempt; uncertain outcomes require reconciliation. A paid reattempt can resume physically while its financial disposition stays held for review.
- Existing buyer/supplier operations and financial admin interfaces expose these contracts. Delivery/receipt fields have stable accessible names. Notification events describe committed backend facts; approved refund obligations do not claim that an external refund completed.
- CI adds actual Chromium full/partial/extra-fee journeys with explicitly synthetic signed payment callbacks. Synthetic callbacks never count as genuine provider completion. Test ports are isolated from existing local applications.

## Verification and evidence

- Consolidated focused backend gate: **161/161 PASS**, exit 0. Includes delivery/run/proof/receipt, financial notification, reporting/authorization, individual pricing, partial review, payment recovery, browser readiness/redaction and isolation safety tests.
- Actual MySQL combined collective/operations/closing gate: **20/20 labelled scenarios PASS**. Includes independent-session lock denial, rate/version/address checks, original and supplemental payment capture/replay, exact conservation, partial and full payable allocation, duplicate instruction prevention, initialization failure/recovery and rollback. Synthetic webhook evidence only.
- Read-only canonical migration audit: **VERIFIED_HISTORY, applied 65, planned 65**, with matching checksum journal. Only forward migrations 098–100 were applied to `miljor_test_db` after backup. No previously applied migration was edited.
- Protected database read-only checks: `miljor_db` orders=0/payments=0; `miljor_sandbox_db` orders=0/payments=0. Mutable fixtures, schema changes and simulations use only `miljor_test_db`. Browser fixture financial history is retained there.
- Backups: pre-098/099 SHA256 `7837137550d15fa2bcd216faa39845b735cce4480277c4a84c52f8882fec1898`; pre-100 SHA256 `8ef9cd6a5f698a0281aa4a4724f2baa8c05435656309d268c8eb3fcfe1705ecc`. Backup contents and credentials are not committed.
- Independent review identified duplicate full-order payout reservation, partial assessment blocked by a separately evidenced supplemental hold, and failed initialization stranding. Each was corrected and covered by actual SQL scenarios; reviewer recheck found no remaining high-severity issue in those three paths. This was a scoped review, not a provider certification.

### Reproducible final commands

Load original environment privately, override `NODE_ENV=test`, `DB_NAME=miljor_test_db`, `TEST_DB_NAME=miljor_test_db`, `MILJOR_TEST_ONLY_MIGRATIONS=1`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`. Never print credentials. Browser runs additionally use disposable JWT/OTP secrets, `SAFEPAY_ENV=sandbox`, mock email, frontend port 3217 and API port 5217.

```text
node --test tests/procurement_delivery_run_policy_gate.js tests/procurement_delivery_evidence.test.js tests/procurement_line_receipt_policy.test.js tests/procurement_line_receipt_transactions.test.js tests/procurement_line_receipt_api.test.js tests/procurement_line_receipt_financial.test.js tests/procurement_reporting_service_gate.js tests/procurement_reporting_routes_gate.js tests/notification_projection_gate.js tests/fulfillment_notification_hooks.test.js tests/financial_notification_action_gate.js tests/individual_delivery_pricing.test.js tests/procurement_settlement_review_policy.test.js tests/delivery_payment_recovery_policy.test.js tests/smart_hub_paid_browser_provider_readiness.test.js tests/smart_hub_paid_browser_safety.test.js
SMART_HUB_OPERATIONS_GATE=1 SMART_HUB_CLOSING_GATE=1 node tests/collective_commitment_mysql_gate.js
node database/readOnlyMigrationAudit.js --test-only
npm run test:canonical:preflight
node tests/smart_hub_paid_browser_journey.js
npm --prefix ../frontend run build
```

Shell environment syntax above is illustrative; local Windows execution supplied these values through `process.env`. No master regression runner was used. Actual per-command final status and exact-head remote results are appended below.

## Genuine channels — separate from CI

**Email transport PASS:** configured SMTP authentication/TLS verification succeeded. Existing transactional email service submitted a bilingual test notification to the configured own test/sender address; outbox record **25** was provider-accepted with a message ID. **Inbox delivery NOT VERIFIED**. No address, password or provider token is published.

**Safepay authentication/initialization/form bootstrap PASS:** real configured sandbox passport authentication and canonical tracker creation succeeded without a mock adapter. A subsequent read-only continuation reused the genuine tracker, authenticated its current state, received HTTP 200 and loaded the hosted Cybersource card form. The exact documented capture-context bootstrap and required static resources were permitted; no card/contact submission occurred and the original order remains unpaid. Initial blocked-bootstrap inspection is superseded by this successful stage-one result, not a provider outage. **Genuine payment completion, authenticated public webhook receipt and fulfillment-to-provider settlement remain NOT VERIFIED**. The configured webhook signing secret is not evidence of a publicly reachable webhook URL. Presence-only environment inspection found no controlled test phone or public webhook URL; no mailbox/IMAP verification configuration. Hosted phone-field requiredness was not established, so it is not claimed as a proven provider rejection.

Official provider references: [API sandbox/testing and capture context](https://apidocs.getsafepay.com/), [sandbox card/contact testing](https://safepay.helpscoutdocs.com/article/41-dummy-card-information). These describe provider behavior, not evidence that this application completed a genuine payment.

**SMS EXCLUDED:** user explicitly stated no SMS provider is in use and requested no SMS work. This is not reported as a delivered/tested channel.

## Applied skills

using-superpowers, executing-plans, brainstorming, writing-plans, test-driven-development, dispatching-parallel-agents, requesting-code-review and verification-before-completion were applied to recover the approved scope, divide independent pricing/browser work, implement narrow financial contracts, inspect review findings and require observed test evidence. Project consolidated verification and database isolation rules took precedence over generic repeated regression workflows.

## Final status

Final local browser gate **PASS**, exit 0: full order 211 / route 11; partial order 212 / route 12 / review 8 / disbursement 10 (supplier 15615.00 + platform 475.00 + refunds 4085.00); paid reattempt order 213 / contract 7 / second route 14 / disbursement 11. Reattempt finished BUYER_CONFIRMED, route DELIVERED, fee REVIEWED, payout PREPARED with external execution DISABLED. Three scenarios, sixteen labelled checkpoints. Artifacts are ignored locally under `backend/artifacts/smart-hub-paid-browser`; CI publishes explicitly labelled synthetic evidence. Earlier browser failures exposed accessible-field names and harness refresh/HTTP-replay assumptions; these were repaired without bypassing application guards. A vehicle-save timeout did not reproduce in the final complete run.

Final frontend build **PASS**, 2237 modules, exit 0. `npm run test:canonical:preflight` **PASS**, including 12 canonical migration assertions and existing UCP source safety gates; these source checks are not claimed as UCP browser E2E. `git diff --check` PASS.

Implementation commit: `6af9b21131ab83868754c0f41b14eedfbe46af3c`. CI-only fixes: `1e7ed7bd0d744f5a33afa5329288bd863bc7271d` pins Ubuntu 24.04 after Playwright 1.56.1 rejected the updated ubuntu-latest; `70c22861cbd7d6e8cfc4b1162445f604d5a610ca` makes loopback addressing explicit and exposes startup diagnostics; `0cdf6465ab10aad8a4bc3874c56868bd8aeed7d3` repairs the observed readiness-marker root cause (ANSI formatting split `Local:`). At 70c2286 the ten non-paid-browser workflows passed, including P0 actual MySQL/HTTP/concurrency and UCP acceptance. The paid-browser job installed successfully and audited 65/65 migrations but failed before login on the ANSI marker; it was not reported as PASS. Corrected exact-head CI results are recorded below after execution. No local application suite was repeated for CI-only runner changes.

Whole-release status remains **PARTIAL/BLOCKED**, because genuine provider completion and required production tax approval are not established. B6 stays gated; PR remains draft. No external money movement or main merge.

CAN START NEXT PHASE: NO

## Changed files

- `.github/workflows/p0-payment-fulfillment-settlement-e2e.yml`
- `.github/workflows/smart-hub-notifications.yml`
- `.gitignore`
- `backend/docs/MILJOR_PHASE_LOG.md`
- `backend/docs/SMART_HUB_IMPLEMENTATION_PLAN.md`
- `backend/server.js`
- `backend/src/repositories/supplierDeliveryRepository.js`
- `backend/src/routes/v1/procurementDeliveryRoutes.js`
- `backend/src/services/deliveryEligibilityService.js`
- `backend/src/services/financialConservationService.js`
- `backend/src/services/financialSettlementService.js`
- `backend/src/services/notificationEventPolicy.js`
- `backend/src/services/procurementDeliveryAttemptService.js`
- `backend/src/services/procurementDeliveryBindingPolicy.js`
- `backend/src/services/procurementDeliveryBindingService.js`
- `backend/src/services/procurementDeliveryOptionsService.js`
- `backend/src/services/procurementLineReceiptService.js`
- `backend/src/services/procurementRecurringCyclePolicy.js`
- `backend/src/services/safepayAdapter.js`
- `backend/src/services/safepayCheckoutService.js`
- `backend/src/services/supplierDeliveryService.js`
- `backend/tests/financial_notification_action_gate.js`
- `backend/tests/procurement_line_receipt_financial.test.js`
- `backend/tests/procurement_operations_mysql_extension.js`
- `frontend/src/components/delivery/SupplierDeliverySettingsForm.jsx`
- `frontend/src/components/procurement/ProcurementOrderOperations.jsx`
- `frontend/src/components/procurement/RecurringCycleControls.jsx`
- `frontend/src/components/procurement/SupplierDeliveryRuns.jsx`
- `frontend/src/pages/AdminDashboardPage.jsx`
- `frontend/vite.config.js`
- `.github/workflows/smart-hub-paid-browser.yml`
- `backend/database/migrations/098_individual_procurement_delivery_pricing.sql`
- `backend/database/migrations/099_procurement_financial_reviews_and_delivery_payments.sql`
- `backend/database/migrations/100_delivery_payment_initialization_recovery.sql`
- `backend/docs/SMART_HUB_FINANCIAL_CLOSING_EXECUTION_2026_11_16.md`
- `backend/src/routes/v1/procurementFinancialReviewRoutes.js`
- `backend/src/services/procurementDeliveryPaymentPolicy.js`
- `backend/src/services/procurementDeliveryPaymentService.js`
- `backend/src/services/procurementSettlementReviewPolicy.js`
- `backend/src/services/procurementSettlementReviewService.js`
- `backend/tests/delivery_payment_recovery_policy.test.js`
- `backend/tests/individual_delivery_pricing.test.js`
- `backend/tests/procurement_closing_mysql_extension.js`
- `backend/tests/procurement_settlement_review_policy.test.js`
- `backend/tests/smart_hub_genuine_safepay_probe.js`
- `backend/tests/smart_hub_paid_browser_extra_fee.js`
- `backend/tests/smart_hub_paid_browser_fixture.js`
- `backend/tests/smart_hub_paid_browser_journey.js`
- `backend/tests/smart_hub_paid_browser_partial_review.js`
- `backend/tests/smart_hub_paid_browser_provider_readiness.js`
- `backend/tests/smart_hub_paid_browser_provider_readiness.test.js`
- `backend/tests/smart_hub_paid_browser_safety.test.js`
- `frontend/src/components/procurement/AdminProcurementSettlementReview.jsx`
- `backend/tests/smart_hub_genuine_safepay_probe.js`

## Verified remote application head

Final evidence-head 8de70fa: ten workflows SUCCESS, including paid Chromium/P0/UCP; isolated counteroffers printed its full integration PASS but then hit the 15-minute job timeout. Actual logs show the remaining open process dependency was the application's singleton MySQL pool, distinct from the injected fixture/admin connections the gate already closed. The runner now closes that loaded singleton in `finally` on success or failure, without forcing process exit or changing assertions. This is a harness-lifecycle fix; the destructive disposable bootstrap is never run against the already populated local test database. Corrected acceptance is verified in disposable CI.

Exact application/test-runner head **0cdf6465ab10aad8a4bc3874c56868bd8aeed7d3: 11/11 workflows SUCCESS**. Actual paid-browser job 133639481566 completed all steps, including Chromium and artifact upload, successfully. [Paid browser run](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43964281806), [P0 MySQL/HTTP/financial/concurrency run](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43964281701), [UCP acceptance run](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43964281747), [notification contracts](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43964281678). The remaining successful workflows cover buyer OTP, buyer B6/auth/frontend, admin/supplier approval, isolated counteroffers, source counteroffers, branded email and demo quantity safety.

This evidence commit also stores the opt-in genuine provider probe (syntax checked and actually executed with real read-only provider lookup/form bootstrap). It requires isolated test identity, sandbox credentials, explicit opt-in, and owns its local listener. It does not submit card/contact data, invent callbacks, use SMS or claim genuine capture. Its artifact confirms HTTP 200, capture-context bootstrap success, hosted card controls, no visible network error, unpaid order and no capture. Phone requiredness remains unknown. It is excluded from ordinary CI because CI has only synthetic provider credentials.

**Closing implementation/local and remote automated gates: PASS. Whole-release certification: BLOCKED/PARTIAL.** Missing genuine payment/webhook completion, inbox receipt and production tax approval are not converted to success by the eleven green workflows. SMS is EXCLUDED, not failed. Protected databases, UCP and B6 remain preserved. PR #53 remains draft; main is unchanged.

## Antigravity Continuation — Local Browser Repeatability & Blocker Verification (2026-11-17)

- **Task A (Local Browser Fixture Repeatability) — IMPLEMENTED & VERIFIED (PASS):**
  - **Root cause:** `backend/src/services/specificationService.js` `generateSpecCode(category, variety, idHint)` generated a 3-digit random suffix (`Math.floor(100 + Math.random() * 900)`, 900 possible values) when `idHint` was omitted, causing `ER_DUP_ENTRY` (`SPEC-G&R-BRO-222`) on populated `miljor_test_db`.
  - **Fix & Hardening:** Updated `generateSpecCode` to use `crypto.randomBytes(6).toString('hex').toUpperCase()` (12 hex chars, `varchar(50)` safe) when `idHint` is omitted, and added bounded 3-attempt collision-only retry (`_createSpecWithUniqueCode` in `backend/src/services/catalogService.js` for `approveCatalogRequest` and `publishSupplierSku`) that retries strictly on `ER_DUP_ENTRY` matching `spec_code` and immediately rethrows all other SQL/unique conflicts (e.g. `spec_hash`) without swallowing errors or using `INSERT IGNORE`.
  - **Verification:**
    - `node --test tests/spec_code_collision_retry.test.js`: **4/4 PASS** (deterministic `idHint` preservation, 12-hex format, forced `spec_code` collision retry, non-retry on `spec_hash` collision, 3-attempt exhaustion).
    - `node tests/smart_hub_paid_browser_journey.js` **twice sequentially** after hardening against the same populated `miljor_test_db`:
      - Run 1: exit `0`, 16/16 checkpoints PASS (requests `166–168`, orders `222–224`).
      - Run 2: exit `0`, 16/16 checkpoints PASS (requests `169–171`, orders `225–227`).
      - SQL financial uniqueness verified for orders `222–227`: 1 payment per full/partial order, 2 distinct payments (merchandise + supplemental delivery fee) per extra-fee order, 1 immutable invoice per order, 1 canonical payout reservation per reviewed order.
- **Additional Automated Gates Verified on `miljor_test_db`:**
  - `npm run test:canonical:preflight`: **PASS** (12/12 manifest + UCP source gates).
  - `node database/readOnlyMigrationAudit.js --test-only`: **PASS** (`VERIFIED_HISTORY`, `applied: 65`, `planned: 65`).
  - Focused backend suite (16 test files): **161/161 PASS**, exit `0`.
  - `node tests/collective_commitment_mysql_gate.js`: **20/20 PASS**, exit `0`.
  - `node tests/notification_transaction_gate.js`, `notification_route_ownership_gate.js`, `notification_mysql_action_gate.js`: **PASS**, exit `0`.
  - `node tests/email_outbox_queue_gate.js`: **20/20 PASS**, exit `0` (retry/backoff, 3-attempt terminal exhaustion, crash lease recovery, ambiguous provider acceptance containment, Urdu RTL).
  - `npm --prefix ../frontend run build`: **PASS**, 2,237 modules, `2.07s`, exit `0`.
  - Protected DB read-only checks before/after (`miljor_db`, `miljor_sandbox_db`): `orders = 0`, `payments = 0`.
- **Remaining Critical Blockers (PR #53 retained DRAFT / UNMERGED; original local `MilJor Project` preserved untouched at `feature/frontend-redesign-20261112` / `83565c4`):**
  1. **Genuine Safepay Sandbox Capture & Public Webhook Delivery (`BLOCKED`):** No public HTTPS callback URL / active tunnel registered in the Safepay sandbox merchant configuration, and Cybersource PCI card-iframe submission + controlled test contact require owner input.
  2. **Genuine Email Inbox Receipt (`BLOCKED`):** Outbound SMTP auth/submission is proven, but no authorized mailbox confirmation or IMAP/sandbox-capture verification exists to confirm actual inbox delivery.
  3. **Production Tax / Commercial Policy Approval (`BLOCKED`):** Isolated tests use a zero-tax contract; no accountable production tax rate/exemption or approval exists in the repository.

CAN START NEXT PHASE: NO
# 2026-11-17 — Review follow-up: exact collision classification and CI coverage

Source baseline `44e2f2d0eee0958ed6f9a166df6e9b74aceb6d25` was inspected; its eleven PR workflows were observed SUCCESS, including paid Chromium (44071825696), P0 (44071825862) and UCP (44071825575). Antigravity's two populated-test-DB browser runs and financial counts above remain its recorded evidence; they were not rerun or relabelled as new execution in this follow-up.

Review found the new helper classified a collision by searching the entire SQL message for `spec_code`, and the four-test regression file was not explicitly invoked by CI. A new negative test reproduced the error (5 PASS / 1 FAIL: unrelated duplicate value `spec_code` caused three calls instead of one). The helper now reads only the terminal quoted constraint identifier, accepts the qualified name ending exactly in `.spec_code` (or unqualified `spec_code`), and propagates unrelated/unknown duplicate keys and other SQL errors immediately. The negative test also covers an embedded fake `for key 'spec_code'` inside the duplicate value. The 12-hex generator, three-attempt limit, original error object, both catalog callers and database constraints remain unchanged.

The unit test injects a database-forbidden module double before importing catalog dependencies, preventing creation of the application's default pool. `node --test backend/tests/spec_code_collision_retry.test.js` final result: **6/6 PASS**, exit 0, duration 372.2866ms. No database connection, fixture write or migration was performed in this follow-up. Protected database counts recorded earlier are historical, not newly measured here. `git diff --check` PASS. The notification-contract workflow now explicitly runs the regression file and watches both catalog/specification services and the test path.

Changed paths: `backend/src/services/catalogService.js`, `backend/tests/spec_code_collision_retry.test.js`, `.github/workflows/smart-hub-notifications.yml`, this report and `MILJOR_PHASE_LOG.md`. Safe fetch confirmed local/remote approved branch both at 44e2f2d before edits; main remained 9fb07cf. Applied receiving-code-review and test-driven-development to verify the reported change, reproduce the narrow defect and fix it; project consolidated verification policy preserved successful unaffected evidence. Remote exact-head verification follows the approved feature-branch push. This focused code correction is locally PASS; genuine sandbox capture/public webhook, inbox receipt and accountable tax policy remain BLOCKED. No main merge or original local UI overwrite. SMS excluded; UCP/B6 unchanged.

CAN START NEXT PHASE: NO
# 2026-11-17 — Owner-assisted infrastructure, email and Pakistan tax research

The owner clarified that they do not know hosting/tax configuration, can access the Safepay sandbox dashboard, and want existing environment email settings used. Do not continue asking the owner to supply a prewritten tax policy or configure hosting unaided. Technical preparation belongs to the implementer; ask only for genuinely missing business facts or narrowly specified dashboard/inbox actions.

## Actual tunnel preflight — PASS, not payment/webhook evidence

Installed `cloudflared` 2026.10.7 was verified. An HTTPS request to the quick-tunnel API returned 405 (reachable API, unsupported HEAD method), not a connectivity timeout. Started a temporary health-only Node listener on 127.0.0.1:5341 with no application/database dependencies. Executed:

```text
cloudflared tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:5341 --loglevel info
```

Cloudflare created a temporary HTTPS hostname and registered an HTTP/2 connection. External HTTPS `/health` returned the expected JSON with `application_connected:false` and `database_connected:false`; `/api/v1/admin` returned 404. Both task-owned processes were then stopped. The temporary hostname is no longer a usable callback. No MilJor app or protected database was exposed.

This supersedes the blanket claim that no test-hosting path is available. It proves working temporary public HTTPS connectivity at this time, not uptime guarantees, genuine Safepay capture, merchant registration or callback receipt. Next implementer should reproduce this method with a deliberately scoped callback endpoint bound to a verified isolated test backend, verify invalid signatures are rejected, keep it alive through the actual payment and owner dashboard step, then clean up only its own processes. Do not use interactive email authentication on the provider webhook path because the provider is a non-interactive client. Do not expose general admin/debug routes. Do not buy hosting or demand a domain from the owner before trying the proven test method.

Official tunnel documentation: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/ (temporary accountless/domainless development tunnel; changing hostname and no uptime guarantee).

## Controlled fresh email — PROVIDER_ACCEPTED, inbox confirmation pending

Used existing original `.env` SMTP settings privately, a process-only `NODE_ENV=test` / `DB_NAME=TEST_DB_NAME=miljor_test_db` override, real SMTP opt-in and actual SQL identity check before the existing outbox service. Sent exactly one identifiable notification to the configured own `MAIL_FROM_EMAIL`; no address/password/token was printed. Idempotency key prevents repeating this controlled send. Existing `emailService.queueAndSendEmail` returned:

- Outbox **28**, status **PROVIDER_ACCEPTED**, provider message ID present.
- Subject: **MilJor | Inbox verification 17 Nov 2026**.
- Reference: **MILJOR-INBOX-1711**.
- Recorded time: **2026-11-17T12:22:39.105Z**.
- Actual inbox receipt: **NOT VERIFIED**; owner only needs to check inbox/spam and confirm receipt. No IMAP credentials are necessary for this manual evidence.

Only the test outbox was written. No application source, migration, protected DB or financial ledger was changed. No SMS was sent. Do not call this provider acceptance inbox delivery.

## Pakistan tax work — researched draft, not legal sign-off

Primary sources inspected:

1. FBR consolidated Sales Tax Act, amended through 30 June 2026: https://download1.fbr.gov.pk/Docs/20267171373418951SalesTaxAct1990updatedupto30.06.2026.pdf . The Act distinguishes taxable goods, digitally ordered supplies, responsible intermediaries and withholding/schedule treatment; exemptions and supplier status must be classified rather than assuming one rate across food products.
2. FBR SRO 1429(I)/2025: https://download1.fbr.gov.pk/SROs/2025858833282SRO1429DATED04-08-2025.pdf . Describes online marketplace/intermediary/courier withholding and reporting mechanics; check subsequent amendments before operational use.
3. FBR Income Tax Ordinance collection: https://www.fbr.gov.pk/categ/income-tax-ordinance/326 and official e-commerce explanatory circular https://download1.fbr.gov.pk/Docs/2025841183918948CircularNo01of2025-26IncomeTax.pdf . Withholding is distinct from buyer-facing sales tax; the 2025 circular alone is not proof of unchanged November 2026 rates.
4. PRA official service-classification schedule: https://reg.pra.punjab.gov.pk/NewsDirectory/Downloads/SalesTaxAct2012/First%20schedule%20%28Classification%20of%20Services%29.pdf . Commission agents are a classified service. This classification list alone does not prove the applicable current rate or that MilJor belongs in that category. Current Punjab Act/Second Schedule and subsequent notifications must be verified; attempted main PRA/Punjab-law page fetches timed out.

Do not blindly apply a blanket 18%, 16%, 2% or zero to every order. The implementer should draft an effective-dated, source-linked decision matrix for goods, platform services/commission, separately supplied delivery, processing and seller/payment withholding. Confirm who supplies each component and which actor actually withholds; prevent charging/deducting the same tax twice if the provider already withholds it. Preserve gross customer charges separately from seller deductions and historical immutable invoices/refund rules.

Only factual unknowns should be requested from the owner when absent from authorized records: legal business identity/registration status (NTN/STRN/PRA, if any), agency versus principal/reseller model and relevant supplier/product classifications. Unknown registration is not proof of exemption. Prepare a practical classification summary for qualified Pakistan tax review before live tax collection/release; do not invent an accountable approval or ask the nontechnical owner to choose a legal rate. Existing isolated test contracts can continue under their explicit test-only scope; no production B6 approval is created by this research.

## Current status

Temporary HTTPS preflight PASS; fresh SMTP provider acceptance PASS. Genuine Safepay capture/public webhook, inbox confirmation and resolved production tax applicability remain incomplete. Main merge and original local integration were not performed. Existing protected/UCP/B6 invariants remain; no new blanket release approval. The owner should next receive a prepared exact dashboard callback instruction, an identifiable inbox confirmation request, and simple business-fact questions only if genuinely required. CAN START NEXT PHASE: NO.
# 2026-11-17 — Owner inbox confirmation and live isolated callback preparation

Owner explicitly confirmed receipt of the identifiable test email in this conversation. Outbox28 / MILJOR-INBOX-1711 therefore has **manual owner-confirmed inbox receipt evidence**; this is not a fabricated SMTP delivery callback and does not change the outbox's provider-acceptance state. The controlled inbox receipt gate is verified for this test notification only.

Prepared a temporary runtime-only callback helper under ignored `backend/artifacts/sandbox-callback-session.cjs`. It privately loads existing sandbox configuration, asserts actual `miljor_test_db`, binds the existing application only to127.0.0.1:5417, and exposes a separate narrow bridge on127.0.0.1:5418. Only exact POST `/api/v1/webhooks/safepay` forwards unchanged buffered bytes and allowlisted signature/event headers to the canonical handler; healthGET is diagnostic and other application paths return404. B6 flags remain false, scheduler is not started, email is mock for backend events, external money execution false, JWT/OTP keys disposable, and the backend stops after45minutes. This is an operational verification helper, not a new production payment engine.

Local and public checks observed: health200, admin404, orders404; POST invalid signature returned401 / INVALID_WEBHOOK_SIGNATURE through the real application handler. Public temporary base is https://firmware-grande-arcade-lightbox.trycloudflare.com, with callback path appended. Actual application expiry is2026-11-17T13:22:57.862Z; hostname lifetime/uptime is not guaranteed. Backend exec session77818; tunnel session61232. The tunnel is task-owned; stop it and the backend after verification. If the session expires, start a new isolated session/tunnel and replace the sandbox endpoint; do not reuse an expired URL. No genuine provider event/capture has been received or claimed by these checks, and no test payment/order was modified by the invalid-signature request.

Next owner action: sandbox dashboard Developers > Endpoints > Add an endpoint, enter the exact public callback URL, then inspect Details/event choices. Official guide: https://safepay-docs.netlify.app/developers/webhooks/overview/ . Do not use the live dashboard, rotate existing API keys or publish secrets. Genuine signed callback/capture, tax applicability, main merge and original local source integration remain pending. No protected database or original frontend was modified. CAN START NEXT PHASE: NO.

---

# 2026-11-17 — Genuine Safepay Sandbox Capture, Live `payment:created` Webhook & Reconciliation Closure (PR #53)

## 1. Live Provider Compatibility Fixes (`safepayAdapter.js`, `safepayCheckoutService.js`, `procurementDeliveryPaymentService.js`, `procurementLineReceiptService.js`)
Real Safepay sandbox `payment:created 1.0.0` webhook deliveries revealed three schema/signature behaviors that differed from synthetic test payloads:
1. **Envelope Signing (`safepayAdapter.verifyWebhookSignature`):** Safepay v1 webhooks wrap `{ data: { type, token, notification, ... } }` and sign `JSON.stringify(payload.data)` with `HMAC-SHA512` (`x-sfpy-signature`, 128-char hex) rather than the outer envelope. `verifyWebhookSignature` now verifies `HMAC-SHA512(secret, rawBody)` first and falls back to `HMAC-SHA512(secret, JSON.stringify(parsed.data))` when `parsed.data` is a plain object.
2. **Envelope Metadata (`safepayCheckoutService.processWebhookEvent`):** `type` (`payment:created`) and `token` (`event_id`) reside under `parsedPayload.data` when `x-sfpy-event-id` / `x-sfpy-event-type` headers are omitted. `processWebhookEvent` now extracts `envelopeData?.token` and `envelopeData?.type` before falling back.
3. **Nested Notification & Allowlists (`safepayCheckoutService.js`, `procurementDeliveryPaymentService.js`, `procurementLineReceiptService.js`):** Normalized `parsedPayload.notification || parsedPayload.data?.notification || parsedPayload.data || parsedPayload`; required `effectiveEventType` in `['payment:created','payment.created']` AND `normalizedProviderState === 'PAID'` (non-PAID states record `payment:created:<STATE>` without mutating payments; `net` fallback is refused on `payment:created`; PII `user` is excluded from `payments.provider_response`); added `'payment:created','payment.created'` to `payment_webhook_events.event_type` allowlists.

## 2. Genuine Provider-Originated Safepay Sandbox Capture & Public Callback (`miljor_test_db` ONLY)
- **Tunnel & Bridge:** `cloudflared` HTTP/2 tunnel (`https://waiver-select-salary-getting.trycloudflare.com`) -> narrow local bridge (`127.0.0.1:5418`, forwarding only `POST /api/v1/webhooks/safepay`) -> isolated `miljor_test_db` backend (`127.0.0.1:5417`, `gates=false`, `email_mode=mock`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`).
  - Public preflight: `GET /health` -> `200` (`database: "miljor_test_db"`), `GET /api/v1/admin` -> `404`, invalid-signature `POST /api/v1/webhooks/safepay` -> `401 INVALID_WEBHOOK_SIGNATURE`.
- **Safepay Sandbox Dashboard Configuration:** Updated `https://sandbox.api.getsafepay.com/dashboard/developers/endpoints` Row 0 to `https://waiver-select-salary-getting.trycloudflare.com/api/v1/webhooks/safepay` with `payment:created (1.0.0)`, `refund:created (1.0.0)`, and `error:occurred (1.0.0)` subscribed (unrelated settings/secrets preserved).
- **Genuine Sandbox Capture + Live `payment:created` Webhook (Order `234` / `MJQ-b7fa0a34989b`, separate from synthetic evidence):**
  - Tracker: `track_10e2ea33-2376-4d73-82b3-1146b6da9327`, Rs. `355.00` PKR (`300.00` subtotal + `25.00` delivery + `30.00` buyer platform fee), dummy card `5200 0000 0000 1096`.
  - Safepay delivered `payment:created` (`event_id: DBU6S15L2AHS7395PKC0`) with valid `x-sfpy-signature` -> **`200 OK`** (`2026-11-17T15:08:51.599Z`).
  - `miljor_test_db` verified state:
    - `orders.id=234`: `payment_status='PAID'`, `order_status='PAID'`, `fulfillment_status='AWAITING_SUPPLIER_ACKNOWLEDGEMENT'`.
    - `payment_attempts.id=112`: `status='COMPLETED'`.
    - `payments.id=170`: `payment_code='PAY-0a34989b-1516'`, `amount='355.00'`, `buyer_fee='30.00'`, `status='PAID'`, `escrow_status='HELD_IN_ESCROW'`, `provider_response` records `provider_fee='22.49'`, `provider_net='332.51'`, `provider_reference='479183'`, `provider_state='PAID'` (no PII).
    - `payment_webhook_events.id=98`: `event_id='DBU6S15L2AHS7395PKC0'`, `event_type='payment:created'`, `processed_status='PROCESSED'`.
    - `invoices.id=109`: `invoice_number='INV-2026-000234'`, `total_amount='355.00'`, `status='ISSUED'`.
    - `supplier_inventory_allocations` (`ORDER_DIRECT`, `reference_id=234`): 2 rows `status='COMMITTED'`.
  - Live `error:occurred` webhooks (`DBU6Q8LL2AHS7395PK70`, `DBU6R4DL2AHS7395PK9G`) also arrived with valid signatures -> `200 OK` (`PROCESSED`, zero order/payment mutation).
  - Idempotent reconciliation check on Order `234`: `reconcilePaymentWithProvider` returned `already_paid: true`, `payments` count remained `1`.
- **Genuine Sandbox Capture + Authenticated Reconciliation Recovery (Order `231` / `MJQ-37a661b05ba7`):**
  - Tracker `track_7e276246-636e-4b87-9399-090ebaa557b9` completed on Safepay (`TRACKER_ENDED`, `has_txn=true`) prior to the `data`-envelope signature fix; `reconcilePaymentWithProvider({ orderId: 231 })` verified `TRACKER_ENDED` directly with Safepay's API and transitioned Order `231` to `PAID` (`payments.id=171`, `PAY-61b05ba7-7806`, `HELD_IN_ESCROW`).

## 3. Automated Test Gates & Protected Database Verification
- `node --test tests/safepay_payment_created_webhook.test.js tests/spec_code_collision_retry.test.js`: **14/14 PASS** (8/8 `safepay_payment_created_webhook` including `{ data: { type, token, notification } }` `HMAC-SHA512(data)` positive/negative + 6/6 `spec_code_collision_retry`).
- `p0_safepay_signed_http_acceptance.js` (`miljor_test_db`, synthetic key): **5/5 PASS** (note: synthetic signed HTTP acceptance, separate from genuine provider evidence above).
- **Protected Databases:** `miljor_db` (`orders: 0, payments: 0`), `miljor_sandbox_db` (`orders: 0, payments: 0`) — 100% untouched.
- **Email Inbox:** Already verified (`outbox 28`, subject `MilJor | Inbox verification 17 Nov 2026`, ref `MILJOR-INBOX-1711`).

## 4. Remaining Blocker & Release Decision
- **Pakistan Tax Policy (`MILJOR_PAKISTAN_TAX_CLASSIFICATION_DRAFT.md`):** Remains `DRAFT / AWAITING QUALIFIED TAX REVIEW & OWNER BUSINESS FACTS` (NTN/STRN/PRA registration, intermediary vs. principal role, and Punjab/Lahore supply scope).
- **PR #53 Status:** **RETAINED AS DRAFT** (not merged to `main` and not integrated into `MilJor Project` until accountable tax policy approval and exact-head CI pass). Temporary tunnel/callback daemons stopped cleanly. `CAN START NEXT PHASE: NO`.
