# MILJOR DESIGN SYSTEM
## Quiet Luxury Commerce × Swiss Minimalism
**Document Version:** 2.0 (Part 5A.1 Refined Foundation)
**Target Platform:** MilJor Collective B2B Food Procurement Marketplace

---

## 1. DESIGN PHILOSOPHY & BRAND CHARACTER
MilJor’s visual identity combines editorial refinement with Swiss minimalist utility for the commercial food supply chain:
- **Quiet Luxury:** Deep, restrained forest tones (`#072A21`), vibrant emerald (`#0F5A48`), flowing champagne gold ribbon accents (`#C8B276`), and warm ivory surfaces (`#F7F3E8`).
- **Swiss Minimalism:** Structured grid rhythm, generous spacing, high-contrast typography, and tabular figures for all financial and quantity metrics.
- **Truthful Procurement:** Zero fabricated discounts, zero fake certifications, and clear distinction between *Estimated Price* and locked contracts.
- **Brand Identity Rule:** The master flowing Champagne-Gold Ribbon-M monogram stands strictly **WITHOUT** adjacent "MilJor" wordmark across the public header, marketplace sidebar, mobile drawer, and opening treatment. The brand tagline *"Milkar Khareedo, Behtar Pao"* is preserved in separate branding contexts.

---

## 2. COLOR PALETTE & SEMANTIC TOKENS

### Core Palette
- **Forest:** `#072A21` (Primary authority, deep hero surface, dark viewport base)
- **Emerald:** `#0F5A48` (Brand secondary, success indicators, interactive hover)
- **Champagne:** `#C8B276` / Light `#DFBF85` / Dark `#A88344` (Metallic ribbon accents, primary action pills, focus rings)
- **Ivory:** `#F7F3E8` (Default light viewport background, card surfaces)
- **Ink:** `#121417` (High-contrast typography)

### Semantic Tokens (Light & Dark Theme)
| Token | Light Value | Dark Value | Purpose |
|:---|:---:|:---:|:---|
| `--bg-page` | `#F7F3E8` | `#072A21` | Viewport page background |
| `--bg-surface` | `#FFFFFF` | `#0A3429` | Card & container surfaces |
| `--bg-elevated` | `#F0EBE0` | `#0B362B` | Elevated panels, progress tracks, active rails |
| `--bg-subtle` | `#E8E2D4` | `#0F4235` | Card footers, subtle borders |
| `--text-primary` | `#121417` | `#F7F3E8` | High-contrast body & headings |
| `--text-secondary` | `#3E4744` | `#C8D3CF` | Descriptions, specifications |
| `--text-muted` | `#6B7873` | `#8B9D97` | Captions, timestamps, units |
| `--border-subtle` | `rgba(18, 20, 23, 0.08)` | `rgba(247, 243, 232, 0.09)` | Quiet separation rules |
| `--border-default` | `rgba(18, 20, 23, 0.14)` | `rgba(247, 243, 232, 0.16)` | Input borders, card outlines |
| `--brand-primary` | `#072A21` | `#0F5A48` | Primary container, hero surface |
| `--brand-accent` | `#C8B276` | `#DFBF85` | Key accents, action buttons, focus rings |

*Dark Mode Note:* Avoids pure `#000000`, using elevated forest and emerald tones (`#072A21` and `#0B362B`) for deep luxury contrast.

---

## 3. TYPOGRAPHY SYSTEM
- **Editorial Headlines & Display:** `Playfair Display`
  - Stack: `'Playfair Display', Georgia, serif`
  - Style: Semi-bold, Bold & Black weights with `-0.015em` letter tracking.
- **Interface, Forms & Body:** `Inter`
  - Stack: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
  - Weights: `400` (Regular), `500` (Medium), `600` (Semi-bold), `700` (Bold).
- **Financial & Numeric Alignment:**
  - Class: `.tabular-nums` / `.font-numeric` (`font-variant-numeric: tabular-nums`).
  - Applied to all currency values, order quantities, percentages, and counters.

---

## 4. LOGO & BRAND MARKS
- **Master Monogram:** Flowing Champagne-Gold Ribbon-M Monogram on Forest Emerald Shield (`Logo.jsx` and `public/favicon.svg`).
- **Brand Directives:**
  - **No Adjacent Wordmark:** The monogram appears on its own without adjacent "MilJor" text across Navbar, AppShell sidebar, Mobile Header, and Opening Treatment.
  - **Tagline Placement:** The tagline *"Milkar Khareedo, Behtar Pao"* is displayed only in distinct branding blocks (Hero badge, Drawer identity card, Footer).
  - **Favicon:** Scalable vector `favicon.svg` matching the refined satin ribbon curvature.

---

## 5. NAVIGATION & LAYOUT ARCHITECTURE
- **Public Marketing Landing Page (`/`):**
  - Features the grand editorial hero: *"Buy Better, Together."*, subtitle *"Group demand. Unlock wholesale value."*, value pills (`Verified Suppliers`, `Transparent Pricing`, `Collective Buying`), and fresh food imagery.
  - Clean public header with discreet compact theme control and unforced layout (no permanent desktop sidebar on `/`).
- **Marketplace Procurement Shell (`/pools`):**
  - Wrapped inside `AppShell` with collapsible desktop sidebar (`w-64` expanded with icons+labels, `w-20` collapsed icon rail).
  - Mobile slide-out `Drawer` with touch-friendly navigation and theme settings.
  - Every visible link connects to an actual implemented route (`/`, `/pools`, `/login`, `/register`, `/verify-email`).
- **Theme Controls:**
  - Public Navbar: Discreet, compact single-button control with dropdown.
  - Sidebar & Drawer: Full segmented System / Light / Dark selector.
  - Synchronous `<head>` script eliminates theme flicker on initial paint.

---

## 6. FRESH FOOD IMAGERY ON CARDS
- Cards in `PoolCard.jsx` render curated high-resolution photography banners:
  - Ripe vine tomatoes with water droplets for produce
  - Golden grains for rice and wheat
  - Pure golden liquids for edible oils and ghee
  - High-protein pulses and lentils
- Live countdown badge: `● Live • 2d 14h left`
- High-contrast tabular prices: `Rs. [amount] / [unit]`
- Progress bar displaying committed vs target volume.
