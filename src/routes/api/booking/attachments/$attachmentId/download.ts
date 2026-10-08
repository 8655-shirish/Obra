import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const paramsSchema = z.object({ attachmentId: z.string().uuid() });

export const Route = createFileRoute("/api/booking/attachments/$attachmentId/download")({
  validateSearch: z.object({ token: z.string().max(4096).optional() }),
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const { attachmentId } = paramsSchema.parse(params);
          const token = new URL(request.url).searchParams.get("token") ?? "";
          const { resolveBookingAttachmentDownloadToken } =
            await import("@/lib/booking-attachments.functions");
          const download = await resolveBookingAttachmentDownloadToken({ attachmentId, token });
          return Response.redirect(download.url, 302);
        } catch (error) {
          const unauthorized = error instanceof Error && error.message === "Unauthorized";
          return Response.json(
            { error: unauthorized ? "Unauthorized" : "Attachment not found" },
            {
              status: unauthorized ? 401 : 404,
              headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
            },
          );
        }
      },
    },
  },
});
