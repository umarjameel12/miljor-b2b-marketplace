# MILJOR — DELIVERY, CLUSTER LOGISTICS & FULFILLMENT SPECIFICATION
**Document ID:** `MILJOR-DOC-DELIV-034`  
**Active Migration:** `034_supplier_owned_products_skus_and_immutable_pools.sql`  
**Status:** Production Baseline

---

## 1. Lahore Multi-Cluster Logistics Model

MilJor organizes commercial B2B delivery across Lahore using deterministic geographic commercial clusters (`lahore_clusters`):
- `LHR-NORTH-MANDI`: Akbari Mandi, Badami Bagh, Shahdara, Circular Road Wholesale Corridor
- `LHR-CENTRAL-GULBERG`: Gulberg, MM Alam Road, Liberty, Garden Town, Model Town, Jail Road
- `LHR-SOUTH-JOHAR`: Johar Town, Wapda Town, Valencia, Thokar Niaz Baig, Raiwind Corridor
- `LHR-EAST-DHA`: DHA Phases 1–8, Cantt, Barki Road, Bedian Road
- `LHR-WEST- IQBAL`: Allama Iqbal Town, Samanabad, Multan Road Industrial Corridor

---

## 2. Three Supported Fulfillment Modes

| Mode | Address Requirement | Pool Cluster Requirement | Pricing & Fee Structure |
|---|---|---|---|
| **`STANDARD_CLUSTERED`** | Requires a complete buyer delivery address (`buyer_delivery_addresses`) whose `cluster_id` is in the pool's `pool_delivery_clusters`. | Must be in `pool_delivery_clusters`. | Shared route efficiency discount (`25%` cluster route discount) + pool tier delivery subsidy (`0%`, `25%`, `50%`, `75%`, or `100%` FREE delivery at max tier). |
| **`EXPRESS`** | Requires a complete buyer delivery address in a supported pool cluster. | Must be in `pool_delivery_clusters`. | Dedicated direct vehicle dispatch (`1.6x` priority multiplier, zero cluster route discount). |
| **`PICKUP`** | **Zero buyer delivery address required.** Buyer collects directly from supplier warehouse/mill gate. | Requires `pools.pickup_available = 1`. Decoupled from destination delivery clusters. | `0.00 PKR` delivery fee (`final_delivery_fee = 0`, `is_free_delivery = true`). |

---

## 3. Supplier-Defined 24-to-72 Hour (1–3 Day) Pool Delivery SLA

### 3.1 Mandatory Timestamp Rule (Rules P6 & P7)
Every Regular Pool requires a supplier-defined `promised_delivery_at` (`DATETIME`) before publishing (`POST /api/v1/pools/:id/publish`).
- Relative to the pool's participation cutoff (`scheduled_close_at` / `expires_at`), `promised_delivery_at` must fall within:
  $$\text{scheduled\_close\_at} + 24\text{ hours} \le \text{promised\_delivery\_at} \le \text{scheduled\_close\_at} + 72\text{ hours}$$
- Offsets `< 24 hours` fail with `422 DELIVERY_SLA_OUT_OF_RANGE` (`subcode: 'DELIVERY_SLA_TOO_EARLY'`).
- Offsets `> 72 hours` fail with `422 DELIVERY_SLA_OUT_OF_RANGE` (`subcode: 'DELIVERY_SLA_TOO_LATE'`).
- Timestamps `<= scheduled_close_at` fail with `422 DELIVERY_SLA_OUT_OF_RANGE` (`subcode: 'DELIVERY_BEFORE_POOL_CLOSE'`).

### 3.2 Alignment Between Pool SLA & Fulfillment Quotes
When `fulfillmentService.generateQuote` generates a delivery quote for a pool that has `promised_delivery_at`:
- The quote's `estimated_delivery_start` and `estimated_delivery_end` are anchored directly to the pool's immutable `promised_delivery_at`, ensuring buyers see the exact supplier-committed delivery deadline across pool cards, pool detail pages, and checkout quotes.

---

## 4. Pool Coverage Policies & Immutability

- **`EXPLICIT_CLUSTERS`:** Pool serves the specific Lahore clusters stored in `pool_delivery_clusters`.
- **`PICKUP_ONLY`:** Pool has `pickup_available = 1` and zero delivery clusters.
- **`LEGACY_REVIEW_REQUIRED`:** Historical legacy pools lacking explicit cluster mappings are blocked from generating new delivery quotes (`422 POOL_DELIVERY_COVERAGE_UNCONFIGURED`) until reviewed.
- **Immutability After Publish:** Once a pool is published (`status = 'ACTIVE'`, `is_terms_locked = 1`), `PUT /api/v1/pools/:id/clusters` is permanently blocked (`422 POOL_TERMS_IMMUTABLE`), even if the pool has zero buyer reservations.
