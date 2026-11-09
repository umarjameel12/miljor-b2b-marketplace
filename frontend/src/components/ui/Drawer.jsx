import React, { useEffect } from 'react';
import { Logo } from './Logo';
import { useTheme } from '../../context/ThemeContext';

export const Drawer = ({
  isOpen,
  onClose,
  title,
  children,
  side = 'left',
  className = '',
}) => {
  const { isDark } = useTheme();
  // Escape key listener to close drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isLeft = side === 'left';

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Navigation Drawer'}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 transition-opacity bg-black/50 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel — Respects side prop (Left or Right) */}
      <div
        style={{
          backgroundColor: 'var(--bg-sidebar)',
          borderColor: 'var(--border-sidebar, var(--border-subtle))',
          boxShadow: isDark
            ? '4px 0 24px rgba(0, 0, 0, 0.5), 1px 0 0 0 rgba(200, 178, 118, 0.35)'
            : '4px 0 20px rgba(12, 43, 36, 0.08), 1px 0 0 0 rgba(190, 170, 135, 0.45)',
        }}
        className={`relative z-10 w-full max-w-[290px] sm:max-w-xs h-full flex flex-col ${
          isLeft ? 'mr-auto border-r' : 'ml-auto border-l'
        } shadow-2xl transition-transform duration-300 ease-in-out ${className}`}
      >
        {/* Drawer Header: MilJor Monogram Logo replaces Cross Icon. Clicking Logo closes drawer! */}
        <div
          style={{ borderColor: 'var(--border-sidebar, var(--border-subtle))' }}
          className="h-14 sm:h-16 px-4 border-b flex items-center justify-between"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation drawer"
            title="Click MilJor Monogram to close"
            className="flex items-center justify-center p-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] cursor-pointer transition-transform hover:opacity-90 active:scale-95"
          >
            <Logo size="sm" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
};

export default Drawer;
