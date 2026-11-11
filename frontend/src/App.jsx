import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AuthAppearanceProvider } from './context/AuthAppearanceContext';
import { Navbar } from './components/Navbar';
import { OpeningTreatment } from './components/ui/OpeningTreatment';
import { Logo } from './components/ui/Logo';
import { LandingPage } from './pages/LandingPage';
import { PoolsPage } from './pages/PoolsPage';
import { OrdersPage } from './pages/OrdersPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ProfilePage } from './pages/ProfilePage';
import { SupplierProfilePage } from './pages/SupplierProfilePage';
import { SupplierOnboardingPage } from './pages/SupplierOnboardingPage';
import { SupplierCatalogPage } from './pages/SupplierCatalogPage';
import { AdminVerificationPage } from './pages/AdminVerificationPage';
import { AdminCatalogPage } from './pages/AdminCatalogPage';
import { SupplierDashboardPage } from './pages/SupplierDashboardPage';
import { SupplierPoolsPage } from './pages/SupplierPoolsPage';
import { SupplierSubscriptionPage } from './pages/SupplierSubscriptionPage';
import { FlashPoolsPage } from './pages/FlashPoolsPage';
import { DemandRequestsPage } from './pages/DemandRequestsPage';
import { RfqPage } from './pages/RfqPage';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const CURRENT_YEAR = new Date().getFullYear();

function AppContent() {
  const { loading: authLoading } = useAuth();
  const { isDark } = useTheme();
  const location = useLocation();

  // If initial authentication hydration is pending, show minimal non-blocking monogram treatment
  if (authLoading) {
    return <OpeningTreatment />;
  }

  // Showcase (/), marketplace (/pools), orders (/orders), profile (/profile), supplier (/supplier), and admin (/admin) use the responsive AppShell layout with sidebar.
  // Auth routes (/login, /register, /verify-email, /forgot-password) use the clean standalone Navbar.
  const isAppShellRoute = location.pathname === '/' || location.pathname.startsWith('/pools') || location.pathname.startsWith('/orders') || location.pathname.startsWith('/profile') || location.pathname.startsWith('/supplier') || location.pathname.startsWith('/admin') || location.pathname.startsWith('/flash-pools') || location.pathname.startsWith('/demand-requests') || location.pathname.startsWith('/rfqs');

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
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/pools" element={<PoolsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
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
          <Route path="/admin/verifications" element={<AdminVerificationPage />} />
          <Route path="/admin/suppliers/verification" element={<AdminVerificationPage />} />
          <Route path="/admin/catalog" element={<AdminCatalogPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
