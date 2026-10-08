import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  findProfileByAuthUserId,
  findProfileByEmail,
  findProfileByLicense,
  isEmailIdentifier,
} from "@/lib/auth/profile.server";

const identifierSchema = z.object({
  identifier: z.string().trim().min(1).max(200),
});

const verifyLoginOtpSchema = z.object({
  email: z.string().trim().email(),
  token: z.string().trim().min(6).max(8),
});

async function resolveLoginEmail(identifier: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (isEmailIdentifier(identifier)) {
    const profile = await findProfileByEmail(supabaseAdmin, identifier);
    if (!profile) {
      throw new Error("Subscribe to get started.");
    }
    if (!profile.email) {
      throw new Error("Complete subscription to activate account.");
    }
    return profile.email;
  }

  const profile = await findProfileByLicense(supabaseAdmin, identifier);
  if (!profile) {
    throw new Error("Subscribe to get started.");
  }
  if (!profile.auth_user_id) {
    throw new Error("Complete subscription to activate account.");
  }
  if (!profile.email) {
    throw new Error("Complete subscription to activate account.");
  }
  return profile.email;
}

export const sendOtp = createServerFn({ method: "POST" })
  .validator((data: unknown) => identifierSchema.parse(data))
  .handler(async ({ data }) => {
    const email = await resolveLoginEmail(data.identifier);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { assertOtpRateLimit } = await import("@/lib/auth/contractor-session.server");
    await assertOtpRateLimit(supabaseAdmin, email, "login");

    const { createSupabaseAuthClient } = await import("@/integrations/supabase/auth-server.server");
    const authClient = createSupabaseAuthClient();

    const { error } = await authClient.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (error) {
      console.error("[sendOtp]", error);
      throw new Error("Unable to send verification code. Please try again.");
    }

    return {
      success: true as const,
      email,
      maskedEmail: maskEmail(email),
    };
  });

export const verifyOtp = createServerFn({ method: "POST" })
  .validator((data: unknown) => verifyLoginOtpSchema.parse(data))
  .handler(async ({ data }) => {
    const { createSupabaseAuthClient } = await import("@/integrations/supabase/auth-server.server");
    const authClient = createSupabaseAuthClient();

    const { data: authData, error } = await authClient.auth.verifyOtp({
      email: data.email,
      token: data.token,
      type: "email",
    });

    if (error || !authData.user) {
      console.error("[verifyOtp]", error);
      throw new Error("Invalid or expired code. Please try again.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const profile =
      (await findProfileByAuthUserId(supabaseAdmin, authData.user.id)) ??
      (await findProfileByEmail(supabaseAdmin, data.email));

    if (!profile) {
      throw new Error("No contractor profile found for this account.");
    }

    return {
      success: true as const,
      profileId: profile.id,
      session: authData.session,
    };
  });

/** Current contractor profile for a browser session already in storage. */
export const getContractorSessionProfile = createServerFn({ method: "GET" }).handler(async () => {
  const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
  const authUserId = await getContractorAuthUserId();
  if (!authUserId) throw new Error("Unauthorized");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const profile = await findProfileByAuthUserId(supabaseAdmin, authUserId);
  if (!profile?.auth_user_id) throw new Error("Unauthorized");
  return { profileId: profile.id };
});

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}
