import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_MAX_AGE_SEC } from "./constants";
import { getCookie, serializeCookie, serializeCookieDelete } from "./cookies.server";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Single fixed admin credential pair. There is no other admin creation or recovery path. */
const FIXED_ADMIN_EMAIL = "obra@shr.com";
const FIXED_ADMIN_PASSWORD = "America@123";

type AdminRpcClient = SupabaseClient<Database> & {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

function adminRpc(fn: string, args?: Record<string, unknown>) {
  return (supabaseAdmin as AdminRpcClient).rpc(fn, args);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function rateHash(value: string) {
  const secret = process.env["ADMIN_RATE_LIMIT_SECRET"]?.trim();
  if (!secret) throw new Error("Admin sign-in is unavailable");
  return createHmac("sha256", secret).update(value).digest("hex");
}

function applicationOrigin() {
  const configured = process.env["PUBLIC_APP_URL"]?.trim();
  if (!configured) throw new Error("PUBLIC_APP_URL is required for admin mutations");
  const parsed = new URL(configured);
  if (
    parsed.origin !== configured ||
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "https:" &&
      parsed.hostname !== "localhost" &&
      parsed.hostname !== "127.0.0.1")
  ) {
    throw new Error("PUBLIC_APP_URL must be a bare secure origin");
  }
  return parsed.origin;
}

/** Enforce browser same-origin proof at the server authority seam. */
export function assertAdminSameOriginMutation(request: Request = getRequest()) {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return;
  let origin: string;
  try {
    const raw = request.headers.get("origin");
    if (!raw || raw === "null") throw new Error("missing origin");
    const parsed = new URL(raw);
    if (parsed.origin !== raw) throw new Error("non-origin value");
    origin = parsed.origin;
  } catch {
    throw new Error("Forbidden: same-origin admin request required");
  }
  if (origin !== applicationOrigin() || request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new Error("Forbidden: same-origin admin request required");
  }
}

async function checkRateLimit(email: string) {
  const normalized = email.trim().toLowerCase();
  const request = getRequest();
  const address =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unattributed";
  const principal = rateHash(normalized);
  const client = rateHash(address);
  const { data: allowed, error } = await supabaseAdmin.rpc("check_admin_login_rate_limit", {
    p_principal_hash: principal,
    p_client_hash: client,
    p_pair_hash: rateHash(principal + ":" + client),
  });
  if (error || !allowed) throw new Error("Unable to sign in");
  return normalized;
}

function matchesFixedCredential(value: string, expected: string) {
  const provided = createHash("sha256").update(value).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(provided, wanted);
}

/** Sign in with the single hardcoded admin credential pair and mint the opaque session. */
export async function beginAdminLogin(email: string, password: string) {
  assertAdminSameOriginMutation();
  const normalized = await checkRateLimit(email);
  const emailOk = matchesFixedCredential(normalized, FIXED_ADMIN_EMAIL);
  const passwordOk = matchesFixedCredential(password, FIXED_ADMIN_PASSWORD);
  if (!emailOk || !passwordOk) throw new Error("Unable to sign in");

  const opaqueToken = randomBytes(32).toString("base64url");
  const { data, error } = await adminRpc("mint_fixed_admin_session_v1", {
    p_email: FIXED_ADMIN_EMAIL,
    p_token_hash: hash(opaqueToken),
  });
  if (error || !data) throw new Error("Unable to sign in");

  setResponseHeader(
    "Set-Cookie",
    serializeCookie(ADMIN_SESSION_COOKIE, opaqueToken, {
      maxAge: ADMIN_SESSION_MAX_AGE_SEC,
      path: "/",
      sameSite: "strict",
    }),
  );
  return { step: "authenticated" as const };
}

export async function globalAdminSignOut() {
  assertAdminSameOriginMutation();
  await requireAdminSession();
  const token = getCookie(ADMIN_SESSION_COOKIE);
  if (!token) throw new Error("Unable to sign out all sessions");
  const { data, error } = await adminRpc("global_admin_signout_v4", { p_token_hash: hash(token) });
  if (error || !data) throw new Error("Unable to sign out all sessions");
  clearAdminCookiesOnly();
}

export async function getAdminSession(request?: Request) {
  const actualRequest = request ?? getRequest();
  const token = getCookie(ADMIN_SESSION_COOKIE, actualRequest);
  if (!token) return null;
  if (UNSAFE_METHODS.has(actualRequest.method.toUpperCase()))
    assertAdminSameOriginMutation(actualRequest);
  const { data, error } = await adminRpc("validate_admin_session_v4", {
    p_token_hash: hash(token),
    // Passive GET/status checks validate authority without extending idle lifetime.
    p_touch: false,
  });
  if (error) return null;
  return (
    (
      data as Array<{
        session_id: string;
        user_id: string;
        role: string;
        impersonated_profile_id: string | null;
      }> | null
    )?.[0] ?? null
  );
}

export async function isAdminSessionValid(request?: Request) {
  return Boolean(await getAdminSession(request));
}

function clearAdminCookiesOnly() {
  setResponseHeader("Set-Cookie", [serializeCookieDelete(ADMIN_SESSION_COOKIE)]);
}

export async function clearAdminSessionCookies() {
  assertAdminSameOriginMutation();
  const token = getCookie(ADMIN_SESSION_COOKIE);
  if (token) {
    const { data, error } = await adminRpc("revoke_admin_session_v4", {
      p_token_hash: hash(token),
    });
    if (error || !data) throw new Error("Unable to sign out");
  }
  clearAdminCookiesOnly();
}

export async function setImpersonationCookie(profileId: string) {
  assertAdminSameOriginMutation();
  const token = getCookie(ADMIN_SESSION_COOKIE);
  if (!token) throw new Error("Unauthorized: admin session required");
  const { data, error } = await adminRpc("set_admin_session_impersonation_v4", {
    p_token_hash: hash(token),
    p_profile_id: profileId,
  });
  if (error || !data) throw new Error("Unable to impersonate profile");
}

export async function getImpersonationProfileId(request?: Request) {
  return (await getAdminSession(request))?.impersonated_profile_id ?? undefined;
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized: admin session required");
  return session;
}

/** Validate and hash the canonical HttpOnly opaque session without exposing it to callers. */
export async function requireAdminSessionTokenHash(request: Request = getRequest()) {
  const session = await getAdminSession(request);
  const token = getCookie(ADMIN_SESSION_COOKIE, request);
  if (!session || !token) throw new Error("Unauthorized: admin session required");
  return hash(token);
}

export async function getAuthenticatedAdminActorId() {
  return (await requireAdminSession()).user_id;
}
