import { chromium } from "/Users/shr/obra-tech/node_modules/@playwright/test/index.mjs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const origin = process.env.P15_AUDIT_ORIGIN ?? "http://127.0.0.1:4177";
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
  await page.goto(`${origin}/templates/painter15`, { waitUntil: "networkidle" });
  return { context, page, errors };
}

async function loadAllImages(page) {
  const images = page.locator(".p15 img:visible");
  for (let index = 0; index < (await images.count()); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => {
      if (element instanceof HTMLImageElement) return element.decode().catch(() => undefined);
      return undefined;
    });
  }
}

function geometry(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".p15");
    const hero = document.querySelector(".p15-hero");
    const heroFilm = document.querySelector(".p15-hero-film");
    const heroCopy = document.querySelector(".p15-hero-copy");
    const estimateCard = document.querySelector(".p15-estimate-card");
    const video = document.querySelector(".p15-hero video");
    const processImage = document.querySelector(".p15-process-visual");
    const processCopy = document.querySelector(".p15-process-copy");
    const faqImage = document.querySelector(".p15-faq-image");
    const faqCopy = document.querySelector(".p15-faq-copy");
    const planningStage = document.querySelector(".p15-planning-stage");
    const planningGrid = document.querySelector(".p15-planning-grid");
    const headings = [...document.querySelectorAll(".p15 h1, .p15 h2, .p15 h3")];
    const controls = [...document.querySelectorAll(".p15 a, .p15 button, .p15 summary")].filter(
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
    const images = [...document.querySelectorAll(".p15 img")];
    const rootWidth = root?.clientWidth ?? 0;
    const duplicateIds = [...document.querySelectorAll("[id]")]
      .map((element) => element.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    const missingAnchors = [...document.querySelectorAll('.p15 a[href^="#"]')]
      .map((link) => link.getAttribute("href"))
      .filter((href) => href && !document.querySelector(href));
    const visibleText = [
      ...document.querySelectorAll(".p15 p, .p15 a, .p15 button, .p15 summary, .p15 figcaption"),
    ]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none";
      })
      .map((element) => parseFloat(getComputedStyle(element).fontSize));
    const overlayCaptions = [
      ...document.querySelectorAll(
        ".p15-service-card figcaption, .p15-proof-arches figcaption, .p15-faq-image figcaption",
      ),
    ].every((caption) => getComputedStyle(caption).backgroundColor !== "rgba(0, 0, 0, 0)");
    return {
      rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : true,
      descendantsOverflow: [...document.querySelectorAll(".p15 *")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.overflowX === "visible" &&
            element.scrollWidth > element.clientWidth + 2 &&
            element.getBoundingClientRect().right > rootWidth + 1
          );
        })
        .map((element) => element.className || element.tagName),
      heroHeight: hero?.getBoundingClientRect().height ?? 0,
      filmHeight: heroFilm?.getBoundingClientRect().height ?? 0,
      copyTop: heroCopy?.getBoundingClientRect().top ?? 0,
      filmTop: heroFilm?.getBoundingClientRect().top ?? 0,
      copyBackground: heroCopy ? getComputedStyle(heroCopy).backgroundImage : "",
      heroCopyColor: heroCopy ? getComputedStyle(heroCopy).color : "",
      estimateBackground: estimateCard ? getComputedStyle(estimateCard).backgroundColor : "",
      estimateColor: estimateCard ? getComputedStyle(estimateCard).color : "",
      videoDuration: video instanceof HTMLVideoElement ? video.duration : 0,
      videoAdvanced: video instanceof HTMLVideoElement ? video.currentTime > 0 : false,
      processImageTop: processImage?.getBoundingClientRect().top ?? 0,
      processCopyTop: processCopy?.getBoundingClientRect().top ?? 0,
      faqImageTop: faqImage?.getBoundingClientRect().top ?? 0,
      faqCopyTop: faqCopy?.getBoundingClientRect().top ?? 0,
      planningStageWidth: planningStage?.getBoundingClientRect().width ?? 0,
      planningGridWidth: planningGrid?.getBoundingClientRect().width ?? 0,
      overlayCaptions,
      smallestVisibleText: Math.min(...visibleText),
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
      images: images.map((image) => ({ complete: image.complete, width: image.naturalWidth })),
      duplicateIds,
      missingAnchors,
    };
  });
}

const desktop = await open({ width: 1440, height: 900 });
const { page } = desktop;
await page.locator(".p15").waitFor();
await page.locator(".p15 img").last().waitFor();
await page.waitForTimeout(700);
await loadAllImages(page);
let desktopGeometry = await geometry(page);
assert(!desktopGeometry.rootOverflow, "desktop P15 root has horizontal overflow");
assert(
  desktopGeometry.descendantsOverflow.length === 0,
  `desktop P15 descendants overflow: ${desktopGeometry.descendantsOverflow.join(", ")}`,
);
assert(desktopGeometry.heroHeight >= 640, "desktop P15 hero is unexpectedly short");
assert(
  desktopGeometry.copyBackground.includes("linear-gradient"),
  "desktop P15 hero copy lacks its deterministic tile contrast surface",
);
assert(
  desktopGeometry.heroCopyColor === "rgb(248, 240, 223)",
  "desktop P15 hero copy lacks its intended high-contrast ivory foreground",
);
assert(
  desktopGeometry.estimateBackground !== "rgb(248, 240, 223)" &&
    desktopGeometry.estimateColor === "rgb(248, 240, 223)",
  "desktop P15 estimate panel loses contrast against its image stage",
);
assert(
  desktopGeometry.planningGridWidth > desktopGeometry.planningStageWidth * 0.5,
  "desktop P15 planning cards occupy the wrong narrow image column",
);
assert(
  desktopGeometry.processImageTop <= desktopGeometry.processCopyTop,
  "desktop P15 process image does not establish the full-bleed evidence stage",
);
assert(
  desktopGeometry.faqImageTop <= desktopGeometry.faqCopyTop,
  "desktop P15 FAQ image does not establish the full-bleed evidence stage",
);
assert(
  desktopGeometry.overlayCaptions,
  "desktop P15 image labels lack deterministic contrast panels",
);
assert(desktopGeometry.smallestVisibleText >= 12, "desktop P15 contains sub-12px visible text");
assert(desktopGeometry.headingsFit, "desktop P15 heading is clipped or outside the viewport");
assert(desktopGeometry.controlsSized, "desktop P15 contains an undersized action target");
assert(desktopGeometry.duplicateIds.length === 0, "desktop P15 contains duplicate IDs");
assert(desktopGeometry.missingAnchors.length === 0, "desktop P15 contains broken in-page anchors");
assert(
  desktopGeometry.videoDuration >= 5 && desktopGeometry.videoDuration <= 7,
  "P15 hero film is not 5-7 seconds",
);
assert(desktopGeometry.videoAdvanced, "P15 hero film did not advance when motion is allowed");
assert(
  desktopGeometry.images.every((image) => image.complete && image.width > 0),
  "one or more desktop P15 images did not decode",
);

assert(
  (await page.locator(".p15-builder").count()) === 0,
  "P15 retained the removed Mosaic Builder",
);

await page.getByRole("button", { name: "Read the field note" }).first().click();
assert(
  await page.getByText("Make the sample movable").isVisible(),
  "P15 field-note dialog did not open",
);
await page.keyboard.press("Escape");

const catalog = await open({ width: 1440, height: 900 });
await catalog.page.goto(`${origin}/templates`, { waitUntil: "networkidle" });
const catalogCard = catalog.page.getByRole("link", {
  name: "Open Moroccan Zellige, a painter website template",
});
assert(await catalogCard.isVisible(), "Painter 15 catalog card is not visible on /templates");
assert(
  await catalogCard.getByText("painter", { exact: true }).isVisible(),
  "Painter 15 catalog card is missing its painter chip",
);
await catalogCard.locator("img").evaluate((element) => {
  if (element instanceof HTMLImageElement) return element.decode();
  return undefined;
});
assert(
  !(await page.getByText("Make the sample movable").isVisible()),
  "P15 field-note dialog did not close",
);
await page.getByRole("button", { name: "Plan a color visit" }).first().click();
assert(
  await page.getByRole("heading", { name: "Select a time" }).isVisible(),
  "P15 booking walkthrough did not open",
);
await page.keyboard.press("Escape");

const tablet = await open({ width: 768, height: 900 });
await loadAllImages(tablet.page);
const tabletGeometry = await geometry(tablet.page);
assert(!tabletGeometry.rootOverflow, "tablet P15 root has horizontal overflow");
assert(
  tabletGeometry.descendantsOverflow.length === 0,
  `tablet P15 descendants overflow: ${tabletGeometry.descendantsOverflow.join(", ")}`,
);
assert(tabletGeometry.headingsFit, "tablet P15 heading is clipped or outside the viewport");
assert(tabletGeometry.controlsSized, "tablet P15 contains an undersized action target");
assert(tabletGeometry.smallestVisibleText >= 12, "tablet P15 contains sub-12px visible text");

const mobile = await open({ width: 390, height: 844 });
await loadAllImages(mobile.page);
const mobileGeometry = await geometry(mobile.page);
assert(!mobileGeometry.rootOverflow, "mobile P15 root has horizontal overflow");
assert(
  mobileGeometry.descendantsOverflow.length === 0,
  `mobile P15 descendants overflow: ${mobileGeometry.descendantsOverflow.join(", ")}`,
);
assert(
  mobileGeometry.filmHeight >= 300,
  "mobile P15 first fold does not preserve substantial hero film",
);
assert(
  mobileGeometry.copyTop >= mobileGeometry.filmTop + mobileGeometry.filmHeight - 1,
  "mobile P15 hero copy obscures the film-first composition",
);
assert(
  mobileGeometry.processImageTop < mobileGeometry.processCopyTop &&
    mobileGeometry.faqImageTop < mobileGeometry.faqCopyTop,
  "mobile P15 image stages and information panels do not stack in a readable order",
);
assert(mobileGeometry.headingsFit, "mobile P15 heading is clipped or outside the viewport");
assert(mobileGeometry.controlsSized, "mobile P15 contains an undersized action target");
assert(mobileGeometry.smallestVisibleText >= 12, "mobile P15 contains sub-12px visible text");
assert(
  (await mobile.page.locator(".p15-header nav a:visible").count()) === 3,
  "mobile P15 header does not preserve all primary navigation destinations",
);
assert(
  await mobile.page.getByRole("link", { name: "Call True Coat at (555) 013-7482" }).isVisible(),
  "mobile P15 phone link has no accessible name",
);

const reduced = await open({ width: 390, height: 844 }, "reduce");
const reducedState = await reduced.page.evaluate(() => {
  const video = document.querySelector(".p15-hero video");
  const poster = document.querySelector(".p15-hero img");
  return {
    paused: video instanceof HTMLVideoElement ? video.paused : true,
    posterReady: poster instanceof HTMLImageElement && poster.complete && poster.naturalWidth > 0,
  };
});
assert(reducedState.paused, "reduced-motion P15 hero video is playing");
assert(reducedState.posterReady, "reduced-motion P15 hero poster is unavailable");

for (const { context, errors } of [desktop, tablet, mobile, reduced, catalog]) {
  assert(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);
  await context.close();
}
await browser.close();

if (failures.length) {
  throw new Error(`Painter 15 browser audit failed:\n- ${failures.join("\n- ")}`);
}

console.log("Painter 15 browser audit passed.");
