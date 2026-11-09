import React, { useState, useId, forwardRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export const Input = forwardRef(({
  label,
  error,
  helperText,
  id,
  type = 'text',
  className = '',
  icon: Icon,
  required = false,
  ...props
}, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const reactGeneratedId = useId();
  const inputId = id || props.name || reactGeneratedId;
  const isPassword = type === 'password';
  const effectiveType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-semibold tracking-wide flex items-center justify-between"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span>
            {label}
            {required && <span className="text-amber-600 dark:text-amber-400 ml-1">*</span>}
          </span>
        </label>
      )}

      <div className="relative flex items-center">
        {Icon && (
          <div
            className="absolute left-3.5 z-10 pointer-events-none flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}

        <input
          ref={ref}
          id={inputId}
          type={effectiveType}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          style={{
            backgroundColor: 'var(--bg-input)',
            borderColor: error ? 'var(--status-danger)' : 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
          className={`w-full h-10 text-sm rounded-xl border transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--brand-accent)] focus:border-transparent ${
            Icon ? 'pl-10' : 'pl-3.5'
          } ${isPassword ? 'pr-10' : 'pr-3.5'}`}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute right-3 p-1 rounded-md text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>

      {error ? (
        <p
          id={`${inputId}-error`}
          className="text-xs font-medium"
          style={{ color: 'var(--status-danger)' }}
          role="alert"
        >
          {error}
        </p>
      ) : helperText ? (
        <p
          id={`${inputId}-helper`}
          className="text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          {helperText}
        </p>
      ) : null}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;
