import { ArrowUpRight, Layers3 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { m, useReducedMotion } from "motion/react";
import { SiteMotionRoot } from "@/components/site-renderer/motion-presets";
import { templateCatalog } from "@/lib/template-catalog";
import type { ContractorJob } from "@/lib/template-catalog";

const MotionLink = m.create(Link);

// Painter templates lead the grid; gardener and plumber sit at the bottom.
const JOB_RANK: Record<ContractorJob, number> = { painter: 0, gardener: 1, plumber: 2 };

const orderedTemplates = [...templateCatalog].sort(
  (a, b) => JOB_RANK[a.job] - JOB_RANK[b.job],
);

export function TemplatesCatalogPage() {
  const reduceMotion = useReducedMotion();

  return (
    <SiteMotionRoot>
      <main className="min-h-screen overflow-hidden bg-[#241633] font-sans [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans text-[#f8f3ff] selection:bg-[#a970e8] selection:text-white">
        <div className="pointer-events-none fixed inset-0 opacity-[.16] [background-image:radial-gradient(circle_at_center,white_.7px,transparent_.8px)] [background-size:8px_8px]" />
        <div className="relative mx-auto max-w-[1560px] px-5 pb-24 pt-7 sm:px-8 lg:px-12 lg:pb-36">
          <header className="flex items-center justify-between border-b border-white/15 pb-6">
            <a
              href="/templates"
              className="flex min-h-11 items-center gap-3"
              aria-label="Template gallery home"
            >
              <span className="grid size-10 place-items-center rounded-full border border-[#a970e8]/60 bg-[#a970e8]/15">
                <Layers3 className="size-4 text-[#c79bf3]" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[.24em]">
                Contractor templates
              </span>
            </a>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[.22em] text-white/45 sm:block">
              {templateCatalog.length} contractor starting points · More coming soon
            </span>
          </header>

          <section className="grid gap-10 py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)] lg:items-end lg:py-24">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.34em] text-[#c89af5]">
                Choose a starting point
              </p>
              <h1 className="mt-6 max-w-5xl text-[clamp(3.75rem,9vw,9rem)] font-semibold leading-[.82] tracking-[-.075em]">
                Built for the <span className="italic text-[#c79bf3]">work.</span>
              </h1>
            </div>
            <p className="max-w-xl text-base leading-7 text-white/62 lg:pb-2">
              Each preview is a complete contractor website starting point. Explore the atmosphere,
              service story, project proof, and customer booking experience before choosing a
              foundation.
            </p>
          </section>

          <section aria-labelledby="template-grid-heading">
            <div className="mb-7 flex items-center justify-between border-t border-white/15 pt-5">
              <h2
                id="template-grid-heading"
                className="text-[10px] font-bold uppercase tracking-[.28em] text-white/55"
              >
                Available templates
              </h2>
              <span className="text-[10px] font-bold tabular-nums tracking-[.25em] text-[#c89af5]">
                {String(templateCatalog.length).padStart(2, "0")} / LIVE
              </span>
            </div>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {orderedTemplates.map((template, index) => (
                <MotionLink
                  key={template.slug}
                  to={template.href}
                  initial={false}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={
                    reduceMotion
                      ? undefined
                      : { y: -10, rotateX: 1.5, rotateY: index % 2 ? -1.5 : 1.5 }
                  }
                  whileFocus={reduceMotion ? undefined : { y: -6 }}
                  className="group relative flex min-h-[34rem] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[.055] p-2 shadow-[0_20px_80px_rgba(7,2,14,.18)] outline-none [perspective:1200px] focus-visible:ring-2 focus-visible:ring-[#c89af5] focus-visible:ring-offset-4 focus-visible:ring-offset-[#241633]"
                  style={{ transformStyle: "preserve-3d" }}
                  aria-label={
                    "Open " + template.variant + ", a " + template.job + " website template"
                  }
                >
                  <div
                    className="relative min-h-[27rem] flex-1 overflow-hidden rounded-[1.35rem]"
                    style={{ backgroundColor: template.palette.surface }}
                  >
                    <m.img
                      src={template.previewImage}
                      alt={template.variant + " " + template.job + " template preview"}
                      loading={index === 0 ? "eager" : "lazy"}
                      decoding="async"
                      className="absolute inset-0 size-full object-cover"
                      whileHover={reduceMotion ? undefined : { scale: 1.055 }}
                      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/12 to-black/15" />
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
                      <span
                        className="rounded-full border border-white/30 px-3 py-2 text-[9px] font-bold uppercase tracking-[.22em] shadow-sm backdrop-blur-md"
                        style={{
                          backgroundColor: template.palette.accent,
                          color: template.palette.ink,
                        }}
                      >
                        {template.job}
                      </span>
                      <span className="grid size-11 place-items-center rounded-full border border-white/25 bg-black/15 text-white backdrop-blur-md transition-colors group-hover:bg-white group-hover:text-[#241633]">
                        <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:rotate-12" />
                      </span>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-6">
                      <p className="text-[9px] font-bold uppercase tracking-[.25em] text-white/55">
                        {template.job} · Template {String(index + 1).padStart(2, "0")}
                      </p>
                      <h3 className="mt-3 text-5xl font-semibold leading-none tracking-[-.055em] text-white sm:text-6xl">
                        {template.variant}
                      </h3>
                    </div>
                  </div>
                  <div className="flex min-h-[6.5rem] items-center justify-between gap-5 px-4 py-5">
                    <p className="max-w-sm text-sm leading-6 text-white/55">
                      {template.description}
                    </p>
                    <span className="hidden shrink-0 text-[9px] font-bold uppercase tracking-[.2em] text-[#c89af5] sm:block">
                      View site
                    </span>
                  </div>
                </MotionLink>
              ))}
            </div>
          </section>
        </div>
      </main>
    </SiteMotionRoot>
  );
}
