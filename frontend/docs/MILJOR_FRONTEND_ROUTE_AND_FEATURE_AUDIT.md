# MilJor Frontend — Route and Feature Audit

Audited and reconciled from `origin/main` @ `84b927c` (branch `feature/frontend-redesign-20261112`). Source: `frontend/src/App.jsx`, layout components, and individual page modules.
Status legend: **DONE** = redesigned, cleaned, and verified · **PRESERVED** = backend contracts, auth flows, and data safety intact.

## Route inventory & Redesign Status

| Route | Component | Role | Purpose | Redesign status | Test & Verification Status |
|---|---|---|---|---|---|
| `/` | `LandingPage` | public | Marketing + featured pools | **DONE**: quiet luxury hero with rice imagery, Playfair Display typography, Champagne Gold CTAs, honest real pools / empty state | build PASS; visual tests PASS |
| `/pools` | `PoolsPage` + `BuyerPoolCard` | buyer/public | Unified Regular + Flash marketplace | **DONE**: Champagne Gold buttons, warm ivory/charcoal surfaces, cluster filtering, commodity fallbacks | build PASS, UCP source gates PASS |
| `/orders` | `OrdersPage` | buyer | Orders, holds, payments | **DONE**: simulated preview disabled, authentic server orders only, Champagne Gold payment triggers | source gates PASS, build PASS |
| `/profile` | `ProfilePage` | buyer | Profile + addresses | **DONE**: unified luxury styling, Lahore cluster validation preserved, address management | build PASS |
| `/flash-pools` | `FlashPoolsPage` | any | Legacy redirect to `/pools` | **PRESERVED**: permanent safe redirect without duplicate source of truth | source gate PASS |
| `/demand-requests` | `DemandRequestsPage` | buyer | Demand requests | **DONE**: clean styling, Champagne Gold accents, verified API wiring | build PASS |
| `/rfqs` | `RfqPage` | buyer/supplier | RFQ, quotes, award, recurring, collective | **DONE**: clean tabs (Buyer Requests vs Supplier Bidding Desk), gold accents, B6 procurement flows intact | build PASS |
| `/supplier/dashboard` | `SupplierDashboardPage` | supplier | Ops dashboard | **DONE**: de-greened metrics, Champagne Gold action buttons, active family progress bar, verified NTN display | build PASS |
| `/supplier/pools` | `SupplierPoolsPage` | supplier | Pool management | **DONE**: Champagne Gold "Create Pool" and actions, de-greened filter pills, immutable terms warning preserved | UCP gate PASS, build PASS |
| `/supplier/catalog` | `SupplierCatalogPage` | supplier | SKUs, listings | **DONE**: internal jargon ("Package E2") removed, 6-level hierarchy preserved, category cascading selectors intact | E2 frontend gate PASS |
| `/supplier/subscription` | `SupplierSubscriptionPage` | supplier | Plans / entitlements | **DONE**: luxury plan cards, family allowances, tier limits | build PASS |
| `/supplier/profile` | `SupplierProfilePage` | supplier | Business profile | **DONE**: AES-256 masked IBAN, verified badge, Phase G2 logistics embedded | E1 frontend gate PASS |
| `/supplier/onboarding` | `SupplierOnboardingPage` + Wizard | supplier | Verification wizard | **DONE**: 4-step progressive disclosure, calm champagne progress indicators, mobile number & IBAN validation | E1 frontend gate PASS |
| `/admin`, `/admin/dashboard` | `AdminDashboardPage` | admin | Founder console | **DONE**: high-contrast theme compatibility, founder analytics | admin gates PASS |
| `/admin/verifications` | `AdminVerificationPage` | admin | Supplier review | **DONE**: internal jargon ("Package E1.1 Gate B") eliminated, approve/reject modals styled | E1 frontend gate PASS |
| `/admin/catalog` | `AdminCatalogPage` | admin | Catalog moderation | **DONE**: internal jargon ("Package E2") replaced with "Catalog Governance & Verification" | E2 frontend gate PASS |
| `/login` | `LoginPage` | public | Sign in | **DONE**: laptop viewport fit (1366x768 / 1440x900), reversible split layout, clean role redirects | auth_v2 test PASS |
| `/register` | `RegisterPage` | public | Sign up | **DONE**: Buyer vs Supplier role cards, base cluster picker, live password checklist, Lahore cluster validation | auth_v2 test PASS |
| `/verify-email` | `VerifyEmailPage` | public | OTP | **DONE**: clean OTP inputs, resend timer, champagne action buttons | build PASS |
| `/forgot-password` | `ForgotPasswordPage` | public | Reset | **DONE**: 4-step recovery flow, server-authoritative 60s resend cooldown, clean UI | forgot_password test PASS |
| `*` | `NotFoundPage` | any | 404 | **DONE**: dedicated 404 with navigation back to home or active pools | build PASS |

## Completed Architectural & Visual Transformations

1. **Elimination of Excessive Green Styling:**
   - Harsh green styling (`bg-emerald-700`, `text-emerald-900`, `border-emerald-600`) across buttons, filters, and nav cards replaced with Champagne Gold (`var(--brand-accent)` = `#C8B276`) and dark text (`#072A21`).
   - Semantic emerald (`#0F5A48` / `#3AB885`) strictly retained for authentic success states (`ACTIVE`, `VERIFIED`, `PAID`, `APPROVED`).

2. **Elimination of Developer & Internal Jargon:**
   - Removed references to "Package E2", "Package E1.1 Gate B", and legacy specifications from user-facing screens (`AdminVerificationPage`, `AdminCatalogPage`, `SupplierCatalogPage`).

3. **Data Honesty & Real Marketplace Integrations:**
   - Fabricated `REFERENCE_FEATURED_POOLS` removed from `LandingPage`; real active pools or truthful empty state rendered.
   - Simulated order `#MLJ-8421` permanently disabled; `OrdersPage` connects strictly to real server orders.

4. **AppShell & Navigation Architecture:**
   - Role-aware navigation (Buyer, Supplier, Admin) with dead "Coming Soon" links removed.
   - Persistent user-controlled sidebar expansion without accidental outside-click collapse.
   - High-contrast, elevated top-bar controls (Search, Notifications, Account Menu).

5. **Performance & Bundle Optimization:**
   - Route-level `React.lazy` code splitting implemented in `App.jsx`, reducing entry bundle from 1,075 kB to 392 kB. Production builds compile in ~2.7s.
