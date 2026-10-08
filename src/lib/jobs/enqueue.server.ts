import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { ENRICHMENT_PLATFORMS, JOB_TYPE_ENRICHMENT, type BackgroundJobType } from "./platforms";
import {
  applyEnrichmentSubjectFilter,
  enrichmentSubjectId,
  type EnrichmentSubject,
} from "./enrichment-subject";

type SupabaseAdmin = SupabaseClient<Database>;

export interface AgentTurnFence {
  traceId: string;
  ownerToken: string;
}

function defaultIdempotencyKey(subject: EnrichmentSubject, jobType: BackgroundJobType): string {
  return `${enrichmentSubjectId(subject)}:${jobType}`;
}

export async function cancelActiveJobChains(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
  jobType: BackgroundJobType,
): Promise<void> {
  const { error } = await applyEnrichmentSubjectFilter(
    supabase
      .from("background_jobs")
      .update({
        status: "cancelled",
        locked_at: null,
        locked_by: null,
        idempotency_key: null,
      })
      .eq("job_type", jobType)
      .in("status", ["pending", "running", "finalizing"]),
    subject,
  );

  if (error) {
    console.error("[cancelActiveJobChains]", error);
    throw new Error("Unable to cancel prior job chain");
  }
}

/** Free leftover holders of this lock (completed/failed). Do not touch pending/running. */
async function releaseIdempotencyKey(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
  key: string,
): Promise<void> {
  const { error } = await applyEnrichmentSubjectFilter(
    supabase
      .from("background_jobs")
      .update({ idempotency_key: null })
      .eq("idempotency_key", key)
      .in("status", ["completed", "failed"]),
    subject,
  );

  if (error) {
    console.error("[releaseIdempotencyKey]", error);
    throw new Error("Unable to release prior job lock");
  }
}

export async function enqueueEnrichmentChain(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
  idempotencyKey?: string,
  fence?: AgentTurnFence,
): Promise<{ chainId: string; jobCount: number }> {
  const key = idempotencyKey ?? defaultIdempotencyKey(subject, JOB_TYPE_ENRICHMENT);
  const chainId = crypto.randomUUID();
  const owner =
    subject.kind === "website"
      ? { website_id: subject.websiteId, research_row_id: null as string | null }
      : { website_id: null as string | null, research_row_id: subject.researchRowId };
  const rows = ENRICHMENT_PLATFORMS.map((platform, index) => ({
    ...owner,
    chain_id: chainId,
    job_type: JOB_TYPE_ENRICHMENT,
    sequence_index: index,
    platform,
    status: "pending" as const,
    progress_pct: 0,
    status_message: index === 0 ? `Queued ${platform} enrichment…` : null,
    payload_json: { platform },
    idempotency_key: index === 0 ? key : null,
  }));

  let error;
  if (fence) {
    if (subject.kind !== "website") {
      throw new Error("Owned enrichment enqueue requires a website");
    }
    ({ error } = await supabase.rpc("enqueue_enrichment_chain_owned", {
      p_website_id: subject.websiteId,
      p_trace_id: fence.traceId,
      p_owner_token: fence.ownerToken,
      p_idempotency_key: key,
      p_chain_id: chainId,
      p_rows: rows.map(
        ({ sequence_index, platform, status_message, payload_json, idempotency_key }) => ({
          sequence_index,
          platform,
          status_message,
          payload_json,
          idempotency_key,
        }),
      ),
    }));
  } else {
    await cancelActiveJobChains(supabase, subject, JOB_TYPE_ENRICHMENT);
    await releaseIdempotencyKey(supabase, subject, key);
    ({ error } = await supabase.from("background_jobs").insert(rows));
  }

  if (error) {
    console.error("[enqueueEnrichmentChain]", error);
    throw new Error("Unable to enqueue enrichment jobs");
  }

  return { chainId, jobCount: rows.length };
}
