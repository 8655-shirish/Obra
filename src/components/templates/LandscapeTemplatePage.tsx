import {
  ArrowDownRight,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Leaf,
  Menu,
  Phone,
  Quote,
  ShieldCheck,
  Sparkles,
  Sprout,
  Star,
  TreePine,
  X,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";

import {
  overlayLogoUrl,
  overlayMediaUrl,
  purchasedReviewList,
  type TemplateMoldContent,
} from "@/lib/template-content/overlay";
import "./overlay-fit.css";

const IMAGE = {
  hero: "/templates/garden-delite/generated/hero.jpg",
  heroVideo: "/templates/garden-delite/generated/hero-loop.mp4",
  philosophyDetail: "/templates/garden-delite/generated/philosophy-detail.jpg",
  philosophyCraft: "/templates/garden-delite/generated/philosophy-craft.jpg",
  googleLogo: "/templates/garden-delite/brands/google.svg",
  yelpLogo: "/templates/garden-delite/brands/yelp.svg",
  design: "/templates/garden-delite/generated/service-design.jpg",
  maintenance: "/templates/garden-delite/generated/service-care.jpg",
  outdoor: "/templates/garden-delite/generated/service-outdoor.jpg",
  before: "/templates/garden-delite/generated/project-before.jpg",
  after: "/templates/garden-delite/generated/project-after.jpg",
  portrait1: "/templates/garden-delite/portrait-maya.jpg",
  portrait2: "/templates/garden-delite/portrait-daniel.jpg",
  portrait3: "/templates/garden-delite/portrait-sofia.jpg",
  blog1: "/templates/garden-delite/generated/journal-front.jpg",
  blog2: "/templates/garden-delite/generated/journal-drought.jpg",
  blog3: "/templates/garden-delite/generated/journal-seasons.jpg",
} as const;

const services = [
  {
    number: "01",
    title: "Landscape design",
    text: "Site-aware planting plans, material palettes, and layouts shaped around how you want to live outside.",
    image: IMAGE.design,
    icon: Sprout,
  },
  {
    number: "02",
    title: "Garden care",
    text: "Considered seasonal maintenance that keeps every bed, hedge, and detail healthy without losing its character.",
    image: IMAGE.maintenance,
    icon: Leaf,
  },
  {
    number: "03",
    title: "Outdoor living",
    text: "Patios, pathways, lighting, and quiet gathering places built to feel like a natural extension of home.",
    image: IMAGE.outdoor,
    icon: TreePine,
  },
];

const reviews = [
  {
    quote:
      "They saw the potential in a yard we had stopped noticing. Now every window frames something beautiful.",
    author: "Maya R.",
    location: "Homeowner",
    source: "Yelp",
    sourceLogo: IMAGE.yelpLogo,
    image: IMAGE.portrait1,
  },
  {
    quote:
      "Thoughtful, tidy, and incredibly easy to work with. The garden feels established—not newly installed.",
    author: "Daniel K.",
    location: "Homeowner",
    source: "Google",
    sourceLogo: IMAGE.googleLogo,
    image: IMAGE.portrait2,
  },
  {
    quote:
      "Our patio went from unused space to the place everyone gathers. The planting is gorgeous year-round.",
    author: "Sofia L.",
    location: "Homeowner",
    source: "Google",
    sourceLogo: IMAGE.googleLogo,
    image: IMAGE.portrait3,
  },
];

const posts = [
  {
    date: "MAY 18",
    title: "A quieter, greener front garden",
    category: "Garden notes",
    image: IMAGE.blog1,
  },
  {
    date: "APR 06",
    title: "Five layers of a drought-wise landscape",
    category: "Design guide",
    image: IMAGE.blog2,
  },
  {
    date: "MAR 21",
    title: "What to plant for every season",
    category: "Planting",
    image: IMAGE.blog3,
  },
];

const faqs = [
  [
    "What kinds of projects do you take on?",
    "We help with complete landscape transformations, planting-led garden renewals, patios and pathways, irrigation, lighting, and ongoing care. Every proposal is shaped around your home, the way you want to use the space, and the level of change that will make the biggest difference.",
  ],
  [
    "How does the design process work?",
    "We start with a relaxed site visit to understand your priorities, style, and how the property behaves through the day. From there, we develop a clear concept, planting and material direction, an itemized proposal, and a practical build plan. You will know what is included and what happens next before work begins.",
  ],
  [
    "Can you work with an existing garden?",
    "Absolutely. A thoughtful refresh can preserve mature trees, healthy plants, and meaningful features while improving flow, privacy, color, and year-round structure. We begin by identifying what is worth keeping so your garden feels renewed—not erased.",
  ],
  [
    "How long will my project take?",
    "Timing depends on design approvals, material lead times, planting season, and the size of the build. After the site visit, we will share a realistic schedule and keep you updated from preparation through the final walkthrough. Focused garden renewals may take days; larger transformations are planned in clearly defined phases.",
  ],
  [
    "How do you approach budgets?",
    "We talk about investment early so the design can focus on what matters most. Your proposal will explain the recommended scope and priorities in plain language, with options to phase work when that creates a better long-term result. The goal is a garden that feels considered at every level—not a list of surprise costs.",
  ],
  [
    "Do you offer ongoing garden care?",
    "Yes. Seasonal and recurring care can be tailored to your landscape, from pruning and soil health to irrigation checks and planting refreshes. Because we understand the original design intent, we can help the garden mature gracefully instead of simply keeping it tidy.",
  ],
  [
    "What areas do you serve?",
    "Our service area depends on project type and crew availability. Share your address when you get in touch and we will confirm the fit before scheduling a site visit.",
  ],
  [
    "What happens after I get in touch?",
    "We will ask a few practical questions about your property, priorities, timing, and budget. If the project sounds like a good fit, the next step is a site consultation where we can walk the space together and recommend a clear path forward.",
  ],
] as const;

const ease = [0.22, 1, 0.36, 1] as const;
const reveal = {
  initial: false as const,
  transition: { duration: 0.8, ease },
};

function Logo({
  label,
  ariaLabel,
  logoUrl,
}: {
  label: string;
  ariaLabel: string;
  logoUrl: string | null;
}) {
  return (
    <a href="#top" className="group flex min-w-0 items-center gap-3" aria-label={ariaLabel}>
      <span
        className="overlay-brand-mark grid size-10 place-items-center overflow-hidden rounded-full border border-white/35 bg-white/10 backdrop-blur-md transition-transform duration-500 group-hover:rotate-12"
        data-tkey="media.logo"
      >
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-full object-contain" />
        ) : (
          <Leaf className="size-5" strokeWidth={1.7} />
        )}
      </span>
      <span className="min-w-0 leading-none">
        <span className="overlay-brand-name block font-display text-xl tracking-[-0.03em]">
          {label}
        </span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.36em] text-white/65">
          Landscape Contractors
        </span>
      </span>
    </a>
  );
}

function BeforeAfter() {
  const [position, setPosition] = useState(52);
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-[#cfd1c1] outline-offset-4 focus-within:outline-2 focus-within:outline-[#c8e36c] sm:aspect-[16/10] lg:aspect-[15/10]">
      <img
        src={IMAGE.after}
        alt="Sample backyard after a landscape renovation"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img
          src={IMAGE.before}
          alt="Sample backyard before a landscape renovation"
          loading="lazy"
          decoding="async"
          className="size-full object-cover grayscale-[.18] saturate-[.72]"
        />
        <div className="absolute inset-0 bg-[#2d3028]/15" />
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/90"
        style={{ left: position + "%" }}
      >
        <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/60 bg-[#f4f0e5]/95 text-[#21352a] shadow-xl">
          <span className="flex gap-1 text-sm">‹ ›</span>
        </span>
      </div>
      <input
        aria-label="Before and after comparison; use arrow keys to reveal the renovated landscape"
        aria-valuetext={`${position}% before, ${100 - position}% after`}
        type="range"
        min="10"
        max="90"
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="absolute inset-0 z-20 size-full cursor-ew-resize opacity-0"
      />
      <span className="absolute left-5 top-5 rounded-full bg-[#1c2d25]/82 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-white backdrop-blur">
        Before
      </span>
      <span className="absolute right-5 top-5 rounded-full bg-[#c8e36c]/90 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-[#1c2d25] backdrop-blur">
        After
      </span>
    </div>
  );
}

function LandscapeSectionCta({
  prompt,
  onClick,
  dark = false,
}: {
  prompt: string;
  onClick: () => void;
  dark?: boolean;
}) {
  return (
    <div
      data-section-cta
      className={
        "mx-auto mt-14 flex max-w-[1400px] flex-col gap-5 border-t pt-6 sm:flex-row sm:items-center sm:justify-between " +
        (dark ? "border-white/20" : "border-[#203128]/18")
      }
    >
      <div>
        <p
          className={
            "text-[10px] font-bold uppercase tracking-[.22em] " +
            (dark ? "text-[#c4d69b]" : "text-[#68766c]")
          }
        >
          Ready to shape your outdoor space?
        </p>
        <p
          className={
            "mt-2 max-w-2xl text-sm leading-6 " + (dark ? "text-white/65" : "text-[#526057]")
          }
        >
          {prompt}
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={
          "flex min-h-12 shrink-0 items-center justify-between gap-8 rounded-full px-6 text-[10px] font-bold uppercase tracking-[.18em] transition " +
          (dark
            ? "bg-[#e7edda] text-[#1f352a] hover:bg-white"
            : "bg-[#20352b] text-white hover:bg-[#31503e]")
        }
      >
        Book a consultation <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

export function LandscapeTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Wild at heart.";
  const heroAccent = text?.heroAccent ?? "Made for home.";
  const heroSub =
    text?.heroSub ??
    "Garden Delite designs, builds, and cares for enduring residential landscapes—layered with texture, shaped by the seasons, and personal to you.";
  const philosophyTitle = text?.philosophyTitle ?? "A great garden doesn't ask for attention.";
  const philosophyAccent = text?.philosophyAccent ?? "It gives it back.";
  const philosophyBody =
    text?.philosophyBody ??
    "Our work balances clean architectural lines with loose, expressive planting. The result feels composed on day one and more alive with every season.";
  const servicesHeading = text?.servicesHeading ?? "From soil to sanctuary.";
  const servicesIntro =
    text?.servicesIntro ??
    "One landscape team—from the first sketch through installation, planting, and continued care.";
  const proofTitle = text?.proofTitle ?? "See what was";
  const proofAccent = text?.proofAccent ?? "waiting to grow.";
  const proofBody =
    text?.proofBody ??
    "Move the handle to compare a tired, disconnected yard with a landscape shaped for gathering, wandering, and year-round life.";
  const reviewsHeading = text?.reviewsHeading ?? "Kind words,";
  const reviewsAccent = text?.reviewsAccent ?? "grown honestly.";
  const journalHeading = text?.journalHeading ?? "From the garden.";
  const faqTitle = text?.faqTitle ?? "Questions,";
  const faqAccent = text?.faqAccent ?? "answered.";
  const faqBody =
    text?.faqBody ??
    "Every landscape begins with curiosity. Here are a few of the things homeowners ask us first.";
  const ctaTitle = text?.ctaTitle ?? "Let's make room";
  const ctaAccent = text?.ctaAccent ?? "for the good life.";
  const ctaBody =
    text?.ctaBody ??
    "Tell us what you're imagining. We'll listen, walk the space with you, and shape a practical path forward.";
  const footerBlurb =
    text?.footerBlurb ??
    "Landscape design, installation, and garden care for homes that want more life outside.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 014-7263";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550147263";
  const rawEmail = content?.email?.trim() ? content.email.trim() : null;
  const emailLabel = rawEmail ?? "hello@gardendelite.example";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "Garden Delite";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const brandAria = brandName ? `${brandName} home` : "Garden Delite Contractors home";
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const reduceMotion = useReducedMotion();
  const [motionPreferenceReady, setMotionPreferenceReady] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMotionPreferenceReady(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);
  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.22], [0, 90]);

  const openBooking = () => {
    setMenuOpen(false);
    setBookingOpen(true);
  };

  return (
    <div
      id="top"
      className="min-h-screen overflow-x-visible bg-[#f1eee4] font-sans text-[#203128] selection:bg-[#c8e36c] selection:text-[#17231c]"
    >
      <section className="relative min-h-[780px] overflow-hidden bg-[#1d3329] text-white sm:min-h-screen">
        <m.div style={{ y: heroY }} className="absolute inset-0 scale-[1.02]">
          <img
            src={heroPoster}
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover object-[58%_center]"
            data-tkey="media.heroPoster"
          />
          {!motionPreferenceReady || reduceMotion ? null : (
            <video
              aria-hidden="true"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              poster={heroPoster}
              className="absolute inset-0 size-full object-cover object-[58%_center]"
            >
              <source src={IMAGE.heroVideo} type="video/mp4" />
            </video>
          )}
        </m.div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(14,29,22,.88)_0%,rgba(14,29,22,.55)_42%,rgba(14,29,22,.09)_78%),linear-gradient(0deg,rgba(12,25,19,.5)_0%,transparent_45%)]" />
        <div className="absolute inset-0 opacity-[.14] [background-image:radial-gradient(circle_at_center,white_0.7px,transparent_0.8px)] [background-size:7px_7px]" />

        <header className="relative z-30 mx-auto flex w-full max-w-[1500px] items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
          <Logo label={brandLabel} ariaLabel={brandAria} logoUrl={logoUrl} />
          <nav className="hidden items-center gap-8 text-[11px] font-semibold uppercase tracking-[0.18em] lg:flex">
            {["Services", "Transformations", "Reviews", "Journal", "FAQ"].map((item) => (
              <a
                key={item}
                href={"#" + item.toLowerCase()}
                className="relative min-h-11 py-3 text-white/80 after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-[#c8e36c] after:transition-all hover:text-white hover:after:w-full"
              >
                {item}
              </a>
            ))}
          </nav>
          <button
            type="button"
            onClick={openBooking}
            className="hidden min-h-12 items-center gap-3 rounded-full bg-[#c8e36c] px-6 text-[11px] font-bold uppercase tracking-[0.18em] text-[#1a2a22] transition-transform duration-300 hover:-translate-y-0.5 lg:flex"
          >
            Book a consultation <ArrowDownRight className="size-4" />
          </button>
          <button
            type="button"
            ref={menuButtonRef}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="landscape-mobile-menu"
            onClick={() => setMenuOpen(true)}
            className="grid size-11 place-items-center rounded-full border border-white/30 bg-white/10 backdrop-blur lg:hidden"
          >
            <Menu className="size-5" />
          </button>
        </header>

        <AnimatePresence>
          {menuOpen ? (
            <m.div
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              id="landscape-mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Site navigation"
              className="fixed inset-0 z-50 bg-[#193026] p-6 text-white lg:hidden"
            >
              <div className="flex items-center justify-between">
                <Logo label={brandLabel} ariaLabel={brandAria} logoUrl={logoUrl} />
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="grid size-11 place-items-center rounded-full border border-white/25"
                >
                  <X className="size-5" />
                </button>
              </div>
              <nav className="mt-20 flex flex-col gap-6 font-display text-4xl">
                {["Services", "Transformations", "Reviews", "Journal", "FAQ"].map((item, index) => (
                  <m.a
                    key={item}
                    initial={false}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    href={"#" + item.toLowerCase()}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item}
                  </m.a>
                ))}
              </nav>
              <button
                type="button"
                onClick={openBooking}
                className="mt-12 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#c8e36c] font-semibold text-[#193026]"
              >
                Book a consultation <ArrowRight className="size-4" />
              </button>
            </m.div>
          ) : null}
        </AnimatePresence>

        <div className="relative z-20 mx-auto flex min-h-[670px] w-full max-w-[1500px] items-end px-5 pb-16 sm:px-8 sm:pb-20 lg:px-12">
          <div className="grid w-full gap-10 lg:grid-cols-[1fr_320px] lg:items-end">
            <div className="max-w-4xl">
              <m.div
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7 }}
                className="mb-6 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.28em] text-[#d9eba2]"
              >
                <span className="h-px w-10 bg-[#c8e36c]" /> Landscapes made for living
              </m.div>
              <m.h1
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, ease }}
                className="font-display text-[clamp(4rem,9vw,8.9rem)] font-normal leading-[0.84] tracking-[-0.065em]"
                data-tkey="text.heroTitle"
              >
                {heroTitle}
                <br />
                <span className="italic text-[#dce8d8]" data-tkey="text.heroAccent">
                  {heroAccent}
                </span>
              </m.h1>
              <m.p
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.8 }}
                className="mt-8 max-w-xl text-base leading-7 text-white/75 sm:text-lg"
                data-tkey="text.heroSub"
              >
                {heroSub}
              </m.p>
              <m.div initial={false} className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={openBooking}
                  className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-[#c8e36c] px-6 text-[11px] font-bold uppercase tracking-[.16em] text-[#193027] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c8e36c]"
                >
                  Plan a garden <ArrowRight className="size-4" />
                </button>
                <a
                  href={phoneHref}
                  data-tkey="contact.phone"
                  className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full border border-white/30 px-6 text-[11px] font-bold uppercase tracking-[.16em] text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  Call {phoneLabel}
                </a>
              </m.div>
            </div>
            {overlayReviews ? null : (
              <m.div
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="border-l border-white/25 pl-6"
              >
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2" aria-hidden="true">
                    {reviews.map((review) => (
                      <img
                        key={review.author}
                        src={review.image}
                        alt=""
                        className="size-10 rounded-full border-2 border-[#31473b] object-cover"
                      />
                    ))}
                  </div>
                  <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.18em] text-white/80 backdrop-blur">
                    Preview content
                  </span>
                </div>
                <div
                  className="mt-4 flex gap-1 text-[#d8f278]"
                  aria-label="Example five-star rating"
                >
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="size-3.5 fill-current" aria-hidden="true" />
                  ))}
                </div>
                <p className="mt-2 text-xs leading-5 text-white/65">
                  Example review layout. Replace the portraits, rating, and feedback before
                  publishing.
                </p>
              </m.div>
            )}
          </div>
        </div>
        <div className="absolute bottom-0 right-0 z-20 hidden items-center gap-8 bg-[#f1eee4] px-8 py-5 text-[#203128] md:flex">
          <span className="text-xs font-bold uppercase tracking-[0.24em]">Scroll to explore</span>
          <ArrowDownRight className="size-4" />
        </div>
      </section>

      <main>
        <section className="overflow-hidden border-b border-[#203128]/12 px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
          <div className="mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[.72fr_1.28fr]">
            <m.div {...reveal} className="lg:pt-2">
              <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#627468]">
                Our point of view
              </p>
              <div className="mt-8 grid max-w-[27rem] grid-cols-[1.12fr_.88fr] items-end gap-3 sm:mt-12 sm:gap-5">
                <figure className="group relative aspect-[4/5] overflow-hidden bg-[#d7d7ca]">
                  <img
                    src={overlayMediaUrl(content, "philosophyDetail", IMAGE.philosophyDetail)}
                    alt="Layered perennial planting spilling beside a natural-stone path"
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-[1.2s] group-hover:scale-[1.025]"
                    data-tkey="media.philosophyDetail"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#14251e]/80 to-transparent px-4 pb-4 pt-16 text-[10px] font-bold uppercase tracking-[.2em] text-white/85">
                    Planting with movement
                  </figcaption>
                </figure>
                <figure className="group relative mb-[-3rem] aspect-[3/4] overflow-hidden bg-[#d7d7ca] sm:mb-[-4.5rem]">
                  <img
                    src={overlayMediaUrl(content, "philosophyCraft", IMAGE.philosophyCraft)}
                    alt="Stone garden steps edged in weathered steel and loose native planting"
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover transition-transform duration-[1.2s] group-hover:scale-[1.025]"
                    data-tkey="media.philosophyCraft"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#14251e]/80 to-transparent px-4 pb-4 pt-16 text-[10px] font-bold uppercase tracking-[.2em] text-white/85">
                    Craft in every detail
                  </figcaption>
                </figure>
              </div>
            </m.div>
            <m.div {...reveal}>
              <p
                className="font-display text-[clamp(2.6rem,5.8vw,5.7rem)] leading-[.98] tracking-[-0.05em]"
                data-tkey="text.philosophyTitle"
              >
                {philosophyTitle}{" "}
                <span className="italic text-[#758877]" data-tkey="text.philosophyAccent">
                  {philosophyAccent}
                </span>
              </p>
              <div className="mt-12 grid gap-8 border-t border-[#203128]/15 pt-8 sm:grid-cols-2">
                <p className="text-sm leading-7 text-[#516057]" data-tkey="text.philosophyBody">
                  {philosophyBody}
                </p>
                <div className="flex items-start gap-3 text-sm font-semibold">
                  <ShieldCheck className="mt-0.5 size-5 text-[#66833a]" />
                  <span>
                    Thoughtful planning
                    <br />
                    Respectful crews
                    <br />
                    Enduring materials
                  </span>
                </div>
              </div>
            </m.div>
          </div>
          <LandscapeSectionCta
            prompt="Tell us what you want the garden to feel like, and we will start the conversation there."
            onClick={openBooking}
          />
        </section>

        <section id="services" className="bg-[#e8e4d8] px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1400px]">
            <m.div
              {...reveal}
              className="mb-14 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[.28em] text-[#6d7d72]">
                  What we do
                </p>
                <h2
                  className="mt-4 font-display text-5xl tracking-[-0.045em] sm:text-7xl"
                  data-tkey="text.servicesHeading"
                >
                  {servicesHeading}
                </h2>
              </div>
              <p
                className="max-w-sm text-sm leading-6 text-[#637067]"
                data-tkey="text.servicesIntro"
              >
                {servicesIntro}
              </p>
            </m.div>
            <div className="grid gap-4 lg:grid-cols-3">
              {services.map((service, index) => {
                const Icon = service.icon;
                return (
                  <m.article
                    key={service.title}
                    {...reveal}
                    transition={{ duration: 0.8, ease, delay: index * 0.08 }}
                    className="group relative min-h-[520px] overflow-hidden bg-[#26392f] text-white"
                  >
                    <img
                      src={overlayMediaUrl(content, `serviceImage${index}`, service.image)}
                      alt={service.title}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 size-full object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
                      data-tkey={`media.serviceImage${index}`}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#17261f]/95 via-[#17261f]/20 to-[#17261f]/10" />
                    <div className="relative flex h-full min-h-[520px] flex-col justify-between p-7">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold tracking-[.24em] text-white/65">
                          {service.number}
                        </span>
                        <span className="grid size-11 place-items-center rounded-full border border-white/30 backdrop-blur">
                          <Icon className="size-5" strokeWidth={1.5} />
                        </span>
                      </div>
                      <div>
                        <h3 className="font-display text-4xl tracking-[-0.035em]">
                          {service.title}
                        </h3>
                        <p className="mt-4 max-w-sm text-sm leading-6 text-white/70">
                          {service.text}
                        </p>
                        <button
                          type="button"
                          onClick={openBooking}
                          className="mt-7 flex min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#d9ec91] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9ec91]"
                        >
                          Plan a project{" "}
                          <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                        </button>
                      </div>
                    </div>
                  </m.article>
                );
              })}
            </div>
          </div>
          <LandscapeSectionCta
            prompt="Not sure which service fits? Share your space, priorities, and the kind of help you need."
            onClick={openBooking}
          />
        </section>

        <section
          id="transformations"
          className="bg-[#20352b] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32"
        >
          <div className="mx-auto max-w-[1400px]">
            <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:items-end">
              <m.div {...reveal}>
                <p className="text-xs font-bold uppercase tracking-[.28em] text-[#c8e36c]">
                  Before & after
                </p>
                <h2
                  className="mt-5 font-display text-5xl leading-[.98] tracking-[-.045em] sm:text-7xl"
                  data-tkey="text.proofTitle"
                >
                  {proofTitle}
                  <br />
                  <span className="italic text-[#cfdbd2]" data-tkey="text.proofAccent">
                    {proofAccent}
                  </span>
                </h2>
                <p
                  className="mt-7 max-w-md text-base leading-7 text-white/75"
                  data-tkey="text.proofBody"
                >
                  {proofBody}
                </p>
                <button
                  type="button"
                  onClick={openBooking}
                  className="mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-[#c8e36c] px-6 text-xs font-bold uppercase tracking-[.18em] text-[#20352b]"
                >
                  Start your transformation <ArrowRight className="size-4" />
                </button>
              </m.div>
              <m.div {...reveal} transition={{ duration: 1, ease }}>
                <BeforeAfter />
                <div className="mt-5 flex justify-between border-t border-white/20 pt-4 text-xs font-bold uppercase tracking-[.2em] text-white/50">
                  <span>Illustrative template imagery</span>
                  <span>Same-property comparison</span>
                </div>
              </m.div>
            </div>
          </div>
          <LandscapeSectionCta
            prompt="Have a property in mind? Request a consultation to discuss its possibilities."
            onClick={openBooking}
            dark
          />
        </section>

        <section id="reviews" className="px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1400px]">
            <m.div
              {...reveal}
              className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[.28em] text-[#6d7d72]">
                  Happy customers
                </p>
                <h2
                  className="mt-4 font-display text-5xl tracking-[-.045em] sm:text-7xl"
                  data-tkey="text.reviewsHeading"
                >
                  {reviewsHeading}
                  <br />
                  <span className="italic text-[#748779]" data-tkey="text.reviewsAccent">
                    {reviewsAccent}
                  </span>
                </h2>
              </div>
              {overlayReviews ? null : (
                <div className="flex items-center gap-3">
                  <div className="flex text-[#6d8a38]">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="size-4 fill-current" />
                    ))}
                  </div>
                  <span className="text-xs font-bold uppercase tracking-[.18em]">
                    Example rating
                  </span>
                </div>
              )}
            </m.div>
            {overlayReviews === null || overlayReviews.length > 0 ? (
              <div className="mt-14 grid gap-px overflow-hidden border border-[#203128]/15 bg-[#203128]/15 lg:grid-cols-3">
                {(overlayReviews ?? reviews).map((review, index) => (
                  <m.article
                    key={`${review.author}-${index}`}
                    {...reveal}
                    transition={{ duration: 0.75, ease, delay: index * 0.08 }}
                    className="group bg-[#f1eee4] p-7 sm:p-9"
                  >
                    <div className="flex items-center justify-between">
                      <Quote className="size-8 text-[#718441]" strokeWidth={1.2} />
                      {overlayReviews ? null : (
                        <span
                          className="flex min-h-8 items-center gap-2 rounded-full border border-[#203128]/15 bg-white/35 px-3 py-1.5"
                          aria-label={`Placeholder review card; source badge style shown with ${"source" in review ? review.source : ""} branding`}
                        >
                          <span className="text-[9px] font-bold uppercase tracking-[.16em] text-[#6c786f]">
                            Example
                          </span>
                          <span className="h-3 w-px bg-[#203128]/15" />
                          <img
                            src={"sourceLogo" in review ? review.sourceLogo : IMAGE.googleLogo}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            decoding="async"
                            className={
                              "source" in review && review.source === "Yelp"
                                ? "h-4 w-auto"
                                : "h-3.5 w-auto"
                            }
                          />
                        </span>
                      )}
                    </div>
                    <blockquote
                      className="mt-12 font-display text-2xl leading-[1.3] tracking-[-.025em]"
                      data-tkey={overlayReviews ? `reviews.${index}.quote` : undefined}
                    >
                      “{review.quote}”
                    </blockquote>
                    <div className="mt-12 flex items-center gap-3 border-t border-[#203128]/12 pt-6">
                      <img
                        src={overlayMediaUrl(
                          content,
                          `reviewImage${index}`,
                          "image" in review ? review.image : IMAGE.portrait1,
                        )}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="size-11 rounded-full object-cover grayscale-[.15]"
                        data-tkey={`media.reviewImage${index}`}
                      />
                      <div>
                        <p
                          className="text-sm font-bold"
                          data-tkey={overlayReviews ? `reviews.${index}.author` : undefined}
                        >
                          {review.author}
                        </p>
                        {"location" in review ? (
                          <p className="mt-1 text-xs uppercase tracking-[.18em] text-[#748077]">
                            {review.location}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </m.article>
                ))}
              </div>
            ) : null}
            {overlayReviews ? null : (
              <p className="mt-5 text-xs text-[#778078]">
                Placeholder testimonials and portraits demonstrate the intended layout only. Replace
                every claim, rating, image, and attribution with verified, permissioned customer
                feedback before publishing.
              </p>
            )}
          </div>
          <LandscapeSectionCta
            prompt="Bring your goals, constraints, and inspiration—we will help organize the next step."
            onClick={openBooking}
          />
        </section>

        <section id="journal" className="bg-[#dce3d4] px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
          <div className="mx-auto max-w-[1400px]">
            <m.div {...reveal} className="mb-14 flex items-end justify-between gap-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.28em] text-[#667467]">
                  Field notes
                </p>
                <h2
                  className="mt-4 font-display text-5xl tracking-[-.045em] sm:text-7xl"
                  data-tkey="text.journalHeading"
                >
                  {journalHeading}
                </h2>
              </div>
              <span className="hidden text-xs font-bold uppercase tracking-[.2em] text-[#607064] sm:block">
                Sample article topics to replace before publishing
              </span>
            </m.div>
            <div className="grid gap-8 lg:grid-cols-3">
              {posts.map((post, index) => {
                const overlayPost = content?.blogs?.[index];
                return (
                  <m.article
                    key={post.title}
                    {...reveal}
                    transition={{ duration: 0.8, ease, delay: index * 0.08 }}
                    className="group"
                  >
                    <div className="aspect-[4/3] overflow-hidden bg-[#bdc5b8]">
                      <img
                        src={overlayMediaUrl(content, `journalImage${index}`, post.image)}
                        alt={overlayPost?.title ?? post.title}
                        loading="lazy"
                        decoding="async"
                        className="size-full object-cover transition-transform duration-1000 group-hover:scale-105"
                        data-tkey={`media.journalImage${index}`}
                      />
                    </div>
                    <div className="mt-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.22em] text-[#6c786f]">
                      <span data-tkey={`blogs.${index}.category`}>
                        {overlayPost?.category ?? post.category}
                      </span>
                      <span className="size-1 rounded-full bg-[#7b8b50]" />
                      <span>{post.date}</span>
                    </div>
                    <h3
                      className="mt-4 font-display text-3xl leading-[1.1] tracking-[-.03em]"
                      data-tkey={`blogs.${index}.title`}
                    >
                      {overlayPost?.title ?? post.title}
                    </h3>
                    <span className="mt-5 inline-flex min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#59685d]">
                      Sample article · No linked page
                    </span>
                  </m.article>
                );
              })}
            </div>
          </div>
          <LandscapeSectionCta
            prompt="See an idea that belongs in your own garden? Start with a consultation request."
            onClick={openBooking}
          />
        </section>

        <section id="faq" className="px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
          <div className="mx-auto grid max-w-[1400px] gap-14 lg:grid-cols-[.72fr_1.28fr]">
            <m.div {...reveal}>
              <p className="text-xs font-bold uppercase tracking-[.28em] text-[#6b796f]">
                Good to know
              </p>
              <h2
                className="mt-4 font-display text-5xl leading-none tracking-[-.045em] sm:text-7xl"
                data-tkey="text.faqTitle"
              >
                {faqTitle}
                <br />
                <span className="italic text-[#748779]" data-tkey="text.faqAccent">
                  {faqAccent}
                </span>
              </h2>
              <p
                className="mt-7 max-w-sm text-base leading-7 text-[#56655b]"
                data-tkey="text.faqBody"
              >
                {faqBody}
              </p>
            </m.div>
            <m.div {...reveal} className="border-t border-[#203128]/18">
              {faqs.map(([question, answer], index) => {
                const open = openFaq === index;
                return (
                  <div key={question} className="border-b border-[#203128]/18">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`faq-panel-${index}`}
                      id={`faq-button-${index}`}
                      onClick={() => setOpenFaq(open ? -1 : index)}
                      className="flex w-full items-center justify-between gap-5 py-7 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#66833a]"
                    >
                      <span className="font-display text-xl tracking-[-.02em] sm:text-2xl">
                        {question}
                      </span>
                      <span
                        className={
                          "grid size-9 shrink-0 place-items-center rounded-full border border-[#203128]/20 transition-transform duration-300 " +
                          (open ? "rotate-180 bg-[#20352b] text-white" : "")
                        }
                      >
                        <ChevronDown className="size-4" />
                      </span>
                    </button>
                    {open ? (
                      <div
                        id={`faq-panel-${index}`}
                        role="region"
                        aria-labelledby={`faq-button-${index}`}
                      >
                        <p className="max-w-2xl pb-8 pr-12 text-base leading-7 text-[#56655b]">
                          {answer}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </m.div>
          </div>
          <LandscapeSectionCta
            prompt="Still deciding? Share the questions that matter most to your home and landscape."
            onClick={openBooking}
          />
        </section>

        <section
          id="contact"
          className="relative overflow-hidden bg-[#193027] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32"
        >
          <div className="absolute -right-28 -top-28 size-96 rounded-full border border-white/10" />
          <div className="absolute -right-8 -top-8 size-96 rounded-full border border-white/10" />
          <m.div
            {...reveal}
            className="relative mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[1fr_420px] lg:items-end"
          >
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-[11px] font-bold uppercase tracking-[.22em] text-[#d9ec99]">
                <Sparkles className="size-3" /> Your garden starts here
              </span>
              <h2
                className="mt-7 max-w-4xl font-display text-[clamp(3.5rem,8vw,8rem)] leading-[.87] tracking-[-.06em]"
                data-tkey="text.ctaTitle"
              >
                {ctaTitle}
                <br />
                <span className="italic text-[#d5dfd7]" data-tkey="text.ctaAccent">
                  {ctaAccent}
                </span>
              </h2>
            </div>
            <div className="border-l border-white/20 pl-7">
              <p className="text-base leading-7 text-white/75" data-tkey="text.ctaBody">
                {ctaBody}
              </p>
              <button
                type="button"
                onClick={openBooking}
                className="mt-7 flex min-h-14 w-full items-center justify-between rounded-full bg-[#c8e36c] px-6 text-[11px] font-bold uppercase tracking-[.16em] text-[#193027] transition-transform hover:-translate-y-0.5"
              >
                <span>Book a consultation</span>
                <CalendarDays className="size-4" />
              </button>
              <a
                href={phoneHref}
                data-tkey="contact.phone"
                className="mt-4 flex min-h-12 w-full items-center justify-between rounded-full border border-white/25 px-6 text-[11px] font-bold uppercase tracking-[.16em]"
              >
                <span>{rawPhone ? phoneLabel : "(555) 014-7263 · Sample number"}</span>
                <Phone className="size-4" />
              </a>
            </div>
          </m.div>
        </section>
      </main>

      <footer className="bg-[#13241d] px-5 pb-8 pt-16 text-white sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid gap-12 border-b border-white/15 pb-14 sm:grid-cols-2 lg:grid-cols-[1.2fr_.8fr_.8fr]">
            <div>
              <Logo label={brandLabel} ariaLabel={brandAria} logoUrl={logoUrl} />
              <p
                className="mt-6 max-w-sm text-sm leading-6 text-white/55"
                data-tkey="text.footerBlurb"
              >
                {footerBlurb}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.24em] text-white/45">
                Explore
              </p>
              <div className="mt-5 grid gap-3 text-sm text-white/75">
                {["Services", "Transformations", "Reviews", "Journal", "FAQ"].map((item) => (
                  <a key={item} href={"#" + item.toLowerCase()} className="hover:text-[#c8e36c]">
                    {item}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.24em] text-white/45">
                Contact
              </p>
              <div className="mt-5 grid gap-3 text-sm text-white/75">
                <span>Service area varies by project</span>
                <a href={phoneHref} data-tkey="contact.phone">
                  {rawPhone ? phoneLabel : "(555) 014-7263 · Sample number"}
                </a>
                <a href={emailHref} data-tkey="contact.email">
                  {rawEmail ? emailLabel : "hello@gardendelite.example · Sample address"}
                </a>
                <span>Mon–Fri · 8am–5pm</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-5 pt-7 text-[11px] font-semibold uppercase tracking-[.2em] text-white/40 sm:flex-row">
            <span>
              {brandName
                ? `© 2026 ${brandName}`
                : "© 2026 Garden Delite Contractors · Template preview"}
            </span>
            <div className="flex items-center gap-5">
              <span>Template preview</span>
              <a href="#top" className="min-h-11 py-3 text-white/70 hover:text-white">
                Back to top
              </a>
            </div>
          </div>
        </div>
      </footer>

      <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
    </div>
  );
}
