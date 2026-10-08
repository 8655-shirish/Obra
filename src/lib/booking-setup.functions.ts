/* eslint-disable @typescript-eslint/no-explicit-any -- temporary compatibility while the coordinated generated Supabase types land */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const websiteSchema = z.object({ websiteId: z.string().uuid() });
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const intervalSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    localStart: z.string().regex(timePattern),
    localEnd: z.string().regex(timePattern),
    sortOrder: z.number().int().min(0).max(20),
  })
  .refine((value) => value.localStart < value.localEnd, {
    message: "End time must be after start time",
  });
const overrideSchema = z
  .object({
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(["unavailable", "custom_hours"]),
    reason: z.string().trim().max(240).optional(),
    intervals: z
      .array(
        z
          .object({
            localStart: z.string().regex(timePattern),
            localEnd: z.string().regex(timePattern),
            sortOrder: z.number().int().min(0).max(20),
          })
          .refine((v) => v.localStart < v.localEnd),
      )
      .max(12),
  })
  .superRefine((v, ctx) => {
    if (v.type === "unavailable" && v.intervals.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unavailable dates cannot have intervals",
      });
    if (v.type === "custom_hours" && !v.intervals.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Custom hours require intervals" });
  });
const configSchema = z
  .object({
    websiteId: z.string().uuid(),
    serviceRevision: z.number().int().positive().nullable(),
    scheduleRevision: z.number().int().positive().nullable(),
    service: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000),
      durationMinutes: z.number().int().min(5).max(1439),
      slotIntervalMinutes: z.number().int().min(5).max(1440),
      bufferBeforeMinutes: z.number().int().min(0).max(1440),
      bufferAfterMinutes: z.number().int().min(0).max(1440),
      minimumNoticeMinutes: z.number().int().min(0).max(525600),
      bookingHorizonDays: z.number().int().min(1).max(730),
      locationType: z.enum(["customer_address", "business_address", "remote", "other"]),
      locationInstructions: z.string().trim().max(1000),
      amountMinor: z.number().int().positive().safe(),
    }),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Enter a valid IANA time zone"),
    intervals: z.array(intervalSchema).min(1).max(50),
    overrides: z.array(overrideSchema).max(120).default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    const overrideDates = new Set<string>();
    value.overrides.forEach((override, index) => {
      if (overrideDates.has(override.localDate))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Only one override is allowed per date",
          path: ["overrides", index, "localDate"],
        });
      overrideDates.add(override.localDate);
    });
    for (const interval of value.intervals) {
      const key = interval.weekday + ":" + interval.sortOrder;
      if (seen.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Interval order must be unique per day",
          path: ["intervals"],
        });
      seen.add(key);
    }
  });

function normalizeTime(value: string) {
  return value.slice(0, 5);
}

async function loadSetup(websiteId: string) {
  const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
  const access = await assertWebsiteWorkspaceAccess(websiteId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  const { data: website, error: websiteError } = await db
    .from("websites")
    .select("id, user_id, environment, status")
    .eq("id", websiteId)
    .single();
  if (websiteError || !website || website.user_id !== access.profileId)
    throw new Error("Website not found");
  await (await import("@/lib/jobs/access.server")).assertProfileWorkspaceAccess(access.profileId);
  const [profileResult, entitlementResult, serviceResult] = await Promise.all([
    db.from("profiles").select("id, business_name, full_name").eq("id", access.profileId).single(),
    db
      .from("website_entitlements")
      .select("plan, state, booking_admission, order_confirmed_at, effective_at, ends_at")
      .eq("website_id", websiteId)
      .eq("profile_id", access.profileId)
      .eq("environment", website.environment)
      .maybeSingle(),
    db
      .from("booking_services")
      .select("*")
      .eq("profile_id", access.profileId)
      .eq("environment", website.environment)
      .maybeSingle(),
  ]);
  if (profileResult.error || !profileResult.data) throw new Error("Profile not found");
  if (entitlementResult.error) throw new Error("Unable to load Pro entitlement");
  if (serviceResult.error) throw new Error("Unable to load booking service");
  const { loadBookingReadinessFacts } = await import("@/lib/booking-readiness.server");
  const readiness = await loadBookingReadinessFacts({
    websiteId,
    profileId: access.profileId,
    environment: website.environment as "test" | "live",
    isPublished: website.status === "live",
    isActiveVersion: true,
  });
  const profile = profileResult.data;
  const entitlement = entitlementResult.data;
  const service = serviceResult.data;
  let schedule = null;
  let intervals: Array<{
    weekday: number;
    local_start: string;
    local_end: string;
    sort_order: number;
  }> = [];
  let overrides: Array<{
    localDate: string;
    type: "unavailable" | "custom_hours";
    reason?: string;
    intervals: Array<{ localStart: string; localEnd: string; sortOrder: number }>;
  }> = [];
  if (service) {
    const result = await db
      .from("availability_schedules")
      .select("*")
      .eq("profile_id", access.profileId)
      .eq("environment", website.environment)
      .eq("service_id", service.id!)
      .maybeSingle();
    if (result.error) throw new Error("Unable to load availability schedule");
    schedule = result.data;
    if (schedule) {
      const result = await db
        .from("availability_intervals")
        .select("weekday, local_start, local_end, sort_order")
        .eq("schedule_id", schedule.id!)
        .order("weekday")
        .order("sort_order");
      if (result.error) throw new Error("Unable to load availability");
      intervals = (result.data ?? []) as Array<{
        weekday: number;
        local_start: string;
        local_end: string;
        sort_order: number;
      }>;
      const overrideResult = await db
        .from("availability_overrides")
        .select(
          "id,local_date,override_type,reason,availability_override_intervals(local_start,local_end,sort_order)",
        )
        .eq("schedule_id", schedule.id!)
        .order("local_date");
      if (overrideResult.error) throw new Error("Unable to load availability overrides");
      overrides = (overrideResult.data ?? []).map((row: any) => ({
        localDate: row.local_date,
        type: row.override_type,
        reason: row.reason ?? undefined,
        intervals: (row.availability_override_intervals ?? []).map((child: any) => ({
          localStart: normalizeTime(child.local_start),
          localEnd: normalizeTime(child.local_end),
          sortOrder: child.sort_order,
        })),
      }));
    }
  }

  return {
    accessMode: access.mode,
    website: { id: website.id, status: website.status },
    profile: {
      id: profile.id,
      name: profile.business_name || profile.full_name || "Your business",
    },
    entitlement,
    readiness,
    configuration: {
      serviceRevision: service?.revision ?? null,
      scheduleRevision: schedule?.revision ?? null,
      service: {
        name: service?.name ?? "Appointment",
        description: service?.description ?? "",
        durationMinutes: service?.duration_minutes ?? 60,
        slotIntervalMinutes: service?.slot_interval_minutes ?? 30,
        bufferBeforeMinutes: service?.buffer_before_minutes ?? 0,
        bufferAfterMinutes: service?.buffer_after_minutes ?? 0,
        minimumNoticeMinutes: service?.minimum_notice_minutes ?? 1440,
        bookingHorizonDays: service?.booking_horizon_days ?? 60,
        locationType: (service?.location_type ?? "customer_address") as
          "customer_address" | "business_address" | "remote" | "other",
        locationInstructions: service?.location_instructions ?? "",
        amountMinor: service?.amount_minor ?? 0,
        currency: "USD" as const,
        paymentPolicy: "full_amount" as const,
      },
      timeZone: schedule?.time_zone ?? "America/Los_Angeles",
      intervals: intervals.map((row) => ({
        weekday: row.weekday,
        localStart: normalizeTime(row.local_start),
        localEnd: normalizeTime(row.local_end),
        sortOrder: row.sort_order,
      })),
      overrides,
    },
  };
}

export const getBookingSetup = createServerFn({ method: "GET" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(({ data }) => loadSetup(data.websiteId));

export const acknowledgeBookingOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => websiteSchema.parse(data))
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess } = await import("@/lib/jobs/access.server");
    const access = await assertWebsiteWorkspaceAccess(data.websiteId);
    if (access.mode !== "contractor")
      throw new Error("Order cannot be confirmed while impersonating");
    const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
    const authUserId = await getContractorAuthUserId();
    if (!authUserId) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: website, error: websiteError } = await supabaseAdmin
      .from("websites")
      .select("environment")
      .eq("id", data.websiteId)
      .eq("user_id", access.profileId)
      .single();
    if (websiteError) throw new Error("Unable to load website");
    if (!website) throw new Error("Website not found");
    const { error } = await supabaseAdmin.rpc("acknowledge_booking_order", {
      p_website_id: data.websiteId,
      p_profile_id: access.profileId,
      p_environment: website.environment,
      p_auth_user_id: authUserId,
    });
    if (error) throw new Error("Unable to confirm order");
    return loadSetup(data.websiteId);
  });

export const saveBookingAvailability = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const result = configSchema.safeParse(data);
    if (!result.success)
      throw new Error(
        "INVALID_AVAILABILITY: Check appointment details, price, time zone, and hours.",
      );
    return result.data;
  })
  .handler(async ({ data }) => {
    const { assertWebsiteWorkspaceAccess, assertProfileWorkspaceAccess } =
      await import("@/lib/jobs/access.server");
    const access = await assertWebsiteWorkspaceAccess(data.websiteId);
    if (access.mode !== "contractor")
      throw new Error("Availability cannot be changed while impersonating");
    await assertProfileWorkspaceAccess(access.profileId);
    const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
    const authUserId = await getContractorAuthUserId();
    if (!authUserId) throw new Error("Unauthorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: website, error: websiteError } = await (supabaseAdmin as any)
      .from("websites")
      .select("environment")
      .eq("id", data.websiteId)
      .single();
    if (websiteError) throw new Error("Unable to load website");
    if (!website) throw new Error("Website not found");
    const { data: entitlement, error: entitlementError } = await (supabaseAdmin as any)
      .from("website_entitlements")
      .select("id")
      .eq("website_id", data.websiteId)
      .eq("profile_id", access.profileId)
      .eq("environment", website.environment)
      .eq("plan", "pro")
      .in("state", ["active", "grace"])
      .not("order_confirmed_at", "is", null)
      .not("effective_at", "is", null)
      .lte("effective_at", new Date().toISOString())
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .maybeSingle();
    if (entitlementError) throw new Error("Unable to load Pro entitlement");
    if (!entitlement) throw new Error("An active Pro entitlement is required for booking setup");
    const db = supabaseAdmin as any;
    const { error } = await db.rpc("save_shared_booking_availability", {
      p_website_id: data.websiteId,
      p_profile_id: access.profileId,
      p_environment: website.environment,
      p_auth_user_id: authUserId,
      p_service_revision: data.serviceRevision,
      p_schedule_revision: data.scheduleRevision,
      p_service: {
        ...data.service,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      },
      p_schedule: { timeZone: data.timeZone },
      p_intervals: data.intervals,
      p_overrides: data.overrides,
    });
    if (error) {
      // Log classification only: provider messages/details may contain customer data.
      const code =
        typeof error.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code)
          ? error.code
          : "unknown";
      console.error("[saveBookingAvailability]", {
        operation: "save_shared_booking_availability",
        code,
      });
      if (String(error.message).toLowerCase().includes("revision conflict"))
        throw new Error("REVISION_CONFLICT");
      if (code === "23P01")
        throw new Error(
          "INVALID_AVAILABILITY: Availability windows overlap. Adjust your hours or date overrides.",
        );
      if (error.message === "invalid time zone")
        throw new Error("INVALID_AVAILABILITY: Enter a valid IANA time zone.");
      if (["22023", "22007", "22008", "22P02", "22003", "23514"].includes(code))
        throw new Error(
          "INVALID_AVAILABILITY: Check appointment details, price, time zone, and hours.",
        );
      throw new Error(
        "Unable to save availability. Please try again. If this continues, contact support.",
      );
    }
    try {
      return await loadSetup(data.websiteId);
    } catch {
      console.error("[saveBookingAvailability]", { operation: "reload_setup_after_save" });
      throw new Error("AVAILABILITY_SAVED_RELOAD_REQUIRED");
    }
  });
