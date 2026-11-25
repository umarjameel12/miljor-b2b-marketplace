import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/ui/Logo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from 'react-toastify';
import { Mail, KeyRound, AlertCircle, ArrowLeft } from 'lucide-react';

export const VerifyEmailPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyEmail, resendOtp } = useAuth();

  const initialEmail = location.state?.email || new URLSearchParams(location.search).get('email') || '';
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleOtpChange = (e) => {
    // Only accept numeric digits, maximum 6
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setOtp(val);
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      const msg = 'Please provide the email address to verify.';
      setError(msg);
      toast.error(msg);
      return;
    }

    if (otp.length !== 6) {
      const msg = 'Please enter the complete 6-digit OTP code.';
      setError(msg);
      toast.error(msg);
      return;
    }

    setLoading(true);
    try {
      await verifyEmail({ email: email.trim(), otp: otp.trim() });
      toast.success('Email verified successfully. Welcome to MilJor!');
      navigate('/pools', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Verification failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim()) {
      toast.error('Please enter your email to resend OTP.');
      return;
    }

    setResending(true);
    try {
      const res = await resendOtp({ email: email.trim() });
      toast.success(res.message || 'New 6-digit OTP sent to your email.');
      setCooldown(60);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message || 'Failed to resend OTP';
      toast.error(msg);
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      className="min-h-[calc(100vh-5rem)] flex items-center justify-center p-4 sm:p-6 lg:p-8 transition-colors duration-300 relative overflow-hidden"
      style={{ background: 'var(--bg-auth)' }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          boxShadow: 'var(--shadow-elevated)',
        }}
        className="w-full max-w-md p-8 sm:p-10 rounded-3xl border flex flex-col gap-6 relative z-10"
      >
        {/* Top Branding */}
        <div className="flex flex-col items-center text-center">
          <Link to="/" aria-label="MilJor Home" className="mb-4">
            <Logo variant="monogram" size="lg" />
          </Link>

          <h2
            className="font-display font-black text-2xl tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Verify Your Email
          </h2>
          <p className="text-xs font-sans mt-1" style={{ color: 'var(--text-muted)' }}>
            Enter the 6-digit verification code sent to your email address.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div
            className="p-3.5 rounded-xl border flex items-start gap-2.5 text-xs"
            style={{
              backgroundColor: 'var(--status-danger-bg)',
              borderColor: 'var(--status-danger)',
              color: 'var(--status-danger)',
            }}
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="font-semibold block">Verification Notice</span>
              <span className="mt-0.5 block">{error}</span>
            </div>
          </div>
        )}

        {/* OTP Form */}
        <form onSubmit={handleVerify} className="flex flex-col gap-4">
          <Input
            label="Email Address"
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={Mail}
            placeholder="buyer@kitchen.com"
            required
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              <span>6-Digit Verification Code</span>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending || cooldown > 0}
                className="font-semibold text-xs hover:underline disabled:opacity-50 transition cursor-pointer"
                style={{ color: 'var(--brand-accent)' }}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
              </button>
            </div>

            <div className="relative flex items-center">
              <KeyRound className="w-4 h-4 absolute left-3.5 pointer-events-none text-stone-400" />
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={otp}
                onChange={handleOtpChange}
                maxLength={6}
                required
                style={{
                  backgroundColor: 'var(--bg-input)',
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                }}
                className="w-full h-12 pl-10 pr-4 text-center text-lg font-bold font-numeric tracking-[0.35em] rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] transition"
              />
            </div>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Check your inbox or spam folder for the one-time passcode.
            </p>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            disabled={otp.length !== 6}
            fullWidth
            className="mt-2"
          >
            Verify & Continue
          </Button>
        </form>

        {/* Footer */}
        <div
          className="pt-6 border-t flex items-center justify-between text-xs"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-semibold hover:underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPage;
