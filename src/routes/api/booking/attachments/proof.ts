import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/booking/attachments/proof")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { proveBookingAttachmentScanner } =
            await import("@/lib/booking-attachments.functions");
          return Response.json(await proveBookingAttachmentScanner());
        } catch (error) {
          const unauthorized = error instanceof Error && error.message === "Unauthorized";
          return Response.json(
            { error: unauthorized ? "Unauthorized" : "Scanner proof failed" },
            { status: unauthorized ? 401 : 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
