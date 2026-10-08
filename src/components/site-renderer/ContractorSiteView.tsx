import { GeneratedSiteHost } from "./GeneratedSiteHost";
import { SiteRenderer, type EditCategory } from "./SiteRenderer";
import { classifySiteRenderMode, unavailableSiteMessage } from "@/lib/site-theme/render-mode";

export function ContractorSiteView({
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
  config: Record<string, unknown>;
  websiteId?: string;
  showLeadForm?: boolean;
  enableMotion?: boolean;
  canOpenBooking?: boolean;
  onOpenBooking?: () => void;
  editCategories?: string[];
  onSectionEdit?: (sectionId: string, patch: { heading?: string; body?: string }) => void;
  onConfigEdit?: (category: EditCategory, patch: Record<string, unknown>) => void | Promise<void>;
  onUploadMedia?: (file: File) => Promise<{
    url: string;
    mimeType: string;
    storagePath: string;
  } | null>;
  onSuggestCopy?: (sectionId: string) => Promise<string | null>;
}) {
  const renderMode = classifySiteRenderMode(config);

  if (renderMode.kind === "unavailable") {
    return (
      <div className="flex h-full min-h-48 items-center justify-center bg-background p-6">
        <p className="max-w-md text-center text-sm text-muted-foreground">
          {unavailableSiteMessage(renderMode.reason)}
        </p>
      </div>
    );
  }

  if (renderMode.kind === "generated") {
    return (
      <div className="h-full min-h-0">
        <GeneratedSiteHost
          config={config}
          kitScope={renderMode.scope}
          websiteId={websiteId}
          showLeadForm={showLeadForm}
          enableMotion={enableMotion}
          canOpenBooking={canOpenBooking}
          onOpenBooking={onOpenBooking}
          editCategories={editCategories}
          onSectionEdit={onSectionEdit}
          onConfigEdit={onConfigEdit}
          onUploadMedia={onUploadMedia}
          onSuggestCopy={onSuggestCopy}
        />
      </div>
    );
  }

  return (
    <SiteRenderer
      config={config}
      websiteId={websiteId}
      showLeadForm={showLeadForm}
      enableMotion={enableMotion}
      canOpenBooking={canOpenBooking}
      onOpenBooking={onOpenBooking}
      editCategories={editCategories}
      onSectionEdit={onSectionEdit}
      onConfigEdit={onConfigEdit}
      onUploadMedia={onUploadMedia}
      onSuggestCopy={onSuggestCopy}
    />
  );
}
