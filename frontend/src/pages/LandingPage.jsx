import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { poolsApi } from '../api/pools';
import { PoolCard } from '../components/PoolCard';
import { AppShell } from '../components/layout/AppShell';
import { Logo } from '../components/ui/Logo';
import FLAGS from '../config/featureFlags';
import riceHeroDark from '../assets/hero/miljor-rice-hero-dark.png';
import riceHeroLight from '../assets/hero/miljor-rice-hero-light.png';
import {
  Play,
  Users,
  Coins,
  Zap,
  ShieldCheck,
  ArrowRight,
  Layers,
  FileText,
  CheckCircle2,
  Building2,
  Store,
  Truck,
  TrendingDown,
  Sparkles,
  Lock,
  BadgeCheck,
} from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();

// Realistic Lahore Wholesale Commodity Spotlights for fallback/preview
const COMMODITY_SPOTLIGHTS = [
  {
    id: 'spotlight-rice',
    title: 'Super Kernel Basmati Rice (50kg)',
    category: 'Grains & Rice',
    basePrice: 'PKR 14,800',
    tierPrice: 'PKR 13,950',
    savings: '6% volume discount',
    minOrder: '10 bags (500 kg)',
    unit: 'Bag (50kg)',
    cluster: 'Badami Bagh / Shah Alam',
  },
  {
    id: 'spotlight-oil',
    title: 'Refined Vegetable Cooking Oil (16L)',
    category: 'Oils & Fats',
    basePrice: 'PKR 7,900',
    tierPrice: 'PKR 7,450',
    savings: '5.7% volume discount',
    minOrder: '15 tins (240 L)',
    unit: 'Tin (16L)',
    cluster: 'Multan Road / Kot Lakhpat',
  },
  {
    id: 'spotlight-atta',
    title: 'Premium Whole Wheat Fine Atta (50kg)',
    category: 'Flour & Grain',
    basePrice: 'PKR 5,400',
    tierPrice: 'PKR 4,950',
    savings: '8.3% volume discount',
    minOrder: '20 bags (1,000 kg)',
    unit: 'Bag (50kg)',
    cluster: 'Raiwind / Quaid-e-Azam IE',
  },
];

export const LandingPage = () => {
  const { isDark } = useTheme();
  const [featuredPools, setFeaturedPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(true);

  // Preload both dark and light hero images to prevent flash or flicker during theme switches
  useEffect(() => {
    const imgDark = new Image();
    imgDark.src = riceHeroDark;
    const imgLight = new Image();
    imgLight.src = riceHeroLight;
  }, []);

  const currentHeroImg = isDark ? riceHeroDark : riceHeroLight;

  useEffect(() => {
    async function loadFeatured() {
      try {
        const res = await poolsApi.getActivePools({ limit: 3 });
        if (res.success && res.data?.pools && res.data.pools.length > 0) {
          setFeaturedPools(res.data.pools.slice(0, 3));
        }
      } catch (err) {
        console.warn('Could not load featured pools:', err.message);
      } finally {
        setLoadingPools(false);
      }
    }
    loadFeatured();
  }, []);

  return (
    <AppShell>
      <div className="w-full overflow-x-hidden transition-colors duration-200">
        {/* =========================================================================
            SECTION 1: HERO SECTION — PRECISION LOCKED TO REFERENCE (PART 5A-VF6/VF9)
            - Dark Mode: Layered Deep Forest #072A21 / #05251D with Emerald & Champagne ambient glow
            - Light Mode: Layered Warm Ivory #F7F3E8 / #FAF6EE with soft porcelain & cream warmth
            - Headline: "Buy Better," line 1, "Together" line 2 with selective gold gradient
            - STRICTLY ZERO PERIOD after "Together"
            - Premium Basmati Rice Sack in authentic natural burlap with rice grains & scoop
            - Overhead ambient champagne curved arc line
            ========================================================================= */}
        <section className="relative px-5 sm:px-8 lg:px-10 pt-4 pb-8 sm:pb-10 overflow-hidden">
          {/* Layer 0: Subtle Top-Left Ambient Radial Light (Light Mode Only) */}
          <div
            className="absolute -left-20 -top-20 w-80 sm:w-[420px] h-80 sm:h-[420px] rounded-full pointer-events-none opacity-40 dark:opacity-0 blur-3xl transition-opacity duration-300"
            style={{
              background: 'radial-gradient(circle at 40% 40%, rgba(255, 255, 255, 0.6) 0%, rgba(214, 185, 125, 0.16) 50%, transparent 75%)',
            }}
            aria-hidden="true"
          />

          {/* Layer 1: Atmospheric Tonal Radial Glow behind Rice Imagery — One-Sided Sweep */}
          <div
            className="absolute right-0 top-0 w-[500px] sm:w-[650px] lg:w-[780px] h-[450px] sm:h-[550px] rounded-full pointer-events-none opacity-70 dark:opacity-85 blur-3xl transition-opacity duration-300"
            style={{
              background: 'var(--glow-hero)',
            }}
          />

          {/* Layer 2: Overhead Ambient Champagne Arc Line sweeping over commodity imagery */}
          <svg
            className="ambient-arc pointer-events-none transition-opacity duration-300"
            style={{ opacity: 'var(--arc-opacity)' }}
            viewBox="0 0 1000 320"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="champagne-arc-grad" x1="360" y1="50" x2="800" y2="280" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#DFBF85" stopOpacity="0.85"/>
                <stop offset="35%" stopColor="#C8B276" stopOpacity="0.6"/>
                <stop offset="70%" stopColor="#B89452" stopOpacity="0.25"/>
                <stop offset="100%" stopColor="#C8B276" stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path
              d="M 360 55 C 400 55, 480 70, 580 120 C 680 170, 750 230, 790 270"
              stroke="url(#champagne-arc-grad)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
            {/* Left Column: Eyebrow, Editorial Headline, Subtitle & CTAs */}
            <div className="lg:col-span-7 flex flex-col items-start pt-2">
              {/* Tagline Eyebrow Pill */}
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-sans font-medium mb-3.5 border shadow-2xs"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text-muted)',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Milkar Khareedo, Behtar Pao</span>
              </div>

              {/* Editorial Serif Headline — Exact 2 lines, NO PERIOD */}
              <h1 className="font-display font-bold text-3xl sm:text-4xl lg:text-[46px] leading-[1.18] tracking-tight pb-2 overflow-visible">
                <span className="block text-xs sm:text-sm font-sans font-medium uppercase tracking-widest text-[#c8b276] mb-1.5">
                  Smarter Procurement. Better Buying Power.
                </span>
                <span className="block" style={{ color: 'var(--text-forest)' }}>
                  Buy Better,
                </span>
                <span className="text-gold-gradient inline-block">
                  Together
                </span>
              </h1>

              {/* Subtext */}
              <p
                className="mt-3 text-xs sm:text-sm leading-relaxed max-w-lg font-sans"
                style={{ color: 'var(--text-muted)' }}
              >
                Source essential supplies, compare trusted offers and simplify purchasing through one connected marketplace. Group demand and unlock wholesale value for restaurants, caterers and food businesses across Lahore.
              </p>

              {/* CTAs */}
              <div className="flex items-center gap-3 mt-6">
                <Link to="/pools">
                  <button
                    type="button"
                    className={`px-5 py-2.5 rounded-full font-sans font-medium text-xs sm:text-sm transition-all duration-200 shadow-xs hover:shadow-md flex items-center justify-center cursor-pointer ${
                      FLAGS.ctaShimmerEffect ? 'btn-shimmer' : ''
                    }`}
                    style={{
                      backgroundColor: 'var(--brand-accent)',
                      color: '#072a21',
                    }}
                  >
                    <span>Explore Pools</span>
                  </button>
                </Link>

                <a href="#how-it-works">
                  <button
                    type="button"
                    className="px-4 py-2.5 rounded-full font-sans font-medium text-xs sm:text-sm border transition-all duration-200 flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-default)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    <Play className="w-3 h-3 fill-current text-stone-500 dark:text-stone-300" />
                    <span>How It Works</span>
                  </button>
                </a>
              </div>
            </div>

            {/* Right Column: Prominent, Sophisticated Basmati Rice Sack in Jute Burlap */}
            <div className="lg:col-span-5 relative flex justify-center lg:justify-end">
              <div className="relative w-full max-w-md sm:max-w-lg lg:max-w-xl h-64 sm:h-80 lg:h-[390px] flex items-center justify-center lg:justify-end">
                {/* Ambient Studio Radial Backlight (Emerald + Champagne Gold Luxury Aura) */}
                <div
                  className="absolute inset-0 m-auto w-[94%] sm:w-[102%] h-[90%] sm:h-[96%] rounded-full pointer-events-none transition-opacity duration-500 z-0"
                  style={{
                    background: isDark
                      ? 'radial-gradient(circle at 50% 50%, rgba(200, 178, 118, 0.35) 0%, rgba(16, 185, 129, 0.24) 38%, rgba(15, 90, 72, 0.10) 65%, transparent 82%)'
                      : 'radial-gradient(circle at 50% 50%, rgba(214, 185, 125, 0.35) 0%, rgba(200, 178, 118, 0.18) 40%, rgba(247, 243, 232, 0.05) 65%, transparent 80%)',
                    filter: isDark ? 'blur(50px)' : 'blur(35px)',
                  }}
                  aria-hidden="true"
                />

                {/* Single Seamless Ground Pedestal Ellipse */}
                <div
                  className="absolute bottom-1 sm:bottom-2 lg:bottom-3 w-[84%] sm:w-[90%] h-12 sm:h-16 rounded-[100%] pointer-events-none z-0"
                  style={{
                    background: isDark
                      ? 'radial-gradient(ellipse at 50% 50%, rgba(200, 178, 118, 0.22) 0%, rgba(15, 90, 72, 0.35) 45%, rgba(2, 20, 15, 0.40) 75%, transparent 100%)'
                      : 'radial-gradient(ellipse at 50% 50%, rgba(105, 80, 50, 0.32) 0%, rgba(160, 130, 90, 0.18) 48%, rgba(210, 185, 145, 0.06) 70%, transparent 85%)',
                    filter: isDark ? 'blur(14px)' : 'blur(9px)',
                  }}
                  aria-hidden="true"
                />

                {/* Master Canonical Burlap Rice Sack */}
                <img
                  src={currentHeroImg}
                  alt="MilJor Premium Basmati Rice in Woven Burlap Sack"
                  className="relative z-10 w-full h-full object-contain object-center lg:object-right transition-transform duration-300 transform scale-105 sm:scale-110 lg:scale-115 drop-shadow-[0_14px_20px_rgba(75,55,30,0.24)] dark:drop-shadow-[0_20px_34px_rgba(0,0,0,0.60)]"
                  loading="eager"
                />
              </div>
            </div>
          </div>

          {/* =========================================================================
              SECTION 2: MARKETPLACE ADVANTAGES (Value Pillars with Verified Suppliers)
              ========================================================================= */}
          <div
            className="mt-8 pt-5 border-t grid grid-cols-1 sm:grid-cols-3 gap-4"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div
              className={`p-3.5 rounded-2xl flex items-center gap-3.5 border transition-all duration-200 backdrop-blur-md ${
                FLAGS.featureCardGlow ? 'hover:-translate-y-1 hover:shadow-md hover:border-[var(--brand-accent)]' : ''
              }`}
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--brand-accent)',
                }}
              >
                <Users className="w-4 h-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-sans font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Collective Procurement
                </span>
                <span className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Unlock tiered discounts from verified suppliers
                </span>
              </div>
            </div>

            <div
              className={`p-3.5 rounded-2xl flex items-center gap-3.5 border transition-all duration-200 backdrop-blur-md ${
                FLAGS.featureCardGlow ? 'hover:-translate-y-1 hover:shadow-md hover:border-[var(--brand-accent)]' : ''
              }`}
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--brand-accent)',
                }}
              >
                <Coins className="w-4 h-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-sans font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Transparent Pricing
                </span>
                <span className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Track volume progress with honest rate locks
                </span>
              </div>
            </div>

            <div
              className={`p-3.5 rounded-2xl flex items-center gap-3.5 border transition-all duration-200 backdrop-blur-md ${
                FLAGS.featureCardGlow ? 'hover:-translate-y-1 hover:shadow-md hover:border-[var(--brand-accent)]' : ''
              }`}
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 border"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--brand-accent)',
                }}
              >
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-sans font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Verified Quality Assurance
                </span>
                <span className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Escrow protection & grade inspection on dispatch
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            SECTION 3: HOW IT WORKS (Section Anchor)
            ========================================================================= */}
        <section
          id="how-it-works"
          className="px-5 sm:px-8 lg:px-10 py-10 border-t transition-colors duration-200"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-[11px] font-sans font-semibold tracking-wider uppercase text-emerald-800 dark:text-champagne">
                Operational Transparency
              </span>
              <h3 className="font-display font-bold text-xl sm:text-2xl mt-1" style={{ color: 'var(--text-primary)' }}>
                How Collective Buying Works
              </h3>
            </div>

            <div className="relative">
              {FLAGS.howItWorksConnectors && (
                <div
                  className="hidden sm:block absolute top-1/2 left-[15%] right-[15%] h-0.5 border-t border-dashed pointer-events-none -translate-y-7 z-0"
                  style={{ borderColor: 'var(--brand-accent)', opacity: 0.35 }}
                />
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 relative z-10">
                <div className="p-5 rounded-2xl border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display font-bold text-sm mb-3 shadow-xs" style={{ backgroundColor: 'var(--brand-accent-soft)', color: 'var(--brand-accent)' }}>
                    01
                  </div>
                  <h4 className="font-sans font-semibold text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                    Pool Creation & Thresholds
                  </h4>
                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    Wholesale commodity pools open with minimum order quantities directly from verified suppliers.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display font-bold text-sm mb-3 shadow-xs" style={{ backgroundColor: 'var(--brand-accent-soft)', color: 'var(--brand-accent)' }}>
                    02
                  </div>
                  <h4 className="font-sans font-semibold text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                    Order Volume Aggregation
                  </h4>
                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    Independent kitchens reserve quantities. As volume rises, estimated price locks at bulk tier.
                  </p>
                </div>

                <div className="p-5 rounded-2xl border backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center font-display font-bold text-sm mb-3 shadow-xs" style={{ backgroundColor: 'var(--brand-accent-soft)', color: 'var(--brand-accent)' }}>
                    03
                  </div>
                  <h4 className="font-sans font-semibold text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                    Direct Fulfillment
                  </h4>
                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    Supplier fulfills batch delivery with escrow inspection and settlement.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            SECTION 4: REAL WHOLESALE POOLS & COMMODITY SPOTLIGHT
            ========================================================================= */}
        <section className="px-5 sm:px-8 lg:px-10 py-8 sm:py-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2
                className="font-display font-bold text-lg sm:text-xl tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Wholesale Commodity Pools
              </h2>
              <p className="text-[11px] text-stone-500 mt-0.5">
                Aggregate bulk orders with fellow commercial buyers across Lahore
              </p>
            </div>

            <Link
              to="/pools"
              className="inline-flex items-center gap-1 text-xs font-medium hover:underline transition-colors"
              style={{ color: 'var(--brand-accent)' }}
            >
              <span>View All Pools</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Active Pools Grid */}
          {featuredPools.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
              {featuredPools.map((pool) => (
                <PoolCard key={pool.id} pool={pool} />
              ))}
            </div>
          ) : !loadingPools ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {COMMODITY_SPOTLIGHTS.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-2xl border transition-all duration-200 backdrop-blur-sm flex flex-col justify-between"
                    style={{
                      backgroundColor: 'var(--bg-card)',
                      borderColor: 'var(--border-subtle)',
                      boxShadow: 'var(--shadow-card)',
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between text-[10px] text-stone-500 mb-2">
                        <span className="font-semibold uppercase tracking-wider text-[var(--brand-accent)]">
                          {item.category}
                        </span>
                        <span>{item.cluster}</span>
                      </div>
                      <h4 className="font-sans font-semibold text-xs leading-snug mb-3" style={{ color: 'var(--text-primary)' }}>
                        {item.title}
                      </h4>
                      <div className="p-2.5 rounded-xl border mb-3 space-y-1" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-stone-500">Base Unit Rate:</span>
                          <span className="font-mono text-stone-600 dark:text-stone-300 line-through">{item.basePrice}</span>
                        </div>
                        <div className="flex justify-between text-xs font-semibold">
                          <span style={{ color: 'var(--text-primary)' }}>Volume Tier Price:</span>
                          <span className="font-mono text-emerald-800 dark:text-champagne">{item.tierPrice}</span>
                        </div>
                        <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                          {item.savings}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="text-stone-500">Min. Commitment: {item.minOrder}</span>
                      <Link to="/pools" className="text-xs font-medium hover:underline" style={{ color: 'var(--brand-accent)' }}>
                        Browse Pool →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="p-4 rounded-xl border text-center text-xs flex items-center justify-between flex-wrap gap-2"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                <span>Live supplier batches update continuously based on mill availability.</span>
                <Link to="/pools" className="font-medium hover:underline inline-flex items-center gap-1" style={{ color: 'var(--brand-accent)' }}>
                  <span>Open Full Marketplace Directory</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-44 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--bg-elevated)' }} />
              ))}
            </div>
          )}
        </section>

        {/* =========================================================================
            SECTION 5: PROCUREMENT METHODS (Collective, Direct RFQ, Flash)
            ========================================================================= */}
        <section
          className="px-5 sm:px-8 lg:px-10 py-10 border-t transition-colors duration-200"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-8">
              <span className="text-[11px] font-sans font-semibold tracking-wider uppercase text-emerald-800 dark:text-champagne">
                Procurement Flexibility
              </span>
              <h3 className="font-display font-bold text-xl sm:text-2xl mt-1" style={{ color: 'var(--text-primary)' }}>
                Three Ways to Source on MilJor
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="p-5 rounded-2xl border flex flex-col justify-between backdrop-blur-sm" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                <div>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3.5 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--brand-accent)' }}>
                    <Users className="w-4 h-4" />
                  </div>
                  <h4 className="font-sans font-semibold text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Collective Pools
                  </h4>
                  <p className="text-xs text-stone-500 leading-relaxed mb-4">
                    Group recurring staple demand with commercial kitchens in your zone. Higher aggregated volume unlocks bulk tier prices without holding excess stock.
                  </p>
                </div>
                <Link to="/pools" className="text-xs font-medium hover:underline inline-flex items-center gap-1" style={{ color: 'var(--brand-accent)' }}>
                  <span>Explore Open Pools</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="p-5 rounded-2xl border flex flex-col justify-between backdrop-blur-sm" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                <div>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3.5 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--brand-accent)' }}>
                    <FileText className="w-4 h-4" />
                  </div>
                  <h4 className="font-sans font-semibold text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Direct RFQs & Custom Specs
                  </h4>
                  <p className="text-xs text-stone-500 leading-relaxed mb-4">
                    Require tailored packaging, specific grain lengths, or multi-week contract delivery? Issue structured RFQs to receive competitive supplier bids.
                  </p>
                </div>
                <Link to="/rfq" className="text-xs font-medium hover:underline inline-flex items-center gap-1" style={{ color: 'var(--brand-accent)' }}>
                  <span>Create Request</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="p-5 rounded-2xl border flex flex-col justify-between backdrop-blur-sm" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                <div>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3.5 border" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--brand-accent)' }}>
                    <Zap className="w-4 h-4" />
                  </div>
                  <h4 className="font-sans font-semibold text-sm mb-1.5" style={{ color: 'var(--text-primary)' }}>
                    Flash Allocation Offers
                  </h4>
                  <p className="text-xs text-stone-500 leading-relaxed mb-4">
                    Access spot-rate clearance and time-sensitive mill surpluses. Instant allocation holds with guaranteed door-to-door delivery windows.
                  </p>
                </div>
                <Link to="/pools" className="text-xs font-medium hover:underline inline-flex items-center gap-1" style={{ color: 'var(--brand-accent)' }}>
                  <span>View Spot Allocations</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            SECTION 6: SUPPLIER BENEFITS (Sell at Scale)
            ========================================================================= */}
        <section className="px-5 sm:px-8 lg:px-10 py-10">
          <div className="max-w-6xl mx-auto rounded-3xl p-6 sm:p-10 border relative overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7">
                <span className="text-[11px] font-sans font-semibold tracking-wider uppercase text-emerald-800 dark:text-champagne">
                  For Mills & Wholesale Distributors
                </span>
                <h3 className="font-display font-bold text-2xl sm:text-3xl mt-1.5 leading-tight" style={{ color: 'var(--text-primary)' }}>
                  Sell at Scale with Predictable Bulk Demand
                </h3>
                <p className="mt-3 text-xs sm:text-sm text-stone-500 leading-relaxed max-w-xl">
                  Eliminate individual restaurant payment default risk. MilJor aggregates verified commercial kitchens into guaranteed volume commitments, lowering your customer acquisition and delivery dispatch costs across Lahore.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-6">
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      Secured buyer funds held in escrow
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      Predictable route-clustered dispatch
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      Verified commercial buyer network
                    </span>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      Automated digital invoice reconciliation
                    </span>
                  </div>
                </div>

                <div className="mt-7">
                  <Link to="/register">
                    <button
                      type="button"
                      className="px-5 py-2.5 rounded-full font-sans font-medium text-xs sm:text-sm transition-all duration-200 border hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer inline-flex items-center gap-2"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <Store className="w-3.5 h-3.5 text-[var(--brand-accent)]" />
                      <span>Apply as Verified Supplier</span>
                    </button>
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-5 flex justify-center">
                <div className="w-full max-w-sm p-5 rounded-2xl border space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                  <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    <Building2 className="w-4 h-4 text-[var(--brand-accent)]" />
                    <span>Commercial Hub Coverage</span>
                  </div>
                  <p className="text-[11px] text-stone-500 leading-relaxed">
                    Active procurement routes connecting mills to central hospitality zones:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {['Gulberg', 'DHA Phase 1-6', 'Johar Town', 'Faisal Town', 'Shah Alam', 'Badami Bagh', 'Model Town'].map((area) => (
                      <span key={area} className="text-[10px] px-2 py-0.5 rounded-md border font-medium" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                        {area}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            SECTION 7: TRUST, QUALITY & ESCROW SAFETY
            ========================================================================= */}
        <section
          className="px-5 sm:px-8 lg:px-10 py-10 border-t transition-colors duration-200"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="max-w-4xl mx-auto text-center">
            <span className="text-[11px] font-sans font-semibold tracking-wider uppercase text-emerald-800 dark:text-champagne">
              Enterprise Governance
            </span>
            <h3 className="font-display font-bold text-xl sm:text-2xl mt-1" style={{ color: 'var(--text-primary)' }}>
              Built on Trust and Physical Verification
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-stone-500 max-w-xl mx-auto leading-relaxed">
              Every participant, transaction, and commodity lot on MilJor complies with strict B2B commercial invariants.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-8 text-left">
              <div className="p-4 rounded-2xl border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <BadgeCheck className="w-5 h-5 text-[var(--brand-accent)] mb-2" />
                <h4 className="font-sans font-semibold text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                  Rigorous Supplier Vetting
                </h4>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Suppliers undergo documented business verification, facility checks, and catalog review by admin before listing.
                </p>
              </div>

              <div className="p-4 rounded-2xl border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <Lock className="w-5 h-5 text-[var(--brand-accent)] mb-2" />
                <h4 className="font-sans font-semibold text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                  Secured Financial Escrow
                </h4>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Payments are held securely in compliant escrow accounts and released only upon certified receipt verification.
                </p>
              </div>

              <div className="p-4 rounded-2xl border" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                <Truck className="w-5 h-5 text-[var(--brand-accent)] mb-2" />
                <h4 className="font-sans font-semibold text-xs mb-1" style={{ color: 'var(--text-primary)' }}>
                  Doorstep Grade Inspection
                </h4>
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  Buyers verify commodity grades upon dispatch arrival with documented dispute protection and partial credit resolution.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            SECTION 8: FINAL CALL TO ACTION
            ========================================================================= */}
        <section className="px-5 sm:px-8 lg:px-10 py-12">
          <div className="max-w-4xl mx-auto rounded-3xl p-8 sm:p-12 text-center border relative overflow-hidden" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)', boxShadow: 'var(--shadow-elevated)' }}>
            <span className="text-[11px] font-sans font-semibold tracking-wider uppercase text-emerald-800 dark:text-champagne">
              Start Sourcing Today
            </span>
            <h3 className="font-display font-bold text-2xl sm:text-3xl mt-2 leading-tight" style={{ color: 'var(--text-primary)' }}>
              Join Lahore's Leading Food Procurement Marketplace
            </h3>
            <p className="mt-3 text-xs sm:text-sm text-stone-500 max-w-lg mx-auto leading-relaxed">
              Unlock volume pricing on premium staples, streamline vendor management, and safeguard your restaurant margins.
            </p>

            <div className="flex items-center justify-center gap-3 mt-7">
              <Link to="/register">
                <button
                  type="button"
                  className="px-6 py-2.5 rounded-full font-sans font-medium text-xs sm:text-sm transition-all duration-200 shadow-xs hover:shadow-md cursor-pointer"
                  style={{
                    backgroundColor: 'var(--brand-accent)',
                    color: '#072a21',
                  }}
                >
                  Create Business Account
                </button>
              </Link>
              <Link to="/pools">
                <button
                  type="button"
                  className="px-5 py-2.5 rounded-full font-sans font-medium text-xs sm:text-sm border transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                >
                  Explore Active Pools
                </button>
              </Link>
            </div>
          </div>
        </section>

        {/* =========================================================================
            SECTION 9: QUIET LUXURY B2B FOOTER
            ========================================================================= */}
        <footer
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
          className="border-t py-8 px-4 sm:px-6 lg:px-8 transition-colors duration-200"
        >
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 text-xs">
            <div className="flex items-center gap-3">
              <Logo variant="monogram" size="sm" />
              <div className="flex flex-col">
                <span className="font-sans font-medium text-xs tracking-wider" style={{ color: 'var(--brand-accent)' }}>
                  Milkar Khareedo, Behtar Pao
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  Collective Food Procurement Platform
                </span>
              </div>
            </div>

            <div
              className="flex flex-wrap items-center justify-center gap-6"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Link to="/pools" className="hover:underline">
                Explore Active Pools
              </Link>
              <span>•</span>
              <a href="#how-it-works" className="hover:underline">
                How It Works
              </a>
              <span>•</span>
              <Link to="/rfq" className="hover:underline">
                Direct RFQs
              </Link>
              <span>•</span>
              <Link to="/register" className="hover:underline">
                Supplier Registration
              </Link>
            </div>

            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              © {CURRENT_YEAR} MilJor Platform. All rights reserved.
            </div>
          </div>
        </footer>
      </div>
    </AppShell>
  );
};

export default LandingPage;
