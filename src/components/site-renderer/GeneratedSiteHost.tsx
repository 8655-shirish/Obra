import { Pencil, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { submitLead } from "@/lib/leads.functions";
import { ALLOWED_MEDIA_MIME_TYPES } from "@/lib/media-validation";
import type { EvidenceMediaItem } from "@/lib/site-evidence";
import { configToSiteProps } from "@/lib/site-theme/config-to-props";
import type { ThemeKitScope } from "@/lib/site-theme/kit-scope";
import type { SiteDesignSpec } from "@/lib/site-theme/types";

import type { EditCategory } from "./SiteRenderer";
import { ServiceFormFieldEditor } from "./SiteRenderer";

/** Last resort only: bootstrap never posted ready (blocked/404). Not the generated-page path. */
const RUNTIME_READY_TIMEOUT_MS = 4000;

type SectionRect = { id: string; top: number; height: number };

type SectionView = { id: string; type: string; heading: string; body: string };

export function GeneratedSiteHost({
  config,
  kitScope,
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
  onRuntimeError,
}: {
  config: Record<string, unknown>;
  kitScope: ThemeKitScope;
  websiteId?: string;
  showLeadForm?: boolean;
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
  onRuntimeError?: () => void;
}) {
  const token = useId().replace(/:/g, "");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const readyRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRuntimeErrorRef = useRef(onRuntimeError);
  onRuntimeErrorRef.current = onRuntimeError;
  const onOpenBookingRef = useRef(onOpenBooking);
  onOpenBookingRef.current = onOpenBooking;
  const [rects, setRects] = useState<SectionRect[]>([]);
  const [ready, setReady] = useState(false);
  const [runtimeFailed, setRuntimeFailed] = useState(false);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current === null) return;
    clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }, []);

  const props = useMemo(
    () =>
      configToSiteProps(config, {
        enableMotion,
        canSubmitLead: showLeadForm,
        canOpenBooking,
      }),
    [config, enableMotion, showLeadForm, canOpenBooking],
  );
  const designSpec =
    config.designSpec && typeof config.designSpec === "object"
      ? (config.designSpec as SiteDesignSpec)
      : null;
  const themeSource = String(config.themeSource ?? "");
  const isUnified = kitScope === "unified";
  const schemaVersion = config["generatorSchemaVersion"];
  const supportsGalleryEditing = !isUnified || schemaVersion === 3;
  // Catalog section rows are NamedLayout copy. Unified copy lives in themeSource;
  // overlaying those rows on invented HTML edits JSON that is not on the page.
  const sections = (
    isUnified ? [] : Array.isArray(config.sections) ? config.sections : []
  ) as SectionView[];

  const canEditContent = editCategories.includes("content");
  const canEditLogos = editCategories.includes("logos");
  const canEditMedia = editCategories.includes("media");
  const canEditReviews = editCategories.includes("reviews");
  const canEditContact = editCategories.includes("contact");
  const canEditServiceForm = editCategories.includes("service_form");

  const postInit = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      {
        type: "site-runtime-init",
        token,
        themeSource,
        props,
        designSpec,
        kitScope,
      },
      "*",
    );
  }, [token, themeSource, props, designSpec, kitScope]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "site-runtime-ready") {
        readyRef.current = true;
        clearFallbackTimer();
        setReady(true);
        postInit();
        return;
      }
      if (data.token !== token) return;
      if (data.type === "site-runtime-healthy") {
        readyRef.current = true;
        setRuntimeFailed(false);
        clearFallbackTimer();
      }
      if (data.type === "site-runtime-geometry") {
        readyRef.current = true;
        clearFallbackTimer();
        if (Array.isArray(data.sections)) setRects(data.sections as SectionRect[]);
      }
      if (data.type === "site-runtime-error") {
        setRuntimeFailed(true);
        onRuntimeError?.();
      }
      if (data.type === "open-booking") {
        onOpenBookingRef.current?.();
      }
      if (data.type === "lead-submit") {
        const frame = iframeRef.current?.contentWindow;
        const postResult = (payload: Record<string, unknown>) => {
          frame?.postMessage({ type: "lead-result", token, ...payload }, "*");
        };
        if (!showLeadForm || !websiteId) {
          postResult({ ok: false, preview: true });
          return;
        }
        const fields =
          data.fields && typeof data.fields === "object"
            ? (data.fields as Record<string, unknown>)
            : {};
        void submitLead({
          data: {
            websiteId,
            formData: fields,
            submissionId: typeof data.submissionId === "string" ? data.submissionId : undefined,
            companyWebsite:
              typeof data.companyWebsite === "string" ? data.companyWebsite : undefined,
          },
        })
          .then(() => postResult({ ok: true }))
          .catch((error: unknown) =>
            postResult({
              ok: false,
              error: error instanceof Error ? error.message : "Unable to submit",
            }),
          );
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token, postInit, onRuntimeError, showLeadForm, websiteId, clearFallbackTimer]);

  useEffect(() => () => clearFallbackTimer(), [clearFallbackTimer]);

  useEffect(() => {
    if (ready) postInit();
  }, [ready, postInit]);

  useEffect(() => {
    setRuntimeFailed(false);
  }, [themeSource, token]);

  function editSection(section: SectionView) {
    if (!onSectionEdit) return;
    const heading = prompt("Heading", section.heading) ?? section.heading;
    const body = prompt("Body", section.body) ?? section.body;
    onSectionEdit(section.id, { heading, body });
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
    const persist = Array.isArray(config.mediaGallery)
      ? [...(config.mediaGallery as Array<Record<string, unknown>>)]
      : [];
    await onConfigEdit("media", {
      mediaGallery: [...persist, uploaded],
    });
  }

  const showOverlay =
    canEditContent ||
    canEditLogos ||
    (canEditMedia && supportsGalleryEditing) ||
    canEditReviews ||
    canEditContact ||
    canEditServiceForm;

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      {showOverlay && (
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border bg-background px-3 py-2">
          {canEditLogos && (
            <Button size="sm" variant="outline" onClick={() => logoInputRef.current?.click()}>
              Upload logo
            </Button>
          )}
          {canEditMedia && supportsGalleryEditing && (
            <Button size="sm" variant="outline" onClick={() => mediaInputRef.current?.click()}>
              <Upload className="mr-1 h-3 w-3" />
              Add media
            </Button>
          )}
          {canEditReviews && onConfigEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const quote = prompt("Customer quote");
                if (!quote?.trim()) return;
                const author = prompt("Author (optional)") ?? undefined;
                const extra = Array.isArray(config.extraReviews)
                  ? [...(config.extraReviews as Array<Record<string, unknown>>)]
                  : [];
                void onConfigEdit("reviews", {
                  extraReviews: [...extra, { quote: quote.trim(), author, source: "manual" }],
                });
              }}
            >
              Add quote
            </Button>
          )}
          {canEditContact && onConfigEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void onConfigEdit("contact", { contactHidden: config.contactHidden !== true })
              }
            >
              {config.contactHidden === true ? "Show contact" : "Hide contact"}
            </Button>
          )}
          {rects.length === 0 &&
            canEditContent &&
            sections.map((section) => (
              <Button
                key={section.id}
                size="sm"
                variant="ghost"
                onClick={() => editSection(section)}
              >
                Edit {section.type}
              </Button>
            ))}
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
          <input
            ref={mediaInputRef}
            type="file"
            className="hidden"
            accept={(schemaVersion === 3
              ? ["image/png", "image/jpeg"]
              : ALLOWED_MEDIA_MIME_TYPES
            ).join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleGalleryFile(file);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {runtimeFailed ? (
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          The generated design could not be shown.
        </p>
      ) : null}
      <iframe
        ref={iframeRef}
        title={props.businessName}
        src="/site-runtime/host.html"
        sandbox="allow-scripts"
        className="min-h-0 w-full flex-1 border-0"
        onLoad={() => {
          readyRef.current = false;
          setReady(false);
          postInit();
          clearFallbackTimer();
          fallbackTimerRef.current = setTimeout(() => {
            fallbackTimerRef.current = null;
            if (!readyRef.current) {
              setRuntimeFailed(true);
              onRuntimeErrorRef.current?.();
            }
          }, RUNTIME_READY_TIMEOUT_MS);
        }}
      />
      {canEditContent &&
        rects.map((rect) => {
          const section = sections.find((item) => item.type === rect.id || item.id === rect.id);
          if (!section) return null;
          const iframeHeight = iframeRef.current?.clientHeight ?? 0;
          if (iframeHeight > 0 && (rect.top + rect.height < 8 || rect.top > iframeHeight - 8)) {
            return null;
          }
          return (
            <div
              key={rect.id}
              className="absolute right-4 z-10 flex gap-1"
              style={{ top: rect.top + (showOverlay ? 44 : 8) }}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 text-xs text-primary"
                onClick={() => editSection(section)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </button>
              {onSuggestCopy && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-2 py-1 text-xs text-violet-700"
                  onClick={() =>
                    void onSuggestCopy(section.id).then((copy) => {
                      if (copy) onSectionEdit?.(section.id, { body: copy });
                    })
                  }
                >
                  <Sparkles className="h-3 w-3" />
                  Ask AI
                </button>
              )}
            </div>
          );
        })}
      {canEditServiceForm && onConfigEdit && (
        <div className="border-t border-border bg-background px-3 py-3">
          <ServiceFormFieldEditor
            fields={props.leadFields}
            onSave={(next) => void onConfigEdit("service_form", { lead_form_fields: next })}
          />
        </div>
      )}
    </div>
  );
}
