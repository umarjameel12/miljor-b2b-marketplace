import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme, THEME_MODES } from '../../context/ThemeContext';
import { Logo } from '../ui/Logo';
import { Drawer } from '../ui/Drawer';
import FLAGS from '../../config/featureFlags';
import { unifiedPoolsApi } from '../../api/unifiedPools';
import {
  Layers,
  ClipboardList,
  Users,
  Tag,
  Search,
  Bell,
  BellOff,
  User,
  Monitor,
  Sun,
  Moon,
  Home,
  LogOut,
  ChevronDown,
  X,
  Building2,
  ShieldCheck,
} from 'lucide-react';

/**
 * MilJor Master Application Shell
 * Precision-locked to approved master reference image.
 * Features:
 * - Narrow integrated left sidebar on desktop (expanded w-60..w-64, collapsed w-18 icon rail)
 * - Standalone approved VF-1 Gold Ribbon-M monogram at top
 * - Vertical theme selector (System, Light, Dark) near bottom of sidebar
 * - Bottom collapse toggle (« / »)
 * - Top-right utility cluster (Search, Notifications, User)
 * - Responsive mobile drawer & bottom navigation bar
 */
export const AppShell = ({ children }) => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('collapsed') === 'true') return true;
        if (params.get('collapsed') === 'false') return false;
        return localStorage.getItem('miljor_sidebar_collapsed') === 'true';
      } catch (e) {}
    }
    return false;
  });
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('drawer') === 'true') return true;
      } catch (e) {}
    }
    return false;
  });
  const [appearanceExpanded, setAppearanceExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('appearance') === 'true') return true;
        if (params.get('appearance') === 'false') return false;
        return localStorage.getItem('miljor_appearance_expanded') === 'true';
      } catch (e) {}
    }
    return false;
  });
  const [collapsedPanelOpen, setCollapsedPanelOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('account') === 'true') return true;
      } catch {}
    }
    return false;
  });

  const sidebarRef = useRef(null);
  const accountMenuRef = useRef(null);
  const notificationsRef = useRef(null);
  const mobileNotificationsRef = useRef(null);
  const navigate = useNavigate();
  const { isAuthenticated, logout, user } = useAuth();
  const role = user?.role;

  const [hoveredNav, setHoveredNav] = useState(null);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNotificationsOpen, setMobileNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [readNotificationIds, setReadNotificationIds] = useState(new Set());

  // Genuine backend alerts/notifications loader
  useEffect(() => {
    let isMounted = true;
    async function loadNotifications() {
      if (!isAuthenticated) {
        if (isMounted) setNotifications([]);
        return;
      }
      try {
        if (role === 'SUPPLIER') {
          const res = await unifiedPoolsApi.alerts();
          if (isMounted && res?.alerts) {
            setNotifications(res.alerts);
          }
        } else {
          // For buyer / admin, genuine notifications come from backend events; if none, array remains empty
          if (isMounted) setNotifications([]);
        }
      } catch {
        if (isMounted) setNotifications([]);
      }
    }
    loadNotifications();
  }, [isAuthenticated, role]);

  const unreadNotifications = notifications.filter(n => !readNotificationIds.has(n.id));
  const unreadCount = unreadNotifications.length;

  const markAllAsRead = () => {
    setReadNotificationIds(new Set(notifications.map(n => n.id)));
  };

  // Outside click listener: Close notifications dropdown when clicking outside
  useEffect(() => {
    if (!notificationsOpen) return;
    const handleOutsideNotifications = (event) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideNotifications);
    document.addEventListener('touchstart', handleOutsideNotifications);
    return () => {
      document.removeEventListener('mousedown', handleOutsideNotifications);
      document.removeEventListener('touchstart', handleOutsideNotifications);
    };
  }, [notificationsOpen]);

  // Outside click listener: Close mobile notifications popover when clicking outside
  useEffect(() => {
    if (!mobileNotificationsOpen) return;
    const handleOutsideMobileNotifications = (event) => {
      if (mobileNotificationsRef.current && !mobileNotificationsRef.current.contains(event.target)) {
        setMobileNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideMobileNotifications);
    document.addEventListener('touchstart', handleOutsideMobileNotifications);
    return () => {
      document.removeEventListener('mousedown', handleOutsideMobileNotifications);
      document.removeEventListener('touchstart', handleOutsideMobileNotifications);
    };
  }, [mobileNotificationsOpen]);

  const toggleAppearance = () => {
    const next = !appearanceExpanded;
    setAppearanceExpanded(next);
    try {
      localStorage.setItem('miljor_appearance_expanded', String(next));
    } catch {}
  };

  const handleCollapsedAppearanceClick = () => {
    // When sidebar is closed and user clicks appearance:
    // Expand sidebar AND expand appearance so user can select System/Light/Dark
    setCollapsed(false);
    try {
      localStorage.setItem('miljor_sidebar_collapsed', 'false');
    } catch {}
    setAppearanceExpanded(true);
    try {
      localStorage.setItem('miljor_appearance_expanded', 'true');
    } catch {}
    setCollapsedPanelOpen(false);
  };

  // Outside click listener: Close account dropdown when clicking anywhere outside it
  useEffect(() => {
    if (!accountMenuOpen) return;

    const handleOutsideAccountClick = (event) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target)) {
        setAccountMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideAccountClick);
    document.addEventListener('touchstart', handleOutsideAccountClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideAccountClick);
      document.removeEventListener('touchstart', handleOutsideAccountClick);
    };
  }, [accountMenuOpen]);

  const { theme, setTheme, isDark } = useTheme();
  const location = useLocation();
  const ActiveThemeIcon = theme === THEME_MODES.DARK ? Moon : theme === THEME_MODES.LIGHT ? Sun : Monitor;

  // Primary Navigation items matching the reference and functional routes
  const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'VERIFICATION_ADMIN', 'OPERATIONS_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN'];
  const isAdmin = isAuthenticated && adminRoles.includes(user?.role);
  const isSupplier = isAuthenticated && role === 'SUPPLIER';
  const path = location.pathname;
  const is = (p) => path === p || path.startsWith(p + '/');
  const navItems = isAdmin
    ? [
        { label: 'Admin Console', path: '/admin', icon: ShieldCheck, active: path === '/admin' || path === '/admin/dashboard' },
        { label: 'Supplier Verification', path: '/admin/verifications', icon: Users, active: is('/admin/verifications') || is('/admin/suppliers') },
        { label: 'Catalog Governance', path: '/admin/catalog', icon: Layers, active: is('/admin/catalog') },
      ]
    : isSupplier
    ? [
        { label: 'Dashboard', path: '/supplier/dashboard', icon: Home, active: is('/supplier/dashboard') },
        { label: 'Catalog', path: '/supplier/catalog', icon: Tag, active: is('/supplier/catalog') },
        { label: 'Pool Management', path: '/supplier/pools', icon: Layers, active: is('/supplier/pools') },
        { label: 'Procurement', path: '/rfqs', icon: ClipboardList, active: is('/rfqs') },
        { label: 'Subscription', path: '/supplier/subscription', icon: Building2, active: is('/supplier/subscription') },
        { label: 'Business Profile', path: '/supplier/profile', icon: User, active: is('/supplier/profile') || is('/supplier/onboarding') },
      ]
    : [
        { label: 'Home', path: '/', icon: Home, active: path === '/' },
        { label: 'Explore Pools', path: '/pools', icon: Layers, active: is('/pools') },
        ...(isAuthenticated
          ? [
              { label: 'Orders', path: '/orders', icon: ClipboardList, active: is('/orders') },
              { label: 'Procurement', path: '/rfqs', icon: Tag, active: is('/rfqs') },
              { label: 'Demand Requests', path: '/demand-requests', icon: Users, active: is('/demand-requests') },
            ]
          : []),
      ];

  // Mobile bottom bar items matching reference phone mockup
  const mobileBottomItems = [
    ...(isAdmin ? [{label:'Admin',path:'/admin',icon:ShieldCheck,active:location.pathname.startsWith('/admin')}] : []),
    { label: 'Home', path: '/', icon: Home, active: location.pathname === '/' },
    { label: 'Pools', path: '/pools', icon: Layers, active: location.pathname === '/pools' },
    { label: 'Orders', path: '/orders', icon: ClipboardList, active: location.pathname === '/orders' },
    { label: 'Profile', path: isAuthenticated ? '/profile' : '/login', icon: User, active: location.pathname === '/login' || location.pathname === '/profile' },
  ];

  return (
    <div
      className="min-h-screen flex flex-col md:flex-row transition-colors duration-200 overflow-x-hidden"
      style={{ backgroundColor: 'var(--bg-page)' }}
    >
      {/* =========================================================================
          1. MOBILE TOP HEADER (Phone Viewport)
          - Approved Ribbon-M Logo is the ONLY drawer toggle (Zero hamburger icons)
          - Elevated, High-Contrast Search & Notifications Controls with Live Interactivity
          ========================================================================= */}
      {mobileSearchOpen ? (
        <header
          className="md:hidden flex items-center justify-between px-4 py-2.5 border-b sticky top-0 z-40 backdrop-blur-md gap-3"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (headerSearchQuery.trim()) {
                navigate(`/pools?search=${encodeURIComponent(headerSearchQuery.trim())}`);
                setMobileSearchOpen(false);
              }
            }}
            className="flex-1 flex items-center gap-2 h-9 px-3 rounded-xl border shadow-xs"
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-default)',
            }}
          >
            <Search className="w-4 h-4 text-emerald-900 dark:text-champagne shrink-0" />
            <input
              type="text"
              autoFocus
              value={headerSearchQuery}
              onChange={(e) => setHeaderSearchQuery(e.target.value)}
              placeholder="Search commodities (e.g. Rice)..."
              className="w-full text-xs bg-transparent focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
            {headerSearchQuery && (
              <button
                type="button"
                onClick={() => setHeaderSearchQuery('')}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-xs px-1"
                aria-label="Clear query"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </form>
          <button
            type="button"
            onClick={() => setMobileSearchOpen(false)}
            className="text-xs font-semibold px-2 py-1.5 rounded-lg text-emerald-900 dark:text-champagne hover:opacity-80 cursor-pointer"
          >
            Cancel
          </button>
        </header>
      ) : (
        <header
          className="md:hidden flex items-center justify-between px-4 py-2.5 border-b sticky top-0 z-40 backdrop-blur-md"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {/* Ribbon-M Monogram acts as the mobile navigation drawer trigger */}
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
            aria-label={mobileDrawerOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
            aria-expanded={mobileDrawerOpen}
            className="flex items-center justify-center p-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] cursor-pointer"
          >
            <Logo size="sm" />
          </button>

          {/* Right utility icons: Search & Notifications — Elevated & High Contrast */}
          <div className="flex items-center gap-2">
            {/* Search Button */}
            <button
              type="button"
              onClick={() => setMobileSearchOpen(true)}
              aria-label="Search commodities"
              title="Search Commodities"
              className="w-9 h-9 flex items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer shadow-xs hover:scale-105 active:scale-95"
              style={{
                backgroundColor: 'var(--bg-card)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-primary)',
              }}
            >
              <Search className="w-4 h-4 text-emerald-900 dark:text-champagne" />
            </button>

            {/* Notifications Button & Popover */}
            <div className="relative" ref={mobileNotificationsRef}>
              <button
                type="button"
                onClick={() => setMobileNotificationsOpen(!mobileNotificationsOpen)}
                aria-label="Notifications"
                title="Notifications"
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer shadow-xs hover:scale-105 active:scale-95 relative"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                <Bell className="w-4 h-4 text-emerald-900 dark:text-champagne" />
                {unreadCount > 0 && (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[var(--bg-card)] absolute top-2 right-2 animate-pulse"
                    aria-label={`${unreadCount} unread alerts`}
                  />
                )}
              </button>

              {/* Mobile Notifications Popover */}
              {FLAGS.headerNotificationsPopover && mobileNotificationsOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-32px)] p-3.5 rounded-2xl border shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                    boxShadow: 'var(--shadow-elevated)',
                  }}
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</span>
                    {unreadCount > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--brand-accent-soft)', color: 'var(--brand-accent)' }}>
                          {unreadCount} New
                        </span>
                        <button
                          type="button"
                          onClick={markAllAsRead}
                          className="text-[10px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition cursor-pointer"
                        >
                          Mark all read
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-stone-400">All caught up</span>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="py-6 px-3 flex flex-col items-center justify-center text-center">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center mb-2"
                        style={{
                          backgroundColor: 'var(--bg-elevated)',
                          color: 'var(--brand-accent)',
                        }}
                      >
                        <BellOff className="w-4 h-4 opacity-75" />
                      </div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        You're all caught up.
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        No new notifications at this time.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs max-h-60 overflow-y-auto">
                      {notifications.map((n) => {
                        const isRead = readNotificationIds.has(n.id);
                        return (
                          <div
                            key={n.id}
                            className={`p-2.5 rounded-xl border transition ${isRead ? 'opacity-65' : ''}`}
                            style={{
                              backgroundColor: 'var(--bg-elevated)',
                              borderColor: 'var(--border-subtle)',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>
                                {n.title || n.type || 'Alert'}
                              </p>
                              {!isRead && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              )}
                            </div>
                            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                              {n.message}
                            </p>
                            {n.source && (
                              <span className="text-[9px] text-stone-400 mt-1 block">
                                {n.source.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
      )}

      {/* =========================================================================
          2. DESKTOP INTEGRATED SIDEBAR (Reference Matched ~20% width)
          - Approved Ribbon-M Logo is the ONLY expand/collapse toggle
          - Strictly NO hamburger icons, NO chevrons, NO extra collapse controls
          - Size-Invariance: L_open = L_closed = 48px x 24px (Logo size="sm")
          ========================================================================= */}
      <aside
        ref={sidebarRef}
        style={{
          backgroundColor: 'var(--bg-sidebar)',
          borderColor: 'var(--border-sidebar, var(--border-subtle))',
          boxShadow: isDark
            ? '2px 0 16px rgba(0, 0, 0, 0.4), 1px 0 0 0 rgba(200, 178, 118, 0.35)'
            : '2px 0 16px rgba(45, 32, 18, 0.08), 1px 0 0 0 rgba(145, 120, 85, 0.55)',
          willChange: 'width',
        }}
        className={`hidden md:flex flex-col border-r transition-all duration-300 ease-in-out relative shrink-0 z-30 select-none overflow-hidden transform-gpu ${
          collapsed ? 'w-18' : 'w-60 lg:w-64'
        }`}
      >
        {/* Top Header Row: Standalone Approved Ribbon-M Monogram Toggle */}
        <div
          className="h-16 flex items-center px-3 border-b shrink-0"
          style={{ borderColor: 'var(--border-sidebar, var(--border-subtle))' }}
        >
          <button
            type="button"
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              try {
                localStorage.setItem('miljor_sidebar_collapsed', String(next));
              } catch (e) {}
            }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="w-12 h-8 flex items-center justify-center rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] cursor-pointer transition-transform duration-200 hover:opacity-90 active:scale-95 shrink-0"
          >
            {/* Exactly size="sm" (48px x 24px) in BOTH expanded and collapsed states */}
            <Logo size="sm" />
          </button>
        </div>

        {/* Sidebar Content Area: Navigation & Integrated Appearance */}
        <div className="flex-1 flex flex-col justify-between overflow-y-auto overflow-x-hidden">
          <div className="p-3 space-y-4">
            {/* Primary Navigation List */}
            <nav className="space-y-1" aria-label="Sidebar Navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                const content = (
                  <div
                    className={`flex items-center px-3 py-2 rounded-xl text-xs font-sans transition-colors duration-150 ${
                      item.active
                        ? 'font-semibold shadow-xs'
                        : 'font-medium hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    style={{
                      backgroundColor: item.active ? 'var(--bg-sidebar-active)' : 'transparent',
                      color: item.active ? 'var(--text-primary)' : 'var(--text-secondary)',
                      border: item.active ? '1px solid var(--border-subtle)' : '1px solid transparent',
                    }}
                  >
                    <span className="w-6 h-6 flex items-center justify-center shrink-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          item.active
                            ? 'text-emerald-900 dark:text-champagne'
                            : ''
                        }`}
                        style={{ color: item.active ? undefined : 'var(--text-secondary)' }}
                      />
                    </span>
                    <span
                      style={{ willChange: 'max-width, opacity' }}
                      className={`whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out pl-3 inline-block ${
                        collapsed ? 'max-w-0 opacity-0' : 'max-w-40 opacity-100'
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                );

                return (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={() => collapsed && setHoveredNav(item.label)}
                    onMouseLeave={() => collapsed && setHoveredNav(null)}
                  >
                    <Link
                      to={item.path}
                      title={!FLAGS.customTooltips && collapsed ? item.label : undefined}
                      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] rounded-xl"
                    >
                      {content}
                    </Link>
                    {FLAGS.customTooltips && collapsed && hoveredNav === item.label && (
                      <div className="luxury-tooltip" role="tooltip">
                        {item.label}
                      </div>
                    )}
                  </div>
                );
              })}
                {/* Appearance Nested Nav Item (Directly following Support) */}
                {!collapsed ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={toggleAppearance}
                      aria-expanded={appearanceExpanded}
                      aria-controls="sidebar-appearance-options"
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-sans transition-colors duration-150 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] ${
                        appearanceExpanded
                          ? 'font-semibold shadow-xs'
                          : 'font-medium hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                      style={{
                        backgroundColor: appearanceExpanded ? 'var(--bg-sidebar-active)' : 'transparent',
                        color: appearanceExpanded ? 'var(--text-primary)' : 'var(--text-secondary)',
                        border: appearanceExpanded ? '1px solid var(--border-subtle)' : '1px solid transparent',
                      }}
                    >
                      <div className="flex items-center">
                        <span className="w-6 h-6 flex items-center justify-center shrink-0">
                          <ActiveThemeIcon
                            className={`w-4 h-4 shrink-0 transition-colors ${
                              appearanceExpanded
                                ? 'text-emerald-900 dark:text-champagne'
                                : ''
                            }`}
                            style={{ color: appearanceExpanded ? undefined : 'var(--text-secondary)' }}
                          />
                        </span>
                        <span
                          style={{ willChange: 'max-width, opacity' }}
                          className="whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out pl-3 inline-block max-w-40 opacity-100 truncate"
                        >
                          Appearance
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                          appearanceExpanded ? 'rotate-180 text-emerald-900 dark:text-champagne' : ''
                        }`}
                        style={{ color: appearanceExpanded ? undefined : 'var(--text-secondary)' }}
                      />
                    </button>

                    {appearanceExpanded && (
                      <div
                        id="sidebar-appearance-options"
                        role="radiogroup"
                        aria-label="Theme selection"
                        className="pl-7 pr-1 pt-1 pb-1 space-y-1 mt-0.5"
                      >
                        {[
                          { mode: THEME_MODES.SYSTEM, label: 'System', icon: Monitor },
                          { mode: THEME_MODES.LIGHT, label: 'Light', icon: Sun },
                          { mode: THEME_MODES.DARK, label: 'Dark', icon: Moon },
                        ].map(({ mode, label, icon: OptionIcon }) => {
                          const isSelected = theme === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setTheme(mode)}
                              role="radio"
                              aria-checked={isSelected}
                              className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-colors cursor-pointer ${
                                isSelected
                                  ? 'font-bold shadow-xs'
                                  : 'font-medium hover:bg-black/5 dark:hover:bg-white/10'
                              }`}
                              style={{
                                backgroundColor: isSelected ? 'var(--bg-sidebar-active)' : 'transparent',
                                color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                                border: isSelected ? '1px solid var(--border-default)' : '1px solid transparent',
                              }}
                            >
                              <OptionIcon
                                className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                  isSelected
                                    ? 'text-emerald-900 dark:text-champagne'
                                    : ''
                                }`}
                                style={{ color: isSelected ? undefined : 'var(--text-secondary)' }}
                              />
                              <span className="truncate">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Collapsed Icon Rail Appearance Control with Click-to-Expand-Sidebar & Anchored Fallback */
                  <div
                    className="relative pt-1"
                    onMouseEnter={() => collapsed && setHoveredNav('Appearance')}
                    onMouseLeave={() => collapsed && setHoveredNav(null)}
                  >
                    <button
                      type="button"
                      onClick={handleCollapsedAppearanceClick}
                      aria-label={`Appearance: current theme is ${theme}. Click to change.`}
                      aria-expanded={collapsedPanelOpen}
                      title={!FLAGS.customTooltips ? `Appearance (${theme}) — Click to open options` : undefined}
                      className={`w-full flex items-center px-3 py-2 rounded-xl text-xs font-sans transition-colors duration-150 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] ${
                        appearanceExpanded
                          ? 'font-semibold shadow-xs'
                          : 'font-medium hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                      style={{
                        backgroundColor: appearanceExpanded ? 'var(--bg-sidebar-active)' : 'transparent',
                        color: appearanceExpanded ? 'var(--text-primary)' : 'var(--text-secondary)',
                        border: appearanceExpanded ? '1px solid var(--border-subtle)' : '1px solid transparent',
                      }}
                    >
                      <span className="w-6 h-6 flex items-center justify-center shrink-0">
                        <ActiveThemeIcon
                          className={`w-4 h-4 shrink-0 transition-colors ${
                            appearanceExpanded ? 'text-emerald-900 dark:text-champagne' : ''
                          }`}
                          style={{ color: appearanceExpanded ? undefined : 'var(--text-secondary)' }}
                        />
                      </span>
                    </button>
                    {FLAGS.customTooltips && collapsed && hoveredNav === 'Appearance' && (
                      <div className="luxury-tooltip" role="tooltip">
                        Appearance ({theme})
                      </div>
                    )}

                    {collapsedPanelOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setCollapsedPanelOpen(false)}
                        />
                        <div
                          className="absolute left-full top-0 ml-2 w-36 py-1.5 px-1.5 rounded-xl border shadow-xl z-50 space-y-1"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            borderColor: 'var(--border-default)',
                          }}
                            role="radiogroup"
                            aria-label="Theme selection"
                          >
                            {[
                              { mode: THEME_MODES.SYSTEM, label: 'System', icon: Monitor },
                              { mode: THEME_MODES.LIGHT, label: 'Light', icon: Sun },
                              { mode: THEME_MODES.DARK, label: 'Dark', icon: Moon },
                            ].map(({ mode, label, icon: OptionIcon }) => {
                              const isSelected = theme === mode;
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => {
                                    setTheme(mode);
                                    setCollapsedPanelOpen(false);
                                  }}
                                  role="radio"
                                  aria-checked={isSelected}
                                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs font-sans transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'font-bold shadow-xs'
                                      : 'font-medium hover:bg-black/5 dark:hover:bg-white/10'
                                  }`}
                                  style={{
                                    backgroundColor: isSelected ? 'var(--bg-sidebar-active)' : 'transparent',
                                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                                  }}
                                >
                                  <OptionIcon
                                    className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                      isSelected ? 'text-emerald-900 dark:text-champagne' : ''
                                    }`}
                                    style={{ color: isSelected ? undefined : 'var(--text-secondary)' }}
                                  />
                                  <span>{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
            </nav>
          </div>

          {/* Account Section at Sidebar Bottom */}
          <div className="p-3 border-t mt-auto" style={{ borderColor: 'var(--border-sidebar, var(--border-subtle))' }}>
            {isAuthenticated ? (
              <div className="flex items-center justify-between gap-1">
                <Link to="/profile" className="flex items-center px-2 py-1.5 rounded-xl transition hover:opacity-100 flex-1 truncate" title={user?.business_name || user?.full_name || 'User Profile'}>
                  <span className="w-7 h-7 flex items-center justify-center shrink-0">
                    <div className="w-7 h-7 rounded-full bg-[var(--brand-accent)] text-[#072a21] flex items-center justify-center font-bold text-[10px] shrink-0 tracking-tight shadow-2xs">
                      {(user?.business_name || user?.full_name || 'U').slice(0, 2).toUpperCase()}
                    </div>
                  </span>
                  <span
                    style={{ willChange: 'max-width, opacity' }}
                    className={`whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out pl-2.5 inline-block ${
                      collapsed ? 'max-w-0 opacity-0' : 'max-w-36 opacity-100'
                    }`}
                  >
                    <span className="block text-xs font-semibold truncate leading-tight" style={{ color: 'var(--text-primary)' }}>
                      {user?.business_name || user?.full_name || 'My Account'}
                    </span>
                    {user?.email && (
                      <span className="block text-[10px] truncate text-stone-500 dark:text-stone-400 font-normal leading-tight mt-0.5">
                        {user.email}
                      </span>
                    )}
                  </span>
                </Link>
                {!collapsed && (
                  <button
                    type="button"
                    onClick={logout}
                    title="Sign Out"
                    className="p-1 rounded text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer mr-1 shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="flex items-center px-3 py-1.5 rounded-xl text-xs font-medium transition hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--text-primary)' }}
                title="Sign In"
              >
                <span className="w-6 h-6 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 shrink-0 text-emerald-900 dark:text-champagne" />
                </span>
                <span
                  style={{ willChange: 'max-width, opacity' }}
                  className={`font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out pl-3 inline-block ${
                    collapsed ? 'max-w-0 opacity-0' : 'max-w-32 opacity-100'
                  }`}
                >
                  Sign In
                </span>
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* =========================================================================
          3. MAIN VIEWPORT CONTENT AREA
          ========================================================================= */}
      <div
        className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0 overflow-y-auto overflow-x-hidden transition-colors duration-300"
        style={{ background: 'var(--bg-dashboard)' }}
      >
        {/* Desktop Top Utility Bar (Search, Notifications, Interactive Account Dropdown) */}
        <div className="hidden md:flex items-center justify-end h-16 px-6 lg:px-8 shrink-0 relative z-40">
          <div className="flex items-center gap-3">
            {/* 1. Search Commodities Button / Expandable Input */}
            {FLAGS.headerSearchExpanded && searchExpanded ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (headerSearchQuery.trim()) {
                    navigate(`/pools?search=${encodeURIComponent(headerSearchQuery.trim())}`);
                    setSearchExpanded(false);
                  }
                }}
                className="flex items-center gap-2 h-9 px-3 rounded-xl border shadow-xs transition-all duration-200"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-default)',
                }}
              >
                <Search className="w-3.5 h-3.5 text-emerald-800 dark:text-champagne shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={headerSearchQuery}
                  onChange={(e) => setHeaderSearchQuery(e.target.value)}
                  placeholder="Search commodities (e.g. Rice)..."
                  className="w-48 text-xs bg-transparent focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setHeaderSearchQuery('');
                    setSearchExpanded(false);
                  }}
                  className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 text-xs px-1"
                  aria-label="Close search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (FLAGS.headerSearchExpanded) {
                    setSearchExpanded(true);
                  } else {
                    navigate('/pools');
                  }
                }}
                aria-label="Search commodities"
                title="Search Commodities"
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer shadow-xs hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                <Search className="w-4 h-4 text-emerald-900 dark:text-champagne" />
              </button>
            )}

            {/* 2. Notifications Bell Button & Popover */}
            <div className="relative" ref={notificationsRef}>
              <button
                type="button"
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                aria-label="Notifications"
                title="Notifications"
                className="w-9 h-9 flex items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer shadow-xs hover:scale-105 active:scale-95 relative"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                <Bell className="w-4 h-4 text-emerald-900 dark:text-champagne" />
                {unreadCount > 0 && (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-[var(--bg-card)] absolute top-2 right-2 animate-pulse"
                    aria-label={`${unreadCount} unread alerts`}
                  />
                )}
              </button>

              {FLAGS.headerNotificationsPopover && notificationsOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-80 p-3.5 rounded-2xl border shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                    boxShadow: 'var(--shadow-elevated)',
                  }}
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</span>
                    {unreadCount > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--brand-accent-soft)', color: 'var(--brand-accent)' }}>
                          {unreadCount} New
                        </span>
                        <button
                          type="button"
                          onClick={markAllAsRead}
                          className="text-[10px] text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 transition cursor-pointer"
                        >
                          Mark all read
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-stone-400">All caught up</span>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="py-6 px-3 flex flex-col items-center justify-center text-center">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center mb-2"
                        style={{
                          backgroundColor: 'var(--bg-elevated)',
                          color: 'var(--brand-accent)',
                        }}
                      >
                        <BellOff className="w-4 h-4 opacity-75" />
                      </div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                        You're all caught up.
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        No new notifications at this time.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs max-h-60 overflow-y-auto">
                      {notifications.map((n) => {
                        const isRead = readNotificationIds.has(n.id);
                        return (
                          <div
                            key={n.id}
                            className={`p-2.5 rounded-xl border transition ${isRead ? 'opacity-65' : ''}`}
                            style={{
                              backgroundColor: 'var(--bg-elevated)',
                              borderColor: 'var(--border-subtle)',
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <p className="font-semibold text-[11px]" style={{ color: 'var(--text-primary)' }}>
                                {n.title || n.type || 'Alert'}
                              </p>
                              {!isRead && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              )}
                            </div>
                            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                              {n.message}
                            </p>
                            {n.source && (
                              <span className="text-[9px] text-stone-400 mt-1 block">
                                {n.source.replace(/_/g, ' ')}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. Account Menu Trigger & Interactive High-Contrast Dropdown */}
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen(!accountMenuOpen)}
                aria-label="User Account Menu"
                aria-expanded={accountMenuOpen}
                title="Account Menu"
                className="flex items-center gap-2.5 h-9 px-3 rounded-xl border transition-all duration-200 cursor-pointer shadow-xs hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
              >
                <div className="w-6 h-6 rounded-full bg-[var(--brand-accent)] text-[#072a21] flex items-center justify-center font-bold text-xs shrink-0">
                  {isAuthenticated ? (
                    <span className="text-[10px] uppercase font-bold tracking-tight">
                      {(user?.business_name || user?.full_name || 'U').slice(0, 2)}
                    </span>
                  ) : (
                    <User className="w-3.5 h-3.5" />
                  )}
                </div>
                <span className="text-xs font-semibold max-w-[120px] truncate" style={{ color: 'var(--text-primary)' }}>
                  {isAuthenticated ? (user?.business_name || user?.full_name || 'Account') : 'Account'}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-stone-700 dark:text-stone-300 transition-transform duration-200 ${
                    accountMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Account Dropdown Popover */}
              {accountMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-64 p-3.5 rounded-2xl border shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                    boxShadow: 'var(--shadow-elevated)',
                  }}
                >
                  {isAuthenticated ? (
                    <div className="space-y-3">
                      <div className="pb-2.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                            {user?.business_name || user?.full_name || 'Valued Partner'}
                          </p>
                          {user?.role && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase tracking-wider bg-[var(--brand-accent)]/15 text-[var(--brand-accent)] shrink-0">
                              {user.role}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] truncate text-stone-500 dark:text-stone-400">
                          {user?.email}
                        </p>
                      </div>

                      <div className="space-y-1">
                        {['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'].includes(user?.role) && (
                          <>
                            <Link
                              to="/admin/verifications"
                              onClick={() => setAccountMenuOpen(false)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                            >
                              <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                              <span>Admin Verifications</span>
                            </Link>
                            <Link
                              to="/admin/catalog"
                              onClick={() => setAccountMenuOpen(false)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                            >
                              <Layers className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <span>Admin Catalog Governance</span>
                            </Link>
                          </>
                        )}
                        {user?.role === 'SUPPLIER' && (
                          <>
                            <Link
                              to="/supplier/profile"
                              onClick={() => setAccountMenuOpen(false)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition bg-[var(--brand-accent)]/10 text-[var(--brand-accent)] hover:bg-[var(--brand-accent)]/20"
                            >
                              <Building2 className="w-4 h-4 text-[var(--brand-accent)]" />
                              <span>Supplier Portal</span>
                            </Link>
                            <Link to="/supplier/pools" onClick={() => setAccountMenuOpen(false)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20">
                              <Layers className="w-4 h-4 text-emerald-600"/> <span>Pool Management</span>
                            </Link>
                            <Link
                              to="/supplier/catalog"
                              onClick={() => setAccountMenuOpen(false)}
                              className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                            >
                              <Tag className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              <span>Catalog & Offers</span>
                            </Link>
                          </>
                        )}
                        <Link
                          to="/profile"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          <User className="w-4 h-4 text-emerald-900 dark:text-champagne" />
                          <span>My Profile</span>
                        </Link>
                        <Link
                          to="/orders"
                          onClick={() => setAccountMenuOpen(false)}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          <ClipboardList className="w-4 h-4 text-emerald-900 dark:text-champagne" />
                          <span>My Orders</span>
                        </Link>
                      </div>

                      <div className="pt-2.5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <button
                          type="button"
                          onClick={() => {
                            logout();
                            setAccountMenuOpen(false);
                          }}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-medium border border-red-200 dark:border-red-900/40 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition cursor-pointer"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  ) : (
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
                          to="/register"
                          onClick={() => setAccountMenuOpen(false)}
                          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold shadow-xs transition cursor-pointer hover:opacity-95"
                          style={{
                            backgroundColor: 'var(--brand-accent)',
                            color: 'var(--text-on-champagne)',
                          }}
                        >
                          <span>Create Account</span>
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Page Children */}
        <main className="flex-1 overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* =========================================================================
          4. MOBILE SLIDE-OUT DRAWER (Opens from LEFT on Mobile Phone Viewports)
          ========================================================================= */}
      <Drawer
        isOpen={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        side="left"
      >
        <div className="flex flex-col h-full justify-between">
          <div className="space-y-5">
            {/* Tagline Card in Mobile Drawer */}
            <div
              className="p-3.5 rounded-2xl flex items-center gap-3 border shadow-2xs"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <div className="flex flex-col">
                <span className="text-xs font-semibold tracking-wide font-sans" style={{ color: 'var(--brand-accent)' }}>
                  Milkar Khareedo, Behtar Pao
                </span>
                <span className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Collective Food Procurement Platform
                </span>
              </div>
            </div>

            {/* Navigation Routes — High Contrast in Light & Dark Themes */}
            <nav className="flex flex-col space-y-1.5" aria-label="Mobile Navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    to={item.disabled ? '#' : item.path}
                    onClick={() => {
                      if (!item.disabled) setMobileDrawerOpen(false);
                    }}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium transition-colors ${
                      item.active
                        ? 'font-bold shadow-xs'
                        : 'font-medium hover:bg-black/5 dark:hover:bg-white/5'
                    } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    style={{
                      backgroundColor: item.active ? 'var(--bg-sidebar-active)' : 'transparent',
                      color: 'var(--text-primary)',
                      border: item.active ? '1px solid var(--border-subtle)' : '1px solid transparent',
                    }}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        item.active
                          ? 'text-emerald-800 dark:text-champagne'
                          : 'text-stone-700 dark:text-stone-200'
                      }`}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                    {item.disabled && (
                      <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                        Soon
                      </span>
                    )}
                  </Link>
                );
              })}

              {/* Mobile Drawer Appearance Nested Item — High Contrast */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={toggleAppearance}
                  aria-expanded={appearanceExpanded}
                  aria-controls="mobile-appearance-options"
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-left focus:outline-none"
                  style={{
                    backgroundColor: appearanceExpanded ? 'var(--bg-sidebar-active)' : 'transparent',
                    color: 'var(--text-primary)',
                    border: appearanceExpanded ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <ActiveThemeIcon className={`w-4 h-4 ${appearanceExpanded ? 'text-emerald-800 dark:text-champagne' : 'text-stone-700 dark:text-stone-200'}`} />
                    <span style={{ color: 'var(--text-primary)' }}>Appearance</span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform duration-200 ${
                      appearanceExpanded ? 'rotate-180 text-emerald-800 dark:text-champagne' : 'text-stone-600 dark:text-stone-300'
                    }`}
                  />
                </button>

                {appearanceExpanded && (
                  <div
                    id="mobile-appearance-options"
                    role="radiogroup"
                    aria-label="Theme selection"
                    className="pl-7 pr-2 pt-1 pb-1 space-y-1.5 mt-1"
                  >
                    {[
                      { mode: THEME_MODES.SYSTEM, label: 'System', icon: Monitor },
                      { mode: THEME_MODES.LIGHT, label: 'Light', icon: Sun },
                      { mode: THEME_MODES.DARK, label: 'Dark', icon: Moon },
                    ].map(({ mode, label, icon: OptionIcon }) => {
                      const isSelected = theme === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setTheme(mode)}
                          role="radio"
                          aria-checked={isSelected}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-sans transition-colors cursor-pointer ${
                            isSelected
                              ? 'font-bold shadow-xs'
                              : 'font-medium hover:bg-black/5 dark:hover:bg-white/5'
                          }`}
                          style={{
                            backgroundColor: isSelected ? 'var(--bg-sidebar-active)' : 'transparent',
                            color: 'var(--text-primary)',
                            border: isSelected ? '1px solid var(--border-subtle)' : '1px solid transparent',
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <OptionIcon
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                isSelected ? 'text-emerald-800 dark:text-champagne' : ''
                              }`}
                              style={{ color: isSelected ? undefined : 'var(--text-secondary)' }}
                            />
                            <span style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
                          </div>
                          {isSelected && (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-champagne" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </nav>
          </div>

          {/* Drawer Footer: Auth Actions */}
          <div className="pt-4 border-t mt-6 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            {isAuthenticated ? (
              <button
                onClick={() => {
                  logout();
                  setMobileDrawerOpen(false);
                }}
                className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl border border-red-200 text-red-600 dark:text-red-400 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/30 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <Link to="/login" onClick={() => setMobileDrawerOpen(false)} className="block">
                  <button
                    className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl shadow-xs transition flex items-center justify-center cursor-pointer"
                    style={{
                      backgroundColor: 'var(--brand-accent)',
                      color: 'var(--text-on-champagne)',
                    }}
                  >
                    <span>Sign In</span>
                  </button>
                </Link>
                <Link to="/register" onClick={() => setMobileDrawerOpen(false)} className="block">
                  <button
                    className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl shadow-xs transition flex items-center justify-center cursor-pointer"
                    style={{
                      backgroundColor: 'var(--brand-accent)',
                      color: 'var(--text-on-champagne)',
                    }}
                  >
                    <span>Create Account</span>
                  </button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* =========================================================================
          5. MOBILE BOTTOM NAVIGATION BAR — High Contrast Icons & Labels
          ========================================================================= */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-md flex items-center justify-around py-2 px-1"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
          boxShadow: '0 -4px 16px rgba(0, 0, 0, 0.08)',
        }}
        aria-label="Mobile Bottom Navigation"
      >
        {mobileBottomItems.map((item) => {
          const Icon = item.icon;
          const isCurrent = item.active;

          return (
            <Link
              key={item.label}
              to={item.disabled ? '#' : item.path}
              className={`flex flex-col items-center justify-center min-w-[56px] py-1 text-[11px] font-sans transition-colors ${
                item.disabled ? 'opacity-40 cursor-default' : ''
              }`}
              style={{
                color: isCurrent ? 'var(--brand-accent)' : 'var(--text-secondary)',
              }}
            >
              <Icon
                className={`w-4 h-4 mb-0.5 ${
                  isCurrent
                    ? 'text-emerald-800 dark:text-champagne stroke-[2.2]'
                    : 'text-stone-700 dark:text-stone-300'
                }`}
              />
              <span className={isCurrent ? 'font-bold' : 'font-medium'} style={{ color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export default AppShell;
