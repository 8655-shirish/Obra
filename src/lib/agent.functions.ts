import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { publishWebsiteVersion } from "@/lib/agent/publish.server";
import { assertWebsiteWorkspaceAccess } from "@/lib/jobs/access.server";

const versionMutationSchema = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

export const approveWebsiteVersion = createServerFn({ method: "POST" })
  .validator((data: unknown) => versionMutationSchema.parse(data))
  .handler(async ({ data }) => {
    await assertWebsiteWorkspaceAccess(data.websiteId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { publicUrl } = await publishWebsiteVersion(
      supabaseAdmin,
      data.websiteId,
      data.versionId,
      data.expectedRevision,
    );
    return { success: true as const, publicUrl };
  });

export { uploadSiteMedia } from "@/lib/upload.functions";
