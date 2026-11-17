# MilJor — Local Demonstration Guide & Rehearsal Evidence (2026-11-17)

> [!IMPORTANT]
> **Purpose:** Local platform demonstration only (`miljor_test_db`). This is **NOT** a commercial launch, **NOT** proof of tax registration/approval, and **NOT** live money movement (`ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `B6_TAX_POLICY_APPROVED=false`, `SAFEPAY_ENV=sandbox`).

---

## 1. Local Demo Addresses & Running Services

| Service | Address | Database / Mode | Status at Handoff |
|---|---|---|---|
| **Frontend (Original Reconciled)** | `http://127.0.0.1:3000/` | Proxies `/api` → `127.0.0.1:5517` (`NODE_ENV=test`, `DB_NAME=miljor_test_db`) | **RUNNING** (`MilJor Project`, single `Smart Procurement Hub` entry) |
| **Frontend (PR #53 Reference)** | `http://127.0.0.1:3100/` | Proxies `/api` → `127.0.0.1:5517` (`NODE_ENV=test`, `DB_NAME=miljor_test_db`) | **RUNNING** (`ChatGPT\MilJor`) |
| **Backend API (Isolated)** | `http://127.0.0.1:5517/` | `miljor_test_db`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `B6_*=false`, `TRANSACTIONAL_EMAIL_MODE=mock` | **RUNNING** |
| **Protected Databases** | MySQL `3306` | `miljor_db` (`orders=0, payments=0`), `miljor_sandbox_db` (`orders=0, payments=0`) | **UNTOUCHED / PRISTINE** |

---

## 2. Startup & Shutdown Instructions (Plain Language)

### Starting the Isolated Demo Manually
1. **Terminal 1 (Backend on port `5517` against `miljor_test_db`):**
   - Set `NODE_ENV=test`, `DB_HOST=127.0.0.1`, `DB_NAME=miljor_test_db`, `TEST_DB_NAME=miljor_test_db`, `PORT=5517`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `B6_FINANCIAL_GATE_ENABLED=false`, `B6_B5_INVENTORY_RECONCILED=false`, `B6_TAX_POLICY_APPROVED=false`, `TRANSACTIONAL_EMAIL_MODE=mock`, `SAFEPAY_ENV=sandbox`.
   - Load local `.env` and start `server.js` on `127.0.0.1:5517`.
2. **Terminal 2 (Frontend on port `3100`):**
   ```powershell
   cd frontend
   $env:NODE_ENV='test'; $env:DB_NAME='miljor_test_db'; $env:MILJOR_TEST_API_PORT='5517'
   npx vite --port 3100 --host 127.0.0.1
   ```
3. **Shutting Down:** Press `Ctrl+C` in both terminals (never kill unrelated processes on port `3000` or PR #54 MySQL instances).

---

## 3. Demo Roles & Access (Controlled `miljor_test_db` Accounts)

- **Buyer 1:** `demo-buyer1@miljor.test` (Lahore — Gulberg III verified address)
- **Buyer 2:** `demo-buyer2@miljor.test` (for multi-buyer collective group join)
- **Supplier 1:** `demo-supplier1@miljor.test` (Verified `STARTER_ACTIVE`, active Rice `SKU-RICE-25KG-5972` listing `#143`)
- **Admin:** `demo-admin@miljor.test` (`SUPER_ADMIN`)
- *(Passwords are never stored in tracked files; obtain or set via local `miljor_test_db` session tooling if needed.)*

---

## 4. Recommended 10–15 Minute Presentation Sequence

1. **Landing & Catalog (`/` → `/pools`, 2 min):**
   - Show unauthenticated landing page (`/`) and mobile/desktop responsiveness.
   - Log in as `demo-buyer1@miljor.test` → `/pools`. Point out the separation between **Live Wholesale Pools** (`MJ-POOL-0001`, Expired) and **Product Families (`62`)** (Rice, Chakki Atta, Daal Chana/Masoor/Moong/Mash, Cooking Oil, Sugar).
   - *Note:* Explain that **vegetables, fruit, meat, and dairy are excluded** from MilJor's initial Lahore scope, and note the recorded catalog discrepancy (`Milk Powder`, `FAM-MILK-POWDER`, id `58` under Bakery Ingredients).
2. **RFQ & Supplier Negotiation (`/procurement`, 4 min):**
   - **Changes controlled test data (`miljor_test_db`):** Buyer 1 creates and publishes a Rice RFQ (e.g., `5 bag`, `25kg bag`, Lahore) and invites Supplier 1.
   - Switch to `demo-supplier1@miljor.test` (`/supplier/dashboard`, `/supplier/catalog`, `/procurement`): show supplier catalog/SKU (`SKU-RICE-25KG-5972`), accept RFQ interest, and submit a product-level quote.
   - Switch back to `demo-buyer1@miljor.test`: view quote, compare offers, check Gulberg delivery cluster eligibility, and submit a numeric counteroffer.
   - Supplier accepts counteroffer and publishes revised quote v2; Buyer reviews **Seller-Specific Order Breakdown** showing price/spec locks and fee breakdown.
   - Click `Confirm reviewed terms through gated checkout` to demonstrate the **expected B6 safety gate** (`503 B6_FINANCIAL_GATE_BLOCKED` — checkout blocked because `B6_TAX_POLICY_APPROVED=false`).
3. **Collective Procurement (`/procurement`, 2 min):**
   - **Changes controlled test data (`miljor_test_db`):** Buyer 1 creates a Private Collective Group, sets join cutoff & minimum participating businesses (`2`), confirms quantity without payment, and invites `demo-buyer2@miljor.test`.
   - Switch to Buyer 2 → `My Collective Invitations` → `Confirm My Quantities (No Payment)`. Show explicit consent notice (*"no payment taken"*) and expected pre-cutoff supplier-bid gate (`409`).
4. **Recurring Procurement (`/procurement`, 2 min):**
   - **Changes controlled test data (`miljor_test_db`):** Buyer 1 creates a Weekly Recurring Contract (`EXPLICIT_PER_CYCLE`), activates with consent, previews 6 upcoming cycles, edits quantity on one cycle, skips a cycle, and toggles Pause/Resume. Point out `requires_explicit_buyer_payment: true` (no silent auto-charging).
5. **Retained Paid Sandbox Orders, Receipts & Internal Settlement (`/orders`, `/payment/return?order_id=231`, `/payment/return?order_id=234`, `/admin`, 3 min):**
   - **Read-only on retained records (do NOT reset or replay):** Log in as `demo-admin@miljor.test`:
     - Open `/payment/return?order_id=231` (`MJQ-37a661b05ba7`) and `/payment/return?order_id=234` (`MJQ-b7fa0a34989b`) to show `Captured (Safepay Sandbox)` (`PKR 355.00`, real sandbox tracker beacons).
     - Open `/orders` to show both orders in `DELIVERED / BUYER_CONFIRMED` status (`inv` + `supplier_payables` `39` and `38`, `ACCRUED`, net `PKR 317.50` each, `disbursed=0.00`).
     - Open `/admin` (`Procurement settlement reviews` — `"Refund and payout execution remains disabled"`, `/admin/verifications`, `/admin/catalog`) and demonstrate RBAC enforcement when an admin attempts buyer-only receipt actions (`403`).

---

## 5. Browser Rehearsal Results (`http://127.0.0.1:3100/`, 2026-11-17)

| Section | Area | Result | Observed Evidence & Notes |
|---|---|---|---|
| **A** | Entry & Dashboard | **PASS** | `/` desktop (`1280x800`) & mobile (`390x844`, no horizontal overflow); login redirect to `/pools`; nav + bell rendered. (Initial unauth `/auth/refresh` 401 and 2 external Unsplash `ERR_BLOCKED_BY_ORB` expected/non-blocking.) |
| **B** | Catalog & Product Selection | **PASS** | `/pools` (`62` families, `1` expired pool) & `/admin/catalog` (`8` categories) loaded; staple families present; `Milk Powder` (`FAM-MILK-POWDER`) discrepancy confirmed on `/pools` & `/admin/catalog` (absent from `/procurement` dropdown). |
| **C** | RFQ & Supplier Negotiation | **PASS / EXPECTED GATE** | Solo Rice RFQ `184` published → Quote `#102` v1 (`Rs. 22,750`) → Buyer counteroffer (`Rs. 4,200/bag`) → Supplier `ACCEPT` & Quote v2 (`Rs. 21,250`) → Breakdown (`Rs. 21,407.50`) → `Confirm reviewed terms` hit expected `503 B6_FINANCIAL_GATE_BLOCKED`. |
| **D** | Collective Procurement | **PASS / EXPECTED GATE** | Collective RFQ `185` → Group `#45` created → Buyer 1 & Buyer 2 (`demo-buyer2@miljor.test`) joined with `creates_payment=false`; pre-cutoff bid open returned expected `409`. |
| **E** | Recurring Procurement | **PASS** | Recurring RFQ `186` → Contract `15` (`WEEKLY`, `EXPLICIT_PER_CYCLE`) activated, 6 cycles scheduled, cycle `2026-12-28` edited (`5 → 7`), skipped, paused/resumed; premature due-draft returned expected `409`. |
| **F–G** | Delivery, Receipt, Invoice & Settlement | **PASS / EXPECTED GATE** | Retained Orders `231` & `234` verified via `/orders`, `/payment/return?order_id=231|234`, and `/admin` (`PAID`, `DELIVERED`, `BUYER_CONFIRMED`, `PKR 355.00`, `DISBURSEMENT DISABLED`); admin buyer-receipt action blocked with `403`. |
| **H** | Notifications (initial rehearsal; superseded by Section 7 verification) | **PARTIAL AT INITIAL HANDOFF** | Bell & preferences rendered cleanly per role with zero cross-buyer leak. `procurement_notifications` queued `10+` events (`PENDING`); in-app unread count stays `0` because `NODE_ENV=test` demo backend does not run the background dispatcher. |

---

## 6. Known Limitations, Honest Framing & Deferred Items

- **Sandbox & Simulated Records:** Orders `231` and `234` reflect controlled test fulfillment records paired with genuine Safepay **sandbox** captures — **not** physical commercial deliveries or live money movement.
- **Unified Procurement Hub Entry:** All active buyer CTAs (`LandingPage.jsx`, footer in `App.jsx`, `SupplierSubscriptionPage.jsx`) now point directly to `/procurement` (`Smart Procurement Hub`); `/demand-requests` and `/rfqs` safely redirect to `/procurement`. Any buyer-owned legacy `demand_pool_requests` appear inside `/procurement` under `Legacy Demand Requests (Unconverted)` with `Review & Convert to Draft` (deduplicated once converted).
- **Unresolved / Deferred:** MilJor is currently unregistered; commercial Pakistan FBR/PRA tax classification (`MILJOR_PAKISTAN_TAX_CLASSIFICATION_DRAFT.md`), qualified tax review, `B6_TAX_POLICY_APPROVED=true`, PR #53 merge to `main`, and market launch remain **deferred**.
- **Catalog Discrepancy:** `Milk Powder` (`id: 58`, `FAM-MILK-POWDER` under `Bakery Ingredients`) remains in `catalog_product_families` and is flagged for governance review without silent deletion.
- **Recovery for Common Demo Issues:**
  - *503 on Checkout:* Expected B6 gate (`B6_TAX_POLICY_APPROVED=false`); explain safety control and show retained Orders `231`/`234` at `/payment/return?order_id=234`.
  - *Recurring Button Covered by Mobile/Bottom Nav:* Scroll slightly before clicking `Create Recurring Schedule`.
  - *0 Unread Notifications:* Check read state and the scoped demo helper. NODE_ENV=test does not automatically run the dispatcher; Section 7 records actual delivery verification and a local helper for the current checkout.


## 7. Completed Notification Rehearsal and Local Projection Helper

**Verified on source baseline `7f1baee1089297c23971f2dc96af5e67ba8d6d12`:** existing `notificationService.processPending` projected 27 original demo-account events into their intended inboxes. Buyer724:22 inbox/21 unread after one mark-read; Buyer725:2 inbox/2 unread; Supplier726:3 inbox/3 unread. Twelve email records remain QUEUED; no email sender worker was started, no external email/SMS sent and no actual inbox-delivery claim is made for this rehearsal.

Seven focused checks PASS (`node artifacts/pr53-demo-notifications.cjs`, final exit0): scoped canonical dispatcher; repeat-dispatch deduplication; exactly one correct-recipient projection per event; cross-buyer mark-read rejection; actual Chromium inbox/badge plus authenticated API list isolation for both buyers and supplier; buyer read-count decrement and deep-link navigation; unchanged protected database order/payment counts (both databases0/0 before/after).

The browser used canonical temporary test sessions created by sessionService, restored through the real refresh endpoint and revoked afterward. Existing passwords were not changed. Login/password behavior was not retested. No browser API responses were mocked. One unauthenticated harness API request initially returned expected401; the harness was corrected to use the actual frontend authenticated client.

The first manual projection lacked a trusted APP_FRONTEND_URL, causing12 email-queue failures while all27 in-app projections committed. The isolated helper origin was corrected to `http://127.0.0.1:3100`; existing five-minute retry backoff was honored without changing timestamps. Retry recovered all12 and retained27 unique inbox rows. Final rerun correctly processed0 already-sent events. No application defect, source patch or safety-gate change was necessary.

### Current-machine demonstration helper

A machine-local, ignored operational helper is available at `backend/artifacts/demo-notification-worker.cjs`. It delegates to the existing service; it is not a second notification system or a versioned fresh-clone startup script. It forces test database/mock mode and scopes selection to the four exact demo accounts. It projects in-app events and queues emails but never invokes email delivery, recurring generation or payment execution. It polls every5seconds and stops automatically after60minutes.

Run from the backend directory if it has stopped:

```powershell
node artifacts/demo-notification-worker.cjs
```

Use `--once` for one eligible batch. The helper loads the existing original-checkout .env privately and applies process-only overrides, including the trusted local frontend URL. Never copy secrets into a report or repurpose this helper for production. At this verification it was left running as PID16588 (agent process session9443); it expires after60minutes, and PID alone must be rechecked before any later process action. Stop its own terminal with Ctrl+C; do not stop unrelated services. Frontend3100/backend5517 remain available and port3000/PR54 were not touched.

Evidence: local ignored `backend/artifacts/demo-notifications-result.json` and screenshots `demo-notifications-buyer-724.png`, `demo-notifications-buyer-725.png`, `demo-notifications-supplier-726.png`. These machine-local artifacts are not tracked or guaranteed present in a fresh clone.

CI: the GitHub connector returned11 PR-triggered workflow runs for exact baseline7f1baee, all completed/success. Its filtered result is not independent verification of the previously reported14 total workflows/16 check-runs. No application source changed in this closure. Production checkout remains intentionally gated, milk-powder discrepancy retained, tax implementation/commercial launch/main merge/original frontend integration deferred. **DEMO STATUS: READY WITH LIMITATIONS.**

---

## 8. Owner 10–15 Minute Live Walkthrough (Read-Only Preferred)

Use separate browser profiles/incognito windows for Buyer, Supplier, and Admin so role switching never interrupts the flow.

| Step | Time | Role / Account | Exact Page | Record & Action | What Audience Observes | Presenter Line (Say This) | Data Impact | Expected Gate / Fallback |
|---|---|---|---|---|---|---|---|---|
| **A. Intro & Catalog** | 2m | `demo-buyer1@miljor.test` | `/` → `/pools` | Open `/`, log in, view `Live Wholesale Pools` & `Product Families (62)` | Clean separation between live pools vs. 62 MilJor-governed families (Rice, Atta, Pulses, Oil, Sugar). Vegetables/fruit/meat/dairy excluded; `Milk Powder` (`FAM-MILK-POWDER`) is a recorded discrepancy. | *"MilJor is a Lahore-first B2B food-staples marketplace connecting buyers and suppliers on commission without owning inventory."* | Read-only | If an image fails to load from Unsplash, ignore; catalog data is local. |
| **B. RFQ & Negotiation** | 3m | `demo-buyer1@miljor.test` → `demo-supplier1@miljor.test` | `/procurement` | Open Request `184` (`OPEN`), click `View quotes` / `Compare offers` for Quote `102` (v2, Rs. 21,250), open `Review Seller-Specific Order Breakdown` | Price/spec lock to `SKU-RICE-25KG-5972`, counteroffer `ACCEPT` history (`v1 → v2`), and exact breakdown (`Rs. 21,407.50` incl. `Rs. 157.50` buyer fee; supplier net `Rs. 20,475.00`). Click `Confirm reviewed terms` to show `503 B6_FINANCIAL_GATE_BLOCKED`. | *"Buyers and suppliers negotiate transparently with locked specs, and checkout stays safely gated until commercial tax approval is enabled."* | Read-only (unless creating a new RFQ) | Expected `503 B6_FINANCIAL_GATE_BLOCKED` on checkout. Use Step E for paid order screens. |
| **C. Collective Buying** | 2m | `demo-buyer1@miljor.test` | `/procurement` | Open Collective Request `185` / Group `45` (`FORMING`) | Buyer 1 (`5`) and Buyer 2 (`10`) joined independently; explicit notice *"no payment taken"*; cutoff visibility. | *"Businesses pool demand together without losing individual consent—joining never silently charges anyone."* | Read-only | Pre-cutoff `Open supplier bids` returns expected `409`. |
| **D. Recurring Procurement** | 2m | `demo-buyer1@miljor.test` | `/procurement` | Open Recurring Contract `15` (`ACTIVE`) | Weekly schedule, 6 upcoming cycles, edit/skip/pause/resume controls, `requires_explicit_buyer_payment: true`. | *"Recurring buyers set a schedule once, adjust or skip cycles anytime, and still approve every payment explicitly."* | Read-only | Premature `Prepare Due Shopping Draft` returns expected `409`. |
| **E. Paid Sandbox, Receipt & Settlement** | 3m | `demo-admin@miljor.test` | `/payment/return?order_id=234` → `/orders` → `/admin` | Open `/payment/return?order_id=234` & `231`, then `/orders`, then `/admin` (`Procurement settlement reviews`) | Controlled test orders `231` & `234`: `Captured (Safepay Sandbox)` (`PKR 355.00`), `DELIVERED / BUYER_CONFIRMED`, internal payables `39` & `38` (`ACCRUED`, net `PKR 317.50` each, `disbursed=0.00`). | *"These are controlled sandbox payment and test fulfillment records showing full fee transparency; external bank payouts remain disabled."* | Read-only (do NOT reset) | Admin cannot impersonate buyer receipt (`403` RBAC). Never describe as physical delivery. |
| **F. Notifications & Close** | 1–2m | `demo-buyer1@miljor.test` | `/pools` or `/procurement` | Click Notifications bell (`Notifications`) | Real event-driven inbox (historically 22 notifications / 21 unread for Buyer 1), deep links, strict recipient isolation. | *"Every quote, counteroffer, and group invite triggers an isolated notification, while commercial launch and tax rollout remain intentionally deferred."* | Read-only (mark-read mutates `is_read`) | If unread is `0`, show existing notification history. |

---

## 9. Presenter Notes & Q&A (Simple English / Roman Urdu)

- **MilJor kya problem solve karta hai?** Lahore ke B2B buyers (restaurants, kiryana, bakeries) aur wholesalers ko ek structured platform par lata hai jahan specs, quantities, delivery, aur price negotiation clear aur traceable hoti hai.
- **MilJor revenue kaise kamata hai?** Commission-based intermediary model: MilJor khud maal khareed kar nahi bechta; verified suppliers aur buyers ko connect karta hai aur agreed commission / buyer platform fee leta hai.
- **Kya MilJor apni inventory rakhta hai?** Nahi. Stock suppliers ke paas rehta hai; MilJor sirf verified supplier listings aur allocations track karta hai.
- **Group buying mein har buyer kaise protected rehta hai?** Har buyer apni quantity aur consent khud confirm karta hai (`creates_payment=false`). Kisi doosre buyer ke join karne se aap par auto-charge nahi hota.
- **Recurring orders mein payment kaise hoti hai?** Har cycle par explicit buyer approval zaroori hai (`EXPLICIT_PER_CYCLE`); koi silent auto-debit nahi hota.
- **Delivery charges aur fees kaise dikhte hain?** Item subtotal, delivery fee, buyer platform fee, aur supplier commission alag-alag exact decimal mein order breakdown aur immutable invoice par dikhte hain.
- **Agar delivery kam aaye ya dispute ho to?** Buyer line-by-line accepted/disputed quantity record karta hai (`100/80/20` rule); accepted maal ka hisab alag hota hai aur disputed delivery/processing fees admin review ke liye hold par rehti hain.
- **Kya yeh payments real hain ya sandbox?** Safepay **Sandbox** test payments hain (`ALLOW_EXTERNAL_MONEY_MOVEMENT=false`). Koi live bank charge ya payout nahi ho raha.
- **Kya supplier ko paisay transfer ho chuke hain?** Nahi. Internal payable (`39`, `38`, PKR `317.50` net) `ACCRUED` state mein hai; `disbursed=0.00` aur external payout disabled hai.
- **Kya platform commercially launch ho gaya hai?** Nahi. Business abhi unregistered hai aur yeh sirf local demonstration hai.
- **Launch se pehle kya baqi hai?** Business registration, qualified Pakistan FBR/PRA tax review aur policy approval (`B6_TAX_POLICY_APPROVED`), PR #53 merge to `main`, aur production deployment.

---

## 10. 2-Minute Pre-Demo Checklist & Recovery Card

### Pre-Demo Checklist (2 Minutes)
1. [ ] Open `http://127.0.0.1:3100/` — landing page loads cleanly.
2. [ ] Check `http://127.0.0.1:3100/api/v1/catalog/categories` returns `{"success":true,...}` (confirms backend `5517` + `miljor_test_db`).
3. [ ] Confirm `miljor_db` and `miljor_sandbox_db` remain untouched (`orders=0, payments=0`) and `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`.
4. [ ] Verify 3 separate browser windows/profiles logged in (`demo-buyer1@miljor.test`, `demo-supplier1@miljor.test`, `demo-admin@miljor.test`).
5. [ ] Verify retained records open: Request `184` / Quote `102`, Group `45`, Contract `15`, Orders `231` & `234`.
6. [ ] Check `demo-notification-worker.cjs` is running if live unread increment is desired (note 60-minute auto-stop).
7. [ ] Confirm `B6_TAX_POLICY_APPROVED=false` (checkout button shows expected `503` block).
8. [ ] Open the offline backup screenshot pack (`demo_backup_pack/index.html`) in a background tab as instant fallback.

### Recovery Card (Non-Destructive)
- **Frontend/Backend stopped:** Restart backend on `5517` (`miljor_test_db`) and Vite on `3100` (`MILJOR_TEST_API_PORT=5517`) per Section 2.
- **Session expired:** Re-login at `/login` in that role's browser profile (never reset passwords or touch `miljor_db`).
- **Notification helper expired (after 60 min):** Run `node artifacts/demo-notification-worker.cjs` from `backend/`.
- **Unread count is `0`:** Show existing notification history inside the bell drawer; do not fabricate events.
- **Expected `503` checkout block:** Explain it as the live safety gate (`B6_TAX_POLICY_APPROVED=false`) and switch to `/payment/return?order_id=234`.
- **Unexpected page/network failure:** Switch immediately to the offline backup screenshot pack (`demo_backup_pack/index.html`).

---

## 11. Offline Backup Screenshot Pack Index (Artifact Directory — Untracked)

Stored locally at `C:\Users\Umar Jameel\.gemini\antigravity\brain\6e2fd569-4ede-458a-9368-d34bc2a20f55\demo_backup_pack\index.html`:
1. `01_buyer_catalog_pools.png` — Buyer `/pools` (Live pools vs. 62 Product Families)
2. `02_rfq_184_quote_102_v2.png` — Buyer `/procurement` (RFQ 184 & Quote 102 v2)
3. `03_rfq_184_fee_breakdown.png` — Buyer `/procurement` (Reviewed Breakdown & B6 Gate)
4. `04_collective_group_45.png` — Buyer `/procurement` (Collective Group 45 & Consent)
5. `05_recurring_contract_15.png` — Buyer `/procurement` (Recurring Contract 15 & Cycles)
6. `06_retained_order_234_sandbox.png` — Admin `/payment/return?order_id=234` (Safepay Sandbox Capture)
7. `07_retained_orders_admin_231_234.png` — Admin `/orders` (Orders 231 & 234 `DELIVERED / BUYER_CONFIRMED`)
8. `08_buyer_notifications_inbox.png` — Buyer `/pools` (Notification Inbox & Unread Count)

