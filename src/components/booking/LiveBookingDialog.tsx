import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLiveBookingCheckout, getLiveBookingSlots } from "@/lib/booking-live.functions";
import { bookingConsentDocument } from "@/lib/booking-consent";
import {
  checkoutSchema,
  checkoutResultSchema,
  type BookingCheckoutRequest,
} from "@/lib/booking-checkout";

const BOOKING_CONSENT = bookingConsentDocument();

type Slot = { startAt: string; endAt: string; localDate: string; localStart: string };
export function LiveBookingDialog({
  websiteId,
  open,
  onOpenChange,
}: {
  websiteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [slots, setSlots] = useState<Slot[]>([]),
    [observedAt, setObservedAt] = useState(""),
    [availabilityGeneration, setAvailabilityGeneration] = useState(0),
    [calendarSetHash, setCalendarSetHash] = useState(""),
    [timeZone, setTimeZone] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [service, setService] = useState<{
      name: string;
      amountMinor: number;
      currency: string;
    } | null>(null),
    [selected, setSelected] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false),
    [message, setMessage] = useState(""),
    [attachmentsEnabled, setAttachmentsEnabled] = useState(false);
  const [slotsStatus, setSlotsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [slotsRequest, setSlotsRequest] = useState(0);
  const [submittedRequest, setSubmittedRequest] = useState<BookingCheckoutRequest | null>(null);
  const requestScope = useRef<{
    websiteId: string;
    submitting: boolean;
    loadingSlots: boolean;
    submittedRequest: BookingCheckoutRequest | null;
    outcomeUnknown: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const scope = {
      websiteId,
      submitting: false,
      loadingSlots: false,
      submittedRequest: null as BookingCheckoutRequest | null,
      outcomeUnknown: false,
    };
    requestScope.current = scope;
    setSlots([]);
    setSelected(null);
    setSlotsStatus("idle");
    setSubmitting(false);
    setSubmittedRequest(null);
    setMessage("");
    setTimeZone("");
    setService(null);
    setRequestId(crypto.randomUUID());
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, [websiteId]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void import("@/lib/booking-attachments.functions")
      .then(({ getBookingAttachmentCapability }) => getBookingAttachmentCapability())
      .then((capability) => current && setAttachmentsEnabled(capability.enabled))
      .catch(() => current && setAttachmentsEnabled(false));
    return () => {
      current = false;
    };
  }, [open]);
  useEffect(() => {
    const scope = requestScope.current;
    if (scope?.websiteId !== websiteId) return;
    // Closing/reopening the dialog cannot abandon a possibly accepted reservation.
    if (scope.submitting || scope.submittedRequest) return;
    if (!open) {
      scope.loadingSlots = false;
      setSlots([]);
      setSelected(null);
      setMessage("");
      setSlotsStatus("idle");
      setRequestId(crypto.randomUUID());
      return;
    }
    let current = true;
    scope.loadingSlots = true;
    setSlotsStatus("loading");
    setMessage("");
    const fromDate = new Date().toISOString().slice(0, 10);
    void getLiveBookingSlots({ data: { websiteId, fromDate, dayCount: 14 } })
      .then((value) => {
        if (!current || requestScope.current !== scope) return;
        setSlots(value.slots);
        setObservedAt(value.observedAt);
        setAvailabilityGeneration(value.availabilityGeneration);
        setCalendarSetHash(value.calendarSetHash);
        setTimeZone(value.timeZone);
        setService(value.service);
        setSlotsStatus("ready");
      })
      .catch(() => current && requestScope.current === scope && setSlotsStatus("error"))
      .finally(() => {
        if (current && requestScope.current === scope) scope.loadingSlots = false;
      });
    return () => {
      current = false;
    };
  }, [open, websiteId, slotsRequest]);
  async function prepareRequest(values: FormData, slot: Slot) {
    const data = checkoutSchema.parse({
      websiteId,
      startAt: slot.startAt,
      localDate: slot.localDate,
      localStart: slot.localStart,
      timeZone,
      observedAt,
      availabilityGeneration,
      calendarSetHash,
      requestId,
      consent: {
        accepted: values.get("bookingConsent") === "accepted",
        documentId: BOOKING_CONSENT.documentId,
        version: BOOKING_CONSENT.version,
        digest: BOOKING_CONSENT.digest,
      },
      customer: {
        fullName: String(values.get("name") ?? ""),
        email: String(values.get("email") ?? ""),
        phone: String(values.get("phone") ?? ""),
        address: {
          line1: String(values.get("line1") ?? ""),
          city: String(values.get("city") ?? ""),
          region: String(values.get("region") ?? ""),
          postalCode: String(values.get("postalCode") ?? ""),
        },
        notes: String(values.get("notes") ?? ""),
      },
    });
    const files = values
      .getAll("attachments")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const attachmentResults = await Promise.allSettled(
      files.slice(0, 5).map(async (file) => {
        if (
          file.size > 10_485_760 ||
          !["image/jpeg", "image/png", "image/webp"].includes(file.type)
        )
          throw new Error("Unsupported optional image");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 32_768)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
        return {
          filename: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
          byteSize: file.size,
          base64: btoa(binary),
        };
      }),
    );
    const attachments = attachmentResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    return { ...data, attachments };
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = requestScope.current;
    if (!open || !selected || scope?.websiteId !== websiteId || scope.submitting) return;
    scope.submitting = true;
    setSubmitting(true);
    setMessage("");
    try {
      if (!scope.submittedRequest) {
        const values = new FormData(event.currentTarget);
        const data = await prepareRequest(values, selected);
        if (requestScope.current !== scope) return;
        // A lost response does not prove that reservation or Checkout failed.
        scope.submittedRequest = data;
        setSubmittedRequest(scope.submittedRequest);
      }
      const result = checkoutResultSchema.parse(
        await createLiveBookingCheckout({ data: scope.submittedRequest }),
      );
      if (requestScope.current !== scope) return;
      if (result.status === "not_attempted") {
        if (scope.outcomeUnknown) {
          setMessage(
            "The latest attempt did not reserve a time, but an earlier request may still be processing. Retry this same booking request or contact the business before changing it.",
          );
        } else {
          scope.submittedRequest = null;
          setSubmittedRequest(null);
          setMessage(
            result.code === "slot_unavailable"
              ? "That time is no longer available. No reservation was made. Go back and refresh available times to choose another."
              : "Booking could not be started. No reservation was made. You can try again or go back and refresh available times.",
          );
        }
        scope.submitting = false;
        setSubmitting(false);
        return;
      }
      window.location.assign(result.checkoutUrl);
    } catch {
      if (requestScope.current === scope) {
        if (scope.submittedRequest) scope.outcomeUnknown = true;
        setMessage(
          scope.submittedRequest
            ? "Payment could not be opened. Your booking request may already have been received. Retry this same booking request with the submitted details. To change or cancel it, contact the business first."
            : "Your booking request was not sent. Check your name, email, phone, address, notes and booking consent, then try again.",
        );
        scope.submitting = false;
        setSubmitting(false);
      }
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        const scope = requestScope.current;
        if (scope?.websiteId === websiteId && !scope.submitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Book an appointment</DialogTitle>
          <DialogDescription>
            Select a live available time, add your details, then pay securely on Stripe.
          </DialogDescription>
        </DialogHeader>
        {message ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            {message}
          </p>
        ) : null}
        {!selected ? (
          <div>
            <p className="mb-3 text-sm font-medium">
              Available times {timeZone ? "(" + timeZone + ")" : ""}
            </p>
            {slotsStatus === "idle" || slotsStatus === "loading" ? (
              <p role="status">Checking Google Calendar…</p>
            ) : slotsStatus === "error" ? (
              <p role="alert">Available times could not be loaded. Please try again.</p>
            ) : slots.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {slots.map((slot) => (
                  <Button
                    key={slot.startAt}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const scope = requestScope.current;
                      if (
                        scope?.websiteId !== websiteId ||
                        scope.submitting ||
                        scope.submittedRequest
                      )
                        return;
                      setSelected(slot);
                      setRequestId(crypto.randomUUID());
                    }}
                  >
                    {new Date(slot.startAt).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone,
                    })}
                  </Button>
                ))}
              </div>
            ) : (
              <p>No appointments are available in the next two weeks.</p>
            )}
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              disabled={
                slotsStatus === "idle" ||
                slotsStatus === "loading" ||
                submitting ||
                submittedRequest !== null
              }
              onClick={() => {
                const scope = requestScope.current;
                if (
                  !open ||
                  scope?.websiteId !== websiteId ||
                  scope.submitting ||
                  scope.submittedRequest ||
                  scope.loadingSlots
                )
                  return;
                scope.loadingSlots = true;
                setSlotsRequest((value) => value + 1);
              }}
            >
              {slotsStatus === "error" ? "Retry available times" : "Refresh available times"}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={submitting || submittedRequest !== null} className="space-y-4">
              <div className="rounded-md bg-muted p-3 text-sm">
                <strong>
                  {new Date(selected.startAt).toLocaleString(undefined, {
                    dateStyle: "full",
                    timeStyle: "short",
                    timeZone,
                  })}
                </strong>
                {service ? (
                  <span>
                    {" "}
                    ·{" "}
                    {(service.amountMinor / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: service.currency,
                    })}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  name="name"
                  label="Full name"
                  autoComplete="name"
                  defaultValue={submittedRequest?.customer.fullName}
                />
                <Field
                  name="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  defaultValue={submittedRequest?.customer.email}
                />
                <Field
                  name="phone"
                  label="Phone"
                  autoComplete="tel"
                  defaultValue={submittedRequest?.customer.phone}
                />
                <Field
                  name="line1"
                  label="Service address"
                  autoComplete="street-address"
                  defaultValue={submittedRequest?.customer.address.line1}
                />
                <Field
                  name="city"
                  label="City"
                  autoComplete="address-level2"
                  defaultValue={submittedRequest?.customer.address.city}
                />
                <Field
                  name="region"
                  label="State"
                  autoComplete="address-level1"
                  defaultValue={submittedRequest?.customer.address.region}
                />
                <Field
                  name="postalCode"
                  label="ZIP code"
                  autoComplete="postal-code"
                  defaultValue={submittedRequest?.customer.address.postalCode}
                />
              </div>
              <div>
                <Label htmlFor="booking-notes">Notes (optional)</Label>
                <Input
                  id="booking-notes"
                  name="notes"
                  maxLength={2000}
                  defaultValue={submittedRequest?.customer.notes}
                />
              </div>
              {attachmentsEnabled ? (
                <div>
                  <Label htmlFor="booking-attachments">Images (optional, up to 5)</Label>
                  <Input
                    id="booking-attachments"
                    name="attachments"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Images stay private until malware scanning passes. Upload failure never cancels
                    booking.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Photos are temporarily unavailable; you can still book.
                </p>
              )}
              <div className="rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="booking-consent"
                    name="bookingConsent"
                    value="accepted"
                    defaultChecked={submittedRequest?.consent.accepted}
                    required
                    aria-required="true"
                    aria-describedby="booking-consent-document"
                  />
                  <Label htmlFor="booking-consent" className="text-sm font-normal leading-5">
                    I have read and explicitly agree to the booking data and payment consent below.
                  </Label>
                </div>
                <p id="booking-consent-document" className="mt-2 text-xs text-muted-foreground">
                  {BOOKING_CONSENT.text}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Document {BOOKING_CONSENT.documentId} · Version {BOOKING_CONSENT.version} ·
                  SHA-256 <code className="break-all">{BOOKING_CONSENT.digest}</code>
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                If the time is available, it is held for 15 minutes when reserved. Retrying does not
                restart the hold. Stripe securely collects the full configured amount; Obra adds no
                application fee.
              </p>
            </fieldset>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || submittedRequest !== null}
                onClick={() => {
                  const scope = requestScope.current;
                  if (
                    scope?.websiteId === websiteId &&
                    !scope.submitting &&
                    !scope.submittedRequest
                  )
                    setSelected(null);
                }}
              >
                Back
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting
                  ? "Opening payment..."
                  : submittedRequest
                    ? "Retry secure payment"
                    : "Continue to secure payment"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
function Field({
  name,
  label,
  type = "text",
  autoComplete,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  autoComplete: string;
  defaultValue?: string;
}) {
  const id = "booking-" + name;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        maxLength={254}
      />
    </div>
  );
}
