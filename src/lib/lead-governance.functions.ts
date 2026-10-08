import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdminMiddleware } from "@/lib/auth/admin-middleware.server";

const offboardSchema = z.object({
  profileId: z.string().uuid(),
  reason: z.string().trim().min(8).max(500),
});
const actorId = () => {
  const username = process.env.ADMIN_USERNAME;
  if (!username) throw new Error("Admin identity is not configured");
  const hex = createHash("sha256")
    .update("obra-admin:" + username)
    .digest("hex")
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20),
    hex.slice(20),
  ].join("-");
};
export const offboardStarterLeadCollection = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((v: unknown) => offboardSchema.parse(v))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: affected, error } = await supabaseAdmin.rpc("offboard_starter_leads", {
      p_profile_id: data.profileId,
      p_actor_user_id: actorId(),
      p_reason: data.reason,
    });
    if (error) throw new Error("Unable to offboard lead collection");
    return { affected: affected ?? 0 };
  });

export async function runApprovedLeadRetention(input: { secret: string }) {
  const expected = process.env.RETENTION_CRON_SECRET;
  if (!expected || input.secret !== expected) throw new Error("Unauthorized");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: policy, error: policyError } = await supabaseAdmin
    .from("data_retention_policies")
    .select("retention_days,deletion_mode,production_approved")
    .eq("data_class", "website_leads")
    .single();
  if (
    policyError ||
    !policy?.production_approved ||
    policy.deletion_mode !== "automatic" ||
    !policy.retention_days
  )
    return { skipped: true, profiles: 0 };
  const { data: profiles, error } = await supabaseAdmin.from("leads").select("user_id");
  if (error) throw new Error("Unable to enumerate retained leads");
  let processed = 0;
  for (const profileId of new Set((profiles ?? []).map((r) => r.user_id))) {
    const { error: purgeError } = await supabaseAdmin.rpc("purge_retained_leads", {
      p_profile_id: profileId,
      p_actor_user_id: actorId(),
      p_reason: "Approved automatic retention policy",
    });
    if (purgeError) throw new Error("Lead retention purge failed");
    processed++;
  }
  return { skipped: false, profiles: processed };
}
