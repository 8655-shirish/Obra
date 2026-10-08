import { Link } from "@tanstack/react-router";

import { PLANS } from "@/lib/plans";

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 size-5 shrink-0 text-primary"
      aria-hidden="true"
    >
      <path
        d="M4 10.5 8 14.5 16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PricingCards() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {PLANS.map((plan) => (
        <div
          key={plan.id}
          className={`relative flex flex-col rounded-3xl p-8 transition-transform duration-300 hover:-translate-y-1 md:p-10 ${
            plan.highlight
              ? "border-2 border-primary bg-card shadow-[var(--shadow-lift)]"
              : "surface-card"
          }`}
        >
          {plan.highlight && (
            <span className="absolute right-6 top-6 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-accent-foreground">
              Most popular
            </span>
          )}
          <h3 className="text-2xl font-semibold md:text-3xl">{plan.name}</h3>
          <p className="mt-6 flex items-baseline gap-2">
            <span className="font-display text-5xl font-semibold md:text-6xl">{plan.price}</span>
            <span className="text-muted-foreground">/month</span>
          </p>
          <ul className="mt-8 space-y-4">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-3 text-sm text-foreground/85">
                <Check />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/templates"
            className={`mt-10 inline-flex w-full items-center justify-center rounded-full px-6 py-3.5 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${
              plan.highlight
                ? "text-primary-foreground shadow-[var(--shadow-soft)]"
                : "border border-primary text-primary hover:bg-secondary"
            }`}
            style={plan.highlight ? { backgroundImage: "var(--gradient-violet)" } : undefined}
          >
            Get started
          </Link>
        </div>
      ))}
    </div>
  );
}
