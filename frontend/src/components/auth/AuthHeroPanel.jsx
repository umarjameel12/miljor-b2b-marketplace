// =============================================================================
// src/components/auth/AuthHeroPanel.jsx
// MilJor Premium Authentication V2: Distinct Editorial Hero Panels
// Dedicated Sign-In vs Registration Hero Visuals & Copy, Light/Dark Awareness,
// and Nationwide Brand Positioning (Launching First in Lahore)
// =============================================================================
import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { ShieldCheck, CheckCircle2, TrendingUp, Layers, Scale, Sparkles, Building2 } from 'lucide-react';

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

  // Distinct copy & value props per page type
  let heading = '';
  let supportingCopy = '';
  let subDescription = '';
  let valueProps = [];

  if (pageType === 'signin') {
    heading = 'Welcome back to smarter procurement.';
    supportingCopy = 'Your purchasing, suppliers and wholesale opportunities — all in one place.';
    subDescription = 'Direct mill pricing and pooled volume procurement for commercial food businesses.';
    valueProps = [
      { icon: CheckCircle2, text: 'Direct Mill Pricing via Pooled Volume' },
      { icon: Layers, text: '12 Active Lahore Delivery Clusters' },
      { icon: TrendingUp, text: 'Zero Delivery Fee Commission' },
    ];
  } else if (pageType === 'register') {
    heading = 'Better buying power starts together.';
    supportingCopy = 'Join MilJor as we begin connecting businesses in Lahore — with a vision to grow across Pakistan.';
    subDescription =
      role === 'SUPPLIER'
        ? 'Consolidate restaurant demand and reach commercial buyers across Lahore with zero listing commissions.'
        : 'Pool wholesale commodity demand with nearby kitchens and restaurants for guaranteed mill prices.';
    valueProps = [
      { icon: Scale, text: '16 Standardized Lahore Commodity Specs' },
      { icon: Building2, text: 'Verified Mills & Commercial Kitchens' },
      { icon: ShieldCheck, text: 'Clustered Delivery or Depot Pickup' },
    ];
  } else {
    // forgot-password
    heading = 'Secure account recovery.';
    supportingCopy = 'Verify your registered business email to reset your account password and restore access.';
    subDescription = 'Your procurement orders, pool reservations, and supplier records remain safe.';
    valueProps = [
      { icon: ShieldCheck, text: 'Encrypted Single-Use Verification Codes' },
      { icon: CheckCircle2, text: 'Immediate Password Invalidation' },
      { icon: Layers, text: 'Dedicated B2B Account Protection' },
    ];
  }

  return (
    <div
      className={`relative p-6 sm:p-8 lg:p-10 flex flex-col justify-between overflow-hidden transition-colors duration-300 ${className}`}
      style={{
        backgroundColor: isDark ? '#072A21' : '#f4eee3',
        color: isDark ? '#f7f3e8' : '#0c2b24',
        borderRight: isDark ? '1px solid rgba(200, 178, 118, 0.15)' : '1px solid var(--border-default)',
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
              opacity: isDark ? 0.38 : 0.28,
              mixBlendMode: isDark ? 'luminosity' : 'multiply',
            }}
          />
          {/* Subtle gradient overlay tuned specifically for light vs dark */}
          <div
            className="absolute inset-0"
            style={{
              background: isDark
                ? 'linear-gradient(180deg, rgba(7,42,33,0.75) 0%, rgba(5,37,29,0.92) 100%)'
                : 'linear-gradient(180deg, rgba(247,243,232,0.78) 0%, rgba(243,237,225,0.92) 100%)',
            }}
          />
        </div>
      )}

      {/* Top Section: Nationwide Brand Badge & Editorial Heading */}
      <div className="relative z-10 space-y-3">
        {/* Nationwide Positioning Marker with Lahore Launch Market Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-sans font-semibold tracking-wide border shadow-xs">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: 'var(--brand-accent)' }}
          />
          <span style={{ color: isDark ? '#e6dfd3' : 'var(--text-forest)' }}>
            Built for Pakistan · Launching first in Lahore
          </span>
        </div>

        <div className="space-y-1.5 pt-1">
          <h2
            className="font-display font-bold text-2xl sm:text-3xl tracking-tight leading-tight"
            style={{ color: isDark ? '#fbf8f1' : 'var(--text-primary)' }}
          >
            {heading}
          </h2>

          <p
            className="text-xs sm:text-sm font-sans leading-relaxed"
            style={{ color: isDark ? '#c8d4cd' : 'var(--text-secondary)' }}
          >
            {supportingCopy}
          </p>
        </div>

        {subDescription && (
          <p
            className="text-xs font-sans leading-relaxed pt-1"
            style={{ color: isDark ? '#95a89e' : 'var(--text-muted)' }}
          >
            {subDescription}
          </p>
        )}
      </div>

      {/* Bottom Section: Clean Editorial Value Props & Tagline */}
      <div
        className="relative z-10 space-y-3 pt-6 border-t mt-6 sm:mt-8"
        style={{ borderColor: isDark ? 'rgba(200, 178, 118, 0.22)' : 'var(--border-default)' }}
      >
        <div className="space-y-2">
          {valueProps.map((item, idx) => {
            const Icon = item.icon;
            return (
              <div key={idx} className="flex items-center gap-2.5 text-xs font-sans">
                <Icon
                  className="w-4 h-4 shrink-0"
                  style={{ color: 'var(--brand-accent)' }}
                />
                <span
                  className="font-medium"
                  style={{ color: isDark ? '#e4ede7' : 'var(--text-primary)' }}
                >
                  {item.text}
                </span>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex items-center justify-between text-[11px] font-sans">
          <span
            className="font-semibold tracking-wider uppercase text-[10px]"
            style={{ color: 'var(--brand-accent)' }}
          >
            Mil Kar Khareedo, Behtar Pao.
          </span>
          <span style={{ color: isDark ? '#82958b' : 'var(--text-muted)' }}>
            B2B Food Platform
          </span>
        </div>
      </div>
    </div>
  );
}

export default AuthHeroPanel;
