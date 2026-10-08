import { createHash } from "node:crypto";

// Build-time allowlist: only SQL files committed under supabase/migrations can ever run.
const MIGRATION_FILES = import.meta.glob("/supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type RepoMigration = { name: string; checksum: string; sql: string };

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function listRepoMigrations(): Array<{ name: string; checksum: string; bytes: number }> {
  return Object.entries(MIGRATION_FILES)
    .map(([path, sql]) => ({ name: basename(path), checksum: sha256(sql), bytes: sql.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getRepoMigration(name: string): RepoMigration | null {
  // Reject anything that is not a bare filename before touching the allowlist.
  if (!/^[0-9A-Za-z_.-]+\.sql$/.test(name)) return null;
  const entry = Object.entries(MIGRATION_FILES).find(([path]) => basename(path) === name);
  if (!entry) return null;
  return { name, checksum: sha256(entry[1]), sql: entry[1] };
}
