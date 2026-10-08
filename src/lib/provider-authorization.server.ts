import { isCurrentActiveConfirmedPro, isSharedProviderDisconnectEnabled } from "@/lib/provider-authorization";

export async function providerOwnerContext(websiteId: string, providerName: string) {
  const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
  const access = await assertWebsiteWorkspaceAccess(websiteId);
  if (access.mode !== "contractor")
    throw new Error(`${providerName} access is unavailable while impersonating`);

  const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
  const authUserId = await getContractorAuthUserId();
  if (!authUserId) throw new Error("Unauthorized");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, environment, email")
    .eq("id", access.profileId)
    .eq("auth_user_id", authUserId)
    .single();
  if (profileError || !profile) throw new Error("Forbidden");

  const { data: website, error: websiteError } = await supabaseAdmin
    .from("websites")
    .select("id, user_id, environment")
    .eq("id", websiteId)
    .eq("user_id", profile.id)
    .eq("environment", profile.environment)
    .single();
  if (websiteError || !website) throw new Error("Website not found");

  return { profile, website, authUserId, supabaseAdmin };
}

export type ProviderOwnerContext = Awaited<ReturnType<typeof providerOwnerContext>>;

export async function hasCurrentActiveConfirmedPro(context: ProviderOwnerContext): Promise<boolean> {
  const { data, error } = await context.supabaseAdmin
    .from("website_entitlements")
    .select("plan,state,order_confirmed_at,effective_at,ends_at")
    .eq("website_id", context.website.id)
    .eq("profile_id", context.profile.id)
    .eq("environment", context.website.environment)
    .maybeSingle();
  if (error) throw new Error("Unable to verify the current Pro entitlement");
  return isCurrentActiveConfirmedPro(data);
}

export async function requireCurrentActiveConfirmedPro(
  context: ProviderOwnerContext,
): Promise<ProviderOwnerContext> {
  if (!(await hasCurrentActiveConfirmedPro(context)))
    throw new Error("An active confirmed Pro order is required");
  return context;
}

export async function providerMutationContext(websiteId: string, providerName: string) {
  return requireCurrentActiveConfirmedPro(await providerOwnerContext(websiteId, providerName));
}

export async function assertNoOtherActiveProWebsiteNeedsSharedProviders(
  context: ProviderOwnerContext,
): Promise<void> {
  const { data, error } = await context.supabaseAdmin
    .from("website_entitlements")
    .select("website_id,plan,state,order_confirmed_at,effective_at,ends_at")
    .eq("profile_id", context.profile.id)
    .eq("environment", context.website.environment)
    .neq("website_id", context.website.id);
  if (error) throw new Error("Unable to verify whether shared provider resources are still in use");
  if ((data ?? []).some((entitlement) => isCurrentActiveConfirmedPro(entitlement)))
    throw new Error(
      "Google Calendar and Pipedream are shared across this business and are still required by another active confirmed Pro website",
    );
}

export function sharedProviderDisconnectEnabled(): boolean {
  return isSharedProviderDisconnectEnabled(process.env.ENABLE_SHARED_PROVIDER_DISCONNECT);
}
