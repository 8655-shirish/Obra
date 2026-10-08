import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const origin = process.env.PAINTER_AUDIT_ORIGIN ?? "http://127.0.0.1:4216";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const forbidden =
  /(?:\b(?:dummy|demo|fictional|placeholder)\b|(?:i?llustrative|generated) (?:finish|paint|media|study)|replace.{0,60}(?:photograph|publish)|sample (?:review|offering)|example\.com|\(555\))/i;

async function tapClose(page, trigger) {
  const dialog = page.getByRole("dialog");
  await page.waitForTimeout(250);
  const scroll = dialog.locator(".pt-dialog-scroll");
  await scroll.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const state = await dialog.evaluate((node) => {
    const close = node.querySelector("button:last-child");
    const r = close.getBoundingClientRect();
    const viewport = window.visualViewport;
    const scroller = node.querySelector(".pt-dialog-scroll");
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return {
      x,
      y,
      width: r.width,
      height: r.height,
      visible:
        r.left >= viewport.offsetLeft &&
        r.top >= viewport.offsetTop &&
        r.right <= viewport.offsetLeft + viewport.width &&
        r.bottom <= viewport.offsetTop + viewport.height,
      hit: close.contains(document.elementFromPoint(x, y)),
      overflow: scroller.scrollWidth > scroller.clientWidth + 1,
      atEnd: Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 2,
    };
  });
  assert(
    state.visible && state.hit,
    `Close is inaccessible at article end: ${JSON.stringify(state)}`,
  );
  assert(state.width >= 43.9 && state.height >= 43.9 && !state.overflow && state.atEnd);
  assert(!forbidden.test(await dialog.innerText()), "Unfinished copy in a dialog");
  await page.touchscreen.tap(state.x, state.y);
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(
    (node) => node === document.activeElement,
    await trigger.elementHandle(),
  );
  assert(
    await trigger.evaluate((node) => node === document.activeElement),
    "Focus did not return to article",
  );
}

try {
  for (const n of [16, 17, 18]) {
    const route = readFileSync(`src/routes/templates.painter${n}.tsx`, "utf8");
    const registry = readFileSync("src/lib/template-content/overlay.ts", "utf8");
    assert(route.includes(`templateId="tpl_painter${n}"`) && !route.includes("prefill"));
    for (const entry of [
      `"painter${n}"`,
      `"tpl_painter${n}"`,
      `painter${n}: "tpl_painter${n}"`,
      `tpl_painter${n}: "painter${n}"`,
    ])
      assert(registry.includes(entry));
    const root = n === 18 ? ".lv" : `.p${n}`;
    const noteSelector =
      n === 18 ? ".lv-note, .lv-room-link, .lv-care-caption button" : "[data-painter-note]";
    const planSelector = n === 18 ? ".lv-planner-actions .lv-button" : "[data-painter-plan]";
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 844, height: 390 },
    ]) {
      const context = await browser.newContext({
        viewport,
        hasTouch: true,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/templates/painter${n}`, { waitUntil: "networkidle" });
      assert.equal(await page.locator(`${root} h1`).count(), 1);
      assert(!forbidden.test(await page.locator(root).innerText()));
      await page.waitForFunction((selector) => {
        const film = document.querySelector(`${selector} video`);
        return film && !film.paused && film.currentTime > 0;
      }, root);
      assert(
        await page
          .locator(`${root} video`)
          .evaluate(
            (film) =>
              film.muted &&
              film.loop &&
              film.playsInline &&
              film.duration >= 5 &&
              film.duration <= 7,
          ),
      );
      for (const image of await page.locator(`${root} img:visible`).all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((node) => node.decode());
      }
      const layout = await page.locator(root).evaluate((element) => ({
        overflow: element.scrollWidth > element.clientWidth + 1,
        outside: [...element.querySelectorAll("h1,h2,h3,p,button,a")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.width && !e.className.includes("skip") && (r.left < -1 || r.right > innerWidth + 1)
            );
          })
          .map((e) => e.className),
      }));
      assert(
        !layout.overflow && !layout.outside.length,
        `${n}/${viewport.width}: ${JSON.stringify(layout)}`,
      );
      for (const trigger of await page.locator(noteSelector).all()) {
        await trigger.tap();
        await tapClose(page, trigger);
      }
      const planner = page.locator(planSelector).first();
      await planner.tap();
      await page.getByRole("checkbox").first().check();
      await page.getByRole("button", { name: "Copy my list", exact: true }).tap();
      assert(
        (await page.evaluate(() => navigator.clipboard.readText())).includes(
          "Painting project notes",
        ),
      );
      for (const summary of await page.locator(".pt-dialog-scroll summary").all())
        await summary.tap();
      await tapClose(page, planner);
      if (n === 16) {
        for (const choice of await page.locator("[data-painter-surface]").all()) {
          await choice.tap();
          assert.equal(await choice.getAttribute("aria-pressed"), "true");
          await page.locator(".p16-surface-photo").evaluate((image) => image.decode());
        }
        await page.locator("[data-painter-stroke]").tap();
      }
      if (n === 17) {
        await page.locator('[data-p17-study="pine"]').tap();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-p17-study="pine"]').getAttribute("aria-pressed") ===
            "true",
        );
        assert(
          (await page.locator(".p17-study-photo img").getAttribute("src")).includes("pine-cabin"),
        );
      }
      assert.equal(errors.length, 0, `${n}: ${errors.join(" | ")}`);
      await context.close();
      console.log(
        `Painter ${n} ${viewport.width}x${viewport.height}: media, copy, layout, tap-close and planner passed`,
      );
    }

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const movies = [];
    page.on("request", (request) => {
      if (request.url().endsWith(".mp4")) movies.push(request.url());
    });
    await page.goto(`${origin}/templates/painter${n}`, { waitUntil: "networkidle" });
    assert.equal(movies.length, 0, "Reduced-motion visit downloaded a film");
    const trigger = page.locator(noteSelector).first();
    await trigger.tap();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await page.waitForTimeout(300);
    await tapClose(page, trigger);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await trigger.tap();
    await page.locator(".pt-dialog-scroll").evaluate((element) => {
      const values = [...element.querySelectorAll("h2,h3,p,span,legend,label")].map((node) => [
        node,
        parseFloat(getComputedStyle(node).fontSize),
      ]);
      for (const [node, size] of values) node.style.fontSize = `${size * 2}px`;
    });
    await tapClose(page, trigger);
    await context.close();
    console.log(`Painter ${n}: 200% pinch/text resize and reduced motion passed`);
  }

  const catalog = await browser.newPage();
  for (const path of ["/templates", "/templates/"]) {
    await catalog.goto(`${origin}${path}`, { waitUntil: "networkidle" });
    for (const n of [16, 17, 18]) {
      const card = catalog.locator(`a[href="/templates/painter${n}"]`);
      assert.equal(await card.count(), 1, `Catalog missing Painter ${n}`);
      await card.scrollIntoViewIfNeeded();
      await card.locator("img").evaluate((image) => image.decode());
      assert((await card.innerText()).toLowerCase().includes("painter"));
    }
  }
  await catalog.close();
  console.log(
    "Painter 16-18 routes, identity and both catalog URLs passed. No payment was submitted.",
  );
} finally {
  await browser.close();
}
