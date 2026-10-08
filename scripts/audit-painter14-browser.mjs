import { chromium } from "/Users/shr/obra-tech/node_modules/@playwright/test/index.mjs";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const origin = process.env.P14_AUDIT_ORIGIN ?? "http://127.0.0.1:4177";
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
  await page.goto(`${origin}/templates/painter14`, { waitUntil: "networkidle" });
  return { context, page, errors };
}

async function loadAllImages(page) {
  const images = page.locator(".p14 img");
  for (let index = 0; index < (await images.count()); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((element) => {
      if (element instanceof HTMLImageElement) return element.decode().catch(() => undefined);
      return undefined;
    });
  }
}

function layout(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".p14");
    const hero = document.querySelector(".p14-hero");
    const heroFilm = document.querySelector(".p14-hero-film");
    const heroCopy = document.querySelector(".p14-hero-copy");
    const video = document.querySelector(".p14-hero video");
    const pov = document.querySelector(".p14-pov");
    const povMain = document.querySelector(".p14-pov-main");
    const povCopy = document.querySelector(".p14-pov-copy");
    const processImage = document.querySelector(".p14-process-image");
    const processBody = document.querySelector(".p14-process-body");
    const estimateImage = document.querySelector(".p14-estimate-image");
    const estimateCopy = document.querySelector(".p14-estimate-copy");
    const headings = [...document.querySelectorAll(".p14 h1, .p14 h2, .p14 h3")];
    const controls = [...document.querySelectorAll(".p14 a, .p14 button, .p14 summary")].filter(
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
    const images = [...document.querySelectorAll(".p14 img")];
    const rootWidth = root?.clientWidth ?? 0;
    const duplicateIds = [...document.querySelectorAll("[id]")]
      .map((element) => element.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    const missingAnchors = [...document.querySelectorAll('.p14 a[href^="#"]')]
      .map((link) => link.getAttribute("href"))
      .filter((href) => href && !document.querySelector(href));
    const imageTextOverlays = [
      ...document.querySelectorAll(".p14-service figcaption, .p14-proof-pair figcaption"),
    ].every((caption) => getComputedStyle(caption).backgroundColor !== "rgba(0, 0, 0, 0)");
    const visibleText = [
      ...document.querySelectorAll(".p14 p, .p14 a, .p14 button, .p14 summary, .p14 figcaption"),
    ]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.display !== "none";
      })
      .map((element) => parseFloat(getComputedStyle(element).fontSize));

    return {
      rootOverflow: root ? root.scrollWidth > root.clientWidth + 1 : true,
      descendantsOverflow: [...document.querySelectorAll(".p14 *")]
        .filter((element) => element.scrollWidth > element.clientWidth + 2)
        .map((element) => element.className || element.tagName),
      heroHeight: hero?.getBoundingClientRect().height ?? 0,
      filmHeight: heroFilm?.getBoundingClientRect().height ?? 0,
      copyTop: heroCopy?.getBoundingClientRect().top ?? 0,
      filmTop: heroFilm?.getBoundingClientRect().top ?? 0,
      heroOverlay: heroFilm ? getComputedStyle(heroFilm, "::after").backgroundImage : "",
      heroCopyColor: heroCopy ? getComputedStyle(heroCopy).color : "",
      videoDuration: video instanceof HTMLVideoElement ? video.duration : 0,
      videoAdvanced: video instanceof HTMLVideoElement ? video.currentTime > 0 : false,
      povMainTop: povMain?.getBoundingClientRect().top ?? 0,
      povCopyTop: povCopy?.getBoundingClientRect().top ?? 0,
      povAreas: pov ? getComputedStyle(pov).gridTemplateColumns : "",
      processImageTop: processImage?.getBoundingClientRect().top ?? 0,
      processBodyTop: processBody?.getBoundingClientRect().top ?? 0,
      estimateImageTop: estimateImage?.getBoundingClientRect().top ?? 0,
      estimateCopyTop: estimateCopy?.getBoundingClientRect().top ?? 0,
      imageTextOverlays,
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
await page.locator(".p14").waitFor();
await page.locator(".p14 img").last().waitFor();
await page.waitForTimeout(700);
await loadAllImages(page);
const desktopLayout = await layout(page);
assert(!desktopLayout.rootOverflow, "desktop P14 root has horizontal overflow");
assert(
  desktopLayout.descendantsOverflow.length === 0,
  `desktop P14 descendants overflow: ${desktopLayout.descendantsOverflow.join(", ")}`,
);
assert(desktopLayout.heroHeight >= 640, "desktop P14 hero is unexpectedly short");
assert(
  desktopLayout.heroOverlay.includes("linear-gradient"),
  "desktop hero lacks a deterministic contrast overlay",
);
assert(
  desktopLayout.heroCopyColor === "rgb(255, 253, 246)",
  "desktop hero copy lacks high-contrast light text",
);
assert(
  desktopLayout.processImageTop === desktopLayout.processBodyTop,
  "desktop process is not a visual image/copy split",
);
assert(
  desktopLayout.estimateImageTop === desktopLayout.estimateCopyTop,
  "desktop estimate is not a visual image/copy split",
);
assert(desktopLayout.imageTextOverlays, "desktop image-card labels lack contrast overlays");
assert(desktopLayout.smallestVisibleText >= 12, "desktop P14 retains sub-12px visible text");
assert(desktopLayout.headingsFit, "desktop P14 heading is clipped or outside the viewport");
assert(desktopLayout.controlsSized, "desktop P14 contains an undersized action target");
assert(desktopLayout.duplicateIds.length === 0, "desktop P14 contains duplicate IDs");
assert(desktopLayout.missingAnchors.length === 0, "desktop P14 contains broken in-page anchors");
assert(
  desktopLayout.videoDuration >= 5 && desktopLayout.videoDuration <= 7,
  "P14 hero film is not 5-7 seconds",
);
assert(desktopLayout.videoAdvanced, "P14 hero film did not advance when motion is allowed");
assert(
  desktopLayout.images.every((image) => image.complete && image.width > 0),
  "one or more desktop P14 images did not decode",
);
const purchaseButton = page.locator("aside[aria-label='Template purchase'] button");
assert((await purchaseButton.count()) > 0, "P14 template purchase CTA is missing");
if (!(await purchaseButton.first().isDisabled())) {
  assert(
    await page.getByRole("button", { name: /Use this template/ }).isVisible(),
    "P14 purchase CTA does not present the template purchase",
  );
} else {
  assert(
    await page
      .getByRole("button", { name: "New purchases are temporarily unavailable" })
      .isVisible(),
    "unavailable P14 purchase CTA does not state its disabled condition",
  );
}
assert((await page.locator(".p14-blend").count()) === 0, "P14 retained the removed blend section");
assert(
  (await page.locator(".p14-flavor-bar").count()) === 0,
  "P14 retained the removed top metadata strip",
);
assert(
  (await page.locator(".p14 [style*='monospace']").count()) === 0,
  "P14 retains monospace inline typography",
);
assert(
  (await page.locator(".p14-pov-chip").count()) === 0,
  "P14 retained the removed point-of-view overlap media",
);

await page.getByRole("button", { name: "Read the field note" }).first().click();
assert(
  await page.getByText("Make the sample movable").isVisible(),
  "P14 field-note dialog did not open",
);
await page.keyboard.press("Escape");
assert(
  !(await page.getByText("Make the sample movable").isVisible()),
  "P14 field-note dialog did not close",
);
await page.getByRole("button", { name: "Plan a color visit" }).first().click();
assert(
  await page.getByRole("heading", { name: "Select a time" }).isVisible(),
  "P14 booking walkthrough did not open",
);
await page.keyboard.press("Escape");

const tablet = await open({ width: 768, height: 900 });
await loadAllImages(tablet.page);
const tabletLayout = await layout(tablet.page);
assert(!tabletLayout.rootOverflow, "tablet P14 root has horizontal overflow");
assert(
  tabletLayout.descendantsOverflow.length === 0,
  `tablet P14 descendants overflow: ${tabletLayout.descendantsOverflow.join(", ")}`,
);
assert(tabletLayout.headingsFit, "tablet P14 heading is clipped or outside the viewport");
assert(tabletLayout.controlsSized, "tablet P14 contains an undersized action target");
assert(tabletLayout.smallestVisibleText >= 12, "tablet P14 retains sub-12px visible text");

const mobile = await open({ width: 390, height: 844 });
await loadAllImages(mobile.page);
const mobileLayout = await layout(mobile.page);
assert(!mobileLayout.rootOverflow, "mobile P14 root has horizontal overflow");
assert(
  mobileLayout.descendantsOverflow.length === 0,
  `mobile P14 descendants overflow: ${mobileLayout.descendantsOverflow.join(", ")}`,
);
assert(
  mobileLayout.filmHeight >= 300,
  "mobile P14 first fold does not preserve substantial hero film",
);
assert(
  mobileLayout.copyTop >= mobileLayout.filmTop + mobileLayout.filmHeight - 1,
  "mobile P14 hero copy obscures the film-first composition",
);
assert(
  mobileLayout.povMainTop < mobileLayout.povCopyTop,
  "mobile P14 point-of-view image and copy appear in the wrong order",
);
assert(
  mobileLayout.povCopyTop >= mobileLayout.povMainTop + 300,
  "mobile P14 point-of-view copy overlaps the primary image",
);
assert(
  mobileLayout.processImageTop < mobileLayout.processBodyTop &&
    mobileLayout.estimateImageTop < mobileLayout.estimateCopyTop,
  "mobile P14 image/copy splits do not stack in a readable order",
);
assert(mobileLayout.headingsFit, "mobile P14 heading is clipped or outside the viewport");
assert(mobileLayout.controlsSized, "mobile P14 contains an undersized action target");
assert(mobileLayout.smallestVisibleText >= 12, "mobile P14 retains sub-12px visible text");
assert(
  (await mobile.page.locator(".p14-header nav a:visible").count()) === 3,
  "mobile P14 header does not preserve all primary navigation destinations",
);
assert(
  await mobile.page.getByRole("link", { name: "Call True Coat at (555) 013-7482" }).isVisible(),
  "mobile P14 phone link has no accessible name",
);

const reduced = await open({ width: 390, height: 844 }, "reduce");
const reducedState = await reduced.page.evaluate(() => {
  const video = document.querySelector(".p14-hero video");
  const poster = document.querySelector(".p14-hero img");
  return {
    paused: video instanceof HTMLVideoElement ? video.paused : true,
    posterReady: poster instanceof HTMLImageElement && poster.complete && poster.naturalWidth > 0,
  };
});
assert(reducedState.paused, "reduced-motion P14 hero video is playing");
assert(reducedState.posterReady, "reduced-motion P14 hero poster is unavailable");

for (const { context, errors } of [desktop, tablet, mobile, reduced]) {
  assert(errors.length === 0, `browser console errors: ${errors.join(" | ")}`);
  await context.close();
}
await browser.close();

if (failures.length) {
  throw new Error(`Painter 14 browser audit failed:\n- ${failures.join("\n- ")}`);
}

console.log("Painter 14 browser audit passed.");
