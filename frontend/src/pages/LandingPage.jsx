import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, ShoppingBag, Truck, ShieldCheck, Layers, Menu, X, ArrowUpRight, FileText, Store, ChevronDown, LogIn, UserPlus, User, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ThemeSelector } from '../components/ui/ThemeSelector';
import { Logo } from '../components/ui/Logo';
import { PoolCard as LandingPoolCard } from '../components/LandingPoolCard';
import { poolsApi } from '../api/pools';
import riceImage from '../assets/premium_rice_sack.jpg';
import riceHero from '../assets/hero/miljor-rice-hero-light.png';
import chanaDalImage from '../assets/landing/miljor-chana-dal-premium.webp';

/**
 * Public-only landing page. Authenticated procurement pages retain AppShell.
 * API pools are genuine published offers. Temporary landing-only showcase cards
 * are illustrative and never create, publish, or reserve inventory.
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


// Introductory 32-day landing-only examples. Never inserted into supplier listings.
// Prices and progress below are illustrative; users must sign in to see actual availability.
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

export const LandingPage = () => {
  const { isDark } = useTheme();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const miljorV6RootRef = useRef(null);
  const miljorV6OriginalBackgroundRef = useRef(null);
  const scrollToPools = () => {
    document.getElementById('live-pools')
      ?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
  };
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [featuredPools, setFeaturedPools] = useState([]);
  const [loadingPools, setLoadingPools] = useState(true);
  const [poolLoadError, setPoolLoadError] = useState(false);
  const poolCarouselRef = useRef(null);
  const [showIntroPools, setShowIntroPools] = useState(() => Date.now() < LANDING_SHOWCASE_END);

  // MILJOR_V10_GRADIENT_APPROVED: dark preview + lightly enriched ivory; only landing-root background.
  useEffect(() => {
    const root = miljorV6RootRef.current;
    if (!root) return;
    if (!miljorV6OriginalBackgroundRef.current) {
      miljorV6OriginalBackgroundRef.current = {
        value: root.style.getPropertyValue('background'),
        priority: root.style.getPropertyPriority('background')
      };
    }
    if (isDark) {
      // MILJOR_APPROVED_DARK_GRADIENT_V12: EXACT APPROVED F12 PREVIEW
      root.style.setProperty('background', "radial-gradient(ellipse 1100px 740px at 24% 260px, rgba(38, 115, 85, 0.55) 0%, rgba(25, 85, 64, 0.24) 50%, transparent 86%), radial-gradient(ellipse 950px 650px at 76% 160px, rgba(4, 21, 17, 0.62) 0%, rgba(5, 24, 19, 0.24) 52%, transparent 88%), linear-gradient(112deg, rgba(10, 59, 44, 0.15) 0%, rgba(13, 48, 37, 0.08) 40%, rgba(1, 17, 14, 0.48) 100%), linear-gradient(180deg, #0B3025 0%, #154A38 24%, #174638 54%, #10372C 78%, #0A2B23 100%)", 'important');
      root.dataset.miljorBackgroundV10 = 'dark';
    } else {
      root.style.setProperty('background', "radial-gradient(ellipse 1050px 780px at 83% 190px, rgba(195, 157, 94, 0.39) 0%, rgba(211, 177, 125, 0.20) 46%, transparent 82%), radial-gradient(ellipse 980px 750px at 15% 210px, rgba(255, 255, 255, 0.82) 0%, rgba(255, 255, 255, 0.27) 49%, transparent 86%), radial-gradient(ellipse 920px 720px at 7% 82%, rgba(164, 132, 87, 0.15) 0%, rgba(164, 132, 87, 0.05) 55%, transparent 88%), linear-gradient(112deg, rgba(158, 122, 72, 0.11) 0%, rgba(255, 255, 255, 0.08) 42%, rgba(171, 127, 65, 0.16) 100%), linear-gradient(90deg, #E4D8C5 0%, #F5F0E8 13%, #FAF7F1 34%, #F1E9DC 55%, #E9D9BF 79%, #DCC5A4 100%)", 'important');
      root.dataset.miljorBackgroundV10 = 'light';
    }
  }, [isDark]);

  useEffect(() => {
    if (!showIntroPools) return undefined;
    const delay = Math.max(0, LANDING_SHOWCASE_END - Date.now());
    const timer = window.setTimeout(() => setShowIntroPools(false), Math.min(delay, 2147483647));
    return () => window.clearTimeout(timer);
  }, [showIntroPools]);

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
    poolsApi.getActivePools({ limit: 12 })
      .then((response) => {
        if (mounted) setFeaturedPools(Array.isArray(response?.data?.pools) ? response.data.pools.filter((pool) => pool?.id && ['ACTIVE', 'OPEN', 'PUBLISHED'].includes(String(pool.status || 'ACTIVE').toUpperCase())).slice(0, 12) : []);
      })
      .catch(() => { if (mounted) { setFeaturedPools([]); setPoolLoadError(true); } })
      .finally(() => { if (mounted) setLoadingPools(false); });
    return () => { mounted = false; };
  }, []);

  const changeSlide = (direction) => setSlide((index) => (index + direction + COMMODITIES.length) % COMMODITIES.length);
  const dashboardPath = user?.role === 'SUPPLIER' ? '/supplier/dashboard' : ['ADMIN', 'SUPER_ADMIN'].includes(user?.role) ? '/admin/dashboard' : '/pools';
  const requestQuoteDestination = isAuthenticated ? '/procurement' : '/login';
  const quoteState = isAuthenticated ? undefined : { from: { pathname: '/procurement' } };
  const buttonGold = { color: 'var(--text-on-champagne)' };
  const panel = { backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' };

  // MILJOR DIRECT LANDING VISUAL FIX START
  // Apply on the actual DOM nodes to overcome older !important landing styles.
  // No card, auth, or marketplace behavior is changed.
  useEffect(() => {
    const root = document.getElementById('top');
    const heading = root?.querySelector('h1.landing-display');
    const together = heading?.querySelector('.landing-display-gradient');
    const navbar = root?.querySelector('header.landing-topbar');
    if (!root || !heading || !together || !navbar) return undefined;

    // Save original inline styles so unmounting restores exactly this component's DOM.
    const nodes = [root, heading, together, navbar];
    const originalStyles = nodes.map((node) => node.getAttribute('style'));
    const force = (node, prop, value) => node.style.setProperty(prop, value, 'important');
    const apply = () => {
      const dark = document.documentElement.classList.contains('dark');
      force(root, 'background', dark
        ? 'radial-gradient(ellipse 1100px 740px at 24% 260px, rgba(38, 115, 85, 0.55) 0%, rgba(25, 85, 64, 0.24) 50%, transparent 86%), radial-gradient(ellipse 950px 650px at 76% 160px, rgba(4, 21, 17, 0.62) 0%, rgba(5, 24, 19, 0.24) 52%, transparent 88%), linear-gradient(112deg, rgba(10, 59, 44, 0.15) 0%, rgba(13, 48, 37, 0.08) 40%, rgba(1, 17, 14, 0.48) 100%), linear-gradient(180deg, #0B3025 0%, #154A38 24%, #174638 54%, #10372C 78%, #0A2B23 100%)'
        : 'radial-gradient(ellipse 1050px 780px at 83% 190px, rgba(195, 157, 94, 0.39) 0%, rgba(211, 177, 125, 0.20) 46%, transparent 82%), radial-gradient(ellipse 980px 750px at 15% 210px, rgba(255, 255, 255, 0.82) 0%, rgba(255, 255, 255, 0.27) 49%, transparent 86%), radial-gradient(ellipse 920px 720px at 7% 82%, rgba(164, 132, 87, 0.15) 0%, rgba(164, 132, 87, 0.05) 55%, transparent 88%), linear-gradient(112deg, rgba(158, 122, 72, 0.11) 0%, rgba(255, 255, 255, 0.08) 42%, rgba(171, 127, 65, 0.16) 100%), linear-gradient(90deg, #E4D8C5 0%, #F5F0E8 13%, #FAF7F1 34%, #F1E9DC 55%, #E9D9BF 79%, #DCC5A4 100%)');
      force(root, 'background-color', dark ? '#062a21' : '#f7f1e7');
      force(root, '--miljor-direct-fix', 'active');
      const hideNavBorder = typeof window !== 'undefined' && window.localStorage?.getItem('miljor_navbar_border') === 'off';
      force(navbar, 'border-bottom', dark && !hideNavBorder ? '1px solid rgba(180, 212, 195, 0.09)' : 'none');
      force(navbar, 'box-shadow', 'none');
      // Descending strokes such as g, p, y need space BELOW the glyph's baseline.
      force(heading, 'overflow', 'visible');
      force(heading, 'line-height', '1.17');
      force(together, 'display', 'block');
      force(together, 'overflow', 'visible');
      force(together, 'line-height', '1.34');
      force(together, 'padding-bottom', '.22em');
      force(together, 'padding-top', '.015em');
      force(together, 'box-sizing', 'content-box');
      force(together, '-webkit-box-decoration-break', 'clone');
      force(together, '--miljor-g-fix', 'active');
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      nodes.forEach((node, index) => {
        if (originalStyles[index] === null) node.removeAttribute('style');
        else node.setAttribute('style', originalStyles[index]);
      });
    };
  }, []);
  // MILJOR DIRECT LANDING VISUAL FIX END

  return (
    <div ref={miljorV6RootRef} id="top" className="miljor-public-landing miljor-premium-landing min-h-screen font-sans" style={{ background: 'var(--bg-dashboard)', color: 'var(--text-primary)' }}>

      <style>{`/* MILJOR HERO CAPTION DIRECT V2 */
        #top#top.miljor-public-landing .miljor-commodity-frame [data-miljor-hero-shade="v2"] {
          background: linear-gradient(180deg, rgba(9,29,23,.03) 0%, rgba(8,28,22,.13) 37%, rgba(8,30,23,.64) 69%, rgba(6,24,19,.93) 100%) !important;
        }
        #top#top.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] h3 {
          font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif !important;
          font-size: clamp(1.9rem,3.1vw,2.6rem) !important;
          font-weight: 760 !important;
          letter-spacing: -.047em !important;
          line-height: 1.14 !important;
          color: #fffaf0 !important;
          -webkit-text-fill-color: #fffaf0 !important;
          text-shadow: 0 2px 16px rgba(0,0,0,.6) !important;
        }
        #top#top.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] p {
          font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif !important;
          font-size: clamp(.85rem,1.15vw,.96rem) !important;
          font-weight: 560 !important;
          letter-spacing: .005em !important;
          line-height: 1.55 !important;
          color: #eddfc3 !important;
          -webkit-text-fill-color: #eddfc3 !important;
          text-shadow: 0 1px 11px rgba(0,0,0,.68) !important;
        }
        html.dark #top#top.miljor-public-landing .miljor-commodity-frame [data-miljor-hero-shade="v2"] {
          background: linear-gradient(180deg, rgba(2,22,16,.06) 0%, rgba(4,29,21,.20) 37%, rgba(2,26,19,.75) 70%, rgba(2,20,15,.98) 100%) !important;
        }
        html.dark #top#top.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] h3 {
          color: #fff9e9 !important;
          -webkit-text-fill-color: #fff9e9 !important;
          text-shadow: 0 3px 18px rgba(0,0,0,.72) !important;
        }
        html.dark #top#top.miljor-public-landing .miljor-commodity-frame [data-miljor-caption-upgrade="v2"] p {
          color: #e8cb92 !important;
          -webkit-text-fill-color: #e8cb92 !important;
        }
      `}</style>
      <header className="landing-topbar landing-premium-topbar sticky top-0 z-50 backdrop-blur-xl" style={{ backgroundColor: 'var(--landing-header-bg)', color: 'var(--text-primary)' }}>
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
                      <div className="text-center pb-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          Welcome to MilJor
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
                          className="landing-gradient-cta w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer"
                          style={{
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
                <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold"><UserRound size={16} style={{ color: 'var(--text-secondary)' }} />Account</div>
                <Link to="/login" onClick={() => setMobileMenu(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"><LogIn size={15} />Sign In</Link>
                <Link to="/register" onClick={() => setMobileMenu(false)} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"><UserPlus size={15} />Register</Link>
              </div>
            )}
          </nav>
        )}
      </header>

      <main>
        <section className="landing-premium-hero mx-auto grid max-w-7xl grid-cols-1 items-center gap-9 px-5 pb-14 pt-10 sm:px-8 md:pt-14 lg:grid-cols-2 lg:gap-14 lg:px-10 lg:pb-12">
          <div className="max-w-xl">
            <span className="landing-tagline inline-flex items-center rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.17em]" style={{ borderColor: 'var(--border-default)', color: 'var(--brand-accent)' }}>Mil Kar Khareedo, Behtar Pao</span>
            <h1 data-miljor-headline-v7="restored" className="landing-display mt-7 text-[clamp(2.75rem,5.1vw,5.1rem)] font-semibold leading-[1.07] tracking-[-0.055em]" data-miljor-hero-fix="v4">
              Buy Better<span className="landing-display-gradient block" style={{ color: 'var(--brand-accent)', lineHeight: 1.18, paddingBottom: '0.16em', overflow: 'visible' }}>Together</span>
            </h1>
            <p data-miljor-description-v7="restored" className="mt-6 max-w-md text-sm leading-7 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
              Wholesale procurement, made easier for growing food businesses.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              {(() => {
                const shineCls = typeof window !== 'undefined' && window.localStorage?.getItem('miljor_cta_shine') === 'off' ? '' : 'miljor-cta-shine';
                return (
                  <>
                    <button type="button"
                      onClick={scrollToPools}
                      className={`landing-gradient-cta ${shineCls} inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold`}
                      style={buttonGold}>
                      Explore Pools
                    </button>
                    <Link to={requestQuoteDestination} state={quoteState} className={`landing-gradient-cta ${shineCls ? `${shineCls} miljor-cta-shine--delayed` : ''} inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold`} style={buttonGold}>Request a Quote</Link>
                  </>
                );
              })()}
            </div>
          </div>

          <div className="relative">
            <div className="miljor-commodity-frame landing-premium-image relative aspect-[5/4] overflow-hidden rounded-[1.75rem] border shadow-2xl sm:aspect-[6/5]" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
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

        <section id="live-pools" className="landing-premium-pools mx-auto max-w-7xl scroll-mt-24 px-5 pt-8 pb-12 sm:px-8 sm:pt-10 sm:pb-14 lg:px-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="landing-eyebrow text-[11px] font-semibold uppercase tracking-[0.19em]">Supplier-led procurement</p>
              <h2 className="landing-section-title mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Active buying pools</h2>
            </div>
            {isAuthenticated ? (
              <Link to={user?.role === 'SUPPLIER' ? '/supplier/pools' : '/pools'} className="landing-top-link inline-flex items-center gap-2 text-sm font-semibold">
                {user?.role === 'SUPPLIER' ? 'Manage your pools' : 'View All Pools'} <ArrowRight size={16} />
              </Link>
            ) : (
              <></>
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
            aria-label="Supplier pools and temporary introductory examples"
            tabIndex={0}
            className="miljor-pool-rail flex items-stretch gap-5 overflow-x-auto overscroll-x-contain scroll-smooth snap-x snap-mandatory pb-4"
          >
            {!loadingPools && featuredPools.map((pool) => (
              <div key={pool.id} className="landing-pool-shell flex w-[min(84vw,340px)] shrink-0 snap-start flex-col">
                <LandingPoolCard
                  pool={pool}
                  onSelect={() => navigate(isAuthenticated ? '/pools' : '/login', isAuthenticated ? undefined : { state: { from: { pathname: '/pools' } } })}
                />
              </div>
            ))}
            {showIntroPools && DEMO_PREVIEWS.map((pool) => (
              <div key={pool.id} className="landing-pool-shell landing-showcase-shell flex w-[min(84vw,340px)] shrink-0 snap-start flex-col" aria-label="Introductory display: sign in for actual supplier availability">
                <LandingPoolCard
                  pool={pool}
                  isExample
                  onSelect={() => navigate('/login', { state: { from: { pathname: '/pools' } } })}
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

        <section id="suppliers" className="border-t py-16 sm:py-20" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="landing-premium-benefits landing-integrated-benefits rounded-[1.75rem] border p-7 sm:p-10 lg:p-12" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--card-glass)', boxShadow: 'var(--shadow-card)' }}>
              <div className="landing-benefits-grid grid items-center gap-10 lg:grid-cols-[1fr_0.85fr] lg:gap-16">
                <div className="landing-benefit-copy">
                  <p className="landing-eyebrow text-[11px] font-semibold uppercase tracking-[0.19em]">For buyers and suppliers</p>
                  <h2 className="landing-section-title mt-4 max-w-xl text-3xl leading-tight font-bold sm:text-[2.6rem]">Better sourcing. Simpler selling.</h2>
                  <p className="mt-5 max-w-md text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                    Bring business demand and supplier offers together, with clear pricing and coordinated fulfillment.
                  </p>
                  <Link to="/register" className="landing-gradient-cta mt-7 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold" style={buttonGold}>Join MilJor</Link>
                </div>
                <div className="landing-benefit-list grid gap-3">
                  {[
                    { icon: Layers, title: 'Buy collectively', text: 'Join available pools and view quantity-based pricing.' },
                    { icon: ShieldCheck, title: 'Purchase clearly', text: 'See terms before you confirm and pay.' },
                    { icon: Truck, title: 'Stay informed', text: 'Follow delivery progress and confirm receipt.' },
                  ].map((item) => <div key={item.title} className="landing-benefit-item flex items-center gap-4 rounded-2xl border p-4 sm:p-5" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-card)' }}>
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
