// =============================================================================
// src/components/auth/PasswordField.jsx
// MilJor Premium Authentication UX: Password Input with Live Strength Feedback
// =============================================================================
import React from 'react';
import { Input } from '../ui/Input';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';
import { Lock } from 'lucide-react';

export function PasswordField({
  label = 'Password',
  value = '',
  onChange,
  name = 'password',
  id = 'password',
  placeholder = 'At least 8 characters with letters & numbers',
  required = true,
  autoComplete = 'current-password',
  showStrength = false,
  confirmValue = null,
  error = null,
  helperText = null,
  guidanceText = '',
}) {
  return (
    <div className="space-y-1.5">
      <Input
        label={label}
        type="password"
        name={name}
        id={id}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        icon={Lock}
        required={required}
        error={error}
        helperText={!showStrength && helperText ? helperText : undefined}
      />

      {showStrength && (
        <div className="space-y-1.5 pt-0.5">
          {guidanceText && (
            <p className="text-[11px] font-sans" style={{ color: 'var(--text-muted)' }}>
              {guidanceText}
            </p>
          )}
          <PasswordStrengthIndicator
            password={value}
            confirmPassword={confirmValue}
            showChecklist={true}
          />
        </div>
      )}
    </div>
  );
}

export default PasswordField;
