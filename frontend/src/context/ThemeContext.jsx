import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

export const THEME_MODES = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
};

/**
 * Resolves current theme given preference ('system' | 'light' | 'dark')
 * @param {string} pref
 * @returns {'light'|'dark'}
 */
const getSystemTheme = () => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getInitialThemePreference = () => {
  if (typeof window === 'undefined') return THEME_MODES.SYSTEM;
  try {
    const params = new URLSearchParams(window.location.search);
    const themeParam = params.get('theme');
    if (themeParam && [THEME_MODES.SYSTEM, THEME_MODES.LIGHT, THEME_MODES.DARK].includes(themeParam)) {
      return themeParam;
    }
  } catch (e) {}
  return localStorage.getItem('miljor_theme') || THEME_MODES.SYSTEM;
};

export const ThemeProvider = ({ children }) => {
  const [theme, setThemeState] = useState(getInitialThemePreference);

  const [resolvedTheme, setResolvedTheme] = useState(() => {
    const initialPref = getInitialThemePreference();
    if (initialPref === THEME_MODES.DARK) return 'dark';
    if (initialPref === THEME_MODES.LIGHT) return 'light';
    return getSystemTheme();
  });

  // Apply theme to <html> document root and listen for OS changes
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (currentTheme) => {
      let effective = currentTheme;
      if (currentTheme === THEME_MODES.SYSTEM) {
        effective = getSystemTheme();
      }

      setResolvedTheme(effective);

      if (effective === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    applyTheme(theme);

    // If 'system', attach real-time listener for OS color scheme transitions
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = (e) => {
      if (theme === THEME_MODES.SYSTEM) {
        const newEffective = e.matches ? 'dark' : 'light';
        setResolvedTheme(newEffective);
        if (newEffective === 'dark') {
          root.classList.add('dark');
        } else {
          root.classList.remove('dark');
        }
      }
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
  }, [theme]);

  // Setter function persisting to localStorage
  const setTheme = (newTheme) => {
    if (!Object.values(THEME_MODES).includes(newTheme)) return;
    setThemeState(newTheme);
    try {
      localStorage.setItem('miljor_theme', newTheme);
    } catch {
      // Ignore localStorage write failure in restricted iframe/browser modes
    }
  };

  const toggleTheme = () => {
    if (theme === THEME_MODES.SYSTEM) setTheme(THEME_MODES.LIGHT);
    else if (theme === THEME_MODES.LIGHT) setTheme(THEME_MODES.DARK);
    else setTheme(THEME_MODES.SYSTEM);
  };

  const value = {
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    isDark: resolvedTheme === 'dark',
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};

export default ThemeProvider;
