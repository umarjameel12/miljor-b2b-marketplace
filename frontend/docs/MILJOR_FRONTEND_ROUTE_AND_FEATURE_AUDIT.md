# MilJor Frontend — Route and Feature Audit

Audited from `origin/main` @ `84b927c` (branch `feature/frontend-redesign-20261112`). Source: `frontend/src/App.jsx` and page files.
Status legend: DONE = changed and verified in this pass · AUDITED = inspected, no change made · NOT STARTED.

> Scope note: this document is honest about coverage. The brief covers ~25 pages (~600 KB of JSX, with `RfqPage` 110 KB and
> `SupplierCatalogPage` 121 KB). This pass fixed the verified defects listed below. It did **not** visually redesign every page.
> Pages marked AUDITED were inspected for the defect classes in the brief but not restyled.

## Route inventory

| Route | Component | Role | Purpose | Redesign status | Test status |
|---|---|---|---|---|---|
| `/` | `LandingPage` | public | Marketing + featured pools | **DONE (data honesty)**: fabricated `REFERENCE_FEATURED_POOLS` (tomatoes / rice / dal with fake fill %, prices, quantities) removed; real pools or an honest empty state | build PASS; browser see report |
| `/pools` | `PoolsPage` + `BuyerPoolCard` | buyer/public | Unified Regular + Flash marketplace | AUDITED (crash fixed earlier: `products` ReferenceError) | build PASS, UCP source gates PASS |
| `/orders` | `OrdersPage` | buyer | Orders, holds, payments | **DONE (data honesty)**: `ordersSamplePreview` flag forced off, simulated order "#MLJ-8421" no longer reachable | source gates PASS |
| `/profile` | `ProfilePage` | buyer | Profile + addresses | AUDITED (own chunk is 179 KB — candidate for split) | build PASS |
| `/flash-pools` | `FlashPoolsPage` | any | Legacy redirect to `/pools` | AUDITED, preserved | source gate PASS |
| `/demand-requests` | `DemandRequestsPage` | buyer | Demand requests | AUDITED | build PASS |
| `/rfqs` | `RfqPage` (110 KB) | buyer/supplier | RFQ, quotes, award, recurring, collective | AUDITED, **not redesigned** | build PASS |
| `/supplier/dashboard` | `SupplierDashboardPage` | supplier | Ops dashboard | AUDITED | build PASS |
| `/supplier/pools` | `SupplierPoolsPage` | supplier | Pool management | AUDITED | build PASS |
| `/supplier/catalog` | `SupplierCatalogPage` (121 KB) | supplier | SKUs, listings | AUDITED, **not refactored** | E2 frontend gate PASS |
| `/supplier/subscription` | `SupplierSubscriptionPage` | supplier | Plans / entitlements | AUDITED | build PASS |
| `/supplier/profile` | `SupplierProfilePage` | supplier | Business profile | AUDITED | E1 frontend gate PASS |
| `/supplier/onboarding` | `SupplierOnboardingPage` + Wizard | supplier | Verification wizard | AUDITED | E1 frontend gate PASS |
| `/admin`, `/admin/dashboard` | `AdminDashboardPage` | admin | Founder console | AUDITED | admin gates PASS (earlier) |
| `/admin/verifications`, `/admin/suppliers/verification` | `AdminVerificationPage` | admin | Supplier review | AUDITED | admin gates PASS (earlier) |
| `/admin/catalog` | `AdminCatalogPage` | admin | Catalog moderation | AUDITED | E2 frontend gate PASS |
| `/login` | `LoginPage` | public | Sign in | AUDITED | auth_v2 test PASS |
| `/register` | `RegisterPage` | public | Sign up | AUDITED | auth_v2 test PASS |
| `/verify-email` | `VerifyEmailPage` | public | OTP | AUDITED | build PASS |
| `/forgot-password` | `ForgotPasswordPage` | public | Reset | AUDITED | forgot_password test PASS |
| `*` | **`NotFoundPage` (new)** | any | 404 | **DONE**: previously silently redirected to `/` | browser see report |

## Defects found and fixed

| # | Defect | Where | Fix |
|---|---|---|---|
| 1 | Fabricated pool data shown as real marketplace activity | `LandingPage.jsx` | Removed sample array; empty state + link to `/pools` |
| 2 | Simulated order shown inside real Orders page (flag on by default) | `featureFlags.js` → `OrdersPage.jsx` | Flag set to `false` |
| 3 | Three "Coming Soon" dead nav entries (Suppliers, Pricing, Support) pointing at non-existent routes | `AppShell.jsx` | Removed |
| 4 | One nav list for every role (supplier/admin saw buyer links, buyers saw admin-adjacent layout) | `AppShell.jsx` | Role-aware nav using only real routes |
| 5 | Desktop sidebar collapsed on any outside click | `AppShell.jsx` | Listener removed; state persists via existing `miljor_sidebar_collapsed` |
| 6 | Unknown URLs silently redirected to `/` (hid broken links) | `App.jsx` | `NotFoundPage` |
| 7 | Single 1,075 kB JS bundle | `App.jsx` | Route-level `React.lazy`; entry chunk now 392 kB |

## Known gaps (not done in this pass)

- Full visual redesign of 20+ pages, shared primitive library (Modal/Table/Tabs/Toast/etc.), 3D hero effect, order detail route.
- `RfqPage` / `SupplierCatalogPage` refactor into modules.
- Per-button audit table (Part 9) — not produced.
- Mobile drawer: Escape/focus-restore/scroll-lock not verified.
- Responsive sweep at 9 widths, 200% zoom, light/dark screenshots — not run.
- `ProfilePage` 179 kB chunk (likely map library) not investigated.
- No ESLint config exists in the repo; lint NOT RUN.
- Pre-existing failure: `frontend/tests/part5a_vf9_hero_integration.test.js` ("Light theme sidebar #e3d7c4") fails on clean `origin/main`; unrelated to this branch and left untouched.
