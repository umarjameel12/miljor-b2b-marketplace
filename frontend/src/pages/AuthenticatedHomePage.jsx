import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AppShell } from '../components/layout/AppShell';
import { PoolCard as LandingPoolCard } from '../components/LandingPoolCard';
import { poolsApi } from '../api/pools';
import riceImage from '../assets/premium_rice_sack.jpg';
import riceHero from '../assets/hero/miljor-rice-hero-light.png';
import chanaDalImage from '../assets/landing/miljor-chana-dal-premium.webp';

/**
 * Authenticated Buyer Home Page
 * Matches the approved LandingPage Hero + Active Buying Pools experience inside AppShell,
 * stopping cleanly after the Active Buying Pools section (previous version backed up in
 * AuthenticatedHomePage.backup.jsx and frontend/backups/pre_post_signin_redesign_2026_11_24/).
 */
const COMMODITIES = [
  {
    title: 'Rice & grains',
    subtitle: 'Basmati and everyday staples',
    image: riceImage,
    alt: 'Premium rice packaged for wholesale food supply',
  },
  {
    title: 'Wheat & flour',
    subtitle: 'Everyday supplies for busy kitchens',
    image: 'https://unsplash.com/photos/KMDGu1blGi8/download?force=true&w=1200',
    alt: 'Golden wheat heads and grain texture',
  },
  {
    title: 'Cooking oil',
    subtitle: 'Everyday kitchen essentials',
    image: 'https://images.pexels.com/photos/3737651/pexels-photo-3737651.jpeg?auto=compress&cs=tinysrgb&w=1200',
    alt: 'Unbranded clear glass bottle of golden cooking oil against a neutral backdrop',
  },
];

const LANDING_SHOWCASE_END = Date.parse('2026-12-18T00:00:00+05:00');
const DEMO_PREVIEWS = [
  {
    id: 'showcase-rice-preview', pool_code: 'SHOW-RICE', status: 'ACTIVE',
    product_name: 'Super Kernel Basmati Rice — 25kg', variety: 'Premium Long Grain · Food-Service Supply',
    category_name: 'Rice & Grains', quality_grade: 'Restaurant Grade A',
    pack_size: '25kg Bag', pool_unit: 'bag', supplier_business_name: 'Sample Rice Supplier',
    estimated_unit_price: 7200, committed_quantity: 72, target_quantity: 150,
    fill_percentage: 48, delivery_type: 'BOTH',
    image_url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=960&q=82',
    illustrative_sku: 'MJ-INTRO-RICE-25',
    scheduled_close_at: '2026-12-17T17:30:00+05:00',
    promised_delivery_at: '2026-12-20T17:30:00+05:00',
    pricing_tiers: [{ min_qty: 50, price_per_unit: 7450 }, { min_qty: 150, price_per_unit: 7200 }],
  },
  {
    id: 'demo-flour-preview', pool_code: 'DEMO-FLOUR', status: 'ACTIVE',
    product_name: 'Sunridge Super Fine Atta', variety: 'Super Fine Wheat Atta · Restaurant Use',
    category_name: 'Flour & Bakery', quality_grade: 'Commercial Fine-Milled',
    pack_size: '20kg Bag', pool_unit: 'bag', supplier_business_name: 'Punjab Flour Traders',
    estimated_unit_price: 2650, committed_quantity: 36, target_quantity: 120,
    fill_percentage: 30, delivery_type: 'BOTH',
    image_url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=960&q=82',
    illustrative_sku: 'MJ-INTRO-ATTA-20',
    scheduled_close_at: '2026-12-17T18:00:00+05:00',
    promised_delivery_at: '2026-12-20T18:00:00+05:00',
    pricing_tiers: [{ min_qty: 40, price_per_unit: 2800 }, { min_qty: 120, price_per_unit: 2650 }],
  },
  {
    id: 'demo-oil-preview', pool_code: 'DEMO-OIL', status: 'ACTIVE',
    product_name: 'Sufi Cooking Oil — 16L Tin', variety: 'Refined Cooking Oil · Food-Service Use',
    category_name: 'Cooking Oil & Ghee', quality_grade: 'Commercial Food-Service Grade',
    pack_size: '16L Tin', pool_unit: 'tin', supplier_business_name: 'City Oils Wholesale',
    estimated_unit_price: 7900, committed_quantity: 24, target_quantity: 80,
    fill_percentage: 30, delivery_type: 'BOTH',
    image_url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=960&q=82',
    illustrative_sku: 'MJ-INTRO-OIL-16',
    scheduled_close_at: '2026-12-17T18:30:00+05:00',
    promised_delivery_at: '2026-12-21T18:30:00+05:00',
    pricing_tiers: [{ min_qty: 30, price_per_unit: 8150 }, { min_qty: 80, price_per_unit: 7900 }],
  },
  {
    id: 'demo-daal-preview', pool_code: 'DEMO-DAAL', status: 'ACTIVE',
    product_name: 'Premium Daal Chana — Bold Grain', variety: 'Polished Chana Dal · Bold Grain',
    category_name: 'Pulses & Lentils', quality_grade: 'Selected Commercial Quality',
    pack_size: '25kg Bag', pool_unit: 'bag', supplier_business_name: 'Lahore Pulses Supply',
    estimated_unit_price: 6100, committed_quantity: 45, target_quantity: 150,
    fill_percentage: 30, delivery_type: 'BOTH',
    image_url: chanaDalImage,
    illustrative_sku: 'MJ-INTRO-CHANA-25',
    scheduled_close_at: '2026-12-17T19:00:00+05:00',
    promised_delivery_at: '2026-12-21T19:00:00+05:00',
    pricing_tiers: [{ min_qty: 50, price_per_unit: 6300 }, { min_qty: 150, price_per_unit: 6100 }],
  },
];

function CommoditySlide({ item, active }) {
  return (
    <div
      className={'absolute inset-0 transition-opacity duration-700 ease-in-out ' + (active ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none')}
      aria-hidden={!active}
    >
      <img
        src={item.image}
        alt={item.alt}
        className="absolute inset-0 h-full w-full object-cover object-center"
        loading={active ? 'eager' : 'lazy'}
        onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = riceHero; }}
      />
      <div data-miljor-hero-shade="v2" className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(6,30,24,0.06), rgba(6,30,24,0.08) 35%, rgba(6,30,24,0.78))' }} />
      <div data-miljor-caption-upgrade="v2" className="absolute bottom-0 left-0 right-0 p-7 sm:p-10 text-[#F9F4E9]">
        <h3 className="font-sans text-3xl sm:text-4xl font-semibold tracking-tight">{item.title}</h3>
        <p className="mt-2 text-sm text-[#E9E2D5]">{item.subtitle}</p>
      </div>
    </div>
  );
}

export const AuthenticatedHomePage = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [featuredPools, setFeaturedPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [poolLoadError, setPoolLoadError] = useState(false);
  const poolCarouselRef = useRef(null);
  const showIntroPools = Date.now() < LANDING_SHOWCASE_END;

  useEffect(() => {
    if (paused || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return undefined;
    const timer = setInterval(() => setSlide((index) => (index + 1) % COMMODITIES.length), 5000);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    let mounted = true;
    poolsApi.getActivePools({ limit: 12 })
      .then((response) => {
        if (mounted) {
          setFeaturedPools(
            Array.isArray(response?.data?.pools)
              ? response.data.pools.filter((pool) => pool?.id && ['ACTIVE', 'OPEN', 'PUBLISHED'].includes(String(pool.status || 'ACTIVE').toUpperCase())).slice(0, 12)
              : []
          );
        }
      })
      .catch(() => { if (mounted) { setFeaturedPools([]); setPoolLoadError(true); } })
      .finally(() => { if (mounted) setLoadingPools(false); });
    return () => { mounted = false; };
  }, []);

  const changeSlide = (direction) => setSlide((index) => (index + direction + COMMODITIES.length) % COMMODITIES.length);
  const scrollToPools = () => {
    document.getElementById('live-pools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const requestQuoteDestination = isAuthenticated ? '/procurement' : '/login';
  const quoteState = isAuthenticated ? undefined : { from: { pathname: '/procurement' } };
  const buttonGold = { color: 'var(--text-on-champagne)' };

  return (
    <AppShell>
      <div
        className="miljor-buyer-home-root miljor-public-landing miljor-premium-landing min-h-full font-sans w-full"
        style={{ background: 'transparent', backgroundColor: 'transparent', color: 'var(--text-primary)' }}
      >
        <style>{`/* MILJOR HERO CAPTION DIRECT V2 */
          .miljor-buyer-home-root.miljor-public-landing .miljor-commodity-frame [data-miljor-hero-shade="v2"] {
            background: linear-gradient(180deg, rgba(9,29,23,.03) 0%, rgba(8,28,22,.13) 37%, rgba(8,30,23,.64) 69%, rgba(6,24,19,.93) 100%) !important;
          }
          .miljor-buyer-home-root.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] h3 {
            font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif !important;
            font-size: clamp(1.9rem,3.1vw,2.6rem) !important;
            font-weight: 760 !important;
            letter-spacing: -.047em !important;
            line-height: 1.14 !important;
            color: #fffaf0 !important;
            -webkit-text-fill-color: #fffaf0 !important;
            text-shadow: 0 2px 16px rgba(0,0,0,.6) !important;
          }
          .miljor-buyer-home-root.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] p {
            font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif !important;
            font-size: clamp(.85rem,1.15vw,.96rem) !important;
            font-weight: 560 !important;
            letter-spacing: .005em !important;
            line-height: 1.55 !important;
            color: #eddfc3 !important;
            -webkit-text-fill-color: #eddfc3 !important;
            text-shadow: 0 1px 11px rgba(0,0,0,.68) !important;
          }
          html.dark .miljor-buyer-home-root.miljor-public-landing .miljor-commodity-frame [data-miljor-hero-shade="v2"] {
            background: linear-gradient(180deg, rgba(2,22,16,.06) 0%, rgba(4,29,21,.20) 37%, rgba(2,26,19,.75) 70%, rgba(2,20,15,.98) 100%) !important;
          }
          html.dark .miljor-buyer-home-root.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] h3 {
            color: #fff9e9 !important;
            -webkit-text-fill-color: #fff9e9 !important;
            text-shadow: 0 3px 18px rgba(0,0,0,.72) !important;
          }
          html.dark .miljor-buyer-home-root.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] p {
            color: #e8cb92 !important;
            -webkit-text-fill-color: #e8cb92 !important;
          }
        `}</style>
        <main>
          <section className="landing-premium-hero mx-auto grid max-w-7xl grid-cols-1 items-center gap-9 px-5 pb-14 pt-10 sm:px-8 md:pt-14 lg:grid-cols-2 lg:gap-14 lg:px-10 lg:pb-12">
            <div className="max-w-xl">
              <span
                className="landing-tagline inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.17em]"
                style={{ borderColor: 'var(--border-default)', color: 'var(--brand-accent)' }}
              >
                Mil Kar Khareedo, Behtar Pao
              </span>
              <h1
                data-miljor-headline-v7="restored"
                className="landing-display mt-7 text-[clamp(2.75rem,5.1vw,5.1rem)] font-semibold leading-[1.07] tracking-[-0.055em]"
                data-miljor-hero-fix="v4"
              >
                Buy Better
                <span
                  className="landing-display-gradient block"
                  style={{ color: 'var(--brand-accent)', lineHeight: 1.18, paddingBottom: '0.16em', overflow: 'visible' }}
                >
                  Together
                </span>
              </h1>
              <p
                data-miljor-description-v7="restored"
                className="mt-6 max-w-md text-sm leading-7 sm:text-base"
                style={{ color: 'var(--text-secondary)' }}
              >
                Wholesale procurement, made easier for growing food businesses.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={scrollToPools}
                  className="landing-gradient-cta inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
                  style={buttonGold}
                >
                  Explore Pools
                </button>
                <Link
                  to={requestQuoteDestination}
                  state={quoteState}
                  className="landing-gradient-cta inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold"
                  style={buttonGold}
                >
                  Request a Quote
                </Link>
              </div>
            </div>

            <div className="relative">
              <div
                className="miljor-commodity-frame landing-premium-image relative aspect-[5/4] overflow-hidden rounded-[1.75rem] border shadow-2xl sm:aspect-[6/5]"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
                onFocusCapture={() => setPaused(true)}
                onBlurCapture={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
                }}
              >
                {COMMODITIES.map((item, index) => (
                  <CommoditySlide key={item.title} item={item} active={index === slide} />
                ))}

                <div className="absolute right-5 bottom-6 z-20 flex gap-2">
                  <button
                    type="button"
                    aria-label="Previous commodity"
                    onClick={() => changeSlide(-1)}
                    className="grid h-9 w-9 place-items-center rounded-full border border-white/40 bg-black/30 text-white backdrop-blur-md hover:bg-black/50"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next commodity"
                    onClick={() => changeSlide(1)}
                    className="grid h-9 w-9 place-items-center rounded-full border border-white/40 bg-black/30 text-white backdrop-blur-md hover:bg-black/50"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
              <div className="mt-4 flex justify-center gap-2" role="group" aria-label="Choose commodity slide">
                {COMMODITIES.map((item, index) => (
                  <button
                    key={item.title}
                    type="button"
                    aria-label={'Show ' + item.title}
                    aria-current={index === slide ? 'true' : undefined}
                    onClick={() => setSlide(index)}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: index === slide ? 34 : 12,
                      backgroundColor: index === slide ? 'var(--brand-accent)' : 'var(--border-default)',
                    }}
                  />
                ))}
              </div>
            </div>
          </section>

          <section id="live-pools" className="landing-premium-pools mx-auto max-w-7xl scroll-mt-24 px-5 pt-8 pb-14 sm:px-8 sm:pt-10 sm:pb-16 lg:px-10">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="landing-eyebrow text-[11px] font-semibold uppercase tracking-[0.19em]">Supplier-led procurement</p>
                <h2 className="landing-section-title mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Active buying pools</h2>
              </div>
              <Link
                to={user?.role === 'SUPPLIER' ? '/supplier/pools' : '/pools'}
                className="landing-top-link inline-flex items-center gap-2 text-sm font-semibold"
              >
                {user?.role === 'SUPPLIER' ? 'Manage your pools' : 'View All Pools'} <ArrowRight size={16} />
              </Link>
            </div>
            <div className="mb-3 flex items-center justify-end gap-2">
              <button
                type="button"
                aria-label="Scroll pools left"
                onClick={() => poolCarouselRef.current?.scrollBy({ left: -360, behavior: 'smooth' })}
                className="miljor-pool-nav grid h-9 w-9 place-items-center rounded-full border transition-colors"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-card)' }}
              >
                <ChevronLeft size={17} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Scroll pools right"
                onClick={() => poolCarouselRef.current?.scrollBy({ left: 360, behavior: 'smooth' })}
                className="miljor-pool-nav grid h-9 w-9 place-items-center rounded-full border transition-colors"
                style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-card)' }}
              >
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            </div>
            <div
              ref={poolCarouselRef}
              role="region"
              aria-label="Supplier pools and temporary introductory examples"
              tabIndex={0}
              className="miljor-pool-rail flex items-stretch gap-5 overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-4"
            >
              {!loadingPools && featuredPools.map((pool) => (
                <div key={pool.id} className="landing-pool-shell flex w-[min(84vw,340px)] shrink-0 snap-start flex-col">
                  <LandingPoolCard
                    pool={pool}
                    onSelect={() => navigate('/pools')}
                  />
                </div>
              ))}
              {showIntroPools && DEMO_PREVIEWS.map((pool) => (
                <div key={pool.id} className="landing-pool-shell landing-showcase-shell flex w-[min(84vw,340px)] shrink-0 snap-start flex-col" aria-label="Introductory display: explore active pools">
                  <LandingPoolCard
                    pool={pool}
                    isExample
                    onSelect={() => navigate('/pools')}
                  />
                </div>
              ))}
            </div>
            {loadingPools && (
              <div role="status" className="landing-pool-loading mt-4 rounded-2xl border px-6 py-8 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
                Checking published supplier pools…
              </div>
            )}
            {!loadingPools && poolLoadError && (
              <div role="alert" className="landing-pool-empty mt-4 rounded-3xl border px-7 py-9 sm:px-10">
                <h3 className="text-lg font-semibold">Unable to load published pools</h3>
                <p className="mt-2 text-sm">Live supplier availability could not be checked right now. Please try again shortly.</p>
              </div>
            )}
          </section>
        </main>
      </div>
    </AppShell>
  );
};

export default AuthenticatedHomePage;
