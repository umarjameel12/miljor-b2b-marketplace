import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme, THEME_MODES } from '../../context/ThemeContext';
import { Logo } from '../ui/Logo';
import { Drawer } from '../ui/Drawer';
import FLAGS from '../../config/featureFlags';
import { unifiedPoolsApi } from '../../api/unifiedPools';
import { startNotificationInbox, startNotificationPreferences, safeNotificationLink, isNotificationRead, canManageNotificationOperations, NOTIFICATION_PAGE_SIZE } from '../../api/notifications';
import { NotificationOperations } from '../notifications/NotificationOperations.jsx';
import { bindNotificationPanel } from '../notifications/panelAccessibility.js';
import { parseDeadline } from '../../utils/parseDeadline';
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
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileNotificationsOpen, setMobileNotificationsOpen] = useState(false);
  const accountKey = isAuthenticated && user?.id != null ? `${user.id}:${role}` : null;
  const inboxRef = useRef(null);
  const preferencesRef = useRef(null);
  const [preferencesState, setPreferencesState] = useState(null);
  const [inboxState, setInboxState] = useState(null);
  const [legacyState, setLegacyState] = useState(null);
  const inbox = inboxState?.owner === accountKey && accountKey ? inboxState : null;
  const preferences = preferencesState?.owner === accountKey && accountKey ? preferencesState : null;
  const notifications = inbox?.notifications || [];
  const unreadCount = inbox?.unreadCount ?? null;
  const legacyAlerts = legacyState?.owner === accountKey && accountKey ? legacyState.alerts : [];

  useEffect(() => {
    setNotificationsOpen(false);
    setMobileNotificationsOpen(false);
    setInboxState(null);
    setLegacyState(null);
    setPreferencesState(null);
    setOperationsOpen(false);
    if (!accountKey) return undefined;
    const session = startNotificationInbox({
      onChange: state => setInboxState({ ...state, owner: accountKey }),
    });
    inboxRef.current = session;
    const preferencesSession = startNotificationPreferences({
      onChange: state => setPreferencesState({ ...state, owner: accountKey }),
    });
    preferencesRef.current = preferencesSession;
    let active = true;
    // UCP alerts are operational projections, not durable inbox entries.
    if (role === 'SUPPLIER') {
      unifiedPoolsApi.alerts().then(res => {
        if (active) setLegacyState({ owner: accountKey, alerts: Array.isArray(res?.alerts) ? res.alerts : [], error: '' });
      }).catch(() => {
        if (active) setLegacyState({ owner: accountKey, alerts: [], error: 'Operational alerts unavailable.' });
      });
    }
    const catchUp = () => { void session.refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') catchUp(); };
    window.addEventListener('online', catchUp);
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      session.stop();
      preferencesSession.stop();
      if (preferencesRef.current === preferencesSession) preferencesRef.current = null;
      if (inboxRef.current === session) inboxRef.current = null;
      window.removeEventListener('online', catchUp);
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accountKey, role]);

  useEffect(() => {
    if (notificationsOpen || mobileNotificationsOpen) void inboxRef.current?.refresh();
  }, [notificationsOpen, mobileNotificationsOpen]);

  const notificationLink = (notification) => {
    let payload = notification.payload;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch { payload = null; }
    }
    return safeNotificationLink(notification.deep_link || payload?.deep_link || payload?.deepLink || payload?.url);
  };

  const openNotification = (notification) => {
    const link = notificationLink(notification);
    if (link) {
      setNotificationsOpen(false);
      setMobileNotificationsOpen(false);
      navigate(link);
    }
  };

  const renderNotificationPanel = () => (
    <div className="space-y-3 text-xs" style={{ color: 'var(--text-primary)' }}>
      <button type="button" data-notification-close className="underline min-h-9" onClick={() => {
        const root = mobileNotificationsOpen ? mobileNotificationsRef.current : notificationsRef.current;
        setNotificationsOpen(false); setMobileNotificationsOpen(false);
        root?.querySelector('[data-notification-trigger]')?.focus();
      }}>Close notifications</button>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Notifications{unreadCount !== null ? ` (${unreadCount} unread)` : ''}</span>
        {unreadCount > 0 && (
          <button type="button" disabled={inbox?.loading} onClick={() => inboxRef.current?.markAllRead()}
            className="text-[10px] underline disabled:opacity-50">Mark all read</button>
        )}
      </div>
      {!accountKey ? <Link to="/login">Sign in to view notifications.</Link> : (
        <>
          {inbox?.error && <p role="alert">{inbox.error} <button type="button" disabled={inbox.loading}
            className="underline" onClick={() => inboxRef.current?.refresh()}>Retry</button></p>}
          {(!inbox || inbox.loading) && <p role="status">Updating notifications…</p>}
          <label className="flex items-center gap-2 min-h-9">
            <input type="checkbox" checked={inbox?.unread ?? false} disabled={!inbox || inbox.loading}
              onChange={event => inboxRef.current?.filterUnread(event.target.checked)} />
            Unread only
          </label>
          {inbox && !inbox.loading && !inbox.error && notifications.length === 0 && (
            <div className="py-4 text-center"><BellOff className="w-4 h-4 mx-auto mb-2" />No notifications on this page.</div>
          )}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {notifications.map(n => {
              const isRead = isNotificationRead(n);
              const timestamp = parseDeadline(n.created_at);
              return (
                <div key={n.id} className={`p-2.5 rounded-xl border ${isRead ? 'opacity-65' : ''}`}
                  style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
                  <p className="font-semibold" dir="auto">{n.title || n.event_type || 'Notification'}{!isRead && <span className="sr-only"> — Unread</span>}</p>
                  <p className="mt-1" dir="auto">{n.message}</p>
                  {Number.isFinite(timestamp) && <time dateTime={new Date(timestamp).toISOString()}
                    className="block mt-1 text-[10px]">{new Date(timestamp).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</time>}
                  <div className="flex gap-3 mt-2">
                    {notificationLink(n) && <button type="button" className="underline" onClick={() => openNotification(n)}>View details<span className="sr-only">: {n.title || n.event_type || 'Notification'}</span></button>}
                    {!isRead && <button type="button" className="underline disabled:opacity-50" disabled={inbox.loading}
                      onClick={() => inboxRef.current?.markRead(n.id)}>Mark read<span className="sr-only">: {n.title || n.event_type || 'Notification'}</span></button>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between gap-3">
            <button type="button" disabled={!inbox || inbox.loading || !inbox.offset}
              className="disabled:opacity-40" onClick={() => inboxRef.current?.page(inbox.offset - NOTIFICATION_PAGE_SIZE)}>Newer</button>
            <button type="button" disabled={!inbox || inbox.loading || notifications.length < NOTIFICATION_PAGE_SIZE}
              className="disabled:opacity-40" onClick={() => inboxRef.current?.page(inbox.offset + NOTIFICATION_PAGE_SIZE)}>Older</button>
          </div>
          <details key={accountKey} className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <summary className="font-semibold cursor-pointer">Notification preferences</summary>
            <div className="space-y-2 mt-2">
              <p className="text-[10px]">Financial and security alerts are mandatory and cannot be disabled.</p>
              {(!preferences || preferences.loading) && <p role="status">Loading preferences…</p>}
              {preferences?.error && <p role="alert">{preferences.error}
                {!preferences.values && <button type="button" className="underline ml-1" disabled={preferences.loading}
                  onClick={() => preferencesRef.current?.load()}>Retry</button>}
              </p>}
              {preferences?.values && (
                <form className="space-y-2" onSubmit={event => { event.preventDefault(); void preferencesRef.current?.save(); }}>
                  <fieldset className="space-y-2" disabled={preferences.loading || preferences.pending}>
                    <legend className="sr-only">Notification delivery preferences</legend>
                    <label className="flex items-center justify-between gap-2">
                      <span>Notification language</span>
                      <select value={preferences.values.locale} onChange={event => preferencesRef.current?.edit({ locale: event.target.value })}
                        className="rounded border p-1" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}>
                        <option value="en">English</option>
                        <option value="ur">Urdu / اردو</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={preferences.values.optional_email}
                        onChange={event => preferencesRef.current?.edit({ optional_email: event.target.checked })} />
                      Optional email notifications
                    </label>
                    <label className="flex items-center gap-2 min-h-9">
                      <input type="checkbox" checked={preferences.values.optional_sms}
                        onChange={event => preferencesRef.current?.edit({ optional_sms: event.target.checked })} />
                      Optional SMS notifications
                    </label>
                    <p className="text-[10px]">Email and SMS delivery depend on available delivery services.</p>
                    <label className="flex items-center gap-2 min-h-9">
                      <input type="checkbox" checked={preferences.values.muted_info}
                        onChange={event => preferencesRef.current?.edit({ muted_info: event.target.checked })} />
                      Mute routine information
                    </label>
                    <p className="text-[10px]">Quiet hours use 24-hour time and may cross midnight. Clear both times to disable them.</p>
                    <label className="flex items-center justify-between gap-2">
                      Quiet hours start
                      <input type="time" step="60" value={preferences.values.quiet_start ?? ''}
                        className="rounded border p-1 min-w-0" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                        onChange={event => preferencesRef.current?.edit({ quiet_start: event.target.value || null })} />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                      Quiet hours end
                      <input type="time" step="60" value={preferences.values.quiet_end ?? ''}
                        className="rounded border p-1 min-w-0" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                        onChange={event => preferencesRef.current?.edit({ quiet_end: event.target.value || null })} />
                    </label>
                    <button type="button" className="underline min-h-9"
                      onClick={() => preferencesRef.current?.edit({ quiet_start: null, quiet_end: null })}>Clear quiet hours</button>
                    <label className="block space-y-1">
                      <span>Timezone offset from UTC (minutes)</span>
                      <input type="number" required min="-840" max="840" step="1" value={preferences.values.timezone_offset_minutes}
                        className="block w-full rounded border p-1" style={{ backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
                        onChange={event => preferencesRef.current?.edit({ timezone_offset_minutes: event.target.value === '' ? '' : Number(event.target.value) })} />
                    </label>
                    <p className="text-[10px]">For Pakistan, enter 300 (UTC+05:00). Negative values are west of UTC.</p>
                    <button type="submit" className="underline disabled:opacity-50">{preferences.pending ? 'Saving…' : 'Save preferences'}</button>
                  </fieldset>
                  {preferences.saved && <p role="status">Preferences saved.</p>}
                </form>
              )}
            </div>
          </details>
          {canManageNotificationOperations(role) && (
            <details open={operationsOpen} className="border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}
              onToggle={event => setOperationsOpen(event.currentTarget.open)}>
              <summary className="font-semibold cursor-pointer">Notification operations</summary>
              {operationsOpen && <NotificationOperations key={accountKey} role={role} />}
            </details>
          )}
          {role === 'SUPPLIER' && (
            <section className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
              <h3 className="font-semibold">Supplier operational alerts</h3>
              <p className="text-[10px]">Current pool conditions, separate from inbox read status.</p>
              {legacyState?.owner === accountKey && legacyState.error && <p role="status">{legacyState.error}</p>}
              {legacyState?.owner === accountKey && !legacyState.error && legacyAlerts.length === 0 && <p>No operational alerts.</p>}
              {legacyAlerts.map((alert, index) => <div key={`${alert.id ?? index}`} className="p-2 rounded-xl"
                style={{ backgroundColor: 'var(--bg-elevated)' }}>
                <p className="font-semibold">{alert.title || alert.type || 'Operational alert'}</p>
                <p>{alert.message}</p>
                {alert.source && <span className="text-[10px]">{String(alert.source).replace(/_/g, ' ')}</span>}
              </div>)}
            </section>
          )}
        </>
      )}
    </div>
  );

  useEffect(() => {
    if (!notificationsOpen) return undefined;
    return bindNotificationPanel(notificationsRef.current, () => setNotificationsOpen(false));
  }, [notificationsOpen]);

  useEffect(() => {
    if (!mobileNotificationsOpen) return undefined;
    return bindNotificationPanel(mobileNotificationsRef.current, () => setMobileNotificationsOpen(false));
  }, [mobileNotificationsOpen]);

  useEffect(() => {
    const viewport = window.matchMedia('(min-width: 768px)');
    const closeHiddenPanel = () => {
      const previousRoot = viewport.matches ? mobileNotificationsRef.current : notificationsRef.current;
      const restoreFocus = previousRoot?.contains(document.activeElement);
      setNotificationsOpen(false);
      setMobileNotificationsOpen(false);
      if (restoreFocus) {
        const visibleRoot = viewport.matches ? notificationsRef.current : mobileNotificationsRef.current;
        visibleRoot?.querySelector('[data-notification-trigger]')?.focus();
      }
    };
    viewport.addEventListener('change', closeHiddenPanel);
    return () => viewport.removeEventListener('change', closeHiddenPanel);
  }, []);

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
        { label: 'Smart Procurement Hub', path: '/procurement', icon: ClipboardList, active: is('/procurement') },
        { label: 'Subscription', path: '/supplier/subscription', icon: Building2, active: is('/supplier/subscription') },
        { label: 'Business Profile', path: '/supplier/profile', icon: User, active: is('/supplier/profile') || is('/supplier/onboarding') },
      ]
    : [
        { label: 'Home', path: '/', icon: Home, active: path === '/' },
        { label: 'Explore Pools', path: '/pools', icon: Layers, active: is('/pools') },
        ...(isAuthenticated
          ? [
              { label: 'Orders', path: '/orders', icon: ClipboardList, active: is('/orders') },
              { label: 'Smart Procurement Hub', path: '/procurement', icon: Tag, active: is('/procurement') },
            ]
          : []),
      ];

  // Mobile bottom bar items matching role-specific primary routes
  const mobileBottomItems = isAdmin
    ? [
        { label: 'Console', path: '/admin', icon: ShieldCheck, active: path === '/admin' || path === '/admin/dashboard' },
        { label: 'Verify', path: '/admin/verifications', icon: Users, active: is('/admin/verifications') || is('/admin/suppliers') },
        { label: 'Catalog', path: '/admin/catalog', icon: Layers, active: is('/admin/catalog') },
        { label: 'Profile', path: '/profile', icon: User, active: is('/profile') },
      ]
    : isSupplier
    ? [
        { label: 'Dashboard', path: '/supplier/dashboard', icon: Home, active: is('/supplier/dashboard') },
        { label: 'Catalog', path: '/supplier/catalog', icon: Tag, active: is('/supplier/catalog') },
        { label: 'Pools', path: '/supplier/pools', icon: Layers, active: is('/supplier/pools') },
        { label: 'Hub', path: '/procurement', icon: ClipboardList, active: is('/procurement') },
        { label: 'Plan', path: '/supplier/subscription', icon: Building2, active: is('/supplier/subscription') },
      ]
    : [
        { label: 'Home', path: '/', icon: Home, active: path === '/' },
        { label: 'Pools', path: '/pools', icon: Layers, active: is('/pools') },
        ...(isAuthenticated
          ? [
              { label: 'Hub', path: '/procurement', icon: Tag, active: is('/procurement') },
              { label: 'Orders', path: '/orders', icon: ClipboardList, active: is('/orders') },
            ]
          : []),
        { label: isAuthenticated ? 'Profile' : 'Sign in', path: isAuthenticated ? '/profile' : '/login', icon: User, active: path === '/login' || path === '/profile' },
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
              onClick={() => { setMobileNotificationsOpen(false); setMobileSearchOpen(true); }}
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
                onClick={() => { setNotificationsOpen(false); setMobileNotificationsOpen(!mobileNotificationsOpen); }}
                data-notification-trigger
                aria-haspopup="dialog"
                aria-controls={mobileNotificationsOpen ? 'mobile-notification-panel' : undefined}
                aria-label={unreadCount === null ? 'Notifications' : `Notifications, ${unreadCount} unread`}
                aria-expanded={mobileNotificationsOpen}
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
                    className="min-w-4 px-1 text-[9px] rounded-full bg-emerald-600 text-white absolute -top-1 -right-1"
                    aria-label={`${unreadCount} unread notifications`}
                  >{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>

              {/* Mobile Notifications Popover */}
              {mobileNotificationsOpen && (
                <div
                  id="mobile-notification-panel" role="dialog" aria-label="Notifications" tabIndex={-1}
                  className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-32px)] max-h-[70dvh] overflow-y-auto p-3.5 rounded-2xl border shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                    boxShadow: 'var(--shadow-elevated)',
                  }}
                >
                  {renderNotificationPanel()}
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
                                border: isSelected ? '1px solid var(--brand-accent)' : '1px solid transparent',
                              }}
                            >
                              <OptionIcon
                                className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                  isSelected
                                    ? 'text-emerald-900 dark:text-champagne'
                                    : ''
                                }`}
                                style={{ color: isSelected ? (isDark ? '#dfbf85' : '#6c501e') : 'var(--text-secondary)' }}
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
                                    style={{ color: isSelected ? (isDark ? '#dfbf85' : '#6c501e') : 'var(--text-secondary)' }}
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
                onClick={() => { setMobileNotificationsOpen(false); setNotificationsOpen(!notificationsOpen); }}
                data-notification-trigger
                aria-haspopup="dialog"
                aria-controls={notificationsOpen ? 'desktop-notification-panel' : undefined}
                aria-label={unreadCount === null ? 'Notifications' : `Notifications, ${unreadCount} unread`}
                aria-expanded={notificationsOpen}
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
                    className="min-w-4 px-1 text-[9px] rounded-full bg-emerald-600 text-white absolute -top-1 -right-1"
                    aria-label={`${unreadCount} unread notifications`}
                  >{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
              </button>

              {notificationsOpen && (
                <div
                  id="desktop-notification-panel" role="dialog" aria-label="Notifications" tabIndex={-1}
                  className="absolute right-0 top-full mt-2 w-80 max-h-[70dvh] overflow-y-auto p-3.5 rounded-2xl border shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-default)',
                    boxShadow: 'var(--shadow-elevated)',
                  }}
                >
                  {renderNotificationPanel()}
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
                            color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                            border: isSelected ? '1px solid var(--brand-accent)' : '1px solid transparent',
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <OptionIcon
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                isSelected ? 'text-emerald-800 dark:text-champagne' : ''
                              }`}
                              style={{ color: isSelected ? (isDark ? '#dfbf85' : '#6c501e') : 'var(--text-secondary)' }}
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
