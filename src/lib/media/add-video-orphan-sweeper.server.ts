import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isGeneratedMediaRelativePath } from "@/lib/media/generated-media-path";
import { readBodyLimited } from "@/lib/media/safe-remote-media.server";

const BUCKET = "site-media";
const MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const OWNED_WEBSITE_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIRECT_UPLOAD_FILE = /^\d{10,}-[0-9a-f]{8}\.[a-z0-9]+$/i;

type AdminClient = SupabaseClient<Database>;
type ListedObject = {
  name: string;
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
type Candidate = {
  storagePath: string;
  contentHash?: string;
  createdAt: string;
  source: "ledger" | "storage";
};

export type AddVideoOrphanSweepResult = {
  dryRun: boolean;
  cutoff: string;
  enumerated: number;
  eligible: number;
  referenced: number;
  deleted: number;
  failures: number;
  candidates: Array<{
    storagePath: string;
    source: Candidate["source"];
    action: "would_delete" | "deleted" | "referenced" | "failed";
    error?: string;
  }>;
};

export type AddVideoOrphanSweeperDeps = {
  list(prefix: string, offset: number, limit: number): Promise<ListedObject[]>;
  download(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  completeCleanup?(path: string): Promise<void>;
  listLedger(
    cutoff: string,
  ): Promise<Array<{ storage_path: string; content_hash: string; oldest_at: string }>>;
  isReferenced(path: string, hash: string, cutoff: string): Promise<boolean>;
  isDirectUploadReferenced?(path: string, cutoff: string): Promise<boolean>;
  log?: Pick<Console, "info" | "error">;
};

function candidateAge(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function listAll(deps: AddVideoOrphanSweeperDeps, prefix: string): Promise<ListedObject[]> {
  const all: ListedObject[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await deps.list(prefix, offset, PAGE_SIZE);
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

/** Enumerates only objects owned by the generated-media path contract. */
export async function enumerateOwnedGeneratedObjects(
  deps: AddVideoOrphanSweeperDeps,
): Promise<Candidate[]> {
  const roots = await listAll(deps, "");
  const candidates: Candidate[] = [];
  for (const root of roots) {
    if (!OWNED_WEBSITE_PREFIX.test(root.name)) continue;
    const rootObjects = await listAll(deps, root.name);
    for (const object of rootObjects) {
      if (!object.id || !DIRECT_UPLOAD_FILE.test(object.name)) continue;
      const createdAt = object.created_at ?? object.updated_at;
      if (!createdAt) continue;
      candidates.push({
        storagePath: `${root.name}/${object.name}`,
        createdAt,
        source: "storage",
      });
    }
    const generated = await listAll(deps, `${root.name}/generated`);
    for (const object of generated) {
      if (!object.id || !isGeneratedMediaRelativePath(`generated/${object.name}`)) continue;
      const createdAt = object.created_at ?? object.updated_at;
      if (!createdAt) continue;
      candidates.push({
        storagePath: `${root.name}/generated/${object.name}`,
        createdAt,
        source: "storage",
      });
    }
  }
  return candidates;
}

export async function sweepAddVideoOrphans(options: {
  deps: AddVideoOrphanSweeperDeps;
  dryRun?: boolean;
  minimumAgeMs?: number;
  now?: Date;
}): Promise<AddVideoOrphanSweepResult> {
  const dryRun = options.dryRun !== false;
  const minimumAgeMs = Math.max(options.minimumAgeMs ?? MINIMUM_AGE_MS, MINIMUM_AGE_MS);
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - minimumAgeMs).toISOString();
  const log = options.deps.log ?? console;
  const [ledger, storage] = await Promise.all([
    options.deps.listLedger(cutoff),
    enumerateOwnedGeneratedObjects(options.deps),
  ]);
  const byPath = new Map<string, Candidate>();
  for (const row of ledger)
    byPath.set(row.storage_path, {
      storagePath: row.storage_path,
      contentHash: row.content_hash,
      createdAt: row.oldest_at,
      source: "ledger",
    });
  for (const object of storage)
    if (!byPath.has(object.storagePath)) byPath.set(object.storagePath, object);
  const result: AddVideoOrphanSweepResult = {
    dryRun,
    cutoff,
    enumerated: byPath.size,
    eligible: 0,
    referenced: 0,
    deleted: 0,
    failures: 0,
    candidates: [],
  };
  for (const candidate of byPath.values()) {
    if (candidateAge(candidate.createdAt) > Date.parse(cutoff)) continue;
    result.eligible += 1;
    try {
      const hash =
        candidate.contentHash ??
        createHash("sha256")
          .update(await options.deps.download(candidate.storagePath))
          .digest("hex");
      const isDirectUpload = candidate.storagePath.split("/").length === 2;
      const referenced =
        isDirectUpload && options.deps.isDirectUploadReferenced
          ? await options.deps.isDirectUploadReferenced(candidate.storagePath, cutoff)
          : await options.deps.isReferenced(candidate.storagePath, hash, cutoff);
      if (referenced) {
        result.referenced += 1;
        result.candidates.push({
          storagePath: candidate.storagePath,
          source: candidate.source,
          action: "referenced",
        });
      } else if (dryRun) {
        result.candidates.push({
          storagePath: candidate.storagePath,
          source: candidate.source,
          action: "would_delete",
        });
      } else {
        // The candidate was older than the safety window and rechecked against every durable
        // reference immediately before this content-addressed, idempotent removal.
        await options.deps.remove(candidate.storagePath);
        await options.deps.completeCleanup?.(candidate.storagePath);
        result.deleted += 1;
        result.candidates.push({
          storagePath: candidate.storagePath,
          source: candidate.source,
          action: "deleted",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failures += 1;
      result.candidates.push({
        storagePath: candidate.storagePath,
        source: candidate.source,
        action: "failed",
        error: message,
      });
      log.error("[add-video-orphan-sweeper] candidate failed; retrying next daily run", {
        storagePath: candidate.storagePath,
        error: message,
      });
    }
  }
  log.info("[add-video-orphan-sweeper] run complete", result);
  return result;
}

export function createAddVideoOrphanSweeperDeps(supabase: AdminClient): AddVideoOrphanSweeperDeps {
  const bucket = supabase.storage.from(BUCKET);
  return {
    async list(prefix, offset, limit) {
      const { data, error } = await bucket.list(prefix, {
        offset,
        limit,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Unable to enumerate ${BUCKET}/${prefix}: ${error.message}`);
      return data ?? [];
    },
    async download(path) {
      const { data, error } = await bucket.download(path);
      if (error || !data)
        throw new Error(`Unable to hash ${BUCKET}/${path}: ${error?.message ?? "missing object"}`);
      return readBodyLimited(
        new Response(data.stream(), { headers: { "content-length": String(data.size) } }),
        50 * 1024 * 1024,
      );
    },
    async remove(path) {
      const { error } = await bucket.remove([path]);
      if (error) throw new Error(`Unable to delete ${BUCKET}/${path}: ${error.message}`);
    },
    async completeCleanup(path) {
      const { error } = await supabase.rpc(
        "complete_generation_media_cleanup" as never,
        {
          p_storage_path: path,
          p_actor: "scheduler:generated-media-cleanup",
        } as never,
      );
      if (error) throw new Error(`Unable to record generated-media cleanup: ${error.message}`);
    },
    async listLedger(cutoff) {
      const { data, error } = await supabase.rpc("list_add_video_orphan_candidates", {
        p_eligible_before: cutoff,
      });
      if (error) throw new Error(`Unable to list ledger orphans: ${error.message}`);
      return data ?? [];
    },
    async isReferenced(path, hash, cutoff) {
      const { data, error } = await supabase.rpc("add_video_storage_object_is_referenced", {
        p_storage_path: path,
        p_content_hash: hash,
        p_eligible_before: cutoff,
      });
      if (error || typeof data !== "boolean")
        throw new Error(
          `Unable to verify orphan references: ${error?.message ?? "invalid response"}`,
        );
      return data;
    },
    async isDirectUploadReferenced(path, cutoff) {
      const { data, error } = await supabase.rpc("direct_upload_storage_object_is_referenced", {
        p_storage_path: path,
      });
      if (error || typeof data !== "boolean")
        throw new Error(
          `Unable to verify direct upload references: ${error?.message ?? "invalid response"}`,
        );
      return data;
    },
  };
}
