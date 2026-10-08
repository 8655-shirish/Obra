import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { decode } from "fast-png";

const origin = process.env.P18_AUDIT_ORIGIN ?? "http://127.0.0.1:4177";
const output = process.env.P18_AUDIT_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const chrome =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const forbidden =
  /\b(?:demo|dummy|fictional|sample offering|sample review|AI-generated|generated illustrative|replace before publishing|555|example\.com|testimonials?)\b/i;
const reports = [];

async function readyImages(page, selector = ".lv img:visible") {
  for (const image of await page.locator(selector).all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((node) => node.decode());
    assert(
      await image.evaluate((node) => node.complete && node.naturalWidth > 0),
      "Photograph failed to decode",
    );
  }
}

async function closeDialog(page, trigger) {
  const dialog = page.getByRole("dialog");
  const bounds = await dialog.boundingBox();
  assert(bounds && bounds.x >= 0 && bounds.y >= 0, "Dialog leaves the screen");
  assert(bounds.x + bounds.width <= page.viewportSize().width + 1);
  assert(bounds.y + bounds.height <= page.viewportSize().height + 1);
  assert(!forbidden.test(await dialog.innerText()), "Dialog contains unfinished copy");
  assert(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    "Dialog has horizontal overflow",
  );
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  const target = await close.boundingBox();
  assert(target.width >= 44 && target.height >= 44, "Dialog close target is too small");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    assert(
      await dialog.evaluate((node) => node.contains(document.activeElement)),
      "Focus escaped the modal",
    );
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(
    await trigger.evaluate((node) => node === document.activeElement),
    "Dialog focus did not return",
  );
}

async function heroContrast(page) {
  const lines = await page.locator(".lv-hero-copy").evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const lines = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      const style = getComputedStyle(node.parentElement);
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects())
        lines.push({
          text: node.textContent.trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          color: style.color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number),
          minimum: parseFloat(style.fontSize) >= 24 ? 3 : 4.5,
        });
    }
    return lines;
  });
  const invisible = await page.addStyleTag({
    content:
      ".lv-hero-copy,.lv-hero-copy *{color:transparent!important;text-shadow:none!important}.lv-hero-copy svg{visibility:hidden!important}",
  });
  const film = page.locator(".lv-hero-film");
  const luminance = (rgb) => {
    const linear = rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  for (const time of [0, 2, 5.5]) {
    await film.evaluate(async (video, time) => {
      video.pause();
      if (Math.abs(video.currentTime - time) > 0.01)
        await new Promise((resolve) => {
          video.addEventListener("seeked", resolve, { once: true });
          video.currentTime = time;
        });
    }, time);
    const image = decode(await page.screenshot());
    for (const line of lines) {
      assert(
        line.y >= 0 && line.y + line.height < image.height - 50,
        "First-fold copy overlaps the purchase dock",
      );
      const foreground = luminance(line.color);
      let minimum = Infinity;
      for (let y = Math.ceil(line.y + 3); y < line.y + line.height - 3; y += 3) {
        for (let x = Math.ceil(line.x); x < line.x + line.width; x += 3) {
          const offset = (y * image.width + x) * image.channels;
          const background = luminance([...image.data.subarray(offset, offset + 3)]);
          minimum = Math.min(
            minimum,
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
          );
        }
      }
      assert(
        minimum >= line.minimum,
        `${page.viewportSize().width}px / frame ${time}s: contrast ${minimum.toFixed(2)} for "${line.text}"`,
      );
    }
  }
  await invisible.evaluate((element) => element.remove());
  await film.evaluate((video) => video.play());
}

try {
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${origin}/templates/painter18`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator(".lv h1").count(), 1);
    assert(!forbidden.test(await page.locator(".lv").innerText()), "Unfinished visible copy");
    assert.equal(await page.locator(".lv img[src$='.svg'], .lv .lv-room-scene").count(), 0);
    await page.waitForFunction(() => {
      const film = document.querySelector(".lv-hero-film");
      return (
        film instanceof HTMLVideoElement &&
        film.readyState >= 2 &&
        !film.paused &&
        film.currentTime > 0.15
      );
    });
    const heroFilm = page.locator(".lv-hero-film");
    const film = await heroFilm.evaluate((node) => ({
      duration: node.duration,
      muted: node.muted,
      loop: node.loop,
      inline: node.playsInline,
      controls: node.controls,
      frames: node.getVideoPlaybackQuality().totalVideoFrames,
    }));
    assert(
      film.duration >= 5 &&
        film.duration <= 7 &&
        film.muted &&
        film.loop &&
        film.inline &&
        !film.controls,
    );
    assert(film.frames > 1, "Film did not render actual frames");
    await heroContrast(page);
    if (output && [1440, 390].includes(width))
      await page.screenshot({ path: resolve(output, `${width}-hero.png`) });

    await readyImages(page);
    const geometry = await page.evaluate(() => {
      const root = document.querySelector(".lv");
      const rect = (element) => element.getBoundingClientRect();
      const area = (r) => r.width * r.height;
      const sections = [...root.querySelectorAll("[data-lv-section]")].map((section) => {
        const bounds = rect(section);
        const images = [...section.querySelectorAll("img")].filter(
          (image) => !image.closest(".lv-paper-layer"),
        );
        const visibleMedia = images.reduce((sum, image) => {
          const box = rect(image);
          const peel = image.closest(".lv-peel");
          const revealed = peel ? Number(peel.dataset.revealed) / 100 : 1;
          return sum + area(box) * revealed;
        }, 0);
        return {
          section: section.dataset.lvSection,
          height: Math.round(bounds.height),
          photoCoverage: visibleMedia / area(bounds),
          mediaCoverage: images.reduce((sum, image) => sum + area(rect(image)), 0) / area(bounds),
        };
      });
      const small = [...root.querySelectorAll("a, button, input")]
        .filter((element) => {
          const r = rect(element);
          return r.width > 0 && r.height > 0 && (r.width < 43.9 || r.height < 43.9);
        })
        .map((e) => e.textContent);
      const ids = [...root.querySelectorAll("[id]")].map((element) => element.id);
      const outside = [...root.querySelectorAll("h1, h2, h3, p, nav, button")]
        .filter((element) => {
          const r = rect(element);
          return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1);
        })
        .map((element) => element.className);
      const fonts = [...document.fonts]
        .filter((font) => font.family.startsWith("Lavender"))
        .map((font) => ({ family: font.family, status: font.status }));
      const anchors = [...root.querySelectorAll('a[href^="#"]')].every((link) =>
        document.querySelector(link.getAttribute("href")),
      );
      const tinyCopy = [...root.querySelectorAll("p, a, button, small")].filter(
        (e) => rect(e).height > 0 && parseFloat(getComputedStyle(e).fontSize) < 12,
      ).length;
      return {
        sections,
        small,
        outside,
        fonts,
        anchors,
        tinyCopy,
        duplicateIds: ids.length !== new Set(ids).size,
        overflow: root.scrollWidth > root.clientWidth + 1,
        heroPanel: getComputedStyle(root.querySelector(".lv-hero-copy")).backgroundColor,
      };
    });
    assert(!geometry.overflow && !geometry.duplicateIds && geometry.anchors && !geometry.tinyCopy);
    assert.equal(geometry.outside.length, 0, `Overflow at ${width}: ${geometry.outside}`);
    assert.equal(geometry.small.length, 0, `Small targets at ${width}: ${geometry.small}`);
    assert.equal(
      geometry.fonts.filter((font) => font.status === "loaded").length,
      3,
      "Designed typography did not load",
    );
    assert.equal(geometry.heroPanel, "rgba(0, 0, 0, 0)", "Opaque hero card returned");
    for (const section of geometry.sections) {
      // The wallpaper itself is a real material photograph; never count overlapping media twice.
      assert(
        section.mediaCoverage >= 0.695,
        `${width}/${section.section}: imagery collapsed to ${Math.round(section.mediaCoverage * 100)}%`,
      );
    }
    if (output && [1440, 390].includes(width))
      for (const section of await page.locator("[data-lv-section]").all()) {
        const name = await section.getAttribute("data-lv-section");
        if (name !== "hero")
          await section.screenshot({ path: resolve(output, `${width}-${name}.png`) });
      }

    const range = page.getByRole("slider", { name: "Uncover the room" });
    assert.equal(await range.inputValue(), "84", "Photography must be visible before interaction");
    await range.focus();
    await page.keyboard.press("End");
    assert.equal(await range.inputValue(), "100");
    await page.keyboard.press("Home");
    assert.equal(await range.inputValue(), "0");
    await range.fill("60");
    const peel = page.locator(".lv-peel");
    await peel.scrollIntoViewIfNeeded();
    const box = await peel.boundingBox();
    const before = await page.locator(".lv-peel-handle").boundingBox();
    await page.mouse.move(
      box.x + box.width * 0.6,
      Math.max(30, Math.min(300, box.y + box.height / 2)),
    );
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * 0.72,
      Math.max(30, Math.min(300, box.y + box.height / 2)),
      { steps: 8 },
    );
    await page.mouse.up();
    const after = await page.locator(".lv-peel-handle").boundingBox();
    assert(
      Number(await range.inputValue()) > 60 && after.x > before.x,
      "Dragging right must move the reveal boundary right",
    );

    for (const trigger of await page
      .locator(".lv-room-link, .lv-note, .lv-care-caption button")
      .all()) {
      await trigger.click();
      await readyImages(page, ".lv-dialog img");
      await closeDialog(page, trigger);
    }
    const planner = page.getByRole("button", { name: "Make my project list" });
    const requests = [];
    page.on("request", (request) => {
      if (request.method() === "POST") requests.push(request.url());
    });
    await planner.click();
    assert(await page.getByRole("button", { name: "Copy my list" }).isDisabled());
    await page.getByRole("checkbox").first().check();
    await page
      .getByRole("textbox", { name: "Anything particular to the room" })
      .fill("Retain existing timber trim.");
    await page.getByRole("button", { name: "Copy my list" }).click();
    await page.getByRole("status").filter({ hasText: "Copied." }).waitFor();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert(
      copied.includes("Rooms and surfaces") && copied.includes("Retain existing timber trim."),
    );
    assert.equal(requests.length, 0, "Local planner must not submit a homeowner request");
    await closeDialog(page, planner);
    const faq = page.getByRole("button", { name: "Questions before you begin" });
    await faq.click();
    for (const summary of await page.locator(".lv-faq-list summary").all()) {
      await summary.click();
      assert(await summary.evaluate((node) => node.parentElement.open));
    }
    await closeDialog(page, faq);
    assert.equal(errors.length, 0, `Browser errors at ${width}: ${errors.join(" | ")}`);
    reports.push({ width, ...geometry });
    console.log(
      `${width}px: media, typography, overflow, film, reveal, all reading dialogs, planner and FAQ passed`,
    );
    await context.close();
  }

  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    hasTouch: true,
    isMobile: true,
  });
  const page = await reduced.newPage();
  page.setDefaultTimeout(15000);
  const films = [];
  page.on("request", (request) => {
    if (request.url().endsWith(".mp4")) films.push(request.url());
  });
  await page.goto(`${origin}/templates/painter18`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".lv video").count(), 0);
  assert.equal(films.length, 0, "Reduced motion must not even fetch the film");
  await page.locator(".lv-hero img").evaluate((node) => node.decode());
  const peel = page.locator(".lv-peel");
  await peel.scrollIntoViewIfNeeded();
  const box = await peel.boundingBox();
  const cdp = await reduced.newCDPSession(page);
  const y = Math.max(40, Math.min(350, box.y + box.height / 2));
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width * 0.84, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: box.x + box.width * 0.65, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert(Number(await page.getByRole("slider").inputValue()) < 84, "Touch reveal did not move");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".lv video").waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".lv video").waitFor({ state: "detached" });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    });
  });
  const planner = page.getByRole("button", { name: "Make my project list" });
  await planner.click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Copy my list" }).click();
  await page.getByRole("textbox", { name: "Your list", exact: true }).waitFor();
  assert(
    (await page.getByRole("textbox", { name: "Your list", exact: true }).inputValue()).includes(
      "Rooms and surfaces",
    ),
  );
  await closeDialog(page, planner);
  await page.goto(`${origin}/templates`, { waitUntil: "networkidle" });
  const card = page.locator('a[href="/templates/painter18"]');
  assert.equal(await card.count(), 1);
  await card.scrollIntoViewIfNeeded();
  await card.locator("img").evaluate((node) => node.decode());
  await reduced.close();

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 664 },
    { width: 1440, height: 768 },
  ]) {
    const compact = await browser.newPage({ viewport });
    await compact.goto(`${origin}/templates/painter18`, { waitUntil: "networkidle" });
    await compact.waitForFunction(() => document.querySelector(".lv-hero-film")?.readyState >= 2);
    await heroContrast(compact);
    const cta = compact.locator(".lv-hero .lv-button");
    const bounds = await cta.boundingBox();
    const dock = await compact
      .getByRole("complementary", { name: "Template purchase" })
      .boundingBox();
    assert(
      bounds.y + bounds.height < dock.y,
      "Homeowner action is under the purchase dock or below the first fold",
    );
    const colours = await cta.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
    assert.equal(colours.color, "rgb(73, 52, 66)", "Pale-on-pale hero CTA regression");
    assert.equal(colours.background, "rgb(246, 237, 218)");
    await compact.close();
  }

  const purchase = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await purchase.goto(`${origin}/templates/painter18`, { waitUntil: "networkidle" });
  const buy = purchase
    .getByRole("complementary", { name: "Template purchase" })
    .getByRole("button");
  if (await buy.isEnabled()) {
    await buy.click();
    await purchase.getByRole("heading", { name: "Choose a plan" }).waitFor();
    await purchase.getByRole("button", { name: /Starter/ }).click();
    for (const label of ["Email", "License number", "Business name", "Full name", "City"])
      assert.equal(await purchase.getByLabel(label, { exact: true }).inputValue(), "");
    assert(
      await purchase.getByRole("button", { name: "Continue to payment" }).isDisabled(),
      "Legal consent must still gate checkout",
    );
    await purchase.keyboard.press("Escape");
  } else {
    assert(
      (await buy.innerText()).includes("temporarily unavailable"),
      "Do not bypass the existing purchase availability gate",
    );
  }
  await purchase.close();
  if (output) writeFileSync(resolve(output, "geometry.json"), JSON.stringify(reports, null, 2));
  console.log(
    "P18 browser contract passed. These checks do not constitute pixel-level visual approval.",
  );
} finally {
  await browser.close();
}
