import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { normalizeLicenseNumber } from "@/lib/auth/identity";
import { resolveTemplatePurchaseIdentity } from "@/lib/template-content/overlay";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export function isEmailIdentifier(value: string): boolean {
  return value.includes("@");
}

export { normalizeLicenseNumber } from "@/lib/auth/identity";

export async function findProfileByLicense(
  supabase: SupabaseClient<Database>,
  licenseNumber: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("license_number", normalizeLicenseNumber(licenseNumber))
    .maybeSingle();

  if (error) {
    console.error("[findProfileByLicense]", error);
    throw new Error("Unable to look up license");
  }

  return data;
}

export async function findProfileByEmail(
  supabase: SupabaseClient<Database>,
  email: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("email", email.trim().toLowerCase())
    .not("auth_user_id", "is", null)
    .maybeSingle();

  if (error) {
    console.error("[findProfileByEmail]", error);
    throw new Error("Unable to look up account");
  }

  return data;
}

export async function findProfileByAuthUserId(
  supabase: SupabaseClient<Database>,
  authUserId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    console.error("[findProfileByAuthUserId]", error);
    throw new Error("Unable to load profile");
  }

  return data;
}

export async function findPrimaryWebsiteId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("websites")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[findPrimaryWebsiteId]", error);
    throw new Error("Unable to load website");
  }

  if (!data?.length) return null;

  // Login (and any other no-websiteId caller) must land on a template
  // purchase when one exists — not an older untagged ensureWebsite draft.
  const tagged = data.find((row) => {
    const record = row as unknown as { template_slug?: unknown; template_id?: unknown };
    return Boolean(
      resolveTemplatePurchaseIdentity(
        record.template_slug ?? null,
        "template_id" in record ? (record.template_id ?? null) : null,
      ),
    );
  });
  return (tagged ?? data[0]).id;
}

export async function ensureWebsiteForProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string> {
  const existing = await findPrimaryWebsiteId(supabase, userId);
  if (existing) return existing;

  const { data: owner, error: ownerError } = await supabase
    .from("profiles")
    .select("environment")
    .eq("id", userId)
    .single();
  if (ownerError || !owner) throw new Error("Unable to load website owner environment");

  const { data, error } = await supabase
    .from("websites")
    .insert({ user_id: userId, environment: owner.environment, status: "draft" })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[ensureWebsiteForProfile]", error);
    throw new Error("Unable to create website");
  }

  return data.id;
}
