import { z } from "zod";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED_PATH = new RegExp(
  `^(?:/user/${UUID}(?:/edit-mode)?|/setup/${UUID}(?:/(?:calendar|availability|payments))?|/leads|/bookings)$`,
  "i",
);
const uuidSchema = z.string().uuid();

export const contractorLoginSearchSchema = z.object({
  next: z.string().max(300).optional(),
});

export const verifyOtpSearchSchema = z.object({
  flow: z.enum(["login", "checkout"]),
  next: z.string().max(300).optional(),
});

export type ContractorConnectMarker = "success" | "error" | "return" | "refresh";

export function withConnectMarker(path: string, connect: ContractorConnectMarker): string {
  const url = new URL(path, "https://obra.invalid");
  url.searchParams.set("connect", connect);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function purchaserWorkspacePath(profileId: string, websiteId: string): string {
  return `/user/${profileId}?websiteId=${websiteId}`;
}

export type ContractorResumeTo =
  | {
      to: "/user/$userId";
      params: { userId: string };
      search?: {
        websiteId?: string;
        templateId?: string;
        connect?: ContractorConnectMarker;
      };
      hash?: string;
    }
  | {
      to: "/user/$userId/edit-mode";
      params: { userId: string };
      search: { websiteId: string };
    }
  | { to: "/leads" }
  | { to: "/bookings"; search?: { view: "future" | "past" } };

/**
 * Same-origin contractor app path only. Document returns from Pipedream/Stripe
 * land here after /user SSR fail-closes to /login; a free-form URL would be an
 * open redirect.
 */
export function safeContractorReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || value.includes("@")) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://obra.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://obra.invalid" || parsed.username || parsed.password) return null;
  if (!ALLOWED_PATH.test(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function contractorLoginRedirect(nextPath: string): {
  to: "/login";
  search?: { next: string };
} {
  const next = safeContractorReturnPath(nextPath);
  return next ? { to: "/login", search: { next } } : { to: "/login" };
}

function readUuid(value: string | undefined): string | null {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function readConnectMarker(value: string | null): ContractorConnectMarker | undefined {
  if (value === "success" || value === "error" || value === "return" || value === "refresh") {
    return value;
  }
  return undefined;
}

/**
 * Typed in-app location for a stored contractor session. Never uses `href`:
 * an absolute href in this router is a document navigation and would loop
 * /user SSR Unauthorized → /login → /user.
 */
export function contractorResumeTo(next: unknown, fallbackUserId: string): ContractorResumeTo {
  const fallback: ContractorResumeTo = {
    to: "/user/$userId",
    params: { userId: fallbackUserId },
  };
  const safe = safeContractorReturnPath(next);
  if (!safe) return fallback;
  const url = new URL(safe, "https://obra.invalid");
  const segments = url.pathname.split("/").filter(Boolean);
  const hash = url.hash.replace(/^#/, "") || undefined;

  if (segments[0] === "leads") return { to: "/leads" };
  if (segments[0] === "bookings") {
    const view = url.searchParams.get("view");
    if (view === "future" || view === "past") return { to: "/bookings", search: { view } };
    return { to: "/bookings" };
  }
  if (segments[0] === "user") {
    const userId = readUuid(segments[1]);
    if (!userId) return fallback;
    if (segments[2] === "edit-mode") {
      const websiteId = readUuid(url.searchParams.get("websiteId") ?? undefined);
      if (!websiteId) return { to: "/user/$userId", params: { userId } };
      return { to: "/user/$userId/edit-mode", params: { userId }, search: { websiteId } };
    }
    const websiteId = readUuid(url.searchParams.get("websiteId") ?? undefined) ?? undefined;
    const templateId = url.searchParams.get("templateId") ?? undefined;
    const connect = readConnectMarker(url.searchParams.get("connect"));
    const search =
      websiteId || templateId || connect
        ? {
            ...(websiteId ? { websiteId } : {}),
            ...(templateId ? { templateId } : {}),
            ...(connect ? { connect } : {}),
          }
        : undefined;
    return {
      to: "/user/$userId",
      params: { userId },
      ...(search ? { search } : {}),
      ...(hash ? { hash } : {}),
    };
  }
  if (segments[0] === "setup") {
    const websiteId = readUuid(segments[1]);
    if (!websiteId) return fallback;
    const connect = readConnectMarker(url.searchParams.get("connect"));
    const stepHash =
      segments[2] === "calendar"
        ? "step-2"
        : segments[2] === "availability"
          ? "step-3"
          : segments[2] === "payments"
            ? "step-4"
            : hash;
    return {
      to: "/user/$userId",
      params: { userId: fallbackUserId },
      search: { websiteId, ...(connect ? { connect } : {}) },
      ...(stepHash ? { hash: stepHash } : {}),
    };
  }
  return fallback;
}
