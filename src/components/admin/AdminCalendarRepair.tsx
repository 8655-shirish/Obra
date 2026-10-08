import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BookingCalendarRepairContext } from "@/lib/booking-calendar-repair.server";

export function AdminCalendarRepair() {
  const [appointmentId, setAppointmentId] = useState("");
  const [context, setContext] = useState<BookingCalendarRepairContext | null>(null);
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setBusy(true);
    setContext(null);
    setMessage("");
    try {
      const response = await fetch(
        "/api/admin/calendar-repair?appointmentId=" + encodeURIComponent(appointmentId),
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load repair");
      setContext(body);
      setRequestId(crypto.randomUUID());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load repair");
    } finally {
      setBusy(false);
    }
  }

  async function repair() {
    if (!context) return;
    setBusy(true);
    setMessage("");
    try {
      const supplied = context.linkId ? null : JSON.parse(evidence);
      const response = await fetch("/api/admin/calendar-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedGeneration: context.expectedGeneration,
          reason,
          ...(context.linkId
            ? { linkId: context.linkId }
            : {
                resolution: {
                  requestId,
                  appointmentId: context.appointmentId,
                  profileId: context.profileId,
                  environment: context.environment,
                  expectedVersion: context.expectedVersion,
                  destinationEpochId: supplied.destinationEpochId,
                  ...(supplied.destinationEpoch
                    ? { destinationEpoch: supplied.destinationEpoch }
                    : {}),
                  googleEventId: supplied.googleEventId,
                  source: supplied.source,
                },
              }),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to repair calendar");
      setMessage(
        "Repair queued for exact calendar readback. This does not confirm delivery or change payment.",
      );
      setContext(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to repair calendar");
    } finally {
      setBusy(false);
    }
  }

  const eligible =
    context?.cutoverEnabled &&
    (context.linkId
      ? context.reconcileStatus === "manual_repair"
      : (context.reviewState === "unresolved_destination" &&
          ["confirmed", "cancelled"].includes(context.appointmentState)) ||
        (context.appointmentState === "cancelled" &&
          ["cancel_pending", "cancel_failed"].includes(context.calendarState)));
  return (
    <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Booking calendar repair</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Inspect one booking and audit its original destination evidence. Never substitute today's
        selected calendar.
      </p>
      <fieldset disabled={busy} className="mt-4 space-y-3">
        <Label htmlFor="calendar-repair-appointment">Appointment ID</Label>
        <Input
          id="calendar-repair-appointment"
          value={appointmentId}
          onChange={(event) => {
            setAppointmentId(event.target.value);
            setContext(null);
          }}
        />
        <Button onClick={() => void load()}>Inspect booking</Button>
        {context && (
          <>
            <p className="break-words text-sm">
              {context.reference} ({context.environment}): {context.appointmentState},{" "}
              {context.calendarState}, {context.reviewState}. Version {context.expectedVersion};
              generation {context.expectedGeneration}.
            </p>
            <p className="break-all text-xs text-muted-foreground">
              Original event ID: {context.googleEventId}
            </p>
            {!context.linkId && (
              <>
                <details className="text-sm">
                  <summary>Retained destination identities (latest 50)</summary>
                  <p className="my-2 text-xs text-muted-foreground">
                    Match against original evidence. This history does not authorize a replacement
                    destination.
                  </p>
                  {(context.destinationEpochs ?? []).map((epoch) => (
                    <p key={epoch.id} className="mb-2 break-all font-mono text-xs">
                      {epoch.id}: {epoch.accountId} / {epoch.calendarId}. Revision {epoch.revision},
                      recorded {epoch.createdAt}, retired {epoch.retiredAt ?? "no"}.
                    </p>
                  ))}
                </details>
                <Label htmlFor="calendar-repair-evidence">
                  Original destination evidence (JSON)
                </Label>
                <Textarea
                  id="calendar-repair-evidence"
                  rows={8}
                  value={evidence}
                  onChange={(event) => {
                    setEvidence(event.target.value);
                    setRequestId(crypto.randomUUID());
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Required: destinationEpochId, googleEventId, source. Source is either
                  retained_outbox with its id, or original_reservation_record with reference,
                  sha256, recordedAt, appointmentId, accountId and calendarId. Original records must
                  predate payment and identify the retained epoch; current selections are not
                  evidence. If no epoch exists yet, provide destinationEpoch with the original
                  connectionId, selectionId, revision, accountId and calendarId from that same
                  record, and a new destinationEpochId.
                </p>
              </>
            )}
            <Label htmlFor="calendar-repair-reason">Audit reason</Label>
            <Textarea
              id="calendar-repair-reason"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setRequestId(crypto.randomUUID());
              }}
            />
            <Button disabled={!eligible || reason.trim().length < 3} onClick={() => void repair()}>
              Queue audited repair
            </Button>
          </>
        )}
      </fieldset>
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
