import { ArrowDownRight, ArrowRight, Check, Plus } from "lucide-react";
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

const MEDIA = "/templates/cutline/generated";
const GOOGLE_LOGO = "/templates/garden-delite/brands/google.svg";
const YELP_LOGO = "/templates/garden-delite/brands/yelp.svg";
const DISPLAY = { fontFamily: '"Trebuchet MS", "Segoe UI", Arial, sans-serif' } as const;
const BODY = {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
} as const;

// Three UI roles sampled from the shipped hero: warm painted wall, dark workwear,
// and blue masking tape. All other hues live in the photography, not the interface.
const PALETTE = {
  primer: "#eee9df",
  graphite: "#252429",
  tape: "#1d5f96",
} as const;

const THEME = {
  "--p-primer": PALETTE.primer,
  "--p-graphite": PALETTE.graphite,
  "--p-tape": PALETTE.tape,
} as React.CSSProperties;

const IMAGE = {
  hero: MEDIA + "/cutline-hero.jpg",
  heroVideo: MEDIA + "/cutline-loop.mp4",
  proof: MEDIA + "/gallery-poster.jpg",
  before: MEDIA + "/project-before.jpg",
  after: MEDIA + "/project-after.jpg",
  inspect: MEDIA + "/studio-detail.jpg",
  protect: MEDIA + "/prep-protect.jpg",
  repair: MEDIA + "/prep-repair.jpg",
  prepare: MEDIA + "/studio-craft.jpg",
  finish: MEDIA + "/prep-finish.jpg",
  walls: MEDIA + "/service-interior.jpg",
  trim: MEDIA + "/surface-trim.jpg",
  exterior: MEDIA + "/surface-exterior.jpg",
  cabinets: MEDIA + "/surface-cabinet.jpg",
  color: MEDIA + "/journal-color.jpg",
  sheen: MEDIA + "/journal-finish.jpg",
} as const;

const surfaces = [
  {
    title: "Walls & ceilings",
    scope: "Interior painting",
    text: "Condition, repairs, access, room use, and desired sheen shape the example scope.",
    image: IMAGE.walls,
    alt: "Finished interior walls and curved ceiling in cool daylight",
    background: PALETTE.primer,
    foreground: PALETTE.graphite,
  },
  {
    title: "Trim & doors",
    scope: "Detail work",
    text: "Existing coatings, adhesion, edge condition, hardware, and finish compatibility should be verified on site.",
    image: IMAGE.trim,
    alt: "Finished chalk door and graphite trim with a crisp cutline",
    background: PALETTE.tape,
    foreground: PALETTE.primer,
  },
  {
    title: "Siding & stucco",
    scope: "Exterior painting",
    text: "Weather, substrate, exposure, access, and coating requirements determine suitability and timing.",
    image: IMAGE.exterior,
    alt: "Completed mid-century home exterior with chalk siding and graphite trim",
    background: PALETTE.primer,
    foreground: PALETTE.graphite,
  },
  {
    title: "Cabinet doors & frames",
    scope: "Cabinet refinishing",
    text: "A sample cabinet process organized around cleaning, adhesion, smooth application, and finish planning.",
    image: IMAGE.cabinets,
    alt: "Mid-century kitchen with chalk cabinetry and graphite island",
    background: PALETTE.graphite,
    foreground: PALETTE.primer,
  },
] as const;

const preparation = [
  {
    title: "Inspect",
    image: IMAGE.inspect,
    alt: "Gloved painter inspecting a trim edge in raking light",
    placement: "lg:col-span-5 lg:row-span-2",
  },
  {
    title: "Protect",
    image: IMAGE.protect,
    alt: "Floor and furniture protected before residential painting",
    placement: "lg:col-span-3",
  },
  {
    title: "Repair",
    image: IMAGE.repair,
    alt: "Small plaster repair prepared under raking light",
    placement: "lg:col-span-4",
  },
  {
    title: "Prepare",
    image: IMAGE.prepare,
    alt: "Painter masking architectural trim before coating",
    placement: "lg:col-span-4",
  },
  {
    title: "Finish",
    image: IMAGE.finish,
    alt: "Painter applying the final controlled wall coat",
    placement: "lg:col-span-3",
  },
] as const;

const notes = [
  {
    kicker: "Color",
    title: "Read undertones in the room’s actual light.",
    text: "Use physical samples and review them across morning, afternoon, and evening conditions before confirming a color direction.",
    color: PALETTE.primer,
    foreground: PALETTE.graphite,
  },
  {
    kicker: "Scope",
    title: "Preparation belongs in the written plan.",
    text: "Repairs, protection, cleaning, sanding, priming, access, and exclusions should be explicit rather than implied.",
    color: PALETTE.primer,
    foreground: PALETTE.graphite,
  },
  {
    kicker: "Schedule",
    title: "Let conditions—not slogans—set timing.",
    text: "Project length depends on verified scope, repairs, drying conditions, crew size, access, and product requirements.",
    color: PALETTE.primer,
    foreground: PALETTE.graphite,
  },
  {
    kicker: "Project day",
    title: "Confirm access before work begins.",
    text: "Secure fragile items, review moving needs, clarify pets and parking, and agree on daily cleanup and communication.",
    color: PALETTE.primer,
    foreground: PALETTE.graphite,
  },
] as const;

const questions = [
  [
    "How should I prepare my home?",
    "Confirm moving needs, secure fragile objects, and review access, pets, parking, and daily cleanup with the contractor.",
  ],
  [
    "How long might a project take?",
    "Timing follows verified scope, repair needs, access, drying conditions, crew size, and product instructions.",
  ],
  [
    "Can someone help with color?",
    "The template can describe a real sampling or consultation service once the publishing contractor confirms it.",
  ],
  [
    "What products are used?",
    "Specify only products and systems actually selected for the substrate, compatibility, conditions, and desired finish.",
  ],
  [
    "Can the home stay occupied?",
    "That depends on scope, ventilation, product requirements, household needs, and an agreed daily work plan.",
  ],
  [
    "What does cabinet refinishing include?",
    "Document cleaning, disassembly, repairs, adhesion steps, application method, cure time, and exclusions.",
  ],
  [
    "How does weather affect exterior work?",
    "Surface moisture, temperature, wind, exposure, and manufacturer requirements can all affect scheduling.",
  ],
  [
    "How does this estimate demo work?",
    "Choose a date and time, then view a clearly simulated payment step; no real service or charge occurs.",
  ],
] as const;

const reviewSlots = [
  { role: "Interior", source: "Google", logo: GOOGLE_LOGO },
  { role: "Exterior", source: "Yelp", logo: YELP_LOGO },
  { role: "Cabinet refinishing", source: "Google", logo: GOOGLE_LOGO },
] as const;

const estimateItems = [
  "Surfaces and current condition",
  "Repairs and access",
  "Color and finish goals",
  "Timing and occupancy",
  "Protection requirements",
  "Address and service-area fit",
] as const;

function TapeLabel({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p
      className={
        "inline-flex min-h-8 items-center border-l-[10px] px-3 text-xs font-bold uppercase tracking-[.14em] " +
        (light
          ? "border-[var(--p-tape)] bg-[var(--p-primer)] text-[var(--p-graphite)]"
          : "border-[var(--p-tape)] bg-[var(--p-graphite)] text-[var(--p-primer)]")
      }
    >
      {children}
    </p>
  );
}

function PrimaryButton({
  children,
  onClick,
  inverse = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  inverse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group relative inline-flex min-h-14 items-center overflow-hidden border-2 border-[var(--p-graphite)] px-6 text-sm font-bold focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[var(--p-tape)] " +
        (inverse
          ? "bg-[var(--p-primer)] text-[var(--p-graphite)]"
          : "bg-[var(--p-graphite)] text-[var(--p-primer)]")
      }
    >
      <span className="absolute inset-y-0 left-0 w-2 bg-[var(--p-tape)] transition-[width] duration-300 group-hover:w-full motion-reduce:transition-none" />
      <span className="relative z-10 flex items-center gap-5 group-hover:text-[var(--p-primer)]">
        {children}
        <ArrowDownRight className="size-5 transition-transform group-hover:rotate-45 motion-reduce:transition-none" />
      </span>
    </button>
  );
}

function BrandMark({ brand, logoUrl }: { brand: string; logoUrl: string | null }) {
  const initials = brand
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
  return (
    <>
      <span
        className="overlay-brand-mark grid size-10 shrink-0 place-items-center overflow-hidden border-2 border-[var(--p-tape)] bg-[var(--p-primer)] text-sm font-bold text-[var(--p-graphite)]"
        data-tkey="media.logo"
      >
        {logoUrl ? <img src={logoUrl} alt="" className="size-full object-contain" /> : initials}
      </span>
      <span className="overlay-brand-name min-w-0">{brand}</span>
    </>
  );
}

function HeroMedia({
  motionReady,
  reduceMotion,
  videoRef,
  poster,
}: {
  motionReady: boolean;
  reduceMotion: boolean | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  poster: string;
}) {
  return (
    <>
      <img
        src={poster}
        alt="Gloved painter peeling blue masking tape from a freshly finished doorway"
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover object-[59%_center] sm:object-[62%_center]"
        data-tkey="media.heroPoster"
      />
      {!motionReady || reduceMotion ? null : (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster}
          aria-label="Painter peeling tape to reveal a crisp finished edge"
          className="absolute inset-0 size-full object-cover object-[59%_center] sm:object-[62%_center]"
        >
          <source src={IMAGE.heroVideo} type="video/mp4" />
        </video>
      )}
    </>
  );
}

export function PainterOneTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "The finish starts";
  const heroAccent = text?.heroAccent ?? "before the first coat.";
  const heroSub =
    text?.heroSub ??
    "A precise, prep-first template for interior painting, exterior preparation, and cabinet refinishing.";
  const detailTitle = text?.detailTitle ?? "Prep is the performance. Color is the reveal.";
  const proofTitle = text?.proofTitle ?? "Documented change, shown side by side.";
  const proofBody =
    text?.proofBody ??
    "These matched-camera images illustrate how finish can alter a room without pretending a paint project is a remodel or a completed client job.";
  const servicesHeading = text?.servicesHeading ?? "Let every finish take the frame.";
  const servicesIntro =
    text?.servicesIntro ??
    "Each chapter pairs a large visual with the condition, preparation, access, and finish questions that shape real scope.";
  const processHeading = text?.processHeading ?? "The good mess before the clean edge.";
  const processIntro =
    text?.processIntro ??
    "A serious sequence in a playful frame: inspect, protect, repair, prepare, and finish.";
  const reviewsHeading = text?.reviewsHeading ?? "No verified reviews supplied.";
  const reviewsBody =
    text?.reviewsBody ??
    "These empty roles show structure only. There are no ratings, portraits, names, locations, or fabricated quotes. Replace every slot with verified, permissioned feedback before publishing.";
  const planHeading = text?.planHeading ?? "Color likes context.";
  const planIntro =
    text?.planIntro ??
    "Useful decisions before beautiful finishes: color, scope, schedule, and project-day access.";
  const faqTitle = text?.faqTitle ?? "Ask before the lid opens.";
  const estimateTitle = text?.estimateTitle ?? "Bring the real scope into view.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const rawEmail = content?.email?.trim() ? content.email.trim() : null;
  const emailLabel = rawEmail ?? "hello@example.com";
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "TRUE COAT";
  const brandAria = brandName ? `${brandName} home` : "True Coat home";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const reduceMotion = useReducedMotion();
  const [motionReady, setMotionReady] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => setMotionReady(true), []);

  return (
    <div
      style={{ ...BODY, ...THEME }}
      className="min-h-screen overflow-x-hidden bg-[var(--p-primer)] text-[var(--p-graphite)] selection:bg-[var(--p-tape)] selection:text-[var(--p-primer)]"
    >
      <header className="relative z-50 border-b border-[var(--p-primer)]/15 bg-[var(--p-graphite)] px-5 text-[var(--p-primer)] sm:px-8 lg:px-12">
        <div className="mx-auto flex min-h-[74px] max-w-[1520px] items-center justify-between gap-5">
          <a
            href="#top"
            style={DISPLAY}
            className="flex min-w-0 items-center gap-3 text-2xl font-bold tracking-[-.06em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--p-tape)]"
            aria-label={brandAria}
          >
            <BrandMark brand={brandLabel} logoUrl={logoUrl} />
          </a>
          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-8 text-sm font-semibold md:flex"
          >
            <a href="#work" className="hover:text-[var(--p-primer)]">
              Projects
            </a>
            <a href="#surfaces" className="hover:text-[var(--p-primer)]">
              Surfaces
            </a>
            <a href="#process" className="hover:text-[var(--p-primer)]">
              Process
            </a>
            <a href="#notes" className="hover:text-[var(--p-primer)]">
              Color notes
            </a>
          </nav>
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="min-h-11 border-l-[8px] border-[var(--p-primer)] bg-[var(--p-primer)] px-4 text-xs font-bold uppercase tracking-[.1em] text-[var(--p-graphite)] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-6"
          >
            Plan a finish <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="relative min-h-[800px] overflow-hidden bg-[var(--p-primer)] sm:min-h-[900px] lg:min-h-[calc(100svh-74px)]">
          <HeroMedia
            motionReady={motionReady}
            reduceMotion={reduceMotion}
            videoRef={videoRef}
            poster={heroPoster}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(246,241,231,.98)_0%,rgba(246,241,231,.88)_27%,rgba(246,241,231,.18)_54%,transparent_68%)] lg:block"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/55 to-transparent lg:hidden"
          />

          <div className="relative z-20 mx-auto flex min-h-[800px] max-w-[1520px] items-end px-5 pb-10 pt-10 sm:min-h-[900px] sm:px-8 sm:pb-14 lg:min-h-[calc(100svh-74px)] lg:items-center lg:px-12 lg:py-16">
            <div className="w-full border-l-[12px] border-[var(--p-tape)] bg-[var(--p-primer)]/95 p-5 backdrop-blur-sm sm:max-w-[650px] sm:p-7 lg:max-w-[610px] lg:bg-transparent lg:p-0 lg:pl-8 lg:backdrop-blur-none">
              <TapeLabel light>Residential painting</TapeLabel>
              <h1
                style={DISPLAY}
                className="mt-5 text-[clamp(3.25rem,12vw,5.2rem)] font-bold leading-[.88] tracking-[-.065em] lg:text-[clamp(5.5rem,7.8vw,8rem)]"
                data-tkey="text.heroTitle"
              >
                {heroTitle}
                <span
                  className="mt-3 block w-fit bg-[var(--p-tape)] px-3 py-2 text-[.72em] leading-[.92] tracking-[-.05em] text-[var(--p-primer)]"
                  data-tkey="text.heroAccent"
                >
                  {heroAccent}
                </span>
              </h1>
              <p
                className="mt-6 max-w-[42ch] text-base font-medium leading-7 sm:text-lg"
                data-tkey="text.heroSub"
              >
                {heroSub}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-5">
                <PrimaryButton onClick={() => setBookingOpen(true)}>
                  Request a site visit
                </PrimaryButton>
                <a
                  href={phoneHref}
                  data-tkey="contact.phone"
                  className="min-h-11 py-3 text-xs font-bold uppercase tracking-[.12em] text-[var(--p-graphite)] underline decoration-[var(--p-tape)] decoration-4 underline-offset-4"
                >
                  {rawPhone ? phoneLabel : "Sample call · (555) 013-7482"}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section
          aria-label="Clean-edge proof"
          className="relative h-[68svh] min-h-[540px] overflow-hidden border-y-[8px] border-[var(--p-tape)] bg-[var(--p-graphite)] sm:h-[82svh]"
        >
          <img
            src={overlayMediaUrl(content, "proofImage", IMAGE.proof)}
            alt="Close view of blue masking tape being pulled from a painted edge"
            loading="lazy"
            className="size-full object-cover object-center"
            data-tkey="media.proofImage"
          />
          <div className="absolute inset-x-0 bottom-0 grid gap-5 bg-[var(--p-graphite)]/94 px-5 py-7 text-[var(--p-primer)] backdrop-blur-sm sm:px-10 lg:grid-cols-[1fr_360px] lg:items-end lg:px-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.14em] text-[var(--p-primer)]">
                The clean-edge payoff
              </p>
              <h2
                style={DISPLAY}
                className="mt-2 max-w-[19ch] text-4xl font-bold leading-[.98] tracking-[-.045em] sm:text-6xl"
                data-tkey="text.detailTitle"
              >
                {detailTitle}
              </h2>
            </div>
            <p className="text-base leading-7 text-[var(--p-primer)]/70">
              Illustrative template media. Replace with documented project photography before
              publishing.
            </p>
          </div>
        </section>

        <section id="work" className="bg-[var(--p-primer)] px-5 py-24 sm:px-8 lg:px-12 lg:py-36">
          <div className="mx-auto max-w-[1460px]">
            <div className="grid gap-8 lg:grid-cols-[.68fr_1.32fr] lg:items-end">
              <div>
                <TapeLabel>Same room · two moods</TapeLabel>
                <h2
                  style={DISPLAY}
                  className="mt-6 max-w-[10ch] text-5xl font-bold leading-[.92] tracking-[-.055em] sm:text-7xl"
                  data-tkey="text.proofTitle"
                >
                  {proofTitle}
                </h2>
              </div>
              <p
                className="max-w-xl text-lg leading-8 text-[var(--p-tape)]"
                data-tkey="text.proofBody"
              >
                {proofBody}
              </p>
            </div>

            <div className="mt-12 grid gap-4 md:grid-cols-2">
              <figure className="relative border-b-[8px] border-[var(--p-tape)] bg-[var(--p-graphite)]">
                <img
                  src={IMAGE.before}
                  alt="Room with worn gray surfaces before painting"
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                <figcaption className="absolute left-4 top-4 bg-[var(--p-primer)] px-4 py-2 text-xs font-bold uppercase tracking-[.12em]">
                  01 · Existing surface
                </figcaption>
              </figure>
              <figure className="relative border-b-[8px] border-[var(--p-tape)] bg-[var(--p-graphite)]">
                <img
                  src={IMAGE.after}
                  alt="Same room with completed warm neutral finish"
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover"
                />
                <figcaption className="absolute left-4 top-4 bg-[var(--p-primer)] px-4 py-2 text-xs font-bold uppercase tracking-[.12em]">
                  02 · Completed finish
                </figcaption>
              </figure>
            </div>

            <dl className="mt-8 grid border-y-2 border-[var(--p-graphite)] sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Substrate", "Plaster"],
                ["Repairs", "Illustrative"],
                ["Primer", "As required"],
                ["Coats", "Per product"],
                ["Sheen", "Sample only"],
                ["Duration", "Scope-led"],
              ].map(([term, value], index) => (
                <div
                  key={term}
                  className={
                    "min-h-24 border-[var(--p-graphite)] p-4 sm:border-r sm:last:border-r-0 " +
                    (index === 1 || index === 4 ? "bg-[var(--p-primer)]" : "bg-transparent")
                  }
                >
                  <dt className="text-xs font-bold uppercase tracking-[.12em] text-[var(--p-tape)]">
                    {term}
                  </dt>
                  <dd className="mt-3 text-sm font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="surfaces"
          className="bg-[var(--p-graphite)] px-5 py-24 text-[var(--p-primer)] sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto max-w-[1460px]">
            <div className="grid gap-8 border-b border-[var(--p-primer)]/25 pb-12 lg:grid-cols-[1fr_420px] lg:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--p-primer)]">
                  Surface stories
                </p>
                <h2
                  style={DISPLAY}
                  className="mt-5 max-w-[12ch] text-6xl font-bold leading-[.9] tracking-[-.055em] sm:text-8xl"
                  data-tkey="text.servicesHeading"
                >
                  {servicesHeading}
                </h2>
              </div>
              <p
                className="text-lg leading-8 text-[var(--p-primer)]/70"
                data-tkey="text.servicesIntro"
              >
                {servicesIntro}
              </p>
            </div>

            <div className="mt-16 space-y-16 lg:space-y-24">
              {surfaces.map((surface, index) => (
                <article
                  key={surface.title}
                  className="grid min-h-[620px] overflow-hidden border border-[var(--p-primer)]/30 lg:grid-cols-[1.65fr_.75fr]"
                >
                  <div className={index % 2 ? "lg:order-2" : ""}>
                    <img
                      src={overlayMediaUrl(content, `serviceImage${index}`, surface.image)}
                      alt={surface.alt}
                      loading="lazy"
                      className="h-full min-h-[380px] w-full object-cover"
                      data-tkey={`media.serviceImage${index}`}
                    />
                  </div>
                  <div
                    className={
                      "flex flex-col justify-between p-7 sm:p-10 lg:p-12 " +
                      (index % 2 ? "lg:order-1" : "")
                    }
                    style={{ backgroundColor: surface.background, color: surface.foreground }}
                  >
                    <div className="flex items-center justify-between gap-5 border-b-2 border-current pb-4 text-xs font-bold uppercase tracking-[.13em]">
                      <span>
                        0{index + 1} · {surface.scope}
                      </span>
                      <ArrowRight className="size-5" />
                    </div>
                    <div>
                      <h3
                        style={DISPLAY}
                        className="text-4xl font-bold leading-[.92] tracking-[-.045em] sm:text-6xl"
                      >
                        {surface.title}
                      </h3>
                      <p className="mt-6 max-w-[40ch] text-base font-medium leading-7">
                        {surface.text}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="process"
          className="bg-[var(--p-primer)] px-5 py-24 text-[var(--p-graphite)] sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto max-w-[1460px]">
            <div className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-end">
              <div>
                <TapeLabel light>Preparation contact sheet</TapeLabel>
                <h2
                  style={DISPLAY}
                  className="mt-6 max-w-[12ch] text-6xl font-bold leading-[.9] tracking-[-.055em] sm:text-8xl"
                  data-tkey="text.processHeading"
                >
                  {processHeading}
                </h2>
              </div>
              <p className="text-lg font-medium leading-8" data-tkey="text.processIntro">
                {processIntro}
              </p>
            </div>

            <div className="mt-14 grid gap-3 lg:grid-cols-12 lg:auto-rows-[310px]">
              {preparation.map((step, index) => (
                <figure
                  key={step.title}
                  className={
                    "group relative min-h-[330px] overflow-hidden bg-[var(--p-graphite)] " +
                    step.placement
                  }
                >
                  <img
                    src={overlayMediaUrl(content, `processImage${index + 1}`, step.image)}
                    alt={step.alt}
                    loading="lazy"
                    className="size-full object-cover transition-transform duration-700 group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    data-tkey={`media.processImage${index + 1}`}
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-[var(--p-graphite)]/94 px-5 py-4 text-[var(--p-primer)] backdrop-blur-sm">
                    <span style={DISPLAY} className="text-2xl font-bold">
                      {step.title}
                    </span>
                    <span className="border-l-[8px] border-[var(--p-primer)] pl-3 text-xs font-bold">
                      0{index + 1}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[var(--p-primer)] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1360px]">
            <div className="max-w-3xl">
              <TapeLabel>Review layout preview</TapeLabel>
              <h2
                style={DISPLAY}
                className="mt-6 text-5xl font-bold leading-[.94] tracking-[-.05em] sm:text-7xl"
                data-tkey="text.reviewsHeading"
              >
                {reviewsHeading}
              </h2>
              <p
                className="mt-6 text-lg leading-8 text-[var(--p-tape)]"
                data-tkey="text.reviewsBody"
              >
                {reviewsBody}
              </p>
            </div>

            {overlayReviews && overlayReviews.length > 0 ? (
              <div className="mt-12 grid border-x border-t border-[var(--p-graphite)] lg:grid-cols-3">
                {overlayReviews.map((review, index) => (
                  <article
                    key={`${review.author}-${index}`}
                    className="flex min-h-64 flex-col justify-between border-b border-[var(--p-graphite)] p-6 lg:border-r lg:last:border-r-0 lg:p-8"
                  >
                    <blockquote
                      className="text-lg font-medium leading-7"
                      data-tkey={`reviews.${index}.quote`}
                    >
                      {review.quote}
                    </blockquote>
                    <p
                      style={DISPLAY}
                      className="mt-6 border-t border-[var(--p-graphite)]/25 pt-5 text-sm font-bold"
                      data-tkey={`reviews.${index}.author`}
                    >
                      {review.author}
                    </p>
                  </article>
                ))}
              </div>
            ) : overlayReviews === null ? (
              <div className="mt-12 grid border-x border-t border-[var(--p-graphite)] lg:grid-cols-3">
                {reviewSlots.map((slot, index) => (
                  <article
                    key={slot.role}
                    className="flex min-h-64 flex-col justify-between border-b border-[var(--p-graphite)] p-6 lg:border-r lg:last:border-r-0 lg:p-8"
                  >
                    <div>
                      <span className="text-xs font-bold uppercase tracking-[.14em] text-[var(--p-tape)]">
                        Empty review role 0{index + 1}
                      </span>
                      <h3 style={DISPLAY} className="mt-4 text-3xl font-bold">
                        {slot.role}
                      </h3>
                    </div>
                    <div className="flex items-end justify-between gap-5 border-t border-[var(--p-graphite)]/25 pt-5">
                      <span className="max-w-[22ch] text-xs font-semibold leading-5 text-[var(--p-tape)]">
                        Example source badge placement — not a live review
                      </span>
                      <img
                        src={slot.logo}
                        alt={slot.source}
                        className={slot.source === "Yelp" ? "h-6 w-auto" : "h-5 w-auto"}
                      />
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section
          id="notes"
          className="bg-[var(--p-graphite)] px-5 py-24 text-[var(--p-primer)] sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto max-w-[1460px]">
            <div className="grid gap-10 lg:grid-cols-[.68fr_1.32fr] lg:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--p-primer)]">
                  Color lab / scope notebook
                </p>
                <h2
                  style={DISPLAY}
                  className="mt-5 max-w-[9ch] text-6xl font-bold leading-[.9] tracking-[-.055em] sm:text-8xl"
                  data-tkey="text.planHeading"
                >
                  {planHeading}
                </h2>
              </div>
              <p
                className="max-w-xl text-lg leading-8 text-[var(--p-primer)]/70"
                data-tkey="text.planIntro"
              >
                {planIntro}
              </p>
            </div>

            <div className="mt-14 grid gap-3 md:grid-cols-2">
              <figure className="relative min-h-[480px] overflow-hidden border-b-[10px] border-[var(--p-tape)] sm:min-h-[620px]">
                <img
                  src={overlayMediaUrl(content, "notesImage0", IMAGE.color)}
                  alt="Unlabeled paint swatches viewed in daylight"
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                  data-tkey="media.notesImage0"
                />
              </figure>
              <figure className="relative min-h-[480px] overflow-hidden border-b-[10px] border-[var(--p-tape)] sm:min-h-[620px]">
                <img
                  src={overlayMediaUrl(content, "notesImage1", IMAGE.sheen)}
                  alt="Three paint brush-outs showing varied surface reflection"
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                  data-tkey="media.notesImage1"
                />
              </figure>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {notes.map((note, index) => (
                <article
                  key={note.kicker}
                  style={{ backgroundColor: note.color, color: note.foreground }}
                  className="p-6 sm:p-8"
                >
                  <div className="flex items-center justify-between gap-4 border-b border-[var(--p-graphite)]/35 pb-4 text-xs font-bold uppercase tracking-[.13em]">
                    <span>
                      0{index + 1} · {note.kicker}
                    </span>
                    <span className="h-2 w-20 bg-[var(--p-tape)]" />
                  </div>
                  <h3
                    style={DISPLAY}
                    className="mt-7 max-w-[18ch] text-3xl font-bold leading-[1] tracking-[-.035em] sm:text-4xl"
                  >
                    {note.title}
                  </h3>
                  <p className="mt-5 max-w-[48ch] text-base font-medium leading-7">{note.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[var(--p-primer)] px-5 py-24 sm:px-8 lg:px-12 lg:py-36">
          <div className="mx-auto max-w-[1220px]">
            <div className="grid gap-10 lg:grid-cols-[.55fr_1.45fr]">
              <div className="lg:sticky lg:top-10 lg:self-start">
                <TapeLabel>Eight practical questions</TapeLabel>
                <h2
                  style={DISPLAY}
                  className="mt-6 max-w-[9ch] text-5xl font-bold leading-[.92] tracking-[-.05em] sm:text-7xl"
                  data-tkey="text.faqTitle"
                >
                  {faqTitle}
                </h2>
              </div>
              <div className="border-t-2 border-[var(--p-graphite)]">
                {questions.map(([question, answer], index) => (
                  <details
                    key={question}
                    className="group border-b-2 border-[var(--p-graphite)] open:bg-[var(--p-primer)]"
                  >
                    <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-5 px-4 py-5 sm:px-6">
                      <span style={DISPLAY} className="text-lg font-bold sm:text-2xl">
                        {String(index + 1).padStart(2, "0")} / {question}
                      </span>
                      <span className="grid size-11 shrink-0 place-items-center border-2 border-[var(--p-graphite)] bg-[var(--p-tape)] text-[var(--p-primer)]">
                        <Plus className="size-5 transition-transform group-open:rotate-45 motion-reduce:transition-none" />
                      </span>
                    </summary>
                    <p className="max-w-2xl px-4 pb-7 text-base leading-7 text-[var(--p-graphite)] sm:px-6">
                      {answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[var(--p-graphite)] px-5 py-24 text-[var(--p-primer)] sm:px-8 lg:px-12 lg:py-36">
          <div className="mx-auto grid max-w-[1360px] gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
            <div>
              <TapeLabel light>Estimate worksheet</TapeLabel>
              <h2
                style={DISPLAY}
                className="mt-6 max-w-[10ch] text-6xl font-bold leading-[.9] tracking-[-.055em] sm:text-8xl"
                data-tkey="text.estimateTitle"
              >
                {estimateTitle}
              </h2>
              <p className="mt-6 max-w-md text-lg font-medium leading-8">
                Demo scheduling and simulated payment only. No service is booked and no real charge
                occurs.
              </p>
            </div>
            <div>
              <ul className="grid border-x border-t border-[var(--p-graphite)] sm:grid-cols-2">
                {estimateItems.map((item) => (
                  <li
                    key={item}
                    className="flex min-h-20 items-center gap-4 border-b border-[var(--p-graphite)] bg-[var(--p-primer)] px-5 text-sm font-bold text-[var(--p-graphite)] sm:border-r sm:nth-[2n]:border-r-0"
                  >
                    <Check className="size-5 shrink-0 text-[var(--p-tape)]" />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap items-center gap-6">
                <PrimaryButton inverse onClick={() => setBookingOpen(true)}>
                  Request a site visit
                </PrimaryButton>
                <a
                  href={phoneHref}
                  data-tkey="contact.phone"
                  className="min-h-11 py-3 text-xs font-bold uppercase tracking-[.12em] text-[var(--p-primer)] underline decoration-[var(--p-primer)] decoration-4 underline-offset-4"
                >
                  {rawPhone ? phoneLabel : "Sample call · (555) 013-7482"}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[var(--p-graphite)] px-5 pb-32 pt-14 text-[var(--p-primer)] sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-[1460px] gap-10 border-t border-[var(--p-primer)]/35 pt-8 sm:grid-cols-3">
          <div>
            <p
              style={DISPLAY}
              className="flex min-w-0 items-center gap-3 text-3xl font-bold tracking-[-.06em]"
            >
              <BrandMark brand={brandLabel} logoUrl={logoUrl} />
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[.12em] text-[var(--p-primer)]/60">
              Fictional True Coat painter template
            </p>
          </div>
          <div className="text-sm font-medium leading-7">
            <a href={phoneHref} data-tkey="contact.phone">
              {rawPhone ? phoneLabel : "(555) 013-7482 · Sample number"}
            </a>
            <p data-tkey="contact.email">
              {rawEmail ? emailLabel : "hello@example.com · Sample address"}
            </p>
          </div>
          <p className="max-w-md text-xs font-medium leading-6 text-[var(--p-primer)]/60">
            Replace all sample content, media, scope, reviews, and contact details before
            publishing.
          </p>
        </div>
      </footer>

      <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
    </div>
  );
}
