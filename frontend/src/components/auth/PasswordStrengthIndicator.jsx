// =============================================================================
// src/components/auth/PasswordStrengthIndicator.jsx
// MilJor Premium Authentication UX: Real-Time Password Checklist & Strength
// Evaluates length, diversity, and common predictability without external deps
// =============================================================================
import React from 'react';
import { Check, X } from 'lucide-react';

/**
 * Calculates password strength score (0 to 3)
 * @param {string} password
 * @returns {{ score: number, label: 'WEAK' | 'FAIR' | 'STRONG', color: string }}
 */
export function calculatePasswordStrength(password) {
  if (!password) {
    return { score: 0, label: 'WEAK', color: 'var(--status-danger)' };
  }

  let score = 0;
  const length = password.length;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const hasMixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);

  // Repetition check (e.g. 'aaaa', '1111')
  const hasRepeated = /(.)\1{3,}/.test(password);

  // Baseline requirement: 8+ chars, letters and numbers
  if (length >= 8 && hasLetter && hasNumber) {
    score = 1; // Base FAIR
  }

  if (score >= 1) {
    // Increment for depth
    if (length >= 10 && (hasMixedCase || hasSpecial)) {
      score = 2; // STRONG
    }
    if (length >= 12 && hasSpecial && hasMixedCase && !hasRepeated) {
      score = 3; // VERY STRONG
    }
  }

  if (score === 0) {
    return { score: 0, label: 'WEAK', color: 'var(--status-danger)' };
  }
  if (score === 1) {
    return { score: 1, label: 'FAIR', color: '#c89528' };
  }
  return { score: 2, label: 'STRONG', color: 'var(--brand-emerald)' };
}

export function PasswordStrengthIndicator({
  password = '',
  confirmPassword = null,
  showChecklist = true,
}) {
  const isLengthValid = password.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const isMatch = confirmPassword !== null ? (password === confirmPassword && password.length > 0) : null;

  const { score, label } = calculatePasswordStrength(password);

  if (!password && confirmPassword === null) return null;

  return (
    <div className="space-y-2 pt-1 select-none animate-in fade-in duration-150">
      {/* Visual Bar Indicator */}
      {password.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-sans">
            <span style={{ color: 'var(--text-muted)' }}>Password Strength</span>
            <span
              className="font-semibold tracking-wider text-[10px]"
              style={{
                color: score === 0 ? 'var(--status-danger)' : score === 1 ? '#c89528' : 'var(--brand-emerald)',
              }}
            >
              {label}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1.5 h-1">
            <div
              className="h-full rounded-full transition-colors duration-200"
              style={{
                backgroundColor: password.length > 0 ? (score === 0 ? 'var(--status-danger)' : score === 1 ? '#c89528' : 'var(--brand-emerald)') : 'var(--border-subtle)',
              }}
            />
            <div
              className="h-full rounded-full transition-colors duration-200"
              style={{
                backgroundColor: score >= 1 ? (score === 1 ? '#c89528' : 'var(--brand-emerald)') : 'rgba(150, 150, 150, 0.2)',
              }}
            />
            <div
              className="h-full rounded-full transition-colors duration-200"
              style={{
                backgroundColor: score >= 2 ? 'var(--brand-emerald)' : 'rgba(150, 150, 150, 0.2)',
              }}
            />
          </div>
        </div>
      )}

      {/* Live Requirement Checklist */}
      {showChecklist && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] font-sans pt-0.5">
          <div className="flex items-center gap-1.5">
            {isLengthValid ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-stone-400">•</span>
            )}
            <span style={{ color: isLengthValid ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              8+ characters
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {hasLetter ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-stone-400">•</span>
            )}
            <span style={{ color: hasLetter ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              Contains letters
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {hasNumber ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <span className="w-3.5 h-3.5 flex items-center justify-center text-stone-400">•</span>
            )}
            <span style={{ color: hasNumber ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              Contains numbers
            </span>
          </div>

          {confirmPassword !== null && (
            <div className="flex items-center gap-1.5">
              {isMatch ? (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : confirmPassword.length > 0 ? (
                <X className="w-3.5 h-3.5 text-red-500 shrink-0" />
              ) : (
                <span className="w-3.5 h-3.5 flex items-center justify-center text-stone-400">•</span>
              )}
              <span
                style={{
                  color: isMatch
                    ? 'var(--text-primary)'
                    : confirmPassword.length > 0
                    ? 'var(--status-danger)'
                    : 'var(--text-muted)',
                }}
              >
                Passwords match
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PasswordStrengthIndicator;
