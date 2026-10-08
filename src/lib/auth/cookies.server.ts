import { getRequest } from "@tanstack/react-start/server";

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  path?: string;
  maxAge?: number;
}

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

export function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  parts.push(`SameSite=${options.sameSite ?? "lax"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure ?? isProduction()) parts.push("Secure");
  return parts.join("; ");
}

export function serializeCookieDelete(name: string, path = "/"): string {
  return serializeCookie(name, "", { maxAge: 0, path });
}

export function parseCookies(request?: Request): Record<string, string> {
  const req = request ?? getRequest();
  const header = req.headers.get("cookie") ?? "";
  const cookies: Record<string, string> = {};

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

export function getCookie(name: string, request?: Request): string | undefined {
  return parseCookies(request)[name];
}
