import { useState } from "react";

import { PLAN_COMPARISON_COPY } from "@/lib/plans";

const steps = [
  {
    id: 1,
    label: "Browse templates",
    title: "Explore contractor-ready designs",
    body: "Start on the templates gallery and browse trade-specific layouts — bold and industrial, clean and modern, or warm and local. Preview each one before you commit.",
    detail: [
      "Trade-specific layouts",
      "Live previews of every style",
      "Mobile-first by default",
    ],
  },
  {
    id: 2,
    label: "Pick a style & plan",
    title: "Choose your template, then your plan",
    body: `Found a look you like? Hit buy on that template and pick Starter or Pro. ${PLAN_COMPARISON_COPY} Pay on Stripe — no setup fee.`,
    detail: [
      "Template travels with your purchase",
      "No contracts, cancel anytime",
      "Secure Stripe checkout",
    ],
  },
  {
    id: 3,
    label: "Verify & onboarding",
    title: "Sign in with a code — we do the rest",
    body: "After checkout, verify your email with a one-time code and add your license number. Our system automatically finds your business information, photos, and reviews to build your site.",
    detail: [
      "One-time email code, no passwords",
      "License-based business lookup",
      "Your info gathered automatically",
    ],
  },
  {
    id: 4,
    label: "Preview & go live",
    title: "Preview, personalize, then launch",
    body: "Walk through your finished site on a private preview link, request edits, and personalize it with AI. Happy with it? We complete the domain purchase and launch it for you.",
    detail: ["Private preview link", "AI-assisted edits", "We buy the domain and launch"],
  },
];

export function JourneySteps() {
  const [active, setActive] = useState(1);
  const current = steps.find((s) => s.id === active)!;

  return (
    <div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => {
          const isActive = step.id === active;
          const isDone = step.id < active;
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => setActive(step.id)}
                aria-current={isActive ? "step" : undefined}
                className={`group w-full rounded-2xl border p-4 text-left transition-all duration-300 ${
                  isActive
                    ? "border-primary bg-card shadow-[var(--shadow-lift)] -translate-y-1"
                    : "border-border bg-card/60 hover:border-primary/40 hover:-translate-y-0.5"
                }`}
              >
                <span
                  className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isActive || isDone
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {step.id}
                </span>
                <span className="mt-3 block text-sm font-semibold text-foreground">
                  {step.label}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Step {step.id} of 4
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${(active / steps.length) * 100}%`,
            backgroundImage: "var(--gradient-violet)",
          }}
        />
      </div>

      <div
        key={current.id}
        className="surface-card mt-8 animate-in fade-in slide-in-from-bottom-2 rounded-3xl p-8 duration-500 md:p-12"
      >
        <p className="text-sm font-medium uppercase tracking-widest text-primary">
          {current.label}
        </p>
        <h3 className="mt-3 text-2xl font-semibold md:text-3xl">{current.title}</h3>
        <p className="mt-4 max-w-2xl text-muted-foreground">{current.body}</p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {current.detail.map((d) => (
            <li
              key={d}
              className="rounded-xl bg-secondary px-4 py-3 text-sm text-secondary-foreground"
            >
              {d}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActive((a) => Math.max(1, a - 1))}
            disabled={active === 1}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => setActive((a) => Math.min(steps.length, a + 1))}
            disabled={active === steps.length}
            className="rounded-full px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-0.5 disabled:opacity-40"
            style={{ backgroundImage: "var(--gradient-violet)" }}
          >
            {active === steps.length ? "That's it" : "Next step"}
          </button>
        </div>
      </div>
    </div>
  );
}
