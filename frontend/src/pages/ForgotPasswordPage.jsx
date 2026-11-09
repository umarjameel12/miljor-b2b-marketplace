// =============================================================================
// src/pages/ForgotPasswordPage.jsx
// MilJor Premium Authentication V2: Complete Forgot Password Recovery Flow
// 4-Step Recovery Journey: Email -> Verification Code -> New Password -> Success
// Reversible Split Luxury / Original Layout & Real Backend Contract Integration
// Strict Design A Semantics: Single-Use Atomic Code Verification on Reset
// =============================================================================
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { useAuthAppearance } from '../context/AuthAppearanceContext';
import { AuthAppearanceControl } from '../components/auth/AuthAppearanceControl';
import { AuthHeroPanel } from '../components/auth/AuthHeroPanel';
import { PasswordField } from '../components/auth/PasswordField';
import { Logo } from '../components/ui/Logo';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { toast } from 'react-toastify';
import {
  Mail,
  KeyRound,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Lock,
  Clock,
  HelpCircle
} from 'lucide-react';

/**
 * Maps authoritative backend error codes into clear, privacy-safe user feedback.
 */
function mapRecoveryError(errCode, status, rawMessage) {
  switch (errCode) {
    case 'VALIDATION_ERROR':
      return 'Please verify that your business email is valid and your new password meets complexity requirements (at least 8 characters with letters and numbers).';
    case 'INVALID_OTP':
      return 'The verification code entered is incorrect. Please check the 6-digit code or request a fresh one.';
    case 'OTP_EXPIRED':
      return 'Your verification code has expired (codes remain valid for 10 minutes). Please request a fresh code to proceed.';
    case 'MAX_ATTEMPTS_EXCEEDED':
      return 'Too many invalid attempts. For your security, this verification code has been invalidated. Please request a fresh code.';
    case 'RATE_LIMITED':
      return 'Please wait before requesting another verification code. A security cooldown is in effect.';
    case 'OTP_ALREADY_CONSUMED':
    case 'INVALID_REQUEST':
      return 'This password recovery request is no longer valid or has already been used. Please start a fresh recovery request.';
    case 'ACCOUNT_SUSPENDED':
      return 'Your account is currently suspended or restricted. Password recovery cannot be completed. Please contact MilJor support.';
    case 'SERVER_ERROR':
    case 'RESET_FAILED':
      return 'Password reset request could not be processed at this time. Please try again shortly.';
    default:
      if (status === 429) {
        return 'Please wait before requesting another verification code. A security cooldown is in effect.';
      }
      return rawMessage || 'An unexpected error occurred during password recovery. Please try again.';
  }
}

export const ForgotPasswordPage = () => {
  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password, 4: Success
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [infoMessage, setInfoMessage] = useState(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [uncertainResult, setUncertainResult] = useState(false);

  const generationRef = useRef(0);
  const cooldownTimerRef = useRef(null);

  const { preferences } = useAuthAppearance();
  const navigate = useNavigate();

  // Cooldown timer interval: decrement every second until 0
  useEffect(() => {
    if (cooldownSeconds > 0) {
      cooldownTimerRef.current = setInterval(() => {
        setCooldownSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(cooldownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
      }
    };
  }, [cooldownSeconds]);

  // Cleanup sensitive fields when component unmounts
  useEffect(() => {
    return () => {
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
    };
  }, []);

  // Password validation
  const isLengthValid = newPassword.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const isPasswordValid = isLengthValid && hasLetter && hasNumber;
  const isPasswordMatch = newPassword === confirmPassword && newPassword.length > 0;

  // STEP 1: Request Password Reset Code
  const handleRequestCode = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setErrorCode(null);
    setInfoMessage(null);
    setUncertainResult(false);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid business email address.');
      return;
    }

    const currentGen = ++generationRef.current;
    setLoading(true);

    try {
      const res = await authApi.requestPasswordReset({ email: cleanEmail });
      if (generationRef.current !== currentGen) return;

      toast.info('Recovery code requested.');
      setInfoMessage(
        res.message || 'If an eligible account exists with this email address, password reset instructions will be sent.'
      );
      setCooldownSeconds(60);
      setStep(2);
    } catch (err) {
      if (generationRef.current !== currentGen) return;

      const status = err.response?.status;
      const code = err.response?.data?.error?.code;
      const rawMsg = err.response?.data?.error?.message || err.message;
      const friendlyMsg = mapRecoveryError(code, status, rawMsg);

      if (status === 429 || code === 'RATE_LIMITED') {
        setCooldownSeconds(60);
      }
      setError(friendlyMsg);
      setErrorCode(code);
      toast.error(friendlyMsg);
    } finally {
      if (generationRef.current === currentGen) {
        setLoading(false);
      }
    }
  };

  // STEP 2: Collect Code & Proceed to Password Entry
  // Note: Design A verifies OTP atomically upon final reset submission
  const handleProceedToPassword = (e) => {
    e.preventDefault();
    setError(null);
    setErrorCode(null);

    const cleanOtp = otp.trim().replace(/\D/g, '');
    if (!cleanOtp) {
      setError('Please enter the 6-digit verification code sent to your email.');
      return;
    }

    if (cleanOtp.length !== 6) {
      setError('The verification code must be exactly 6 digits.');
      return;
    }

    setStep(3);
  };

  // Resend OTP handler with server-authoritative cooldown
  const handleResendOtp = async () => {
    if (!email || cooldownSeconds > 0 || resending || loading) return;

    setError(null);
    setErrorCode(null);
    setUncertainResult(false);

    const currentGen = ++generationRef.current;
    setResending(true);

    try {
      const res = await authApi.requestPasswordReset({ email: email.trim().toLowerCase() });
      if (generationRef.current !== currentGen) return;

      toast.info('Fresh verification code requested.');
      setInfoMessage(
        res.message || 'If an eligible account exists with this email address, a fresh verification code will be sent.'
      );
      setCooldownSeconds(60);
    } catch (err) {
      if (generationRef.current !== currentGen) return;

      const status = err.response?.status;
      const code = err.response?.data?.error?.code;
      const rawMsg = err.response?.data?.error?.message || err.message;
      const friendlyMsg = mapRecoveryError(code, status, rawMsg);

      if (status === 429 || code === 'RATE_LIMITED') {
        setCooldownSeconds(60);
      }
      setError(friendlyMsg);
      setErrorCode(code);
      toast.error(friendlyMsg);
    } finally {
      if (generationRef.current === currentGen) {
        setResending(false);
      }
    }
  };

  // Change Email Action: Clears all local recovery state cleanly
  const handleChangeEmail = () => {
    generationRef.current++;
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setErrorCode(null);
    setInfoMessage(null);
    setUncertainResult(false);
    setStep(1);
  };

  // STEP 3: Submit Final Password Reset to Backend
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setErrorCode(null);
    setUncertainResult(false);

    if (!isPasswordValid) {
      setError('Password must be at least 8 characters long and contain both letters and numbers.');
      return;
    }

    if (!isPasswordMatch) {
      setError('Password confirmation does not match.');
      return;
    }

    const cleanOtp = otp.trim().replace(/\D/g, '');
    if (cleanOtp.length !== 6) {
      setError('Please provide the full 6-digit verification code.');
      setStep(2);
      return;
    }

    const currentGen = ++generationRef.current;
    setLoading(true);

    try {
      const res = await authApi.resetPassword({
        email: email.trim().toLowerCase(),
        otp: cleanOtp,
        new_password: newPassword,
      });

      if (generationRef.current !== currentGen) return;

      if (res.success) {
        // Clear all sensitive fields from memory upon confirmed success
        setOtp('');
        setNewPassword('');
        setConfirmPassword('');
        toast.success('Password updated successfully.');
        setStep(4);
      } else {
        setError(res.message || 'Password reset could not be completed.');
      }
    } catch (err) {
      if (generationRef.current !== currentGen) return;

      const status = err.response?.status;
      const code = err.response?.data?.error?.code;
      const rawMsg = err.response?.data?.error?.message || err.message;

      // Detect network timeout or connection drop where backend might have committed
      const isNetworkError =
        !err.response ||
        err.code === 'ECONNABORTED' ||
        err.message?.includes('timeout') ||
        err.message?.includes('Network Error');

      if (isNetworkError) {
        setUncertainResult(true);
        setError(
          "We couldn't confirm the result due to a connection timeout. Your password may have been updated. Please try signing in with your new password, or request another code if needed."
        );
        toast.warning('Network interruption during password update.');
        return;
      }

      const friendlyMsg = mapRecoveryError(code, status, rawMsg);
      setError(friendlyMsg);
      setErrorCode(code);
      toast.error(friendlyMsg);

      // Route back to Step 2 for code correction if OTP was invalid, expired, or locked
      if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') {
        setStep(2);
      } else if (code === 'MAX_ATTEMPTS_EXCEEDED' || code === 'OTP_ALREADY_CONSUMED' || code === 'INVALID_REQUEST') {
        setOtp('');
        setStep(2);
      }
    } finally {
      if (generationRef.current === currentGen) {
        setLoading(false);
      }
    }
  };

  // Render Step Progress Markers (no premature "Code Verified" checkmarks)
  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-1 select-none" aria-label="Password Recovery Progress">
      {[
        { num: 1, label: 'Email' },
        { num: 2, label: 'Code' },
        { num: 3, label: 'Password' }
      ].map(({ num, label }) => {
        const isActive = step === num;
        const isPast = step > num;
        return (
          <div key={num} className="flex items-center gap-1.5">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                isActive
                  ? 'shadow-xs ring-2 ring-emerald-500/20'
                  : isPast
                  ? 'opacity-90'
                  : 'opacity-40'
              }`}
              style={{
                backgroundColor: isActive || isPast ? 'var(--brand-accent)' : 'var(--bg-input)',
                color: isActive || isPast ? 'var(--text-on-champagne)' : 'var(--text-muted)',
                border: '1px solid var(--border-default)',
              }}
              title={`Step ${num}: ${label}`}
            >
              {num === 1 && isPast ? <CheckCircle2 className="w-3.5 h-3.5" /> : num}
            </div>
            {num < 3 && (
              <div
                className="w-6 h-0.5 rounded-full"
                style={{
                  backgroundColor: step > num ? 'var(--brand-accent)' : 'var(--border-subtle)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );

  // Form Body according to current Step
  const renderFormContent = () => (
    <div className="flex flex-col gap-3.5 sm:gap-4 w-full">
      {/* Top Branding & Navigation */}
      <div className="flex flex-col items-center text-center">
        <Link to="/" aria-label="MilJor Home" className="mb-1">
          <Logo variant="monogram" size="lg" />
        </Link>

        {step < 4 && renderStepIndicator()}

        <h1
          className="font-display font-black text-xl sm:text-2xl tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          {step === 1 && 'Reset your password'}
          {step === 2 && 'Enter verification code'}
          {step === 3 && 'Set new password'}
          {step === 4 && 'Password successfully updated'}
        </h1>

        <p
          className="text-xs font-sans mt-0.5"
          style={{ color: 'var(--text-muted)' }}
        >
          {step === 1 && 'Enter your registered business email to receive an account recovery code.'}
          {step === 2 && `Enter the 6-digit code dispatched to ${email || 'your email'}.`}
          {step === 3 && 'Choose a strong new password for your MilJor procurement account.'}
          {step === 4 && 'Your credentials have been securely updated. You can now sign in.'}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div
          className="p-3 rounded-xl border flex items-start gap-2.5 text-xs animate-in fade-in duration-200"
          style={{
            backgroundColor: 'var(--status-danger-bg)',
            borderColor: 'var(--status-danger)',
            color: 'var(--status-danger)',
          }}
          role="alert"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block">
              {uncertainResult ? 'Connection Interruption' : 'Recovery Notice'}
            </span>
            <span className="mt-0.5 block leading-relaxed">{error}</span>
            {uncertainResult && (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/login')}
                  className="text-[11px] py-1 px-2.5 cursor-pointer"
                >
                  Try Signing In
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleChangeEmail}
                  className="text-[11px] py-1 px-2.5 cursor-pointer"
                >
                  Start Over
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Informational Notice */}
      {infoMessage && step === 2 && (
        <div
          className="p-3 rounded-xl border flex items-start gap-2 text-xs"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
          <div className="flex-1 text-[11px] leading-relaxed">
            <span>{infoMessage}</span>
            <p className="text-[10px] text-stone-400 mt-0.5">
              Codes expire after 10 minutes. Check your inbox and spam folder.
            </p>
          </div>
        </div>
      )}

      {/* STEP 1: Enter Business Email */}
      {step === 1 && (
        <form onSubmit={handleRequestCode} className="flex flex-col gap-3.5">
          <Input
            label="Registered Business Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="procurement@business.pk"
            icon={Mail}
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            disabled={loading}
            className="w-full mt-1 font-semibold shadow-xs justify-center cursor-pointer"
            style={{
              backgroundColor: 'var(--brand-accent)',
              color: 'var(--text-on-champagne)',
            }}
          >
            <span>Send Verification Code</span>
          </Button>

          <div className="pt-2 border-t flex justify-center" style={{ borderColor: 'var(--border-subtle)' }}>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </Link>
          </div>
        </form>
      )}

      {/* STEP 2: Enter Verification OTP */}
      {step === 2 && (
        <form onSubmit={handleProceedToPassword} className="flex flex-col gap-3.5">
          <div className="text-[11px] text-stone-600 dark:text-stone-300 bg-stone-50 dark:bg-stone-900/50 p-2.5 rounded-xl border border-stone-200 dark:border-stone-800 leading-relaxed flex items-start gap-2">
            <HelpCircle className="w-4 h-4 shrink-0 text-stone-400 mt-0.5" />
            <span>
              Enter the 6-digit code sent to your email. The code and your new password will be verified together upon final submission.
            </span>
          </div>

          <Input
            label="6-Digit Verification Code (OTP)"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => {
              const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
              setOtp(clean);
              if (error) setError(null);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
              setOtp(pasted);
              if (error) setError(null);
            }}
            placeholder="000000"
            icon={KeyRound}
            helperText="Preserves 6 digits including leading zeros. Valid for 10 minutes."
          />

          <div className="flex items-center justify-between text-xs pt-0.5">
            <button
              type="button"
              onClick={handleChangeEmail}
              className="text-[11px] text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline cursor-pointer"
            >
              Change email
            </button>
            <button
              type="button"
              onClick={handleResendOtp}
              disabled={resending || loading || cooldownSeconds > 0}
              className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: 'var(--brand-accent)' }}
              aria-label={cooldownSeconds > 0 ? `Resend code available in ${cooldownSeconds} seconds` : 'Resend verification code'}
            >
              <RefreshCw className={`w-3 h-3 ${resending ? 'animate-spin' : ''}`} />
              <span>
                {resending
                  ? 'Sending...'
                  : cooldownSeconds > 0
                  ? `Resend code in ${cooldownSeconds}s`
                  : 'Resend code'}
              </span>
            </button>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={otp.trim().length !== 6 || loading}
            className="w-full mt-1 font-semibold shadow-xs justify-center cursor-pointer"
            style={{
              backgroundColor: 'var(--brand-accent)',
              color: 'var(--text-on-champagne)',
            }}
          >
            <span>Continue</span>
          </Button>

          <div className="pt-2 border-t flex justify-center" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={handleChangeEmail}
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          </div>
        </form>
      )}

      {/* STEP 3: Enter and Confirm New Password */}
      {step === 3 && (
        <form onSubmit={handleResetPassword} className="flex flex-col gap-3">
          <PasswordField
            label="New Password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              if (error) setError(null);
            }}
            name="newPassword"
            id="newPassword"
            autoComplete="new-password"
            required={true}
            showStrength={true}
            confirmValue={confirmPassword}
          />

          <PasswordField
            label="Confirm New Password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              if (error) setError(null);
            }}
            name="confirmPassword"
            id="confirmPassword"
            placeholder="Re-enter your new password"
            autoComplete="new-password"
            required={true}
            showStrength={false}
            guidanceText=""
          />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={loading}
            disabled={loading || !isPasswordValid || !isPasswordMatch}
            className="w-full mt-1.5 font-semibold shadow-xs justify-center cursor-pointer"
            style={{
              backgroundColor: 'var(--brand-accent)',
              color: 'var(--text-on-champagne)',
            }}
          >
            <span>Update Password</span>
          </Button>

          <div className="pt-2 border-t flex justify-center" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setErrorCode(null);
                setStep(2);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline cursor-pointer"
              style={{ color: 'var(--text-secondary)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Code Entry</span>
            </button>
          </div>
        </form>
      )}

      {/* STEP 4: Success Confirmation */}
      {step === 4 && (
        <div className="flex flex-col items-center text-center gap-4 py-2">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center border shadow-xs"
            style={{
              backgroundColor: 'var(--status-success-bg)',
              borderColor: 'var(--brand-emerald)',
              color: 'var(--brand-emerald)',
            }}
          >
            <CheckCircle2 className="w-7 h-7" />
          </div>

          <div className="space-y-1">
            <h2 className="font-display font-bold text-lg" style={{ color: 'var(--text-primary)' }}>
              Password Reset Complete
            </h2>
            <p className="text-xs max-w-xs mx-auto" style={{ color: 'var(--text-muted)' }}>
              Your account password has been updated. You can now access your wholesale procurement dashboard.
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={() => navigate('/login')}
            className="w-full mt-2 font-semibold shadow-xs justify-center cursor-pointer"
            style={{
              backgroundColor: 'var(--brand-accent)',
              color: 'var(--text-on-champagne)',
            }}
          >
            <span>Sign In with New Password</span>
          </Button>
        </div>
      )}
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
          {renderFormContent()}
        </div>
      ) : (
        /* ENHANCED SPLIT LUXURY LAYOUT */
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
            {/* Left Dedicated Recovery Hero Panel */}
            {preferences.showBrandPanel && (
              <AuthHeroPanel
                pageType="forgot-password"
                showBackgroundImage={preferences.showBackgroundImage}
                className="lg:col-span-5 min-h-[300px] lg:min-h-[460px]"
              />
            )}

            {/* Right Form Panel */}
            <div
              className={`${
                preferences.showBrandPanel ? 'lg:col-span-7' : 'col-span-1'
              } p-6 sm:p-8 flex flex-col justify-center`}
            >
              {renderFormContent()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ForgotPasswordPage;
