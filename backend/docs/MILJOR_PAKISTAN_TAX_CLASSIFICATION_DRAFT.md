# MilJor B2B Marketplace — Pakistan Tax & Commercial Classification Draft (Effective 2026-11-17)

> [!IMPORTANT]
> **Status:** `DRAFT / AWAITING QUALIFIED TAX REVIEW & OWNER BUSINESS FACTS`
> This document is a source-linked legal/commercial classification draft prepared from official Federal Board of Revenue (FBR) and Punjab Revenue Authority (PRA) publications. It is **NOT** legal tax sign-off and does **NOT** authorize enabling live tax collection (`B6_TAX_POLICY_APPROVED` remains `false`).

---

## 1. Authoritative Primary Sources Inspected

1. **Sales Tax Act, 1990 (consolidated & amended up to 30 June 2026):**
   - Official FBR text: `https://download1.fbr.gov.pk/Docs/20267171373418951SalesTaxAct1990updatedupto30.06.2026.pdf`
   - Governs supply of taxable goods vs. Sixth Schedule exempt/basic food items, digitally ordered supplies, online marketplace/intermediary obligations, and withholding under the Eleventh Schedule.
2. **FBR SRO 1429(I)/2025 (dated 4 August 2025):**
   - Official FBR SRO: `https://download1.fbr.gov.pk/SROs/2025858833282SRO1429DATED04-08-2025.pdf`
   - Governs online marketplace, payment intermediary, and courier withholding/reporting mechanics for digitally ordered goods.
3. **Income Tax Ordinance, 2001 & FBR Circular No. 01 of 2025-26 (E-Commerce):**
   - Collection: `https://www.fbr.gov.pk/categ/income-tax-ordinance/326`
   - Explanatory Circular: `https://download1.fbr.gov.pk/Docs/2025841183918948CircularNo01of2025-26IncomeTax.pdf`
   - Distinguishes income-tax withholding on digital/e-commerce payments (payment intermediary / courier collection) from buyer-facing sales tax.
4. **Punjab Sales Tax on Services Act, 2012 — First Schedule (Classification of Services):**
   - Official PRA download: `https://reg.pra.punjab.gov.pk/NewsDirectory/Downloads/SalesTaxAct2012/First%20schedule%20%28Classification%20of%20Services%29.pdf`
   - Classifies services rendered in Punjab (including commission agents, platform/intermediary services, and freight/courier/delivery services); exact current rates and exemptions require verification against the current Punjab Finance Act / Second Schedule.

---

## 2. Charge-by-Charge Classification Matrix (All 8 Required Categories)

| Charge Category | Commercial Nature | Jurisdiction | Classification & Unresolved Alternatives | Taxable Basis | Rate / Exemption | Collection Responsibility | Invoice Treatment | Effective Date & Policy Version | Evidence (Primary Sources) | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **1. Merchandise (Food & Agricultural Staples)** | Supply of B2B food/grocery goods (either by independent supplier via marketplace or by MilJor as principal — unresolved). | **FBR** (Sales Tax Act, 1990) | Supply of goods: taxable supplies vs. Sixth Schedule exempt unprocessed agricultural produce vs. packaged/branded/processed foods; Tier-1 / STRN status affects regime. | Per-SKU line merchandise subtotal (`subtotal_amount`, `DECIMAL(12,2)`). | **Unresolved** (cannot apply blanket 18% or 0%; depends on SKU schedule & supplier STRN). | Registered supplier (if agency) or MilJor (if principal), plus applicable marketplace/Eleventh Schedule rules. | Line-itemized `subtotal_amount` + explicit `tax_amount`; zero-tax test fixtures marked `tax_calculated: false`. | `2026-11-17` / `DRAFT-PK-TAX-V1` (test contract: `tax_calculated=false`) | Sales Tax Act, 1990 (up to 30 Jun 2026) | **Researched interpretation / Unresolved facts** |
| **2. Marketplace Commission / Intermediary Services** | B2B platform facilitation / commission charged to supplier (`supplier_commission_percent`). | **PRA** (Punjab Sales Tax on Services Act, 2012 — Lahore-first) | Classified service under PRA First Schedule (commission agent / digital intermediary service); alternative: out-of-scope if below threshold/unregistered, though unknown registration is not exemption. | Accepted merchandise amount (`accepted_merchandise_amount` × `supplier_commission_percent`). | **Unresolved** (requires current Punjab Finance Act / Second Schedule verification & MilJor PRA status). | MilJor (if PRA-registered service provider) or reverse-charge where applicable. | Separate from merchandise subtotal; recorded in `supplier_payables.commission_amount`. | `2026-11-17` / `DRAFT-PK-TAX-V1` | PRA First Schedule (Classification of Services) | **Researched interpretation / Unresolved facts** |
| **3. Delivery & Logistics Services** | Initial order delivery (`delivery_fee`) to buyer location. | **PRA** (Punjab services) and/or **FBR** (if ancillary to goods by principal) | Separately supplied courier/freight/logistics service vs. ancillary delivery bundled into goods consideration. | Order `delivery_fee` (`DECIMAL(12,2)`). | **Unresolved** (depends on whether supplier, third-party courier, or MilJor supplies delivery & PRA Second Schedule). | Actual service supplier (carrier/MilJor) or bundled goods supplier. | Disclosed separately as `delivery_fee` on `orders` and `invoices`. | `2026-11-17` / `DRAFT-PK-TAX-V1` | PRA First Schedule; Sales Tax Act, 1990 | **Researched interpretation / Unresolved facts** |
| **4. Supplemental Delivery & Reattempt Charges** | Buyer-approved redelivery / reattempt charges (`procurement_delivery_payment_contracts`). | **PRA** (logistics/delivery service in Punjab) | Separate post-order delivery/reattempt service contract; requires explicit buyer consent before payment. | Supplemental contract `amount` (`DECIMAL(12,2)`). | **Unresolved** (follows delivery service classification & PRA Second Schedule). | Service provider (supplier/courier/MilJor per contract). | Recorded as a distinct supplemental payment contract, never merged into original immutable invoice. | `2026-11-17` / `DRAFT-PK-TAX-V1` | PRA First Schedule; `procurementDeliveryPaymentService.js` | **Researched interpretation / Unresolved facts** |
| **5. Processing / Buyer Platform Fees** | Platform service/checkout fee charged to buyer (`buyer_platform_fee`). | **PRA** (digital/platform service in Punjab) | Platform/digital intermediation service fee; distinct from payment gateway MDR (`provider_fee`). | Order `buyer_platform_fee` (`DECIMAL(12,2)`). | **Unresolved** (requires PRA Second Schedule & MilJor PRA registration check). | MilJor (service provider). | Disclosed separately as `buyer_platform_fee` on `orders` and `invoices`. | `2026-11-17` / `DRAFT-PK-TAX-V1` | PRA First Schedule | **Researched interpretation / Unresolved facts** |
| **6. Withholding Obligations (Gateway / Courier / Marketplace)** | Income-tax & sales-tax withholding on digital e-commerce payments (Safepay / banks / couriers). | **FBR** (Income Tax Ordinance, 2001 & Sales Tax Act Eleventh Schedule) | Payment-intermediary & courier e-commerce withholding under SRO 1429(I)/2025 & Circular 01 of 2025-26; must prevent double withholding if Safepay/acquirer already withholds. | Gross payment / taxable consideration per statutory formula (not net gateway payout). | **Unresolved** (must verify November 2026 effective rates & whether Safepay withholds at settlement). | Payment intermediary (Safepay/bank), courier (COD), or prescribed withholding agent. | Gross customer charge preserved separately from `provider_fee` / `provider_net` and supplier `commission_amount`. | `2026-11-17` / `DRAFT-PK-TAX-V1` | FBR SRO 1429(I)/2025; Income Tax Circular 01 of 2025-26 | **Researched interpretation / Unresolved facts** |
| **7. Refunds, Credit Notes & Partial Acceptance (e.g. 100/80/20)** | Post-capture shortages, rejections, and partial/full refunds. | **FBR / PRA** | Adjustment of consideration / credit note reducing merchandise tax proportionally while holding disputed delivery/processing fees for admin review. | `refund_assessment_amount` (short/rejected merchandise) vs. held `delivery_fee` / `buyer_platform_fee`. | **Unresolved** (tax credit-note adjustment follows underlying merchandise/service tax rate). | Party that issued original tax invoice (supplier or MilJor). | Historical issued `invoices` remain immutable; adjustments recorded via `procurement_line_receipts`, `refund_obligations`, and `financial_holds`. | `2026-11-17` / `DRAFT-PK-TAX-V1` | Sales Tax Act, 1990; `procurementLineReceiptService.js` | **Researched interpretation / Unresolved facts** |
| **8. Scope Variations (Supplier STRN, Product Type, Role, Jurisdiction)** | Structural differences across B2B transactions. | **FBR & Provincial Authorities (PRA / SRB / KPRA / BRA)** | Unregistered vs. STRN-registered suppliers; exempt raw produce vs. taxable processed goods; agent vs. principal; Lahore/Punjab intra-province vs. inter-provincial supply. | Respective goods subtotal or service fee per jurisdiction rules. | **Unresolved** (requires verified business model & supplier onboarding facts). | Determined per transaction classification matrix once approved. | `invoice_snapshot_json` already captures `buyer`, `supplier.ntn`, `items`, `pricing.tax_amount`. | `2026-11-17` / `DRAFT-PK-TAX-V1` | Sales Tax Act, 1990; PRA First Schedule | **Unresolved** |

---

## 3. Application Tax-Readiness Inspection (Verified Against Codebase)

- **Fail-Closed Production Gate:** `procurementAwardService.js` and `procurementDeliveryPaymentService.js` enforce `B6_TAX_POLICY_APPROVED === 'true'` (returning `503 B6_FINANCIAL_GATE_BLOCKED` otherwise) and `miljor_test_db` isolation. Unresolved tax policy never silently becomes a production exemption.
- **Explicit Visibility & Immutable Snapshots:** `procurementAwardPolicy.js` (`sales_tax_calculated: false`), `procurementAwardService.js` (`tax_calculated: false`), and `invoiceService.js` (`subtotal_amount`, `delivery_fee`, `buyer_platform_fee`, `tax_amount`, `total_amount` in immutable `invoices` + `invoice_snapshot_json`) already separate every taxable base without commingling.
- **Partial Delivery & Disputed Fees:** `procurementLineReceiptService.js` computes `accepted_merchandise_amount`, `accepted_commission_amount`, and `accepted_supplier_net` on accepted merchandise while holding disputed delivery/processing fees for admin review.
- **Conclusion:** Existing application architecture satisfies the policy contract; **no speculative tax engine or code change is warranted** until qualified tax sign-off defines the exact effective-dated rules.

---

## 4. Review Package for a Qualified Pakistan Tax Professional

- **Known Facts (from repository & codebase):**
  - Lahore-first B2B collective food procurement marketplace (`MilJor`), PKR currency, Safepay payment gateway (`provider_fee` / `provider_net` tracked separately).
  - Separates merchandise subtotal, `delivery_fee`, supplemental reattempt contracts, `buyer_platform_fee`, and `supplier_commission_percent`.
  - Current test fixtures operate under `tax_calculated: false` (`tax_amount: 0.00`) with `B6_TAX_POLICY_APPROVED=false` and `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`.
- **Unanswered Factual Questions (Pending Owner Input):** See Section 5 below.
- **Specific Questions Requiring Professional Confirmation:**
  1. Based on MilJor's actual legal entity status (NTN/STRN/PRA), which SKUs in the 8 launch food categories fall under Sixth Schedule exemptions vs. standard/reduced Sales Tax Act 1990 rates?
  2. Under PRA's current Second Schedule / Punjab Finance Act, what exact Punjab Sales Tax on Services rate applies to MilJor's `supplier_commission_percent` and `buyer_platform_fee`, and to separately invoiced `delivery_fee` / supplemental reattempts?
  3. Under FBR SRO 1429(I)/2025 and current Income Tax Ordinance withholding rules (post-Circular 01 of 2025-26), does Safepay/acquiring bank withhold at settlement, and what reporting/withholding obligation remains on MilJor to avoid double withholding?
  4. What credit-note / adjustment documentation is required for partial deliveries (`100/80/20`) while keeping original issued invoices immutable?

---

## 5. Simple Factual Business Questions for the Owner

*(Only factual business inputs are needed; no tax rate guessing or legal drafting is requested.)*

1. **Registration Status:** Is MilJor registered as an individual business or a company, and are **NTN**, **FBR Sales Tax Registration (STRN)**, and **Punjab Revenue Authority (PRA)** registrations currently present, absent, or unknown? *(Unknown registration is not treated as tax exemption.)*
2. **Operating Model:** Does MilJor buy and resell goods itself (principal/reseller), or connect buyers and suppliers and earn commission (intermediary)?
3. **Product & Geographic Scope:** Which specific goods will initially be sold (e.g., raw bulk agricultural staples vs. packaged/processed foods), and are operations strictly limited to Lahore/Punjab or intended across provinces?
