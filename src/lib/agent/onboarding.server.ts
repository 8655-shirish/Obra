import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

import { coerceLookAndFeel } from "@/lib/site-evidence";
import { saveOnboardingFieldInput } from "./tools/schemas";
import type { Json } from "@/integrations/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;
type AgentTurnFence = { traceId: string; ownerToken: string };
type OnboardingField = z.infer<typeof saveOnboardingFieldInput>["field"];
type OnboardingState = Record<string, unknown>;

export const REQUIRED_ONBOARDING_FIELDS = [
  "businessName",
  "licenseNumber",
  "trade",
  "services",
  "theme",
  "lookAndFeel",
  "city",
] as const;

export function isOnboardingComplete(state: OnboardingState): boolean {
  return REQUIRED_ONBOARDING_FIELDS.every((field) => {
    const value = state[field];
    if (value === null || value === undefined || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
}

export async function saveOnboardingFieldForWebsite(
  supabase: SupabaseAdmin,
  websiteId: string,
  field: OnboardingField,
  value: unknown,
  fence?: AgentTurnFence,
): Promise<OnboardingState> {
  const { data: website, error: fetchError } = await supabase
    .from("websites")
    .select("onboarding_state")
    .eq("id", websiteId)
    .single();

  if (fetchError || !website) {
    throw new Error("Website not found");
  }

  const current = (website.onboarding_state as OnboardingState) ?? {};
  const savedValue = field === "lookAndFeel" ? coerceLookAndFeel(value) : value;
  const nextState = { ...current, [field]: savedValue };

  if (fence) {
    const { data: versions, error: versionsError } = await supabase
      .from("website_versions")
      .select("id, revision")
      .eq("website_id", websiteId)
      .in("status", ["draft", "selected"]);
    if (versionsError) throw new Error("Unable to load draft versions for discard");
    const { error } = await supabase.rpc("save_onboarding_field_owned", {
      p_website_id: websiteId,
      p_trace_id: fence.traceId,
      p_owner_token: fence.ownerToken,
      p_expected_state: current as Json,
      p_next_state: nextState as Json,
      p_expected_versions: (versions ?? []) as unknown as Json,
    });
    if (error) throw new Error("Agent turn ownership lost or onboarding state changed");
  } else {
    const { error: updateError } = await supabase
      .from("websites")
      .update({ onboarding_state: nextState as Json })
      .eq("id", websiteId);
    if (updateError) {
      console.error("[saveOnboardingFieldForWebsite]", updateError);
      throw new Error("Unable to save onboarding field");
    }
    await discardDraftVariants(supabase, websiteId);
  }

  return nextState;
}

export async function discardDraftVariants(
  supabase: SupabaseAdmin,
  websiteId: string,
): Promise<void> {
  const { data: versions, error: readError } = await supabase
    .from("website_versions")
    .select("id, revision")
    .eq("website_id", websiteId)
    .in("status", ["draft", "selected"]);

  if (readError) {
    console.error("[discardDraftVariants]", readError);
    throw new Error("Unable to load draft versions for discard");
  }
  if (!versions?.length) return;

  const { error } = await supabase.rpc("discard_website_versions_atomic", {
    p_website_id: websiteId,
    p_expected_versions: versions,
  });

  if (error) {
    console.error("[discardDraftVariants]", error);
    if (error.message.includes("Website version revision conflict")) {
      throw new Error("Website version revision conflict");
    }
    throw new Error("Unable to discard draft versions");
  }
}
