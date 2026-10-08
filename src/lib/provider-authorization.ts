export type ProviderEntitlementSnapshot = {
  plan: string | null;
  state: string | null;
  order_confirmed_at: string | null;
  effective_at: string | null;
  ends_at: string | null;
};

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Future shared-provider mutations require a confirmed, currently effective Pro entitlement.
 * Grace remains service-entitled in the existing product lifecycle, while suspended/cancelled/
 * expired entitlements fail closed.
 */
export function isCurrentActiveConfirmedPro(
  entitlement: ProviderEntitlementSnapshot | null | undefined,
  now = Date.now(),
): boolean {
  if (!entitlement || entitlement.plan !== "pro") return false;
  if (entitlement.state !== "active" && entitlement.state !== "grace") return false;
  const confirmedAt = timestamp(entitlement.order_confirmed_at);
  const effectiveAt = timestamp(entitlement.effective_at);
  const endsAt = timestamp(entitlement.ends_at);
  return Boolean(
    confirmedAt !== null &&
      confirmedAt <= now &&
      effectiveAt !== null &&
      effectiveAt <= now &&
      (entitlement.ends_at === null || (endsAt !== null && endsAt > now)),
  );
}

/** Destructive profile/environment-wide provider disconnects are opt-in. */
export function isSharedProviderDisconnectEnabled(value: string | undefined): boolean {
  return value === "true";
}
