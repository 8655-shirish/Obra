import { Copy, Info, Plus, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { saveBookingAvailability } from "@/lib/booking-setup.functions";

type SetupData = Awaited<ReturnType<typeof saveBookingAvailability>>;
type Config = SetupData["configuration"];
type Interval = Config["intervals"][number];
type Override = Config["overrides"][number];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_INTERVAL = { localStart: "09:00", localEnd: "17:00" };

function initialConfig(input: Config): Config {
  if (input.intervals.length) return structuredClone(input);
  return {
    ...structuredClone(input),
    intervals: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, ...DEFAULT_INTERVAL, sortOrder: 0 })),
  };
}

function formatPrice(amountMinor: number): string {
  if (amountMinor <= 0) return "";
  const cents = String(amountMinor);
  return `${cents.slice(0, -2) || "0"}.${cents.slice(-2).padStart(2, "0")}`;
}

export function AvailabilityEditor({
  websiteId,
  initial,
  disabled = false,
  onSaved,
}: {
  websiteId: string;
  initial: Config;
  disabled?: boolean;
  onSaved?: () => void | Promise<void>;
}) {
  const [config, setConfig] = useState(() => initialConfig(initial));
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(initialConfig(initial)));
  const [price, setPrice] = useState(() => formatPrice(initial.service.amountMinor));
  const [saving, setSaving] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [message, setMessage] = useState<{ title: string; text: string } | null>(null);
  const dirty =
    JSON.stringify(config) !== savedSnapshot || price !== formatPrice(config.service.amountMinor);
  const editorDisabled = disabled || saving || reloadRequired;
  const requestScope = useRef<{ websiteId: string; disabled: boolean; saving: boolean } | null>(
    null,
  );
  useLayoutEffect(() => {
    const scope = { websiteId, disabled: true, saving: false };
    requestScope.current = scope;
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [websiteId]);
  useLayoutEffect(() => {
    if (requestScope.current) requestScope.current.disabled = editorDisabled;
  }, [websiteId, editorDisabled]);
  useLayoutEffect(() => {
    if (saving) return;
    const next = initialConfig(initial);
    // A parent can still hold the pre-save input. Never roll back a saved revision.
    if (
      (next.serviceRevision ?? 0) < (config.serviceRevision ?? 0) ||
      (next.scheduleRevision ?? 0) < (config.scheduleRevision ?? 0)
    )
      return;
    const snapshot = JSON.stringify(next);
    if (snapshot === savedSnapshot) return;
    if (dirty) {
      setMessage({
        title: "Settings changed",
        text: "These settings changed elsewhere. Your edits are still here; reload in another tab to compare before saving again.",
      });
      return;
    }
    setConfig(next);
    setPrice(formatPrice(next.service.amountMinor));
    setSavedSnapshot(snapshot);
    setMessage(null);
  }, [initial, saving, dirty, savedSnapshot, config.serviceRevision, config.scheduleRevision]);
  const [dollars, cents = ""] = price.trim().split(".");
  // Preserve editing text; convert decimal digits to cents without rounding money.
  const amountMinor = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(price.trim())
    ? Number(`${dollars || "0"}${cents.padEnd(2, "0")}`)
    : NaN;
  const validPrice = Number.isSafeInteger(amountMinor) && amountMinor > 0;
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty && !reloadRequired) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, reloadRequired]);
  const grouped = useMemo(
    () =>
      DAYS.map((_, weekday) =>
        config.intervals
          .filter((row) => row.weekday === weekday)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      ),
    [config.intervals],
  );
  function setService<K extends keyof Config["service"]>(key: K, value: Config["service"][K]) {
    setConfig((c) => ({ ...c, service: { ...c.service, [key]: value } }));
  }
  function replaceDay(weekday: number, rows: Interval[]) {
    if (
      editorDisabled ||
      !requestScope.current ||
      requestScope.current.disabled ||
      requestScope.current.saving
    )
      return;
    setConfig((c) => ({
      ...c,
      intervals: [
        ...c.intervals.filter((r) => r.weekday !== weekday),
        ...rows.map((r, i) => ({ ...r, weekday, sortOrder: i })),
      ],
    }));
  }
  function updateOverride(index: number, patch: Partial<Override>) {
    setConfig((c) => ({
      ...c,
      overrides: c.overrides.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }
  function addOverride() {
    let localDate: string;
    try {
      localDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: config.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      setMessage({
        title: "Check your settings",
        text: "Enter a valid IANA time zone before adding a date override.",
      });
      return;
    }
    setMessage(null);
    setConfig((c) => ({
      ...c,
      overrides: [
        ...c.overrides,
        {
          localDate,
          type: "unavailable",
          reason: "",
          intervals: [],
        },
      ],
    }));
  }
  function updateInterval(
    day: number,
    index: number,
    key: "localStart" | "localEnd",
    value: string,
  ) {
    const rows = grouped[day].map((row, i) => (i === index ? { ...row, [key]: value } : row));
    replaceDay(day, rows);
  }
  async function save() {
    const scope = requestScope.current;
    if (editorDisabled || scope?.websiteId !== websiteId || scope.disabled || scope.saving) return;
    setMessage(null);
    if (!validPrice) {
      setMessage({
        title: "Check your settings",
        text: "Enter a price greater than $0 with at most two decimal places.",
      });
      return;
    }
    scope.saving = true;
    setSaving(true);
    let saved = false;
    try {
      const result = await saveBookingAvailability({
        data: {
          websiteId,
          serviceRevision: config.serviceRevision,
          scheduleRevision: config.scheduleRevision,
          service: {
            ...config.service,
            amountMinor,
            description: config.service.description,
            locationInstructions: config.service.locationInstructions,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
          },
          timeZone: config.timeZone,
          intervals: config.intervals,
          overrides: config.overrides,
        },
      });
      if (requestScope.current !== scope) return;
      const next = initialConfig(result.configuration);
      setConfig(next);
      setPrice(formatPrice(next.service.amountMinor));
      setSavedSnapshot(JSON.stringify(next));
      saved = true;
      setMessage({
        title: "Saved",
        text: "Your booking settings are saved.",
      });
      await onSaved?.();
    } catch (error) {
      if (requestScope.current !== scope) return;
      const text =
        error instanceof Error ? error.message : "Unable to save availability. Please try again.";
      if (saved) {
        setMessage({
          title: "Saved",
          text: "Availability was saved, but setup status could not refresh. Reload the page to continue.",
        });
      } else if (text === "AVAILABILITY_SAVED_RELOAD_REQUIRED") {
        setReloadRequired(true);
        setMessage({
          title: "Saved; reload required",
          text: "Availability was saved, but the updated settings could not be loaded. Reload the page before editing again.",
        });
      } else if (text === "REVISION_CONFLICT") {
        setMessage({
          title: "Settings changed",
          text: "These settings changed elsewhere. Your edits are still here; reload in another tab to compare before saving again.",
        });
      } else if (text.startsWith("INVALID_AVAILABILITY: ")) {
        setMessage({
          title: "Check your settings",
          text: text.slice("INVALID_AVAILABILITY: ".length),
        });
      } else {
        setMessage({ title: "Unable to save", text });
      }
    } finally {
      if (requestScope.current === scope) {
        scope.saving = false;
        setSaving(false);
      }
    }
  }
  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <fieldset
          disabled={editorDisabled}
          className="min-w-0 space-y-6"
          aria-label="Booking availability"
        >
          <Card>
            <CardHeader>
              <CardTitle>Appointment details</CardTitle>
              <CardDescription>
                One service and full USD price are shared by every booking-enabled website for this
                business.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <FieldLabel htmlFor="service-name" info={FIELD_INFO.serviceName}>
                  Service name
                </FieldLabel>
                <Input
                  id="service-name"
                  value={config.service.name}
                  onChange={(e) => setService("name", e.target.value)}
                />
              </div>
              <NumberField
                label="Duration (minutes)"
                value={config.service.durationMinutes}
                onChange={(v) => setService("durationMinutes", v)}
                info={FIELD_INFO.duration}
              />
              <NumberField
                label="Start-time interval (minutes)"
                value={config.service.slotIntervalMinutes}
                onChange={(v) => setService("slotIntervalMinutes", v)}
                info={FIELD_INFO.slotInterval}
              />
              <NumberField
                label="Minimum notice (hours)"
                value={config.service.minimumNoticeMinutes / 60}
                onChange={(hours) => setService("minimumNoticeMinutes", hoursToMinutes(hours))}
                info={FIELD_INFO.minimumNotice}
              />
              <NumberField
                label="Booking horizon (days)"
                value={config.service.bookingHorizonDays}
                onChange={(v) => setService("bookingHorizonDays", v)}
                info={FIELD_INFO.horizon}
              />
              <div className="space-y-2">
                <FieldLabel htmlFor="price" info={FIELD_INFO.price}>
                  Price per booking (USD)
                </FieldLabel>
                <Input
                  id="price"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={price}
                  aria-invalid={price.length > 0 && !validPrice}
                  aria-describedby="price-help"
                  onChange={(e) => setPrice(e.target.value)}
                />
                <p id="price-help" className="text-xs text-muted-foreground">
                  {price.length > 0 && !validPrice
                    ? "Enter a price greater than $0 with at most two decimal places."
                    : "Customers pay this full amount for every slot."}
                </p>
              </div>
              <div className="space-y-2">
                <FieldLabel htmlFor="location" info={FIELD_INFO.location}>
                  Location
                </FieldLabel>
                <select
                  id="location"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={config.service.locationType}
                  onChange={(e) =>
                    setService("locationType", e.target.value as Config["service"]["locationType"])
                  }
                >
                  <option value="customer_address">Customer address</option>
                  <option value="business_address">Business address</option>
                  <option value="remote">Remote</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Date overrides
                <FieldInfo label="Date overrides" text={FIELD_INFO.overrides} />
              </CardTitle>
              <CardDescription>
                Unavailable dates replace weekly hours. Custom hours replace them with one explicit
                window.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {config.overrides.map((override, index) => (
                <div key={index} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-5">
                  <Input
                    aria-label="Override date"
                    type="date"
                    value={override.localDate}
                    onChange={(e) => updateOverride(index, { localDate: e.target.value })}
                  />
                  <select
                    aria-label="Override type"
                    className="rounded-md border bg-background px-3"
                    value={override.type}
                    onChange={(e) =>
                      updateOverride(index, {
                        type: e.target.value as Override["type"],
                        intervals:
                          e.target.value === "custom_hours"
                            ? [{ localStart: "09:00", localEnd: "17:00", sortOrder: 0 }]
                            : [],
                      })
                    }
                  >
                    <option value="unavailable">Unavailable</option>
                    <option value="custom_hours">Custom hours</option>
                  </select>
                  {override.type === "custom_hours" ? (
                    <>
                      <Input
                        aria-label="Override start"
                        type="time"
                        value={override.intervals[0]?.localStart ?? "09:00"}
                        onChange={(e) =>
                          updateOverride(index, {
                            intervals: [
                              {
                                localStart: e.target.value,
                                localEnd: override.intervals[0]?.localEnd ?? "17:00",
                                sortOrder: 0,
                              },
                            ],
                          })
                        }
                      />
                      <Input
                        aria-label="Override end"
                        type="time"
                        value={override.intervals[0]?.localEnd ?? "17:00"}
                        onChange={(e) =>
                          updateOverride(index, {
                            intervals: [
                              {
                                localStart: override.intervals[0]?.localStart ?? "09:00",
                                localEnd: e.target.value,
                                sortOrder: 0,
                              },
                            ],
                          })
                        }
                      />
                    </>
                  ) : (
                    <Input
                      className="sm:col-span-2"
                      aria-label="Override reason"
                      placeholder="Reason (optional)"
                      value={override.reason ?? ""}
                      onChange={(e) => updateOverride(index, { reason: e.target.value })}
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove override"
                    onClick={() =>
                      setConfig((c) => ({
                        ...c,
                        overrides: c.overrides.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addOverride}>
                <Plus className="mr-2 h-4 w-4" />
                Add date override
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                Weekly hours
                <FieldInfo label="Weekly hours" text={FIELD_INFO.weeklyHours} />
              </CardTitle>
              <CardDescription>
                Times use your selected IANA time zone. Add separate windows for breaks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <FieldLabel htmlFor="timezone" info={FIELD_INFO.timeZone}>
                  Time zone
                </FieldLabel>
                <Input
                  id="timezone"
                  value={config.timeZone}
                  onChange={(e) => setConfig((c) => ({ ...c, timeZone: e.target.value }))}
                  placeholder="America/Los_Angeles"
                />
              </div>
              {DAYS.map((day, weekday) => {
                const rows = grouped[weekday];
                return (
                  <div key={day} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div
                        className="flex min-h-11 cursor-pointer items-center gap-3"
                        onClick={() =>
                          replaceDay(
                            weekday,
                            rows.length ? [] : [{ weekday, ...DEFAULT_INTERVAL, sortOrder: 0 }],
                          )
                        }
                      >
                        <Switch
                          aria-label={`Enable ${day}`}
                          checked={rows.length > 0}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(enabled) =>
                            replaceDay(
                              weekday,
                              enabled ? [{ weekday, ...DEFAULT_INTERVAL, sortOrder: 0 }] : [],
                            )
                          }
                        />
                        <span className="font-medium">{day}</span>
                      </div>
                      {rows.length ? (
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Copy to weekdays"
                            onClick={() => {
                              for (const target of [1, 2, 3, 4, 5])
                                if (target !== weekday) replaceDay(target, rows);
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            title="Add hours"
                            onClick={() =>
                              replaceDay(weekday, [
                                ...rows,
                                { weekday, ...DEFAULT_INTERVAL, sortOrder: rows.length },
                              ])
                            }
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {rows.length ? (
                      <div className="mt-3 space-y-2">
                        {rows.map((row, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              aria-label={`${day} start`}
                              type="time"
                              value={row.localStart}
                              onChange={(e) =>
                                updateInterval(weekday, index, "localStart", e.target.value)
                              }
                            />
                            <span>to</span>
                            <Input
                              aria-label={`${day} end`}
                              type="time"
                              value={row.localEnd}
                              onChange={(e) =>
                                updateInterval(weekday, index, "localEnd", e.target.value)
                              }
                            />
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove ${day} interval`}
                              onClick={() =>
                                replaceDay(
                                  weekday,
                                  rows.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">Unavailable</p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
          {message ? (
            <Alert>
              <AlertTitle>{message.title}</AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          ) : null}
          <p className="text-sm text-muted-foreground">
            These changes will show on your live website for your customers. You can come back and
            change them here anytime.
          </p>
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">
              {reloadRequired
                ? "Reload to view saved settings"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
            </span>
            <Button
              disabled={editorDisabled || !dirty || !validPrice || config.intervals.length === 0}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save and continue"}
            </Button>
          </div>
        </fieldset>
        <aside>
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Customer preview</CardTitle>
              <CardDescription>Provider-independent preview of your booking rules.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="font-medium">{config.service.name}</p>
                <p className="text-sm text-muted-foreground">
                  {config.service.durationMinutes} minutes · {config.timeZone}
                </p>
              </div>
              <p className="text-2xl font-bold">
                {validPrice
                  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
                      amountMinor / 100,
                    )
                  : "Enter a price"}
              </p>
              <p className="text-sm text-muted-foreground">
                Calendar conflicts are not shown in this provider-independent preview.
              </p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </TooltipProvider>
  );
}
function hoursToMinutes(hours: number) {
  if (!Number.isFinite(hours) || hours < 0) return 0;
  return Math.round(hours) * 60;
}

const FIELD_INFO = {
  serviceName: "The name customers see when they book, like Roof inspection or Free estimate.",
  duration: "How long each visit lasts. Customers see this when they pick a time.",
  slotInterval:
    "How often a new visit can start. Every 30 minutes means they can book 9:00, 9:30, 10:00, and so on.",
  minimumNotice:
    "How far ahead a customer must book. 24 hours means they cannot book for later today.",
  horizon: "How far into the future customers can book, in days.",
  price: "What the customer pays for each visit.",
  location: "Where the visit happens — at their place, yours, or online.",
  overrides: "Close a specific day or set different hours, such as a holiday.",
  weeklyHours: "The days and times you are open for bookings.",
  timeZone: "Your local time. Appointment times on your website use this.",
} as const;

function FieldInfo({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label={`About ${label}`}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-xs text-sm font-normal leading-relaxed"
      >
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({
  htmlFor,
  info,
  children,
}: {
  htmlFor: string;
  info: string;
  children: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      <FieldInfo label={children} text={info} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  info,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  info: string;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className="space-y-2">
      <FieldLabel htmlFor={id} info={info}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
