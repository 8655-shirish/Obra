import "./lib/error-capture";

import { timingSafeEqual } from "node:crypto";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { withUnparsedWebhookBody } from "./lib/webhook-raw-body.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Own the signed bytes before anything else can read or parse the stream.
    request = await withUnparsedWebhookBody(request);
    const migrationResponse = await maybeApplyRepoMigration(request);
    if (migrationResponse) return migrationResponse;
    const orphanSweepResponse = await maybeRunAddVideoOrphanSweep(request);
    if (orphanSweepResponse) return orphanSweepResponse;
    const cronResponse = await maybeRunBackgroundJobsCron(request);
    if (cronResponse) return cronResponse;
    const repairResponse = await maybeRepairContractorMedia(request);
    if (repairResponse) return repairResponse;

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

/** Constant-time comparison of a presented credential against a configured secret. */
function secretMatches(provided: string | null, configured: string): boolean {
  const presented = Buffer.from(provided ?? "");
  const expected = Buffer.from(configured);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
}

/** Never echo caller-controlled strings or secrets into logs. */
function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 300);
}

async function maybeRunBackgroundJobsCron(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/run-jobs" || request.method !== "POST") {
    return null;
  }

  const startedAt = Date.now();
  const log = (status: number, extra: Record<string, unknown>) => {
    console.info(
      JSON.stringify({
        event: "run-jobs",
        timestamp: new Date(startedAt).toISOString(),
        status,
        durationMs: Date.now() - startedAt,
        ...extra,
      }),
    );
  };

  const configuredSecret = process.env.JOB_RUNNER_SECRET;
  if (!configuredSecret) {
    log(503, { error: "JOB_RUNNER_SECRET not configured" });
    return new Response(JSON.stringify({ error: "JOB_RUNNER_SECRET not configured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  // Bearer is canonical; authenticate the legacy header independently for existing callers.
  const authorized =
    secretMatches(bearerToken(request), configuredSecret) ||
    secretMatches(request.headers.get("x-job-runner-secret"), configuredSecret);
  if (!authorized) {
    log(403, { error: "unauthorized" });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const { supabaseAdmin } = await import("./integrations/supabase/client.server");
    const { runBackgroundJobBatch } = await import("./lib/jobs/runner.server");
    // Concurrency safety comes from the atomic claim RPC, not a process-local lock.
    const result = await runBackgroundJobBatch(supabaseAdmin);
    log(200, result);
    return new Response(JSON.stringify({ ...result, durationMs: Date.now() - startedAt }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const detail = sanitizeError(error);
    log(500, { error: detail });
    return new Response(JSON.stringify({ error: detail }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENRICHMENT_PERSIST_BUDGET_MS = 25_000;

type RepairSupabase = Awaited<
  typeof import("./integrations/supabase/client.server")
>["supabaseAdmin"];

async function persistEnrichmentMediaForWebsite(
  supabase: RepairSupabase,
  websiteId: string,
  options: {
    dryRun: boolean;
    licenseNumber: string | null;
    signal: AbortSignal;
  },
): Promise<{
  websiteId: string;
  licenseNumber: string | null;
  dryRun: boolean;
  imagesNeeding: number;
  imagesRemaining: number;
}> {
  const { persistScrapedSiteMedia, countGatedImagesMissingAttestation } =
    await import("./lib/media/persist-scraped-media.server");
  const [{ data: website }, { data: contractor }] = await Promise.all([
    supabase.from("websites").select("onboarding_state").eq("id", websiteId).maybeSingle(),
    supabase
      .from("contractor_profiles")
      .select("enrichment_json")
      .eq("website_id", websiteId)
      .maybeSingle(),
  ]);
  const onboarding = (website?.onboarding_state as Record<string, unknown>) ?? {};
  const enrichment =
    contractor?.enrichment_json &&
    typeof contractor.enrichment_json === "object" &&
    !Array.isArray(contractor.enrichment_json)
      ? (contractor.enrichment_json as Record<string, unknown>)
      : {};
  const imagesNeeding = countGatedImagesMissingAttestation(websiteId, enrichment, onboarding);
  if (options.dryRun || imagesNeeding === 0) {
    return {
      websiteId,
      licenseNumber: options.licenseNumber,
      dryRun: options.dryRun,
      imagesNeeding,
      imagesRemaining: imagesNeeding,
    };
  }
  await persistScrapedSiteMedia(supabase, websiteId, enrichment, {
    onboarding,
    signal: options.signal,
  });
  const { data: after, error: afterError } = await supabase
    .from("contractor_profiles")
    .select("enrichment_json")
    .eq("website_id", websiteId)
    .maybeSingle();
  if (afterError || !after) {
    return {
      websiteId,
      licenseNumber: options.licenseNumber,
      dryRun: false,
      imagesNeeding,
      imagesRemaining: imagesNeeding,
    };
  }
  const liveAfter =
    after.enrichment_json &&
    typeof after.enrichment_json === "object" &&
    !Array.isArray(after.enrichment_json)
      ? (after.enrichment_json as Record<string, unknown>)
      : {};
  return {
    websiteId,
    licenseNumber: options.licenseNumber,
    dryRun: false,
    imagesNeeding,
    imagesRemaining: countGatedImagesMissingAttestation(websiteId, liveAfter, onboarding),
  };
}

/** Server-only admin repair for historical contractor media. dryRun defaults to true. */
async function maybeRepairContractorMedia(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/repair-contractor-media" || request.method !== "POST")
    return null;

  const startedAt = Date.now();
  const configuredSecret = process.env.MEDIA_REPAIR_SECRET;
  const diagnosticsSecret = process.env.MEDIA_DIAGNOSTICS_SECRET;
  if (!configuredSecret && !diagnosticsSecret) {
    return Response.json({ error: "MEDIA_REPAIR_SECRET not configured" }, { status: 503 });
  }

  const presented = bearerToken(request);
  const canRepair = Boolean(configuredSecret) && secretMatches(presented, configuredSecret!);
  const canDiagnose =
    canRepair || (Boolean(diagnosticsSecret) && secretMatches(presented, diagnosticsSecret!));
  if (!canDiagnose) return Response.json({ error: "Forbidden" }, { status: 403 });

  let input: {
    websiteId?: unknown;
    licenseNumber?: unknown;
    dryRun?: unknown;
    listAffectedLicenses?: unknown;
    persistEnrichment?: unknown;
    limit?: unknown;
    cursor?: unknown;
  } = {};
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Read-only paginated listing of licenses that still hold historical media.
  if (input.listAffectedLicenses === true) {
    if (input.limit !== undefined && typeof input.limit !== "number")
      return Response.json({ error: "limit must be a number" }, { status: 400 });
    if (input.cursor !== undefined && input.cursor !== null && typeof input.cursor !== "string")
      return Response.json({ error: "cursor must be a string or null" }, { status: 400 });
    try {
      const { supabaseAdmin } = await import("./integrations/supabase/client.server");
      const { listAffectedLicenses } = await import("./lib/media/affected-licenses.server");
      const result = await listAffectedLicenses(supabaseAdmin, {
        limit: typeof input.limit === "number" ? input.limit : 100,
        cursor: typeof input.cursor === "string" ? input.cursor : null,
      });
      return Response.json(result, { status: 200 });
    } catch (error) {
      return Response.json({ error: sanitizeError(error) }, { status: 500 });
    }
  }

  if (input.dryRun !== undefined && typeof input.dryRun !== "boolean")
    return Response.json({ error: "dryRun must be boolean" }, { status: 400 });
  const dryRun = input.dryRun !== false;
  if (!dryRun && !canRepair)
    return Response.json({ error: "Read-only diagnostics token" }, { status: 403 });
  if (input.persistEnrichment !== undefined && typeof input.persistEnrichment !== "boolean")
    return Response.json({ error: "persistEnrichment must be boolean" }, { status: 400 });

  const rawLicense = typeof input.licenseNumber === "string" ? input.licenseNumber.trim() : "";
  let websiteId = typeof input.websiteId === "string" ? input.websiteId.trim() : "";
  let licenseNumber: string | null = null;

  if (input.persistEnrichment === true) {
    if (!websiteId && !rawLicense)
      return Response.json({ error: "websiteId or licenseNumber is required" }, { status: 400 });
    const persistSignal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(ENRICHMENT_PERSIST_BUDGET_MS),
    ]);
    try {
      const { supabaseAdmin } = await import("./integrations/supabase/client.server");
      if (!websiteId) {
        const { resolveLicenseToWebsite } = await import("./lib/media/affected-licenses.server");
        const resolved = await resolveLicenseToWebsite(supabaseAdmin, rawLicense);
        if (!resolved.ok && resolved.status === 404)
          return Response.json({ error: "No website found for licenseNumber" }, { status: 404 });
        if (!resolved.ok)
          return Response.json(
            {
              error: "Ambiguous licenseNumber",
              profileIds: resolved.profileIds,
              websiteIds: resolved.websiteIds,
            },
            { status: 409 },
          );
        websiteId = resolved.websiteId;
        licenseNumber = resolved.licenseNumber;
      } else if (!UUID_RE.test(websiteId)) {
        return Response.json({ error: "websiteId must be a uuid" }, { status: 400 });
      }
      const result = await persistEnrichmentMediaForWebsite(supabaseAdmin, websiteId, {
        dryRun,
        licenseNumber: licenseNumber ?? (rawLicense || null),
        signal: persistSignal,
      });
      console.info(
        JSON.stringify({
          event: "persist-enrichment-media",
          timestamp: new Date(startedAt).toISOString(),
          websiteId: result.websiteId,
          licenseNumber: result.licenseNumber,
          dryRun,
          durationMs: Date.now() - startedAt,
          imagesNeeding: result.imagesNeeding,
          imagesRemaining: result.imagesRemaining,
        }),
      );
      return Response.json({ mode: "persistEnrichment", ...result }, { status: 200 });
    } catch (error) {
      const detail = sanitizeError(error);
      console.error(
        JSON.stringify({ event: "persist-enrichment-media", websiteId, dryRun, error: detail }),
      );
      return Response.json({ error: detail }, { status: 500 });
    }
  }

  if (!websiteId && !rawLicense)
    return Response.json({ error: "websiteId or licenseNumber is required" }, { status: 400 });

  try {
    const { supabaseAdmin } = await import("./integrations/supabase/client.server");

    if (!websiteId) {
      const { resolveLicenseToWebsite } = await import("./lib/media/affected-licenses.server");
      const resolved = await resolveLicenseToWebsite(supabaseAdmin, rawLicense);
      if (!resolved.ok && resolved.status === 404)
        return Response.json({ error: "No website found for licenseNumber" }, { status: 404 });
      if (!resolved.ok)
        return Response.json(
          {
            error: "Ambiguous licenseNumber",
            profileIds: resolved.profileIds,
            websiteIds: resolved.websiteIds,
          },
          { status: 409 },
        );
      websiteId = resolved.websiteId;
      licenseNumber = resolved.licenseNumber;
    } else if (!UUID_RE.test(websiteId)) {
      return Response.json({ error: "websiteId must be a uuid" }, { status: 400 });
    }

    const { createContractorMediaRepairDeps } =
      await import("./lib/media/contractor-media-repair-deps.server");
    const { repairContractorMedia } = await import("./lib/media/contractor-media-repair.server");
    const result = await repairContractorMedia(createContractorMediaRepairDeps(supabaseAdmin), {
      websiteId,
      licenseNumber: licenseNumber ?? (rawLicense || null),
      dryRun,
    });
    console.info(
      JSON.stringify({
        event: "repair-contractor-media",
        timestamp: new Date(startedAt).toISOString(),
        websiteId,
        licenseNumber,
        dryRun,
        durationMs: Date.now() - startedAt,
        summary: result.summary,
      }),
    );
    return Response.json(result, { status: result.errors.length > 0 ? 207 : 200 });
  } catch (error) {
    const detail = sanitizeError(error);
    console.error(
      JSON.stringify({ event: "repair-contractor-media", websiteId, dryRun, error: detail }),
    );
    return Response.json({ error: detail }, { status: 500 });
  }
}

/** Authenticated seam for an external daily cron. Deletion is opt-in; omitted dryRun stays safe. */
async function maybeRunAddVideoOrphanSweep(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/sweep-add-video-orphans" || request.method !== "POST")
    return null;

  const startedAt = Date.now();
  const log = (status: number, detail: Record<string, unknown>) =>
    console.info(
      JSON.stringify({
        event: "add_video_orphan_sweep",
        status,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        ...detail,
      }),
    );

  const configuredSecret = process.env.ADD_VIDEO_ORPHAN_SWEEPER_SECRET;
  if (!configuredSecret) {
    log(503, { error: "not_configured" });
    return Response.json(
      { error: "ADD_VIDEO_ORPHAN_SWEEPER_SECRET not configured" },
      { status: 503 },
    );
  }
  const providedSecret = request.headers.get("x-add-video-orphan-sweeper-secret");
  const providedBytes = providedSecret ? Buffer.from(providedSecret) : Buffer.alloc(0);
  const configuredBytes = Buffer.from(configuredSecret);
  if (
    providedBytes.length !== configuredBytes.length ||
    !timingSafeEqual(providedBytes, configuredBytes)
  ) {
    log(403, { error: "forbidden" });
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let input: { dryRun?: unknown } = {};
  try {
    input = (await request.json()) as { dryRun?: unknown };
  } catch {
    // An empty cron body intentionally means dry-run.
  }
  if (input.dryRun !== undefined && typeof input.dryRun !== "boolean") {
    log(400, { error: "invalid_dry_run" });
    return Response.json({ error: "dryRun must be boolean" }, { status: 400 });
  }
  try {
    const { supabaseAdmin } = await import("./integrations/supabase/client.server");
    const { createAddVideoOrphanSweeperDeps, sweepAddVideoOrphans } =
      await import("./lib/media/add-video-orphan-sweeper.server");
    const result = await sweepAddVideoOrphans({
      deps: createAddVideoOrphanSweeperDeps(supabaseAdmin),
      dryRun: input.dryRun !== false,
    });
    const status = result.failures > 0 ? 207 : 200;
    log(status, {
      enumerated: result.enumerated,
      eligible: result.eligible,
      referenced: result.referenced,
      failures: result.failures,
      candidateCount: result.candidates.length,
      dryRun: result.dryRun,
    });
    return Response.json({ ...result, durationMs: Date.now() - startedAt }, { status });
  } catch (error) {
    const detail = sanitizeError(error);
    log(500, { error: detail });
    return Response.json({ error: detail }, { status: 500 });
  }
}

const PRODUCTION_HOSTS = new Set([
  "obratech.co",
  "www.obratech.co",
  "obra-tech.lovable.app",
]);

function isProductionHost(request: Request): boolean {
  const host = (new URL(request.url).hostname || "").toLowerCase();
  if (PRODUCTION_HOSTS.has(host)) return true;
  // Stable published project URL: project--<id>.lovable.app (never the -dev preview host).
  return /^project--[0-9a-f-]+\.lovable\.app$/.test(host);
}

/**
 * Production-only migration proxy.
 * POST /api/internal/apply-migration
 *   { "list": true }                                  -> allowlist of repo migrations + checksums
 *   { "name": "...sql", "checksum": "<sha256>" }      -> dry run (default), always rolled back
 *   { ..., "mode": "apply" }                          -> apply, only after a matching dry run
 */
async function maybeApplyRepoMigration(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/apply-migration" || request.method !== "POST") return null;

  const configuredSecret = process.env.MIGRATION_RUNNER_SECRET;
  if (!configuredSecret) {
    return Response.json({ error: "MIGRATION_RUNNER_SECRET not configured" }, { status: 503 });
  }
  if (!secretMatches(bearerToken(request), configuredSecret)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isProductionHost(request)) {
    return Response.json({ error: "Production host only" }, { status: 403 });
  }

  let input: { list?: unknown; name?: unknown; checksum?: unknown; mode?: unknown; actor?: unknown } =
    {};
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { getRepoMigration, listRepoMigrations } = await import(
    "./lib/migrations/repo-migrations.server"
  );

  if (input.list === true) {
    return Response.json({ migrations: listRepoMigrations() }, { status: 200 });
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const checksum = typeof input.checksum === "string" ? input.checksum.trim().toLowerCase() : "";
  const mode = input.mode === "apply" ? "apply" : "dry_run";
  const actor = typeof input.actor === "string" ? input.actor.slice(0, 120) : "terminal";
  if (!name || !checksum) {
    return Response.json({ error: "name and checksum are required" }, { status: 400 });
  }

  const migration = getRepoMigration(name);
  if (!migration) {
    return Response.json({ error: "Migration not in repository allowlist" }, { status: 404 });
  }
  if (migration.checksum !== checksum) {
    return Response.json(
      { error: "Checksum mismatch", expected: migration.checksum },
      { status: 409 },
    );
  }

  const startedAt = Date.now();
  try {
    const { supabaseAdmin } = await import("./integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("apply_repo_migration", {
      p_name: migration.name,
      p_checksum: migration.checksum,
      p_sql: migration.sql,
      p_mode: mode,
      p_actor: actor,
    });
    if (error) {
      return Response.json({ error: sanitizeError(error.message) }, { status: 500 });
    }
    const result = data as { status?: string } | null;
    const status = result?.status === "applied" || result?.status === "dry_run_ok" ? 200 : 409;
    console.info(
      JSON.stringify({
        event: "apply-repo-migration",
        name: migration.name,
        checksum: migration.checksum,
        mode,
        actor,
        result: result?.status,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      }),
    );
    return Response.json({ ...result, name: migration.name, mode }, { status });
  } catch (error) {
    return Response.json({ error: sanitizeError(error) }, { status: 500 });
  }
}
