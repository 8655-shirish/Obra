import { createFileRoute, Link } from "@tanstack/react-router";
import heroImage from "@/assets/hero-contractor.jpg";
import { JourneySteps } from "@/components/JourneySteps";
import { ObraLogo } from "@/components/ObraLogo";
import { PricingCards } from "@/components/PricingCards";
import { LOWEST_MONTHLY_PRICE_USD, PLAN_SEO_DESCRIPTION } from "@/lib/plans";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Contractor Websites Built For You | Obra" },
      {
        name: "description",
        content:
          PLAN_SEO_DESCRIPTION,
      },
      { property: "og:title", content: "Contractor Websites Built For You | Obra" },
      {
        property: "og:description",
        content:
          PLAN_SEO_DESCRIPTION,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});



const trust = [
  { stat: "1 day", label: "Average time to launch" },
  { stat: "100%", label: "Built by real designers" },
  { stat: "50 states", label: "Contractors served" },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="#top" className="inline-flex">
            <ObraLogo size={36} wordmarkClassName="text-lg" />
          </a>
          <nav className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-primary">
              How it works
            </a>
            <a href="#pricing" className="transition-colors hover:text-primary">
              Pricing
            </a>
            <a href="#faq" className="transition-colors hover:text-primary">
              FAQ
            </a>
          </nav>
          <Link
            to="/login"
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-0.5"
            style={{ backgroundImage: "var(--gradient-violet)" }}
          >
            Contractor Login
          </Link>
        </div>
      </header>

      <main id="top">
        <section className="relative min-h-[85vh] overflow-hidden">
          <img
            src={heroImage}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
          <div
            className="absolute inset-0"
            style={{ backgroundImage: "var(--gradient-wash)" }}
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-background via-background/92 to-background/50"
            aria-hidden="true"
          />

          <div className="relative z-10 mx-auto max-w-6xl px-6 py-20 lg:py-28">
            <div className="max-w-2xl">
              <span className="inline-flex items-center rounded-full border border-primary/25 bg-card/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary backdrop-blur-sm">
                For US contractors
              </span>
              <h1 className="mt-6 text-4xl font-semibold leading-[1.05] md:text-6xl">
                Your trade deserves a{" "}
                <span className="text-gradient-violet">website that wins jobs</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground">
                Roofers, remodelers, electricians and general contractors — we design, build, host
                and maintain your website so you can stay on the jobsite. Your site can be live
                within a day — not a week.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/templates"
                  className="rounded-full px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-soft)] transition-transform hover:-translate-y-0.5"
                  style={{ backgroundImage: "var(--gradient-violet)" }}
                >
                  View Website Templates
                </Link>
                <a
                  href="#how-it-works"
                  className="rounded-full border border-border bg-card/90 px-7 py-3.5 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-secondary"
                >
                  See how it works
                </a>
              </div>
              <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
                {trust.map((t) => (
                  <div key={t.label}>
                    <dt className="font-display text-2xl font-semibold text-primary">{t.stat}</dt>
                    <dd className="mt-1 text-xs text-muted-foreground">{t.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary">
              How it works
            </p>
            <h2 className="mt-3 text-3xl font-semibold md:text-4xl">
              Four steps from browsing to a live website
            </h2>
            <p className="mt-4 text-muted-foreground">
              Click through the journey to see exactly what happens after you pick a template.
            </p>
          </div>
          <div className="mt-12">
            <JourneySteps />
          </div>
        </section>

        <section id="pricing" className="border-y border-border bg-secondary/40">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                Pricing
              </p>
              <h2 className="mt-3 text-3xl font-semibold md:text-4xl">Simple monthly plans</h2>
              <p className="mt-4 text-muted-foreground">
                Design, build, hosting and maintenance included. Your website live within a day, not
                a week. Domain cost billed at registrar price.
              </p>
            </div>
            <div className="mt-12">
              <PricingCards />
            </div>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-4xl px-6 py-20 lg:py-28">
          <h2 className="text-3xl font-semibold md:text-4xl">Questions contractors ask</h2>
          <div className="mt-10 space-y-4">
            {[
              {
                q: "Do I own my domain and website?",
                a: "Yes. The domain is registered in your business name, and your content is always yours.",
              },
              {
                q: "How long does it take to go live?",
                a: "Most sites are previewed the same day and live within 24 hours of your approval — not a week.",
              },
              {
                q: "What if I need changes later?",
                a: "Send us a note anytime. Starter includes email support; Pro includes monthly content updates and priority turnaround.",
              },
            ].map((item) => (
              <details key={item.q} className="surface-card group rounded-2xl p-6">
                <summary className="cursor-pointer list-none text-base font-semibold marker:hidden">
                  {item.q}
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} Obra. Websites for American contractors.</p>
          <p>Built and hosted in the USA.</p>
        </div>
      </footer>
    </div>
  );
}
