const GENERATED_MEDIA_EXTENSION = /^[a-z0-9]+$/;
const GENERATED_MEDIA_WEBSITE_ID = /^[a-z0-9_-]+$/i;
const CANONICAL_GENERATED_MEDIA_PATH = /^generated\/[a-f0-9]{64}\.[a-z0-9]+$/;
const LEGACY_GENERATED_MEDIA_PATH = /^generated\/[a-f0-9]{16}\.[a-z0-9]+$/;
const CHAT_ATTACHMENT_FILE = /^\d{10,}-[a-f0-9]{8}\.(?:png|jpe?g|gif|mp4)$/;

export function generatedMediaStoragePath(
  websiteId: string,
  contentHash: string,
  extension: string,
): string {
  if (!GENERATED_MEDIA_WEBSITE_ID.test(websiteId)) {
    throw new Error("Generated media website ID must be one path segment");
  }
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error("Generated media content hash must be a full SHA-256 digest");
  }
  if (!GENERATED_MEDIA_EXTENSION.test(extension)) {
    throw new Error("Generated media extension must be lowercase alphanumeric");
  }
  return `${websiteId}/generated/${contentHash}.${extension}`;
}

/** Accept canonical full hashes and historical 16-hex keys already stored in versions. */
export function isGeneratedMediaRelativePath(relativePath: string): boolean {
  return (
    CANONICAL_GENERATED_MEDIA_PATH.test(relativePath) ||
    LEGACY_GENERATED_MEDIA_PATH.test(relativePath)
  );
}

export function isOwnedChatAttachmentPath(profileId: string, storagePath: string): boolean {
  const prefix = `${profileId}/`;
  if (!storagePath.startsWith(prefix)) return false;
  return CHAT_ATTACHMENT_FILE.test(storagePath.slice(prefix.length));
}
