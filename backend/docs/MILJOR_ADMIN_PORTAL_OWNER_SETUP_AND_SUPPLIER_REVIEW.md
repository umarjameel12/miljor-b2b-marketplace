# MilJor — Admin Portal, Founder Access and Supplier Verification

## Source audit (2026-11-12)
- Existing supplier-verification UI `frontend/src/pages/AdminVerificationPage.jsx` and catalog moderation UI `AdminCatalogPage.jsx` already existed in main, reachable only through obscure direct URLs.
- Existing admin API: `GET /api/v1/admin/suppliers/pending`; `PUT /api/v1/admin/suppliers/:id/verify`; allowlisted business details, masked banking identifiers, transactional user + supplier profile state change, audit log.
- Original backend `authorizeVerification` permitted `VERIFICATION_ADMIN` and `SUPER_ADMIN` but not general `ADMIN`, despite admin frontend claiming `ADMIN` access. This mismatch is fixed.
- Added `/admin` dashboard, desktop/mobile sidebar link (admins only), admin login redirect, supplier queue metrics and direct catalog/verification navigation.
- Separated `MORE_INFORMATION_REQUIRED` from `REJECTED`, with mandatory meaningful reason; supplier self-approval is still strictly prohibited.

## Why the founder could not approve suppliers
Business ownership does **not** automatically give any user's account the `SUPER_ADMIN` role. Registration always creates `BUYER`, and supplier onboarding changes a supplier business account to `SUPPLIER`. The platform must have a **separate authorized administrator login**. Otherwise a supplier could approve its own paperwork, violating the verification control.

## First-time setup — LOCAL OWNER ACTION ONLY
No public `/make-me-admin` API, no default password, no hard-coded super-admin account and no remote/protected DB mutation were introduced.

1. Preserve an encrypted or private off-repo backup of your local MySQL database before any role assignment. Verify that the dump can be read/restored to a disposable database.
2. Create a **second** MilJor account with a separate founder/operator email using the normal registration and email verification flow. It must remain a verified `BUYER` account with **no** supplier profile. Do not use the same account that submitted the supplier application.
3. If there is already a `SUPER_ADMIN`, **do not** run the bootstrap script. Log in as the existing admin or use a controlled recovery procedure.
4. On your own computer, after backup, set `NODE_ENV=development`, `DB_NAME=miljor_db`, `MILJOR_BOOTSTRAP_ADMIN_EMAIL` to the new verified account email, and `MILJOR_BOOTSTRAP_CONFIRM=I_HAVE_BACKED_UP_MY_DATABASE`. Run `node scripts/bootstrap_first_admin.js` from the backend directory. The script checks database identity and that no super-admin exists, refuses SUPPLIER accounts, obtains an advisory lock, updates the existing account in one audited transaction and exits. It creates no passwords or new accounts.
5. Sign out of the supplier account. Sign into the **distinct** admin account via the normal `/login` screen, with the account's own password. You will be redirected to `/admin`; the admin navigation appears on desktop and mobile.
6. Open **Supplier Verification**, inspect the pending supplier business details, choose level and plan, then **Approve Supplier**, **Request Info** or **Reject**. A successful API decision writes to `supplier_profiles`, `users` and `system_audit_logs`. Refresh supplier onboarding in the original supplier account to confirm the status.
7. Admin and supplier browsers should have **independent sessions**, e.g., separate browser profiles. A supplier login must never approve itself. A founder may legitimately use two accounts for distinct platform roles.

## Role permissions
| Role | Supplier approve/reject | Catalog governance |
| --- | --- | --- |
| SUPER_ADMIN | Yes | Yes |
| ADMIN | Yes | Yes |
| VERIFICATION_ADMIN | Yes | Yes |
| OPERATIONS_ADMIN | No | Yes |
| FINANCE_ADMIN | No | No |
| SUPPLIER / BUYER | No | No |

Authorization is enforced by Express middleware using the live database role, not a client-side navigation check. Admin session tokens remain in memory and refresh through HttpOnly sessions. The first-admin bootstrap is a local CLI only and cannot be invoked over HTTP.

## Tests and release gates
- `node backend/tests/demo_admin_supplier_approval_gate.js`: 11 isolated role/decision mock-transaction cases; no changes to a real DB.
- GitHub admin acceptance workflow: above test plus actual production Vite build.
- Full smoke test on a disposable MySQL installation: register distinct admin-eligible buyer, install bootstrap in an intentionally authorized local backup/sandbox, login and verify real approval with existing pending supplier, audit log and rejected self-approval. **Not yet executed on user's actual computer.**
- UCP/B6 regular/flash engines, settlement and migration history **not changed** by this admin feature.
- Real Safepay-origin callback, B6 multi-line partial refund and complete checkout-to-settlement UI remain independent release gates, not accidentally certified by admin UI tests.

## Troubleshooting
- `/admin` displays access denied: logged-in user's **live DB role** is not an admin role. Owner ownership doesn't bypass RBAC. Verify role using your secure local DB; do not edit frontend token or localStorage.
- `403 FORBIDDEN` despite page visible: ensure backend has the latest `authorizeVerification` fix and refresh the authenticated session.
- Queue empty: the supplier must have submitted the onboarding form and `supplier_profiles.verification_status` must be `PENDING_REVIEW`, `UNDER_REVIEW` or `MORE_INFORMATION_REQUIRED`.
- Approval blocked for the same id: expected `SELF_VERIFICATION_PROHIBITED`. Use a different admin account.
- `SUPER_ADMIN_ALREADY_EXISTS`: do not rerun bootstrap; use existing admin credentials/recovery.
- Never store database dumps, bootstrap environment variables, passwords or actual supplier banking details in GitHub.

## Handoff
GitHub feature branch `feature/admin-portal-supplier-approval-20261112`; do not merge until acceptance CI and exact main comparison are reviewed. A local deployment/database backup needs authorized access to the owner's machine.
