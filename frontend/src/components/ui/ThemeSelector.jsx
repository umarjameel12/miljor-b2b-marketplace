import React, { useState, useRef, useEffect } from 'react';
import { useTheme, THEME_MODES } from '../../context/ThemeContext';
import { Sun, Moon, Monitor } from 'lucide-react';

export const ThemeSelector = ({ compact = false, minimal = false, className = '' }) => {
  const { theme, setTheme, isDark } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const options = [
    { mode: THEME_MODES.SYSTEM, label: 'System', icon: Monitor },
    { mode: THEME_MODES.LIGHT, label: 'Light', icon: Sun },
    { mode: THEME_MODES.DARK, label: 'Dark', icon: Moon },
  ];

  const currentOption = options.find((opt) => opt.mode === theme) || options[0];
  const CurrentIcon = currentOption.icon;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  // Minimal mode: Single discrete button with compact dropdown for public navbar
  if (minimal) {
    return (
      <div className={`relative inline-block ${className}`} ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          aria-label={`Theme setting: currently ${currentOption.label}`}
          aria-haspopup="true"
          aria-expanded={dropdownOpen}
          className="w-9 h-9 flex items-center justify-center rounded-xl border transition-all duration-200 cursor-pointer shadow-xs hover:border-[var(--brand-gold)] active:scale-95"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <CurrentIcon className="w-4 h-4 text-[#c89528] dark:text-[#dfcca9]" />
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 mt-2 w-40 rounded-2xl border p-1.5 shadow-xl z-50 animate-fade-in space-y-1"
            style={{
              backgroundColor: isDark ? '#072a21' : '#fcfbf7',
              borderColor: isDark ? 'rgba(200, 178, 118, 0.28)' : 'rgba(169, 133, 67, 0.25)',
              boxShadow: isDark
                ? '0 12px 30px -4px rgba(0, 0, 0, 0.70)'
                : '0 12px 30px -4px rgba(12, 43, 36, 0.12)',
            }}
            role="menu"
            aria-label="Select theme"
          >
            {options.map(({ mode, label, icon: Icon }) => {
              const isSelected = theme === mode;
              const activeBg = isDark ? 'rgba(200, 178, 118, 0.16)' : 'rgba(200, 178, 118, 0.18)';
              const activeBorder = isDark
                ? '1px solid rgba(200, 178, 118, 0.35)'
                : '1px solid rgba(169, 133, 67, 0.35)';
              const activeText = isDark ? '#f7f3e8' : '#0c2b24';
              const activeIcon = isDark ? '#dfcca9' : '#967434';

              const inactiveText = isDark ? '#c8d3cf' : '#2e3d36';
              const inactiveIcon = isDark ? '#8a9e97' : '#57635a';

              return (
                <button
                  key={mode}
                  onClick={() => {
                    setTheme(mode);
                    setDropdownOpen(false);
                  }}
                  role="menuitem"
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-sans rounded-xl transition-all duration-150 cursor-pointer ${
                    isSelected
                      ? 'font-semibold shadow-xs'
                      : isDark
                      ? 'font-medium hover:bg-white/5'
                      : 'font-medium hover:bg-[rgba(169,133,67,0.08)]'
                  }`}
                  style={{
                    backgroundColor: isSelected ? activeBg : 'transparent',
                    color: isSelected ? activeText : inactiveText,
                    border: isSelected ? activeBorder : '1px solid transparent',
                  }}
                >
                  <Icon
                    className="w-3.5 h-3.5 shrink-0 transition-colors"
                    style={{ color: isSelected ? activeIcon : inactiveIcon }}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Compact mode: Accessible pill toggle
  if (compact) {
    return (
      <div
        className={`inline-flex items-center p-1 rounded-full border transition-colors ${className}`}
        style={{
          backgroundColor: 'var(--bg-subtle)',
          borderColor: 'var(--border-subtle)',
        }}
        role="radiogroup"
        aria-label="Theme preference"
      >
        {options.map(({ mode, label, icon: Icon }) => {
          const isActive = theme === mode;
          return (
            <button
              key={mode}
              onClick={() => setTheme(mode)}
              role="radio"
              aria-checked={isActive}
              aria-label={`${label} theme`}
              className={`p-1.5 rounded-full transition-all duration-150 ${
                isActive
                  ? 'shadow-xs font-medium text-emerald-950 dark:text-champagne-light'
                  : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
              style={{
                backgroundColor: isActive ? 'var(--bg-surface)' : 'transparent',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
    );
  }

  // Full segmented mode (Used in Drawer & Settings)
  return (
    <div
      className={`inline-flex items-center p-1 rounded-xl border transition-colors ${className}`}
      style={{
        backgroundColor: 'var(--bg-subtle)',
        borderColor: 'var(--border-subtle)',
      }}
      role="radiogroup"
      aria-label="Theme preference"
    >
      {options.map(({ mode, label, icon: Icon }) => {
        const isActive = theme === mode;
        return (
          <button
            key={mode}
            onClick={() => setTheme(mode)}
            role="radio"
            aria-checked={isActive}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all duration-150 ${
              isActive
                ? 'shadow-xs font-semibold'
                : 'font-medium hover:opacity-80'
            }`}
            style={{
              backgroundColor: isActive ? 'var(--bg-surface)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ThemeSelector;
