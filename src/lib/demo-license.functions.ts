import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { normalizeLicenseNumber } from "@/lib/auth/profile.server";

const verifyDemoLicenseSchema = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  licenseNumber: z.string().trim().min(1).max(50),
});

export type VerifyDemoLicenseResult = {
  ok: boolean;
  reason?: "not_configured" | "mismatch";
};

function asNonEmptyLicense(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const verifyDemoLicense = createServerFn({ method: "POST" })
  .validator((data: unknown) => verifyDemoLicenseSchema.parse(data))
  .handler(async ({ data }): Promise<VerifyDemoLicenseResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: version, error: versionError } = await supabaseAdmin
      .from("website_versions")
      .select("config_json, website_id")
      .eq("id", data.versionId)
      .eq("website_id", data.websiteId)
      .maybeSingle();

    if (versionError || !version) {
      return { ok: false, reason: "mismatch" };
    }

    const config =
      version.config_json && typeof version.config_json === "object"
        ? (version.config_json as Record<string, unknown>)
        : {};

    let expected = asNonEmptyLicense(config.licenseNumber);

    if (!expected) {
      const { data: website, error: websiteError } = await supabaseAdmin
        .from("websites")
        .select("onboarding_state")
        .eq("id", data.websiteId)
        .maybeSingle();

      if (!websiteError && website?.onboarding_state && typeof website.onboarding_state === "object") {
        expected = asNonEmptyLicense(
          (website.onboarding_state as Record<string, unknown>).licenseNumber,
        );
      }
    }

    if (!expected) {
      return { ok: false, reason: "not_configured" };
    }

    const matches =
      normalizeLicenseNumber(data.licenseNumber) === normalizeLicenseNumber(expected);

    return matches ? { ok: true } : { ok: false, reason: "mismatch" };
  });
