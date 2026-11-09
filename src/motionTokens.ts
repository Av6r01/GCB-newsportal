/**
 * Phase 12: Motion System Tokens
 * All animation durations, easings, distances, and spring configs live here.
 * Import from this file — never hard-code animation values in components.
 *
 * prefers-reduced-motion: Components using these tokens must guard against
 * the system preference using the `useReducedMotion` hook from the `motion`
 * package or the CSS media query in index.css (which zeroes all durations).
 */

export const motionTokens = {
  /** Duration in seconds */
  duration: {
    instant: 0,
    fast: 0.12,
    normal: 0.28,
    slow: 0.45,
    skeleton: 0.6,
  },

  /** Shared CSS cubic-bezier easing */
  easing: {
    standard: [0.4, 0, 0.2, 1] as [number, number, number, number],
    decelerate: [0, 0, 0.2, 1] as [number, number, number, number],
    accelerate: [0.4, 0, 1, 1] as [number, number, number, number],
    sharp: [0.4, 0, 0.6, 1] as [number, number, number, number],
  },

  /** Y-offset distance for slide animations (px) */
  distance: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 32,
  },

  /** Stagger delay between list children (seconds) */
  stagger: 0.04,

  /** Spring physics presets */
  spring: {
    gentle: { type: 'spring' as const, stiffness: 180, damping: 24 },
    snappy: { type: 'spring' as const, stiffness: 300, damping: 30 },
    bouncy: { type: 'spring' as const, stiffness: 400, damping: 20 },
  },
} as const;

/** Shared fade-in variant (opacity + subtle Y slide) */
export const fadeInVariant = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: motionTokens.duration.normal,
      ease: motionTokens.easing.decelerate,
    },
  },
  exit: {
    opacity: 0,
    y: -motionTokens.distance.xs,
    transition: {
      duration: motionTokens.duration.fast,
      ease: motionTokens.easing.accelerate,
    },
  },
};

/** Page/route transition variant */
export const pageVariant = {
  hidden: { opacity: 0, y: motionTokens.distance.sm },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: motionTokens.duration.normal,
      ease: motionTokens.easing.decelerate,
    },
  },
  exit: {
    opacity: 0,
    transition: { duration: motionTokens.duration.fast },
  },
};

/** Drawer slide-in from the left */
export const drawerVariant = {
  hidden: { x: '-100%', opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: motionTokens.spring.snappy,
  },
  exit: {
    x: '-100%',
    opacity: 0,
    transition: {
      duration: motionTokens.duration.normal,
      ease: motionTokens.easing.accelerate,
    },
  },
};

/** Dialog/modal scale+fade */
export const dialogVariant = {
  hidden: { opacity: 0, scale: 0.96, y: motionTokens.distance.sm },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: motionTokens.spring.gentle,
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    transition: { duration: motionTokens.duration.fast },
  },
};

/** Stagger container: children animate in with a stagger delay */
export const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: motionTokens.stagger },
  },
};

/** Toast slide in from top-right */
export const toastVariant = {
  hidden: { opacity: 0, y: -motionTokens.distance.md, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: motionTokens.spring.snappy,
  },
  exit: {
    opacity: 0,
    y: -motionTokens.distance.sm,
    transition: { duration: motionTokens.duration.fast },
  },
};
