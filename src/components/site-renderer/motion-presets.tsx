import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";
import type { Transition, Variants } from "motion/react";

/** Skill-repo enter/exit curve — "no approximated values". */
export const EASE_ENTER_EXIT = [0.23, 1, 0.32, 1] as const;

/** Skill-repo on-screen movement curve. */
export const EASE_MOVE = [0.77, 0, 0.175, 1] as const;

/**
 * Confirmed against motion@13: MotionConfig reducedMotion="user" honors the OS
 * prefers-reduced-motion setting (movement suppressed; opacity can remain).
 * Co-located here so SiteRenderer does not choose the reduced-motion policy.
 */
export const SITE_REDUCED_MOTION = "user" as const;

export type EntrancePreset =
  | "fade"
  | "fadeUp"
  | "fadeDown"
  | "scaleIn"
  | "slideFromLeft"
  | "slideFromRight"
  | "none";

const enterTransition: Transition = {
  duration: 0.45,
  ease: EASE_ENTER_EXIT,
};

const pressTransition: Transition = {
  duration: 0.16,
  ease: EASE_ENTER_EXIT,
};

export type EntranceMotionProps = {
  initial: false | Record<string, number>;
  whileInView?: Record<string, number>;
  viewport?: { once: boolean; amount?: number };
  transition?: Transition;
};

/**
 * Named entrance presets. The LLM picks a name; our code owns timing/curves.
 * When `enableMotion` is false, return `initial: false` and omit whileInView
 * so the same `m.section` wrapper mounts already-visible (no plain-element fork).
 */
export function getEntranceProps(
  entrance: EntrancePreset | undefined,
  enableMotion: boolean,
): EntranceMotionProps {
  if (!enableMotion) {
    return { initial: false };
  }

  const name = entrance ?? "fadeUp";

  switch (name) {
    case "none":
      return { initial: false };
    case "fade":
      return {
        initial: { opacity: 0 },
        whileInView: { opacity: 1 },
        viewport: { once: true, amount: 0 },
        transition: enterTransition,
      };
    case "fadeDown":
      return {
        initial: { opacity: 0, y: -16 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0 },
        transition: enterTransition,
      };
    case "scaleIn":
      return {
        initial: { opacity: 0, scale: 0.95 },
        whileInView: { opacity: 1, scale: 1 },
        viewport: { once: true, amount: 0 },
        transition: enterTransition,
      };
    case "slideFromLeft":
      return {
        initial: { opacity: 0, x: -24 },
        whileInView: { opacity: 1, x: 0 },
        viewport: { once: true, amount: 0 },
        transition: { ...enterTransition, ease: EASE_MOVE },
      };
    case "slideFromRight":
      return {
        initial: { opacity: 0, x: 24 },
        whileInView: { opacity: 1, x: 0 },
        viewport: { once: true, amount: 0 },
        transition: { ...enterTransition, ease: EASE_MOVE },
      };
    case "fadeUp":
    default:
      return {
        initial: { opacity: 0, y: 16 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0 },
        transition: enterTransition,
      };
  }
}

export function getStaggerContainerProps(enableMotion: boolean): {
  initial?: false | string;
  whileInView?: string;
  viewport?: { once: boolean; amount?: number };
  variants?: Variants;
} {
  if (!enableMotion) {
    return { initial: false };
  }

  return {
    initial: "hidden",
    whileInView: "visible",
    viewport: { once: true, amount: 0 },
    variants: {
      hidden: {},
      visible: {
        transition: {
          staggerChildren: 0.05,
        },
      },
    },
  };
}

export function getStaggerItemProps(enableMotion: boolean): {
  variants?: Variants;
  initial?: false;
} {
  if (!enableMotion) {
    return { initial: false };
  }

  return {
    variants: {
      hidden: { opacity: 0, y: 12 },
      visible: {
        opacity: 1,
        y: 0,
        transition: enterTransition,
      },
    },
  };
}

export function getPressableProps(enableMotion: boolean): {
  whileTap?: { scale: number };
  transition?: Transition;
} {
  if (!enableMotion) {
    return {};
  }

  return {
    whileTap: { scale: 0.97 },
    transition: pressTransition,
  };
}

export function getPulseProps(enableMotion: boolean): {
  animate?: { scale: number[] };
  transition?: Transition;
} {
  if (!enableMotion) {
    return {};
  }

  return {
    animate: { scale: [1, 1.035, 1] },
    transition: { duration: 2.2, repeat: Infinity, ease: "easeInOut" },
  };
}

/**
 * Whether to stagger a repeated list. Opt-in only: `stagger: true` staggers;
 * omit and `false` both mean no stagger (matches the generator prompt).
 */
export function shouldStaggerList(stagger: boolean | undefined): boolean {
  return stagger === true;
}

/** LazyMotion + reduced-motion policy — SiteRenderer should not re-decide these. */
export function SiteMotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={SITE_REDUCED_MOTION}>{children}</MotionConfig>
    </LazyMotion>
  );
}
