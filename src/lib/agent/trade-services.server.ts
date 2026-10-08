/**
 * Slice docs/services.md by trade classification code.
 * Design prompt only — do not inject this into the code agent.
 * SERVICES_DOC is inlined so Cloudflare SSR can slice without a filesystem.
 */

import { SERVICES_DOC } from "./services-doc.ts";

export type TradeServicesSlice = {
  code: string;
  title: string;
  typicalServices: string[];
};

let cachedSlices: Map<string, TradeServicesSlice> | null = null;

function headingCode(headingLine: string): { code: string; title: string } | null {
  const match = headingLine.match(/^##\s+(\S+)\s+[—–-]\s+(.+)$/);
  if (!match) return null;
  return { code: match[1].trim().toUpperCase(), title: match[2].trim() };
}

function parseTypicalServices(body: string): string[] {
  const typical = body.match(/\*\*Typical services\*\*\s*\n([\s\S]*?)(?=\n\*\*[A-Z]|\n##\s|$)/i);
  if (!typical) return [];
  const items: string[] = [];
  for (const line of typical[1].split("\n")) {
    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet) items.push(bullet[1].trim());
  }
  return items;
}

function parseSlices(doc: string): Map<string, TradeServicesSlice> {
  const map = new Map<string, TradeServicesSlice>();
  const parts = doc.split(/(?=^## )/m);
  for (const part of parts) {
    const firstLine = part.split("\n", 1)[0] ?? "";
    const heading = headingCode(firstLine);
    if (!heading) continue;
    if (heading.code === "INDEX") continue;
    const typicalServices = parseTypicalServices(part);
    if (typicalServices.length === 0) continue;
    map.set(heading.code, {
      code: heading.code,
      title: heading.title,
      typicalServices,
    });
  }
  return map;
}

export function typicalServicesForTrade(trade: string): TradeServicesSlice | null {
  const code = trade.trim().toUpperCase();
  if (!code) return null;
  if (!cachedSlices) cachedSlices = parseSlices(SERVICES_DOC);
  return cachedSlices.get(code) ?? null;
}

/** Empty when trade does not match a classification heading (do not dump the index). */
export function formatTypicalServicesForDesign(trade: string): string {
  const slice = typicalServicesForTrade(trade);
  if (!slice) return "";
  const bullets = slice.typicalServices.map((item) => `- ${item}`).join("\n");
  return `Trade classification ${slice.code} — ${slice.title}

Typical services (consumer-facing offerings for this classification — not this contractor's licensed scope, and not a claim they offer every bullet). Onboarding services are market segment (residential/commercial). If the fact sheet has servicesOffered from listings, prefer that as this contractor's advertised list. Otherwise write the services section from this list. Do not invent offerings beyond it. Do not paste official scope.

${bullets}`;
}

/** Test helper — forget the in-memory parse so a swapped doc can be re-read. */
export function resetTradeServicesCacheForTests(): void {
  cachedSlices = null;
}
