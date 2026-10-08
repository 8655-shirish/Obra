import type { Route } from "../../../../src/routes/lp/$websiteId";

type PublicSite = ReturnType<typeof Route.useLoaderData>;
type Input = { websiteId: string; preview?: string; version?: string };

export type PublicSiteOptions = {
  template: "painter11" | "plumber";
  mode?: "live" | "pending" | "inactive" | "paused" | "demo";
};

declare global {
  interface Window {
    __publicSiteOptions?: PublicSiteOptions;
    __publicSiteFixture: {
      requests: Input[];
      loaded: PublicSite | null;
      forbiddenCalls: string[];
    };
  }
}

export const publicSiteFixture: Window["__publicSiteFixture"] = {
  requests: [],
  loaded: null,
  forbiddenCalls: [],
};

// Only the LP server loader is injected. The route component, both molds, and dialogs are real.
export async function loadPublicSite({ data }: { data: Input }): Promise<PublicSite> {
  const options = window.__publicSiteOptions;
  if (!options) throw new Error("Public-site loader requires explicit fixture data");
  const mode = options.mode ?? "live";
  const demo = mode === "demo";
  const live = mode === "live";
  const result: PublicSite = {
    config: {
      kind: "template",
      templateSlug: options.template,
      identity: {
        businessName: "Purchased Fixture Business",
        licenseNumber: "MOCK",
        city: "Oakland",
        phone: "+1 202 555 0100",
        email: "business@example.test",
      },
      text: {},
      media: {},
      reviews: [],
      blogs: [],
      contact: {
        phone: "+1 202 555 0100",
        email: "business@example.test",
        area: "Oakland",
        hours: "Weekdays",
      },
    },
    websiteId: data.websiteId,
    versionId: "55555555-5555-4555-8555-555555555555",
    templateMedia: {},
    showBookingPay: demo || live,
    liveBooking: live,
    showBuyCta: false,
    showDemoChrome: demo,
    bookingConfigurationPending: mode === "pending",
    entitlementUnavailable: mode === "inactive",
    showLeadForm: !demo && mode !== "inactive",
    isLive: !demo,
    hasLicenseConfigured: true,
  };
  publicSiteFixture.requests.push(structuredClone(data));
  publicSiteFixture.loaded = structuredClone(result);
  return result;
}

export function ContractorSiteView(): never {
  publicSiteFixture.forbiddenCalls.push("unified-renderer");
  throw new Error("Supported template fixture must render its actual mold");
}

export async function createSaasCheckout(): Promise<never> {
  publicSiteFixture.forbiddenCalls.push("saas-checkout");
  throw new Error("SaaS charging is forbidden in the public booking fixture");
}

export async function verifyDemoLicense(): Promise<never> {
  publicSiteFixture.forbiddenCalls.push("license-verification");
  throw new Error("License verification is outside the injected preview fixture");
}
