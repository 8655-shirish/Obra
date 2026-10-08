import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type {
  Bucket1BoundResource,
  Bucket1HeadlessObservation,
  Bucket1HeadlessRuntime,
  Bucket1InfrastructureFailure,
  Bucket1ValidationContract,
  Bucket1ValidationInput,
  Bucket1Viewport,
  Bucket1ViewportEvidence,
} from "./bucket1-contract.ts";
import {
  collectBucket1BrowserChecks,
  type Bucket1BrowserCheckResult,
} from "./bucket1-runtime-checks.ts";

const EXPECTED_PLAYWRIGHT_PACKAGE = "@playwright/test";
const HOST_ORIGIN = "https://bucket1-runtime.invalid";
const HOST_URL = HOST_ORIGIN + "/site-runtime/host.html";
const MAX_DETAIL = 2 * 1024;

type PlaywrightModule = typeof import("@playwright/test");
type Browser = Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>>;
type BrowserContext = Awaited<ReturnType<Browser["newContext"]>>;
type Page = Awaited<ReturnType<BrowserContext["newPage"]>>;
type Route = import("@playwright/test").Route;

type ResourceBody = { body: Buffer; mimeType: string; logicalId: string };

type RuntimeOptions = {
  hostDocumentPath?: string;
  resolveResource?: (
    resource: Bucket1BoundResource,
    signal?: AbortSignal,
  ) => Promise<Uint8Array | Buffer | null>;
};

export type Bucket1RuntimeAvailability =
  | {
      ok: true;
      packageVersion: "1.55.0";
      browserRevision: "1187";
      browserVersion: "140.0.7339.16";
      executablePath: string;
      hostDocumentPath: string;
    }
  | {
      ok: false;
      cause: "browser_unavailable" | "host_injection";
      detail: string;
    };

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error && reason.name === "AbortError"
    ? reason
    : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortable<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  disposeLateResult?: (value: T) => void,
): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    void operation.then(disposeLateResult).catch(() => undefined);
    return Promise.reject(abortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (settled) {
          disposeLateResult?.(value);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

function failure(
  cause: Bucket1InfrastructureFailure["cause"],
  detail: unknown,
): Bucket1InfrastructureFailure {
  return {
    schemaVersion: 1,
    kind: "headless-browser",
    status: "infrastructure_failed",
    cause,
    detail: String(detail instanceof Error ? detail.message : detail).slice(0, MAX_DETAIL),
  };
}

function defaultHostDocumentPath(): string {
  return fileURLToPath(new URL("../../../public/site-runtime/host.html", import.meta.url));
}

async function importPlaywright(): Promise<PlaywrightModule> {
  // Keep the pinned production-image dependency external; bundling Playwright pulls native
  // platform watcher binaries into the Cloudflare artifact.
  const moduleName: string = EXPECTED_PLAYWRIGHT_PACKAGE;
  return (await import(/* @vite-ignore */ moduleName)) as PlaywrightModule;
}

function packageVersion(): string | null {
  try {
    const packagePath = import.meta.resolve(EXPECTED_PLAYWRIGHT_PACKAGE + "/package.json");
    const parsed = JSON.parse(readFileSync(fileURLToPath(packagePath), "utf8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export async function inspectBucket1HeadlessRuntimeAvailability(
  options: RuntimeOptions = {},
): Promise<Bucket1RuntimeAvailability> {
  const hostDocumentPath = options.hostDocumentPath ?? defaultHostDocumentPath();
  if (!existsSync(hostDocumentPath)) {
    return {
      ok: false,
      cause: "host_injection",
      detail:
        "Built isolated runtime missing at " + hostDocumentPath + ". Run pnpm build:site-runtime.",
    };
  }
  const version = packageVersion();
  if (version !== "1.55.0") {
    return {
      ok: false,
      cause: "browser_unavailable",
      detail:
        "Pinned Playwright package mismatch: expected 1.55.0, found " +
        (version ?? "unavailable") +
        ".",
    };
  }
  try {
    const { chromium } = await importPlaywright();
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath)) {
      return {
        ok: false,
        cause: "browser_unavailable",
        detail:
          "Pinned Chromium revision 1187 is not installed at " +
          executablePath +
          ". Run pnpm exec playwright install chromium during the production image build.",
      };
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ["--disable-background-networking", "--disable-component-update", "--disable-sync"],
    });
    try {
      if (browser.version() !== "140.0.7339.16") {
        return {
          ok: false,
          cause: "browser_unavailable",
          detail:
            "Pinned Chromium version mismatch: expected 140.0.7339.16, launched " +
            browser.version() +
            ".",
        };
      }
    } finally {
      await browser.close();
    }
    return {
      ok: true,
      packageVersion: "1.55.0",
      browserRevision: "1187",
      browserVersion: "140.0.7339.16",
      executablePath,
      hostDocumentPath,
    };
  } catch (error) {
    return {
      ok: false,
      cause: "browser_unavailable",
      detail: "Unable to launch pinned Playwright 1.55.0 Chromium: " + String(error),
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function manifestSlots(input: Bucket1ValidationInput): Array<Record<string, unknown>> {
  const manifest = asRecord(input.manifest);
  return Array.isArray(manifest?.slots)
    ? manifest.slots.flatMap((value) => {
        const record = asRecord(value);
        return record ? [record] : [];
      })
    : [];
}

function bindRuntimeProps(
  input: Bucket1ValidationInput,
  resourceUrls: Map<string, string>,
): { props: Record<string, unknown>; designSpec: Record<string, unknown> | null } | null {
  const props = asRecord(structuredClone(input.hostProps));
  if (!props) return null;
  const mediaSlots: Record<string, unknown> = {};
  for (const slot of manifestSlots(input)) {
    const slotId = typeof slot.slotId === "string" ? slot.slotId : "";
    if (!slotId) continue;
    mediaSlots[slotId] = {
      ...slot,
      url: resourceUrls.get(slotId) ?? resourceUrls.get(String(slot.assetId ?? "")) ?? null,
      ...(typeof slot.posterSlotId === "string" && resourceUrls.has(slot.posterSlotId)
        ? { posterUrl: resourceUrls.get(slot.posterSlotId) }
        : {}),
    };
  }
  props.mediaSlots = mediaSlots;
  if (Array.isArray(props.media)) {
    props.media = props.media.map((value) => {
      const item = asRecord(value);
      if (!item) return value;
      const keys = [item.slotId, item.assetId, item.logicalId].filter(
        (entry): entry is string => typeof entry === "string",
      );
      const bound = keys.map((key) => resourceUrls.get(key)).find(Boolean);
      return { ...item, url: bound ?? null };
    });
  }
  const designSpec = asRecord(props.designSpec);
  delete props.designSpec;
  return { props, designSpec };
}

function resourceUrl(logicalId: string): string {
  return HOST_ORIGIN + "/__bucket1_resource__/" + encodeURIComponent(logicalId);
}

async function loadBoundResources(
  input: Bucket1ValidationInput,
  resolveResource: RuntimeOptions["resolveResource"],
  signal?: AbortSignal,
): Promise<
  | { ok: true; byUrl: Map<string, ResourceBody>; urls: Map<string, string> }
  | { ok: false; observation: Bucket1InfrastructureFailure }
> {
  const byUrl = new Map<string, ResourceBody>();
  const urls = new Map<string, string>();
  throwIfAborted(signal);
  for (const resource of input.resources) {
    throwIfAborted(signal);
    if (!resolveResource) {
      return {
        ok: false,
        observation: failure(
          "resource_timeout",
          "No server-owned resolver was configured for bound resource " + resource.logicalId + ".",
        ),
      };
    }
    let value: Uint8Array | Buffer | null;
    try {
      value = await abortable(resolveResource(resource, signal), signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      return {
        ok: false,
        observation: failure(
          "resource_timeout",
          "Resolver failed for bound resource " + resource.logicalId + ": " + String(error),
        ),
      };
    }
    if (!value) {
      return {
        ok: false,
        observation: failure(
          "resource_timeout",
          "Bound resource " + resource.logicalId + " was unavailable.",
        ),
      };
    }
    const body = Buffer.from(value);
    const hash = createHash("sha256").update(body).digest("hex");
    if (hash !== resource.contentHash || body.byteLength !== resource.byteSize) {
      return {
        ok: false,
        observation: failure(
          "host_injection",
          "Bound resource " + resource.logicalId + " failed SHA-256 or byte-size verification.",
        ),
      };
    }
    const url = resourceUrl(resource.logicalId);
    byUrl.set(url, { body, mimeType: resource.mimeType, logicalId: resource.logicalId });
    urls.set(resource.logicalId, url);
  }
  return { ok: true, byUrl, urls };
}

function timeoutPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Bucket 1 validator exceeded " + timeoutMs + "ms")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForStableLayout(
  page: Page,
  samples: number,
  maximumDelta: number,
  readyTimeoutMs: number,
): Promise<number> {
  return page.evaluate(
    ({ samples, maximumDelta, readyTimeoutMs }) =>
      new Promise<number>((resolve, reject) => {
        const started = performance.now();
        let stable = 0;
        let previous = "";
        const frame = () => {
          const nodes = [...document.querySelectorAll("#root, #root *")].slice(0, 3000);
          const signature = nodes
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return [rect.x, rect.y, rect.width, rect.height]
                .map((value) => Math.round(value / maximumDelta) * maximumDelta)
                .join(",");
            })
            .join(";");
          stable = signature === previous ? stable + 1 : 0;
          previous = signature;
          if (stable >= samples) {
            resolve(stable);
            return;
          }
          if (performance.now() - started > readyTimeoutMs) {
            reject(new Error("layout did not reach the required stable sample count"));
            return;
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { samples, maximumDelta, readyTimeoutMs },
  );
}

async function validateViewport(args: {
  browser: Browser;
  viewport: Bucket1Viewport;
  input: Bucket1ValidationInput;
  hostHtml: string;
  byUrl: Map<string, ResourceBody>;
  resourceUrls: Map<string, string>;
  contract: Bucket1ValidationContract;
  signal?: AbortSignal;
}): Promise<Bucket1ViewportEvidence | Bucket1InfrastructureFailure> {
  const { browser, viewport, input, hostHtml, byUrl, resourceUrls, contract, signal } = args;
  let context: BrowserContext | null = null;
  const abortContext = () => {
    void context?.close().catch(() => undefined);
  };
  const runtimeErrors: string[] = [];
  const blockedRequests: string[] = [];
  try {
    throwIfAborted(signal);
    context = await abortable(
      browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr,
        locale: contract.locale,
        timezoneId: contract.timezone,
        colorScheme: contract.colorScheme,
        reducedMotion: "reduce",
        serviceWorkers: "block",
        javaScriptEnabled: true,
      }),
      signal,
      (lateContext) => void lateContext.close().catch(() => undefined),
    );
    signal?.addEventListener("abort", abortContext, { once: true });
    const page = await abortable(context.newPage(), signal);
    page.on("pageerror", (error) => runtimeErrors.push("pageerror: " + error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push("console: " + message.text());
    });
    page.on("requestfailed", (request) => {
      const failureText = request.failure()?.errorText ?? "failed";
      if (!failureText.includes("ERR_ABORTED"))
        blockedRequests.push(request.url() + " (" + failureText + ")");
    });
    await page.route("**/*", async (route: Route) => {
      const url = route.request().url();
      if (url === HOST_URL) {
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: hostHtml,
        });
        return;
      }
      const resource = byUrl.get(url);
      if (resource) {
        await route.fulfill({ status: 200, contentType: resource.mimeType, body: resource.body });
        return;
      }
      if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") {
        await route.continue();
        return;
      }
      blockedRequests.push(url);
      await route.abort("blockedbyclient");
    });
    await page.goto(HOST_URL, { waitUntil: "domcontentloaded", timeout: contract.readyTimeoutMs });
    await page.addStyleTag({
      content:
        "html{font-size:" +
        viewport.textScale * 100 +
        "%!important;color-scheme:light!important}*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}",
    });
    const bound = bindRuntimeProps(input, resourceUrls);
    if (!bound)
      return failure("host_injection", "hostProps must be a plain object for runtime injection.");
    const token = "bucket1-" + input.candidateRevision;
    const runtimeSignal = page.evaluate(
      ({ token }) =>
        new Promise<{ type: string; error?: string }>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("site runtime did not become healthy")),
            4000,
          );
          window.addEventListener("message", (event) => {
            const data = event.data as { type?: unknown; token?: unknown; error?: unknown } | null;
            if (!data || data.token !== token) return;
            if (data.type === "site-runtime-healthy" || data.type === "site-runtime-error") {
              clearTimeout(timer);
              resolve({
                type: String(data.type),
                error: typeof data.error === "string" ? data.error : undefined,
              });
            }
          });
        }),
      { token },
    );
    await page.evaluate((payload) => window.postMessage(payload, "*"), {
      type: "site-runtime-init",
      token,
      themeSource: input.candidateSource,
      props: bound.props,
      designSpec: bound.designSpec,
      kitScope: input.compilePolicy.kitScope,
    });
    const runtimeReady = await abortable(
      timeoutPromise(runtimeSignal, contract.readyTimeoutMs),
      signal,
    );
    if (runtimeReady.type !== "site-runtime-healthy") {
      runtimeErrors.push(
        "site-runtime-error: " + (runtimeReady.error ?? "unknown runtime render error"),
      );
    }
    await timeoutPromise(
      page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      }),
      contract.readyTimeoutMs,
    ).catch((error) => {
      throw failure("font_timeout", error);
    });
    await timeoutPromise(
      page.evaluate(async () => {
        const pending: Promise<unknown>[] = [];
        for (const image of [...document.images]) {
          if (image.complete) continue;
          pending.push(
            new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener(
                "error",
                () => reject(new Error("image failed: " + image.currentSrc)),
                {
                  once: true,
                },
              );
            }),
          );
        }
        await Promise.all(pending);
      }),
      contract.resources.resourceTimeoutMs,
    ).catch((error) => {
      throw failure("image_timeout", error);
    });
    if (blockedRequests.length > 0) {
      return failure(
        "resource_timeout",
        "Runtime requested unbound network resources: " +
          [...new Set(blockedRequests)].slice(0, 12).join(", "),
      );
    }
    const stableSamples = await waitForStableLayout(
      page,
      contract.layoutStabilitySamples,
      contract.tolerances.stableLayoutDeltaPx,
      contract.readyTimeoutMs,
    );
    const result = (await page.evaluate(collectBucket1BrowserChecks, {
      runtimeErrors,
      contactHidden: input.compilePolicy.contactHidden,
      tolerances: contract.tolerances,
    })) as Bucket1BrowserCheckResult;
    const checkIds = result.checks.map((entry) => entry.checkId);
    if (
      checkIds.length !== contract.checks.length ||
      contract.checks.some((checkId) => !checkIds.includes(checkId))
    ) {
      return failure(
        "runtime_evidence_contract",
        "Browser check collector did not return every closed check id.",
      );
    }
    return {
      viewportId: viewport.id,
      runtimeReady: true,
      fontsReady: true,
      resourcesSettled: true,
      layoutStabilitySamples: stableSamples,
      checks: result.checks,
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw abortError(signal);
    }
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      (error as { status?: unknown }).status === "infrastructure_failed"
    ) {
      return error as Bucket1InfrastructureFailure;
    }
    const detail = String(error);
    const cause = detail.includes("site runtime did not become healthy")
      ? "runtime_ready_timeout"
      : detail.includes("layout did not reach")
        ? "runtime_ready_timeout"
        : "validator_crash";
    return failure(cause, detail);
  } finally {
    signal?.removeEventListener("abort", abortContext);
    await context?.close().catch(() => undefined);
  }
}

export function createBucket1HeadlessRuntime(options: RuntimeOptions = {}): Bucket1HeadlessRuntime {
  return {
    async validate({
      input,
      binding,
      contract,
      signal: parentSignal,
    }): Promise<Bucket1HeadlessObservation> {
      const timeoutSignal = AbortSignal.timeout(contract.totalTimeoutMs);
      const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
      throwIfAborted(signal);
      if (
        contract.browser.playwrightVersion !== "1.55.0" ||
        contract.browser.revision !== "1187" ||
        contract.browser.browserVersion !== "140.0.7339.16" ||
        contract.runtime.hostDocument !== "/site-runtime/host.html" ||
        contract.locale !== "en-US" ||
        contract.timezone !== "UTC" ||
        contract.colorScheme !== "light" ||
        contract.animationState !== "reduced-motion"
      ) {
        return failure(
          "runtime_evidence_contract",
          "Unsupported Bucket 1 browser or runtime contract.",
        );
      }
      const availability = await abortable(
        inspectBucket1HeadlessRuntimeAvailability(options),
        signal,
      );
      if (availability.ok === false) return failure(availability.cause, availability.detail);
      const loaded = await loadBoundResources(input, options.resolveResource, signal);
      if (loaded.ok === false) return loaded.observation;
      throwIfAborted(signal);
      const hostHtml = readFileSync(availability.hostDocumentPath, "utf8");
      let browser: Browser | null = null;
      const abortBrowser = () => {
        void browser?.close().catch(() => undefined);
      };
      try {
        const { chromium } = await abortable(importPlaywright(), signal);
        browser = await abortable(
          chromium.launch({
            headless: true,
            executablePath: availability.executablePath,
            args: [
              "--disable-background-networking",
              "--disable-component-update",
              "--disable-sync",
            ],
          }),
          signal,
          (lateBrowser) => void lateBrowser.close().catch(() => undefined),
        );
        signal?.addEventListener("abort", abortBrowser, { once: true });
        if (browser.version() !== contract.browser.browserVersion) {
          return failure(
            "browser_unavailable",
            "Pinned Chromium version mismatch: expected " +
              contract.browser.browserVersion +
              ", launched " +
              browser.version() +
              ".",
          );
        }
        const viewports: Bucket1ViewportEvidence[] = [];
        for (const viewport of contract.viewports) {
          throwIfAborted(signal);
          const observation = await abortable(
            validateViewport({
              browser,
              viewport,
              input,
              hostHtml,
              byUrl: loaded.byUrl,
              resourceUrls: loaded.urls,
              contract,
              signal,
            }),
            signal,
          );
          if ("status" in observation) return observation;
          viewports.push(observation);
        }
        return {
          schemaVersion: 1,
          kind: "headless-browser",
          status: "completed",
          bindingHash: binding.candidateBindingHash,
          validationContractHash: binding.validationContractHash,
          browser: contract.browser,
          viewports,
        };
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
          throw abortError(signal);
        }
        return failure("browser_launch", error);
      } finally {
        signal?.removeEventListener("abort", abortBrowser);
        await browser?.close().catch(() => undefined);
      }
    },
  };
}

export const bucket1HeadlessRuntime = createBucket1HeadlessRuntime;
