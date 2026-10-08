import { getImpersonationProfileId, isAdminSessionValid } from "@/lib/auth/admin-session.server";
import { getContractorAuthUserId } from "@/lib/auth/contractor-session.server";
import { findProfileByAuthUserId } from "@/lib/auth/profile.server";

/**
 * Ensures the current session may access a profile workspace (`profiles.id`).
 */
export async function assertProfileWorkspaceAccess(profileId: string): Promise<{
  mode: "admin" | "contractor";
  profileId: string;
}> {
  const impersonatedProfileId = await getImpersonationProfileId();

  if ((await isAdminSessionValid()) && impersonatedProfileId === profileId) {
    return { mode: "admin", profileId };
  }

  const authUserId = await getContractorAuthUserId();
  if (!authUserId) {
    throw new Error("Unauthorized");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const profile = await findProfileByAuthUserId(supabaseAdmin, authUserId);

  if (!profile || profile.id !== profileId || !profile.auth_user_id) {
    throw new Error("Forbidden");
  }

  return { mode: "contractor", profileId };
}

/**
 * Ensures the current session (contractor or impersonating admin) may access a website.
 */
export async function assertWebsiteWorkspaceAccess(websiteId: string): Promise<{
  mode: "admin" | "contractor";
  profileId: string;
}> {
  const impersonatedProfileId = await getImpersonationProfileId();
  const adminAuthenticated = (await isAdminSessionValid()) && Boolean(impersonatedProfileId);
  const authUserId = adminAuthenticated ? null : await getContractorAuthUserId();
  if (!adminAuthenticated && !authUserId) throw new Error("Unauthorized");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: website, error } = await supabaseAdmin
    .from("websites")
    .select("user_id")
    .eq("id", websiteId)
    .maybeSingle();
  if (error) throw new Error("Unable to verify website access");
  if (!website) throw new Error("Website not found");

  if (adminAuthenticated) {
    if (impersonatedProfileId !== website.user_id) throw new Error("Forbidden");
    return { mode: "admin", profileId: website.user_id };
  }
  const profile = await findProfileByAuthUserId(supabaseAdmin, authUserId!);
  if (!profile || profile.id !== website.user_id || !profile.auth_user_id)
    throw new Error("Forbidden");
  return { mode: "contractor", profileId: website.user_id };
}
