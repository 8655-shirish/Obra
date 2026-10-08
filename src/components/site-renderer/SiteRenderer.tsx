import { Pencil, Sparkles, Trash2, Upload } from "lucide-react";
import { m } from "motion/react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  GalleryProvider,
  Media,
  MediaGallery,
  ReviewSourceBadge,
  TrustMarkerList,
} from "@/components/site-kit";
import { CANONICAL_SECTION_ORDER } from "@/lib/agent/section-order";
import type { SiteConfig, TrustMarker } from "@/lib/agent/site-config.server";
import { ALLOWED_MEDIA_MIME_TYPES } from "@/lib/media-validation";
import {
  curateSiteEvidence,
  evidenceMediaItems,
  type EvidenceMediaItem,
  generatedMediaItems,
  type LookAndFeelSkin,
} from "@/lib/site-evidence";
import {
  hexContrastRatio,
  inkOnPrimaryHex,
  AA_CONTRAST_MIN,
  INK_ON_PRIMARY_DARK,
  INK_ON_PRIMARY_LIGHT,
} from "@/lib/site-theme/design-spec";

import { LeadCaptureForm } from "./LeadCaptureForm";
import {
  type EntrancePreset,
  SiteMotionRoot,
  getEntranceProps,
  getPressableProps,
  getStaggerContainerProps,
  getStaggerItemProps,
  shouldStaggerList,
} from "./motion-presets";

type SiteConfigView = SiteConfig | Record<string, unknown>;

type SectionView = {
  id: string;
  type: string;
  heading: string;
  body: string;
  html?: string;
  entrance?: EntrancePreset;
  stagger?: boolean;
};

type MediaItem = EvidenceMediaItem;

function persistableMediaItem(item: MediaItem): MediaItem {
  return { ...item };
}
type ReviewItem = { quote: string; author?: string; source?: string };
type LeadField = { id: string; label: string; required: boolean };

export type EditCategory = "content" | "logos" | "media" | "reviews" | "contact" | "service_form";

function asConfig(config: SiteConfigView): SiteConfig & {
  logoUrl?: string;
  logoStoragePath?: string | null;
  mediaGallery?: MediaItem[];
  contactHidden?: boolean;
  extraReviews?: ReviewItem[];
  lead_form_fields?: LeadField[];
  trustMarkers?: TrustMarker[];
  phone?: string;
  address?: string;
  hours?: string;
  warranty?: string;
} {
  return config as SiteConfig & {
    logoUrl?: string;
    logoStoragePath?: string | null;
    mediaGallery?: MediaItem[];
    contactHidden?: boolean;
    extraReviews?: ReviewItem[];
    lead_form_fields?: LeadField[];
    trustMarkers?: TrustMarker[];
    phone?: string;
    address?: string;
    hours?: string;
    warranty?: string;
  };
}

const TAGLINE_PLACEHOLDER = "Add a tagline";

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function inkOnFill(hex: string): string {
  return inkOnPrimaryHex(hex);
}

/** Primary as text on a light band — a light yellow on white is unreadable. */
function inkAsAccent(hex: string): string {
  return hexContrastRatio(hex, INK_ON_PRIMARY_LIGHT) >= AA_CONTRAST_MIN ? hex : INK_ON_PRIMARY_DARK;
}

function servicesIntroIsListDuplicate(
  body: string,
  services: unknown,
  serviceList: string[],
): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const bodyN = norm(body);
  if (!bodyN) return false;
  let joined = "";
  if (Array.isArray(services)) {
    joined = services
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join(", ");
  } else if (typeof services === "string") {
    joined = services.trim();
  } else {
    joined = serviceList.join(", ");
  }
  return bodyN === norm(joined);
}

function lookAndFeelSkin(feel: LookAndFeelSkin) {
  if (feel === "modern") {
    return {
      bandPad: "py-16 md:py-24",
      heroPad: "py-20 md:py-28",
      radius: "rounded-2xl",
      chipRadius: "rounded-2xl",
      cardRadius: "rounded-2xl",
      heroScrim: 0.72,
      muteAlternate: true,
      emphasizePrimary: false,
    };
  }
  if (feel === "funky") {
    return {
      bandPad: "py-14 md:py-20",
      heroPad: "py-16 md:py-24",
      radius: "rounded-xl",
      chipRadius: "rounded-full",
      cardRadius: "rounded-xl",
      heroScrim: 0.76,
      muteAlternate: false,
      emphasizePrimary: true,
    };
  }
  return {
    bandPad: "py-14 md:py-20",
    heroPad: "py-16 md:py-24",
    radius: "rounded-2xl",
    chipRadius: "rounded-full",
    cardRadius: "rounded-xl",
    heroScrim: 0.82,
    muteAlternate: true,
    emphasizePrimary: false,
  };
}

function isVideoMedia(item: { mimeType?: string; url?: string }): boolean {
  const mime = (item.mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  if (mime === "image/gif") return false;
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(item.url ?? "");
}

function heroPitch(
  section: SectionView,
  businessName: string,
  trade: string,
  city: string,
): string {
  const heading = section.heading?.trim() ?? "";
  if (heading && !namesMatch(heading, businessName)) return heading;
  const body = section.body?.trim() ?? "";
  if (body) return body;
  const parts = [trade, city].map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2) return `${parts[0]} in ${parts[1]}`;
  return parts[0] ?? "";
}

function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Cards from config.services only — section body is supporting prose, not a second list. */
function parseServiceList(services: unknown, _sectionBody: string): string[] {
  if (Array.isArray(services)) {
    const items = services
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    if (items.length > 0) return items;
  }
  if (typeof services === "string" && services.trim()) {
    const trimmed = services.trim();
    if (trimmed.includes(",")) return splitCommaList(trimmed);
    return [trimmed];
  }
  return [];
}

function phoneHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function mapsHref(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs text-primary opacity-80 hover:opacity-100"
      onClick={onClick}
    >
      <Pencil className="h-3 w-3" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}

function QuoteCta({
  primary,
  pressable,
  quiet = false,
  canOpenBooking = false,
  onOpenBooking,
  label,
}: {
  primary: string;
  pressable: ReturnType<typeof getPressableProps>;
  quiet?: boolean;
  canOpenBooking?: boolean;
  onOpenBooking?: () => void;
  label: string;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!canOpenBooking) return;
    event.preventDefault();
    onOpenBooking?.();
  }
  if (quiet) {
    return (
      <a
        href="#contact"
        className="inline-block text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        style={{ color: inkAsAccent(primary) }}
        onClick={onClick}
      >
        {label}
      </a>
    );
  }
  return (
    <m.a
      href="#contact"
      className="inline-block min-h-11 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style={{ backgroundColor: primary, color: inkOnFill(primary) }}
      {...pressable}
      onClick={onClick}
    >
      {label}
    </m.a>
  );
}

function Band({
  id,
  muted,
  isDark,
  className,
  padClass,
  children,
  entranceProps,
}: {
  id?: string;
  muted?: boolean;
  isDark: boolean;
  className?: string;
  padClass?: string;
  children: React.ReactNode;
  entranceProps: ReturnType<typeof getEntranceProps>;
}) {
  const band = muted
    ? isDark
      ? "bg-slate-900"
      : "bg-slate-50"
    : isDark
      ? "bg-slate-950"
      : "bg-white";
  return (
    <m.section
      id={id}
      className={`relative scroll-mt-20 ${band} ${className ?? ""}`}
      {...entranceProps}
    >
      <div className={`mx-auto max-w-6xl px-6 ${padClass ?? "py-14 md:py-20"}`}>{children}</div>
    </m.section>
  );
}

export function ServiceFormFieldEditor({
  fields,
  onSave,
}: {
  fields: LeadField[];
  onSave: (fields: LeadField[]) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(fields);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(fields);
    setDirty(false);
  }, [fields]);

  return (
    <div className="rounded-lg border border-dashed border-border p-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Service form fields (preview)</p>
      {draft.map((field, index) => (
        <div key={field.id} className="flex gap-2 text-sm">
          <input
            className="flex-1 rounded border border-input bg-background px-2 py-1"
            value={field.label}
            onChange={(e) => {
              const next = [...draft];
              next[index] = { ...field, label: e.target.value };
              setDraft(next);
              setDirty(true);
            }}
          />
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => {
                const next = [...draft];
                next[index] = { ...field, required: e.target.checked };
                setDraft(next);
                setDirty(true);
              }}
            />
            Required
          </label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const next = draft.filter((_, i) => i !== index);
              setDraft(next);
              setDirty(true);
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const id = `field-${Date.now()}`;
            setDraft([...draft, { id, label: "New field", required: false }]);
            setDirty(true);
          }}
        >
          Add field
        </Button>
        {dirty && (
          <Button
            size="sm"
            onClick={() => void Promise.resolve(onSave(draft)).then(() => setDirty(false))}
          >
            Save form fields
          </Button>
        )}
      </div>
    </div>
  );
}

function orderSectionsForRender(
  sections: SectionView[],
  opts: {
    hasGallery: boolean;
    canEditMedia: boolean;
    canEditReviews: boolean;
    canEditContent: boolean;
    trustMarkers: TrustMarker[];
    licenseNumber?: string;
    extraReviewsCount: number;
    serviceCount: number;
    warranty?: string | null;
    hours?: string | null;
  },
): SectionView[] {
  const byType = new Map<string, SectionView>();
  for (const section of sections) {
    if (!byType.has(section.type)) byType.set(section.type, section);
  }

  const trustMarkers =
    opts.trustMarkers.length > 0
      ? opts.trustMarkers
      : opts.licenseNumber
        ? [
            {
              id: "license",
              kind: "license",
              label: "Licensed",
              detail: `#${opts.licenseNumber}`,
            },
          ]
        : [];

  if (!byType.has("trustmarkers") && trustMarkers.length > 0) {
    byType.set("trustmarkers", {
      id: "fallback-trustmarkers",
      type: "trustmarkers",
      heading: "Trusted credentials",
      body: "",
    });
  }

  const showBeforeAfterSlot = opts.hasGallery || opts.canEditMedia;
  if (!byType.has("beforeAfter") && showBeforeAfterSlot) {
    byType.set("beforeAfter", {
      id: "fallback-beforeAfter",
      type: "beforeAfter",
      heading: "Our work",
      body: "Project photos from recent jobs.",
    });
  }

  if (!byType.has("footer")) {
    byType.set("footer", {
      id: "fallback-footer",
      type: "footer",
      heading: "",
      body: "",
    });
  }

  if (!byType.has("warranty") && opts.warranty?.trim()) {
    byType.set("warranty", {
      id: "fallback-warranty",
      type: "warranty",
      heading: "Warranty",
      body: opts.warranty.trim(),
    });
  }

  if (!byType.has("hours") && opts.hours?.trim()) {
    byType.set("hours", {
      id: "fallback-hours",
      type: "hours",
      heading: "Hours",
      body: opts.hours.trim(),
    });
  }

  return CANONICAL_SECTION_ORDER.filter((type) => {
    if (type === "trustmarkers" && trustMarkers.length === 0) return false;
    if (type === "beforeAfter" && !showBeforeAfterSlot) return false;
    if (type === "reviews" && opts.extraReviewsCount === 0 && !opts.canEditReviews) return false;
    if (type === "warranty" && !opts.warranty?.trim() && !byType.get("warranty")?.body?.trim()) {
      return false;
    }
    if (type === "hours" && !opts.hours?.trim() && !byType.get("hours")?.body?.trim()) {
      return false;
    }
    if (type === "services" && opts.serviceCount === 0 && !opts.canEditContent) {
      const services = byType.get("services");
      const hasIntro = Boolean(services?.heading?.trim() || services?.body?.trim());
      if (!hasIntro) return false;
    }
    return byType.has(type);
  })
    .map((type) => byType.get(type))
    .filter((s): s is SectionView => Boolean(s));
}

function MediaGalleryGrid({
  mediaGallery,
  canonicalGallery,
  persistGallery,
  canEditMedia,
  onConfigEdit,
  mediaInputRef,
  handleGalleryFile,
  staggerContainer,
  staggerItem,
  cardRadius,
}: {
  mediaGallery: MediaItem[];
  canonicalGallery: MediaItem[];
  persistGallery: MediaItem[];
  canEditMedia: boolean;
  onConfigEdit?: (category: EditCategory, patch: Record<string, unknown>) => void | Promise<void>;
  mediaInputRef: React.RefObject<HTMLInputElement | null>;
  handleGalleryFile: (file: File) => Promise<void>;
  staggerContainer: ReturnType<typeof getStaggerContainerProps>;
  staggerItem: ReturnType<typeof getStaggerItemProps>;
  cardRadius: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {canEditMedia && (
          <PencilButton label="Add media" onClick={() => mediaInputRef.current?.click()} />
        )}
      </div>
      <m.div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" {...staggerContainer}>
        {mediaGallery.map((item, index) => (
          <m.div
            key={`${item.url}-${index}`}
            className={`relative overflow-hidden ${cardRadius}`}
            {...staggerItem}
          >
            <Media
              item={item}
              galleryIndex={canonicalGallery.indexOf(item)}
              lazy
              className="aspect-[4/3] w-full object-cover"
            />
            {canEditMedia && onConfigEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 h-7 w-full"
                onClick={(event) => {
                  event.stopPropagation();
                  const key = item.storagePath || item.url || "";
                  const next = persistGallery
                    .filter(
                      (galleryItem) => (galleryItem.storagePath || galleryItem.url || "") !== key,
                    )
                    .map(persistableMediaItem)
                    .filter((galleryItem) => galleryItem.storagePath || galleryItem.url);
                  void onConfigEdit("media", { mediaGallery: next });
                }}
              >
                Remove
              </Button>
            )}
          </m.div>
        ))}
      </m.div>
      {canEditMedia && (
        <input
          ref={mediaInputRef}
          type="file"
          className="hidden"
          accept={ALLOWED_MEDIA_MIME_TYPES.join(",")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleGalleryFile(file);
            e.target.value = "";
          }}
        />
      )}
    </div>
  );
}

export function SiteRenderer({
  config,
  websiteId,
  showLeadForm = false,
  enableMotion = true,
  canOpenBooking = false,
  onOpenBooking,
  editCategories = [],
  onSectionEdit,
  onConfigEdit,
  onUploadMedia,
  onSuggestCopy,
}: {
  config: SiteConfigView;
  websiteId?: string;
  showLeadForm?: boolean;
  /** When false, mounts already-visible (workspace editing). Default true for public /lp. */
  enableMotion?: boolean;
  canOpenBooking?: boolean;
  onOpenBooking?: () => void;
  editCategories?: string[];
  onSectionEdit?: (sectionId: string, patch: { heading?: string; body?: string }) => void;
  onConfigEdit?: (category: EditCategory, patch: Record<string, unknown>) => void | Promise<void>;
  onUploadMedia?: (file: File) => Promise<
    | (EvidenceMediaItem & {
        url: string;
        mimeType: string;
        storagePath: string;
      })
    | null
  >;
  onSuggestCopy?: (sectionId: string) => Promise<string | null>;
}) {
  const c = asConfig(config);
  const conversionCtaLabel = canOpenBooking ? "Book Appointment" : "Get a Quote";
  const rawMediaGallery = Array.isArray(c.mediaGallery) ? c.mediaGallery : [];
  const rawExtraReviews = Array.isArray(c.extraReviews) ? c.extraReviews : [];
  const evidence = curateSiteEvidence({
    mediaGallery: rawMediaGallery,
    extraReviews: rawExtraReviews,
    trustMarkers: c.trustMarkers,
    lookAndFeel: c.lookAndFeel,
    trade: c.trade,
  });
  const skin = lookAndFeelSkin(evidence.lookAndFeel);
  const isDark = c.theme === "dark";
  const primary = c.primaryColor ?? "#1e3a5f";
  const businessName = String(c.businessName ?? "").trim();
  const trade = String(c.trade ?? "").trim();
  const city = String(c.city ?? "").trim();
  const heroLayout = c.heroLayout === "split" ? "split" : "centered";
  const canEditContent = editCategories.includes("content");
  const canEditLogos = editCategories.includes("logos");
  const canEditMedia = editCategories.includes("media");
  const canEditReviews = editCategories.includes("reviews");
  const canEditContact = editCategories.includes("contact");
  const canEditServiceForm = editCategories.includes("service_form");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  const mediaGallery = evidence.mediaGallery;
  const workGallery = evidenceMediaItems(mediaGallery);
  const extraReviews = evidence.extraReviews;
  const leadFields = Array.isArray(c.lead_form_fields) ? c.lead_form_fields : undefined;
  const trustMarkers = evidence.trustMarkers;
  const heroPhoto =
    workGallery.find((item) => item.url && !isVideoMedia(item)) ??
    generatedMediaItems(mediaGallery).find((item) => item.url && !isVideoMedia(item));
  const gridGallery = heroPhoto?.url
    ? workGallery.filter((item) => item.url !== heroPhoto.url)
    : workGallery;
  const sections = (c.sections as SectionView[] | undefined) ?? [];
  const servicesSection = sections.find((s) => s.type === "services");
  const serviceList = parseServiceList(c.services, servicesSection?.body ?? "");
  const showServicesIntro = Boolean(
    servicesSection?.body?.trim() &&
    !servicesIntroIsListDuplicate(servicesSection.body, c.services, serviceList),
  );

  const orderedSections = orderSectionsForRender(sections, {
    hasGallery: gridGallery.length > 0,
    canEditMedia,
    canEditReviews,
    canEditContent,
    trustMarkers,
    licenseNumber: c.licenseNumber,
    extraReviewsCount: extraReviews.length,
    serviceCount: serviceList.length,
    warranty: typeof c.warranty === "string" ? c.warranty : null,
    hours: typeof c.hours === "string" ? c.hours : null,
  });

  const effectiveTrustMarkers =
    trustMarkers.length > 0
      ? trustMarkers
      : c.licenseNumber
        ? [
            {
              id: "license",
              kind: "license",
              label: "Licensed",
              detail: `#${c.licenseNumber}`,
            } satisfies TrustMarker,
          ]
        : [];

  const staggerContainer = getStaggerContainerProps(enableMotion);
  const staggerItem = getStaggerItemProps(enableMotion);
  const pressable = getPressableProps(enableMotion);

  function canEditSectionText(section: SectionView): boolean {
    if (!onSectionEdit) return false;
    if (canEditContent) return true;
    return canEditContact && section.type === "contact";
  }

  async function handleLogoFile(file: File) {
    if (!onUploadMedia || !onConfigEdit) return;
    const uploaded = await onUploadMedia(file);
    if (!uploaded?.url) return;
    await onConfigEdit("logos", { logoStoragePath: uploaded.storagePath, logoUrl: null });
  }

  async function handleGalleryFile(file: File) {
    if (!onUploadMedia || !onConfigEdit) return;
    const uploaded = await onUploadMedia(file);
    if (!uploaded?.url) return;
    const persistGallery = rawMediaGallery
      .map(persistableMediaItem)
      .filter((item) => item.storagePath || item.url);
    const nextGallery = [...persistGallery, uploaded];
    await onConfigEdit("media", { mediaGallery: nextGallery });
  }

  function saveHeroTagline(section: SectionView, tagline: string) {
    const trimmed = tagline.trim();
    if (trimmed === TAGLINE_PLACEHOLDER) return;
    onSectionEdit?.(section.id, { heading: businessName || section.heading, body: trimmed });
  }

  const footerLine = [
    businessName || null,
    c.licenseNumber ? `Licensed #${c.licenseNumber}` : null,
    city || null,
    c.phone || null,
    c.address || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const showLogoSlot = canEditLogos || Boolean(c.logoUrl || c.logoStoragePath);
  const mutedTypes = new Set(["trustmarkers", "beforeAfter", "contact"]);

  function sectionEditors(section: SectionView, opts?: { taglineOnly?: boolean }) {
    const sectionEditable = canEditSectionText(section);
    return (
      <div className="absolute right-6 top-4 z-10 flex gap-1">
        {sectionEditable && (
          <>
            <PencilButton
              label="Edit"
              onClick={() => {
                if (opts?.taglineOnly) {
                  const current = heroPitch(section, businessName, trade, city);
                  const body = prompt("Tagline", current) ?? current;
                  saveHeroTagline(section, body);
                  return;
                }
                const heading = prompt("Heading", section.heading) ?? section.heading;
                const body = prompt("Body", section.body) ?? section.body;
                onSectionEdit!(section.id, { heading, body });
              }}
            />
            {onSuggestCopy && canEditContent && (
              <button
                type="button"
                title="Ask AI"
                className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-2 py-1 text-xs text-violet-700 dark:text-violet-300"
                onClick={() =>
                  void onSuggestCopy(section.id).then((copy) => {
                    if (!copy) return;
                    if (opts?.taglineOnly) saveHeroTagline(section, copy);
                    else onSectionEdit!(section.id, { body: copy });
                  })
                }
              >
                <Sparkles className="h-3 w-3" />
                <span className="sr-only sm:not-sr-only">Ask AI</span>
              </button>
            )}
          </>
        )}
        {canEditContact && section.type === "contact" && onConfigEdit && (
          <PencilButton
            label="Hide contact"
            onClick={() => void onConfigEdit("contact", { contactHidden: true })}
          />
        )}
        {canEditReviews && section.type === "reviews" && onConfigEdit && (
          <PencilButton
            label="Add quote"
            onClick={() => {
              const quote = prompt("Customer quote");
              if (!quote?.trim()) return;
              const author = prompt("Author (optional)") ?? undefined;
              void onConfigEdit("reviews", {
                extraReviews: [
                  ...rawExtraReviews,
                  { quote: quote.trim(), author, source: "manual" },
                ],
              });
            }}
          />
        )}
      </div>
    );
  }

  function renderLogo(heroInk: string) {
    return (
      <div className="flex items-center gap-3">
        {c.logoUrl ? (
          <img
            src={c.logoUrl}
            alt={`${businessName || "Business"} logo`}
            className="h-14 w-auto object-contain"
          />
        ) : canEditLogos ? (
          <div
            className="flex h-14 w-28 items-center justify-center rounded border border-dashed text-xs opacity-80"
            style={{ borderColor: `${heroInk}66` }}
          >
            No logo
          </div>
        ) : null}
        {canEditLogos && onConfigEdit && (
          <div className="flex gap-2">
            <PencilButton label="Upload logo" onClick={() => logoInputRef.current?.click()} />
            {c.logoUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onConfigEdit("logos", { logoStoragePath: null, logoUrl: null })}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            <input
              ref={logoInputRef}
              type="file"
              className="hidden"
              accept={ALLOWED_MEDIA_MIME_TYPES.join(",")}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLogoFile(file);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>
    );
  }

  function renderHero(section: SectionView) {
    const pitch = heroPitch(section, businessName, trade, city);
    const heroFill = isDark ? "#0b1220" : primary;
    const heroInk = inkOnFill(heroFill);
    const photoUrl = heroPhoto?.url;
    const copy = (
      <div className={heroLayout === "centered" ? "mx-auto max-w-3xl text-center" : "max-w-xl"}>
        {showLogoSlot && heroLayout === "centered" ? (
          <div className="mb-6 flex justify-center">{renderLogo(heroInk)}</div>
        ) : null}
        {showLogoSlot && heroLayout === "split" ? (
          <div className="mb-6">{renderLogo(heroInk)}</div>
        ) : null}
        <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
          {businessName || "Your Business"}
        </h1>
        {pitch ? (
          <p
            className="mt-4 text-lg leading-relaxed opacity-90 md:text-xl"
            contentEditable={canEditSectionText(section)}
            suppressContentEditableWarning
            onBlur={(e) => saveHeroTagline(section, e.currentTarget.textContent ?? "")}
          >
            {pitch}
          </p>
        ) : canEditSectionText(section) ? (
          <p
            className="mt-4 text-lg leading-relaxed opacity-50 md:text-xl"
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => saveHeroTagline(section, e.currentTarget.textContent ?? "")}
          >
            {TAGLINE_PLACEHOLDER}
          </p>
        ) : null}
        {(!c.contactHidden || canOpenBooking) && (
          <div className="mt-8">
            <QuoteCta
              primary={primary}
              pressable={pressable}
              canOpenBooking={canOpenBooking}
              onOpenBooking={onOpenBooking}
              label={conversionCtaLabel}
            />
          </div>
        )}
      </div>
    );

    if (heroLayout === "centered" && photoUrl) {
      return (
        <m.section
          className="relative min-h-[22rem] overflow-hidden md:min-h-[28rem]"
          {...getEntranceProps(section.entrance, enableMotion)}
        >
          <div className="absolute inset-0">
            <Media
              item={heroPhoto}
              galleryIndex={mediaGallery.indexOf(heroPhoto!)}
              priority
              className="h-full w-full object-cover"
            />
          </div>
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundColor: heroFill, opacity: skin.heroScrim }}
            aria-hidden
          />
          {sectionEditors(section, { taglineOnly: true })}
          <div
            className={`pointer-events-none relative mx-auto max-w-6xl px-6 ${skin.heroPad}`}
            style={{ color: heroInk }}
          >
            <div className="pointer-events-auto">{copy}</div>
          </div>
        </m.section>
      );
    }

    return (
      <m.section
        className="relative"
        style={{ backgroundColor: heroFill }}
        {...getEntranceProps(section.entrance, enableMotion)}
      >
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              heroLayout === "split"
                ? isDark
                  ? "#0b1220"
                  : `linear-gradient(90deg, ${primary} 0%, ${primary}ee 55%, ${primary}cc 100%)`
                : isDark
                  ? "#0b1220"
                  : `linear-gradient(180deg, ${primary} 0%, ${primary}dd 100%)`,
          }}
        />
        {sectionEditors(section, { taglineOnly: true })}
        <div
          className={`relative mx-auto max-w-6xl px-6 ${skin.heroPad}`}
          style={{ color: heroInk }}
        >
          {heroLayout === "split" && photoUrl ? (
            <div className="grid items-center gap-10 md:grid-cols-2">
              {copy}
              <Media
                item={heroPhoto}
                galleryIndex={mediaGallery.indexOf(heroPhoto!)}
                priority
                className={`min-h-[16rem] w-full object-cover md:min-h-[24rem] ${skin.radius}`}
              />
            </div>
          ) : (
            copy
          )}
        </div>
      </m.section>
    );
  }

  return (
    <GalleryProvider items={mediaGallery}>
      <SiteMotionRoot>
        <div
          className={`min-h-full w-full ${isDark ? "bg-slate-950 text-slate-50" : "bg-white text-slate-900"}`}
          data-enable-motion={enableMotion ? "true" : "false"}
          data-contact-available={c.contactHidden ? "false" : "true"}
        >
          {c.contactHidden ? (
            <style>{`[data-contact-available="false"] a[href="#contact"]{display:none!important}`}</style>
          ) : null}

          {orderedSections.map((section, index) => {
            if (section.type === "contact" && c.contactHidden) {
              return canEditContact ? (
                <section key={section.id} id="contact" className="mx-auto max-w-6xl px-6 py-8">
                  <div className="rounded-lg border border-dashed border-border p-4">
                    <p className="text-sm text-muted-foreground">
                      Contact section hidden on live site.
                    </p>
                    {onConfigEdit && (
                      <Button
                        size="sm"
                        className="mt-2"
                        variant="outline"
                        onClick={() => void onConfigEdit("contact", { contactHidden: false })}
                      >
                        Show contact section
                      </Button>
                    )}
                  </div>
                </section>
              ) : null;
            }

            if (section.type === "trustmarkers" && effectiveTrustMarkers.length === 0) {
              return null;
            }

            if (section.type === "beforeAfter" && gridGallery.length === 0 && !canEditMedia) {
              return null;
            }

            if (section.type === "reviews" && extraReviews.length === 0 && !canEditReviews) {
              return null;
            }

            const entranceProps = getEntranceProps(section.entrance, enableMotion);
            const useReviewStagger = shouldStaggerList(section.stagger);
            const muted = skin.muteAlternate && (mutedTypes.has(section.type) || index % 2 === 1);

            if (section.type === "hero") {
              return <div key={section.id}>{renderHero(section)}</div>;
            }

            const cardTone = skin.emphasizePrimary
              ? { borderColor: primary, backgroundColor: isDark ? `${primary}33` : `${primary}14` }
              : undefined;
            const cardClass = `${skin.cardRadius} border p-5 ${
              skin.emphasizePrimary
                ? ""
                : isDark
                  ? "border-slate-700 bg-slate-900"
                  : "border-slate-200 bg-white"
            }`;
            if (section.type === "trustmarkers") {
              const chipClass = `${skin.chipRadius} border px-4 py-2 text-sm ${
                skin.emphasizePrimary
                  ? ""
                  : isDark
                    ? "border-slate-700 bg-slate-800"
                    : "border-slate-200 bg-white"
              }`;
              const chipStyle = skin.emphasizePrimary
                ? { backgroundColor: primary, color: inkOnFill(primary), borderColor: primary }
                : undefined;
              return (
                <Band
                  key={section.id}
                  muted={skin.muteAlternate}
                  isDark={isDark}
                  entranceProps={entranceProps}
                  padClass={skin.bandPad}
                >
                  {sectionEditors(section)}
                  {section.heading ? (
                    <h2
                      className="mb-8 text-center text-3xl font-semibold tracking-tight md:text-4xl"
                      contentEditable={canEditSectionText(section)}
                      suppressContentEditableWarning
                      onBlur={(e) =>
                        onSectionEdit?.(section.id, { heading: e.currentTarget.textContent ?? "" })
                      }
                    >
                      {section.heading}
                    </h2>
                  ) : null}
                  <TrustMarkerList
                    markers={effectiveTrustMarkers}
                    chipClassName={chipClass}
                    chipStyle={chipStyle}
                    detailClassName={skin.emphasizePrimary ? "opacity-80" : "text-muted-foreground"}
                  />
                </Band>
              );
            }

            return (
              <Band
                key={section.id}
                id={section.type === "contact" ? "contact" : undefined}
                muted={muted}
                isDark={isDark}
                entranceProps={entranceProps}
                padClass={skin.bandPad}
                className={section.type === "footer" ? "border-t border-border" : undefined}
              >
                {sectionEditors(section)}

                {section.type === "services" && (
                  <>
                    {section.heading ? (
                      <h2
                        className="text-3xl font-semibold tracking-tight md:text-4xl"
                        contentEditable={canEditSectionText(section)}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, {
                            heading: e.currentTarget.textContent ?? "",
                          })
                        }
                      >
                        {section.heading}
                      </h2>
                    ) : null}
                    {showServicesIntro ? (
                      <p
                        className="mt-3 max-w-2xl whitespace-pre-line text-base leading-relaxed opacity-90"
                        contentEditable={canEditSectionText(section)}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, { body: e.currentTarget.textContent ?? "" })
                        }
                      >
                        {section.body}
                      </p>
                    ) : canEditSectionText(section) && serviceList.length > 0 ? (
                      <p
                        className="mt-3 max-w-2xl whitespace-pre-line text-base leading-relaxed opacity-50"
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, { body: e.currentTarget.textContent ?? "" })
                        }
                      >
                        {""}
                      </p>
                    ) : null}
                    {serviceList.length > 0 ? (
                      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {serviceList.map((item) => (
                          <li
                            key={item}
                            className={`${cardClass} text-base font-medium`}
                            style={cardTone}
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : canEditContent ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Service cards come from onboarding services. Change the list there, then
                        regenerate.
                      </p>
                    ) : section.body ? (
                      <p className="mt-3 max-w-2xl whitespace-pre-line text-base leading-relaxed opacity-90">
                        {section.body}
                      </p>
                    ) : null}
                    {!canOpenBooking && !c.contactHidden && serviceList.length > 0 && (
                      <div className="mt-8">
                        <QuoteCta
                          primary={primary}
                          pressable={pressable}
                          quiet
                          canOpenBooking={canOpenBooking}
                          onOpenBooking={onOpenBooking}
                          label={conversionCtaLabel}
                        />
                      </div>
                    )}
                  </>
                )}

                {section.type === "beforeAfter" && (
                  <>
                    <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Our work</h2>
                    <p className="mt-3 max-w-2xl text-base leading-relaxed opacity-90">
                      Project photos from recent jobs.
                    </p>
                    <div className="mt-8">
                      {gridGallery.length > 0 ? (
                        canEditMedia && onConfigEdit ? (
                          <MediaGalleryGrid
                            mediaGallery={gridGallery}
                            canonicalGallery={mediaGallery}
                            persistGallery={rawMediaGallery}
                            canEditMedia={canEditMedia}
                            onConfigEdit={onConfigEdit}
                            mediaInputRef={mediaInputRef}
                            handleGalleryFile={handleGalleryFile}
                            staggerContainer={staggerContainer}
                            staggerItem={staggerItem}
                            cardRadius={skin.cardRadius}
                          />
                        ) : (
                          <MediaGallery
                            media={gridGallery}
                            excludeFirst={false}
                            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                          />
                        )
                      ) : canEditMedia && onConfigEdit ? (
                        <div className="rounded-lg border border-dashed border-border p-8 text-center">
                          <p className="text-sm text-muted-foreground">No project photos yet.</p>
                          <Button
                            size="sm"
                            className="mt-2"
                            variant="outline"
                            onClick={() => mediaInputRef.current?.click()}
                          >
                            <Upload className="mr-1 h-3 w-3" />
                            Upload media
                          </Button>
                          <input
                            ref={mediaInputRef}
                            type="file"
                            className="hidden"
                            accept={ALLOWED_MEDIA_MIME_TYPES.join(",")}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleGalleryFile(file);
                              e.target.value = "";
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </>
                )}

                {section.type === "reviews" && (
                  <>
                    <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                      {section.heading?.trim() || "Reviews"}
                    </h2>
                    {extraReviews.length > 0 ? (
                      <m.ul
                        className="mt-8 grid gap-4 md:grid-cols-2"
                        {...(useReviewStagger ? staggerContainer : {})}
                      >
                        {extraReviews.map((r, i) => (
                          <m.li
                            key={i}
                            className={cardClass}
                            style={cardTone}
                            {...(useReviewStagger ? staggerItem : {})}
                          >
                            <div className="flex justify-between gap-2">
                              <div>
                                <p className="text-base leading-relaxed">“{r.quote}”</p>
                                {(r.author || r.source) && (
                                  <div className="mt-3 space-y-1">
                                    {r.author ? (
                                      <p className="text-sm text-muted-foreground">— {r.author}</p>
                                    ) : null}
                                    {r.source ? <ReviewSourceBadge source={r.source} /> : null}
                                  </div>
                                )}
                              </div>
                              {canEditReviews && onConfigEdit && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    let removed = false;
                                    const next = rawExtraReviews.filter((item) => {
                                      if (
                                        !removed &&
                                        item.quote === r.quote &&
                                        item.author === r.author
                                      ) {
                                        removed = true;
                                        return false;
                                      }
                                      return true;
                                    });
                                    void onConfigEdit("reviews", { extraReviews: next });
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </m.li>
                        ))}
                      </m.ul>
                    ) : canEditReviews ? (
                      <p className="mt-4 text-sm text-muted-foreground">No quotes yet.</p>
                    ) : null}
                    {!canOpenBooking &&
                      !c.contactHidden &&
                      extraReviews.length > 0 &&
                      serviceList.length === 0 && (
                        <div className="mt-8">
                          <QuoteCta
                            primary={primary}
                            pressable={pressable}
                            quiet
                            canOpenBooking={canOpenBooking}
                            onOpenBooking={onOpenBooking}
                            label={conversionCtaLabel}
                          />
                        </div>
                      )}
                  </>
                )}

                {section.type === "contact" && (
                  <>
                    {section.heading ? (
                      <h2
                        className="text-3xl font-semibold tracking-tight md:text-4xl"
                        contentEditable={canEditSectionText(section)}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, {
                            heading: e.currentTarget.textContent ?? "",
                          })
                        }
                      >
                        {section.heading}
                      </h2>
                    ) : (
                      <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
                        Request a quote
                      </h2>
                    )}
                    {section.body ? (
                      <p
                        className="mt-3 max-w-2xl text-base leading-relaxed opacity-90"
                        contentEditable={canEditSectionText(section)}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, { body: e.currentTarget.textContent ?? "" })
                        }
                      >
                        {section.body}
                      </p>
                    ) : null}
                    {(c.phone || c.address) && (
                      <p className="mt-4 text-base">
                        {c.phone ? (
                          <a
                            href={phoneHref(c.phone)}
                            className="font-medium hover:underline"
                            style={{ color: inkAsAccent(primary) }}
                          >
                            {c.phone}
                          </a>
                        ) : null}
                        {c.phone && c.address ? <span className="opacity-50"> · </span> : null}
                        {c.address ? (
                          <a
                            href={mapsHref(c.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {c.address}
                          </a>
                        ) : null}
                      </p>
                    )}
                    {websiteId && showLeadForm && (
                      <div className="mt-8 max-w-xl">
                        <LeadCaptureForm websiteId={websiteId} fields={leadFields} />
                      </div>
                    )}
                    {canEditServiceForm && onConfigEdit && !showLeadForm && (
                      <div className="mt-6">
                        <ServiceFormFieldEditor
                          fields={leadFields ?? []}
                          onSave={(next) =>
                            onConfigEdit("service_form", { lead_form_fields: next })
                          }
                        />
                      </div>
                    )}
                  </>
                )}

                {(section.type === "warranty" || section.type === "hours") && (
                  <>
                    {section.heading ? (
                      <h2
                        className="text-3xl font-semibold tracking-tight md:text-4xl"
                        contentEditable={canEditSectionText(section)}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, {
                            heading: e.currentTarget.textContent ?? "",
                          })
                        }
                      >
                        {section.heading}
                      </h2>
                    ) : null}
                    {section.body ? (
                      <p
                        className="mt-3 max-w-2xl whitespace-pre-line text-base leading-relaxed opacity-90"
                        contentEditable={canEditSectionText(section)}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onSectionEdit?.(section.id, { body: e.currentTarget.textContent ?? "" })
                        }
                      >
                        {section.body}
                      </p>
                    ) : null}
                  </>
                )}

                {section.type === "footer" && (
                  <p className="text-sm opacity-80 tabular-nums">{footerLine}</p>
                )}
              </Band>
            );
          })}
        </div>
      </SiteMotionRoot>
    </GalleryProvider>
  );
}
