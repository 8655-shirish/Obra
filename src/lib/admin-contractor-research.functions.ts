import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { requireAdminMiddleware } from "@/lib/auth/admin-middleware.server";
import {
  CONTRACTOR_RESEARCH_COMMENT_MAX,
  assertCsvFilename,
  cellsRecord,
  hasEnrichmentPayload,
  onboardingFromResearchCells,
  parseContractorResearchCsv,
  researchIdentityFromCells,
  titleFromFilename,
  ContractorResearchCsvError,
} from "@/lib/admin/contractor-research-csv";
import { buildResearchDossier, deriveResearchJobState } from "@/lib/admin/research-dossier";
import { JOB_TYPE_ENRICHMENT } from "@/lib/jobs/platforms";
import { researchRowSubject } from "@/lib/jobs/enrichment-subject";
import { classifyTemplateLookupPoll } from "@/lib/template-purchase/lookup";

const sheetIdSchema = z.object({ sheetId: z.string().uuid() });
const rowIdSchema = z.object({ rowId: z.string().uuid() });
const renameSchema = z.object({
  sheetId: z.string().uuid(),
  title: z.string().trim().max(200),
});
const commentSchema = z.object({
  rowId: z.string().uuid(),
  comment: z.string().max(CONTRACTOR_RESEARCH_COMMENT_MAX),
});
const uploadSchema = z.object({
  sheetId: z.string().uuid(),
  filename: z.string().trim().min(1).max(400),
  csvText: z.string().min(1).max(2_000_000),
});

export type ContractorResearchRowView = {
  id: string;
  sortIndex: number;
  cells: Record<string, string>;
  comment: string;
  chainId: string | null;
  researchStatus: string | null;
  hasActiveWork: boolean;
  hasEnrichment: boolean;
  identityOk: boolean;
  identityReason: string | null;
  poll: "wait" | "complete" | "failed" | null;
};

export type ContractorResearchSheetView = {
  id: string;
  title: string;
  originalFilename: string;
  headers: string[];
  createdAt: string;
  updatedAt: string;
  rows: ContractorResearchRowView[];
};

function headersList(value: Json): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function pollFromJobs(
  jobs: Array<{ status: string; chain_id: string }>,
): "wait" | "complete" | "failed" | null {
  if (jobs.length === 0) return null;
  const hasActiveWork = jobs.some(
    (job) => job.status === "pending" || job.status === "running" || job.status === "finalizing",
  );
  const isComplete = jobs.every((job) => job.status === "completed");
  const isCancelled = jobs.some((job) => job.status === "cancelled");
  const hasFailed = jobs.some((job) => job.status === "failed");
  return classifyTemplateLookupPoll({
    chainId: jobs[0]?.chain_id ?? "",
    hasActiveWork,
    isComplete,
    isCancelled,
    hasFailed,
    state: hasActiveWork
      ? "running"
      : isComplete
        ? "completed"
        : isCancelled
          ? "cancelled"
          : "failed",
  });
}

export const listContractorResearch = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sheets, error: sheetsError } = await supabaseAdmin
      .from("contractor_research_sheets")
      .select("id, title, original_filename, headers, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (sheetsError) throw new Error("Unable to load contractor research sheets");

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from("contractor_research_rows")
      .select(
        "id, sheet_id, sort_index, cells, comment, chain_id, research_status, enrichment_json",
      )
      .order("sort_index", { ascending: true });
    if (rowsError) throw new Error("Unable to load contractor research rows");

    const rowIdsWithChain = (rows ?? []).filter((row) => row.chain_id).map((row) => row.id);
    const jobsByRow = new Map<string, Array<{ status: string; chain_id: string }>>();
    if (rowIdsWithChain.length > 0) {
      const { data: jobs, error: jobsError } = await supabaseAdmin
        .from("background_jobs")
        .select("research_row_id, chain_id, status")
        .eq("job_type", JOB_TYPE_ENRICHMENT)
        .in("research_row_id", rowIdsWithChain);
      if (jobsError) throw new Error("Unable to load contractor research jobs");
      for (const job of jobs ?? []) {
        if (!job.research_row_id) continue;
        const list = jobsByRow.get(job.research_row_id) ?? [];
        list.push({ status: job.status, chain_id: job.chain_id });
        jobsByRow.set(job.research_row_id, list);
      }
    }

    const rowsBySheet = new Map<string, ContractorResearchRowView[]>();
    for (const row of rows ?? []) {
      const cells = cellsRecord(row.cells);
      const identity = researchIdentityFromCells(cells);
      const chainJobs = (jobsByRow.get(row.id) ?? []).filter(
        (job) => !row.chain_id || job.chain_id === row.chain_id,
      );
      const poll = pollFromJobs(chainJobs);
      const list = rowsBySheet.get(row.sheet_id) ?? [];
      list.push({
        id: row.id,
        sortIndex: row.sort_index,
        cells,
        comment: row.comment,
        chainId: row.chain_id,
        researchStatus: row.research_status,
        hasActiveWork: poll === "wait",
        hasEnrichment: hasEnrichmentPayload(row.enrichment_json),
        identityOk: identity.ok,
        identityReason: identity.reason,
        poll,
      });
      rowsBySheet.set(row.sheet_id, list);
    }

    const sheetViews: ContractorResearchSheetView[] = (sheets ?? []).map((sheet) => ({
      id: sheet.id,
      title: sheet.title,
      originalFilename: sheet.original_filename,
      headers: headersList(sheet.headers),
      createdAt: sheet.created_at,
      updatedAt: sheet.updated_at,
      rows: rowsBySheet.get(sheet.id) ?? [],
    }));

    return { sheets: sheetViews };
  });

export const createContractorResearchTab = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("contractor_research_sheets")
      .insert({ title: "Untitled" })
      .select("id")
      .single();
    if (error || !data) throw new Error("Unable to create tab");
    return { sheetId: data.id };
  });

export const uploadContractorResearchCsv = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => uploadSchema.parse(data))
  .handler(async ({ data }) => {
    assertCsvFilename(data.filename);
    let parsed;
    try {
      parsed = parseContractorResearchCsv(data.csvText);
    } catch (error) {
      if (error instanceof ContractorResearchCsvError) throw new Error(error.message);
      throw error;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sheet, error: sheetError } = await supabaseAdmin
      .from("contractor_research_sheets")
      .select("id")
      .eq("id", data.sheetId)
      .maybeSingle();
    if (sheetError || !sheet) throw new Error("Tab not found");

    const { count, error: countError } = await supabaseAdmin
      .from("contractor_research_rows")
      .select("id", { count: "exact", head: true })
      .eq("sheet_id", data.sheetId);
    if (countError) throw new Error("Unable to upload CSV");
    if ((count ?? 0) > 0) {
      throw new Error("This tab already has a CSV. Open a new tab to upload another file.");
    }

    const title = titleFromFilename(data.filename);
    const { error: updateError } = await supabaseAdmin
      .from("contractor_research_sheets")
      .update({
        title,
        original_filename: data.filename,
        headers: parsed.headers as unknown as Json,
      })
      .eq("id", data.sheetId);
    if (updateError) throw new Error("Unable to save sheet headers");

    const { error: insertError } = await supabaseAdmin.from("contractor_research_rows").insert(
      parsed.rows.map((cells, index) => ({
        sheet_id: data.sheetId,
        sort_index: index,
        cells: cells as unknown as Json,
      })),
    );
    if (insertError) throw new Error("Unable to save contractor rows");
    return { sheetId: data.sheetId, rowCount: parsed.rows.length };
  });

export const renameContractorResearchSheet = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => renameSchema.parse(data))
  .handler(async ({ data }) => {
    const title = data.title.trim() || "Untitled";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("contractor_research_sheets")
      .update({ title })
      .eq("id", data.sheetId);
    if (error) throw new Error("Unable to rename tab");
    return { title };
  });

export const deleteContractorResearchSheet = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => sheetIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error: rowsError } = await supabaseAdmin
      .from("contractor_research_rows")
      .select("id")
      .eq("sheet_id", data.sheetId);
    if (rowsError) throw new Error("Unable to delete tab");
    const rowIds = (rows ?? []).map((row) => row.id);
    if (rowIds.length > 0) {
      const { cancelActiveJobChains } = await import("@/lib/jobs/enqueue.server");
      for (const rowId of rowIds) {
        await cancelActiveJobChains(supabaseAdmin, researchRowSubject(rowId), JOB_TYPE_ENRICHMENT);
      }
    }
    const { error } = await supabaseAdmin
      .from("contractor_research_sheets")
      .delete()
      .eq("id", data.sheetId);
    if (error) throw new Error("Unable to delete tab");
    return { ok: true as const };
  });

export const patchContractorResearchComment = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => commentSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("contractor_research_rows")
      .update({ comment: data.comment })
      .eq("id", data.rowId);
    if (error) throw new Error("Unable to save comment");
    return { ok: true as const };
  });

export const startContractorResearch = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => rowIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("contractor_research_rows")
      .select("id, cells, chain_id")
      .eq("id", data.rowId)
      .maybeSingle();
    if (error || !row) throw new Error("Row not found");
    const identity = researchIdentityFromCells(cellsRecord(row.cells));
    if (!identity.ok) throw new Error(identity.reason ?? "Business name and license are required");

    const { enqueueEnrichmentChain } = await import("@/lib/jobs/enqueue.server");
    const { chainId } = await enqueueEnrichmentChain(supabaseAdmin, researchRowSubject(row.id));
    const { error: updateError } = await supabaseAdmin
      .from("contractor_research_rows")
      .update({ chain_id: chainId })
      .eq("id", row.id);
    if (updateError) throw new Error("Unable to attach research chain");
    return { chainId };
  });

export const getContractorResearchDossier = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => rowIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("contractor_research_rows")
      .select("cells, enrichment_json, research_status, chain_id")
      .eq("id", data.rowId)
      .maybeSingle();
    if (error || !row) throw new Error("Row not found");

    let jobs: Array<{ status: string; chain_id: string }> = [];
    if (row.chain_id) {
      const { data: jobRows, error: jobsError } = await supabaseAdmin
        .from("background_jobs")
        .select("status, chain_id")
        .eq("research_row_id", data.rowId)
        .eq("job_type", JOB_TYPE_ENRICHMENT)
        .eq("chain_id", row.chain_id);
      if (jobsError) throw new Error("Unable to load research jobs");
      jobs = jobRows ?? [];
    }

    const onboarding = onboardingFromResearchCells(row.cells);
    const enrichment =
      row.enrichment_json &&
      typeof row.enrichment_json === "object" &&
      !Array.isArray(row.enrichment_json)
        ? (row.enrichment_json as Record<string, unknown>)
        : {};
    return buildResearchDossier(enrichment, onboarding, {
      researchStatus: row.research_status,
      jobState: deriveResearchJobState(jobs),
    });
  });
