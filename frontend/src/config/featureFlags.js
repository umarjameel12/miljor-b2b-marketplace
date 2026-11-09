/**
 * MilJor UI Enhancements Feature Flags
 * Set ENHANCEMENTS_ENABLED to false (or any sub-flag to false) to instantly revert all enhancements.
 * This guarantees a 1-message / 1-second instant rollback.
 */
export const ENHANCEMENTS_ENABLED = true;

export const FLAGS = {
  // 1. Tooltips & Header
  customTooltips: ENHANCEMENTS_ENABLED && true,
  headerSearchExpanded: ENHANCEMENTS_ENABLED && true,
  headerNotificationsPopover: ENHANCEMENTS_ENABLED && true,

  // 2. Pools & Cards
  tierNotchesOnProgress: ENHANCEMENTS_ENABLED && true,
  categoryCountBadges: ENHANCEMENTS_ENABLED && true,
  searchClearButton: ENHANCEMENTS_ENABLED && true,
  dynamicDemandBadges: ENHANCEMENTS_ENABLED && true,

  // 3. Landing Page
  ctaShimmerEffect: ENHANCEMENTS_ENABLED && true,
  howItWorksConnectors: ENHANCEMENTS_ENABLED && true,
  featureCardGlow: ENHANCEMENTS_ENABLED && true,

  // 4. Auth (Login & Register)
  passwordVisibilityToggle: ENHANCEMENTS_ENABLED && true,
  passwordStrengthMeter: ENHANCEMENTS_ENABLED && true,
  phoneFormattingHelper: ENHANCEMENTS_ENABLED && true,

  // 5. Orders Page (Clean Sample Order Flow without emoji)
  ordersSamplePreview: ENHANCEMENTS_ENABLED && true,
};

export default FLAGS;
