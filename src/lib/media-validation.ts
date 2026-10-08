/** G1/G10 allowed formats — chat attachments, media edit, gallery (PRD). */

export const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg"] as const;

export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "image/gif"] as const;

export const ALLOWED_MEDIA_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  ...ALLOWED_VIDEO_MIME_TYPES,
] as const;

const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const MAX_SITE_MEDIA_BYTES = 50 * 1024 * 1024;

export type MediaValidationContext = "chat" | "site";

export function isAllowedMediaMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return (ALLOWED_MEDIA_MIME_TYPES as readonly string[]).includes(normalized);
}

export function validateMediaUpload(
  file: { type: string; size: number },
  context: MediaValidationContext = "site",
): { ok: true } | { ok: false; error: string } {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (!isAllowedMediaMimeType(mime)) {
    return {
      ok: false,
      error: "Unsupported file type. Use png, jpg, jpeg, mp4, or gif.",
    };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "This file is empty or unreadable." };
  }

  const maxBytes = context === "chat" ? MAX_CHAT_ATTACHMENT_BYTES : MAX_SITE_MEDIA_BYTES;
  if (file.size > maxBytes) {
    return { ok: false, error: `File exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit.` };
  }

  return { ok: true };
}

export function extensionForMime(mimeType: string): string {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}
