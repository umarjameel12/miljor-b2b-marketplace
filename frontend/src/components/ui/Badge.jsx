import React from 'react';

export const Badge = ({
  children,
  variant = 'neutral',
  size = 'md',
  icon: Icon,
  className = '',
  ...props
}) => {
  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  };

  const variantStyles = {
    neutral: {
      backgroundColor: 'var(--bg-elevated)',
      color: 'var(--text-secondary)',
      border: '1px solid var(--border-subtle)',
    },
    emerald: {
      backgroundColor: 'rgba(11, 46, 38, 0.1)',
      color: 'var(--brand-primary)',
      border: '1px solid rgba(11, 46, 38, 0.15)',
    },
    accent: {
      backgroundColor: 'var(--brand-accent-soft)',
      color: 'var(--brand-accent-hover)',
      border: '1px solid rgba(201, 166, 107, 0.25)',
    },
    success: {
      backgroundColor: 'var(--status-success-bg)',
      color: 'var(--status-success)',
      border: '1px solid rgba(21, 102, 73, 0.2)',
    },
    warning: {
      backgroundColor: 'var(--status-warning-bg)',
      color: 'var(--status-warning)',
      border: '1px solid rgba(158, 100, 23, 0.2)',
    },
    danger: {
      backgroundColor: 'var(--status-danger-bg)',
      color: 'var(--status-danger)',
      border: '1px solid rgba(163, 34, 34, 0.2)',
    },
  };

  const style = variantStyles[variant] || variantStyles.neutral;

  return (
    <span
      style={style}
      className={`inline-flex items-center font-sans font-semibold rounded-full tracking-wide transition-colors ${
        sizeClasses[size] || sizeClasses.md
      } ${className}`}
      {...props}
    >
      {Icon && <Icon className="w-3 h-3 shrink-0" />}
      <span>{children}</span>
    </span>
  );
};

export default Badge;
