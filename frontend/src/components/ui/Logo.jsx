import React, { useId } from 'react';

/**
 * MilJor Master Brand Asset: Exact Flowing Champagne-Gold Ribbon-M Monogram
 * Conforms to Reference-First Engineering | Visual Gate VF-1
 *
 * Visual Rules:
 * - Standalone flowing gold ribbon-M silhouette with smooth 3D satin folds.
 * - NO box, NO shield container, NO adjacent "MilJor" wordmark across application UI.
 * - Fully accessible with aria-label="MilJor" and role="img".
 *
 * @param {Object} props
 * @param {'xs'|'sm'|'md'|'lg'|'xl'|'2xl'} [props.size='md']
 * @param {string} [props.className]
 * @param {string} [props.ariaLabel='MilJor']
 */
export const Logo = ({
  size = 'md',
  className = '',
  ariaLabel = 'MilJor',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradStemLeft = `mj-stem-left-${uid}`;
  const gradFoldLeft = `mj-fold-left-${uid}`;
  const gradTroughWave = `mj-trough-wave-${uid}`;
  const gradTailRight = `mj-tail-right-${uid}`;
  const gradSpecular = `mj-specular-${uid}`;

  // Height map in pixels; width is derived by aspect ratio 103 : 52 (~1.98 : 1)
  const sizeMap = {
    xs: { h: 16, w: 32 },
    sm: { h: 24, w: 48 },
    md: { h: 32, w: 64 },
    lg: { h: 48, w: 95 },
    xl: { h: 64, w: 127 },
    '2xl': { h: 96, w: 190 },
  };

  const { w, h } = sizeMap[size] || sizeMap.md;

  return (
    <div
      className={`inline-flex items-center justify-center shrink-0 select-none ${className}`}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        width={w}
        height={h}
        viewBox="0 0 103 52"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transition-transform duration-200 hover:scale-[1.02]"
        aria-hidden="true"
      >
        <defs>
          {/* Left rising ribbon stem gradient */}
          <linearGradient id={gradStemLeft} x1="6" y1="44" x2="33" y2="7" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#A87B3C"/>
            <stop offset="20%" stopColor="#C99B56"/>
            <stop offset="50%" stopColor="#E8BE78"/>
            <stop offset="80%" stopColor="#FCE6B7"/>
            <stop offset="100%" stopColor="#FFF8E0"/>
          </linearGradient>

          {/* First crest fold & inner shadow */}
          <linearGradient id={gradFoldLeft} x1="31" y1="7" x2="50" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFF8E0"/>
            <stop offset="18%" stopColor="#EABC75"/>
            <stop offset="50%" stopColor="#AF7C3B"/>
            <stop offset="80%" stopColor="#7A4F1D"/>
            <stop offset="100%" stopColor="#5E3B12"/>
          </linearGradient>

          {/* Central trough & rise to peak 2 */}
          <linearGradient id={gradTroughWave} x1="46" y1="36" x2="69" y2="9" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#936428"/>
            <stop offset="25%" stopColor="#C59652"/>
            <stop offset="60%" stopColor="#EABF77"/>
            <stop offset="88%" stopColor="#FCE5B5"/>
            <stop offset="100%" stopColor="#FFF8E2"/>
          </linearGradient>

          {/* Right crest fold & descending tail */}
          <linearGradient id={gradTailRight} x1="71" y1="7" x2="95" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFF8E2"/>
            <stop offset="22%" stopColor="#EABC77"/>
            <stop offset="55%" stopColor="#C59754"/>
            <stop offset="85%" stopColor="#9A6B2F"/>
            <stop offset="100%" stopColor="#784E1C"/>
          </linearGradient>

          {/* Upper rim specular highlight */}
          <linearGradient id={gradSpecular} x1="20" y1="6" x2="80" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8"/>
            <stop offset="25%" stopColor="#FFF8E0" stopOpacity="0.9"/>
            <stop offset="50%" stopColor="#EABC77" stopOpacity="0.3"/>
            <stop offset="75%" stopColor="#FFF8E0" stopOpacity="0.9"/>
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.8"/>
          </linearGradient>
        </defs>

        {/* Master Flowing Gold Ribbon-M Monogram (flowing-gold-ribbon-m) */}
        <g id="miljor-flowing-gold-ribbon-m">
          {/* Facet 1: Left Rising Flap & Crest */}
          <path
            d="M 6.0 44.5 C 7.0 41.0, 9.8 32.0, 13.5 23.5 C 17.0 15.5, 22.8 9.0, 29.8 7.0 C 33.0 6.4, 36.5 7.0, 39.0 8.8 C 40.5 11.5, 39.0 16.0, 35.0 21.5 C 30.0 28.0, 23.5 35.5, 17.5 40.5 C 13.0 43.5, 8.5 45.0, 6.0 44.5 Z"
            fill={`url(#${gradStemLeft})`}
          />

          {/* Facet 2: First Crest Downward Fold (Inner Depth Shadow) */}
          <path
            d="M 31.0 7.0 C 34.5 6.6, 38.0 8.0, 41.5 11.5 C 46.0 16.0, 50.0 21.0, 54.0 23.8 C 54.5 28.0, 52.0 34.5, 47.5 37.5 C 42.5 34.0, 37.5 27.0, 33.0 20.0 C 29.0 14.0, 28.5 8.5, 31.0 7.0 Z"
            fill={`url(#${gradFoldLeft})`}
          />

          {/* Facet 3: Central Valley Trough Wave */}
          <path
            d="M 45.0 36.0 C 49.0 38.8, 52.5 40.4, 55.0 40.0 C 59.5 38.5, 63.8 33.5, 68.0 26.0 C 71.5 19.0, 73.5 11.5, 71.0 7.0 C 67.5 7.2, 64.0 12.0, 60.0 18.0 C 55.5 25.0, 51.0 31.0, 45.0 36.0 Z"
            fill={`url(#${gradTroughWave})`}
          />

          {/* Facet 4: Right Crest & Descending Tail */}
          <path
            d="M 70.0 7.0 C 73.5 6.5, 77.0 8.5, 80.0 12.5 C 84.5 18.0, 88.5 26.5, 92.0 34.0 C 94.0 39.0, 95.5 43.0, 95.0 44.2 C 93.8 45.0, 89.8 43.8, 86.0 40.8 C 81.5 36.5, 76.0 29.5, 71.5 22.0 C 67.5 15.0, 67.0 8.5, 70.0 7.0 Z"
            fill={`url(#${gradTailRight})`}
          />

          {/* Specular Ridge Highlights (Satin Upper Rim Lighting) */}
          <path
            d="M 17.5 16.5 C 22.5 9.5, 27.0 7.0, 31.5 7.0 C 35.0 7.0, 39.5 9.0, 44.0 14.5"
            stroke={`url(#${gradSpecular})`}
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.85"
          />

          <path
            d="M 64.5 14.5 C 67.5 9.5, 70.0 7.0, 72.0 7.0 C 75.0 7.0, 79.5 10.0, 84.5 17.5"
            stroke={`url(#${gradSpecular})`}
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.85"
          />
        </g>
      </svg>
    </div>
  );
};

export default Logo;
