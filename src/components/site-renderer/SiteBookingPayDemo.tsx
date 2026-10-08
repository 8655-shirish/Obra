import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Step = "slot" | "pay" | "done";

/** Dummy deposit. Swap this constant when visitor pay is real. */
export const DUMMY_DEPOSIT_USD = 99;

const SLOT_OPTIONS = [
  { label: "9:00 AM", minutes: 9 * 60 },
  { label: "11:00 AM", minutes: 11 * 60 },
  { label: "2:00 PM", minutes: 14 * 60 },
  { label: "4:00 PM", minutes: 16 * 60 },
] as const;

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/** Dummy availability. Replace with a real calendar source later. */
export function dummySlotsFor(date: Date, now = new Date()): string[] {
  if (startOfDay(date) < startOfDay(now)) return [];
  if (!isWeekday(date)) return [];
  const today = isSameDay(date, now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return SLOT_OPTIONS.filter((slot) => !today || slot.minutes > currentMinutes).map(
    (slot) => slot.label,
  );
}

function timezoneLine(now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "long",
      hour: "numeric",
    }).formatToParts(now);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return name ? `${name} (${tz})` : tz;
  } catch {
    return "local time";
  }
}

function formatLongDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function SiteBookingPayDemo({
  open,
  onOpenChange,
  isDemoPitch,
  demoWording = "demo",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDemoPitch: boolean;
  demoWording?: "demo" | "walkthrough";
}) {
  const [step, setStep] = useState<Step>("slot");
  const [date, setDate] = useState<Date | undefined>();
  const [slot, setSlot] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const tz = useMemo(() => timezoneLine(), []);
  const slots = date ? dummySlotsFor(date) : [];

  function reset() {
    setStep("slot");
    setDate(undefined);
    setSlot("");
    setName("");
    setEmail("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) reset();
  }

  const deposit = `$${DUMMY_DEPOSIT_USD}`;
  const summary = date && slot ? `${formatLongDate(date)} at ${slot}` : null;
  const walkthrough = isDemoPitch && demoWording === "walkthrough";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 left-0 top-0 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[min(40rem,calc(100dvh-2rem))] sm:w-[min(56rem,calc(100vw-2rem))] sm:max-w-none sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:border",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <DialogTitle className="text-xl font-semibold tracking-tight sm:text-2xl">
            {step === "done"
              ? walkthrough
                ? "Visit plan ready"
                : isDemoPitch
                  ? "Demo complete"
                  : "You're booked"
              : step === "pay"
                ? walkthrough
                  ? "Review visit details"
                  : isDemoPitch
                    ? "Simulate payment"
                    : "Confirm and pay"
                : "Select a time"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {step === "done"
              ? walkthrough
                ? "Your preferred visit time is ready to review."
                : isDemoPitch
                  ? "Demo — no appointment or charge will be created."
                  : "A confirmation was sent to your email."
              : step === "pay"
                ? walkthrough
                  ? `Proposed visit: ${summary}.`
                  : `${deposit} deposit for ${summary}.`
                : "Pick a weekday, then a time that works."}
            {step !== "done" && walkthrough
              ? null
              : step !== "done" && isDemoPitch
                ? " Demo — no appointment or charge will be created."
                : null}
          </DialogDescription>
          <p className="pt-1 text-xs text-muted-foreground">{tz}</p>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === "slot" && (
            <div className="grid min-h-full lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)]">
              <div className="flex items-start justify-center border-b border-border p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(next) => {
                    setDate(next);
                    setSlot("");
                  }}
                  disabled={(day) => dummySlotsFor(day).length === 0}
                  className="w-full max-w-[22rem] [--cell-size:2.5rem] p-0"
                />
              </div>
              <div className="flex flex-col gap-4 p-4 sm:p-6">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {date ? formatLongDate(date) : "Choose a date"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {date
                      ? slots.length
                        ? "Available times"
                        : "No times left on this day"
                      : "Times appear after you pick a day"}
                  </p>
                </div>
                <div className="flex min-h-[12rem] flex-col gap-2">
                  {slots.map((time) => {
                    const selected = slot === time;
                    return (
                      <button
                        key={time}
                        type="button"
                        onClick={() => setSlot(time)}
                        className={cn(
                          "flex h-12 w-full items-center justify-center rounded-md border text-sm font-medium transition-colors",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-secondary",
                        )}
                      >
                        {time}
                      </button>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  className="mt-auto h-11 w-full"
                  disabled={!date || !slot}
                  onClick={() => setStep("pay")}
                >
                  Continue
                </Button>
              </div>
            </div>
          )}

          {step === "pay" && (
            <form
              className="mx-auto grid max-w-3xl gap-8 p-4 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
              onSubmit={(event) => {
                event.preventDefault();
                setStep("done");
              }}
            >
              <aside className="rounded-xl border border-border bg-secondary/40 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {walkthrough ? "Visit plan" : "Appointment"}
                </p>
                <p className="mt-3 text-base font-semibold">{summary}</p>
                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {walkthrough ? "Proposed deposit" : "Deposit"}
                    </dt>
                    <dd className="font-medium tabular-nums">{deposit}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-border pt-3">
                    <dt className="font-medium">{walkthrough ? "Collected here" : "Due now"}</dt>
                    <dd className="font-semibold tabular-nums">
                      {walkthrough ? "Nothing" : deposit}
                    </dd>
                  </div>
                </dl>
              </aside>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="booking-name">Name</Label>
                    <Input
                      id="booking-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="booking-email">Email</Label>
                    <Input
                      id="booking-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>
                {isDemoPitch ? (
                  <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-4">
                    <p className="text-sm font-medium">
                      {walkthrough ? "Visit payment step" : "Payment simulation"}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {walkthrough
                        ? "Review the proposed visit deposit and contact details before continuing."
                        : "No card fields are shown in this preview. Do not enter payment credentials; continuing only demonstrates the confirmation state."}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-xl border border-border bg-secondary/30 p-4 text-sm leading-6 text-muted-foreground">
                    Secure payment collection is unavailable in this preview.
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row-reverse">
                  <Button type="submit" className="h-11 sm:flex-1">
                    {walkthrough ? "Continue" : isDemoPitch ? "Simulate payment" : `Pay ${deposit}`}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 sm:flex-1"
                    onClick={() => setStep("slot")}
                  >
                    Back
                  </Button>
                </div>
              </div>
            </form>
          )}

          {step === "done" && (
            <div className="mx-auto flex max-w-md flex-col items-center px-6 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Check className="size-6" strokeWidth={2.5} />
              </span>
              <p className="mt-6 text-base text-foreground">
                {walkthrough
                  ? summary
                    ? `Preferred visit: ${summary}.`
                    : "Your preferred visit is ready."
                  : summary
                    ? `Demo complete for ${summary}.`
                    : "Demo complete."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {walkthrough
                  ? "Keep this summary handy when you contact the contractor."
                  : isDemoPitch
                    ? "No payment was collected."
                    : email
                      ? `We sent a confirmation to ${email}.`
                      : "A confirmation was sent to your email."}
              </p>
              <Button type="button" variant="outline" className="mt-8 h-11 w-full" onClick={reset}>
                Book another time
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
