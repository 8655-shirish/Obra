import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;
type AgentTurnFence = { traceId: string; ownerToken: string };

interface VersionRow {
  id: string;
  status: string;
  config_json: unknown;
  version_number: number;
  variant_key: string;
  revision: number;
}

/** When editing a live version, fork a selected draft so prior live demo URLs stay unchanged. */
export async function forkLiveVersionToDraft(
  supabase: SupabaseAdmin,
  websiteId: string,
  liveVersion: VersionRow,
  fence?: AgentTurnFence,
): Promise<VersionRow> {
  const forkArgs = {
    p_website_id: websiteId,
    p_source_version_id: liveVersion.id,
    p_expected_revision: liveVersion.revision,
  };
  const { data: created, error: insertError } = fence
    ? await supabase.rpc("fork_website_version_with_media_owned", {
        ...forkArgs,
        p_trace_id: fence.traceId,
        p_owner_token: fence.ownerToken,
      })
    : await supabase.rpc("fork_website_version_with_media", forkArgs);

  if (insertError || !created) {
    if (insertError?.message.includes("Website version revision conflict")) {
      throw new Error("Website version revision conflict");
    }
    throw new Error("Unable to fork draft from live version");
  }

  return created as VersionRow;
}
