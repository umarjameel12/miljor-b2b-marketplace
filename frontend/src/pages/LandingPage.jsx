import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, ShoppingBag, Truck, ShieldCheck, Layers, Menu, X, ArrowUpRight, FileText, Store, UserRound, ChevronDown, LogIn, UserPlus } from 'lucide-react';
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


const PREVIEW_POOLS = [
  { title: 'Super Kernel Basmati Rice', category: 'Rice & grains', target: '300 kg', pack: '25 kg bags', image: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=960&q=82', icon: Layers, spec: 'Export Grade A · Old Crop Sella' },
  { title: 'Fine Wheat Flour', category: 'Flour & bakery', target: '500 kg', pack: '20 kg bags', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=960&q=82', icon: ShoppingBag, spec: 'Fine wheat flour · commercial milling' },
  { title: 'Refined Cooking Oil', category: 'Commercial essentials', target: '160 L', pack: '16 L tins', image: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=960&q=82', icon: Store, spec: 'Refined vegetable oil · commercial grade' },
  { title: 'Daal Chana', category: 'Pulses', target: '250 kg', pack: '25 kg bags', image: 'https://images.unsplash.com/photo-1585994192701-f1a505c817ea?auto=format&fit=crop&w=960&q=82', icon: Layers, spec: 'Special polish · bold grain' },
  { title: 'Refined White Sugar', category: 'Sweeteners', target: '500 kg', pack: '50 kg bags', image: 'https://images.unsplash.com/photo-1581441363689-1f3c3c414635?auto=format&fit=crop&w=960&q=82', icon: ShoppingBag, spec: 'Mill-packed · refined white' },
  { title: 'Super White Maida', category: 'Bakery staples', target: '840 kg', pack: '84 kg bags', image: 'https://images.unsplash.com/photo-1601593768795-9ac27c0c9d71?auto=format&fit=crop&w=960&q=82', icon: Store, spec: 'Bakery grade · fine-milled' },
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
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [featuredPools, setFeaturedPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(true);

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
    poolsApi.getActivePools({ limit: 3 })
      .then((response) => {
        if (mounted) setFeaturedPools(Array.isArray(response?.data?.pools) ? response.data.pools.slice(0, 3) : []);
      })
      .catch(() => { if (mounted) setFeaturedPools([]); })
      .finally(() => { if (mounted) setLoadingPools(false); });
    return () => { mounted = false; };
  }, []);

  const changeSlide = (direction) => setSlide((index) => (index + direction + COMMODITIES.length) % COMMODITIES.length);
  const dashboardPath = user?.role === 'SUPPLIER' ? '/supplier/dashboard' : ['ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? '/admin/dashboard' : '/pools';

  const navLinks = [
    { title: 'Browse Pools', to: '#live-pools', icon: Layers },
    { title: 'For Suppliers', to: '#suppliers', icon: Store },
  ];
  const navClass = 'landing-top-link inline-flex items-center gap-2 text-xs sm:text-sm font-semibold transition-colors';
  const requestQuoteDestination = isAuthenticated ? '/rfqs' : '/login';
  const quoteState = isAuthenticated ? undefined : { from: { pathname: '/rfqs' } };
  const buttonGold = { color: 'var(--text-on-champagne)' };
  const exploreDestination = isAuthenticated ? '/pools' : '#live-pools';
  const panel = { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' };

  return (
    <div id="top" className="miljor-public-landing min-h-screen font-sans" style={{ background: 'var(--bg-dashboard)', color: 'var(--text-primary)' }}>
      <header className="landing-topbar sticky top-0 z-50 border-b backdrop-blur-xl" style={{ backgroundColor: 'var(--landing-header-bg)', borderColor: 'var(--border-sidebar)', color: 'var(--text-primary)' }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-3 sm:px-8 lg:px-10">
          <Link to="/" aria-label="MilJor home" className="flex shrink-0 items-center"><Logo variant="monogram" size="md" /></Link>
          <nav className="hidden lg:flex items-center gap-7" aria-label="Public navigation">
            {navLinks.map((link) => <a key={link.title} href={link.to} className={navClass}><link.icon size={15} className="landing-nav-icon" />{link.title}</a>)}
            <Link to={requestQuoteDestination} state={quoteState} className={navClass}><FileText size={15} className="landing-nav-icon" />Request Quote</Link>
          </nav>
          <div className="hidden sm:flex items-center gap-3">
            <ThemeSelector minimal />
            {isAuthenticated ? (
              <Link to={dashboardPath} className="rounded-full px-5 py-2.5 text-xs font-semibold" style={buttonGold}>Open Marketplace</Link>
            ) : (
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  aria-controls="landing-account-options"
                  className="landing-gradient-cta landing-account-trigger inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-accent)]"
                  style={{ borderColor: 'var(--brand-accent)', color: 'var(--text-on-champagne)' }}
                >
                  <UserRound size={16} aria-hidden="true" />
                  Account
                  <ChevronDown size={14} className={accountMenuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
                </button>
                {accountMenuOpen && (
                  <div
                    id="landing-account-options"
                    role="menu"
                    aria-label="Account options"
                    className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border p-1.5 shadow-xl"
                    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                  >
                    <Link
                      role="menuitem"
                      to="/login"
                      onClick={() => setAccountMenuOpen(false)}
                      className="landing-account-option block rounded-lg px-3 py-2.5 text-sm font-medium"
                    >
                      Sign In
                    </Link>
                    <Link
                      role="menuitem"
                      to="/register"
                      onClick={() => setAccountMenuOpen(false)}
                      className="landing-account-option flex items-center rounded-lg px-3 py-2.5 text-sm font-medium"
                    >
                      Register
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 sm:hidden"><ThemeSelector minimal /><button type="button" onClick={() => setMobileMenu((open) => !open)} aria-expanded={mobileMenu} aria-label="Toggle navigation" className="rounded-lg border p-2" style={{ borderColor: 'var(--border-subtle)' }}>{mobileMenu ? <X size={19} /> : <Menu size={19} />}</button></div>
        </div>
        {mobileMenu && (
          <nav className="flex flex-col gap-1 border-t px-5 py-3 sm:hidden" style={panel} aria-label="Mobile public navigation">
            {navLinks.map((link) => <a key={link.title} href={link.to} onClick={() => setMobileMenu(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"><link.icon size={16} className="landing-nav-icon" />{link.title}</a>)}
            <Link to={requestQuoteDestination} state={quoteState} onClick={() => setMobileMenu(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"><FileText size={16} className="landing-nav-icon" />Request Quote</Link>
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
        <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-9 px-5 pb-14 pt-12 sm:px-8 md:pt-16 lg:grid-cols-2 lg:gap-14 lg:px-10 lg:pb-12">
          <div className="max-w-xl">
            <span className="landing-tagline inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.17em]" style={{ borderColor: 'var(--border-default)' }}>Mil Kar Khareedo, Behtar Pao</span>
            <h1 className="landing-display mt-7 text-[clamp(2.75rem,5.1vw,5.1rem)] font-semibold leading-[1.07] tracking-[-0.055em]">
              Buy Better<span className="landing-display-gradient block">Together</span>
            </h1>
            <p className="mt-6 max-w-md text-sm leading-7 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              Wholesale procurement, made easier for growing food businesses.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to={exploreDestination} className="landing-gradient-cta inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold" style={buttonGold}>Explore Pools</Link>
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
              <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Published supplier offers, updated from the marketplace.</p>
            </div>
            {isAuthenticated ? (
              <Link to={user?.role === 'SUPPLIER' ? '/supplier/pools' : '/pools'} className="landing-top-link inline-flex items-center gap-2 text-sm font-semibold">
                {user?.role === 'SUPPLIER' ? 'Manage your pools' : 'View All Pools'} <ArrowRight size={16} />
              </Link>
            ) : (
              <Link to="/login" state={{ from: { pathname: '/pools' } }} className="landing-live-offers-link inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold">Explore live offers <ArrowRight size={15} aria-hidden="true" /></Link>
            )}
          </div>
          {loadingPools ? (
            <p role="status" className="rounded-2xl border p-7 text-sm" style={panel}>Checking published pools…</p>
          ) : featuredPools.length > 0 ? (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {featuredPools.map((pool) => <PoolCard key={pool.id} pool={pool} />)}
            </div>
          ) : (
            <div className="space-y-6">
              {import.meta.env.DEV && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="landing-eyebrow text-[10px] font-semibold uppercase tracking-[0.17em]">Design preview · Development only</p>
                      <h3 className="landing-section-title mt-2 text-lg font-semibold">Sample procurement cards</h3>
                    </div>
                    <span className="rounded-full border px-3 py-1.5 text-[11px] font-medium" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>Not live offers</span>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {PREVIEW_POOLS.map((pool) => (
                      <article key={pool.title} className="landing-demo-card flex flex-col overflow-hidden rounded-[1.5rem] border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-card)' }}>
                        <div className="relative h-44 overflow-hidden" style={{ background: 'var(--bg-subtle)' }}>
                          <img src={pool.image} alt={pool.category + ' product reference'} loading="lazy" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                          <span className="absolute right-3 top-3 rounded-full border px-3 py-1 text-[10px] font-bold shadow-sm" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-primary)', borderColor: 'var(--border-default)' }}>PREVIEW</span>
                        </div>
                        <div className="flex flex-1 flex-col p-5 sm:p-6">
                          <p className="landing-eyebrow text-[10px] font-semibold uppercase tracking-[0.16em]">{pool.category}</p>
                          <h4 className="landing-section-title mt-2 text-lg font-semibold">{pool.title}</h4>
                          <p className="mt-2 rounded-lg px-3 py-2 text-xs leading-5" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}><span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Sample specification: </span>{pool.spec}</p>
                          <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div><p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Sample target</p><p className="mt-1 text-sm font-semibold">{pool.target}</p></div>
                            <div><p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>Pack size</p><p className="mt-1 text-sm font-semibold">{pool.pack}</p></div>
                          </div>
                          <p className="mt-4 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>Visual example only · No live inventory or pricing</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[1.5rem] border p-6 sm:p-8" style={panel}>
                <div>
                  <h3 className="landing-section-title text-base font-semibold">No published pools available yet</h3>
                  <p className="mt-2 max-w-lg text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>Actual supplier offers will appear here automatically after publication.</p>
                </div>
                <Link to={isAuthenticated && user?.role === 'SUPPLIER' ? '/supplier/pools' : isAuthenticated ? '/pools' : '/login'} className="landing-gradient-cta inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold">
                  {isAuthenticated && user?.role === 'SUPPLIER' ? 'Create a Pool' : isAuthenticated ? 'Browse Marketplace' : 'Sign In'}
                </Link>
              </div>
            </div>
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
