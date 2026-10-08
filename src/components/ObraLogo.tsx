import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type ObraLogoProps = {
  size?: number;
  showWordmark?: boolean;
  className?: string;
  iconClassName?: string;
  wordmarkClassName?: string;
};

export function ObraLogoIcon({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/obra-logo.png"
      width={size}
      height={size}
      alt="Obra"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

export function ObraLogo({
  size = 32,
  showWordmark = true,
  className,
  iconClassName,
  wordmarkClassName,
}: ObraLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <ObraLogoIcon size={size} className={iconClassName} />
      {showWordmark && (
        <span
          className={cn(
            "font-display text-lg font-semibold tracking-tight text-gradient-violet",
            wordmarkClassName,
          )}
        >
          Obra
        </span>
      )}
    </span>
  );
}

export function ObraLogoLink({
  to = "/",
  size = 32,
  showWordmark = true,
  className,
  iconClassName,
  wordmarkClassName,
  ...props
}: ObraLogoProps & ComponentProps<typeof Link>) {
  return (
    <Link
      to={to}
      className={cn("inline-flex items-center gap-2.5 transition-opacity hover:opacity-90", className)}
      {...props}
    >
      <ObraLogoIcon size={size} className={iconClassName} />
      {showWordmark && (
        <span
          className={cn(
            "font-display font-semibold tracking-tight text-gradient-violet",
            wordmarkClassName,
          )}
        >
          Obra
        </span>
      )}
    </Link>
  );
}
