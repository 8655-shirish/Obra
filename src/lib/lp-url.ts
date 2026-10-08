import { normalizeLicenseNumber } from "@/lib/auth/profile.server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidParam(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function licenseLpPath(licenseNumber: string): string {
  return `/lp/${encodeURIComponent(normalizeLicenseNumber(licenseNumber))}`;
}

export function publicLpUrl(
  baseUrl: string,
  opts: { purchased: boolean; licenseNumber: string | null; websiteId: string },
): string {
  const base = baseUrl.replace(/\/$/, "");
  if (opts.purchased && opts.licenseNumber) {
    return `${base}${licenseLpPath(opts.licenseNumber)}`;
  }
  return `${base}/lp/${opts.websiteId}`;
}
