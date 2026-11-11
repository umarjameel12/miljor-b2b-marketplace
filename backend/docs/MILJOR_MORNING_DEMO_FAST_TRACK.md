# MilJor — Morning Demo Fast Track (Independent of Antigravity Reconciliation)
Date: 2026-11-12. Branch contains a GET-only preflight; does **not** change business, payment or database logic. Main reconciliation owner continues PR #13 and B7/finance in separate branches.

## Immediate workflow to show
1. **Supplier** login -> `/supplier/catalog`: verify published supplier-owned physical SKU with stock.
2. **Supplier** -> `/supplier/pools`: create/publish a single demo Regular or Flash offer using existing authoritative API (no parallel implementation).
3. **Buyer** -> `/pools`: find supplier's active offer, check tier, availability, countdown and minimum quantity.
4. **Buyer** -> reservation/hold -> final confirmation -> `/orders`; stop before actual external payment unless a verified sandbox-only checkout is authorized and available.
5. **Supplier** -> existing fulfillment journey for a sandbox-paid test order, then **buyer** accepts delivery; show invoice/dispute only if this exact flow passes verification. Never mark a synthetic payment as provider-origin.
6. Refresh screens and verify quantities remain stable, no duplicate order and no other-tenant data. If a stage is unavailable, demonstrate the last verified stage honestly; do not simulate an order paid or delivery completed in the real database.

## Prerequisites and exact commands (local workstation, in repository root)
- Back up local uncommitted changes; run `git status --short`; no force reset or blind checkout.
- Create/configure `backend/.env` locally from `backend/.env.example` without committing secrets. Use **isolated demo** database `miljor_test_db`; never `miljor_db`. Keep `ALLOW_EXTERNAL_MONEY_MOVEMENT=false` and `SAFEPAY_ENV=sandbox`.
- Ensure MySQL 8 installed with approved *test-only* schema and demo fixtures. Do not run destructive regression against any persistent/protected database.
- In separate terminals, with dependencies installed from lockfiles:
```bash
cd backend && npm ci && npm run start
cd frontend && npm ci && npm run dev -- --host 127.0.0.1
# third terminal from repo root (environment inherited from backend/.env or passed explicitly):
DB_NAME=miljor_test_db node backend/scripts/demo_preflight.js
```
On Windows PowerShell use `$env:DB_NAME='miljor_test_db'; node backend/scripts/demo_preflight.js`.

Preflight checks only presence of source files, `/health/live`, `/health/ready`, and local Vite HTTP response. A PASS means these basic prerequisites are present, not that full buyer-to-settlement E2E passed. If backend readiness or MySQL fails, fix configuration before presentation. If frontend fails, check Vite terminal and port.

## Prior verified evidence (do not transfer PASS to a changed SHA)
`backend/docs/MILJOR_UCP_MAIN_INTEGRATION_HANDOFF_2026-11-12.md` reports passing candidate runs 43093840197 and 43093830834 on source SHA 2030fb7. The integration SHA and any new branches require their own CI. Provider-origin Safepay webhook, B7 post-purchase full journey and financial reconciliation are still independent release blockers.

## Immediate pass/fail card
- [ ] Test DB selected / protected DB unchanged.
- [ ] Demo backend GET liveness and readiness PASS.
- [ ] Demo frontend GET and Vite build PASS.
- [ ] Supplier login and SKU present in UI.
- [ ] Supplier pool created and visible to buyer.
- [ ] Buyer order path valid after refresh.
- [ ] Payment only through authorized sandbox; do not claim paid from a mock.
- [ ] If sandbox-paid, fulfillment and confirmation actually verified.
- [ ] Local working tree and remote HEAD recorded.
Write evidence for each checkbox (timestamp, exact SHA, screenshot/redacted log). Any unchecked stage = BLOCKED, not complete.
