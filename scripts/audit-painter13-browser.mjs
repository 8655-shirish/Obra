import { chromium } from "/Users/shr/obra-tech/node_modules/@playwright/test/index.mjs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const origin = process.env.P13_AUDIT_ORIGIN ?? "http://127.0.0.1:4177";
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function open(viewport, reducedMotion = "no-preference") {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/templates/painter13`, { waitUntil: "networkidle" });
  return { context, page, errors };
}

async function loadAllImages(page) {
  const images = page.locator(".p13 img");
  for (let index = 0; index < (await images.count()); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => {
      if (element instanceof HTMLImageElement) return element.decode().catch(() => undefined);
      return undefined;
    });
  }
}

function auditLayout(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".p13");
    const hero = document.querySelector(".p13-hero");
    const heroFilm = document.querySelector(".p13-hero-film");
    const heroCopy = document.querySelector(".p13-hero-copy");
    const video = document.querySelector(".p13-hero video");
    const services = document.querySelector(".p13-service-grid");
    const headings = [...document.querySelectorAll(".p13 h1, .p13 h2, .p13 h3")];
    const controls = [...document.querySelectorAll(".p13 a, .p13 button, .p13 summary")].filter(
      (control) => {
        const style = getComputedStyle(control);
        const bounds = control.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      },
    );
    const images = [...document.querySelectorAll(".p13 img")];
    const rootWidth = root?.clientWidth ?? 0;
    const serviceLabelBackgrounds = [...document.querySelectorAll(".p13-service-label p")].map(
      (label) => getComputedStyle(label).backgroundColor,
    );
    const duplicateIds = [...document.querySelectorAll("[id]")]
      .map((element) => element.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    const missingAnchors = [...document.querySelectorAll('.p13 a[href^="#"]')]
      .map((link) => link.getAttribute("href"))
      .filter((href) => href && !document.querySelector(href));

    return {
      rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : true,
      descendantsOverflow: [...document.querySelectorAll(".p13 *")]
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .map((element) => element.className || element.tagName),
      heroHeight: hero?.getBoundingClientRect().height ?? 0,
      filmHeight: heroFilm?.getBoundingClientRect().height ?? 0,
      copyTop: heroCopy?.getBoundingClientRect().top ?? 0,
      filmTop: heroFilm?.getBoundingClientRect().top ?? 0,
      copyBackground: heroCopy ? getComputedStyle(heroCopy).backgroundColor : "",
      copyBorder: heroCopy ? getComputedStyle(heroCopy).borderTopWidth : "0px",
      videoDuration: video instanceof HTMLVideoElement ? video.duration : 0,
      videoAdvanced: video instanceof HTMLVideoElement ? video.currentTime > 0 : false,
      serviceColumns: services
        ? getComputedStyle(services).gridTemplateColumns.split(" ").length
        : 0,
      serviceLabelBackgrounds,
      headingsFit: headings.every((heading) => {
        const bounds = heading.getBoundingClientRect();
        return (
          bounds.left >= -1 &&
          bounds.right <= rootWidth + 1 &&
          bounds.width > 0 &&
          bounds.height > 0
        );
      }),
      controlsSized: controls.every((control) => {
        const bounds = control.getBoundingClientRect();
        return bounds.width >= 30 && bounds.height >= 30;
      }),
      images: images.map((image) => ({
        complete: image.complete,
        width: image.naturalWidth,
      })),
      duplicateIds,
      missingAnchors,
    };
  });
}

const desktop = await open({ width: 1440, height: 900 });
const { page } = desktop;
await page.locator(".p13").waitFor();
await page.locator(".p13 img").last().waitFor();
await page.waitForTimeout(700);
await loadAllImages(page);
const desktopGeometry = await auditLayout(page);
assert(!desktopGeometry.rootOverflow, "desktop P13 root has horizontal overflow");
assert(
  desktopGeometry.descendantsOverflow.length === 0,
  `desktop P13 descendants overflow: ${desktopGeometry.descendantsOverflow.join(", ")}`,
);
assert(desktopGeometry.heroHeight >= 640, "desktop P13 hero is unexpectedly short");
assert(
  desktopGeometry.copyBackground !== "rgba(0, 0, 0, 0)",
  "desktop hero copy lacks a contrast surface",
);
assert(desktopGeometry.copyBorder !== "0px", "desktop hero copy lacks visual separation from film");
assert(desktopGeometry.serviceColumns === 2, "desktop services are not a stable two-column grid");
assert(
  desktopGeometry.serviceLabelBackgrounds.every((background) => background !== "rgba(0, 0, 0, 0)"),
  "desktop service labels rely on image-dependent contrast",
);
assert(desktopGeometry.headingsFit, "desktop heading is clipped or outside the viewport");
assert(desktopGeometry.controlsSized, "desktop contains an undersized action target");
assert(desktopGeometry.duplicateIds.length === 0, "desktop contains duplicate IDs");
assert(desktopGeometry.missingAnchors.length === 0, "desktop contains broken in-page anchors");
assert(
  desktopGeometry.videoDuration >= 5 && desktopGeometry.videoDuration <= 7,
  "hero film is not 5-7 seconds",
);
assert(desktopGeometry.videoAdvanced, "hero film did not advance when motion is allowed");
assert(
  desktopGeometry.images.every((image) => image.complete && image.width > 0),
  "one or more desktop P13 images did not decode",
);

await page.getByRole("button", { name: "Read the field note" }).first().click();
assert(
  await page.getByText("Make the sample movable").isVisible(),
  "field-note dialog did not open",
);
await page.keyboard.press("Escape");
assert(
  !(await page.getByText("Make the sample movable").isVisible()),
  "field-note dialog did not close",
);

await page.getByRole("button", { name: "Plan a color visit" }).first().click();
assert(
  await page.getByRole("heading", { name: "Select a time" }).isVisible(),
  "booking walkthrough did not open",
);
await page.keyboard.press("Escape");

const mobile = await open({ width: 390, height: 844 });
await loadAllImages(mobile.page);
const mobileGeometry = await auditLayout(mobile.page);
assert(!mobileGeometry.rootOverflow, "mobile P13 root has horizontal overflow");
assert(
  mobileGeometry.descendantsOverflow.length === 0,
  `mobile P13 descendants overflow: ${mobileGeometry.descendantsOverflow.join(", ")}`,
);
assert(
  mobileGeometry.filmHeight >= 300,
  "mobile first fold does not preserve substantial hero film",
);
assert(
  mobileGeometry.copyTop >= mobileGeometry.filmTop + mobileGeometry.filmHeight - 1,
  "mobile hero copy obscures the film-first composition",
);
assert(
  mobileGeometry.serviceColumns === 1,
  "mobile services do not resolve to one readable column",
);
assert(
  mobileGeometry.serviceLabelBackgrounds.every((background) => background !== "rgba(0, 0, 0, 0)"),
  "mobile service labels rely on image-dependent contrast",
);
assert(mobileGeometry.headingsFit, "mobile heading is clipped or outside the viewport");
assert(mobileGeometry.controlsSized, "mobile contains an undersized action target");
assert(
  (await mobile.page.locator(".p13-header nav a:visible").count()) === 3,
  "mobile header does not preserve all primary navigation destinations",
);
assert(
  await mobile.page.getByRole("link", { name: "Call True Coat at (555) 013-7482" }).isVisible(),
  "mobile phone link has no accessible name",
);
assert(
  mobileGeometry.videoDuration >= 5 && mobileGeometry.videoDuration <= 7,
  "mobile hero film did not load",
);

const tablet = await open({ width: 768, height: 900 });
await loadAllImages(tablet.page);
const tabletGeometry = await auditLayout(tablet.page);
assert(!tabletGeometry.rootOverflow, "tablet P13 root has horizontal overflow");
assert(
  tabletGeometry.descendantsOverflow.length === 0,
  `tablet P13 descendants overflow: ${tabletGeometry.descendantsOverflow.join(", ")}`,
);
assert(
  tabletGeometry.copyTop >= tabletGeometry.filmTop + tabletGeometry.filmHeight - 1,
  "tablet uses the squeezed desktop hero instead of the stacked composition",
);
assert(
  tabletGeometry.serviceColumns === 1,
  "tablet services do not resolve to one readable column",
);
assert(
  tabletGeometry.serviceLabelBackgrounds.every((background) => background !== "rgba(0, 0, 0, 0)"),
  "tablet service labels rely on image-dependent contrast",
);
assert(tabletGeometry.headingsFit, "tablet heading is clipped or outside the viewport");
assert(tabletGeometry.controlsSized, "tablet contains an undersized action target");
assert(
  (await tablet.page.locator(".p13-header nav a:visible").count()) === 3,
  "tablet header does not preserve all primary navigation destinations",
);

const reduced = await open({ width: 390, height: 844 }, "reduce");
const reducedState = await reduced.page.evaluate(() => {
  const video = document.querySelector(".p13-hero video");
  const poster = document.querySelector(".p13-hero img");
  return {
    paused: video instanceof HTMLVideoElement ? video.paused : true,
    posterReady: poster instanceof HTMLImageElement && poster.complete && poster.naturalWidth > 0,
  };
});
assert(reducedState.paused, "reduced-motion hero video is playing");
assert(reducedState.posterReady, "reduced-motion hero poster is unavailable");

for (const { context, errors } of [desktop, mobile, tablet, reduced]) {
  assert(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);
  await context.close();
}
await browser.close();

if (failures.length) {
  throw new Error(`Painter 13 browser audit failed:\n- ${failures.join("\n- ")}`);
}

console.log("Painter 13 browser audit passed.");
