export function asOnboardingRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function hasCheckoutConfirmed(onboarding: unknown): boolean {
  const value = asOnboardingRecord(onboarding).checkoutConfirmedAt;
  return typeof value === "string" && value.trim().length > 0;
}

export function onboardingIso(onboarding: unknown, key: string): string | null {
  const value = asOnboardingRecord(onboarding)[key];
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}
