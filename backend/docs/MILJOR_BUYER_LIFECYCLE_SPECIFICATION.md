# MILJOR — BUYER LIFECYCLE, ONBOARDING & POOL PARTICIPATION SPECIFICATION
**Document ID:** `MILJOR-DOC-BUYER-034`  
**Active Migration:** `034_supplier_owned_products_skus_and_immutable_pools.sql`  
**Status:** Production Baseline

---

## 1. Frictionless Cluster-First Buyer Onboarding

MilJor separates geographic discovery from physical street-address collection so buyers can explore localized Lahore pools immediately upon registration:

1. **Mandatory at Registration (`POST /api/v1/auth/register`):**
   - `full_name`, `email`, `phone`, `password`, `business_name`, `business_type`
   - `base_cluster_id`: Must reference an active Lahore geographic cluster (`lahore_clusters.id`). Missing `base_cluster_id` fails with `422 BASE_CLUSTER_REQUIRED`.
2. **Optional at Registration (`delivery_address`):**
   - Buyers may register with **zero** street address rows in `buyer_delivery_addresses`.
   - If a voluntary `delivery_address` object is supplied during registration, it must be complete (`recipient_name`, `phone`, `address_line1`, `area_name`, `cluster_id`); partial addresses fail with `422 INCOMPLETE_ADDRESS`.
3. **Decoupled Profile Onboarding Flags (`GET /api/v1/auth/profile`):**
   - `authenticated: true`
   - `base_cluster_configured: Boolean(user.base_cluster_id)`
   - `delivery_address_available: Boolean(addresses.length > 0)`

---

## 2. Multi-Address Book Management

- Buyers can maintain multiple saved delivery addresses (`GET/POST/PUT/DELETE /api/v1/buyer/addresses`).
- Concurrency-safe default address promotion: Parent `users` row is locked (`SELECT id FROM users WHERE id = ? FOR UPDATE`) before mutating `is_default` flags, guaranteeing at most one default address per buyer under concurrent requests.
- Deleting the current default address automatically promotes the most recently updated remaining address to `is_default = 1`.

---

## 3. Location-Aware Pool Discovery & Filtering

- `GET /api/v1/pools?cluster_id=<id>` returns active pools that cover the buyer's selected Lahore cluster (`EXISTS` subquery on `pool_delivery_clusters` to guarantee zero duplicate pool rows).
- `GET /api/v1/pools?include_pickup=true` includes pools offering warehouse self-pickup (`pickup_available = 1`) even if the buyer's cluster is outside the pool's delivery cluster list.
- Every pool card and detail payload exposes:
  - Canonical Category, Product Family, Brand (`Unbranded` if `is_unbranded = 1`), Variety, Optional Grade, Pack Size & Unit (`25 kg`, `50 kg`, `16 L`).
  - Current reserved volume (`current_qty`), minimum target (`moq`), max capacity (`max_capacity`), and active volume tier price.
  - Pool participation cutoff (`scheduled_close_at` / `expires_at`) and supplier-committed delivery deadline (`promised_delivery_at`, 24–72h post-close).

---

## 4. Buyer Pool Reservation & Commitment Lifecycle

1. **Fulfillment Quote Generation (`POST /api/v1/fulfillment/quotes`):**
   - `PICKUP`: Works without a saved delivery address (`0.00 PKR` delivery fee).
   - `STANDARD_CLUSTERED` / `EXPRESS`: Requires a valid `delivery_address_id` in one of the pool's covered clusters (`422 DELIVERY_ADDRESS_REQUIRED` if missing).
2. **Joining a Pool / Reservation (`POST /api/v1/pools/:id/join`):**
   - Validates `quantity >= buyer_min_qty`, `current_qty + quantity <= max_capacity`, and discrete integer pack quantities (`FRACTIONAL_PACK_REJECTED` for fractional indivisible bags/tins/cartons).
   - Atomically increments `pools.current_qty` and recalculates the active tier price across all participants in the pool.
3. **Two-Stage Commitment & Final Settlement:**
   - **Stage 1 (20% Commitment):** Paid within `buyer_commitment_deadline` after pool reaches threshold and is confirmed by the supplier.
   - **Stage 2 (80% Settlement):** Paid prior to dispatch/delivery within the `promised_delivery_at` SLA window.
