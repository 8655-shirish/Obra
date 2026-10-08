import { createFileRoute } from "@tanstack/react-router";

import { exchangeBookingReturn } from "@/lib/booking-confirmation.functions";

const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export const Route = createFileRoute("/booking/return")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const result = await exchangeBookingReturn(request);
          return new Response(null, {
            status: 303,
            headers: { ...privateHeaders, Location: result.location, "Set-Cookie": result.cookie },
          });
        } catch {
          return new Response(
            "We could not confirm this booking yet. Return to Stripe or refresh this page shortly.",
            {
              status: 400,
              headers: { ...privateHeaders, "Content-Type": "text/plain; charset=utf-8" },
            },
          );
        }
      },
    },
  },
});
