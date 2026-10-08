import {
  isKnownKitProp,
  KIT_PROP_TABLE,
  KIT_TAG_NAMES,
  type KitPropSpec,
  type KitTagName,
} from "./kit-props.ts";

export type DesignAuditFinding = {
  severity: "error" | "advisory";
  code: string;
  message: string;
};

export type KitOpenTag = {
  tag: KitTagName;
  attrs: string;
  attrMap: Record<string, { raw: string; literal: string | null }>;
  selfClosing: boolean;
  index: number;
  body: string;
};

const TAG_OPEN = new RegExp(`<(${KIT_TAG_NAMES.join("|")})\\b`, "g");

function findTagClose(source: string, from: number): number {
  let quote: string | null = null;
  let brace = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\" && quote !== "`") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      brace += 1;
      continue;
    }
    if (ch === "}" && brace > 0) {
      brace -= 1;
      continue;
    }
    if (ch === ">" && brace === 0) return i;
  }
  return -1;
}

function parseAttrs(attrs: string): KitOpenTag["attrMap"] {
  const map: KitOpenTag["attrMap"] = {};
  let i = 0;
  const len = attrs.length;
  while (i < len) {
    while (i < len && /\s/.test(attrs[i]!)) i += 1;
    if (i >= len || attrs[i] === "/" || attrs[i] === ">") break;
    if (!/[A-Za-z_:]/.test(attrs[i]!)) {
      i += 1;
      continue;
    }
    const nameStart = i;
    i += 1;
    while (i < len && /[\w:-]/.test(attrs[i]!)) i += 1;
    const name = attrs.slice(nameStart, i);
    while (i < len && /\s/.test(attrs[i]!)) i += 1;
    if (attrs[i] !== "=") {
      map[name] = { raw: "true", literal: "true" };
      continue;
    }
    i += 1;
    while (i < len && /\s/.test(attrs[i]!)) i += 1;
    const ch = attrs[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      const start = i;
      while (i < len && attrs[i] !== quote) {
        if (attrs[i] === "\\") i += 1;
        i += 1;
      }
      const value = attrs.slice(start, i);
      if (attrs[i] === quote) i += 1;
      map[name] = { raw: value, literal: value };
      continue;
    }
    if (ch === "{") {
      let brace = 1;
      i += 1;
      const start = i;
      let quote: string | null = null;
      while (i < len && brace > 0) {
        const c = attrs[i]!;
        if (quote) {
          if (c === "\\" && quote !== "`") {
            i += 2;
            continue;
          }
          if (c === quote) quote = null;
          i += 1;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          quote = c;
          i += 1;
          continue;
        }
        if (c === "{") brace += 1;
        else if (c === "}") brace -= 1;
        if (brace === 0) break;
        i += 1;
      }
      const expr = attrs.slice(start, i);
      if (attrs[i] === "}") i += 1;
      const trimmed = expr.trim();
      const str = /^["'`]([\s\S]*)["'`]$/.exec(trimmed);
      if (str) map[name] = { raw: expr, literal: str[1] };
      else if (trimmed === "true" || trimmed === "false") map[name] = { raw: expr, literal: trimmed };
      else map[name] = { raw: expr, literal: null };
      continue;
    }
    const start = i;
    while (i < len && attrs[i] !== ">" && attrs[i] !== "/" && !/\s/.test(attrs[i]!)) i += 1;
    const bare = attrs.slice(start, i);
    map[name] = { raw: bare, literal: bare };
  }
  return map;
}

function findMatchingEnd(source: string, tag: string, afterOpen: number): number {
  let depth = 1;
  const re = new RegExp(`<(/)?${tag}\\b`, "g");
  re.lastIndex = afterOpen;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (match[1]) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

export function scanKitOpenTags(source: string): KitOpenTag[] {
  const out: KitOpenTag[] = [];
  TAG_OPEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_OPEN.exec(source))) {
    const tag = match[1] as KitTagName;
    const close = findTagClose(source, match.index + match[0].length);
    if (close < 0) continue;
    const inner = source.slice(match.index + match[0].length, close);
    const selfClosing = inner.trimEnd().endsWith("/");
    const attrs = selfClosing ? inner.trimEnd().slice(0, -1) : inner;
    let body = "";
    if (!selfClosing) {
      const end = findMatchingEnd(source, tag, close + 1);
      if (end >= 0) body = source.slice(close + 1, end);
    }
    out.push({
      tag,
      attrs,
      attrMap: parseAttrs(attrs),
      selfClosing,
      index: match.index,
      body,
    });
  }
  return out;
}

function classTokens(className: string | null): string[] {
  if (!className) return [];
  return className.split(/\s+/).filter(Boolean);
}

/** Arbitrary `text-[…]` on Heading is size (kit-owned) unless it is a color. */
function isArbitraryColorTextToken(token: string): boolean {
  return /^text-\[(?:var\(|#|rgb|hsl|hwb|lab|lch|oklch|oklab|color-mix|color:|theme\(|inherit\]|currentColor\]|transparent\])/i.test(
    token,
  );
}

function ownedClassHit(token: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => {
    if (!token.startsWith(prefix)) return false;
    if (prefix === "text-[" && isArbitraryColorTextToken(token)) return false;
    return true;
  });
}

function replacementFor(tag: string, owner: string): string {
  if (tag === "Section" || tag === "Hero") {
    if (owner === "band") return 'band="base|soft|primary|ink|media"';
    if (owner === "width") return 'width="prose|content|wide|full"';
    if (owner === "pad") return 'pad="none|tight|normal|loose"';
  }
  if (tag === "Heading" && owner === "level") return 'level="display|title|section|sub|eyebrow"';
  if (tag === "Card" && owner === "surface") return 'surface="plain"';
  if (tag === "Media" && owner === "scrim") return 'Section media={still} scrim="soft|strong"';
  return owner;
}

export function auditKitThemeSource(
  source: string,
  _options: { catalogRefs?: string[] } = {},
): DesignAuditFinding[] {
  const findings: DesignAuditFinding[] = [];
  const tags = scanKitOpenTags(source);

  for (const el of tags) {
    const spec: KitPropSpec = KIT_PROP_TABLE[el.tag];
    for (const prop of Object.keys(el.attrMap)) {
      if (!isKnownKitProp(el.tag, prop)) {
        findings.push({
          severity: "error",
          code: "unknown-kit-prop",
          message: `${el.tag} does not accept ${prop}=. Allowed: ${(spec.props as readonly string[]).join(", ")}.`,
        });
      }
    }
    for (const name of spec.required ?? []) {
      if (!(name in el.attrMap)) {
        findings.push({
          severity: "error",
          code: "missing-required-kit-prop",
          message: `${el.tag} requires ${name}=.`,
        });
      }
    }
    for (const name of spec.literal ?? []) {
      const attr = el.attrMap[name];
      if (attr && attr.literal === null) {
        findings.push({
          severity: "error",
          code: "nonliteral-kit-prop",
          message: `${el.tag} ${name} must be a literal (e.g. ${name}="…"), not an expression.`,
        });
      }
    }
    const motion = el.attrMap.motion?.literal;
    if (el.tag === "Media" && motion !== undefined && !["desktop", "all"].includes(motion ?? "")) {
      findings.push({
        severity: "error",
        code: "kit-prop-value",
        message: "Media motion must be either desktop or all.",
      });
    }
    const className = el.attrMap.className?.literal;
    if (className) {
      const owned = spec.ownedClass ?? {};
      for (const token of classTokens(className)) {
        for (const [owner, prefixes] of Object.entries(owned)) {
          if (ownedClassHit(token, prefixes)) {
            findings.push({
              severity: "error",
              code: "kit-owned-utility",
              message: `${el.tag} className "${token}" fights a kit-owned property. Use ${replacementFor(el.tag, owner)} instead.`,
            });
          }
        }
      }
    }
  }

  const bands = tags
    .filter((el) => el.tag === "Section" || el.tag === "Hero" || el.tag === "NamedLayout")
    .map((el) => {
      const literal = el.attrMap.band?.literal;
      if (el.tag === "NamedLayout") return literal ?? null;
      return literal ?? "base";
    })
    .filter((band): band is string => Boolean(band));
  for (let i = 1; i < bands.length; i++) {
    if (bands[i] === bands[i - 1]) {
      findings.push({
        severity: "advisory",
        code: "same-consecutive-band",
        message: `Consecutive Section/Hero/NamedLayout elements share band="${bands[i]}". Alternate band so adjacent surfaces separate.`,
      });
    }
  }

  return findings;
}
