import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AuthAppearanceProvider } from './context/AuthAppearanceContext';
import { Navbar } from './components/Navbar';
import { OpeningTreatment } from './components/ui/OpeningTreatment';
import { Logo } from './components/ui/Logo';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const PoolsPage = lazy(() => import('./pages/PoolsPage').then((m) => ({ default: m.PoolsPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage').then((m) => ({ default: m.VerifyEmailPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SupplierProfilePage = lazy(() => import('./pages/SupplierProfilePage').then((m) => ({ default: m.SupplierProfilePage })));
const SupplierOnboardingPage = lazy(() => import('./pages/SupplierOnboardingPage').then((m) => ({ default: m.SupplierOnboardingPage })));
const SupplierCatalogPage = lazy(() => import('./pages/SupplierCatalogPage').then((m) => ({ default: m.SupplierCatalogPage })));
const AdminVerificationPage = lazy(() => import('./pages/AdminVerificationPage').then((m) => ({ default: m.AdminVerificationPage })));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })));
const AdminCatalogPage = lazy(() => import('./pages/AdminCatalogPage').then((m) => ({ default: m.AdminCatalogPage })));
const SupplierDashboardPage = lazy(() => import('./pages/SupplierDashboardPage').then((m) => ({ default: m.SupplierDashboardPage })));
const SupplierPoolsPage = lazy(() => import('./pages/SupplierPoolsPage').then((m) => ({ default: m.SupplierPoolsPage })));
const SupplierSubscriptionPage = lazy(() => import('./pages/SupplierSubscriptionPage').then((m) => ({ default: m.SupplierSubscriptionPage })));
const FlashPoolsPage = lazy(() => import('./pages/FlashPoolsPage').then((m) => ({ default: m.FlashPoolsPage })));
const DemandRequestsPage = lazy(() => import('./pages/DemandRequestsPage').then((m) => ({ default: m.DemandRequestsPage })));
const RfqPage = lazy(() => import('./pages/RfqPage').then((m) => ({ default: m.RfqPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const PaymentReturnPage = lazy(() => import('./pages/PaymentReturnPage').then((m) => ({ default: m.PaymentReturnPage })));

function RouteFallback() {
  return (
    <div className="flex-1 flex items-center justify-center py-24" role="status" aria-live="polite">
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading…</span>
    </div>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

function AppContent() {
  const { loading: authLoading } = useAuth();
  const { isDark } = useTheme();
  const location = useLocation();

  // If initial authentication hydration is pending, show minimal non-blocking monogram treatment
  if (authLoading) {
    return <OpeningTreatment />;
  }

  // Showcase (/), marketplace (/pools), orders (/orders), checkout (/checkout), payment (/payment), profile (/profile), supplier (/supplier), and admin (/admin) use the responsive AppShell layout with sidebar.
  // Auth routes (/login, /register, /verify-email, /forgot-password) use the clean standalone Navbar.
  const isAppShellRoute = location.pathname === '/' || location.pathname.startsWith('/pools') || location.pathname.startsWith('/orders') || location.pathname.startsWith('/checkout') || location.pathname.startsWith('/payment') || location.pathname.startsWith('/profile') || location.pathname.startsWith('/supplier') || location.pathname.startsWith('/admin') || location.pathname.startsWith('/flash-pools') || location.pathname.startsWith('/demand-requests') || location.pathname.startsWith('/rfqs');

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-200 selection:bg-[var(--brand-accent)] selection:text-[var(--text-on-champagne)]"
      style={{
        backgroundColor: 'var(--bg-page)',
        color: 'var(--text-primary)',
      }}
    >
      {!isAppShellRoute && <Navbar />}

      <div className="flex-1 flex flex-col">
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/pools" element={<PoolsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/checkout/:orderId" element={<CheckoutPage />} />
          <Route path="/payment/return" element={<PaymentReturnPage />} />
          <Route path="/payment/cancelled" element={<PaymentReturnPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/flash-pools" element={<FlashPoolsPage />} />
          <Route path="/demand-requests" element={<DemandRequestsPage />} />
          <Route path="/rfqs" element={<RfqPage />} />
          <Route path="/supplier/dashboard" element={<SupplierDashboardPage />} />
          <Route path="/supplier/pools" element={<SupplierPoolsPage />} />
          <Route path="/supplier/subscription" element={<SupplierSubscriptionPage />} />
          <Route path="/supplier/profile" element={<SupplierProfilePage />} />
          <Route path="/supplier/onboarding" element={<SupplierOnboardingPage />} />
          <Route path="/supplier/catalog" element={<SupplierCatalogPage />} />
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
          <Route path="/admin/verifications" element={<AdminVerificationPage />} />
          <Route path="/admin/suppliers/verification" element={<AdminVerificationPage />} />
          <Route path="/admin/catalog" element={<AdminCatalogPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </div>

      <ToastContainer
        position="top-right"
        autoClose={3500}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme={isDark ? 'dark' : 'light'}
      />

      {/* Quiet Luxury B2B Footer (Auth Views Only) */}
      {!isAppShellRoute && (
        <footer
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
          className="border-t py-10 px-4 sm:px-6 lg:px-8 mt-auto transition-colors duration-200"
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
              <a href="/#how-it-works" className="hover:underline">
                How It Works
              </a>
              <span>•</span>
              <a href="/#collective-procurement" className="hover:underline">
                Collective Buying
              </a>
            </div>

            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              © {CURRENT_YEAR} MilJor Platform. All rights reserved.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <AuthAppearanceProvider>
            <AppContent />
          </AuthAppearanceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
