// =============================================================================
// src/components/auth/AuthAppearanceControl.jsx
// MilJor Package D: Unobtrusive Native Appearance Control Popover
// Allows users to toggle decorative elements or revert to original layout
// =============================================================================
import React, { useState, useRef, useEffect } from 'react';
import { Sliders, RotateCcw, X, Image, Type, Quote, Layout } from 'lucide-react';
import { useAuthAppearance } from '../../context/AuthAppearanceContext';

export function AuthAppearanceControl() {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);
  const { preferences, updatePreference, resetDefaults } = useAuthAppearance();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="fixed bottom-4 right-4 z-50 select-none" ref={popoverRef}>
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title="Customize Auth Appearance"
          aria-label="Customize Auth Appearance"
          className="p-2.5 rounded-full border shadow-lg transition-all duration-200 hover:scale-105 flex items-center gap-2 text-xs font-semibold cursor-pointer"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          <Sliders className="w-4 h-4 text-[var(--brand-accent)]" />
          <span className="hidden sm:inline">Appearance</span>
        </button>
      ) : (
        <div
          className="w-72 p-4 rounded-2xl border shadow-2xl space-y-3.5 animate-in fade-in zoom-in-95 duration-150"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-primary)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-[var(--brand-accent)]" />
              <span className="font-sans font-bold text-xs uppercase tracking-wider">Auth Appearance</span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 1. Layout Mode Switch */}
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-stone-500 block">Layout Presentation</span>
            <div
              className="grid grid-cols-2 p-1 rounded-xl border text-xs font-semibold"
              style={{
                backgroundColor: 'var(--bg-input)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <button
                type="button"
                onClick={() => updatePreference('layoutStyle', 'enhanced')}
                className={`py-1.5 text-center rounded-lg transition-all cursor-pointer ${
                  preferences.layoutStyle === 'enhanced' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
                }`}
                style={{
                  backgroundColor: preferences.layoutStyle === 'enhanced' ? 'var(--bg-surface)' : 'transparent',
                  color: preferences.layoutStyle === 'enhanced' ? 'var(--brand-accent)' : 'var(--text-muted)',
                }}
              >
                Enhanced
              </button>
              <button
                type="button"
                onClick={() => updatePreference('layoutStyle', 'original')}
                className={`py-1.5 text-center rounded-lg transition-all cursor-pointer ${
                  preferences.layoutStyle === 'original' ? 'shadow-xs font-bold' : 'hover:text-[var(--text-primary)]'
                }`}
                style={{
                  backgroundColor: preferences.layoutStyle === 'original' ? 'var(--bg-surface)' : 'transparent',
                  color: preferences.layoutStyle === 'original' ? 'var(--brand-accent)' : 'var(--text-muted)',
                }}
              >
                Original
              </button>
            </div>
          </div>

          {/* 2. Independent Element Toggles */}
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-medium text-stone-500 block">Decorative Elements</span>

            {/* Background Image Toggle */}
            <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
              <span className="flex items-center gap-2">
                <Image className="w-3.5 h-3.5 text-stone-400" />
                <span>Background Image</span>
              </span>
              <input
                type="checkbox"
                checked={preferences.showBackgroundImage}
                onChange={(e) => updatePreference('showBackgroundImage', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-700 cursor-pointer"
              />
            </label>

            {/* Brand Heading Toggle */}
            <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
              <span className="flex items-center gap-2">
                <Type className="w-3.5 h-3.5 text-stone-400" />
                <span>Brand Heading</span>
              </span>
              <input
                type="checkbox"
                checked={preferences.showBrandHeading}
                onChange={(e) => updatePreference('showBrandHeading', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-700 cursor-pointer"
              />
            </label>

            {/* Tagline Toggle */}
            <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
              <span className="flex items-center gap-2">
                <Quote className="w-3.5 h-3.5 text-stone-400" />
                <span>Brand Tagline</span>
              </span>
              <input
                type="checkbox"
                checked={preferences.showTagline}
                onChange={(e) => updatePreference('showTagline', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-700 cursor-pointer"
              />
            </label>

            {/* Brand Visual Panel Toggle */}
            <label className="flex items-center justify-between text-xs cursor-pointer py-0.5">
              <span className="flex items-center gap-2">
                <Layout className="w-3.5 h-3.5 text-stone-400" />
                <span>Side Brand Panel</span>
              </span>
              <input
                type="checkbox"
                checked={preferences.showBrandPanel}
                disabled={preferences.layoutStyle === 'original'}
                onChange={(e) => updatePreference('showBrandPanel', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-700 cursor-pointer disabled:opacity-30"
              />
            </label>
          </div>

          {/* Reset Action */}
          <div className="pt-2 border-t flex justify-end" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={resetDefaults}
              className="text-[11px] font-semibold text-stone-500 hover:text-[var(--brand-accent)] flex items-center gap-1 cursor-pointer transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restore Defaults</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuthAppearanceControl;
