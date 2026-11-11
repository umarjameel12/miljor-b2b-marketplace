# MILJOR — SECURITY, PRIVACY & COMPLIANCE SPECIFICATION
**Document ID:** `MILJOR-DOC-SEC-034`  
**Active Migration:** `034_supplier_owned_products_skus_and_immutable_pools.sql`  
**Status:** Production Baseline

---

## 1. Authentication & Password Recovery Security

1. **JWT Session Tokens:** Signed with `JWT_SECRET`; role (`BUYER`, `SUPPLIER`, `ADMIN`) and user status are verified server-side on every protected request via `authMiddleware.js`.
2. **Cryptographic OTP Verification & Password Recovery (Migration `031`):**
   - 6-digit OTPs generated via `crypto.randomInt`, hashed with SHA-256 + per-challenge salt before storage in `email_verifications`.
   - Enumeration-safe `POST /api/v1/auth/forgot-password`: Returns identical generic HTTP `200` message regardless of whether the email exists.
   - Strict 60-second resend cooldown (`429 OTP_COOLDOWN_ACTIVE`) and max 5 verification attempts per challenge (`429 MAX_ATTEMPTS_EXCEEDED`).
   - All existing sessions invalidated (`password_changed_at` updated) upon password reset completion.

---

## 2. Role-Based Access Control (RBAC) & Resource Ownership Isolation

| Domain Action | `BUYER` | `SUPPLIER` (Unverified) | `SUPPLIER` (Verified) | `ADMIN` |
|---|---|---|---|---|
| View public catalog & active pools | Allowed | Allowed | Allowed | Allowed |
| Submit `NEW_FAMILY` catalog request | `403` | Allowed (Own) | Allowed (Own) | `403` |
| Moderate (`approve`/`reject`) catalog request | `403` | `403` | `403` | Allowed |
| Direct `POST /api/v1/products` or `/specifications` | `403` | `403 DIRECT_CATALOG_CREATION_PROHIBITED` | `403 DIRECT_CATALOG_CREATION_PROHIBITED` | Allowed |
| Create/Edit/Publish Supplier Product & SKU | `403` | Allowed (Own Only) | Allowed (Own Only) | `403` |
| Create/Edit Commercial Listing (`/api/v1/listings`) | `403` | `403 SUPPLIER_NOT_VERIFIED` | Allowed (Own Only) | `403` |
| Create/Edit/Publish Regular Pool (`/api/v1/pools`) | `403` | `403 SUPPLIER_NOT_VERIFIED` | Allowed (Own Only) | **`403 SUPPLIER_CONSENT_REQUIRED`** |
| Approve/Reject Supplier Verification | `403` | `403` | `403` | Allowed |

---

## 3. Banking Data Encryption at Rest (`encryptionService.js`)

- **Algorithm:** `aes-256-gcm` with 96-bit random IV and 128-bit authentication tag.
- **Storage Envelope:** `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
- **Fail-Closed Key Validation:** Requires a 32-byte (64-hex-char) `BANK_DATA_ENCRYPTION_KEY`. Missing, weak, or malformed keys throw `ENCRYPTION_KEY_MISSING_OR_INVALID` without logging or writing plaintext.
- **Zero Implicit Legacy Plaintext Acceptance:** Normal repository reads (`supplierProfileRepository.findBySupplierId`) call `decrypt(cipher, { allowLegacy: false })`. Unencrypted legacy strings are rejected on normal application paths and can only be migrated via `migrateLegacyBankingRecord` using a verified `SUPER_ADMIN` capability token, writing an encrypted `v1:` envelope and a `LEGACY_BANK_DATA_MIGRATED` audit log entry without exposing plaintext.

---

## 4. Explicit API Response Field Allowlists

- `adminController.getPendingSuppliers()` uses an explicit SQL column allowlist (`SUPPLIER_ADMIN_ALLOWLIST`) rather than `SELECT sp.*`, ensuring raw `bank_iban` ciphertext is never serialized in admin queue responses (only `bank_iban_masked` and `bank_iban_configured` are returned).
- Public listing and pool endpoints never expose supplier NTN, STRN, CNIC, or banking fields.
