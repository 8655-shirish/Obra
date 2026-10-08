export type BookingInterval = { weekday: number; localStart: string; localEnd: string };
export type BookingOverride = {
  localDate: string;
  type: "unavailable" | "custom_hours";
  intervals: { localStart: string; localEnd: string }[];
};
export type BusyRange = { start: string; end: string };
export type BookingSlot = { startAt: string; endAt: string; localDate: string; localStart: string };

function parts(instant: Date, timeZone: string) {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .filter((value) => value.type !== "literal")
      .map((value) => [value.type, value.value]),
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  };
}
function pad(value: number) {
  return String(value).padStart(2, "0");
}
function localKey(value: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}) {
  return (
    String(value.year).padStart(4, "0") +
    "-" +
    pad(value.month) +
    "-" +
    pad(value.day) +
    "T" +
    pad(value.hour) +
    ":" +
    pad(value.minute)
  );
}
/** Returns every UTC instant matching the local minute: none for a DST gap, two for a repeated hour. */
export function localDateTimeCandidates(
  localDate: string,
  localTime: string,
  timeZone: string,
): Date[] {
  const dateParts = localDate.split("-").map(Number);
  const timeParts = localTime.split(":").map(Number);
  const [year, month, day] = dateParts;
  const [hour, minute] = timeParts;
  if (![year, month, day, hour, minute].every(Number.isFinite)) return [];
  const target = localDate + "T" + pad(hour) + ":" + pad(minute);
  const center = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (const probeHours of [-36, -12, 0, 12, 36]) {
    const probe = new Date(center + probeHours * 3_600_000);
    const local = parts(probe, timeZone);
    const representedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    offsets.add(representedAsUtc - probe.getTime());
  }
  return [...offsets]
    .map((offset) => new Date(center - offset))
    .filter((instant) => localKey(parts(instant, timeZone)) === target)
    .sort((a, b) => a.getTime() - b.getTime());
}
function minutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
function datePlusDays(isoDate: string, days: number) {
  const date = new Date(isoDate + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function weekday(isoDate: string) {
  return new Date(isoDate + "T12:00:00Z").getUTCDay();
}
function intersects(start: number, end: number, range: BusyRange) {
  const busyStart = Date.parse(range.start),
    busyEnd = Date.parse(range.end);
  return (
    Number.isFinite(busyStart) && Number.isFinite(busyEnd) && start < busyEnd && end > busyStart
  );
}

export function buildAvailableSlots(input: {
  fromDate: string;
  dayCount: number;
  timeZone: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  horizonDays: number;
  intervals: BookingInterval[];
  overrides: BookingOverride[];
  externalBusy: BusyRange[];
  internalBusy: BusyRange[];
  now?: Date;
}): BookingSlot[] {
  const now = input.now ?? new Date();
  const earliest = now.getTime() + input.minimumNoticeMinutes * 60_000;
  const horizon = now.getTime() + input.horizonDays * 86_400_000;
  const overrideByDate = new Map(input.overrides.map((value) => [value.localDate, value]));
  const result: BookingSlot[] = [];
  for (let dayOffset = 0; dayOffset < Math.min(Math.max(input.dayCount, 1), 62); dayOffset++) {
    const localDate = datePlusDays(input.fromDate, dayOffset);
    const override = overrideByDate.get(localDate);
    if (override?.type === "unavailable") continue;
    const windows =
      override?.type === "custom_hours"
        ? override.intervals
        : input.intervals.filter((value) => value.weekday === weekday(localDate));
    for (const window of windows) {
      const windowStart = minutes(window.localStart),
        windowEnd = minutes(window.localEnd);
      for (
        let cursor = windowStart;
        cursor + input.durationMinutes <= windowEnd;
        cursor += input.slotIntervalMinutes
      ) {
        const localStart = pad(Math.floor(cursor / 60)) + ":" + pad(cursor % 60);
        for (const candidate of localDateTimeCandidates(localDate, localStart, input.timeZone)) {
          const start = candidate.getTime(),
            end = start + input.durationMinutes * 60_000;
          const blockedStart = start - input.bufferBeforeMinutes * 60_000,
            blockedEnd = end + input.bufferAfterMinutes * 60_000;
          if (start < earliest || start > horizon) continue;
          if (
            [...input.externalBusy, ...input.internalBusy].some((range) =>
              intersects(blockedStart, blockedEnd, range),
            )
          )
            continue;
          result.push({
            startAt: candidate.toISOString(),
            endAt: new Date(end).toISOString(),
            localDate,
            localStart,
          });
        }
      }
    }
  }
  return result.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
