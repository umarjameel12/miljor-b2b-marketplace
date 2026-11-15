// =============================================================================
// src/components/auth/AuthHeroPanel.jsx
// MilJor Premium Authentication V2: Distinct Editorial Hero Panels
// Dedicated Sign-In vs Buyer/Supplier Registration Panels with Role-Specific
// Copy, Theme-Aware Typography, and Refined Warm Taupe-Champagne Contrast
// =============================================================================
import React from 'react';
import { useTheme } from '../../context/ThemeContext';

import signInHeroDark from '../../assets/hero/miljor-rice-hero-dark.png';
import signInHeroLight from '../../assets/hero/miljor-rice-hero-light.png';
import registerHeroImg from '../../assets/premium_rice_sack.jpg';

export function AuthHeroPanel({
  pageType = 'signin', // 'signin' | 'register' | 'forgot-password'
  role = 'BUYER', // 'BUYER' | 'SUPPLIER'
  showBackgroundImage = true,
  className = '',
}) {
  const { isDark } = useTheme();

  // Distinct image selection
  let heroImage = signInHeroDark;
  if (pageType === 'signin') {
    heroImage = isDark ? signInHeroDark : signInHeroLight;
  } else {
    heroImage = registerHeroImg;
  }

  // Theme-aware color tokens
  const colors = isDark
    ? {
        bg: '#072A21',
        borderRight: '1px solid rgba(200, 178, 118, 0.15)',
        heading: '#EAD5A6',
        supporting: '#D4C5A8',
        secondary: '#C8D4CD',
        accent: '#C8B276',
        badgeBg: 'rgba(7, 42, 33, 0.65)',
        badgeBorder: 'rgba(200, 178, 118, 0.25)',
        badgeText: '#E6DFD3',
        benefitIconBg: 'rgba(200, 178, 118, 0.12)',
        benefitBorder: 'rgba(200, 178, 118, 0.16)',
        divider: 'rgba(200, 178, 118, 0.20)',
        imageOpacity: 0.38,
        imageBlend: 'luminosity',
        imageOverlay: 'linear-gradient(180deg, rgba(7,42,33,0.78) 0%, rgba(5,37,29,0.92) 100%)',
      }
    : {
        bg: '#EADDC7',
        borderRight: '1px solid rgba(169, 133, 67, 0.25)',
        heading: '#735124',
        supporting: '#675540',
        secondary: '#4A443A',
        accent: '#967434',
        badgeBg: 'rgba(255, 255, 255, 0.65)',
        badgeBorder: 'rgba(169, 133, 67, 0.30)',
        badgeText: '#1C1C19',
        benefitIconBg: 'rgba(169, 133, 67, 0.12)',
        benefitBorder: 'rgba(169, 133, 67, 0.18)',
        divider: 'rgba(169, 133, 67, 0.20)',
        imageOpacity: 0.36,
        imageBlend: 'multiply',
        imageOverlay: 'linear-gradient(180deg, rgba(246,240,230,0.69) 0%, rgba(234,221,199,0.81) 100%)',
      };

  // Minimal, role-aware copy; original illustration and theme colors stay unchanged.
  const heading = pageType === 'signin'
    ? 'Welcome back'
    : pageType === 'forgot-password'
    ? 'Welcome to MilJor'
    : role === 'SUPPLIER'
    ? 'Grow with MilJor'
    : 'Buy better, together';

  const supportingCopy = pageType === 'signin'
    ? 'Everything you need to manage procurement.'
    : pageType === 'forgot-password'
    ? 'Securely recover your account.'
    : role === 'SUPPLIER'
    ? 'Connect with buyers and manage orders.'
    : 'Discover suppliers and better prices.';

  const isCompactTopHero = pageType === 'signin' || pageType === 'forgot-password';

  const highlights = pageType !== 'register'
    ? []
    : role === 'SUPPLIER'
    ? ['Reach business buyers', 'Manage products and orders']
    : ['Find trusted suppliers', 'Unlock wholesale prices'];

  return (
    <div
      className={`relative p-4 sm:p-6 lg:p-6 xl:p-8 flex flex-col justify-between overflow-hidden transition-colors duration-300 ${className}`}
      style={{
        backgroundColor: colors.bg,
        borderRight: colors.borderRight,
        boxShadow: isDark ? 'inset 0 0 0 1px rgba(200, 178, 118, 0.14)' : 'inset 0 0 0 1px rgba(150, 116, 52, 0.20)',
      }}
    >
      {/* Background Hero Layer */}
      {showBackgroundImage && (
        <div className="absolute inset-0 z-0 pointer-events-none select-none">
          <img
            src={heroImage}
            alt="MilJor Commodity Procurement"
            className="w-full h-full object-cover object-center transition-transform duration-700 scale-102"
            style={{
              opacity: colors.imageOpacity,
              mixBlendMode: colors.imageBlend,
            }}
          />
          {/* Subtle gradient overlay tuned specifically for light vs dark */}
          <div
            className="absolute inset-0"
            style={{
              background: colors.imageOverlay,
            }}
          />
        </div>
      )}

      <div className={`relative z-10 flex flex-1 flex-col gap-3 ${isCompactTopHero ? "justify-start pt-2 sm:pt-3" : "justify-center"}`}>
        <h2 className="auth-heading text-2xl sm:text-[27px] leading-tight" style={{ color: colors.heading }}>
          {heading}
        </h2>
        <p className="text-xs sm:text-sm font-sans leading-relaxed max-w-xs" style={{ color: colors.supporting }}>
          {supportingCopy}
        </p>
        {highlights.length > 0 && (
          <div className="flex flex-col gap-2 pt-3 mt-2 border-t" style={{ borderColor: colors.divider }}>
            {highlights.map((item) => (
              <div key={item} className="flex items-center gap-2.5 text-xs font-medium" style={{ color: colors.heading }}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colors.accent }} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Original tagline: centered, gold, uppercase and bottom-aligned. */}
      <div className="relative z-10 pt-2 flex items-center justify-center text-center text-[11px] font-sans">
        <span className="font-semibold tracking-widest uppercase text-[10px]" style={{ color: colors.accent }}>
          Mil Kar Khareedo, Behtar Pao.
        </span>
      </div>
    </div>
  );
}

export default AuthHeroPanel;
