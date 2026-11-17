# MilJor — Local Demonstration Guide & Rehearsal Evidence (2026-11-17)

> [!IMPORTANT]
> **Purpose:** Local platform demonstration only (`miljor_test_db`). This is **NOT** a commercial launch, **NOT** proof of tax registration/approval, and **NOT** live money movement (`ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `B6_TAX_POLICY_APPROVED=false`, `SAFEPAY_ENV=sandbox`).

---

## 1. Local Demo Addresses & Running Services

| Service | Address | Database / Mode | Status at Handoff |
|---|---|---|---|
| **Frontend (Isolated Vite)** | `http://127.0.0.1:3100/` | Proxies `/api` → `127.0.0.1:5517` (`NODE_ENV=test`, `DB_NAME=miljor_test_db`) | **RUNNING** (leaves existing port `3000` untouched) |
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
| **H** | Notifications | **PASS (with note)** | Bell & preferences rendered cleanly per role with zero cross-buyer leak. `procurement_notifications` queued `10+` events (`PENDING`); in-app unread count stays `0` because `NODE_ENV=test` demo backend does not run the background dispatcher. |

---

## 6. Known Limitations, Honest Framing & Deferred Items

- **Sandbox & Simulated Records:** Orders `231` and `234` reflect controlled test fulfillment records paired with genuine Safepay **sandbox** captures — **not** physical commercial deliveries or live money movement.
- **Unresolved / Deferred:** MilJor is currently unregistered; commercial Pakistan FBR/PRA tax classification (`MILJOR_PAKISTAN_TAX_CLASSIFICATION_DRAFT.md`), qualified tax review, `B6_TAX_POLICY_APPROVED=true`, PR #53 merge to `main`, and market launch remain **deferred**.
- **Catalog Discrepancy:** `Milk Powder` (`id: 58`, `FAM-MILK-POWDER` under `Bakery Ingredients`) remains in `catalog_product_families` and is flagged for governance review without silent deletion.
- **Recovery for Common Demo Issues:**
  - *503 on Checkout:* Expected B6 gate (`B6_TAX_POLICY_APPROVED=false`); explain safety control and show retained Orders `231`/`234` at `/payment/return?order_id=234`.
  - *Recurring Button Covered by Mobile/Bottom Nav:* Scroll slightly before clicking `Create Recurring Schedule`.
  - *0 Unread Notifications:* Expected in `NODE_ENV=test` (notifications queued in `procurement_notifications` without background email/worker dispatch).
