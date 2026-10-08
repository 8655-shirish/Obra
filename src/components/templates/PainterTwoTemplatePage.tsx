import { ArrowDown, ArrowUpRight, Check, ChevronRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";

import type { TemplateMoldContent } from "@/lib/template-content/overlay";
import {
  overlayLogoUrl,
  overlayMediaUrl,
  purchasedReviewList,
} from "@/lib/template-content/overlay";
import "./overlay-fit.css";

const MEDIA = "/templates/true-coat-orbit/generated";
const DISPLAY = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
} as const;
const BODY = { fontFamily: "Verdana, Geneva, Tahoma, sans-serif" } as const;

const THEME = {
  "--o-void": "#070a12",
  "--o-moon": "#f2eee5",
  "--o-solar": "#ffb84d",
  "--o-comet": "#b8c7ff",
} as React.CSSProperties;

const IMAGE = {
  hero: MEDIA + "/hero.jpg",
  heroVideo: MEDIA + "/hero-loop.mp4",
  pointDetail: MEDIA + "/point-detail.jpg",
  interior: MEDIA + "/service-interior.jpg",
  exterior: MEDIA + "/service-exterior.jpg",
  cabinetry: MEDIA + "/service-cabinetry.jpg",
  before: MEDIA + "/before.jpg",
  after: MEDIA + "/after.jpg",
  journalColor: MEDIA + "/journal-color.jpg",
  journalPrep: MEDIA + "/journal-prep.jpg",
  journalSheen: MEDIA + "/journal-sheen.jpg",
  cta: MEDIA + "/proof-interior.jpg",
} as const;

const SERVICES = [
  {
    id: "interior",
    number: "01",
    title: "Interior painting",
    short: "Walls · ceilings · trim · doors",
    image: IMAGE.interior,
    alt: "Generated living room with indigo walls, ivory trim, a starry eclipse mural, and an astronaut figure visible through a doorway",
    body: "Walls, ceilings, trim, doors, and architectural details—planned around surface condition, room use, access, color, and sheen.",
    details: [
      "Repairs and preparation",
      "Careful room protection",
      "Finish selected for the surface",
    ],
  },
  {
    id: "exterior",
    number: "02",
    title: "Exterior painting",
    short: "Siding · stucco · trim · doors",
    image: IMAGE.exterior,
    alt: "Generated twilight house exterior with blue-black siding, ivory trim, a violet door, and a surreal galaxy sky",
    body: "Eligible siding, stucco, trim, and doors—reviewed for substrate, exposure, moisture, access, weather, and coating requirements.",
    details: ["Condition-led scope", "Weather-aware timing", "Compatible coating system"],
  },
  {
    id: "cabinetry",
    number: "03",
    title: "Cabinet refinishing",
    short: "Doors · frames · finish systems",
    image: IMAGE.cabinetry,
    alt: "Generated kitchen with midnight cabinetry, warm ivory surfaces, galaxy imagery around the windows, and painting tools",
    body: "Suitable cabinet doors and frames, with cleaning, repairs, adhesion preparation, application method, finish options, and cure requirements defined first.",
    details: ["Suitability review", "Adhesion preparation", "Cure plan and care notes"],
  },
] as const;

const PHASES = [
  {
    title: "Inspect",
    body: "Read the surface, current coating, access, and conditions before the scope is written.",
  },
  {
    title: "Protect",
    body: "Plan furniture, floor, landscape, hardware, and adjacent-surface protection.",
  },
  {
    title: "Repair",
    body: "Name visible repairs and explain how newly discovered conditions change the work.",
  },
  {
    title: "Prepare",
    body: "Clean, mask, sand, and prime as the verified surface and product system require.",
  },
  {
    title: "Finish",
    body: "Apply the specified system, clean the site, and complete a final walkthrough.",
  },
] as const;

const OBSERVATORY = [
  {
    title: "Color",
    body: "View physical samples through morning, afternoon, and evening light before committing.",
  },
  {
    title: "Scope",
    body: "List included surfaces, prep, products, exclusions, protection, cleanup, and payment schedule.",
  },
  {
    title: "Schedule",
    body: "Let repairs, drying conditions, access, crew size, and products determine duration.",
  },
  {
    title: "Project day",
    body: "Confirm belongings, pets, parking, access, staging, daily cleanup, and communication.",
  },
] as const;

const ARTICLES = [
  { number: "01", title: "How undertones change in daylight", image: IMAGE.journalColor },
  { number: "02", title: "What thorough surface preparation includes", image: IMAGE.journalPrep },
  { number: "03", title: "Where matte, eggshell, and satin fit", image: IMAGE.journalSheen },
] as const;

const FAQS = [
  {
    q: "What projects and surfaces fit?",
    a: "This template presents residential interiors, eligible exteriors, trim and door detail work, and suitable cabinet refinishing. A real operator should publish only verified services, surfaces, service area, and coating compatibility.",
  },
  {
    q: "What happens after first contact?",
    a: "A real painter should check address and project fit, gather project basics, arrange a site review when needed, and follow with a written scope. This preview booking flow creates no lead or appointment.",
  },
  {
    q: "What should the process and proposal cover?",
    a: "Inquiry, site review, written scope, inspection, protection, repairs, preparation, application, cleanup, and walkthrough. The proposal should name included surfaces, prep, products, exclusions, protection, schedule assumptions, payment terms, and how hidden conditions are handled.",
  },
  {
    q: "Can you help with color and coating choices?",
    a: "Color support can compare undertones, room light, neighboring finishes, and sheen. Products should fit the substrate, existing coating, exposure, desired finish, compatibility, and cure conditions. Record the agreed system in writing.",
  },
  {
    q: "How are schedule and exterior weather handled?",
    a: "Duration should follow scope, repairs, access, crew size, products, cure time, and weather. For exteriors, temperature, moisture, wind, direct sun, surface dryness, forecast, and manufacturer requirements can change timing.",
  },
  {
    q: "How should I prepare, and can the home stay occupied?",
    a: "Confirm belongings, fragile items, pets, parking, ventilation, work zones, drying or cure requirements, and safe access. The written plan should explain what the crew moves or protects and whether occupancy remains practical.",
  },
  {
    q: "What does cabinet refinishing include?",
    a: "For suitable doors and frames, scope can include cleaning, repairs, labeling and hardware handling, adhesion preparation, application, reassembly, finish options, and cure guidance.",
  },
  {
    q: "How does this site-visit demo work?",
    a: "Choose a sample weekday and time, then walk through a simulated $99 deposit screen. No appointment, lead, card charge, or project brief is created.",
  },
] as const;

function SectionLabel({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-[.2em] text-[var(--o-comet)]">
      <span className="tabular-nums text-[var(--o-solar)]">{index}</span>
      <span className="h-px w-10 bg-[var(--o-comet)]/55" />
      <span>{children}</span>
    </div>
  );
}

function Aperture({
  src,
  alt,
  className = "",
  loading = "lazy",
  tkey,
}: {
  src: string;
  alt: string;
  className?: string;
  loading?: "eager" | "lazy";
  tkey?: string;
}) {
  return (
    <div
      className={
        "relative overflow-hidden rounded-[50%] border border-[var(--o-comet)]/35 bg-[#101629] " +
        className
      }
    >
      <img
        src={src}
        alt={alt}
        loading={loading}
        className="size-full object-cover"
        width={2200}
        height={1466}
        data-tkey={tkey}
      />
      <div
        className="pointer-events-none absolute inset-[5%] rounded-[50%] border border-[var(--o-moon)]/15"
        aria-hidden="true"
      />
    </div>
  );
}

function BrandMark({
  brand,
  logoUrl,
  stacked = false,
}: {
  brand: string;
  logoUrl: string | null;
  stacked?: boolean;
}) {
  const initials = brand
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
  return (
    <span
      className={
        stacked ? "flex min-w-0 flex-col items-start gap-2" : "flex min-w-0 items-center gap-3"
      }
    >
      <span
        className="overlay-brand-mark grid size-10 shrink-0 place-items-center overflow-hidden border border-[var(--o-solar)] bg-[var(--o-void)] font-mono text-xs text-[var(--o-solar)]"
        data-tkey="media.logo"
      >
        {logoUrl ? <img src={logoUrl} alt="" className="size-full object-contain" /> : initials}
      </span>
      <span className="overlay-brand-name min-w-0">{brand}</span>
    </span>
  );
}

export function PainterTwoTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Make every";
  const heroAccent = text?.heroAccent ?? "surface count.";
  const heroSub =
    text?.heroSub ??
    "Interior painting, eligible exterior work, and cabinet refinishing—planned from surface condition through the final walkthrough.";
  const servicesHeading = text?.servicesHeading ?? "One scope.";
  const servicesAccent = text?.servicesAccent ?? "Three fields.";
  const methodHeading = text?.methodHeading ?? "The finish begins out of view.";
  const methodIntro =
    text?.methodIntro ??
    "Preparation is not backstage work. It determines adhesion, edge quality, coverage, protection, and what belongs in the written scope.";
  const proofTitle = text?.proofTitle ?? "Same room.";
  const proofAccent = text?.proofAccent ?? "Paint only.";
  const proofBody =
    text?.proofBody ??
    "A one-frame comparison keeps the property, camera, structure, furniture, and perspective in view while switching only the surface state.";
  const reviewsHeading = text?.reviewsHeading ?? "Verified feedback belongs here.";
  const reviewsBody =
    text?.reviewsBody ??
    "This intentionally empty proof register avoids invented quotes, ratings, people, and locations. Replace only with verified, permissioned feedback and accurate source attribution.";
  const planHeading = text?.planHeading ?? "Read the room before the color.";
  const faqTitle = text?.faqTitle ?? "Questions kept in the open.";
  const faqIntro =
    text?.faqIntro ??
    "No accordion and no hidden conditions. These answers preserve the practical planning subjects a real residential painting site should address.";
  const ctaTitle = text?.ctaTitle ?? "Start with the surfaces.";
  const ctaBody =
    text?.ctaBody ??
    "Before scheduling a real site visit, be ready to discuss surfaces and condition, visible repairs, color and finish goals, access, timing, occupancy, and the project address.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@truecoat.example";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "True Coat";
  const brandAria = brandName ? `${brandName} home` : "True Coat home";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const heroEyebrow = brandName
    ? `${brandName} · Residential painting`
    : "True Coat · Residential painting";
  const reduceMotion = useReducedMotion();
  const [motionReady, setMotionReady] = useState(false);
  const [videoBlocked, setVideoBlocked] = useState(false);
  const [serviceIndex, setServiceIndex] = useState(0);
  const [comparison, setComparison] = useState<"before" | "after">("after");
  const [bookingOpen, setBookingOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const service = SERVICES[serviceIndex];

  useEffect(() => setMotionReady(true), []);
  useEffect(() => {
    if (reduceMotion || !motionReady) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => setVideoBlocked(true));
  }, [motionReady, reduceMotion]);

  return (
    <div
      id="top"
      style={{ ...THEME, ...BODY }}
      className="min-h-screen overflow-hidden bg-[var(--o-void)] text-[var(--o-moon)] selection:bg-[var(--o-solar)] selection:text-[var(--o-void)] [&_h1]:font-mono [&_h2]:font-mono [&_h3]:font-mono"
    >
      <a
        href="#main"
        className="sr-only z-[80] bg-[var(--o-solar)] px-5 py-3 text-[var(--o-void)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>

      <header className="border-b border-[var(--o-comet)]/20 px-5 py-4 xl:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <a
            href="#top"
            aria-label={brandAria}
            className="min-w-0 font-mono text-sm uppercase tracking-[.16em]"
            style={DISPLAY}
          >
            <BrandMark brand={brandLabel} logoUrl={logoUrl} />
          </a>
          <button
            onClick={() => setBookingOpen(true)}
            className="min-h-12 bg-[var(--o-solar)] px-4 text-xs font-bold uppercase tracking-[.12em] text-[var(--o-void)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--o-solar)]"
          >
            Site visit <ArrowUpRight className="ml-2 inline size-4" />
          </button>
        </div>
        <nav
          aria-label="Page sections"
          className="mx-auto mt-4 flex max-w-7xl flex-wrap gap-x-5 gap-y-3 text-xs uppercase tracking-[.1em] text-[var(--o-comet)]"
        >
          <a href="#scope">Scope</a>
          <a href="#method">Method</a>
          <a href="#proof">Proof</a>
          <a href="#manual">Manual</a>
        </nav>
      </header>

      <div className="xl:grid xl:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="relative hidden border-r border-[var(--o-comet)]/20 xl:block">
          <div className="sticky top-0 flex h-screen flex-col justify-between px-7 py-8">
            <a
              href="#top"
              aria-label={brandAria}
              className="min-w-0 font-mono text-lg uppercase leading-[.95] tracking-[.15em]"
              style={DISPLAY}
            >
              <BrandMark brand={brandLabel} logoUrl={logoUrl} stacked />
            </a>
            <nav
              aria-label="Page sections"
              className="grid gap-5 text-xs font-bold uppercase tracking-[.1em] text-[var(--o-comet)]"
            >
              {[
                ["01", "scope", "Scope"],
                ["02", "method", "Method"],
                ["03", "proof", "Proof"],
                ["04", "notes", "Notes"],
                ["05", "manual", "Manual"],
              ].map(([n, id, label]) => (
                <a
                  key={id}
                  href={"#" + id}
                  className="group flex items-center gap-3 hover:text-[var(--o-moon)]"
                >
                  <span className="text-[var(--o-solar)]">{n}</span>
                  <span className="transition-transform group-hover:translate-x-1">{label}</span>
                </a>
              ))}
            </nav>
            <button
              onClick={() => setBookingOpen(true)}
              className="grid min-h-14 w-full grid-cols-[1fr_auto] items-center bg-[var(--o-solar)] px-4 text-left text-xs font-bold uppercase tracking-[.1em] text-[var(--o-void)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--o-solar)]"
            >
              Site visit <ArrowUpRight className="size-4" />
            </button>
          </div>
        </aside>

        <main id="main" tabIndex={-1}>
          <section className="relative mx-auto grid min-h-[calc(100svh-116px)] max-w-[1600px] content-center gap-10 px-5 pb-32 pt-14 sm:px-8 lg:min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:px-12 lg:pb-32 lg:pt-12 xl:grid-cols-[minmax(28rem,1.12fr)_minmax(22rem,.88fr)] xl:px-20">
            <div className="relative aspect-square min-w-0 lg:mx-0 lg:w-full xl:w-[min(61vw,48rem)]">
              <div className="absolute left-1/2 top-1/2 aspect-square w-[108vw] max-w-[46rem] -translate-x-1/2 -translate-y-1/2 lg:inset-0 lg:w-full lg:max-w-none lg:translate-x-0 lg:translate-y-0">
                <div
                  className="absolute inset-[0] rounded-full border border-[var(--o-comet)]/22 xl:inset-[-7%]"
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-[-6%] rounded-full border border-[var(--o-comet)]/10 xl:inset-[-14%]"
                  aria-hidden="true"
                />
                <div className="absolute inset-0 overflow-hidden rounded-full border border-[var(--o-comet)]/45 bg-black">
                  <img
                    src={heroPoster}
                    alt="Generated painter rolling blue paint in a dark room with a moon-like wall light"
                    loading="eager"
                    className="absolute inset-0 size-full object-cover"
                    data-tkey="media.heroPoster"
                  />
                  {motionReady && !reduceMotion ? (
                    <video
                      ref={videoRef}
                      src={IMAGE.heroVideo}
                      poster={heroPoster}
                      autoPlay
                      muted
                      loop
                      playsInline
                      className="absolute inset-0 size-full object-cover object-[72%_center]"
                      preload="metadata"
                      onPlay={() => setVideoBlocked(false)}
                      onError={() => setVideoBlocked(true)}
                      aria-label="Generated craft film of a painter making a controlled roller pass"
                    />
                  ) : null}
                </div>
                {videoBlocked ? (
                  <p className="absolute bottom-[5%] left-1/2 -translate-x-1/2 bg-[var(--o-void)]/90 px-3 py-2 text-center text-xs leading-4 text-[var(--o-moon)]">
                    Motion is paused by your browser.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="relative z-10 min-w-0 lg:self-center lg:pb-0 xl:-ml-20 xl:self-end xl:pb-24">
              <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--o-comet)]">
                {heroEyebrow}
              </p>
              <h1
                className="mt-5 max-w-full text-[clamp(2.65rem,12vw,8rem)] sm:max-w-3xl sm:text-[clamp(3.2rem,7vw,8rem)] font-normal leading-[.84] tracking-[-.075em]"
                style={DISPLAY}
                data-tkey="text.heroTitle"
              >
                {heroTitle}
                <br />
                <span className="text-[var(--o-solar)]" data-tkey="text.heroAccent">
                  {heroAccent}
                </span>
              </h1>
              <p
                className="mt-7 max-w-xl text-base leading-7 text-[var(--o-moon)] sm:text-lg"
                data-tkey="text.heroSub"
              >
                {heroSub}
              </p>
              <div className="mt-8 flex flex-col gap-4 pb-20 sm:flex-row sm:items-center sm:pb-0 lg:flex-col lg:items-start xl:flex-row xl:items-center">
                <button
                  onClick={() => setBookingOpen(true)}
                  className="min-h-14 bg-[var(--o-solar)] px-6 text-sm font-bold uppercase tracking-[.1em] text-[var(--o-void)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--o-solar)]"
                >
                  Check project fit <ArrowUpRight className="ml-3 inline size-4" />
                </button>
                <a
                  href={phoneHref}
                  data-tkey="contact.phone"
                  className="min-h-12 border-b border-[var(--o-comet)] py-3 text-xs uppercase tracking-[.13em] text-[var(--o-comet)] hover:text-[var(--o-moon)]"
                >
                  {rawPhone ? phoneLabel : "Sample call · (555) 013-7482"}
                </a>
              </div>
              <p className="mt-6 max-w-lg text-xs leading-5 text-[var(--o-comet)]">
                Generated illustrative imagery for this fictional template. Replace with documented
                project media before publishing.
              </p>
            </div>
            <a
              href="#scope"
              className="absolute bottom-7 right-7 hidden size-12 place-items-center border border-[var(--o-comet)]/55 text-[var(--o-comet)] xl:grid"
              aria-label="Explore painting scope"
            >
              <ArrowDown className="size-4" />
            </a>
          </section>

          <section
            id="scope"
            className="mx-auto max-w-[1600px] border-t border-[var(--o-comet)]/20 px-5 py-20 sm:px-8 lg:px-12 lg:py-28 xl:px-20"
          >
            <SectionLabel index="01">Painting scope</SectionLabel>
            <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(18rem,.58fr)_minmax(0,1.42fr)] lg:items-center">
              <div>
                <h2
                  className="break-words text-[clamp(2.55rem,12vw,5.8rem)] sm:text-[clamp(2.7rem,5vw,5.8rem)] font-normal leading-[.9] tracking-[-.06em]"
                  style={DISPLAY}
                  data-tkey="text.servicesHeading"
                >
                  {servicesHeading}
                  <br />
                  {servicesAccent}
                </h2>
                <div
                  role="group"
                  aria-label="Painting service"
                  className="mt-10 grid border-t border-[var(--o-comet)]/25"
                >
                  {SERVICES.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => setServiceIndex(index)}
                      aria-pressed={serviceIndex === index}
                      className={
                        "grid min-h-20 grid-cols-[2.2rem_1fr_auto] items-center gap-3 border-b border-[var(--o-comet)]/25 text-left transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--o-solar)] " +
                        (serviceIndex === index
                          ? "text-[var(--o-solar)]"
                          : "text-[var(--o-comet)] hover:text-[var(--o-moon)]")
                      }
                    >
                      <span className="font-mono text-xs">{item.number}</span>
                      <span className="font-mono text-lg" style={DISPLAY}>
                        {item.title}
                      </span>
                      <ChevronRight className="size-4" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-8">
                <div className="relative overflow-hidden border border-[var(--o-comet)]/35 bg-[#101629]">
                  <img
                    src={overlayMediaUrl(content, `serviceImage${serviceIndex}`, service.image)}
                    alt={service.alt}
                    loading="lazy"
                    width={2200}
                    height={1237}
                    className="aspect-[16/10] w-full object-cover"
                    data-tkey={`media.serviceImage${serviceIndex}`}
                  />
                  <div
                    className="pointer-events-none absolute inset-4 border border-[var(--o-moon)]/10"
                    aria-hidden="true"
                  />
                </div>
                <div className="grid gap-6 sm:grid-cols-[1fr_.8fr]">
                  <div>
                    <p className="text-xs uppercase tracking-[.16em] text-[var(--o-solar)]">
                      {service.short}
                    </p>
                    <p className="mt-4 max-w-2xl text-base leading-7">{service.body}</p>
                  </div>
                  <ul className="grid gap-3 text-sm leading-6 text-[var(--o-comet)]">
                    {service.details.map((item) => (
                      <li key={item} className="flex gap-3">
                        <Check className="mt-1 size-4 shrink-0 text-[var(--o-solar)]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section
            id="method"
            className="mx-auto max-w-[1600px] border-t border-[var(--o-comet)]/20 px-5 py-20 sm:px-8 lg:px-12 lg:py-28 xl:px-20"
          >
            <div className="grid gap-12 lg:grid-cols-[.64fr_1.36fr] lg:items-end">
              <div>
                <SectionLabel index="02">Preparation method</SectionLabel>
                <h2
                  className="mt-8 break-words text-[clamp(2.6rem,11.5vw,7rem)] sm:text-[clamp(3rem,6vw,7rem)] font-normal leading-[.87] tracking-[-.07em]"
                  style={DISPLAY}
                  data-tkey="text.methodHeading"
                >
                  {methodHeading}
                </h2>
                <p
                  className="mt-6 max-w-lg text-base leading-[1.65] text-[var(--o-comet)]"
                  data-tkey="text.methodIntro"
                >
                  {methodIntro}
                </p>
              </div>
              <div className="relative mx-auto aspect-square w-full max-w-[46rem]">
                <Aperture
                  src={overlayMediaUrl(content, "methodImage", IMAGE.pointDetail)}
                  alt="Generated close view of a gloved painter brushing ivory trim against a star-speckled blue wall with visible wet drips"
                  className="absolute inset-[8%]"
                  tkey="media.methodImage"
                />
                <div
                  className="absolute inset-0 rounded-full border border-[var(--o-comet)]/30"
                  aria-hidden="true"
                />
                <span className="absolute left-1/2 top-0 -translate-x-1/2 bg-[var(--o-void)] px-2 text-xs uppercase tracking-[.1em] text-[var(--o-solar)]">
                  Inspect
                </span>
                <span className="absolute right-0 top-1/3 bg-[var(--o-void)] px-2 text-xs uppercase tracking-[.1em] text-[var(--o-solar)]">
                  Protect
                </span>
                <span className="absolute bottom-[8%] right-[8%] bg-[var(--o-void)] px-2 text-xs uppercase tracking-[.1em] text-[var(--o-solar)]">
                  Repair
                </span>
                <span className="absolute bottom-[8%] left-[8%] bg-[var(--o-void)] px-2 text-xs uppercase tracking-[.1em] text-[var(--o-solar)]">
                  Prepare
                </span>
                <span className="absolute left-0 top-1/3 bg-[var(--o-void)] px-2 text-xs uppercase tracking-[.1em] text-[var(--o-solar)]">
                  Finish
                </span>
              </div>
            </div>
            <ol className="mt-16 grid border-t border-[var(--o-comet)]/25 sm:grid-cols-2 xl:grid-cols-5">
              {PHASES.map((item, index) => (
                <li
                  key={item.title}
                  className="border-b border-[var(--o-comet)]/25 py-7 sm:px-5 sm:[&:nth-child(odd)]:border-r xl:border-r xl:[&:nth-child(odd)]:border-r"
                >
                  <span className="font-mono text-xs text-[var(--o-solar)]">0{index + 1}</span>
                  <h3 className="mt-4 text-xl font-normal" style={DISPLAY}>
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--o-comet)]">{item.body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section
            id="proof"
            className="mx-auto max-w-[1600px] border-t border-[var(--o-comet)]/20 px-5 py-20 sm:px-8 lg:px-12 lg:py-28 xl:px-20"
          >
            <SectionLabel index="03">Matched-frame comparison</SectionLabel>
            <div className="mt-12 grid gap-12 lg:grid-cols-[.62fr_1.38fr] lg:items-center">
              <div>
                <h2
                  className="break-words text-[clamp(2.6rem,11.5vw,6rem)] sm:text-[clamp(3rem,5vw,6rem)] font-normal leading-[.9] tracking-[-.065em]"
                  style={DISPLAY}
                  data-tkey="text.proofTitle"
                >
                  {proofTitle}
                  <br />
                  {proofAccent}
                </h2>
                <p
                  className="mt-6 max-w-lg text-base leading-7 text-[var(--o-comet)]"
                  data-tkey="text.proofBody"
                >
                  {proofBody}
                </p>
                <fieldset className="mt-8">
                  <legend className="text-xs font-bold uppercase tracking-[.1em] text-[var(--o-comet)]">
                    View surface state
                  </legend>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {(["before", "after"] as const).map((state) => (
                      <button
                        key={state}
                        type="button"
                        onClick={() => setComparison(state)}
                        aria-pressed={comparison === state}
                        className={
                          "min-h-12 border px-4 text-xs font-bold uppercase tracking-[.12em] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--o-solar)] " +
                          (comparison === state
                            ? "border-[var(--o-solar)] bg-[var(--o-solar)] text-[var(--o-void)]"
                            : "border-[var(--o-comet)]/55 text-[var(--o-comet)]")
                        }
                      >
                        {state === "before" ? "Existing surface" : "Completed finish"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div aria-live="polite">
                <div className="overflow-hidden border border-[var(--o-comet)]/35 bg-[#101629]">
                  <img
                    src={comparison === "before" ? IMAGE.before : IMAGE.after}
                    alt={
                      comparison === "before"
                        ? "Generated existing room with damaged beige plaster, space murals, an astronaut figure, and a covered sofa before an illustrative repaint"
                        : "Generated version of the same room with dark indigo and warm ivory paint replacing the space murals"
                    }
                    loading="lazy"
                    width={2200}
                    height={1237}
                    className="aspect-video w-full object-cover"
                  />
                </div>
                <p className="mt-5 text-xs leading-5 text-[var(--o-comet)]">
                  <span className="font-bold uppercase tracking-[.12em] text-[var(--o-solar)]">
                    {comparison === "before" ? "Existing surface" : "Completed finish"}
                  </span>{" "}
                  · Generated matched-frame template imagery. Not a verified client project or
                  evidence of a remodel. Replace with documented same-camera project photography
                  before publishing.
                </p>
              </div>
            </div>
            <div className="mt-16 border-y border-[var(--o-comet)]/25 py-9">
              <p
                className="font-mono text-[clamp(1.7rem,4vw,4.5rem)] leading-[.96] tracking-[-.045em]"
                style={DISPLAY}
                data-tkey="text.reviewsHeading"
              >
                {reviewsHeading}
              </p>
              {overlayReviews && overlayReviews.length > 0 ? (
                <div className="mt-8 grid gap-6 text-[var(--o-moon)] sm:grid-cols-3">
                  {overlayReviews.map((review, index) => (
                    <figure key={`${review.author}-${index}`} className="min-w-0">
                      <blockquote
                        className="text-sm leading-6 normal-case tracking-normal"
                        data-tkey={`reviews.${index}.quote`}
                      >
                        {review.quote}
                      </blockquote>
                      <figcaption
                        className="mt-4 text-xs uppercase tracking-[.13em] text-[var(--o-solar)]"
                        data-tkey={`reviews.${index}.author`}
                      >
                        {review.author}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : overlayReviews === null ? (
                <div className="mt-8 grid gap-4 text-xs uppercase tracking-[.13em] text-[var(--o-comet)] sm:grid-cols-3">
                  <span>Interior · Awaiting verified feedback</span>
                  <span>Exterior · Awaiting verified feedback</span>
                  <span>Cabinetry · Awaiting verified feedback</span>
                </div>
              ) : null}
              <p
                className="mt-7 max-w-3xl text-sm leading-6 text-[var(--o-comet)]"
                data-tkey="text.reviewsBody"
              >
                {reviewsBody}
              </p>
            </div>
          </section>

          <section
            id="notes"
            className="mx-auto max-w-[1600px] border-t border-[var(--o-comet)]/20 px-5 py-20 sm:px-8 lg:px-12 lg:py-28 xl:px-20"
          >
            <div className="grid gap-14 lg:grid-cols-[1.2fr_.8fr] lg:items-center">
              <div className="relative mx-auto aspect-square w-full max-w-[50rem]">
                <Aperture
                  src={overlayMediaUrl(content, "planImage", IMAGE.journalColor)}
                  alt="Illustrative dark painted rooms and circular architectural openings under varied blue and warm light"
                  className="absolute inset-[5%]"
                  tkey="media.planImage"
                />
                <div
                  className="absolute inset-0 rounded-full border border-[var(--o-comet)]/25"
                  aria-hidden="true"
                />
              </div>
              <div>
                <SectionLabel index="04">Color + planning notes</SectionLabel>
                <h2
                  className="mt-8 break-words text-[clamp(2.6rem,11.5vw,6rem)] sm:text-[clamp(3rem,5vw,6rem)] font-normal leading-[.9] tracking-[-.065em]"
                  style={DISPLAY}
                  data-tkey="text.planHeading"
                >
                  {planHeading}
                </h2>
                <div className="mt-8 grid border-t border-[var(--o-comet)]/25">
                  {OBSERVATORY.map((item, index) => (
                    <div
                      key={item.title}
                      className="grid gap-3 border-b border-[var(--o-comet)]/25 py-5 sm:grid-cols-[2rem_7rem_1fr]"
                    >
                      <span className="font-mono text-xs text-[var(--o-solar)]">0{index + 1}</span>
                      <h3 className="text-sm font-normal" style={DISPLAY}>
                        {item.title}
                      </h3>
                      <p className="text-sm leading-6 text-[var(--o-comet)]">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-20 border-t border-[var(--o-comet)]/25">
              {ARTICLES.map((article, index) => (
                <div
                  key={article.number}
                  className="group grid gap-5 border-b border-[var(--o-comet)]/25 py-7 sm:grid-cols-[3rem_1fr_180px] sm:items-center"
                >
                  <span className="font-mono text-xs text-[var(--o-solar)]">{article.number}</span>
                  <h3
                    className="text-xl font-normal sm:text-2xl"
                    style={DISPLAY}
                    data-tkey={`blogs.${index}.title`}
                  >
                    {content?.blogs?.[index]?.title ?? article.title}
                  </h3>
                  <div className="aspect-[3/1] overflow-hidden rounded-[50%]">
                    <img
                      src={overlayMediaUrl(content, `journalImage${index}`, article.image)}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                      data-tkey={`media.journalImage${index}`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-[var(--o-comet)]">
              Sample editorial topics only; no linked articles are published.
            </p>
          </section>

          <section
            id="manual"
            className="mx-auto max-w-[1600px] border-t border-[var(--o-comet)]/20 px-5 py-20 sm:px-8 lg:px-12 lg:py-28 xl:px-20"
          >
            <SectionLabel index="05">Practical field manual</SectionLabel>
            <div className="mt-9 grid gap-8 lg:grid-cols-[.65fr_1.35fr]">
              <h2
                className="break-words text-[clamp(2.6rem,11.5vw,6rem)] sm:text-[clamp(3rem,5vw,6rem)] font-normal leading-[.9] tracking-[-.065em]"
                style={DISPLAY}
                data-tkey="text.faqTitle"
              >
                {faqTitle}
              </h2>
              <p
                className="max-w-xl text-base leading-7 text-[var(--o-comet)]"
                data-tkey="text.faqIntro"
              >
                {faqIntro}
              </p>
            </div>
            <div className="mt-14 border-t border-[var(--o-comet)]/25">
              {FAQS.map((item, index) => (
                <article
                  key={item.q}
                  className="grid gap-5 border-b border-[var(--o-comet)]/25 py-7 lg:grid-cols-[3rem_.8fr_1.2fr]"
                >
                  <span className="font-mono text-xs text-[var(--o-solar)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-lg font-normal leading-6" style={DISPLAY}>
                    {item.q}
                  </h3>
                  <p className="max-w-2xl text-sm leading-6 text-[var(--o-comet)]">{item.a}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="relative border-t border-[var(--o-comet)]/20 px-5 pb-40 pt-20 sm:px-8 lg:px-12 lg:pb-44 lg:pt-28 xl:px-20">
            <div className="mx-auto max-w-[1440px]">
              <div className="grid gap-12 lg:grid-cols-[1fr_.9fr] lg:items-center">
                <div className="relative overflow-hidden border border-[var(--o-comet)]/35 bg-[#101629]">
                  <img
                    src={overlayMediaUrl(content, "ctaImage", IMAGE.cta)}
                    alt="Illustrative finished living room with smooth dark painted walls, ivory paneling, and restrained circular architectural light"
                    loading="lazy"
                    width={2200}
                    height={1650}
                    className="aspect-[4/3] w-full object-cover"
                    data-tkey="media.ctaImage"
                  />
                  <div
                    className="pointer-events-none absolute inset-4 border border-[var(--o-moon)]/10"
                    aria-hidden="true"
                  />
                </div>
                <div>
                  <SectionLabel index="06">Bring the real scope into view</SectionLabel>
                  <h2
                    className="mt-8 text-[clamp(3rem,5vw,6rem)] font-normal leading-[.9] tracking-[-.065em]"
                    style={DISPLAY}
                    data-tkey="text.ctaTitle"
                  >
                    {ctaTitle}
                  </h2>
                  <p
                    className="mt-6 text-base leading-7 text-[var(--o-comet)]"
                    data-tkey="text.ctaBody"
                  >
                    {ctaBody}
                  </p>
                  <div className="mt-8 grid border-t border-[var(--o-comet)]/25 text-sm sm:grid-cols-2">
                    {[
                      "Surfaces + condition",
                      "Repairs + access",
                      "Color + finish",
                      "Timing + occupancy",
                      "Protection needs",
                      "Address + service fit",
                    ].map((item, index) => (
                      <span
                        key={item}
                        className="border-b border-[var(--o-comet)]/25 py-4 text-[var(--o-comet)] sm:pr-4"
                      >
                        <b className="mr-3 font-mono text-[var(--o-solar)]">0{index + 1}</b>
                        {item}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => setBookingOpen(true)}
                    className="mt-9 min-h-14 bg-[var(--o-solar)] px-6 mb-20 sm:mb-0 text-sm font-bold uppercase tracking-[.1em] text-[var(--o-void)] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--o-solar)]"
                  >
                    Check project fit <ArrowUpRight className="ml-3 inline size-4" />
                  </button>
                  <p className="mt-5 text-xs leading-5 text-[var(--o-comet)]">
                    Preview limitation: this sandbox starts at sample scheduling and does not
                    collect the fit details above. It creates no appointment, project brief, or card
                    charge.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <footer className="border-t border-[var(--o-comet)]/20 px-5 pb-24 pt-12 sm:px-8 lg:px-12 xl:px-20">
            <div className="mx-auto grid max-w-[1440px] gap-10 lg:grid-cols-[1fr_.7fr_.7fr]">
              <div>
                <p
                  className="min-w-0 font-mono text-3xl uppercase tracking-[-.04em]"
                  style={DISPLAY}
                >
                  <BrandMark brand={brandLabel} logoUrl={logoUrl} />
                </p>
                <p className="mt-4 max-w-sm text-sm leading-6 text-[var(--o-comet)]">
                  Fictional residential painting template. Replace imagery, services, scope, proof,
                  and contact details before publishing.
                </p>
              </div>
              <div className="text-xs leading-7 uppercase tracking-[.1em] text-[var(--o-comet)]">
                <p className="text-[var(--o-moon)]">Sample contact</p>
                <a href={phoneHref} className="block" data-tkey="contact.phone">
                  {phoneLabel}
                </a>
                <a href={emailHref} className="block normal-case" data-tkey="contact.email">
                  {emailLabel}
                </a>
              </div>
              <div className="text-xs leading-7 uppercase tracking-[.1em] text-[var(--o-comet)]">
                <p className="text-[var(--o-moon)]">Template scope</p>
                <p>Interior · Exterior</p>
                <p>Cabinet refinishing</p>
                <a
                  href="#top"
                  className="mt-3 inline-flex items-center gap-2 text-[var(--o-solar)]"
                >
                  Return to top <ArrowDown className="size-3 rotate-180" />
                </a>
              </div>
            </div>
            <div className="mx-auto mt-12 flex max-w-[1440px] flex-wrap justify-between gap-4 border-t border-[var(--o-comet)]/20 pt-6 text-[10px] uppercase tracking-[.16em] text-[var(--o-comet)]">
              <span>
                {brandName ? `© 2026 ${brandName}` : "© 2026 True Coat · Template preview"}
              </span>
              <span>Generated illustrative media · Not documented client work</span>
            </div>
          </footer>
        </main>
      </div>

      <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
    </div>
  );
}
