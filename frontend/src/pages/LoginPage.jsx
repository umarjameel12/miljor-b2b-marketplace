// =============================================================================
// src/pages/LoginPage.jsx
// MilJor Premium Authentication V2: Dedicated Sign-In Experience
// Reversible Split Luxury / Original Layout, Nationwide Brand Positioning,
// Light & Dark Theme Craft, and Connected Forgot Password Routing
// =============================================================================
import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAuthAppearance } from '../context/AuthAppearanceContext';
import { AuthAppearanceControl } from '../components/auth/AuthAppearanceControl';
import { AuthHeroPanel } from '../components/auth/AuthHeroPanel';
import { Logo } from '../components/ui/Logo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from 'react-toastify';
import { Mail, Lock, AlertCircle } from 'lucide-react';

export const LoginPage = () => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const { preferences } = useAuthAppearance();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/pools';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setUnverifiedEmail(null);

    if (!identifier.trim() || !password) {
      const msg = 'Please enter your registered email address and password.';
      setError(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    try {
      await login({ identifier: identifier.trim(), password, rememberMe });
      toast.success('Signed in successfully.');
      navigate(from, { replace: true });
    } catch (err) {
      const errData = err.response?.data?.error;
      const code = errData?.code;
      const msg = errData?.message || err.message || 'Authentication failed';

      if (code === 'EMAIL_NOT_VERIFIED') {
        const targetEmail = errData?.email || (identifier.includes('@') ? identifier.trim() : '');
        setUnverifiedEmail(targetEmail);
        setError('Please verify your email address to continue.');
        toast.error('Email verification required.');
      } else {
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // Sign-In Form Core Component
  const renderForm = () => (
    <div className="flex flex-col gap-3.5 sm:gap-4 w-full">
      {/* Top Branding & Positioning */}
      <div className="flex flex-col items-center text-center">
        <Link to="/" aria-label="MilJor Home" className="mb-1">
          <Logo variant="monogram" size="lg" />
        </Link>

        {preferences.showTagline && (
          <span
            className="font-sans font-semibold text-[10px] sm:text-[11px] tracking-widest uppercase mb-0.5"
            style={{ color: 'var(--brand-accent)' }}
          >
            Mil Kar Khareedo, Behtar Pao
          </span>
        )}

        {preferences.showBrandHeading && (
          <h1
            className="font-display font-black text-xl sm:text-2xl tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Sign In to MilJor
          </h1>
        )}

        <p
          className="text-xs font-sans mt-0.5"
          style={{ color: 'var(--text-muted)' }}
        >
          Smarter procurement for growing businesses · Launching first in Lahore
        </p>
      </div>

      {/* Segmented Quick-Switch Tabs [Sign In | Create Account] */}
      <div
        className="grid grid-cols-2 p-1 rounded-xl border text-xs font-semibold"
        style={{
          backgroundColor: 'var(--bg-input)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <span
          className="py-1.5 text-center rounded-lg transition-all shadow-xs cursor-default"
          style={{
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
          }}
        >
          Sign In
        </span>
        <Link
          to="/register"
          className="py-1.5 text-center rounded-lg transition-all hover:text-[var(--text-primary)]"
          style={{ color: 'var(--text-muted)' }}
        >
          Create Account
        </Link>
      </div>

      {/* Error / Verification Notice */}
      {error && (
        <div
          className="p-3 rounded-xl border flex flex-col gap-1.5 text-xs animate-in fade-in duration-200"
          style={{
            backgroundColor: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
            color: 'var(--status-danger)',
          }}
          role="alert"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block">Sign-In Notice</span>
              <span className="mt-0.5 block">{error}</span>
            </div>
          </div>

          {unverifiedEmail && (
            <div className="pt-1.5 border-t flex justify-end" style={{ borderColor: 'rgba(163, 34, 34, 0.2)' }}>
              <Link
                to={`/verify-email?email=${encodeURIComponent(unverifiedEmail)}`}
                state={{ email: unverifiedEmail }}
                className="inline-flex items-center font-bold hover:underline"
              >
                <span>Verify Email Now</span>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Sign-In Form Fields */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input
          label="Business Email"
          type="email"
          required
          autoComplete="email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="procurement@business.pk"
          icon={Mail}
        />

        <Input
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
          icon={Lock}
        />

        {/* Remember Me & Working Forgot Password Link */}
        <div className="flex items-center justify-between text-xs pt-0.5">
          <label className="flex items-center gap-2 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-700 focus:ring-[var(--brand-accent)] border-[var(--border-default)] cursor-pointer"
            />
            <span className="transition-colors group-hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
              Remember device
            </span>
          </label>
          <Link
            to="/forgot-password"
            className="font-medium hover:underline transition-colors cursor-pointer"
            style={{ color: 'var(--brand-accent)' }}
          >
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          className="w-full mt-1 font-semibold shadow-xs justify-center cursor-pointer"
          style={{
            backgroundColor: 'var(--brand-accent)',
            color: 'var(--text-on-champagne)',
          }}
        >
          <span>Sign In</span>
        </Button>
      </form>
    </div>
  );

  return (
    <div
      className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-3 sm:p-5 lg:p-6 transition-colors duration-300 relative overflow-hidden"
      style={{ background: 'var(--bg-auth)' }}
    >
      {/* Floating Appearance Customizer Control */}
      <AuthAppearanceControl />

      {/* ORIGINAL LAYOUT MODE (Reversible single-card center presentation) */}
      {preferences.layoutStyle === 'original' ? (
        <div
          className="w-full max-w-md p-6 sm:p-8 rounded-3xl auth-box-enhanced relative z-10 shadow-xl my-auto border"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          {renderForm()}
        </div>
      ) : (
        /* ENHANCED SPLIT LUXURY LAYOUT (Dedicated Sign In Experience) */
        <div
          className={`w-full ${
            preferences.showBrandPanel ? 'max-w-4xl' : 'max-w-md'
          } rounded-3xl auth-box-enhanced shadow-2xl relative z-10 overflow-hidden border transition-all duration-300 my-auto`}
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className={`grid ${preferences.showBrandPanel ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'}`}>
            {/* Left Dedicated Sign-In Hero Panel */}
            {preferences.showBrandPanel && (
              <AuthHeroPanel
                pageType="signin"
                showBackgroundImage={preferences.showBackgroundImage}
                className="lg:col-span-5 min-h-[300px] lg:min-h-[460px]"
              />
            )}

            {/* Right Sign-In Form Panel */}
            <div
              className={`${
                preferences.showBrandPanel ? 'lg:col-span-7' : 'col-span-1'
              } p-6 sm:p-8 flex flex-col justify-center`}
            >
              {renderForm()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginPage;
