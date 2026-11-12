import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from './ui/Logo';
import { ThemeSelector } from './ui/ThemeSelector';
import { Drawer } from './ui/Drawer';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { toast } from 'react-toastify';
import {
  LogOut,
  Layers,
  HelpCircle,
  Users,
} from 'lucide-react';

export const Navbar = () => {
  const { user, isAuthenticated, role, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthRoute =
    location.pathname === '/login' ||
    location.pathname === '/register' ||
    location.pathname === '/verify-email' ||
    location.pathname === '/forgot-password';

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
    toast.info('Signed out successfully.');
    navigate('/login');
  };

  const getRoleBadgeVariant = (roleName) => {
    switch (roleName) {
      case 'BUYER':
        return 'emerald';
      case 'SUPPLIER':
        return 'accent';
      case 'ADMIN':
      case 'SUPER_ADMIN':
        return 'warning';
      default:
        return 'neutral';
    }
  };

  const isActiveRoute = (path) => location.pathname === path;

  return (
    <>
      <header
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
        }}
        className="sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-200"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            {/* Brand: Refined Champagne-Gold Ribbon M Monogram */}
            <div className="flex items-center gap-6">
              {/* Desktop: Brand Logo links to Home */}
              <Link
                to="/"
                className="hidden md:flex items-center group focus-visible:outline-2 focus-visible:outline-offset-4 rounded-xl"
                aria-label="MilJor Home"
              >
                <Logo variant="monogram" size="md" />
              </Link>

              {/* Mobile: MilJor Logo acts as the navigation drawer trigger (identical to AppShell) */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? 'Close navigation drawer' : 'Open navigation drawer'}
                aria-expanded={mobileMenuOpen}
                className="flex md:hidden items-center justify-center p-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] cursor-pointer"
              >
                <Logo size="sm" />
              </button>
            </div>

            {/* Desktop Navigation Links — Hidden on Auth Routes for Focus */}
            {!isAuthRoute && (
              <nav className="hidden md:flex items-center gap-8" aria-label="Main Navigation">
                <Link
                  to="/pools"
                  className={`text-sm font-sans font-medium transition-colors flex items-center gap-2 ${
                    isActiveRoute('/pools')
                      ? 'font-semibold text-emerald-950 dark:text-champagne-light'
                      : 'hover:opacity-100 opacity-90'
                  }`}
                  style={{ color: 'var(--text-primary)' }}
                >
                  <Layers className={`w-4 h-4 ${isActiveRoute('/pools') ? 'text-emerald-900 dark:text-champagne' : 'text-emerald-800 dark:text-champagne'}`} />
                  <span>Pools</span>
                </Link>

                <a
                  href="/#how-it-works"
                  className="text-sm font-sans font-medium transition-colors flex items-center gap-2 opacity-90 hover:opacity-100"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <HelpCircle className="w-4 h-4 text-emerald-800 dark:text-champagne" />
                  <span>How It Works</span>
                </a>

                <a
                  href="/#collective-procurement"
                  className="text-sm font-sans font-medium transition-colors flex items-center gap-2 opacity-90 hover:opacity-100"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <Users className="w-4 h-4 text-emerald-800 dark:text-champagne" />
                  <span>Collective Buying</span>
                </a>
              </nav>
            )}

            {/* Right Action Cluster: Discreet Theme Selector & Auth CTAs */}
            <div className="hidden md:flex items-center gap-4">
              {/* Subtle public theme setting control */}
              <ThemeSelector minimal={true} />

              {isAuthenticated ? (
                <div className="flex items-center gap-3 pl-3 border-l" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="flex flex-col items-end leading-tight">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-semibold max-w-[140px] truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {user?.business_name || user?.full_name || user?.email}
                      </span>
                      {role && (
                        <Badge variant={getRoleBadgeVariant(role)} size="xs">
                          {role}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    className="text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100 p-2"
                    aria-label="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              ) : isAuthRoute ? null : (
                <div className="flex items-center gap-3">
                  <Link to="/login">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="font-semibold transition hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      Sign In
                    </Button>
                  </Link>

                  <Link to="/register">
                    <Button
                      variant="primary"
                      size="sm"
                      className="font-semibold shadow-xs"
                      style={{
                        backgroundColor: 'var(--brand-accent)',
                        color: 'var(--text-on-champagne)',
                      }}
                    >
                      <span>Create Account</span>
                    </Button>
                  </Link>
                </div>
              )}
            </div>

            {/* Mobile Header Cluster: Discrete Theme Toggle ONLY (Hamburger removed, left Logo triggers drawer) */}
            <div className="flex items-center gap-2 md:hidden">
              <ThemeSelector minimal={true} />
            </div>
          </div>
        </div>
      </header>

      {/* Accessible Slide-Out Mobile Navigation Drawer (Opens from LEFT) */}
      <Drawer
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        side="left"
      >
        <div className="flex flex-col h-full justify-between">
          <div className="space-y-5">
            {/* Top Brand Identity in Drawer: Tagline Card (Header already renders MilJor logo as close button) */}
            <div
              className="p-3.5 rounded-2xl flex items-center gap-3 border shadow-2xs"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <div className="flex flex-col">
                <span className="font-sans font-medium text-xs tracking-wider" style={{ color: 'var(--brand-accent)' }}>
                  Milkar Khareedo, Behtar Pao
                </span>
                <span className="font-sans text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Collective Food Procurement Platform
                </span>
              </div>
            </div>

            {/* Authenticated User Status */}
            {isAuthenticated && user && (
              <div
                className="p-3.5 rounded-xl border flex items-center justify-between"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-emerald-800 text-stone-100 flex items-center justify-center font-bold text-xs">
                    {(user.full_name || user.email || 'U')[0].toUpperCase()}
                  </div>
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-semibold truncate max-w-[160px]" style={{ color: 'var(--text-primary)' }}>
                      {user.business_name || user.full_name}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {user.email}
                    </span>
                  </div>
                </div>
                {role && (
                  <Badge variant={getRoleBadgeVariant(role)} size="xs">
                    {role}
                  </Badge>
                )}
              </div>
            )}

            {/* Navigation Routes — High Contrast in Light and Dark Themes */}
            {!isAuthRoute ? (
              <nav className="flex flex-col space-y-1.5" aria-label="Mobile Navigation">
                <Link
                  to="/pools"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium transition-colors ${
                    isActiveRoute('/pools')
                      ? 'font-bold shadow-xs'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                  style={{
                    backgroundColor: isActiveRoute('/pools') ? 'var(--bg-sidebar-active)' : 'transparent',
                    color: 'var(--text-primary)',
                    border: isActiveRoute('/pools') ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  }}
                >
                  <Layers className="w-4 h-4 text-emerald-800 dark:text-champagne shrink-0" />
                  <span>Explore Wholesale Pools</span>
                </Link>

                <a
                  href="/#how-it-works"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <HelpCircle className="w-4 h-4 text-emerald-800 dark:text-champagne shrink-0" />
                  <span>How Collective Buying Works</span>
                </a>

                <a
                  href="/#collective-procurement"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <Users className="w-4 h-4 text-emerald-800 dark:text-champagne shrink-0" />
                  <span>Collective Procurement Benefits</span>
                </a>
              </nav>
            ) : (
              <nav className="flex flex-col space-y-1.5" aria-label="Mobile Navigation">
                <Link
                  to="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span>Return to Home</span>
                </Link>
                <Link
                  to="/pools"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-sans font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span>Explore Pools</span>
                </Link>
              </nav>
            )}
          </div>

          {/* Drawer Footer: Theme Settings & Auth Action */}
          <div className="pt-4 border-t mt-6 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <span className="block text-xs font-sans font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Theme Mode</span>
              <ThemeSelector className="w-full justify-between" />
            </div>

            {isAuthenticated ? (
              <Button
                variant="outline"
                size="md"
                onClick={handleLogout}
                className="w-full justify-center text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/40 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <LogOut className="w-4 h-4 mr-2" />
                <span>Sign Out</span>
              </Button>
            ) : isAuthRoute ? null : (
              <div className="flex flex-col gap-2 pt-1">
                {location.pathname !== '/login' && (
                  <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="block">
                    <Button
                      variant="primary"
                      size="md"
                      className="w-full justify-center font-semibold shadow-xs"
                      style={{
                        backgroundColor: 'var(--brand-accent)',
                        color: 'var(--text-on-champagne)',
                      }}
                    >
                      <span>Sign In</span>
                    </Button>
                  </Link>
                )}
                {location.pathname !== '/register' && (
                  <Link to="/register" onClick={() => setMobileMenuOpen(false)} className="block">
                    <Button
                      variant="primary"
                      size="md"
                      className="w-full justify-center font-semibold shadow-xs"
                      style={{
                        backgroundColor: 'var(--brand-accent)',
                        color: 'var(--text-on-champagne)',
                      }}
                    >
                      <span>Create Account</span>
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </Drawer>
    </>
  );
};

export default Navbar;
