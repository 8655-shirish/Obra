import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getImpersonationProfileId, isAdminSessionValid } from "@/lib/auth/admin-session.server";
import { findProfileByAuthUserId } from "@/lib/auth/profile.server";

const accessSchema = z.object({
  userId: z.string().uuid(),
});

export const assertWorkspaceAccess = createServerFn({ method: "GET" })
  .validator((data: unknown) => accessSchema.parse(data))
  .handler(async ({ data }) => {
    const impersonatedProfileId = await getImpersonationProfileId();
    if ((await isAdminSessionValid()) && impersonatedProfileId === data.userId) {
      return { mode: "admin" as const };
    }

    const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
    const authUserId = await getContractorAuthUserId();
    if (!authUserId) {
      throw new Error("Unauthorized");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const profile = await findProfileByAuthUserId(supabaseAdmin, authUserId);

    if (!profile || profile.id !== data.userId || !profile.auth_user_id) {
      throw new Error("Forbidden");
    }

    return { mode: "contractor" as const };
  });
