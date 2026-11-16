import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, ShoppingBag, Truck, ShieldCheck, Layers, Menu, X, ArrowUpRight, FileText, Store, User, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ThemeSelector } from '../components/ui/ThemeSelector';
import { Logo } from '../components/ui/Logo';
import { PoolCard } from '../components/PoolCard';
import { poolsApi } from '../api/pools';
import riceImage from '../assets/premium_rice_sack.jpg';
import riceHero from '../assets/hero/miljor-rice-hero-light.png';

/**
 * Public-only landing page. Authenticated procurement pages retain AppShell.
 * All displayed pools are fetched from the real API. Commodity imagery is editorial,
 * never represented as actual supplier inventory or live prices.
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


// Visual examples only; never treated as published supplier listings or orders.
// Showcase data: these are fictional examples, NOT published supplier offers.
const PREVIEW_POOLS = [
  {
    id: 'example-flour', product_name: 'Sunridge Super Fine Atta', variety: 'Super Fine Wheat Atta · Restaurant Use',
    category_name: 'Flour & Bakery', quality_grade: 'Commercial Fine-Milled',
    pack_size: '20kg Bag', pack_unit: 'kg', pool_unit: 'bag',
    supplier_business_name: 'Punjab Flour Traders',
    buyer_min_qty: 2, estimated_unit_price: 2650,
    target_quantity: 120, committed_quantity: 36, fill_percentage: 30,
    image_url: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=960&q=82',
    delivery_type: 'BOTH', pool_code: 'DEMO-FLOUR-01', status: 'ACTIVE',
  },
  {
    id: 'example-oil', product_name: 'Sufi Cooking Oil — 16L Tin', variety: 'Refined Cooking Oil · Food-Service Use',
    category_name: 'Cooking Oil & Ghee', quality_grade: 'Commercial Food-Service Grade',
    pack_size: '16L Tin', pack_unit: 'L', pool_unit: 'tin',
    supplier_business_name: 'City Oils Wholesale',
    buyer_min_qty: 1, estimated_unit_price: 7900,
    target_quantity: 80, committed_quantity: 24, fill_percentage: 30,
    image_url: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=960&q=82',
    delivery_type: 'BOTH', pool_code: 'DEMO-OIL-01', status: 'ACTIVE',
  },
  {
    id: 'example-daal', product_name: 'Premium Daal Chana — Bold Grain', variety: 'Polished Chana Dal · Bold Grain',
    category_name: 'Pulses & Lentils', quality_grade: 'Selected Commercial Quality',
    pack_size: '25kg Bag', pack_unit: 'kg', pool_unit: 'bag',
    supplier_business_name: 'Lahore Pulses Supply',
    buyer_min_qty: 1, estimated_unit_price: 6100,
    target_quantity: 150, committed_quantity: 45, fill_percentage: 30,
    image_url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Channa_dall.JPG?width=960',
    delivery_type: 'BOTH', pool_code: 'DEMO-DAAL-01', status: 'ACTIVE',
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
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(6,30,24,0.06), rgba(6,30,24,0.08) 35%, rgba(6,30,24,0.78))' }} />
      <div className="absolute bottom-0 left-0 right-0 p-7 sm:p-10 text-[#F9F4E9]">
        <h3 className="font-sans text-3xl sm:text-4xl font-semibold tracking-tight">{item.title}</h3>
        <p className="mt-2 text-sm text-[#E9E2D5]">{item.subtitle}</p>
      </div>
    </div>
  );
}

export const LandingPage = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [featuredPools, setFeaturedPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const poolCarouselRef = useRef(null);
  const [exampleDeadline] = useState(() => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000));

  useEffect(() => {
    if (paused || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return undefined;
    const timer = setInterval(() => setSlide((index) => (index + 1) % COMMODITIES.length), 5000);
    return () => clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const onOutside = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    const onEscape = (event) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    let mounted = true;
    poolsApi.getActivePools({ limit: 6 })
      .then((response) => {
        if (mounted) setFeaturedPools(Array.isArray(response?.data?.pools) ? response.data.pools.slice(0, 6) : []);
      })
      .catch(() => { if (mounted) setFeaturedPools([]); })
      .finally(() => { if (mounted) setLoadingPools(false); });
    return () => { mounted = false; };
  }, []);

  const changeSlide = (direction) => setSlide((index) => (index + direction + COMMODITIES.length) % COMMODITIES.length);
  const dashboardPath = user?.role === 'SUPPLIER' ? '/supplier/dashboard' : ['ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? '/admin/dashboard' : '/pools';

  const requestQuoteDestination = isAuthenticated ? '/rfqs' : '/login';
  const quoteState = isAuthenticated ? undefined : { from: { pathname: '/rfqs' } };
  const buttonGold = { color: 'var(--text-on-champagne)' };
  const scrollToPools = () => document.getElementById('live-pools')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const panel = { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' };

  return (
    <div id="top" className="miljor-public-landing min-h-screen font-sans" style={{ background: 'var(--bg-dashboard)', color: 'var(--text-primary)' }}>
      <header className="landing-topbar sticky top-0 z-50 border-b backdrop-blur-xl" style={{ backgroundColor: 'var(--landing-header-bg)', borderColor: 'var(--border-sidebar)', color: 'var(--text-primary)' }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 sm:px-8 lg:px-10">
          <Link to="/" aria-label="MilJor home" className="flex shrink-0 items-center"><Logo variant="monogram" size="md" /></Link>
          <div className="hidden sm:flex items-center gap-3">
            <ThemeSelector minimal />
            {isAuthenticated ? (
              <Link to={dashboardPath} className="rounded-full px-5 py-2.5 text-xs font-semibold" style={buttonGold}>Open Marketplace</Link>
            ) : (
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((open) => !open)}
                  aria-label="User Account Menu"
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  aria-controls="landing-account-options"
                  title="Account Menu"
                  className="landing-account-trigger flex items-center gap-2.5 h-9 px-3 rounded-xl border transition-all duration-200 cursor-pointer shadow-xs active:scale-95"
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div className="w-6 h-6 rounded-full bg-[var(--brand-accent)] text-[#072a21] flex items-center justify-center font-bold text-xs shrink-0">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-xs font-semibold max-w-[120px] truncate" style={{ color: 'var(--text-primary)' }}>
                    Account
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-stone-700 dark:text-stone-300 transition-transform duration-200 ${accountMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {accountMenuOpen && (
                  <div
                    id="landing-account-options"
                    role="menu"
                    aria-label="Account options"
                    className="absolute right-0 top-full mt-2 w-64 p-3.5 rounded-2xl border shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-default)',
                      boxShadow: 'var(--shadow-elevated)',
                    }}
                  >
                    <div className="space-y-3">
                      <div className="text-center pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Welcome to MilJor
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          Wholesale Collective Procurement
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Link
                          role="menuitem"
                          to="/login"
                          onClick={() => setAccountMenuOpen(false)}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                          style={{
                            backgroundColor: 'var(--bg-card)',
                            borderColor: 'var(--border-default)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <User className="w-3.5 h-3.5 text-emerald-900 dark:text-champagne" />
                          <span>Sign In</span>
                        </Link>
                        <Link
                          role="menuitem"
                          to="/register"
                          onClick={() => setAccountMenuOpen(false)}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer hover:opacity-95"
                          style={{
                            backgroundColor: 'var(--brand-accent)',
                            color: 'var(--text-on-champagne)',
                          }}
                        >
                          <span>Register</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 sm:hidden"><ThemeSelector minimal /><button type="button" onClick={() => setMobileMenu((open) => !open)} aria-expanded={mobileMenu} aria-label="Toggle navigation" className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>{mobileMenu ? <X size={19} /> : <Menu size={19} />}</button></div>
        </div>
        {mobileMenu && (
          <nav className="flex flex-col gap-1 border-t px-5 py-3 sm:hidden" style={panel} aria-label="Mobile public navigation">
            {isAuthenticated ? (
              <Link to={dashboardPath} className="rounded-lg px-3 py-2 text-sm font-semibold" onClick={() => setMobileMenu(false)}>Open Marketplace</Link>
            ) : (
              <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="px-3 py-2 text-sm font-semibold">Account</div>
                <Link to="/login" onClick={() => setMobileMenu(false)} className="landing-account-option block rounded-lg px-3 py-2.5 text-sm">Sign In</Link>
                <Link to="/register" onClick={() => setMobileMenu(false)} className="landing-account-option block rounded-lg px-3 py-2.5 text-sm">Register</Link>
              </div>
            )}
          </nav>
        )}
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-9 px-5 pb-14 pt-10 sm:px-8 md:pt-14 lg:grid-cols-2 lg:gap-14 lg:px-10 lg:pb-12">
          <div className="max-w-xl">
            <span className="landing-tagline inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.17em]" style={{ borderColor: 'var(--border-default)' }}>Mil Kar Khareedo, Behtar Pao</span>
            <h1 className="landing-display mt-7 text-[clamp(2.75rem,5.1vw,5.1rem)] font-semibold leading-[1.07] tracking-[-0.055em]">
              Buy Better<span className="landing-display-gradient block">Together</span>
            </h1>
            <p className="mt-6 max-w-md text-sm leading-7 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              Wholesale procurement, made easier for growing food businesses.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <button type="button" onClick={scrollToPools} className="landing-gradient-cta inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold" style={buttonGold}>Explore Pools</button>
              <Link to={requestQuoteDestination} state={quoteState} className="landing-gradient-cta inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold" style={buttonGold}>Request a Quote</Link>
            </div>
          </div>

          <div className="relative">
            <div className="miljor-commodity-frame relative aspect-[5/4] overflow-hidden rounded-[1.75rem] border shadow-2xl sm:aspect-[6/5]" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
              onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
              onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
              {COMMODITIES.map((item, index) => <CommoditySlide key={item.title} item={item} active={index === slide} />)}
              
              <div className="absolute right-5 bottom-6 z-20 flex gap-2">
                <button type="button" aria-label="Previous commodity" onClick={() => changeSlide(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-white/40 bg-black/30 text-white backdrop-blur-md hover:bg-black/50"><ChevronLeft size={18} /></button>
                <button type="button" aria-label="Next commodity" onClick={() => changeSlide(1)} className="grid h-9 w-9 place-items-center rounded-full border border-white/40 bg-black/30 text-white backdrop-blur-md hover:bg-black/50"><ChevronRight size={18} /></button>
              </div>
            </div>
            <div className="mt-4 flex justify-center gap-2" role="group" aria-label="Choose commodity slide">
              {COMMODITIES.map((item, index) => <button key={item.title} type="button" aria-label={'Show ' + item.title} aria-current={index === slide ? 'true' : undefined} onClick={() => setSlide(index)} className="h-1.5 rounded-full transition-all" style={{ width: index === slide ? 34 : 12, backgroundColor: index === slide ? 'var(--brand-accent)' : 'var(--border-default)' }} />)}
            </div>
          </div>
        </section>

        <section id="live-pools" className="mx-auto max-w-7xl scroll-mt-24 px-5 pt-8 pb-12 sm:px-8 sm:pt-10 sm:pb-14 lg:px-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="landing-eyebrow text-[11px] font-semibold uppercase tracking-[0.19em]">Supplier-led procurement</p>
              <h2 className="landing-section-title mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Active buying pools</h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Published supplier offers and showcase listings. Availability is confirmed after sign-in.</p>
            </div>
            {isAuthenticated ? (
              <Link to={user?.role === 'SUPPLIER' ? '/supplier/pools' : '/pools'} className="landing-top-link inline-flex items-center gap-2 text-sm font-semibold">
                {user?.role === 'SUPPLIER' ? 'Manage your pools' : 'View All Pools'} <ArrowRight size={16} />
              </Link>
            ) : (
              <button type="button" onClick={scrollToPools} className="landing-live-offers-link inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold">Explore live offers</button>
            )}
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
            aria-label="Buying pools and showcase listings"
            tabIndex={0}
            className="miljor-pool-rail flex items-stretch gap-5 overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-4"
          >
            {!loadingPools && featuredPools.map((pool) => (
              <div key={pool.id} className="flex w-[min(84vw,340px)] shrink-0 snap-start flex-col">
                <PoolCard pool={pool} onSelect={() => navigate('/login', { state: { from: { pathname: '/pools' } } })} />
              </div>
            ))}
            {/* Same card component and 15-day countdown for category examples.
                Nothing here changes the backend deadlines of real published pools. */}
            {PREVIEW_POOLS.map((item) => (
              <div key={item.id} className="flex w-[min(84vw,340px)] shrink-0 snap-start flex-col">
                <PoolCard
                  isExample
                  onSelect={() => navigate('/login', { state: { from: { pathname: '/pools' } } })}
                  pool={{
                    ...item,
                    scheduled_close_at: exampleDeadline.toISOString(),
                    promised_delivery_at: new Date(exampleDeadline.getTime() + 3 * 86400000).toISOString(),
                    // These figures are illustrative and do not reserve inventory.
                    fill_percentage: item.fill_percentage,
                    committed_quantity: item.committed_quantity,
                  }}
                />
              </div>
            ))}
          </div>
          {loadingPools && <p role="status" className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>Checking published pools…</p>}
          {!loadingPools && featuredPools.length === 0 && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>No published supplier offers currently. Showcase listings are not yet available for purchase.</p>
          )}
        </section>

        <section id="suppliers" className="border-t py-16 sm:py-20" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="rounded-[1.75rem] border p-7 sm:p-10 lg:p-12" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--card-glass)', boxShadow: 'var(--shadow-card)' }}>
              <div className="grid items-center gap-10 lg:grid-cols-[1fr_0.85fr] lg:gap-16">
                <div>
                  <p className="landing-eyebrow text-[11px] font-semibold uppercase tracking-[0.19em]">For buyers and suppliers</p>
                  <h2 className="landing-section-title mt-4 max-w-xl text-3xl leading-tight font-bold sm:text-[2.6rem]">Better sourcing. Simpler selling.</h2>
                  <p className="mt-5 max-w-md text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                    Bring business demand and supplier offers together, with clear pricing and coordinated fulfillment.
                  </p>
                  <Link to="/register" className="landing-gradient-cta mt-7 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold" style={buttonGold}>Join MilJor</Link>
                </div>
                <div className="grid gap-3">
                  {[
                    { icon: Layers, title: 'Buy collectively', text: 'Join available pools and view quantity-based pricing.' },
                    { icon: ShieldCheck, title: 'Purchase clearly', text: 'See terms before you confirm and pay.' },
                    { icon: Truck, title: 'Stay informed', text: 'Follow delivery progress and confirm receipt.' },
                  ].map((item) => <div key={item.title} className="flex items-center gap-4 rounded-2xl border p-4 sm:p-5" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-card)' }}>
                    <span className="shrink-0 rounded-xl border p-3" style={{ borderColor: 'var(--border-default)', color: 'var(--landing-accent-text)' }}><item.icon size={18} /></span>
                    <div><h3 className="landing-section-title text-sm font-semibold">{item.title}</h3><p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{item.text}</p></div>
                  </div>)}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="mx-auto max-w-7xl px-5 py-6 text-center text-xs sm:px-8" style={{ color: 'var(--text-secondary)' }}>
          © {new Date().getFullYear()} MilJor · Mil Kar Khareedo, Behtar Pao.
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
