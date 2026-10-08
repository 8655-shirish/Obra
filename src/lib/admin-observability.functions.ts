import { createServerFn } from "@tanstack/react-start";

import { requireAdminMiddleware } from "@/lib/auth/admin-middleware.server";

export const getGenerationObservability = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const [{ supabaseAdmin }, { collectGenerationObservability }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/generation-observability.server"),
    ]);
    return collectGenerationObservability(supabaseAdmin);
  });

export const getCalendarObservability = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    try {
      const [{ supabaseAdmin }, { collectCalendarObservability }] = await Promise.all([
        import("@/integrations/supabase/client.server"),
        import("@/lib/calendar-observability.server"),
      ]);
      return {
        outcome: "available" as const,
        report: await collectCalendarObservability(supabaseAdmin),
      };
    } catch {
      return {
        outcome: "unavailable" as const,
        error:
          "Calendar assessment unavailable. Check monitor environment, migration and database access; previous conditions are unknown." as string,
      };
    }
  });
