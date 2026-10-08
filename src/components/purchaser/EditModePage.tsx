import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";

import { Link, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { moldComponentFor } from "@/components/templates/molds";
import { buildTemplateMoldContent, getTemplateManifest } from "@/lib/template-content/overlay";
import type { TemplateOverlay } from "@/lib/template-content/overlay";
import {
  discardTemplateDraft,
  getTemplateDraft,
  improveTemplateText,
  saveTemplateContentEdit,
} from "@/lib/template-edit.functions";
import { approveWebsiteVersion } from "@/lib/agent.functions";
import { uploadSiteMedia } from "@/lib/upload.functions";
import { ALLOWED_IMAGE_MIME_TYPES, validateMediaUpload } from "@/lib/media-validation";

export interface EditModeDraft {
  versionId: string;
  revision: number;
  overlay: TemplateOverlay;
  mediaUrls: Record<string, string>;
  slug: string;
}

interface Box {
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

function isValidKey(slug: string, key: string): boolean {
  const manifest = getTemplateManifest(slug);
  if (!manifest) return false;
  if (key.startsWith("text."))
    return Object.prototype.hasOwnProperty.call(manifest.textBudgets, key.slice(5));
  if (key.startsWith("media.")) return manifest.mediaSlots.includes(key.slice(6));
  if (key === "contact.phone" || key === "contact.email") return true;
  const blog = key.match(/^blogs\.(\d+)\.(category|title|excerpt)$/);
  if (blog !== null && Number(blog[1]) < 3) return true;
  // Review quote/author nodes exist only on molds that render review lists
  // (e.g. plumber). Attribution is deliberately not a tap target: seeded
  // samples keep theirs, user-rewritten words keep theirs, and publish
  // validation requires completeness either way.
  const review = key.match(/^reviews\.(\d+)\.(quote|author)$/);
  return review !== null && Number(review[1]) < 10;
}

function validateStillUpload(file: File): string | null {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
    return "Unsupported file type. Use PNG or JPEG.";
  }
  const result = validateMediaUpload(file, "site");
  return result.ok ? null : result.error;
}

function stillAcceptAttr(): string {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).join(",");
}

function mediaDialogErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback;
  if (message.toLowerCase().includes("revision conflict")) {
    return "Updated underneath you — review and save again.";
  }
  return message;
}

function isWandKey(key: string): boolean {
  return key.startsWith("text.") || key.startsWith("blogs.");
}

function readKey(overlay: TemplateOverlay, key: string): string {
  if (key.startsWith("text.")) return (overlay.text[key.slice(5)] as string | undefined) ?? "";
  if (key === "contact.phone") return overlay.contact.phone ?? "";
  if (key === "contact.email") return overlay.contact.email ?? "";
  const blog = key.match(/^blogs\.(\d+)\.(category|title|excerpt)$/);
  if (blog) {
    const post = overlay.blogs[Number(blog[1])];
    return (post?.[blog[2] as "category" | "title" | "excerpt"] as string | undefined) ?? "";
  }
  const review = key.match(/^reviews\.(\d+)\.(quote|author)$/);
  if (review) {
    const item = overlay.reviews[Number(review[1])];
    return (item?.[review[2] as "quote" | "author"] as string | undefined) ?? "";
  }
  return "";
}

/**
 * Builds a server patch for one field. Empty text/media/contact values become
 * null, which the applier interprets as "restore the template default".
 * Blog strings pass through (drafts tolerate them; publish validation does not).
 */
function keyToPatch(key: string, value: string | null): Record<string, unknown> {
  if (key.startsWith("text.")) return { text: { [key.slice(5)]: value || null } };
  if (key.startsWith("media.")) return { media: { [key.slice(6)]: value || null } };
  if (key === "contact.phone") return { contact: { phone: value || null } };
  if (key === "contact.email") return { contact: { email: value || null } };
  return {};
}

/**
 * Applies one field edit to a base overlay. Null/empty text and media values
 * remove the key (restoring the template default); contact fields reset to
 * null; blog fields write through (drafts tolerate incompleteness, publish
 * validation does not).
 */
function applyValue(base: TemplateOverlay, key: string, value: string | null): TemplateOverlay {
  const next: TemplateOverlay = JSON.parse(JSON.stringify(base)) as TemplateOverlay;
  if (key.startsWith("text.")) {
    const slot = key.slice("text.".length);
    if (value) next.text[slot] = value;
    else delete next.text[slot];
  } else if (key.startsWith("media.")) {
    const slot = key.slice("media.".length);
    if (value) next.media[slot] = value;
    else delete next.media[slot];
  } else if (key === "contact.phone") {
    next.contact.phone = value || null;
  } else if (key === "contact.email") {
    next.contact.email = value || null;
  } else {
    const blog = key.match(/^blogs\.(\d+)\.(category|title|excerpt)$/);
    if (blog) {
      const index = Number(blog[1]);
      const field = blog[2] as "category" | "title" | "excerpt";
      while (next.blogs.length <= index) {
        next.blogs.push({ category: "", title: "", excerpt: "", image: null });
      }
      next.blogs[index][field] = value ?? "";
    }
    const review = key.match(/^reviews\.(\d+)\.(quote|author)$/);
    if (review) {
      const index = Number(review[1]);
      const field = review[2] as "quote" | "author";
      while (next.reviews.length <= index) {
        next.reviews.push({ quote: "", author: "", attribution: null });
      }
      next.reviews[index][field] = value ?? "";
    }
  }
  return next;
}

function buildPatch(
  key: string,
  value: string | null,
  overlay: TemplateOverlay,
): Record<string, unknown> {
  const blog = key.match(/^blogs\.(\d+)\.(category|title|excerpt)$/);
  if (blog) {
    return { blogs: applyValue(overlay, key, value).blogs };
  }
  const review = key.match(/^reviews\.(\d+)\.(quote|author)$/);
  if (review) {
    return { reviews: applyValue(overlay, key, value).reviews };
  }
  return keyToPatch(key, value);
}

function countLeafDiffs(a: TemplateOverlay, b: TemplateOverlay): number {
  let count = 0;
  const textKeys = new Set([...Object.keys(a.text), ...Object.keys(b.text)]);
  for (const key of textKeys) {
    if ((a.text[key] ?? "") !== (b.text[key] ?? "")) count += 1;
  }
  const mediaKeys = new Set([...Object.keys(a.media), ...Object.keys(b.media)]);
  for (const key of mediaKeys) {
    if ((a.media[key] ?? "") !== (b.media[key] ?? "")) count += 1;
  }
  if (JSON.stringify(a.reviews) !== JSON.stringify(b.reviews)) count += 1;
  if (JSON.stringify(a.blogs) !== JSON.stringify(b.blogs)) count += 1;
  for (const field of ["phone", "email", "area", "hours"] as const) {
    if ((a.contact[field] ?? "") !== (b.contact[field] ?? "")) count += 1;
  }
  return count;
}

export function EditModePage({
  userId,
  websiteId,
  initial,
}: {
  userId: string;
  websiteId: string;
  initial: EditModeDraft;
}) {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLDivElement>(null);
  const [versionId, setVersionId] = useState(initial.versionId);
  const [revision, setRevision] = useState(initial.revision);
  const [overlay, setOverlay] = useState<TemplateOverlay>(initial.overlay);
  const [mediaUrls, setMediaUrls] = useState(initial.mediaUrls);
  const [baseline] = useState<TemplateOverlay>(initial.overlay);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [mobileView, setMobileView] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<"delete" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; rect: Box; draft: string } | null>(null);
  const [toolbar, setToolbar] = useState<{ key: string; rect: Box } | null>(null);
  const [suggestion, setSuggestion] = useState<{ key: string; copy: string } | null>(null);
  const [wandBusy, setWandBusy] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<{ key: string } | null>(null);
  const [mediaCurrentSrc, setMediaCurrentSrc] = useState<string | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaDialogError, setMediaDialogError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dirtyCount = useMemo(() => countLeafDiffs(baseline, overlay), [baseline, overlay]);

  const content = useMemo(() => buildTemplateMoldContent(overlay, mediaUrls), [overlay, mediaUrls]);
  const MoldComponent = moldComponentFor(initial.slug);

  const relayout = useCallback(() => {
    const container = previewRef.current;
    if (!container) return;
    const frame = container.getBoundingClientRect();
    // Several molds annotate the same key on repeated nodes (e.g. every
    // tel: link carries contact.phone). First visible node wins so each key
    // gets exactly one outline and one edit button.
    const found = new Map<string, Box>();
    for (const node of Array.from(container.querySelectorAll<HTMLElement>("[data-tkey]"))) {
      const key = node.dataset.tkey ?? "";
      if (!isValidKey(initial.slug, key)) continue;
      if (found.has(key)) continue;
      // Innermost annotated node wins; ancestors with their own key stay interactive.
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      found.set(key, {
        key,
        top: rect.top - frame.top + container.scrollTop,
        left: rect.left - frame.left,
        width: rect.width,
        height: rect.height,
      });
    }
    setBoxes([...found.values()]);
  }, [initial.slug]);

  useEffect(() => {
    relayout();
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    // The mold preview is lazy-loaded: edit targets exist only after its DOM
    // mounts, which the initial pass can precede.
    const container = previewRef.current;
    const observer = new MutationObserver(() => relayout());
    if (container) observer.observe(container, { childList: true, subtree: true });
    const timer = setTimeout(relayout, 800);
    return () => {
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [relayout, overlay, mediaUrls, mobileView]);

  const commitPatch = useCallback(
    async (patch: Record<string, unknown>, apply: (base: TemplateOverlay) => TemplateOverlay) => {
      setSaving(true);
      setError(null);
      try {
        const result = await saveTemplateContentEdit({
          data: { websiteId, versionId, expectedRevision: revision, patch },
        });
        setVersionId(result.versionId);
        setRevision(result.revision);
        setOverlay(apply);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to save edit";
        if (message.includes("revision conflict")) {
          // Plan §8: reload the draft but keep the in-flight field value —
          // the editor stays open with the user's text so they can save again.
          try {
            const fresh = await getTemplateDraft({ data: { websiteId } });
            setVersionId(fresh.versionId);
            setRevision(fresh.revision);
            setOverlay(fresh.overlay);
            setMediaUrls(fresh.mediaUrls);
            setError("Updated underneath you — review and save again.");
          } catch {
            setError(message);
          }
        } else {
          setError(message);
        }
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [websiteId, versionId, revision],
  );

  const startEdit = useCallback(
    (key: string) => {
      if (key.startsWith("media.")) {
        setMediaFile(null);
        setMediaPreviewUrl((prev) => {
          if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
          return null;
        });
        setMediaDialogError(null);
        setMediaTarget({ key });
        requestAnimationFrame(() => {
          const node = previewRef.current?.querySelector<HTMLElement>(`[data-tkey="${key}"]`);
          const img =
            node?.tagName === "IMG"
              ? (node as HTMLImageElement)
              : (node?.querySelector("img") ?? null);
          const slot = key.slice("media.".length);
          setMediaCurrentSrc(img?.currentSrc || img?.src || mediaUrls[slot] || null);
        });
        return;
      }
      const node = previewRef.current?.querySelector<HTMLElement>(`[data-tkey="${key}"]`);
      const rect = node?.getBoundingClientRect();
      const frame = previewRef.current?.getBoundingClientRect();
      if (!node || !rect || !frame || !previewRef.current) return;
      setToolbar(null);
      setSuggestion(null);
      setEditing({
        key,
        rect: {
          key,
          top: rect.top - frame.top + previewRef.current.scrollTop,
          left: rect.left - frame.left,
          width: rect.width,
          height: Math.max(rect.height, 44),
        },
        draft: readKey(overlay, key),
      });
    },
    [overlay, mediaUrls],
  );

  const commitEdit = useCallback(
    async (key: string, value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Text cannot be empty.");
        return;
      }
      const previous = readKey(overlay, key);
      if (trimmed === previous) {
        setEditing(null);
        return;
      }
      try {
        await commitPatch(buildPatch(key, trimmed, overlay), (base) =>
          applyValue(base, key, trimmed),
        );
        const node = previewRef.current?.querySelector<HTMLElement>(`[data-tkey="${key}"]`);
        const rect = node?.getBoundingClientRect();
        const frame = previewRef.current?.getBoundingClientRect();
        if (node && rect && frame && previewRef.current) {
          setToolbar({
            key,
            rect: {
              key,
              top: rect.top - frame.top + previewRef.current.scrollTop,
              left: rect.left - frame.left,
              width: rect.width,
              height: rect.height,
            },
          });
        }
      } catch {
        // Error state already set by commitPatch; keep the editor open.
        return;
      }
      setEditing(null);
    },
    [commitPatch, overlay],
  );

  const improve = useCallback(
    async (key: string) => {
      if (!isWandKey(key)) return;
      setWandBusy(true);
      setError(null);
      try {
        const current = readKey(overlay, key);
        if (!current.trim()) {
          setError("Write something first, then improve it with AI.");
          return;
        }
        const result = await improveTemplateText({
          data: { websiteId, text: current, slotKey: key },
        });
        setSuggestion({ key, copy: result.copy });
      } catch (err) {
        setError(err instanceof Error ? err.message : "AI improvement is unavailable right now.");
      } finally {
        setWandBusy(false);
      }
    },
    [overlay, websiteId],
  );

  const acceptSuggestion = useCallback(async () => {
    if (!suggestion) return;
    const key = suggestion.key;
    const copy = suggestion.copy;
    setSuggestion(null);
    setToolbar(null);
    try {
      await commitPatch(buildPatch(key, copy, overlay), (base) => applyValue(base, key, copy));
    } catch {
      // Error state already set; value stays as the user left it.
    }
  }, [suggestion, commitPatch, overlay]);

  const resetItem = useCallback(async () => {
    if (!toolbar) return;
    const key = toolbar.key;
    setToolbar(null);
    setSuggestion(null);
    // Reset restores the page-load baseline value (absent baseline keys remove
    // the override, restoring the template default).
    const baseValue = readKey(baseline, key);
    try {
      await commitPatch(buildPatch(key, baseValue, baseline), (base) =>
        applyValue(base, key, baseValue),
      );
    } catch {
      // Error state already set.
    }
  }, [toolbar, baseline, commitPatch]);

  const closeMediaDialog = useCallback(() => {
    if (uploading) return;
    setMediaPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return null;
    });
    setMediaFile(null);
    setMediaDialogError(null);
    setMediaCurrentSrc(null);
    setMediaTarget(null);
  }, [uploading]);

  const pickStill = useCallback((file: File) => {
    const message = validateStillUpload(file);
    if (message) {
      setMediaDialogError(message);
      return;
    }
    setMediaDialogError(null);
    setMediaPreviewUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setMediaFile(file);
  }, []);

  const saveStill = useCallback(async () => {
    if (!mediaTarget || !mediaFile) return;
    const key = mediaTarget.key;
    const slot = key.startsWith("media.") ? key.slice("media.".length) : "";
    if (!slot) return;
    setUploading(true);
    setMediaDialogError(null);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error("Unable to read image"));
        reader.readAsDataURL(mediaFile);
      });
      const uploaded = await uploadSiteMedia({
        data: {
          websiteId,
          fileName: mediaFile.name,
          mimeType: mediaFile.type,
          size: mediaFile.size,
          base64,
        },
      });
      await commitPatch({ media: { [slot]: uploaded.storagePath } }, (base) => {
        const next: TemplateOverlay = JSON.parse(JSON.stringify(base)) as TemplateOverlay;
        next.media[slot] = uploaded.storagePath;
        return next;
      });
      setMediaUrls((prev) => ({ ...prev, [slot]: uploaded.url }));
      setMediaPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
      setMediaFile(null);
      setMediaTarget(null);
      setMediaCurrentSrc(null);
    } catch (err) {
      setMediaDialogError(mediaDialogErrorMessage(err, "Image upload failed"));
    } finally {
      setUploading(false);
    }
  }, [mediaTarget, mediaFile, websiteId, commitPatch]);

  const resetStill = useCallback(async () => {
    if (!mediaTarget) return;
    const key = mediaTarget.key;
    const slot = key.startsWith("media.") ? key.slice("media.".length) : "";
    if (!slot) return;
    setUploading(true);
    setMediaDialogError(null);
    setError(null);
    try {
      await commitPatch({ media: { [slot]: null } }, (base) => {
        const next: TemplateOverlay = JSON.parse(JSON.stringify(base)) as TemplateOverlay;
        delete next.media[slot];
        return next;
      });
      setMediaUrls((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      setMediaPreviewUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
      setMediaFile(null);
      setMediaTarget(null);
      setMediaCurrentSrc(null);
    } catch (err) {
      setMediaDialogError(mediaDialogErrorMessage(err, "Unable to reset image"));
    } finally {
      setUploading(false);
    }
  }, [mediaTarget, commitPatch]);

  const publish = useCallback(async () => {
    if (dirtyCount === 0 || saving) return;
    setBusyAction("publish");
    setError(null);
    try {
      await approveWebsiteVersion({ data: { websiteId, versionId, expectedRevision: revision } });
      navigate({ to: "/user/$userId", params: { userId }, search: { websiteId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to publish changes");
      setBusyAction(null);
    }
  }, [dirtyCount, saving, websiteId, versionId, revision, navigate, userId]);

  const removeDraft = useCallback(async () => {
    setBusyAction("delete");
    setError(null);
    try {
      await discardTemplateDraft({ data: { websiteId } });
      navigate({ to: "/user/$userId", params: { userId }, search: { websiteId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete draft");
      setBusyAction(null);
    }
  }, [websiteId, navigate, userId]);

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
          <Link
            to="/user/$userId"
            params={{ userId }}
            search={{ websiteId }}
            className="text-sm font-semibold underline"
          >
            ← Back
          </Link>
          <p className="text-sm font-bold">What do you want to change?</p>
          <span
            className="ml-auto rounded-full border px-3 py-1 text-xs font-semibold"
            role="status"
          >
            {saving
              ? "Saving…"
              : dirtyCount === 0
                ? "No draft changes"
                : `Draft — ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}`}
          </span>
          <div className="flex gap-1" role="group" aria-label="Preview width">
            <Button
              type="button"
              size="sm"
              variant={mobileView ? "outline" : "default"}
              onClick={() => setMobileView(false)}
            >
              Desktop
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mobileView ? "default" : "outline"}
              onClick={() => setMobileView(true)}
            >
              Mobile
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6">
        {error ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div
          ref={previewRef}
          className={`relative mx-auto ${mobileView ? "max-w-[390px]" : "max-w-none"}`}
          onClickCapture={(event) => {
            const target = event.target as HTMLElement;
            const node = target.closest("[data-tkey]");
            if (!node) {
              // Non-editable regions (booking buttons, links, video) stay inert.
              event.preventDefault();
              return;
            }
            const key = (node as HTMLElement).dataset.tkey ?? "";
            if (!isValidKey(initial.slug, key)) return;
            event.preventDefault();
            if (!editing) startEdit(key);
          }}
        >
          {MoldComponent && content ? (
            <Suspense
              fallback={
                <p className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
                  Loading preview…
                </p>
              }
            >
              <MoldComponent content={content} />
            </Suspense>
          ) : (
            <p className="mx-auto max-w-md py-16 text-center text-sm text-muted-foreground">
              Editing preview for this template isn&apos;t available yet. Contact support and
              mention this website.
            </p>
          )}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {boxes.map((box) => (
              <span
                key={box.key}
                className="absolute rounded-sm outline-2 outline-offset-2 outline-blue-500"
                style={{
                  top: box.top,
                  left: box.left,
                  width: box.width,
                  height: box.height,
                }}
              />
            ))}
          </div>
          {boxes.map((box) => (
            <button
              key={`edit-${box.key}`}
              type="button"
              aria-label={`Edit ${box.key}`}
              className="absolute grid size-11 place-items-center rounded-full border bg-white text-lg font-bold shadow"
              style={{ top: Math.max(box.top - 40, 4), left: box.left }}
              onClick={() => startEdit(box.key)}
            >
              ✎
            </button>
          ))}
          {editing ? (
            <div
              className="absolute z-20 rounded-md border bg-white p-2 shadow-lg"
              style={{
                top: editing.rect.top,
                left: editing.rect.left,
                width: Math.max(editing.rect.width, 220),
              }}
            >
              <textarea
                ref={(element) => element?.focus()}
                className="min-h-20 w-full rounded border p-2 text-sm text-black"
                value={editing.draft}
                aria-label={`Edit ${editing.key}`}
                onChange={(event) => setEditing({ ...editing, draft: event.currentTarget.value })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditing(null);
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    void commitEdit(editing.key, editing.draft);
                  }
                }}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void commitEdit(editing.key, editing.draft)}
                >
                  Save
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {toolbar ? (
            <div
              className="absolute z-20 flex gap-2 rounded-full border bg-white p-1.5 shadow-lg"
              style={{ top: Math.max(toolbar.rect.top - 52, 4), left: toolbar.rect.left }}
            >
              {isWandKey(toolbar.key) ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={wandBusy}
                  onClick={() => void improve(toolbar.key)}
                >
                  🪄 Improve with AI
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" onClick={() => void resetItem()}>
                Reset
              </Button>
            </div>
          ) : null}
        </div>

        {suggestion ? (
          <Card className="mx-auto mt-6 max-w-2xl">
            <CardContent className="pt-6">
              <p className="text-sm font-bold">AI suggestion</p>
              <p className="mt-2 text-sm">{suggestion.copy}</p>
              <div className="mt-4 flex gap-2">
                <Button type="button" onClick={() => void acceptSuggestion()}>
                  Accept
                </Button>
                <Button type="button" variant="outline" onClick={() => setSuggestion(null)}>
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-between gap-3 border-t pt-6">
          <Button
            type="button"
            variant="outline"
            disabled={busyAction !== null || dirtyCount === 0}
            onClick={() => setConfirmDelete(true)}
          >
            Delete draft
          </Button>
          <Button
            type="button"
            disabled={busyAction !== null || saving || dirtyCount === 0}
            onClick={() => void publish()}
          >
            {busyAction === "publish" ? "Publishing…" : "Publish changes"}
          </Button>
        </div>
        {confirmDelete ? (
          <Card className="mx-auto mt-4 max-w-2xl border-destructive/40">
            <CardContent className="pt-6">
              <p className="text-sm font-bold">Delete this draft and undo all edits?</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your published site stays exactly as it is.
              </p>
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busyAction !== null}
                  onClick={() => {
                    setConfirmDelete(false);
                    void removeDraft();
                  }}
                >
                  {busyAction === "delete" ? "Deleting…" : "Yes, delete draft"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
                  Keep editing
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {mediaTarget ? (
        <Dialog open onOpenChange={(open) => !open && closeMediaDialog()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Replace image</DialogTitle>
              <DialogDescription>
                Replaces the {mediaTarget.key} photo in your draft only. Nothing publishes until you
                choose Publish changes.
              </DialogDescription>
            </DialogHeader>
            <div className="relative overflow-hidden rounded-md border bg-muted">
              {mediaPreviewUrl || mediaCurrentSrc ? (
                <img
                  src={mediaPreviewUrl ?? mediaCurrentSrc ?? ""}
                  alt="Current image"
                  className="mx-auto max-h-64 w-full object-contain"
                />
              ) : (
                <div className="grid min-h-40 place-items-center px-4 text-center text-sm text-muted-foreground">
                  No image yet — initials or template art will show until you save a photo.
                </div>
              )}
              <button
                type="button"
                className="absolute bottom-3 left-1/2 min-h-11 -translate-x-1/2 rounded-full border bg-white px-4 text-sm font-semibold shadow"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                Replace
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={stillAcceptAttr()}
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) pickStill(file);
                event.currentTarget.value = "";
              }}
            />
            {mediaDialogError ? (
              <p className="text-sm text-destructive" role="alert">
                {mediaDialogError}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={uploading}
                onClick={() => void resetStill()}
              >
                Reset
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={closeMediaDialog}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={uploading || !mediaFile}
                  onClick={() => void saveStill()}
                >
                  {uploading ? "Saving…" : "Save new image"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </main>
  );
}
