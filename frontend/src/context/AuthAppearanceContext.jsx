// =============================================================================
// src/context/AuthAppearanceContext.jsx
// MilJor Package D: Reversible Auth Appearance Customization
// Supports independent toggles for background, heading, tagline, brand panel,
// and Enhanced vs Original presentation modes with safe localStorage persistence.
// =============================================================================
import React, { createContext, useContext, useState, useEffect } from 'react';

const STORAGE_KEY = 'miljor_auth_appearance';

export const DEFAULT_AUTH_APPEARANCE = {
  showBackgroundImage: true,
  showBrandHeading: true,
  showTagline: true,
  showBrandPanel: true,
  layoutStyle: 'enhanced', // 'enhanced' or 'original'
};

const AuthAppearanceContext = createContext(null);

export const AuthAppearanceProvider = ({ children }) => {
  const [preferences, setPreferences] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          showBackgroundImage: typeof parsed.showBackgroundImage === 'boolean' ? parsed.showBackgroundImage : DEFAULT_AUTH_APPEARANCE.showBackgroundImage,
          showBrandHeading: typeof parsed.showBrandHeading === 'boolean' ? parsed.showBrandHeading : DEFAULT_AUTH_APPEARANCE.showBrandHeading,
          showTagline: typeof parsed.showTagline === 'boolean' ? parsed.showTagline : DEFAULT_AUTH_APPEARANCE.showTagline,
          showBrandPanel: typeof parsed.showBrandPanel === 'boolean' ? parsed.showBrandPanel : DEFAULT_AUTH_APPEARANCE.showBrandPanel,
          layoutStyle: parsed.layoutStyle === 'original' ? 'original' : 'enhanced',
        };
      }
    } catch {
      // Safe fallback if parsing fails
    }
    return DEFAULT_AUTH_APPEARANCE;
  });

  const updatePreference = (key, value) => {
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Safe handling of storage errors
      }
      return updated;
    });
  };

  const resetDefaults = () => {
    setPreferences(DEFAULT_AUTH_APPEARANCE);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_AUTH_APPEARANCE));
    } catch {
      // Safe handling of storage errors
    }
  };

  return (
    <AuthAppearanceContext.Provider value={{ preferences, updatePreference, resetDefaults }}>
      {children}
    </AuthAppearanceContext.Provider>
  );
};

export const useAuthAppearance = () => {
  const context = useContext(AuthAppearanceContext);
  if (!context) {
    return {
      preferences: DEFAULT_AUTH_APPEARANCE,
      updatePreference: () => {},
      resetDefaults: () => {}
    };
  }
  return context;
};
