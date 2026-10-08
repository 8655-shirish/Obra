import fs from "node:fs";

/**
 * Template wiring parity (plan/template-purchase.md): every purchasable
 * template must be a wired mold — manifest registered, component mapped, page
 * data-tkey slots matching manifest text/media slots, and the purchaser brand
 * read from the overlay. Fails closed so an unwired or half-wired mold cannot
 * ship.
 */
const overlay = fs.readFileSync("src/lib/template-content/overlay.ts", "utf8");
const molds = fs.readFileSync("src/components/templates/molds.tsx", "utf8");
const failures = [];

const slugsBlock = overlay.match(/TEMPLATE_PURCHASE_SLUGS = \[([\s\S]*?)\] as const/);
if (!slugsBlock) {
  failures.push("registry: TEMPLATE_PURCHASE_SLUGS not found");
} else {
  const slugs = [...slugsBlock[1].matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
  const manifestEntries = new Map(
    [...overlay.matchAll(/^\s{2}([a-z0-9-]+): ([A-Z0-9]+)_MANIFEST,/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const moldEntries = new Set(
    [...molds.matchAll(/^\s{2}([a-z0-9-]+): lazy\(/gm)].map((match) => match[1]),
  );
  const componentBySlug = Object.fromEntries(
    [
      ...molds.matchAll(
        /^\s{2}([a-z0-9-]+): lazy\(\(\) =>\s*\n?\s*import\("\.\/([A-Za-z0-9]+)"\)/gm,
      ),
    ].map((match) => [match[1], `src/components/templates/${match[2]}.tsx`]),
  );

  for (const slug of slugs) {
    const manifestConst = manifestEntries.get(slug);
    if (!manifestConst) {
      failures.push(`${slug}: no manifest registered in TEMPLATE_MANIFESTS (unwired mold)`);
      continue;
    }
    if (!moldEntries.has(slug)) {
      failures.push(`${slug}: no component entry in MOLD_COMPONENTS`);
      continue;
    }
    const manifestImport = [
      ...overlay.matchAll(/import \{ ([A-Z0-9_]+)_MANIFEST \} from "\.\/([a-z0-9-]+)"/g),
    ].find((match) => match[1] === manifestConst);
    const manifestPath = manifestImport ? `src/lib/template-content/${manifestImport[2]}.ts` : null;
    const componentPath = componentBySlug[slug];
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      failures.push(`${slug}: manifest module not found`);
      continue;
    }
    if (!componentPath || !fs.existsSync(componentPath)) {
      failures.push(`${slug}: component ${componentPath ?? "(unmapped)"} not found`);
      continue;
    }
    const manifestSource = fs.readFileSync(manifestPath, "utf8");
    const component = fs.readFileSync(componentPath, "utf8");

    const budgetsBlock = manifestSource.match(/textBudgets:\s*\{([\s\S]*?)\}/);
    if (!budgetsBlock) {
      failures.push(`${slug}: manifest has no textBudgets`);
      continue;
    }
    const textSlots = [...budgetsBlock[1].matchAll(/^\s+([A-Za-z0-9]+): \d+/gm)].map(
      (match) => match[1],
    );
    if (textSlots.length === 0) failures.push(`${slug}: manifest declares no text slots`);
    const mediaBlock = manifestSource.match(/mediaSlots:\s*\[([\s\S]*?)\]/);
    const mediaSlots = mediaBlock
      ? [...mediaBlock[1].matchAll(/"([A-Za-z0-9]+)"/g)].map((match) => match[1])
      : [];

    const staticKeys = new Set(
      [
        ...component.matchAll(/data-tkey="([a-z]+\.[A-Za-z0-9]+)"/g),
        ...component.matchAll(/\btkey="([a-z]+\.[A-Za-z0-9]+)"/g),
        ...component.matchAll(/\bposterTkey="([a-z]+\.[A-Za-z0-9]+)"/g),
      ].map((match) => match[1]),
    );
    const dynamicPrefixes = [
      ...component.matchAll(/data-tkey=\{`([a-z]+\.[A-Za-z0-9]+)\$\{/g),
      ...component.matchAll(/\btkey=\{`([a-z]+\.[A-Za-z0-9]+)\$\{/g),
      ...component.matchAll(/posterTkey=\{`([a-z]+\.[A-Za-z0-9]+)\$\{/g),
    ].map((match) => match[1]);
    const tkeyCovered = (kind, key) =>
      staticKeys.has(`${kind}.${key}`) ||
      dynamicPrefixes.some(
        (prefix) => prefix.startsWith(`${kind}.`) && key.startsWith(prefix.slice(kind.length + 1)),
      );
    // A text slot must be read by the component (statically or via a dynamic
    // key); data-tkey coverage is best-effort where the DOM structure allows it.
    const textReads = new Set(
      [...component.matchAll(/text\?\s*\.\s*([A-Za-z0-9]+)/g)].map((match) => match[1]),
    );
    const dynamicReads = [
      ...component.matchAll(/text\?\s*\.\s*\[\s*`([A-Za-z0-9]+)\$\{[^`]*?([A-Za-z0-9]*)`/g),
    ].map((match) => [match[1], match[2]]);
    const textRead = (key) =>
      textReads.has(key) ||
      dynamicReads.some(([prefix, suffix]) => key.startsWith(prefix) && key.endsWith(suffix));

    for (const key of textSlots) {
      if (!textRead(key))
        failures.push(`${slug}: manifest text slot "${key}" is never read by the component`);
    }
    for (const key of mediaSlots) {
      if (!tkeyCovered("media", key))
        failures.push(`${slug}: manifest media slot "${key}" is not rendered with data-tkey`);
    }
    for (const key of staticKeys) {
      const [kind, name] = key.split(".");
      if (kind === "text" && !textSlots.includes(name))
        failures.push(`${slug}: component renders data-tkey="${key}" with no manifest text slot`);
      if (kind === "media" && !mediaSlots.includes(name))
        failures.push(`${slug}: component renders data-tkey="${key}" with no manifest media slot`);
    }
    if (!/content\?\.businessName/.test(component))
      failures.push(`${slug}: component never reads the overlay business name (demo brand stays)`);
    if (!/content\?\.text/.test(component))
      failures.push(`${slug}: component never reads overlay text slots`);

    const lockedImageKeys = new Set([
      "heroMotion",
      "heroVideo",
      "video",
      "before",
      "after",
      "proofBefore",
      "proofAfter",
      "projectBefore",
      "projectAfter",
    ]);
    for (const match of component.matchAll(/\bsrc=\{IMAGE\.([A-Za-z0-9]+)\}/g)) {
      if (!lockedImageKeys.has(match[1])) {
        failures.push(
          `${slug}: replaceable still IMAGE.${match[1]} is hardcoded (no overlay media slot)`,
        );
      }
    }
    if (/src=\{IMAGE\.guides\[/.test(component)) {
      failures.push(`${slug}: replaceable guide stills are hardcoded (no overlay media slot)`);
    }
    if (/src=\{processImages\[/.test(component)) {
      failures.push(`${slug}: process stills are hardcoded (no overlay media slot)`);
    }
    if (/src=\{visibleScheme\.image\}/.test(component)) {
      failures.push(`${slug}: scheme stills are hardcoded (no overlay media slot)`);
    }
    for (const name of ["service", "surface", "step", "chapter"]) {
      const raw = new RegExp(String.raw`src=\{${name}\.image\}`);
      const wrapped = new RegExp(String.raw`overlayMediaUrl\([\s\S]*?${name}\.image`);
      if (raw.test(component) && !wrapped.test(component)) {
        failures.push(`${slug}: ${name} stills are hardcoded (no overlay media slot)`);
      }
    }
  }
}

if (failures.length) {
  console.error("verify-template-manifest-parity: FAILED");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}
console.log("verify-template-manifest-parity: ok");
