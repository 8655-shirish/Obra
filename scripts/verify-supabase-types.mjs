import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = "supabase/migrations";
const typesPath = "src/integrations/supabase/types.ts";

const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const types = readFileSync(typesPath, "utf8");
const sqlTypePattern =
  "uuid|text|jsonb|json|int|integer|smallint|bigint|boolean|bool|timestamptz|timestamp(?: with(?:out)? time zone)?|date|time|bytea|numeric|decimal|real|double precision|serial|bigserial|xid8|inet|citext|tstzrange";

/** @returns {Record<string, string[]>} */
function parseMigrationTables(sql) {
  const tables = {};
  const tableRegex = /create table(?: if not exists)? public\.(\w+)\s*\(([\s\S]*?)\);/gi;
  let match;

  while ((match = tableRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const body = match[2];
    const columns = [];

    // Generated migrations may place several column definitions on one physical line.
    // Match each top-level comma/start-delimited definition rather than only the line prefix.
    const columnRegex = new RegExp(`(?:^|,)\\s*(\\w+)\\s+(?:${sqlTypePattern})\\b`, "gi");
    let columnMatch;
    while ((columnMatch = columnRegex.exec(body)) !== null) {
      if (
        !["constraint", "unique", "check", "primary", "foreign"].includes(
          columnMatch[1].toLowerCase(),
        )
      ) {
        columns.push(columnMatch[1]);
      }
    }

    tables[tableName] = columns;
  }

  return tables;
}

/** @returns {string[] | null} */
function parseTypesShapeColumns(typesContent, tableName, shape) {
  const next = shape === "Row" ? "Insert" : shape === "Insert" ? "Update" : "Relationships";
  const regex = new RegExp(
    `\\n      ${tableName}: \\{[\\s\\S]*?${shape}: \\{([\\s\\S]*?)\\};?\\s*${next}:`,
    "m",
  );
  const match = typesContent.match(regex);
  if (!match) return null;

  return [...match[1].matchAll(/^\s+(?:(\w+)|\["(\w+)"\])\??:/gm)].map(
    (m) => m[1] ?? m[2],
  );
}

/** @type {Record<string, string[]>} */
const tables = {};

/** Merge ALTER TABLE ADD COLUMN into the accumulated table map. */
function parseMigrationAlterColumns(sql, tables) {
  const alterRegex = new RegExp(
    `alter table public\\.(\\w+)\\s+add column(?:\\s+if not exists)?\\s+(\\w+)\\s+(?:${sqlTypePattern})\\b`,
    "gi",
  );
  let match;

  while ((match = alterRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const columnName = match[2];
    if (!tables[tableName]) {
      tables[tableName] = [];
    }
    if (!tables[tableName].includes(columnName)) {
      tables[tableName].push(columnName);
    }
  }

  // Also support one ALTER TABLE statement containing comma-separated ADD COLUMN clauses.
  const groupedAlterRegex = /alter table public\.(\w+)\s+([\s\S]*?);/gi;
  while ((match = groupedAlterRegex.exec(sql)) !== null) {
    const tableName = match[1];
    const clause = match[2];
    const columnRegex = new RegExp(
      `(?:^|,)\\s*add column(?:\\s+if not exists)?\\s+(\\w+)\\s+(?:${sqlTypePattern})\\b`,
      "gi",
    );
    let columnMatch;
    while ((columnMatch = columnRegex.exec(clause)) !== null) {
      tables[tableName] ??= [];
      if (!tables[tableName].includes(columnMatch[1])) tables[tableName].push(columnMatch[1]);
    }
  }
}

for (const file of migrationFiles) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  Object.assign(tables, parseMigrationTables(sql));
  parseMigrationAlterColumns(sql, tables);
}

const tableNames = Object.keys(tables);

for (const retiredRpc of [
  "claim_site_generation_stage",
  "yield_site_generation_stage",
  "supersede_site_generation_epoch",
  "insert_generated_website_version",
]) {
  if (new RegExp(`\\n      ${retiredRpc}: \\{`).test(types)) {
    console.error(`Retired generation RPC remains in types.ts: ${retiredRpc}`);
    process.exit(1);
  }
}

const missingTables = tableNames.filter((table) => !types.includes(`${table}: {`));
if (missingTables.length > 0) {
  console.error("Tables in migrations missing from types.ts:", missingTables.join(", "));
  process.exit(1);
}

const columnMismatches = [];

for (const tableName of tableNames) {
  const migrationColumns = tables[tableName];
  for (const shape of ["Row", "Insert", "Update"]) {
    const typesColumns = parseTypesShapeColumns(types, tableName, shape);
    if (!typesColumns) {
      columnMismatches.push({ table: tableName, issue: `${shape} type not found in types.ts` });
      continue;
    }
    const missingInTypes = migrationColumns.filter((col) => !typesColumns.includes(col));
    const extraInTypes = typesColumns.filter((col) => !migrationColumns.includes(col));
    if (missingInTypes.length > 0 || extraInTypes.length > 0) {
      columnMismatches.push({ table: `${tableName}.${shape}`, missingInTypes, extraInTypes });
    }
  }
  const tableBlock = new RegExp(`\\n      ${tableName}: \\{[\\s\\S]*?Relationships: \\[`, "m");
  if (!tableBlock.test(types))
    columnMismatches.push({ table: tableName, issue: "Relationships type not found" });
}

if (columnMismatches.length > 0) {
  console.error("Column mismatches between migrations and types.ts:");
  for (const mismatch of columnMismatches) {
    console.error(`  ${mismatch.table}:`);
    if (mismatch.issue) {
      console.error(`    ${mismatch.issue}`);
      continue;
    }
    if (mismatch.missingInTypes?.length) {
      console.error(`    missing in types.ts: ${mismatch.missingInTypes.join(", ")}`);
    }
    if (mismatch.extraInTypes?.length) {
      console.error(`    extra in types.ts: ${mismatch.extraInTypes.join(", ")}`);
    }
  }
  process.exit(1);
}

console.log(
  `OK: ${tableNames.length} tables across ${migrationFiles.length} migrations match ${typesPath}`,
);
