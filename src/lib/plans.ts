export type PlanId = "starter" | "pro";

export type Plan = {
  id: PlanId;
  name: string;
  monthlyPriceUsd: 79 | 129;
  price: string;
  summary: string;
  highlight: boolean;
  features: string[];
};

export const PLANS_BY_ID: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    monthlyPriceUsd: 79,
    price: "$79",
    summary: "$79/month — website hosting, editing, and Website Leads.",
    highlight: false,
    features: [
      "Your website, designed and built",
      "Edit your site and host it on Obra",
      "Lead capture",
      "Email support",
      "Billed monthly",
      "No setup fee",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceUsd: 129,
    price: "$129",
    summary:
      "$129/month — website and Website Leads, plus Google Calendar booking and Stripe Connect payments.",
    highlight: true,
    features: [
      "Your website, designed, built, edited, and hosted",
      "Website Leads",
      "Google Calendar booking on your site",
      "Collect visitor payments with Stripe Connect",
      "Priority support and monthly content updates",
      "Billed monthly",
      "No setup fee",
    ],
  },
};

export const PLANS: Plan[] = [PLANS_BY_ID.starter, PLANS_BY_ID.pro];

export const PLAN_LABELS: Record<PlanId, string> = {
  starter: "Starter",
  pro: "Pro",
};

export const LOWEST_MONTHLY_PRICE_USD = PLANS_BY_ID.starter.monthlyPriceUsd;

export const PLAN_COMPARISON_COPY = `Starter (${PLANS_BY_ID.starter.price}/month) includes a website and Website Leads; Pro (${PLANS_BY_ID.pro.price}/month) adds Google Calendar booking and Stripe Connect visitor payments while retaining Website Leads.`;
export const PLAN_SEO_DESCRIPTION = `Done-for-you websites for US contractors. Starter ${PLANS_BY_ID.starter.price}/month or Pro ${PLANS_BY_ID.pro.price}/month. Pick a plan, share your domain, choose a style, preview, and we launch it.`;

export function planMonthlyLabel(plan: PlanId): string {
  return `${PLANS_BY_ID[plan].price}/month`;
}
