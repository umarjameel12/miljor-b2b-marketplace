// =============================================================================
// src/components/auth/AuthHeroPanel.jsx
// MilJor Premium Authentication V2: Distinct Editorial Hero Panels
// Dedicated Sign-In vs Buyer/Supplier Registration Panels with Role-Specific
// Copy, Theme-Aware Typography, and Refined Warm Taupe-Champagne Contrast
// =============================================================================
import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import {
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  Layers,
  Scale,
  Sparkles,
  Building2,
  PackageCheck
} from 'lucide-react';

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
        heading: '#FBF8F1',
        supporting: '#E4EDE7',
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
        bg: '#DCC7A5',
        borderRight: '1px solid rgba(169, 133, 67, 0.32)',
        heading: '#242421',
        supporting: '#40392F',
        secondary: '#524B3E',
        accent: '#A98543',
        badgeBg: 'rgba(255, 255, 255, 0.45)',
        badgeBorder: 'rgba(169, 133, 67, 0.35)',
        badgeText: '#242421',
        benefitIconBg: 'rgba(169, 133, 67, 0.14)',
        benefitBorder: 'rgba(169, 133, 67, 0.22)',
        divider: 'rgba(169, 133, 67, 0.25)',
        imageOpacity: 0.52,
        imageBlend: 'multiply',
        imageOverlay: 'linear-gradient(180deg, rgba(220,199,165,0.58) 0%, rgba(212,189,153,0.80) 100%)',
      };

  // Distinct copy & benefits per page type and role
  let badgeLabel = 'B2B Wholesale Procurement';
  let heading = '';
  let supportingCopy = '';
  let benefits = [];

  if (pageType === 'signin') {
    badgeLabel = 'B2B Procurement Platform';
    heading = 'Welcome back to smarter procurement.';
    supportingCopy = 'Your purchasing, suppliers and wholesale opportunities — all in one place.';
    benefits = [
      {
        icon: CheckCircle2,
        title: 'Direct Mill Pricing',
        desc: 'Wholesale commodity rates unlocked through pooled demand.',
      },
      {
        icon: Building2,
        title: 'Verified Commercial Network',
        desc: 'Vetted food manufacturers, importers and certified distributors.',
      },
      {
        icon: ShieldCheck,
        title: 'Escrow Payment Protection',
        desc: 'Safepay sandbox escrow custody released upon delivery confirmation.',
      },
    ];
  } else if (pageType === 'register') {
    if (role === 'SUPPLIER') {
      badgeLabel = 'Supplier Network Registration';
      heading = 'Grow Your Business. Reach More Buyers.';
      supportingCopy =
        'Connect with business buyers, manage your product offerings and grow through organized procurement demand.';
      benefits = [
        {
          icon: Building2,
          title: 'Reach Business Buyers',
          desc: 'Access verified commercial kitchens and restaurants across Lahore.',
        },
        {
          icon: Scale,
          title: 'Manage Products and Inventory',
          desc: 'Maintain published catalog specifications, pricing tiers and batch stock.',
        },
        {
          icon: TrendingUp,
          title: 'Receive Organized Purchase Demand',
          desc: 'Predictable scheduled fulfillment with locked orders and escrow deposits.',
        },
      ];
    } else {
      // BUYER
      badgeLabel = 'Collective Buyer Registration';
      heading = 'Better buying power starts together.';
      supportingCopy =
        'Bring your purchasing needs together, discover trusted suppliers and unlock smarter wholesale opportunities.';
      benefits = [
        {
          icon: Layers,
          title: 'Collective Purchasing Power',
          desc: 'Aggregate wholesale volume with nearby kitchens for verified mill rates.',
        },
        {
          icon: ShieldCheck,
          title: 'Trusted Supplier Connections',
          desc: 'Procure directly from vetted mills, importers and authorized distributors.',
        },
        {
          icon: Sparkles,
          title: 'Smarter Procurement Decisions',
          desc: 'Transparent tier pricing, guaranteed fulfillment and escrow payment safety.',
        },
      ];
    }
  } else {
    // forgot-password
    badgeLabel = 'Account Security Verification';
    heading = 'Secure account recovery.';
    supportingCopy =
      'Verify your registered business email to reset your account password and restore access.';
    benefits = [
      {
        icon: ShieldCheck,
        title: 'Encrypted Verification Codes',
        desc: 'Single-use, time-limited cryptographic reset authorization.',
      },
      {
        icon: CheckCircle2,
        title: 'Immediate Session Invalidation',
        desc: 'Existing authentication tokens safely revoked on password change.',
      },
      {
        icon: Layers,
        title: 'Dedicated B2B Protection',
        desc: 'Enterprise-grade account defense for commercial buyers and suppliers.',
      },
    ];
  }

  return (
    <div
      className={`relative p-6 sm:p-8 lg:p-10 flex flex-col justify-between overflow-hidden transition-colors duration-300 ${className}`}
      style={{
        backgroundColor: colors.bg,
        borderRight: colors.borderRight,
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

      {/* Top Section: Refined Category Badge & Editorial Heading */}
      <div className="relative z-10 space-y-3.5">
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-sans font-semibold tracking-wide border shadow-2xs"
          style={{
            backgroundColor: colors.badgeBg,
            borderColor: colors.badgeBorder,
            color: colors.badgeText,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: colors.accent }}
          />
          <span>{badgeLabel}</span>
        </div>

        <div className="space-y-2">
          <h2
            className="font-display font-bold text-2xl sm:text-3xl tracking-tight leading-tight"
            style={{ color: colors.heading }}
          >
            {heading}
          </h2>

          <p
            className="text-xs sm:text-sm font-sans leading-relaxed"
            style={{ color: colors.supporting }}
          >
            {supportingCopy}
          </p>
        </div>
      </div>

      {/* Middle/Bottom Section: Visually Balanced Role-Specific Benefits */}
      <div
        className="relative z-10 space-y-3.5 pt-6 border-t mt-6 sm:mt-8"
        style={{ borderColor: colors.divider }}
      >
        <div className="space-y-3">
          {benefits.map((benefit, idx) => {
            const Icon = benefit.icon;
            return (
              <div
                key={idx}
                className="flex items-start gap-3 p-2.5 rounded-xl transition-colors"
                style={{
                  backgroundColor: isDark ? 'rgba(7, 42, 33, 0.40)' : 'rgba(255, 255, 255, 0.32)',
                  border: `1px solid ${colors.benefitBorder}`,
                }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{
                    backgroundColor: colors.benefitIconBg,
                    color: colors.accent,
                  }}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex flex-col space-y-0.5 text-xs font-sans">
                  <span
                    className="font-semibold text-xs leading-snug"
                    style={{ color: colors.heading }}
                  >
                    {benefit.title}
                  </span>
                  <span
                    className="text-[11px] leading-relaxed"
                    style={{ color: colors.secondary }}
                  >
                    {benefit.desc}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Monogram & Tagline */}
        <div className="pt-2 flex items-center justify-between text-[11px] font-sans">
          <span
            className="font-semibold tracking-wider uppercase text-[10px]"
            style={{ color: colors.accent }}
          >
            Mil Kar Khareedo, Behtar Pao.
          </span>
        </div>
      </div>
    </div>
  );
}

export default AuthHeroPanel;
