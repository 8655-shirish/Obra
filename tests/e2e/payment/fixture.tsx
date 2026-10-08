import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AvailabilityEditor } from "@/components/booking/AvailabilityEditor";
import { LiveBookingDialog } from "@/components/booking/LiveBookingDialog";
import { StepFourCard } from "@/components/purchaser/SetupStepCards";
import { PurchaserOverview } from "@/components/purchaser/PurchaserOverview";
import { PainterElevenTemplatePage } from "@/components/templates/PainterElevenTemplatePage";
import { PlumberTemplatePage } from "@/components/templates/PlumberTemplatePage";
import { Button } from "@/components/ui/button";
import type { TemplateMoldContent } from "@/lib/template-content/overlay";
import { Route as bookingConfirmationRouteImport } from "@/routes/booking.confirmation";
import { Route as publicSiteRouteImport } from "@/routes/lp/$websiteId";
import { availabilityFixture } from "./mocks/booking-setup.functions";
import { stripeConnectFixture, type StripeConnectProps } from "./mocks/stripe-connect.functions";
import { liveBookingFixture } from "./mocks/booking-live.functions";
import { publicSiteFixture } from "./mocks/public-site.functions";
import {
  googleOverviewFixture,
  GOOGLE_PROFILE_ID,
  GOOGLE_WEBSITE_ID,
  type GoogleOverviewProps,
} from "./mocks/google-overview.functions";
import "../../../src/styles.css";

const WEBSITE_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_CONTENT: TemplateMoldContent = {
  text: {
    heroTitle: "Fixture service visits",
    heroSub: "Schedule a visit with our local team.",
  },
  businessName: "Fixture Service Business",
  phone: "+1 202 555 0100",
  email: "business@example.test",
  media: {},
};
window.__availabilityFixture = availabilityFixture;
window.__stripeConnectFixture = stripeConnectFixture;
window.__googleOverviewFixture = googleOverviewFixture;
window.__liveBookingFixture = liveBookingFixture;
window.__publicSiteFixture = publicSiteFixture;

export function DisabledBookingScenario() {
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="mb-5 text-3xl font-semibold">Repair Service</h1>
      <Button disabled aria-describedby="booking-off">
        Book & pay
      </Button>
      <p id="booking-off" role="status" className="mt-3 text-sm text-muted-foreground">
        Online booking is temporarily unavailable.
      </p>
    </main>
  );
}

export function LiveBookingScenario() {
  const [open, setOpen] = useState(false);

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="mb-5 text-3xl font-semibold">Repair Service</h1>
      <Button onClick={() => setOpen(true)}>Book an appointment</Button>
      <LiveBookingDialog websiteId={WEBSITE_ID} open={open} onOpenChange={setOpen} />
    </main>
  );
}

export function AvailabilityScenario() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <AvailabilityEditor
        websiteId={WEBSITE_ID}
        initial={availabilityFixture.initial}
        onSaved={async () => {
          availabilityFixture.onSavedCalls += 1;
          if (availabilityFixture.onSavedError) throw new Error(availabilityFixture.onSavedError);
        }}
      />
    </main>
  );
}

export function StripeConnectScenario() {
  const [props, setProps] = useState<StripeConnectProps>(() => {
    const connect = new URLSearchParams(window.location.search).get("connect");
    return {
      websiteId: WEBSITE_ID,
      userId: "22222222-2222-4222-8222-222222222222",
      locked: window.__stripeConnectOptions?.locked ?? false,
      connect: connect === "return" || connect === "refresh" ? connect : undefined,
    };
  });

  useEffect(() => {
    stripeConnectFixture.updateProps = (next) => setProps((current) => ({ ...current, ...next }));
    return () => {
      stripeConnectFixture.updateProps = null;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <StepFourCard
        {...props}
        onboardingReady
        onChanged={async () => {
          stripeConnectFixture.onChangedCalls += 1;
          setProps((current) => ({ ...current }));
        }}
        onConnectConsumed={() => {
          stripeConnectFixture.onConnectConsumedCalls += 1;
          setProps((current) => ({ ...current, connect: undefined }));
          const url = new URL(window.location.href);
          url.searchParams.delete("connect");
          window.history.replaceState(window.history.state, "", url);
        }}
      />
    </main>
  );
}

export function FixtureScenario() {
  const search = new URLSearchParams(window.location.search);
  const scenario = search.get("scenario") ?? "disabled";
  if (scenario === "availability") return <AvailabilityScenario />;
  if (scenario === "stripe-connect") return <StripeConnectScenario />;
  if (scenario === "template") {
    const props = {
      content: search.has("content") ? TEMPLATE_CONTENT : undefined,
      ...(search.get("bookingMode") === "live" ? { bookingMode: "live" as const } : {}),
    };
    return search.get("template") === "plumber" ? (
      <PlumberTemplatePage {...props} />
    ) : (
      <PainterElevenTemplatePage {...props} />
    );
  }
  return scenario === "booking" ? <LiveBookingScenario /> : <DisabledBookingScenario />;
}

function GoogleOverviewScenario() {
  const search = useSearch({ strict: false }) as Partial<GoogleOverviewProps>;
  const params = useParams({ strict: false }) as { userId?: string };
  const [overrides, setOverrides] = useState<Partial<GoogleOverviewProps>>({});
  const [mounted, setMounted] = useState(true);
  // Installed before child effects invoke the mock server-function boundaries.
  googleOverviewFixture.updateProps = (next) =>
    setOverrides((current) => ({ ...current, ...next }));
  googleOverviewFixture.unmount = () => setMounted(false);
  return mounted ? (
    <PurchaserOverview
      userId={params.userId ?? GOOGLE_PROFILE_ID}
      websiteId={search.websiteId ?? GOOGLE_WEBSITE_ID}
      connect={search.connect}
      {...overrides}
    />
  ) : (
    <p>Overview unmounted</p>
  );
}

const rootRoute = createRootRoute({
  component: Outlet,
  loader: () => ({ checkoutEnabled: false }),
});
const fixtureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FixtureScenario,
});
const bookingConfirmationRoute = bookingConfirmationRouteImport.update({
  id: "/booking/confirmation",
  path: "/booking/confirmation",
  getParentRoute: () => rootRoute,
} as Parameters<typeof bookingConfirmationRouteImport.update>[0]);
const publicSiteRoute = publicSiteRouteImport.update({
  id: "/lp/$websiteId",
  path: "/lp/$websiteId",
  getParentRoute: () => rootRoute,
} as Parameters<typeof publicSiteRouteImport.update>[0]);
const googleOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/user/$userId",
  validateSearch: (search: Record<string, unknown>) => ({
    websiteId: typeof search.websiteId === "string" ? search.websiteId : GOOGLE_WEBSITE_ID,
    connect: ["success", "error", "return", "refresh"].includes(String(search.connect))
      ? (search.connect as GoogleOverviewProps["connect"])
      : undefined,
  }),
  component: GoogleOverviewScenario,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([
    fixtureRoute,
    bookingConfirmationRoute,
    googleOverviewRoute,
    publicSiteRoute,
  ]),
});

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
