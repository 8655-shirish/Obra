const STORAGE_PREFIX = "obra_demo_license:";

export interface DemoLicenseUnlock {
  licenseNumber: string;
  verifiedAt: string;
}

function storageKey(websiteId: string, versionId: string): string {
  return `${STORAGE_PREFIX}${websiteId}:${versionId}`;
}

export function saveDemoLicenseUnlock(
  websiteId: string,
  versionId: string,
  licenseNumber: string,
): void {
  if (typeof sessionStorage === "undefined") return;
  const payload: DemoLicenseUnlock = {
    licenseNumber,
    verifiedAt: new Date().toISOString(),
  };
  sessionStorage.setItem(storageKey(websiteId, versionId), JSON.stringify(payload));
}

export function readDemoLicenseUnlock(
  websiteId: string,
  versionId: string,
): DemoLicenseUnlock | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(storageKey(websiteId, versionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DemoLicenseUnlock;
    if (!parsed.licenseNumber || typeof parsed.licenseNumber !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDemoLicenseUnlock(websiteId: string, versionId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(storageKey(websiteId, versionId));
}
