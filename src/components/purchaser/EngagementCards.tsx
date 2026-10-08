import { useEffect, useState } from "react";

import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLeadsPage } from "@/lib/leads.functions";
import { getBookingsPage } from "@/lib/bookings.functions";

type LeadRow = Awaited<ReturnType<typeof getLeadsPage>>["leads"][number];
type BookingRow = Awaited<ReturnType<typeof getBookingsPage>>["rows"][number];

function formatDate(value: string | null): string {
  if (!value) return "Date pending";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date pending" : date.toLocaleString();
}

/**
 * My Appointments (plan §7.6): recent website leads via the existing
 * paginated query. Full list lives on /leads.
 */
export function AppointmentsCard({ websiteId }: { websiteId: string }) {
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeadsPage({ data: {} })
      .then((page) => {
        if (!cancelled) setLeads(page.leads.filter((lead) => lead.website_id === websiteId));
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load appointments");
      });
    return () => {
      cancelled = true;
    };
  }, [websiteId]);

  return (
    <Card id="appointments">
      <CardHeader>
        <CardTitle>My Appointments</CardTitle>
        <CardDescription>Website leads received for this site.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : leads === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No appointment requests yet. They appear here when customers contact you.
          </p>
        ) : (
          <ul className="divide-y">
            {leads.slice(0, 5).map((lead) => (
              <li key={lead.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>Website lead</span>
                <span className="text-muted-foreground">{formatDate(lead.submitted_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" className="mt-4" asChild>
          <Link to="/leads">View all</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * My Bookings (plan §7.6, Pro): compact Future/Past tabs reusing the
 * bookings query. Detail and cancellation live on the full /bookings page.
 */
export function BookingsCard({ websiteId, userId }: { websiteId: string; userId: string }) {
  const [view, setView] = useState<"future" | "past">("future");
  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    getBookingsPage({ data: { view } })
      .then((page) => {
        if (!cancelled) setRows(page.rows.filter((row) => row.website_id === websiteId));
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load bookings");
      });
    return () => {
      cancelled = true;
    };
  }, [view, websiteId]);

  return (
    <Card id="bookings">
      <CardHeader>
        <CardTitle>My Bookings</CardTitle>
        <CardDescription>Customer appointments on this business.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2" role="tablist" aria-label="Booking views">
          {(["future", "past"] as const).map((tab) => (
            <Button
              key={tab}
              type="button"
              size="sm"
              role="tab"
              aria-selected={view === tab}
              variant={view === tab ? "default" : "outline"}
              onClick={() => setView(tab)}
            >
              {tab === "future" ? "Future" : "Past"}
            </Button>
          ))}
        </div>
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : rows === null ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No {view} bookings.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {rows.slice(0, 5).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  {formatDate(row.start_at)}{" "}
                  <span className="text-muted-foreground">· {row.appointment_state}</span>
                </span>
                <span className="text-muted-foreground">{row.payment_state}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to="/bookings" search={{ view }}>
              View all
            </Link>
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/user/$userId" params={{ userId }} search={{ websiteId }} hash="step-3">
              Availability Settings
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
