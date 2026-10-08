import { parse } from "acorn";
import { analyze } from "eslint-scope";

import {
  kitNamesForScope,
  THEME_REACT_NAMES,
  THEME_RUNTIME_PARAMETER_NAMES,
  type ThemeKitScope,
} from "./kit-scope.ts";

const SAFE_ECMASCRIPT_GLOBALS = [
  "Array",
  "ArrayBuffer",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "URIError",
  "URL",
  "WeakMap",
  "WeakSet",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
  "NaN",
  "Infinity",
] as const;

const FORBIDDEN_MEMBER_NAMES = new Set([
  "constructor",
  "__proto__",
  "prototype",
  "dangerouslySetInnerHTML",
]);
const FORBIDDEN_ELEMENT_NAMES = new Set(["script", "iframe", "object", "embed"]);
const UNIFIED_RAW_MEDIA_ELEMENTS = new Set(["img", "video", "source", "picture", "audio"]);

type AstNode = { type?: string; [key: string]: unknown };

function literalString(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  if (record.type === "Literal" && typeof record.value === "string") return record.value;
  if (record.type === "BinaryExpression" && record.operator === "+") {
    const left = literalString(record.left);
    const right = literalString(record.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (record.type === "TemplateLiteral") {
    const expressions = Array.isArray(record.expressions) ? record.expressions : [];
    const quasis = Array.isArray(record.quasis) ? record.quasis : [];
    if (expressions.length === 0 && quasis.length === 1) {
      const value = (quasis[0] as { value?: { cooked?: unknown } } | undefined)?.value?.cooked;
      return typeof value === "string" ? value : null;
    }
  }
  return null;
}

function memberName(node: AstNode): string | null {
  if (node.computed === true) return literalString(node.property);
  const property = node.property;
  if (property && typeof property === "object" && (property as AstNode).type === "Identifier") {
    const name = (property as Record<string, unknown>).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

function runtimePolicyErrors(ast: AstNode, scope: ThemeKitScope): string[] {
  const errors = new Set<string>();
  const constantStrings = new Map<string, string>();
  const createElementAliases = new Set<string>();

  const collectConstants = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) collectConstants(item);
      return;
    }
    const node = value as AstNode;
    if (node.type === "VariableDeclarator") {
      const id = node.id as Record<string, unknown> | undefined;
      const name = id?.type === "Identifier" && typeof id.name === "string" ? id.name : null;
      const text = literalString(node.init);
      if (name && text !== null) constantStrings.set(name, text);
      const init = node.init as AstNode | undefined;
      if (name && init?.type === "MemberExpression" && memberName(init) === "createElement") {
        createElementAliases.add(name);
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "start" && key !== "end" && key !== "range" && key !== "loc") {
        collectConstants(child);
      }
    }
  };
  collectConstants(ast);

  const resolvedString = (value: unknown): string | null => {
    const literal = literalString(value);
    if (literal !== null) return literal;
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.type === "Identifier" && typeof record.name === "string") {
        return constantStrings.get(record.name) ?? null;
      }
    }
    return null;
  };

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as AstNode;
    if (node.type === "ThisExpression") errors.add("this is unavailable");
    if (node.type === "ImportExpression") errors.add("dynamic import is unavailable");
    if (node.type === "MemberExpression") {
      const name =
        memberName(node) ?? (node.computed === true ? resolvedString(node.property) : null);
      const propertyNode = node.property as AstNode | undefined;
      const staticNumericIndex =
        node.computed === true &&
        propertyNode?.type === "Literal" &&
        typeof (node.property as Record<string, unknown>).value === "number";
      if (node.computed === true && name === null && !staticNumericIndex) {
        errors.add("dynamic property access is unavailable");
      } else if (name && FORBIDDEN_MEMBER_NAMES.has(name)) {
        errors.add(`${name} access is unavailable`);
      }
    }
    if (node.type === "Property") {
      const key =
        resolvedString(node.key) ??
        (node.computed === true ? null : memberName({ property: node.key }));
      if (key && FORBIDDEN_MEMBER_NAMES.has(key)) errors.add(`${key} property is unavailable`);
      if (key && /^on[A-Z]/.test(key)) errors.add("event handler properties are unavailable");
      if (key && ["href", "src", "action", "formAction"].includes(key)) {
        const url = resolvedString(node.value);
        if (url && /^\s*javascript:/i.test(url)) errors.add("javascript URLs are unavailable");
      }
    }
    if (node.type === "CallExpression") {
      const callee = node.callee as AstNode | undefined;
      if (callee?.type === "Identifier") {
        const name = (callee as Record<string, unknown>).name;
        if (typeof name === "string" && createElementAliases.has(name)) {
          errors.add("aliased element creation is unavailable");
        }
      }
      if (callee?.type === "MemberExpression" && memberName(callee) === "get") {
        const object = callee.object as Record<string, unknown> | undefined;
        if (object?.type === "Identifier" && object.name === "Reflect") {
          const args = Array.isArray(node.arguments) ? node.arguments : [];
          const property = resolvedString(args[1]);
          if (property === null || FORBIDDEN_MEMBER_NAMES.has(property)) {
            errors.add("reflective property access is unavailable");
          }
        }
      }
      if (
        callee?.type === "MemberExpression" &&
        memberName(callee) === "call" &&
        (callee.object as AstNode | undefined)?.type === "MemberExpression" &&
        memberName(callee.object as AstNode) === "createElement"
      ) {
        errors.add("indirect element creation is unavailable");
      }
      if (callee?.type === "MemberExpression" && memberName(callee) === "createElement") {
        const args = Array.isArray(node.arguments) ? node.arguments : [];
        const tag = resolvedString(args[0]);
        if (
          tag &&
          (FORBIDDEN_ELEMENT_NAMES.has(tag.toLowerCase()) ||
            (scope === "unified" && UNIFIED_RAW_MEDIA_ELEMENTS.has(tag.toLowerCase())))
        ) {
          errors.add(`${tag} elements are unavailable`);
        } else if (args[0] && tag === null) {
          const first = args[0] as Record<string, unknown>;
          const componentIdentifier =
            first.type === "Identifier" &&
            typeof first.name === "string" &&
            /^[A-Z]/.test(first.name);
          if (!componentIdentifier) errors.add("dynamic element names are unavailable");
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "start" || key === "end" || key === "range" || key === "loc") continue;
      visit(child);
    }
  };
  visit(ast);
  return [...errors].sort();
}

export type ThemeBindingAnalysis = {
  unavailable: string[];
  collisions: string[];
  policyErrors: string[];
  usedInjected: string[];
  mediaSlotIds: string[];
  dynamicMediaSlotCount: number;
  sectionMarkerIds: string[];
  dynamicSectionMarkerCount: number;
};

function literalPropBindings(
  ast: AstNode,
  componentName: string | null,
  propName: string,
): { ids: string[]; dynamicCount: number } {
  const ids: string[] = [];
  let dynamicCount = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as AstNode;
    if (node.type === "CallExpression") {
      const callee = node.callee as AstNode | undefined;
      const isCreateElement =
        callee?.type === "MemberExpression" && memberName(callee) === "createElement";
      const args = Array.isArray(node.arguments) ? node.arguments : [];
      const component = args[0] as Record<string, unknown> | undefined;
      const componentMatches =
        componentName === null
          ? component?.type === "Literal" && typeof component.value === "string"
          : component?.type === "Identifier" && component.name === componentName;
      if (isCreateElement && componentMatches) {
        const props = args[1] as Record<string, unknown> | undefined;
        const properties =
          props?.type === "ObjectExpression" && Array.isArray(props.properties)
            ? props.properties
            : [];
        const slotProp = properties.find((property) => {
          const prop = property as AstNode;
          return (
            prop.type === "Property" &&
            (memberName({ property: prop.key }) ?? literalString(prop.key)) === propName
          );
        }) as Record<string, unknown> | undefined;
        if (!slotProp && propName === "data-site-section") {
          // Ordinary DOM roots need not be section roots.
        } else {
          const slotValue = slotProp?.value as Record<string, unknown> | undefined;
          const isDirectLiteral =
            slotValue?.type === "Literal" && typeof slotValue.value === "string";
          const slotId = slotProp ? literalString(slotProp.value) : null;
          if (slotId === null || (propName === "data-site-section" && !isDirectLiteral))
            dynamicCount += 1;
          else ids.push(slotId);
        }
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "start" && key !== "end" && key !== "range" && key !== "loc") visit(child);
    }
  };
  visit(ast);
  return { ids: ids.sort(), dynamicCount };
}

export function analyzeThemeBindings(js: string, scope: ThemeKitScope): ThemeBindingAnalysis {
  const ast = parse(js, {
    ecmaVersion: "latest",
    sourceType: "script",
    ranges: true,
  }) as unknown as AstNode;
  const scopeManager = analyze(ast as never, { ecmaVersion: 2022, sourceType: "script" });
  const injected = new Set<string>([
    ...THEME_RUNTIME_PARAMETER_NAMES,
    ...THEME_REACT_NAMES,
    ...kitNamesForScope(scope),
  ]);
  const allowed = new Set<string>([...injected, ...SAFE_ECMASCRIPT_GLOBALS]);
  type ManagedVariable = { name: string; defs?: unknown[] };
  type ManagedScope = { variables?: ManagedVariable[]; childScopes?: ManagedScope[] };
  const collectVariables = (managedScope: ManagedScope | null | undefined): ManagedVariable[] =>
    managedScope
      ? [
          ...(managedScope.variables ?? []),
          ...(managedScope.childScopes ?? []).flatMap((child) => collectVariables(child)),
        ]
      : [];
  const allVariables = collectVariables(scopeManager.globalScope as ManagedScope | null);
  const declared = new Set(
    scopeManager.globalScope?.variables?.map((variable) => variable.name) ?? [],
  );
  const shadowedInjected = new Set(
    allVariables
      .filter((variable) => injected.has(variable.name))
      .filter((variable) => (variable.defs?.length ?? 0) > 0)
      .map((variable) => variable.name),
  );
  const throughNames =
    scopeManager.globalScope?.through.map((reference) => reference.identifier.name) ?? [];
  const names = throughNames.filter((name) => !declared.has(name) && !allowed.has(name));
  const mediaSlots = literalPropBindings(ast, "Media", "slotId");
  const sectionMarkers = literalPropBindings(ast, null, "data-site-section");
  return {
    unavailable: [...new Set(names)].sort(),
    collisions: [...shadowedInjected].sort(),
    policyErrors: runtimePolicyErrors(ast, scope),
    usedInjected: [...new Set(throughNames.filter((name) => injected.has(name)))].sort(),
    mediaSlotIds: mediaSlots.ids,
    dynamicMediaSlotCount: mediaSlots.dynamicCount,
    sectionMarkerIds: sectionMarkers.ids,
    dynamicSectionMarkerCount: sectionMarkers.dynamicCount,
  };
}
