import React from 'react';

export const Card = ({
  children,
  className = '',
  hoverEffect = false,
  as: Component = 'div',
  ...props
}) => {
  return (
    <Component
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
      }}
      className={`rounded-2xl border transition-all duration-200 ${
        hoverEffect ? 'hover:border-[var(--brand-accent)] hover:-translate-y-0.5' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
};

export const CardHeader = ({ children, className = '', ...props }) => (
  <div className={`p-5 sm:p-6 pb-3 ${className}`} {...props}>
    {children}
  </div>
);

export const CardTitle = ({ children, className = '', as: Component = 'h3', ...props }) => (
  <Component
    className={`font-display font-bold text-lg tracking-tight ${className}`}
    style={{ color: 'var(--text-primary)' }}
    {...props}
  >
    {children}
  </Component>
);

export const CardDescription = ({ children, className = '', ...props }) => (
  <p
    className={`text-xs sm:text-sm mt-1 leading-relaxed ${className}`}
    style={{ color: 'var(--text-secondary)' }}
    {...props}
  >
    {children}
  </p>
);

export const CardContent = ({ children, className = '', ...props }) => (
  <div className={`p-5 sm:p-6 pt-0 ${className}`} {...props}>
    {children}
  </div>
);

export const CardFooter = ({ children, className = '', ...props }) => (
  <div
    style={{ borderColor: 'var(--border-subtle)' }}
    className={`p-5 sm:p-6 border-t flex items-center justify-between ${className}`}
    {...props}
  >
    {children}
  </div>
);

export default Card;
