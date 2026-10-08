import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";

import { assertWebsiteWorkspaceAccess } from "@/lib/jobs/access.server";
import { extensionForMime, validateMediaUpload } from "@/lib/media-validation";
import { detectImageMimeType, validateDecodedImageBytes } from "@/lib/media/image-metadata";
import { isProofEligibleStillMimeType, MIN_USABLE_EVIDENCE_EDGE } from "@/lib/site-evidence";

const siteMediaSchema = z.object({
  websiteId: z.string().uuid(),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((50 * 1024 * 1024 * 4) / 3) + 4),
});

export const uploadSiteMedia = createServerFn({ method: "POST" })
  .validator((data: unknown) => siteMediaSchema.parse(data))
  .handler(async ({ data }) => {
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const check = validateMediaUpload({ type: data.mimeType, size: data.size }, "site");
    if (!check.ok) throw new Error(check.error);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const buffer = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    if (buffer.byteLength !== data.size)
      throw new Error("Media size does not match uploaded bytes");
    const detectedMime = data.mimeType.startsWith("image/") ? detectImageMimeType(buffer) : null;
    const metadata = detectedMime ? await validateDecodedImageBytes(buffer) : null;
    const declaredImageMime = data.mimeType === "image/jpg" ? "image/jpeg" : data.mimeType;
    if (data.mimeType.startsWith("image/") && (!metadata || detectedMime !== declaredImageMime))
      throw new Error("Image MIME does not match uploaded bytes");
    const mimeType = detectedMime ?? data.mimeType;
    const ext = extensionForMime(mimeType);
    const path = `${data.websiteId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    const { error } = await supabaseAdmin.storage.from("site-media").upload(path, buffer, {
      contentType: mimeType,
      upsert: false,
    });

    if (error) {
      console.error("[uploadSiteMedia]", error);
      throw new Error("Unable to upload media");
    }

    const { signSiteMediaPath } = await import("@/lib/media/site-media.server");
    const url = await signSiteMediaPath(supabaseAdmin, path);
    if (!url) {
      await supabaseAdmin.storage.from("site-media").remove([path]);
      throw new Error("Unable to sign uploaded media");
    }

    const contentHash = createHash("sha256").update(buffer).digest("hex");
    return {
      path,
      url,
      mimeType,
      fileName: data.fileName,
      storagePath: path,
      ...(metadata ?? {}),
      contentHash,
      provenance: {
        kind: "evidence" as const,
        sourceUrl: url ?? path,
        storageBucket: "site-media" as const,
      },
      proofEligible: Boolean(
        metadata &&
        isProofEligibleStillMimeType(mimeType) &&
        metadata.width >= MIN_USABLE_EVIDENCE_EDGE &&
        metadata.height >= MIN_USABLE_EVIDENCE_EDGE,
      ),
    };
  });
