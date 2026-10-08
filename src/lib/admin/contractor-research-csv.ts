export const CONTRACTOR_RESEARCH_MAX_ROWS = 200;
export const CONTRACTOR_RESEARCH_COMMENT_MAX = 2000;

export class ContractorResearchCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractorResearchCsvError";
  }
}

export type ParsedContractorResearchSheet = {
  headers: string[];
  rows: Record<string, string>[];
};

export type ResearchRowIdentity = {
  businessName: string;
  licenseNumber: string;
  city: string;
  phone: string;
  address: string;
  ok: boolean;
  reason: string | null;
};

function cellByCanonical(cells: Record<string, string>, canonical: string): string {
  const wanted = canonical.toLowerCase();
  for (const [key, value] of Object.entries(cells)) {
    if (key.toLowerCase() === wanted) return typeof value === "string" ? value.trim() : "";
  }
  return "";
}

export function isCslbHeaderRow(row: string[]): boolean {
  const names = new Set(row.map((cell) => cell.trim().toLowerCase()).filter(Boolean));
  return names.has("businessname") && names.has("license");
}

export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < input.length) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) throw new ContractorResearchCsvError("CSV has an unclosed quote.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseContractorResearchCsv(text: string): ParsedContractorResearchSheet {
  const table = parseCsv(text);
  const headerIndex = table.findIndex((row) => isCslbHeaderRow(row));
  if (headerIndex < 0) {
    throw new ContractorResearchCsvError(
      "Could not find a header row with BusinessName and License. Export the contractor list as CSV.",
    );
  }
  const headers = table[headerIndex].map((header, index) => header.trim() || `Column ${index + 1}`);
  const rows: Record<string, string>[] = [];
  for (const raw of table.slice(headerIndex + 1)) {
    if (raw.every((cell) => !cell.trim())) continue;
    const cells: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      cells[headers[i]] = raw[i] ?? "";
    }
    rows.push(cells);
  }
  if (rows.length === 0) {
    throw new ContractorResearchCsvError("No contractor rows found after the header.");
  }
  if (rows.length > CONTRACTOR_RESEARCH_MAX_ROWS) {
    throw new ContractorResearchCsvError(
      `This file has ${rows.length} contractors. Upload at most ${CONTRACTOR_RESEARCH_MAX_ROWS} rows.`,
    );
  }
  return { headers, rows };
}

export function assertCsvFilename(filename: string): void {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    throw new ContractorResearchCsvError("Export CSV from Excel, then upload the .csv file.");
  }
  if (!lower.endsWith(".csv")) {
    throw new ContractorResearchCsvError("Upload a CSV file.");
  }
}

export function titleFromFilename(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  const stripped = base.replace(/\.csv$/i, "").trim();
  return stripped || "Untitled";
}

export function researchIdentityFromCells(cells: Record<string, string>): ResearchRowIdentity {
  const businessName = cellByCanonical(cells, "BusinessName");
  const licenseNumber = cellByCanonical(cells, "License");
  const city = cellByCanonical(cells, "City");
  const phone = cellByCanonical(cells, "PhoneNumber");
  const street = cellByCanonical(cells, "Address");
  const state = cellByCanonical(cells, "State");
  const zip = cellByCanonical(cells, "ZipCode");
  const address = [street, city, state, zip].filter(Boolean).join(", ");
  if (!businessName || !licenseNumber) {
    return {
      businessName,
      licenseNumber,
      city,
      phone,
      address,
      ok: false,
      reason: "Business name and license are required to start research.",
    };
  }
  return {
    businessName,
    licenseNumber,
    city,
    phone,
    address,
    ok: true,
    reason: null,
  };
}

export function onboardingFromResearchCells(cells: unknown): Record<string, unknown> {
  const record = cellsRecord(cells);
  const identity = researchIdentityFromCells(record);
  return {
    businessName: identity.businessName,
    licenseNumber: identity.licenseNumber,
    city: identity.city,
    trade: "",
    services: [],
    phone: identity.phone,
    address: identity.address,
  };
}

export function cellsRecord(cells: unknown): Record<string, string> {
  if (!cells || typeof cells !== "object" || Array.isArray(cells)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cells as Record<string, unknown>)) {
    out[key] = typeof value === "string" ? value : value == null ? "" : String(value);
  }
  return out;
}

export function hasEnrichmentPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const platforms = (value as Record<string, unknown>).platforms;
  if (!platforms || typeof platforms !== "object" || Array.isArray(platforms)) return false;
  return Object.keys(platforms).length > 0;
}
