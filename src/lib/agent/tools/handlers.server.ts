import { publishWebsiteVersion } from "../publish.server";
import { suggestGroundedCopy } from "../suggest-copy.server";
import { assertNotAborted } from "../abort.server";
import { parseToolInput, parseToolOutput, getToolDefinition } from "./registry";
import type { ToolName } from "./schemas";

async function assertWebsiteAccess(websiteId: string) {
  const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
  return assertWebsiteWorkspaceAccess(websiteId);
}

function asToolName(name: string): ToolName {
  const def = getToolDefinition(name as ToolName);
  if (!def) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return name as ToolName;
}

/**
 * Server-only agent tool dispatch. Validates input/output with Zod on every call.
 */
export async function executeAgentTool(
  name: string,
  payload: unknown,
  options?: {
    signal?: AbortSignal;
    requestId?: string;
    turnLease?: { traceId: string; ownerToken: string };
  },
): Promise<unknown> {
  assertNotAborted(options?.signal);
  const toolName = asToolName(name);
  const requireFence = () => {
    if (!options?.turnLease) throw new Error("Agent turn ownership is required for mutation");
    return options.turnLease;
  };

  switch (toolName) {
    case "getEnrichmentSummary": {
      const input = parseToolInput(toolName, payload);
      await assertWebsiteAccess(input.websiteId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: contractor }, { data: website }] = await Promise.all([
        supabaseAdmin
          .from("contractor_profiles")
          .select("enrichment_json, research_status, business_name, license_number")
          .eq("website_id", input.websiteId)
          .maybeSingle(),
        supabaseAdmin
          .from("websites")
          .select("onboarding_state, template_slug")
          .eq("id", input.websiteId)
          .maybeSingle(),
      ]);

      const enrichment = (contractor?.enrichment_json as Record<string, unknown>) ?? {};
      const onboardingRecord =
        website?.onboarding_state && typeof website.onboarding_state === "object"
          ? (website.onboarding_state as Record<string, unknown>)
          : {};
      const identityOnboarding = {
        ...onboardingRecord,
        businessName:
          (typeof onboardingRecord.businessName === "string" && onboardingRecord.businessName.trim()
            ? onboardingRecord.businessName
            : contractor?.business_name) ?? "",
        licenseNumber:
          (typeof onboardingRecord.licenseNumber === "string" &&
          onboardingRecord.licenseNumber.trim()
            ? onboardingRecord.licenseNumber
            : contractor?.license_number) ?? "",
      };
      const { buildResearchDossier, platformCardForAgent } =
        await import("@/lib/admin/research-dossier");
      const dossier = buildResearchDossier(enrichment, identityOnboarding, {
        researchStatus: contractor?.research_status ?? null,
      });
      const listedWebsite = dossier.listedWebsite;
      const { schemaFromMatchedPlatforms } =
        await import("@/lib/enrichment/enrichment-schema.server");
      const matchedSchema = schemaFromMatchedPlatforms(enrichment, identityOnboarding);

      const { getTemplateManifest, manifestHasReviewSection } =
        await import("@/lib/template-content/overlay");
      const templateSlug =
        typeof website?.template_slug === "string" ? website.template_slug : null;
      const manifest = templateSlug ? getTemplateManifest(templateSlug) : null;
      const hasReviewSection = Boolean(manifest && manifestHasReviewSection(manifest));
      const agentName =
        typeof identityOnboarding.businessName === "string" ? identityOnboarding.businessName : "";

      return parseToolOutput(toolName, {
        websiteId: input.websiteId,
        templateSlug,
        textSlots: manifest
          ? Object.entries(manifest.textBudgets).map(([key, maxChars]) => ({ key, maxChars }))
          : [],
        mediaSlots: manifest?.mediaSlots ?? [],
        hasReviewSection,
        researchStatus: contractor?.research_status ?? null,
        listedWebsite,
        summary: {
          schema: matchedSchema,
          images: dossier.images,
          reviews: dossier.reviews,
          platforms: dossier.platforms.map((card) => platformCardForAgent(card, agentName)),
          identity: dossier.identity,
          social: dossier.social,
        },
      });
    }
    case "publishToLp": {
      const input = parseToolInput(toolName, payload);
      await assertWebsiteAccess(input.websiteId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { publicUrl } = await publishWebsiteVersion(
        supabaseAdmin,
        input.websiteId,
        input.versionId,
        input.expectedRevision,
        requireFence(),
      );
      return parseToolOutput(toolName, {
        websiteId: input.websiteId,
        versionId: input.versionId,
        publicUrl,
      });
    }
    case "suggestCopy": {
      const input = parseToolInput(toolName, payload);
      await assertWebsiteAccess(input.websiteId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { slotBudgetForWebsite } = await import("../suggest-copy.server");
      const result = await suggestGroundedCopy(
        supabaseAdmin,
        input.websiteId,
        input.sectionId,
        input.enrichmentFieldRefs,
        {
          signal: options?.signal,
          maxChars: await slotBudgetForWebsite(supabaseAdmin, input.websiteId, input.sectionId),
        },
      );
      return parseToolOutput(toolName, result);
    }
    case "applyTemplatePatch": {
      const input = parseToolInput(toolName, payload);
      await assertWebsiteAccess(input.websiteId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { applyTemplatePatchForVersion } =
        await import("@/lib/agent/apply-template-patch.server");
      const { versionId, revision } = await applyTemplatePatchForVersion(
        supabaseAdmin,
        input.websiteId,
        input.versionId,
        input.expectedRevision,
        input.patch as Record<string, unknown>,
        requireFence(),
      );
      return parseToolOutput(toolName, {
        websiteId: input.websiteId,
        versionId,
        revision,
      });
    }
    default: {
      const exhaustive: never = toolName;
      throw new Error(`Unknown tool: ${exhaustive}`);
    }
  }
}
