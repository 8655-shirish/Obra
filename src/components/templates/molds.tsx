import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import type { TemplateMoldContent } from "@/lib/template-content/overlay";
import type { TemplatePurchaseSlug } from "@/lib/template-content/overlay";

export type TemplateMoldComponent = ComponentType<{
  content?: TemplateMoldContent;
  bookingMode?: "demo" | "live" | "disabled";
  onOpenBooking?: () => void;
}>;

/**
 * The one mold registry shared by the live `/lp` renderer and edit-mode
 * preview. Every purchasable template maps to its page component; components
 * read purchaser content from the overlay (demo copy when absent).
 */
export const MOLD_COMPONENTS: Record<
  TemplatePurchaseSlug,
  LazyExoticComponent<TemplateMoldComponent>
> = {
  landscape: lazy(() =>
    import("./LandscapeTemplatePage").then((module) => ({
      default: module.LandscapeTemplatePage,
    })),
  ),
  plumber: lazy(() =>
    import("./PlumberTemplatePage").then((module) => ({ default: module.PlumberTemplatePage })),
  ),
  painter: lazy(() =>
    import("./PainterTemplatePage").then((module) => ({ default: module.PainterTemplatePage })),
  ),
  painter1: lazy(() =>
    import("./PainterOneTemplatePage").then((module) => ({
      default: module.PainterOneTemplatePage,
    })),
  ),
  painter2: lazy(() =>
    import("./PainterTwoTemplatePage").then((module) => ({
      default: module.PainterTwoTemplatePage,
    })),
  ),
  painter3: lazy(() =>
    import("./PainterThreeTemplatePage").then((module) => ({
      default: module.PainterThreeTemplatePage,
    })),
  ),
  painter4: lazy(() =>
    import("./PainterFourTemplatePage").then((module) => ({
      default: module.PainterFourTemplatePage,
    })),
  ),
  painter5: lazy(() =>
    import("./PainterFiveTemplatePage").then((module) => ({
      default: module.PainterFiveTemplatePage,
    })),
  ),
  painter6: lazy(() =>
    import("./PainterSixTemplatePage").then((module) => ({
      default: module.PainterSixTemplatePage,
    })),
  ),
  painter7: lazy(() =>
    import("./PainterSevenTemplatePage").then((module) => ({
      default: module.PainterSevenTemplatePage,
    })),
  ),
  painter8: lazy(() =>
    import("./PainterEightTemplatePage").then((module) => ({
      default: module.PainterEightTemplatePage,
    })),
  ),
  painter10: lazy(() =>
    import("./PainterTenTemplatePage").then((module) => ({
      default: module.PainterTenTemplatePage,
    })),
  ),
  painter11: lazy(() =>
    import("./PainterElevenTemplatePage").then((module) => ({
      default: module.PainterElevenTemplatePage,
    })),
  ),
  painter12: lazy(() =>
    import("./PainterTwelveTemplatePage").then((module) => ({
      default: module.PainterTwelveTemplatePage,
    })),
  ),
  painter13: lazy(() =>
    import("./PainterThirteenTemplatePage").then((module) => ({
      default: module.PainterThirteenTemplatePage,
    })),
  ),
  painter14: lazy(() =>
    import("./PainterFourteenTemplatePage").then((module) => ({
      default: module.PainterFourteenTemplatePage,
    })),
  ),
  painter15: lazy(() =>
    import("./PainterFifteenTemplatePage").then((module) => ({
      default: module.PainterFifteenTemplatePage,
    })),
  ),
  painter16: lazy(() =>
    import("./PainterSixteenTemplatePage").then((module) => ({
      default: module.PainterSixteenTemplatePage,
    })),
  ),
  painter17: lazy(() =>
    import("./PainterSeventeenTemplatePage").then((module) => ({
      default: module.PainterSeventeenTemplatePage,
    })),
  ),
  painter18: lazy(() =>
    import("./PainterEighteenTemplatePage").then((module) => ({
      default: module.PainterEighteenTemplatePage,
    })),
  ),
};

export function moldComponentFor(slug: string): LazyExoticComponent<TemplateMoldComponent> | null {
  return (
    (MOLD_COMPONENTS as Record<string, LazyExoticComponent<TemplateMoldComponent>>)[slug] ?? null
  );
}
