import { parse } from "acorn";

import { transformThemeModule } from "../site-theme/eval-theme-module.ts";
import { CANONICAL_SECTION_TYPES, type CanonicalSectionType } from "./section-order.ts";

export type SectionDescriptorStatus = "missing" | "unclassifiable" | "classified";
export type SectionLayoutDescriptor = {
  status: SectionDescriptorStatus;
  source?: "catalog" | "tsx";
  family?: string;
  structure?: string;
};
export type LayoutDescriptor = Record<CanonicalSectionType, SectionLayoutDescriptor>;

type AstNode = { type?: string; [key: string]: unknown };
const SECTION_SET = new Set<string>(CANONICAL_SECTION_TYPES);
const LAYOUT_CLASS =
  /^(?:flex|grid|block|inline|hidden|contents|columns-|(?:[a-z0-9-]+:)*(?:flex|grid|block|inline|hidden|contents|columns-|grid-cols-|grid-rows-|col-span-|row-span-|col-start-|row-start-|order-|absolute|relative|fixed|sticky|inset-|top-|right-|bottom-|left-|place-|items-|justify-|self-|grow|shrink|basis-|w-|h-|aspect-|overflow-))/;
const MEDIA_NAMES = new Set(["Media", "MediaGallery", "img", "picture", "video"]);

function node(value: unknown): AstNode | null {
  return value && typeof value === "object" ? (value as AstNode) : null;
}
function literalString(value: unknown): string | null {
  const item = node(value);
  if (!item) return null;
  if (item.type === "Literal" && typeof item.value === "string") return item.value;
  if (item.type === "TemplateLiteral") {
    const expressions = Array.isArray(item.expressions) ? item.expressions : [];
    const quasis = Array.isArray(item.quasis) ? item.quasis : [];
    if (expressions.length === 0 && quasis.length === 1) {
      const cooked = node(node(quasis[0])?.value)?.cooked;
      return typeof cooked === "string" ? cooked : null;
    }
  }
  if (item.type === "BinaryExpression" && item.operator === "+") {
    const left = literalString(item.left),
      right = literalString(item.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}
function propertyName(value: unknown): string | null {
  const item = node(value);
  if (!item) return null;
  return item.type === "Identifier" && typeof item.name === "string"
    ? item.name
    : literalString(item);
}
function elementCall(
  value: unknown,
): { name: string; props: AstNode | null; children: AstNode[] } | null {
  const item = node(value);
  if (!item || item.type !== "CallExpression") return null;
  const callee = node(item.callee),
    object = node(callee?.object),
    property = node(callee?.property);
  if (
    callee?.type !== "MemberExpression" ||
    object?.name !== "React" ||
    property?.name !== "createElement"
  )
    return null;
  const args = Array.isArray(item.arguments) ? item.arguments : [];
  const nameNode = node(args[0]);
  const name =
    literalString(args[0]) ??
    (nameNode?.type === "Identifier" && typeof nameNode.name === "string"
      ? nameNode.name
      : "dynamic");
  return {
    name,
    props: node(args[1]),
    children: args
      .slice(2)
      .map(node)
      .filter((child): child is AstNode => child !== null),
  };
}
function propsOf(props: AstNode | null): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (props?.type !== "ObjectExpression" || !Array.isArray(props.properties)) return out;
  for (const raw of props.properties) {
    const prop = node(raw);
    if (prop?.type !== "Property") continue;
    const name = propertyName(prop.key);
    if (name) out.set(name, prop.value);
  }
  return out;
}
function layoutTokens(props: Map<string, unknown>): string[] {
  const value = literalString(props.get("className")) ?? literalString(props.get("class"));
  return value
    ? [...new Set(value.split(/\s+/).filter((token) => LAYOUT_CLASS.test(token)))].sort()
    : [];
}
function semantic(name: string): string {
  if (MEDIA_NAMES.has(name) || name === "firstStill") return "media";
  if (name === "Card") return "card";
  if (name === "Quote") return "quote";
  if (name === "LeadSlot") return "lead";
  if (name === "TrustMarkerList") return "trust";
  if (name === "Heading" || /^h[1-6]$/.test(name)) return "content";
  if (
    ["Section", "Hero", "div", "section", "footer", "main", "article", "ul", "ol", "li"].includes(
      name,
    )
  )
    return name.toLowerCase();
  return name === "dynamic" ? "dynamic" : "node";
}
function expressionChildren(item: AstNode): AstNode[] {
  if (item.type === "CallExpression")
    return (Array.isArray(item.arguments) ? item.arguments : [])
      .map(node)
      .filter((x): x is AstNode => x !== null);
  if (item.type === "ConditionalExpression")
    return [item.consequent, item.alternate].map(node).filter((x): x is AstNode => x !== null);
  if (item.type === "LogicalExpression")
    return [item.left, item.right].map(node).filter((x): x is AstNode => x !== null);
  if (item.type === "ArrayExpression")
    return (Array.isArray(item.elements) ? item.elements : [])
      .map(node)
      .filter((x): x is AstNode => x !== null);
  if (item.type === "ArrowFunctionExpression" || item.type === "FunctionExpression") {
    const body = node(item.body);
    return body ? [body] : [];
  }
  if (item.type === "BlockStatement")
    return (Array.isArray(item.body) ? item.body : [])
      .map(node)
      .filter((x): x is AstNode => x !== null);
  if (item.type === "ReturnStatement") {
    const argument = node(item.argument);
    return argument ? [argument] : [];
  }
  if (item.type === "SequenceExpression")
    return (Array.isArray(item.expressions) ? item.expressions : [])
      .map(node)
      .filter((x): x is AstNode => x !== null);
  return [];
}
function structuralNode(value: unknown, depth = 0): string | null {
  if (depth > 12) return "depth";
  const item = node(value);
  if (!item) return null;
  const element = elementCall(item);
  if (!element) {
    const nested = expressionChildren(item)
      .map((child) => structuralNode(child, depth + 1))
      .filter(Boolean);
    return nested.length ? "expr(" + nested.join(",") + ")" : null;
  }
  if (semantic(element.name) === "content") return null;
  const props = propsOf(element.props),
    tokens = layoutTokens(props);
  const flags = [props.has("media") ? "media-prop" : null, ...tokens].filter(Boolean);
  const children = element.children
    .map((child) => structuralNode(child, depth + 1))
    .filter(Boolean);
  return (
    semantic(element.name) +
    (flags.length ? "[" + flags.join(",") + "]" : "") +
    (children.length ? "(" + children.join(",") + ")" : "")
  );
}
function walk(value: unknown, visit: (item: AstNode) => void): void {
  const item = node(value);
  if (!item) return;
  visit(item);
  for (const [key, child] of Object.entries(item)) {
    if (["start", "end", "loc"].includes(key)) continue;
    if (Array.isArray(child)) for (const entry of child) walk(entry, visit);
    else walk(child, visit);
  }
}
function rootMarker(element: ReturnType<typeof elementCall>): CanonicalSectionType | null {
  if (!element) return null;
  const props = propsOf(element.props);
  const dataMarker = literalString(props.get("data-site-section"));
  if (dataMarker && SECTION_SET.has(dataMarker)) return dataMarker as CanonicalSectionType;
  const idMarker = literalString(props.get("id"));
  if (
    idMarker &&
    SECTION_SET.has(idMarker) &&
    ["Section", "Hero", "section", "footer"].includes(element.name)
  )
    return idMarker as CanonicalSectionType;
  if (element.name === "NamedLayout") {
    const section = literalString(props.get("section"));
    if (section && SECTION_SET.has(section)) return section as CanonicalSectionType;
  }
  return null;
}
export function describeThemeSections(source: string): LayoutDescriptor {
  const result = Object.fromEntries(
    CANONICAL_SECTION_TYPES.map((id) => [id, { status: "missing" }]),
  ) as LayoutDescriptor;
  if (!source.trim()) return result;
  const transformed = transformThemeModule(source);
  if (!transformed.ok) {
    for (const id of CANONICAL_SECTION_TYPES) result[id] = { status: "unclassifiable" };
    return result;
  }
  try {
    const ast = parse(transformed.js, {
      ecmaVersion: "latest",
      sourceType: "script",
    }) as unknown as AstNode;
    const roots = new Map<
      CanonicalSectionType,
      { source: "catalog" | "tsx"; structure: string }[]
    >();
    walk(ast, (item) => {
      const element = elementCall(item),
        id = rootMarker(element);
      if (!id) return;
      const structure = structuralNode(item);
      if (!structure) return;
      const entries = roots.get(id) ?? [];
      entries.push({ source: element?.name === "NamedLayout" ? "catalog" : "tsx", structure });
      roots.set(id, entries);
    });
    for (const id of CANONICAL_SECTION_TYPES) {
      const entries = roots.get(id);
      if (!entries?.length) continue;
      const unique = [
        ...new Set(entries.map((entry) => `${entry.source}:${entry.structure}`)),
      ].sort();
      result[id] =
        unique.length === 1
          ? {
              status: "classified",
              source: entries[0].source,
              structure: entries[0].structure,
            }
          : { status: "unclassifiable" };
    }
  } catch {
    for (const id of CANONICAL_SECTION_TYPES) result[id] = { status: "unclassifiable" };
  }
  return result;
}
