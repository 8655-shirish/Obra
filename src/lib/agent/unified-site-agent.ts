import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;

export const UNIFIED_SITE_AGENT_DEFAULT = false;
export const UNIFIED_SITE_AGENT_STORAGE_PATH = "admin/unified-site-agent.json";

const JOURNAL_BUCKET = "journals";

export type UnifiedSiteAgentFlagSource = "storage" | "env" | "default";

export type UnifiedSiteAgentFlag = {
  enabled: boolean;
  source: UnifiedSiteAgentFlagSource;
};

function isMissingObjectError(error: { message?: string; statusCode?: string } | null): boolean {
  if (!error) return false;
  const status = error.statusCode;
  if (status === "404" || status === "400") {
    const message = (error.message ?? "").toLowerCase();
    if (status === "404") return true;
    return message.includes("not found") || message.includes("no such file");
  }
  const message = (error.message ?? "").toLowerCase();
  return message.includes("not found") || message.includes("no such file");
}

export function parseUnifiedSiteAgentEnv(raw: string | undefined): boolean | null {
  if (raw == null || raw.trim() === "") return null;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return null;
}

async function loadStoredFlag(supabase: SupabaseAdmin): Promise<boolean | null> {
  const { data, error } = await supabase.storage
    .from(JOURNAL_BUCKET)
    .download(UNIFIED_SITE_AGENT_STORAGE_PATH);

  if (error) {
    if (isMissingObjectError(error)) return null;
    console.error("[unified-site-agent] storage read", error);
    return null;
  }

  try {
    const parsed = JSON.parse(await data.text()) as { enabled?: unknown };
    if (typeof parsed.enabled === "boolean") return parsed.enabled;
    console.error("[unified-site-agent] storage JSON missing enabled boolean");
    return null;
  } catch (parseError) {
    console.error("[unified-site-agent] storage JSON parse", parseError);
    return null;
  }
}

export async function readUnifiedSiteAgentFlag(
  supabase: SupabaseAdmin,
): Promise<UnifiedSiteAgentFlag> {
  const stored = await loadStoredFlag(supabase);
  if (stored !== null) return { enabled: stored, source: "storage" };
  const env = parseUnifiedSiteAgentEnv(process.env.UNIFIED_SITE_AGENT);
  if (env !== null) return { enabled: env, source: "env" };
  return { enabled: UNIFIED_SITE_AGENT_DEFAULT, source: "default" };
}

export async function isUnifiedSiteAgentEnabled(supabase: SupabaseAdmin): Promise<boolean> {
  return (await readUnifiedSiteAgentFlag(supabase)).enabled;
}
