# MilJor — Master E2E Database Integrity & Isolation Report

**Date:** 2026-11-12  
**Protected Development Database:** `miljor_db`  
**Isolated Test Database:** `miljor_test_db`  
**Point-in-Time Verified Backups:**
- `backend/database/backups/miljor_db_backup_2026-11-12T03-10-49-652Z.sql` (275.9 KB, SHA256: `E2DB5CE4E17032FA6601C8B735EBDD1D3D9931A698286BA5440FACF52413A0A9`)
- `backend/database/backups/miljor_db_backup_2026-11-12T03-11-03-532Z.sql` (3,233.7 KB, SHA256: `0FEB7BFA831A03C4F817B939843F4134D7847C40911D5D789BD8B70ED26CC59B`)

---

## 1. Database Safety Audit & Isolation Guarantee

The MilJor protocol enforces strict isolation: all automated tests, dynamic fixtures, and mutation runs are executed strictly against `miljor_test_db`. `miljor_db` is protected and must remain 100% pristine throughout all test phases.

### Post-Run Verification Query
```sql
SELECT 
  (SELECT COUNT(*) FROM miljor_db.orders) as pristine_orders,
  (SELECT COUNT(*) FROM miljor_db.payments) as pristine_payments,
  (SELECT COUNT(*) FROM miljor_db.reservations) as pristine_reservations;
```

### Measured Actual Result
| Metric | Expected | Actual Measured | Verdict |
|:---|:---:|:---:|:---:|
| `miljor_db.orders` count | 0 | 0 | **PRISTINE** |
| `miljor_db.payments` count | 0 | 0 | **PRISTINE** |
| `miljor_db.reservations` count | 0 | 0 | **PRISTINE** |
| `miljor_db` schema writes | 0 | 0 | **PRISTINE** |
| Active database during runner | `miljor_test_db` | `miljor_test_db` | **ISOLATED** |

---

## 2. Financial Safety Verification

- **Safepay Sandbox Host:** `https://sandbox.api.getsafepay.com`
- **External Money Movement:** `ALLOW_EXTERNAL_MONEY_MOVEMENT=false` (enforced via `.env` and `paymentProviderService`)
- **HMAC Cryptographic Validation:** HMAC-SHA512 strictly over raw JSON body bytes (`safepayAdapter.verifyWebhookSignature`)
- **Refund Stub Safety:** Fails closed to `REFUND_PENDING_GATEWAY` without initiating real external banking settlement.
