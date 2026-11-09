import React from 'react';
import { Logo } from './Logo';

/**
 * Minimal non-blocking opening treatment showing ONLY the Ribbon-M monogram.
 * Strictly adheres to rule: No 'MilJor' text, no artificial delay, no fake percentages.
 */
export const OpeningTreatment = ({ message = null }) => {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6 transition-colors duration-200"
      style={{ backgroundColor: 'var(--bg-page)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 animate-fade-in">
        {/* Strictly Monogram Only — No 'MilJor' Wordmark */}
        <Logo variant="monogram" size="xl" className="drop-shadow-sm" />

        {/* Minimal non-blocking indicator */}
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--brand-accent)' }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse [animation-delay:200ms]"
            style={{ backgroundColor: 'var(--brand-accent)' }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse [animation-delay:400ms]"
            style={{ backgroundColor: 'var(--brand-accent)' }}
          />
        </div>

        {message && (
          <p
            className="text-xs font-sans mt-1 tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            {message}
          </p>
        )}
      </div>
    </div>
  );
};

export default OpeningTreatment;
