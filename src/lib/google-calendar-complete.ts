export function isGoogleAccountEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  const at = trimmed.indexOf("@");
  return at > 0 && at < trimmed.length - 1 && !trimmed.includes(" ");
}

/** Pipedream puts the Google email on `name`; `external_id` is our Connect user id. */
export function googleAccountEmail(account: {
  external_id?: string | null;
  name?: string | null;
}): string | null {
  if (isGoogleAccountEmail(account.external_id)) return account.external_id.trim();
  if (isGoogleAccountEmail(account.name)) return account.name.trim();
  return null;
}

export type PickableGoogleAccount = {
  id: string;
  healthy: boolean;
  createdAt?: string | null;
};

export function pickGoogleAccountForCompletion(input: {
  accounts: PickableGoogleAccount[];
  persistedAccountId?: string | null;
}): PickableGoogleAccount | null {
  const healthy = input.accounts.filter((account) => account.healthy);
  if (!healthy.length) return null;
  const newest = pickNewestAccount(healthy);
  const persisted = healthy.find((account) => account.id === input.persistedAccountId);
  if (!persisted || newest.id === persisted.id) return newest;
  // Old accounts remain available to existing bookings. A completion retry
  // must not switch back to one just because it differs from the saved account.
  const newestAt = Date.parse(newest.createdAt ?? "");
  const persistedAt = Date.parse(persisted.createdAt ?? "");
  return Number.isFinite(newestAt) && (!Number.isFinite(persistedAt) || newestAt > persistedAt)
    ? newest
    : persisted;
}

function pickNewestAccount(accounts: PickableGoogleAccount[]): PickableGoogleAccount {
  const dated = accounts.filter(
    (account) => account.createdAt && Number.isFinite(Date.parse(account.createdAt)),
  );
  if (dated.length) {
    return [...dated].sort(
      (left, right) => Date.parse(right.createdAt!) - Date.parse(left.createdAt!),
    )[0]!;
  }
  return accounts[accounts.length - 1]!;
}

export type PickableGoogleCalendar = {
  id: string;
  accessRole: string;
  primary?: boolean;
};

export function pickWritableBookingCalendar(input: {
  calendars: PickableGoogleCalendar[];
  persistedCalendarId?: string | null;
  sameAccount: boolean;
  accountEmail?: string | null;
}): PickableGoogleCalendar | null {
  const writable = input.calendars.filter(
    (calendar) => calendar.accessRole === "owner" || calendar.accessRole === "writer",
  );
  if (!writable.length) return null;
  if (input.sameAccount && input.persistedCalendarId) {
    const kept = writable.find((calendar) => calendar.id === input.persistedCalendarId);
    if (kept) return kept;
  }
  const primary = writable.find((calendar) => calendar.primary === true);
  if (primary) return primary;
  const email = input.accountEmail?.trim().toLowerCase();
  if (email) {
    const byEmail = writable.find((calendar) => calendar.id.toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  return writable.find((calendar) => calendar.accessRole === "owner") ?? writable[0] ?? null;
}
