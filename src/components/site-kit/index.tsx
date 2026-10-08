import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useState,
} from "react";
import { m } from "motion/react";

import { cn } from "../../lib/utils.ts";
import {
  getEntranceProps,
  getPressableProps,
  getPulseProps,
  getStaggerContainerProps,
  getStaggerItemProps,
  shouldStaggerList,
  SiteMotionRoot,
  type EntrancePreset,
} from "../site-renderer/motion-presets.tsx";
import { evidenceMediaItems } from "../../lib/site-evidence.ts";
import type { MediaManifestSlot } from "../../lib/site-theme/media-manifest.ts";
import { headerNavItems } from "../../lib/agent/section-order.ts";
import {
  CARD_SURFACES,
  HEADING_LEVELS,
  SECTION_BANDS,
  SECTION_PADS,
  SECTION_SCRIMS,
  SECTION_WIDTHS,
} from "../../lib/site-theme/kit-props.ts";

type MediaItem = {
  url?: string;
  mimeType?: string;
  alt?: string;
  origin?: "evidence" | "generated";
  slotId?: string;
  assetId?: string;
  posterUrl?: string;
};
type LeadField = { id: string; label: string; required: boolean };
type ReviewItem = { quote: string; author?: string; source?: string };
type TrustMarkerItem = {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  href?: string;
};

type PlatformKey = "google" | "yelp" | "angi" | "bbb" | "houzz";

function normalizePlatformKey(value: string | undefined | null): PlatformKey | null {
  const raw = (value ?? "").toLowerCase();
  if (!raw || raw === "manual") return null;
  if (raw.includes("google")) return "google";
  if (raw.includes("yelp")) return "yelp";
  if (raw.includes("angi") || raw.includes("angie")) return "angi";
  if (raw.includes("bbb")) return "bbb";
  if (raw.includes("houzz")) return "houzz";
  return null;
}

function platformLabel(key: PlatformKey): string {
  if (key === "google") return "Google";
  if (key === "yelp") return "Yelp";
  if (key === "angi") return "Angi";
  if (key === "bbb") return "BBB";
  return "Houzz";
}

function PlatformLogo({ platform, className }: { platform: PlatformKey; className?: string }) {
  const size = "h-4 w-4 shrink-0";
  if (platform === "google") {
    return (
      <svg className={cn(size, className)} viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
    );
  }
  if (platform === "yelp") {
    return (
      <svg className={cn(size, className)} viewBox="0 0 24 24" aria-hidden>
        <path
          fill="#D32323"
          d="M12.01 1.5c-2.17 0-4.35.02-6.52.06-.62.01-1.04.45-1.08 1.07-.18 2.75-.26 5.5-.24 8.26.01.58.4 1.01.98 1.08 1.74.22 2.95 1.12 3.58 2.8.17.45.64.62 1.05.38 1.45-.88 2.9-1.76 4.34-2.65.41-.25.52-.76.28-1.18-1.05-1.85-1.05-3.7 0-5.55.24-.42.13-.93-.28-1.18-1.44-.89-2.89-1.77-4.34-2.65-.41-.24-.88-.07-1.05.38-.63 1.68-1.84 2.58-3.58 2.8-.58.07-.97.5-.98 1.08-.04 2.76.06 5.51.24 8.26.04.62.46 1.06 1.08 1.07 2.17.04 4.35.06 6.52.06s4.35-.02 6.52-.06c.62-.01 1.04-.45 1.08-1.07.18-2.75.28-5.5.24-8.26-.01-.58-.4-1.01-.98-1.08-1.74-.22-2.95-1.12-3.58-2.8-.17-.45-.64-.62-1.05-.38-1.45.88-2.9 1.76-4.34 2.65-.41.25-.52.76-.28 1.18 1.05 1.85 1.05 3.7 0 5.55-.24.42-.13.93.28 1.18 1.44.89 2.89 1.77 4.34 2.65.41.24.88.07 1.05-.38.63-1.68 1.84-2.58 3.58-2.8.58-.07.97-.5.98-1.08.04-2.17.06-4.35.06-6.52s-.02-4.35-.06-6.52c-.01-.62-.45-1.04-1.07-1.08z"
        />
      </svg>
    );
  }
  if (platform === "angi") {
    return (
      <svg className={cn(size, className)} viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="#FF6153" />
        <path
          fill="#fff"
          d="M8 16V8h2.2l2.3 4.5L14.8 8H17v8h-1.8v-4.8L12.4 16h-1.2L8.8 11.2V16H8z"
        />
      </svg>
    );
  }
  if (platform === "bbb") {
    return (
      <svg className={cn(size, className)} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="4" width="20" height="16" rx="2" fill="#005A8C" />
        <text
          x="12"
          y="15"
          textAnchor="middle"
          fill="#fff"
          fontSize="7"
          fontWeight="700"
          fontFamily="system-ui,sans-serif"
        >
          BBB
        </text>
      </svg>
    );
  }
  return (
    <svg className={cn(size, className)} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#4DBC15" />
      <path
        fill="#fff"
        d="M9.5 16V8h3.2c2 0 3.3 1 3.3 2.6 0 1.1-.6 1.9-1.6 2.3L16.5 16h-2.2l-1.4-2.8H11.5V16H9.5zm2-4.4h1c.9 0 1.4-.4 1.4-1.1s-.5-1.1-1.4-1.1h-1v2.2z"
      />
    </svg>
  );
}

export function ReviewSourceBadge({ source, className }: { source?: string; className?: string }) {
  const label = (source ?? "").trim();
  if (!label) return null;
  const platform = normalizePlatformKey(label);
  if (!platform) {
    return (
      <span className={cn("text-sm", className)} style={{ color: "var(--site-muted)" }}>
        {label}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-sm tabular-nums", className)}
      style={{ color: "var(--site-muted)" }}
    >
      <PlatformLogo platform={platform} />
      <span>{platformLabel(platform)}</span>
    </span>
  );
}

type KitHover = "lift" | "underline" | "zoomMedia" | "grow" | "none";

function isVideoMedia(item: MediaItem): boolean {
  const mime = (item.mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  if (mime === "image/gif") return false;
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(item.url ?? "");
}

export function firstStill(items: MediaItem[] | undefined | null): MediaItem | undefined {
  if (!items) return undefined;
  return items.find((item) => item.url && !isVideoMedia(item));
}

function mediaKey(item: MediaItem): string {
  return item.url ?? "";
}

type GalleryContextValue = {
  items: MediaItem[];
  openAt: (index: number) => void;
  indexOf: (item: MediaItem) => number;
};

const GalleryContext = createContext<GalleryContextValue | null>(null);

function ImageLightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = items[index];
  const hasMultiple = items.length > 1;

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" && hasMultiple) {
        event.preventDefault();
        onNavigate((index - 1 + items.length) % items.length);
      }
      if (event.key === "ArrowRight" && hasMultiple) {
        event.preventDefault();
        onNavigate((index + 1) % items.length);
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasMultiple, index, items.length, onClose, onNavigate]);

  if (!item?.url) return null;
  const label = item.alt ?? "Project photo";

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image gallery"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label="Close gallery"
        className={cn(
          "absolute right-4 top-4 z-10 rounded-full bg-black/50 px-3 py-2 text-sm text-white",
          FOCUS_RING,
        )}
        onClick={onClose}
      >
        Close
      </button>
      {hasMultiple ? (
        <button
          type="button"
          aria-label="Previous image"
          className={cn(
            "absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white",
            FOCUS_RING,
          )}
          onClick={() => onNavigate((index - 1 + items.length) % items.length)}
        >
          ‹
        </button>
      ) : null}
      <div className="flex max-h-[90vh] max-w-[90vw] items-center justify-center">
        {isVideoMedia(item) ? (
          <video
            key={item.url}
            src={item.url}
            controls
            playsInline
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : (
          <img
            key={item.url}
            src={item.url}
            alt={label}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        )}
      </div>
      {hasMultiple ? (
        <button
          type="button"
          aria-label="Next image"
          className={cn(
            "absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 px-3 py-2 text-white",
            FOCUS_RING,
          )}
          onClick={() => onNavigate((index + 1) % items.length)}
        >
          ›
        </button>
      ) : null}
    </div>
  );
}

export function GalleryProvider({
  items,
  children,
}: {
  items?: MediaItem[] | null;
  children?: ReactNode;
}) {
  const validItems = useMemo(
    () => (Array.isArray(items) ? items.filter((item) => Boolean(item.url)) : []),
    [items],
  );
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const openAt = useCallback(
    (index: number) => {
      if (index < 0 || index >= validItems.length) return;
      triggerRef.current = document.activeElement as HTMLElement | null;
      setOpenIndex(index);
    },
    [validItems.length],
  );

  const indexOf = useCallback(
    (item: MediaItem) => {
      const byRef = validItems.indexOf(item);
      if (byRef >= 0) return byRef;
      const key = mediaKey(item);
      return validItems.findIndex((entry) => mediaKey(entry) === key);
    },
    [validItems],
  );

  const close = useCallback(() => {
    setOpenIndex(null);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (openIndex === null) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openIndex]);

  const value = useMemo(
    () => ({ items: validItems, openAt, indexOf }),
    [validItems, openAt, indexOf],
  );

  return (
    <GalleryContext.Provider value={value}>
      {children}
      {openIndex !== null ? (
        <ImageLightbox
          items={validItems}
          index={openIndex}
          onClose={close}
          onNavigate={setOpenIndex}
        />
      ) : null}
    </GalleryContext.Provider>
  );
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^javascript:/i.test(trimmed) || /^data:/i.test(trimmed)) return null;
  if (trimmed.startsWith("#")) return trimmed;
  if (/^(tel:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--site-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--site-bg)]";

const THANKS_COPY = "Thanks — we received your request and will follow up shortly.";

type SiteEvidenceSection = {
  type: string;
  id?: string;
  heading?: string;
  body?: string;
  catalogRef?: string;
  entrance?: string;
  stagger?: boolean;
  hover?: string;
};

type SiteEvidence = {
  media: MediaItem[];
  reviews: ReviewItem[];
  sections: SiteEvidenceSection[];
  hours: string | null;
  warranty: string | null;
  services: string[];
  contactHidden: boolean;
  businessName: string;
  licenseNumber: string;
  city: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
};
const SiteEvidenceContext = createContext<SiteEvidence | null>(null);
const SiteMediaSlotsContext = createContext<Record<string, MediaManifestSlot>>({});
const SiteMotionContext = createContext(true);
const SiteBookingContext = createContext<{
  canOpenBooking: boolean;
  conversionAsk: string | null;
  openBooking: () => void;
}>({ canOpenBooking: false, conversionAsk: null, openBooking: () => {} });

function useSiteMotion(): boolean {
  return useContext(SiteMotionContext);
}

function useMediaQuery(queryText: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(queryText).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(queryText);
    const update = () => setMatches(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [queryText]);
  return matches;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function postOpenBooking(): void {
  window.parent.postMessage(
    {
      type: "open-booking",
      token: (window as unknown as { __SITE_RUNTIME_TOKEN?: string }).__SITE_RUNTIME_TOKEN,
    },
    "*",
  );
}

export function SiteKitBookingRoot({
  canOpenBooking,
  conversionAsk,
  children,
}: {
  canOpenBooking: boolean;
  conversionAsk?: string | null;
  children?: ReactNode;
}) {
  const value = useMemo(
    () => ({
      canOpenBooking,
      conversionAsk: conversionAsk ?? null,
      openBooking: postOpenBooking,
    }),
    [canOpenBooking, conversionAsk],
  );
  return <SiteBookingContext.Provider value={value}>{children}</SiteBookingContext.Provider>;
}

export function SiteMediaSlotsProvider({
  slots,
  children,
}: {
  slots?: Record<string, MediaManifestSlot> | null;
  children?: ReactNode;
}) {
  return (
    <SiteMediaSlotsContext.Provider value={slots ?? {}}>{children}</SiteMediaSlotsContext.Provider>
  );
}

export function SiteKitMotionRoot({
  enableMotion,
  children,
}: {
  enableMotion: boolean;
  children?: ReactNode;
}) {
  return (
    <SiteMotionContext.Provider value={enableMotion}>
      <SiteMotionRoot>{children}</SiteMotionRoot>
    </SiteMotionContext.Provider>
  );
}

function hoverClass(hover?: KitHover): string {
  if (hover === "lift")
    return "transition-transform transition-shadow hover:-translate-y-0.5 hover:shadow-md";
  if (hover === "underline") return "hover:underline";
  if (hover === "zoomMedia") return "transition-transform duration-300 hover:scale-[1.03]";
  if (hover === "grow") return "transition-transform duration-300 hover:scale-[1.02]";
  return "";
}

export function useSiteEvidence(): SiteEvidence | null {
  return useContext(SiteEvidenceContext);
}

export function SiteEvidenceProvider({
  media,
  reviews,
  sections,
  hours,
  warranty,
  services,
  contactHidden,
  businessName,
  licenseNumber,
  city,
  phone,
  address,
  logoUrl,
  children,
}: {
  media?: MediaItem[] | null;
  reviews?: ReviewItem[] | null;
  sections?: SiteEvidenceSection[] | null;
  hours?: string | null;
  warranty?: string | null;
  services?: string[] | null;
  contactHidden?: boolean;
  businessName?: string | null;
  licenseNumber?: string | null;
  city?: string | null;
  phone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  children?: ReactNode;
}) {
  return (
    <SiteEvidenceContext.Provider
      value={{
        media: media ?? [],
        reviews: reviews ?? [],
        sections: Array.isArray(sections) ? sections : [],
        hours: typeof hours === "string" ? hours : null,
        warranty: typeof warranty === "string" ? warranty : null,
        services: Array.isArray(services) ? services.filter((item) => item.trim().length > 0) : [],
        contactHidden: contactHidden === true,
        businessName: typeof businessName === "string" ? businessName : "",
        licenseNumber: typeof licenseNumber === "string" ? licenseNumber : "",
        city: typeof city === "string" ? city : "",
        phone: typeof phone === "string" ? phone : null,
        address: typeof address === "string" ? address : null,
        logoUrl: typeof logoUrl === "string" ? logoUrl : null,
      }}
    >
      {children}
    </SiteEvidenceContext.Provider>
  );
}

function leadErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unable to submit. Try again.";
}

function leadFieldAttrs(field: LeadField): {
  autoComplete: string;
  spellCheck?: boolean;
  inputMode?: "email" | "tel" | "text";
  placeholder?: string;
} {
  const id = field.id.toLowerCase();
  if (id === "email" || field.label.toLowerCase().includes("email")) {
    return {
      autoComplete: "email",
      spellCheck: false,
      inputMode: "email",
      placeholder: "e.g. name@example.com…",
    };
  }
  if (id === "phone" || field.label.toLowerCase().includes("phone")) {
    return {
      autoComplete: "tel",
      spellCheck: false,
      inputMode: "tel",
      placeholder: "e.g. (555) 123-4567…",
    };
  }
  if (id === "name" || field.label.toLowerCase() === "name") {
    return { autoComplete: "name", placeholder: "Your name…" };
  }
  if (id === "message" || field.label.toLowerCase().includes("detail")) {
    return {
      autoComplete: "off",
      placeholder: "e.g. Scope, timeline, notes…",
    };
  }
  return { autoComplete: "off" };
}

const fieldControlStyle: CSSProperties = {
  borderColor: "var(--site-hairline)",
  backgroundColor: "var(--site-bg)",
  color: "var(--site-ink)",
  borderRadius: "var(--site-radius)",
};

type KitBand = (typeof SECTION_BANDS)[number];
type KitWidth = (typeof SECTION_WIDTHS)[number];
type KitPad = (typeof SECTION_PADS)[number];
type KitScrim = (typeof SECTION_SCRIMS)[number];
type KitHeadingLevel = (typeof HEADING_LEVELS)[number];
type KitCardSurface = (typeof CARD_SURFACES)[number];

function mergeKitStyle(
  caller: CSSProperties | undefined,
  kit: CSSProperties,
): CSSProperties | undefined {
  if (!caller && Object.keys(kit).length === 0) return undefined;
  return { ...caller, ...kit };
}

function bandMutedOn(foreground: string, fill: string): CSSProperties {
  return {
    color: foreground,
    ["--site-muted"]: `color-mix(in oklab, ${foreground} 72%, ${fill})`,
  } as CSSProperties;
}

function sectionBandStyle(band: KitBand | undefined): CSSProperties {
  if (!band) return {};
  if (band === "soft") {
    return {
      backgroundColor: "var(--site-canvas-soft, #f8fafc)",
      color: "var(--site-ink, #0f172a)",
    };
  }
  if (band === "primary") {
    return {
      backgroundColor: "var(--site-primary, #1e3a5f)",
      ...bandMutedOn("var(--site-on-primary, #ffffff)", "var(--site-primary, #1e3a5f)"),
    };
  }
  if (band === "ink") {
    return {
      backgroundColor: "var(--site-ink, #0f172a)",
      ...bandMutedOn("var(--site-bg, #ffffff)", "var(--site-ink, #0f172a)"),
    };
  }
  if (band === "media") {
    return {
      backgroundColor: "var(--site-bg, #ffffff)",
      color: "var(--site-ink, #0f172a)",
      position: "relative",
      overflow: "hidden",
    };
  }
  return { backgroundColor: "var(--site-bg, #ffffff)", color: "var(--site-ink, #0f172a)" };
}

function sectionWidthStyle(width: KitWidth | undefined): CSSProperties {
  if (!width) return {};
  if (width === "prose") return { maxWidth: "65ch", marginInline: "auto", width: "100%" };
  if (width === "content") {
    return { maxWidth: "var(--site-section-max, 72rem)", marginInline: "auto", width: "100%" };
  }
  if (width === "wide") return { maxWidth: "88rem", marginInline: "auto", width: "100%" };
  return { maxWidth: "none", width: "100%" };
}

function sectionPadStyle(pad: KitPad | undefined): CSSProperties {
  if (!pad) return {};
  if (pad === "none") return { padding: "0" };
  if (pad === "tight") {
    return {
      paddingBlock: "calc(var(--site-section-pad-y, 3.5rem) * 0.65)",
      paddingInline: "var(--site-section-pad-x, 1.5rem)",
    };
  }
  if (pad === "loose") {
    return {
      paddingBlock: "calc(var(--site-section-pad-y, 3.5rem) * 1.35)",
      paddingInline: "var(--site-section-pad-x, 1.5rem)",
    };
  }
  return {
    paddingBlock: "var(--site-section-pad-y, 3.5rem)",
    paddingInline: "var(--site-section-pad-x, 1.5rem)",
  };
}

function headingLevelStyle(level: KitHeadingLevel | undefined): CSSProperties {
  if (!level) return {};
  if (level === "display") {
    return {
      fontSize: "var(--site-h1, 2.25rem)",
      fontWeight: "var(--site-weight-h1, 700)" as CSSProperties["fontWeight"],
      letterSpacing: "var(--site-tracking-h1, -0.02em)",
      lineHeight: "var(--site-leading-h1, 1.05)",
    };
  }
  if (level === "title") {
    return {
      fontSize: "var(--site-h2, 1.75rem)",
      fontWeight: "var(--site-weight-h2, 650)" as CSSProperties["fontWeight"],
      letterSpacing: "var(--site-tracking-h2, -0.015em)",
      lineHeight: "var(--site-leading-h2, 1.15)",
    };
  }
  if (level === "section") {
    return {
      fontSize: "var(--site-h3, 1.25rem)",
      fontWeight: "var(--site-weight-h3, 600)" as CSSProperties["fontWeight"],
      letterSpacing: "var(--site-tracking-h3, -0.01em)",
      lineHeight: "var(--site-leading-h3, 1.25)",
    };
  }
  if (level === "sub") {
    return {
      fontSize: "1.125rem",
      fontWeight: "var(--site-weight-h3, 600)" as CSSProperties["fontWeight"],
      lineHeight: "1.4",
    };
  }
  return {
    fontSize: "0.75rem",
    fontWeight: 600,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
  };
}

type SectionVisualProps = {
  id: string;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  entrance?: EntrancePreset;
  band?: KitBand;
  width?: KitWidth;
  pad?: KitPad;
  media?: MediaItem | null;
  scrim?: KitScrim;
};

export function Section({
  id,
  className,
  children,
  style,
  entrance,
  band,
  width,
  pad,
  media,
  scrim,
}: SectionVisualProps) {
  const enableMotion = useSiteMotion();
  const motionProps = getEntranceProps(entrance ?? "none", enableMotion);
  const overlay = Boolean(media?.url);
  const resolvedScrim = overlay ? (scrim ?? "soft") : scrim;
  const kitStyle = {
    ...sectionBandStyle(band),
    ...sectionWidthStyle(width),
    ...sectionPadStyle(pad),
    ...(overlay
      ? {
          position: "relative" as const,
          overflow: "hidden",
          ...bandMutedOn("var(--site-on-primary, #ffffff)", "var(--site-primary, #1e3a5f)"),
        }
      : {}),
  };
  const scrimAlpha = resolvedScrim === "strong" ? 0.72 : resolvedScrim === "soft" ? 0.4 : 0;
  return (
    <m.section
      id={id}
      data-site-section={id}
      className={cn(className)}
      style={mergeKitStyle(style, kitStyle)}
      {...motionProps}
    >
      {overlay ? (
        <>
          <Media item={media} priority className="absolute inset-0 h-full w-full object-cover" />
          {overlay && resolvedScrim && resolvedScrim !== "none" ? (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: `color-mix(in oklab, var(--site-primary, #1e3a5f) ${Math.round(scrimAlpha * 100)}%, transparent)`,
              }}
            />
          ) : null}
          <div style={{ position: "relative" }}>{children}</div>
        </>
      ) : (
        children
      )}
    </m.section>
  );
}

export function Heading({
  as: Tag = "h2",
  className,
  children,
  level,
  style,
}: {
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
  children?: ReactNode;
  level?: KitHeadingLevel;
  style?: CSSProperties;
}) {
  return (
    <Tag className={cn(className)} style={mergeKitStyle(style, headingLevelStyle(level))}>
      {children}
    </Tag>
  );
}

export function Button({
  href,
  className,
  children,
  type = "button",
  variant = "primary",
  onClick,
  disabled,
  hover,
}: {
  href?: string;
  className?: string;
  children?: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
  hover?: KitHover;
}) {
  const enableMotion = useSiteMotion();
  const booking = useContext(SiteBookingContext);
  const evidence = useContext(SiteEvidenceContext);
  const pressable = getPressableProps(enableMotion);
  const classes = cn(
    "inline-block min-h-11 px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90",
    FOCUS_RING,
    hoverClass(hover),
    disabled && "cursor-not-allowed opacity-70",
    className,
  );
  const style: CSSProperties =
    variant === "secondary"
      ? {
          backgroundColor: "var(--site-canvas-soft)",
          color: "var(--site-ink)",
          border: "1px solid var(--site-hairline)",
          borderRadius: "var(--site-radius)",
        }
      : variant === "ghost"
        ? {
            backgroundColor: "transparent",
            color: "var(--site-primary)",
            borderRadius: "var(--site-radius)",
          }
        : {
            backgroundColor: "var(--site-primary)",
            color: "var(--site-on-primary)",
            borderRadius: "var(--site-radius)",
          };
  if (href) {
    const safe = safeHref(href);
    if (!safe) return null;
    if (evidence?.contactHidden && (/^(?:mailto:|tel:)/i.test(safe) || safe === "#contact"))
      return null;
    const external = /^https?:\/\//i.test(safe);
    const openBooking = booking.canOpenBooking && safe === "#contact";
    return (
      <m.a
        href={safe}
        className={classes}
        style={style}
        {...pressable}
        onClick={
          openBooking
            ? (event) => {
                event.preventDefault();
                booking.openBooking();
              }
            : undefined
        }
        {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
      >
        {children}
      </m.a>
    );
  }
  return (
    <m.button
      type={type}
      className={classes}
      style={style}
      onClick={onClick}
      disabled={disabled}
      {...pressable}
    >
      {children}
    </m.button>
  );
}

function explicitCtaLabel(children: ReactNode): ReactNode | undefined {
  if (children == null) return undefined;
  if (typeof children === "string" && !children.trim()) return undefined;
  return children;
}

export function QuoteCta({
  className,
  children,
  pulse,
}: {
  className?: string;
  children?: ReactNode;
  pulse?: boolean;
}) {
  const enableMotion = useSiteMotion();
  const booking = useContext(SiteBookingContext);
  const label = !booking.canOpenBooking
    ? "Get a Quote"
    : (explicitCtaLabel(children) ?? booking.conversionAsk ?? "Book now");
  const inner = (
    <Button href="#contact" className={className} hover="lift">
      {label}
    </Button>
  );
  if (!pulse) return inner;
  return (
    <m.span className="inline-block" {...getPulseProps(enableMotion)}>
      {inner}
    </m.span>
  );
}

export function Media({
  item,
  media,
  slotId,
  className,
  alt,
  priority,
  lazy,
  disableLightbox,
  galleryIndex,
  hover,
  motion = "all",
}: {
  item?: MediaItem | null;
  media?: MediaItem | null;
  slotId?: string;
  className?: string;
  alt?: string;
  priority?: boolean;
  lazy?: boolean;
  disableLightbox?: boolean;
  /** Canonical index in GalleryProvider items; avoids ambiguous URL matches. */
  galleryIndex?: number;
  hover?: KitHover;
  motion?: "desktop" | "all";
}) {
  const gallery = useContext(GalleryContext);
  const slots = useContext(SiteMediaSlotsContext);
  const enableMotion = useSiteMotion();
  const prefersReducedMotion = usePrefersReducedMotion();
  const desktopMotion = useMediaQuery("(min-width: 768px)");
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoIntersected, setVideoIntersected] = useState(false);
  const slot = slotId ? slots[slotId] : undefined;
  const poster = slot?.posterSlotId ? slots[slot.posterSlotId] : undefined;
  const resolved: MediaItem | null = slot ?? item ?? media ?? null;
  const isResolvedVideo = resolved ? isVideoMedia(resolved) : false;
  useEffect(() => {
    if (!isResolvedVideo || !lazy || !desktopMotion) {
      setVideoIntersected(true);
      return;
    }
    setVideoIntersected(false);
    const node = videoRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVideoIntersected(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isResolvedVideo, lazy, desktopMotion, resolved?.url]);
  if (!resolved?.url) return null;
  const label =
    alt ?? resolved.alt ?? (resolved.origin === "generated" ? "Brand atmosphere" : "Project photo");
  const canonicalIndex =
    gallery && !disableLightbox ? (galleryIndex ?? gallery.indexOf(resolved)) : -1;
  const generatedLoop =
    isResolvedVideo && resolved.origin === "generated" && enableMotion && !prefersReducedMotion;

  const posterUrl = poster?.url ?? resolved.posterUrl;
  const motionSuppressed =
    isResolvedVideo &&
    (!enableMotion ||
      prefersReducedMotion ||
      (motion === "desktop" && !desktopMotion) ||
      videoFailed);
  if (motionSuppressed && !posterUrl) return null;
  const showMotionFallback = motionSuppressed && Boolean(posterUrl);
  const inner = showMotionFallback ? (
    <img
      src={posterUrl}
      alt={isResolvedVideo && resolved.origin === "generated" ? "" : label}
      data-site-media=""
      data-site-media-fallback=""
      className={cn("w-full", hoverClass(hover), className)}
      loading={priority ? "eager" : lazy ? "lazy" : undefined}
      fetchPriority={priority ? "high" : undefined}
    />
  ) : isResolvedVideo ? (
    <video
      ref={videoRef}
      src={!lazy || !desktopMotion || videoIntersected ? resolved.url : undefined}
      preload="none"
      aria-hidden={resolved.origin === "generated" ? true : undefined}
      poster={posterUrl}
      autoPlay={generatedLoop || undefined}
      muted={generatedLoop || undefined}
      loop={generatedLoop || undefined}
      controls={!generatedLoop && canonicalIndex < 0}
      playsInline
      onError={() => setVideoFailed(true)}
      data-site-media=""
      className={cn("w-full", hoverClass(hover), className)}
    />
  ) : (
    <img
      src={resolved.url}
      alt={label}
      data-site-media=""
      className={cn("w-full", hoverClass(hover), className)}
      loading={priority ? "eager" : lazy ? "lazy" : undefined}
      fetchPriority={priority ? "high" : undefined}
    />
  );

  if (gallery && canonicalIndex >= 0) {
    return (
      <button
        type="button"
        aria-label={`View ${label} fullscreen`}
        className={cn(
          "block w-full cursor-pointer border-0 bg-transparent p-0 text-left",
          FOCUS_RING,
        )}
        onClick={() => gallery.openAt(canonicalIndex)}
      >
        {inner}
      </button>
    );
  }

  return inner;
}

export function MediaGallery({
  media,
  items,
  className,
  excludeFirst = true,
}: {
  media?: MediaItem[] | null;
  items?: MediaItem[] | null;
  className?: string;
  excludeFirst?: boolean;
}) {
  const gallery = useContext(GalleryContext);
  const source = evidenceMediaItems(media ?? items ?? []);
  const displayItems = useMemo(() => {
    const indexed = source
      .map((entry, index) => ({ entry, index }))
      .filter((row) => Boolean(row.entry.url));
    if (!excludeFirst) return indexed;
    const hero = firstStill(indexed.map((row) => row.entry));
    if (!hero?.url) return indexed;
    const heroKey = mediaKey(hero);
    return indexed.filter((row) => mediaKey(row.entry) !== heroKey);
  }, [excludeFirst, source]);

  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {displayItems.map(({ entry, index }) => (
        <button
          key={`${index}-${mediaKey(entry)}`}
          type="button"
          aria-label={`View ${entry.alt ?? "project photo"} fullscreen`}
          className={cn("w-full overflow-hidden border-0 bg-transparent p-0 text-left", FOCUS_RING)}
          style={{ borderRadius: "var(--site-radius)" }}
          onClick={() => {
            if (index >= 0) gallery?.openAt(index);
          }}
        >
          <Media
            item={entry}
            galleryIndex={index}
            lazy
            disableLightbox
            className="aspect-[4/3] object-cover"
          />
        </button>
      ))}
    </div>
  );
}

export function TopBar({ className, children }: { className?: string; children?: ReactNode }) {
  return <header className={className}>{children}</header>;
}

export function Nav({
  items,
  className,
  hover,
}: {
  items: Array<{ href: string; label: string }>;
  className?: string;
  hover?: KitHover;
}) {
  const linkHover = hover === "none" ? "" : hoverClass(hover ?? "underline") || "hover:underline";
  return (
    <nav aria-label="Page" className={cx("flex flex-wrap gap-4 text-sm", className)}>
      {items.map((item) => {
        const href = safeHref(item.href);
        if (!href) return null;
        return (
          <a key={item.href} href={href} className={cx(linkHover, FOCUS_RING, "rounded-sm")}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

export function Header({
  logoUrl,
  businessName,
  contactHidden,
  pulse,
  className,
  media,
  reviews,
}: {
  logoUrl?: string | null;
  businessName: string;
  contactHidden?: boolean;
  pulse?: boolean;
  className?: string;
  media?: MediaItem[] | null;
  reviews?: ReviewItem[] | null;
}) {
  const evidence = useContext(SiteEvidenceContext);
  const mediaList = Array.isArray(media) ? media : evidence?.media;
  const reviewsList = Array.isArray(reviews) ? reviews : evidence?.reviews;
  const showWork = mediaList === undefined || mediaList.some((item) => Boolean(item.url));
  const showReviews = reviewsList === undefined || reviewsList.some((item) => Boolean(item.quote));
  const liveTypes = evidence?.sections?.map((section) => section.type) ?? [];
  const navTypes = (
    liveTypes.length > 0
      ? liveTypes
      : [
          "services",
          ...(showWork ? (["beforeAfter"] as const) : []),
          ...(showReviews ? (["reviews"] as const) : []),
          "contact",
        ]
  ).filter((type) => {
    if (type === "beforeAfter") return showWork;
    if (type === "reviews") return showReviews;
    if (type === "warranty") return Boolean((evidence?.warranty ?? "").trim());
    if (type === "hours") return Boolean((evidence?.hours ?? "").trim());
    return true;
  });
  const navItems = headerNavItems(navTypes, { contactHidden });
  return (
    <TopBar className={cx("flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-10 w-auto shrink-0 object-contain" />
        ) : null}
        <span className="min-w-0 truncate text-lg font-semibold">{businessName}</span>
      </div>
      <Nav items={navItems} />
      {contactHidden ? null : <QuoteCta pulse={pulse} />}
    </TopBar>
  );
}

export function Grid({
  className,
  children,
  stagger,
}: {
  className?: string;
  children?: ReactNode;
  stagger?: boolean;
}) {
  const enableMotion = useSiteMotion();
  const doStagger = shouldStaggerList(stagger) && enableMotion;
  const items = doStagger
    ? Children.map(children, (child, index) => (
        <m.div key={index} {...getStaggerItemProps(true)}>
          {child}
        </m.div>
      ))
    : children;
  if (doStagger) {
    return (
      <m.div
        data-site-grid=""
        className={cn("grid", className)}
        {...getStaggerContainerProps(true)}
      >
        {items}
      </m.div>
    );
  }
  return (
    <div data-site-grid="" className={cn("grid", className)}>
      {items}
    </div>
  );
}

export function Card({
  className,
  children,
  hover,
  surface = "token",
  style,
}: {
  className?: string;
  children?: ReactNode;
  hover?: KitHover;
  surface?: KitCardSurface;
  style?: CSSProperties;
}) {
  const kitStyle: CSSProperties =
    surface === "plain"
      ? {
          borderRadius: "var(--site-radius, 0.75rem)",
          borderColor: "transparent",
          backgroundColor: "transparent",
          boxShadow: "none",
        }
      : ({
          borderRadius: "var(--site-radius, 0.75rem)",
          borderColor: "var(--site-hairline, #e2e8f0)",
          backgroundColor: "var(--site-card-surface, var(--site-canvas-soft, #f8fafc))",
          boxShadow: "var(--site-elevation, none)",
          color: "var(--site-ink, #0f172a)",
          ["--site-muted"]: "var(--site-muted-ramp, var(--site-muted))",
        } as CSSProperties);
  return (
    <div
      data-site-card=""
      className={cn("border", hoverClass(hover), className)}
      style={mergeKitStyle(style, kitStyle)}
    >
      {children}
    </div>
  );
}

export function Quote({
  quote,
  author,
  source,
  className,
  children,
  hover,
}: {
  quote?: string;
  author?: string;
  source?: string;
  className?: string;
  children?: ReactNode;
  hover?: KitHover;
}) {
  if (quote) {
    return (
      <Card className={className} hover={hover}>
        <p className="text-base leading-relaxed">“{quote}”</p>
        {(author || source) && (
          <div className="mt-3 space-y-1">
            {author ? (
              <p className="text-sm" style={{ color: "var(--site-muted)" }}>
                — {author}
              </p>
            ) : null}
            {source ? <ReviewSourceBadge source={source} /> : null}
          </div>
        )}
      </Card>
    );
  }
  if (children)
    return (
      <Card className={className} hover={hover}>
        {children}
      </Card>
    );
  return null;
}

export function TrustMarkerList({
  markers,
  className,
  chipClassName,
  chipStyle,
  detailClassName,
}: {
  markers?: TrustMarkerItem[] | null;
  className?: string;
  chipClassName?: string;
  chipStyle?: CSSProperties;
  detailClassName?: string;
}) {
  const list = Array.isArray(markers) ? markers : [];
  if (list.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap justify-center gap-3 tabular-nums", className)}>
      {list.map((marker) => {
        const platform =
          marker.kind === "license"
            ? null
            : (normalizePlatformKey(marker.kind) ?? normalizePlatformKey(marker.label));
        const inner = (
          <span className="inline-flex items-center gap-1.5">
            {platform ? <PlatformLogo platform={platform} /> : null}
            <span className="font-medium">{marker.label}</span>
            {marker.detail ? (
              <span
                className={detailClassName}
                style={detailClassName ? undefined : { color: "var(--site-muted)" }}
              >
                {" "}
                · {marker.detail}
              </span>
            ) : null}
          </span>
        );
        return (
          <li
            key={marker.id}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              !chipClassName &&
                "border-[color:var(--site-hairline)] bg-[color:var(--site-canvas-soft)]",
              chipClassName,
            )}
            style={
              {
                color: "var(--site-ink, #0f172a)",
                ["--site-muted"]: "var(--site-muted-ramp, var(--site-muted))",
                ...chipStyle,
              } as CSSProperties
            }
          >
            {marker.href ? (
              <a
                href={marker.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("hover:underline", FOCUS_RING, "rounded-sm")}
              >
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Hero({
  id = "hero",
  children,
  className,
  style,
  entrance,
  band,
  width,
  pad,
  media,
  scrim,
}: Omit<SectionVisualProps, "id"> & { id?: string }) {
  return (
    <Section
      id={id}
      className={className}
      style={style}
      entrance={entrance}
      band={band}
      width={width}
      pad={pad}
      media={media}
      scrim={scrim}
    >
      {children}
    </Section>
  );
}

export function LeadSlot({
  fields,
  canSubmitLead,
  className,
}: {
  fields: LeadField[];
  canSubmitLead: boolean;
  className?: string;
}) {
  const evidence = useContext(SiteEvidenceContext);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const submissionIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== "lead-result") return;
      const expected = (window as unknown as { __SITE_RUNTIME_TOKEN?: string })
        .__SITE_RUNTIME_TOKEN;
      if (data.token !== expected) return;
      if (data.preview) {
        setStatus("idle");
        return;
      }
      if (data.ok === true) {
        setStatus("success");
        setError(null);
        return;
      }
      setStatus("error");
      setError(leadErrorMessage(data.error));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload: Record<string, string> = {};
    for (const [key, value] of data.entries()) {
      payload[key] = String(value);
    }
    if (canSubmitLead) {
      setStatus("loading");
      setError(null);
    }
    window.parent.postMessage(
      {
        type: "lead-submit",
        fields: Object.fromEntries(
          Object.entries(payload).filter(([key]) => key !== "companyWebsite"),
        ),
        submissionId: submissionIdRef.current,
        companyWebsite: payload.companyWebsite ?? "",
        token: (window as unknown as { __SITE_RUNTIME_TOKEN?: string }).__SITE_RUNTIME_TOKEN,
      },
      "*",
    );
    if (!canSubmitLead) {
      form.reset();
    }
  }

  const liveMessage =
    status === "loading" ? "Sending…" : status === "success" ? THANKS_COPY : (error ?? "");

  if (evidence?.contactHidden) return null;

  return (
    <div className={className}>
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>
      {status === "success" ? (
        <p
          className="border p-4 text-sm"
          style={{ borderRadius: "var(--site-radius)", borderColor: "var(--site-hairline)" }}
        >
          {THANKS_COPY}
        </p>
      ) : (
        <form
          onSubmit={onSubmit}
          className="space-y-3 border p-4"
          style={{ borderRadius: "var(--site-radius)", borderColor: "var(--site-hairline)" }}
        >
          <h3 className="text-lg font-semibold">Request a quote</h3>
          <input
            type="text"
            name="companyWebsite"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[10000px] h-px w-px overflow-hidden"
          />
          {fields.map((field) => {
            const isLong = field.id === "message" || field.label.toLowerCase().includes("detail");
            const attrs = leadFieldAttrs(field);
            return (
              <label key={field.id} className="block space-y-1 text-sm">
                <span>{field.label}</span>
                {isLong ? (
                  <textarea
                    name={field.id}
                    required={field.required}
                    autoComplete={attrs.autoComplete}
                    placeholder={attrs.placeholder}
                    className="min-h-[80px] w-full border px-3 py-2"
                    style={fieldControlStyle}
                  />
                ) : (
                  <input
                    name={field.id}
                    type={field.id === "email" ? "email" : field.id === "phone" ? "tel" : "text"}
                    required={field.required}
                    autoComplete={attrs.autoComplete}
                    spellCheck={attrs.spellCheck}
                    inputMode={attrs.inputMode}
                    placeholder={attrs.placeholder}
                    className="min-h-11 w-full border px-3 py-2"
                    style={fieldControlStyle}
                  />
                )}
              </label>
            );
          })}
          {error ? <p className="text-sm">{error}</p> : null}
          <Button type="submit" disabled={canSubmitLead && status === "loading"}>
            {canSubmitLead ? (status === "loading" ? "Sending…" : "Get a Quote") : "Preview only"}
          </Button>
        </form>
      )}
    </div>
  );
}

export { NamedLayout } from "./named-layout.tsx";
