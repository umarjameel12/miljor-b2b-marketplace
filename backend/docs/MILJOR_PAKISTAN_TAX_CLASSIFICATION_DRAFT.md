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

## 2. Component-by-Component Classification Matrix

| Commercial Component | Legal Classification | Responsible Taxing Authority | Treatment / Withholding Considerations | Current Platform Implementation |
|---|---|---|---|---|
| **1. Merchandise (Food & Agricultural Staples)** | Supply of goods (taxable vs. Sixth Schedule exempt / zero-rated depending on unprocessed vs. branded/packaged food classification & supplier STRN status) | **FBR** (Sales Tax Act, 1990) | Cannot apply a blanket 18% or 0% rate across all SKUs; depends on SKU classification (e.g., unprocessed bulk vs. branded packaged food) and whether supplier is STRN-registered / Tier-1. | Preserved as immutable line-item `subtotal_amount` per SKU; isolated test contract keeps `tax_calculated = false` (`0.00`). |
| **2. Platform Commission & Buyer Processing Fee** | Service fee / commission agent / digital marketplace fee | **PRA** (Punjab Sales Tax on Services Act, 2012 — Lahore-first operations) | Classified service under PRA First Schedule; applicable Punjab sales tax on services depends on MilJor PRA registration and Second Schedule rate/exemption at effective date. | Commission (`supplier_commission_percent` snapshot) & `buyer_platform_fee` stored separately as exact decimals; never commingled with merchandise subtotal. |
| **3. Delivery & Supplemental Reattempt Delivery Fees** | Delivery / logistics / courier service (separately supplied service vs. ancillary to goods) | **PRA** (freight/courier/logistics service in Punjab) and/or **FBR** (if bundled by principal supplier) | Depends on whether delivery is supplied by MilJor, a third-party courier, or the goods supplier, and whether individual/clustered/express fees are invoiced separately. | Locked per order (`delivery_fee`) and separately for buyer-approved reattempts (`procurement_delivery_payment_contracts`). |
| **4. Payment Gateway / Intermediary Withholding (Safepay / Banks)** | Income-tax & sales-tax withholding by payment intermediary / courier on digital orders | **FBR** (SRO 1429(I)/2025 & Income Tax Circular 01 of 2025-26) | Must prevent double-withholding: if Safepay/acquiring bank already deducts statutory e-commerce withholding from settlement, MilJor must not deduct the same withholding again from supplier payout. | Gross customer charge is preserved separately from `provider_fee` / `provider_net` and supplier `commission_amount`. |
| **5. Full & Partial Refunds / Shortages (e.g. 100/80/20)** | Credit note / adjustment of consideration | **FBR / PRA** | Tax adjustment follows the refunded merchandise vs. retained/disputed delivery fee basis; historical issued invoices remain immutable, with adjustments recorded via linked credit/refund records. | `invoiceService` preserves immutable issued invoices; `procurementSettlementReviewService` separates accepted merchandise from disputed delivery/processing fees. |

---

## 3. Simple Business Facts Required for Qualified Tax Sign-Off

*(Only factual business inputs are needed from the owner; no technical tax rate guessing is requested from the owner.)*

1. **Business Registration Status:** Does MilJor currently hold NTN, FBR Sales Tax Registration (STRN), or Punjab Revenue Authority (PRA) registration? *(Unknown registration is not treated as tax exemption.)*
2. **Operating Model:** Does MilJor act strictly as an **intermediary/marketplace** connecting independent B2B suppliers to buyers (agent/commission model), or as a **principal/reseller** taking title to the goods?
3. **Supplier & Delivery Scope:** Are participating Lahore suppliers STRN-registered wholesalers/mills, and is delivery performed by suppliers themselves or by third-party couriers/MilJor?
