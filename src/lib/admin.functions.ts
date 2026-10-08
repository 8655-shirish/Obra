import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  beginAdminLogin,
  clearAdminSessionCookies,
  globalAdminSignOut,
  isAdminSessionValid,
  setImpersonationCookie,
} from "@/lib/auth/admin-session.server";
import { requireAdminMiddleware } from "@/lib/auth/admin-middleware.server";
import { publicLpUrl } from "@/lib/lp-url";
import { hasCheckoutConfirmed } from "@/lib/onboarding-state";

const adminLoginSchema = z.object({
  username: z.string().trim().email(),
  password: z.string().min(1),
});

const impersonateSchema = z.object({
  profileId: z.string().uuid(),
});

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { authenticated: await isAdminSessionValid() };
});

export const adminLogin = createServerFn({ method: "POST" })
  .validator((data: unknown) => adminLoginSchema.parse(data))
  .handler(async ({ data }) => beginAdminLogin(data.username, data.password));

export const adminLogoutEverywhere = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    await globalAdminSignOut();
    return { success: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  await clearAdminSessionCookies();
  return { success: true as const };
});

export const adminImpersonateUser = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => impersonateSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", data.profileId)
      .maybeSingle();

    if (error || !profile) {
      throw new Error("Profile not found");
    }

    await setImpersonationCookie(data.profileId);
    return { success: true as const, profileId: data.profileId };
  });

const pageSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => pageSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      data: rows,
      error,
      count,
    } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, license_number, email, full_name, trade, city, auth_user_id, created_at, subscriptions(status, plan)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw new Error("Unable to load users");
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const listAdminWebsites = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => pageSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const baseUrl = process.env.PUBLIC_APP_URL ?? "https://obra-tech.lovable.app";

    const {
      data: rows,
      error,
      count,
    } = await supabaseAdmin
      .from("websites")
      .select(
        "id, user_id, status, research_status, active_version_id, created_at, onboarding_state, profiles!websites_user_id_fkey(license_number)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw new Error("Unable to load websites");

    const enriched = (rows ?? []).map((row) => {
      const profile = row.profiles as { license_number?: string } | null;
      const license = profile?.license_number ?? null;
      const purchased = hasCheckoutConfirmed(
        (row as { onboarding_state?: unknown }).onboarding_state,
      );
      const publicUrl =
        row.status === "live"
          ? publicLpUrl(baseUrl, {
              purchased,
              licenseNumber: license,
              websiteId: row.id,
            })
          : null;
      return { ...row, license_number: license, public_url: publicUrl };
    });

    return { rows: enriched, total: count ?? 0 };
  });

export const listAdminConversations = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => pageSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      data: rows,
      error,
      count,
    } = await supabaseAdmin
      .from("conversations")
      .select("id, user_id, website_id, phase, summary, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw new Error("Unable to load conversations");
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const listAdminEditEvents = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => pageSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      data: rows,
      error,
      count,
    } = await supabaseAdmin
      .from("website_edit_events")
      .select("id, website_id, version_id, category, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw new Error("Unable to load edit events");
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const listAdminLeads = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => pageSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      data: rows,
      error,
      count,
    } = await supabaseAdmin
      .from("leads")
      .select("id, website_id, license_number, user_id, form_data, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw new Error("Unable to load leads");
    return { rows: rows ?? [], total: count ?? 0 };
  });

const conversationIdSchema = z.object({
  conversationId: z.string().uuid(),
});

export const getAdminConversationMessages = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => conversationIdSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("messages")
      .select("id, role, content, created_at, sequence_id")
      .eq("conversation_id", data.conversationId)
      .order("sequence_id", { ascending: true })
      .limit(500);

    if (error) throw new Error("Unable to load messages");
    return { messages: rows ?? [] };
  });

export const listAdminJobChains = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .validator((data: unknown) => pageSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      data: rows,
      error,
      count,
    } = await supabaseAdmin
      .from("background_jobs")
      .select(
        "id, chain_id, website_id, job_type, status, sequence_index, created_at, completed_at, error_message",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (error) throw new Error("Unable to load job chains");
    return { rows: rows ?? [], total: count ?? 0 };
  });
