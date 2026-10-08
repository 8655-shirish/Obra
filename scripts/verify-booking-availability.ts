import assert from "node:assert/strict";
import { buildAvailableSlots, localDateTimeCandidates } from "../src/lib/booking-availability.ts";
assert.equal(
  localDateTimeCandidates("2026-03-08", "02:30", "America/Los_Angeles").length,
  0,
  "DST gap must not produce a slot",
);
assert.equal(
  localDateTimeCandidates("2026-11-01", "01:30", "America/Los_Angeles").length,
  2,
  "DST repeated hour must expose both instants",
);
const slots = buildAvailableSlots({
  fromDate: "2026-06-01",
  dayCount: 1,
  timeZone: "America/Los_Angeles",
  durationMinutes: 60,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  minimumNoticeMinutes: 0,
  horizonDays: 730,
  intervals: [{ weekday: 1, localStart: "09:15", localEnd: "11:15" }],
  overrides: [],
  externalBusy: [{ start: "2026-06-01T16:45:00.000Z", end: "2026-06-01T17:00:00.000Z" }],
  internalBusy: [],
  now: new Date("2026-05-31T00:00:00Z"),
});
assert.deepEqual(
  slots.map((slot) => slot.localStart),
  ["10:15"],
  "interval-anchored cadence and buffered busy subtraction must agree",
);
const override = buildAvailableSlots({
  fromDate: "2026-06-01",
  dayCount: 1,
  timeZone: "Asia/Kolkata",
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 0,
  horizonDays: 730,
  intervals: [],
  overrides: [
    {
      localDate: "2026-06-01",
      type: "custom_hours",
      intervals: [{ localStart: "09:00", localEnd: "10:00" }],
    },
  ],
  externalBusy: [],
  internalBusy: [],
  now: new Date("2026-05-31T00:00:00Z"),
});
assert.equal(override.length, 2, "half-hour zones and custom overrides must produce valid slots");
console.log("verify-booking-availability: timezone, DST, cadence, buffers, and overrides pass");
