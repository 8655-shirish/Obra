import {
  ArrowDownRight,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Paintbrush,
  Menu,
  Phone,
  Quote,
  ShieldCheck,
  Sparkles,
  Palette,
  Star,
  House,
  X,
} from "lucide-react";
import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import { createPortal } from "react-dom";
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
  hero: "/templates/true-coat/generated/hero.jpg",
  heroVideo: "/templates/true-coat/generated/hero-loop.mp4",
  googleLogo: "/templates/garden-delite/brands/google.svg",
  yelpLogo: "/templates/garden-delite/brands/yelp.svg",
  philosophyDetail: "/templates/true-coat/generated/philosophy-detail.jpg",
  philosophyCraft: "/templates/true-coat/generated/philosophy-craft.jpg",
  interior: "/templates/true-coat/generated/service-interior.jpg",
  exterior: "/templates/true-coat/generated/service-exterior.jpg",
  cabinetry: "/templates/true-coat/generated/service-cabinetry.jpg",
  before: "/templates/true-coat/generated/project-before.jpg",
  after: "/templates/true-coat/generated/project-after.jpg",
  reviewLiving: "/templates/true-coat/generated/review-living.jpg",
  reviewExterior: "/templates/true-coat/generated/review-exterior.jpg",
  reviewKitchen: "/templates/true-coat/generated/review-kitchen.jpg",
  blogColor: "/templates/true-coat/generated/journal-color.jpg",
  blogPrep: "/templates/true-coat/generated/journal-prep.jpg",
  blogFinish: "/templates/true-coat/generated/journal-finish.jpg",
} as const;

const services = [
  {
    number: "01",
    title: "Interior painting",
    text: "Walls, ceilings, trim, and architectural details prepared carefully and finished for the way your rooms are used.",
    image: IMAGE.interior,
    icon: Paintbrush,
  },
  {
    number: "02",
    title: "Exterior painting",
    text: "Weather-aware preparation and coatings for siding, stucco, trim, doors, and other eligible exterior surfaces.",
    image: IMAGE.exterior,
    icon: House,
  },
  {
    number: "03",
    title: "Cabinet refinishing",
    text: "A measured refinishing process for suitable cabinet doors and frames, with finish options discussed before work begins.",
    image: IMAGE.cabinetry,
    icon: Palette,
  },
] as const;

const reviews = [
  {
    quote:
      "Sample story: the crew protected every room, communicated daily, and left crisp lines on every wall and ceiling.",
    author: "Sample homeowner 1",
    location: "Interior repaint",
    source: "Google",
    sourceLogo: IMAGE.googleLogo,
    image: IMAGE.reviewLiving,
  },
  {
    quote:
      "Sample story: careful prep, honest scheduling, and an exterior that looks new from the curb.",
    author: "Sample homeowner 2",
    location: "Exterior repaint",
    source: "Yelp",
    sourceLogo: IMAGE.yelpLogo,
    image: IMAGE.reviewExterior,
  },
  {
    quote:
      "Sample story: the cabinets sprayed to a factory-smooth finish, and the kitchen feels brand new.",
    author: "Sample homeowner 3",
    location: "Cabinet refinish",
    source: "Google",
    sourceLogo: IMAGE.googleLogo,
    image: IMAGE.reviewKitchen,
  },
] as const;

const posts = [
  {
    date: "TOPIC 01",
    title: "How undertones change in daylight",
    category: "Color notes",
    image: IMAGE.blogColor,
  },
  {
    date: "TOPIC 02",
    title: "What thorough surface preparation includes",
    category: "Preparation guide",
    image: IMAGE.blogPrep,
  },
  {
    date: "TOPIC 03",
    title: "Where matte, eggshell, and satin fit",
    category: "Finish guide",
    image: IMAGE.blogFinish,
  },
] as const;

const faqs = [
  [
    "What kinds of painting projects do you take on?",
    "We take on residential interiors and exteriors plus cabinet refinishing. Actual scope depends on surface condition, access, coating compatibility, and service area.",
  ],
  [
    "How does the painting process work?",
    "A typical project starts with a site visit to review surfaces, access, color goals, and areas that need protection. The written scope should explain preparation, products, included surfaces, exclusions, and the expected sequence before work begins.",
  ],
  [
    "Can you help with paint colors?",
    "Color support can begin with undertones, adjacent materials, room light, and sample placement. Approve final colors from physical samples in the actual space because screens and daylight can change how a finish appears.",
  ],
  [
    "How long will my painting project take?",
    "Timing depends on surface repairs, drying and cure windows, access, weather for exterior work, and the number of rooms or elevations.",
  ],
  [
    "What should a painting proposal explain?",
    "A useful proposal identifies included surfaces, preparation assumptions, the coating system, protection and cleanup, exclusions, and payment schedule. Discuss conditions discovered later before additional work proceeds.",
  ],
  [
    "How should I prepare for the crew?",
    "Preparation varies by project. Confirm who moves furniture, how fragile items are handled, where materials may be staged, whether pets need separation, and what access is needed each day.",
  ],
  [
    "What areas do you serve?",
    "Service area depends on project type and crew availability. Share the property address so the contractor can confirm fit before scheduling an estimate visit.",
  ],
  [
    "What happens after I get in touch?",
    "The contractor can ask about surfaces, condition, colors, timing, and access. If the project sounds like a fit, the next step is an estimate visit and written scope. This preview uses a dummy calendar and payment experience.",
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
          <Paintbrush className="size-5" strokeWidth={1.7} />
        )}
      </span>
      <span className="min-w-0 leading-none">
        <span className="overlay-brand-name block font-display text-xl tracking-[-0.03em]">
          {label}
        </span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.36em] text-white/65">
          Residential Painting
        </span>
      </span>
    </a>
  );
}

function BeforeAfter() {
  const [position, setPosition] = useState(52);
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-[#d2c6c8] outline-offset-4 focus-within:outline-2 focus-within:outline-[#d486a2] sm:aspect-[16/10] lg:aspect-[15/10]">
      <img
        src={IMAGE.after}
        alt="Illustrative room after sample paint transformation"
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
        <img
          src={IMAGE.before}
          alt="Illustrative room before sample paint transformation"
          loading="lazy"
          decoding="async"
          className="size-full object-cover grayscale-[.18] saturate-[.72]"
        />
        <div className="absolute inset-0 bg-[#3b2933]/15" />
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white/90"
        style={{ left: position + "%" }}
      >
        <span className="absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/60 bg-[#f7f1ed]/95 text-[#3b2933] shadow-xl">
          <span className="flex gap-1 text-sm">‹ ›</span>
        </span>
      </div>
      <input
        aria-label="Before and after comparison; use arrow keys to reveal the illustrative paint finish"
        aria-valuetext={`${position}% before, ${100 - position}% after`}
        type="range"
        min="10"
        max="90"
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="absolute inset-0 z-20 size-full cursor-ew-resize opacity-0"
      />
      <span className="absolute left-5 top-5 rounded-full bg-[#21151d]/82 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-white backdrop-blur">
        Before
      </span>
      <span className="absolute right-5 top-5 rounded-full bg-[#d486a2]/90 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-[#21151d] backdrop-blur">
        After
      </span>
    </div>
  );
}

function PainterSectionCta({
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
        (dark ? "border-white/20" : "border-[#3b2933]/18")
      }
    >
      <div>
        <p
          className={
            "text-[10px] font-bold uppercase tracking-[.22em] " +
            (dark ? "text-[#e8b8ca]" : "text-[#74636c]")
          }
        >
          Ready to refresh your surfaces?
        </p>
        <p
          className={
            "mt-2 max-w-2xl text-sm leading-6 " + (dark ? "text-white/65" : "text-[#74636c]")
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
            ? "bg-[#f1e7eb] text-[#422638] hover:bg-white"
            : "bg-[#5a3348] text-white hover:bg-[#6c3e55]")
        }
      >
        Request an estimate <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

export function PainterTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Color, carefully applied.";
  const heroAccent = text?.heroAccent ?? "Made for home.";
  const heroSub =
    text?.heroSub ??
    "This sample True Coat site presents residential interiors, exteriors, and cabinetry with a clear scope, protected spaces, and finish details considered from the start.";
  const philosophyTitle = text?.philosophyTitle ?? "A lasting finish begins before the first coat.";
  const philosophyAccent = text?.philosophyAccent ?? "It gives it back.";
  const philosophyBody =
    text?.philosophyBody ??
    "Careful masking, repairs, sanding, and protection create the conditions for consistent color, clean transitions, and an orderly final walkthrough.";
  const servicesHeading = text?.servicesHeading ?? "From preparation to finish.";
  const servicesIntro =
    text?.servicesIntro ??
    "A sample process—from the first site review through preparation, application, and final walkthrough.";
  const proofTitle = text?.proofTitle ?? "See what color";
  const proofAccent = text?.proofAccent ?? "can transform.";
  const proofBody =
    text?.proofBody ??
    "Move the handle to compare illustrative before-and-after views from the same camera position. Replace both with verified project photography before publishing.";
  const reviewsHeading = text?.reviewsHeading ?? "Sample feedback,";
  const reviewsAccent = text?.reviewsAccent ?? "awaiting verification.";
  const journalHeading = text?.journalHeading ?? "From the paint desk.";
  const faqTitle = text?.faqTitle ?? "Questions,";
  const faqAccent = text?.faqAccent ?? "answered.";
  const faqBody =
    text?.faqBody ??
    "Every paint project begins with practical questions. These sample answers should be verified and tailored before publishing.";
  const ctaTitle = text?.ctaTitle ?? "Let's make room";
  const ctaAccent = text?.ctaAccent ?? "for the good life.";
  const ctaBody =
    text?.ctaBody ??
    "Tell us what you're imagining. We'll listen, walk the space with you, and shape a practical path forward.";
  const footerBlurb =
    text?.footerBlurb ??
    "Interior, exterior, and cabinet painting presented as a sample residential contractor website.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const rawEmail = content?.email?.trim() ? content.email.trim() : null;
  const emailLabel = rawEmail ?? "hello@truecoat.example";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "True Coat";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const brandAria = brandName ? `${brandName} home` : "True Coat home";
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const reduceMotion = useReducedMotion();
  const [motionPreferenceReady, setMotionPreferenceReady] = useState(false);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const pageContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMotionPreferenceReady(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const menu = mobileMenuRef.current;
    const pageContent = pageContentRef.current;
    const menuButton = menuButtonRef.current;
    const getFocusable = () =>
      Array.from(
        menu?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    document.body.style.overflow = "hidden";
    pageContent?.setAttribute("inert", "");
    requestAnimationFrame(() =>
      menu?.querySelector<HTMLElement>('[aria-label="Close menu"]')?.focus(),
    );

    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", containFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      pageContent?.removeAttribute("inert");
      window.removeEventListener("keydown", containFocus);
      menuButton?.focus();
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
      className="min-h-screen overflow-x-visible bg-[#f7f1ed] font-sans text-[#3b2933] selection:bg-[#d486a2] selection:text-[#3b2933]"
    >
      <div ref={pageContentRef}>
        <section className="relative min-h-[780px] overflow-hidden bg-[#422638] text-white sm:min-h-screen">
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
                preload="metadata"
                poster={heroPoster}
                className="absolute inset-0 size-full object-cover object-[58%_center]"
              >
                <source src={IMAGE.heroVideo} type="video/mp4" />
              </video>
            )}
          </m.div>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(33,21,29,.88)_0%,rgba(33,21,29,.55)_42%,rgba(33,21,29,.09)_78%),linear-gradient(0deg,rgba(33,21,29,.5)_0%,transparent_45%)]" />
          <div className="absolute inset-0 opacity-[.14] [background-image:radial-gradient(circle_at_center,white_0.7px,transparent_0.8px)] [background-size:7px_7px]" />
          <header className="relative z-30 mx-auto flex w-full max-w-[1500px] items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
            <Logo label={brandLabel} ariaLabel={brandAria} logoUrl={logoUrl} />
            <nav className="hidden items-center gap-8 text-[11px] font-semibold uppercase tracking-[0.18em] lg:flex">
              {["Services", "Transformations", "Reviews", "Journal", "FAQ"].map((item) => (
                <a
                  key={item}
                  href={"#" + item.toLowerCase()}
                  className="relative min-h-11 py-3 text-white/80 after:absolute after:bottom-0 after:left-0 after:h-px after:w-0 after:bg-[#d486a2] after:transition-all hover:text-white hover:after:w-full"
                >
                  {item}
                </a>
              ))}
            </nav>
            <button
              type="button"
              onClick={openBooking}
              className="hidden min-h-12 items-center gap-3 rounded-full bg-[#d486a2] px-6 text-[11px] font-bold uppercase tracking-[0.18em] text-[#3b2933] transition-transform duration-300 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:flex"
            >
              Request an estimate <ArrowDownRight className="size-4" />
            </button>
            <button
              type="button"
              ref={menuButtonRef}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="painter-mobile-menu"
              onClick={() => setMenuOpen(true)}
              className="grid size-11 place-items-center rounded-full border border-white/30 bg-white/10 backdrop-blur lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </header>

          <div className="relative z-20 mx-auto flex min-h-[670px] w-full max-w-[1500px] items-end px-5 pb-16 sm:px-8 sm:pb-20 lg:px-12">
            <div className="grid w-full gap-10 lg:grid-cols-[1fr_320px] lg:items-end">
              <div className="max-w-4xl">
                <m.div
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7 }}
                  className="mb-6 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.28em] text-[#e8b8ca]"
                >
                  <span className="h-px w-10 bg-[#d486a2]" /> Residential painting, thoughtfully
                  finished
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
                  <span className="italic text-[#eadde3]" data-tkey="text.heroAccent">
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
                    className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full bg-[#d486a2] px-6 text-[11px] font-bold uppercase tracking-[.16em] text-[#422638] transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d486a2]"
                  >
                    Plan a finish <ArrowRight className="size-4" />
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
              <m.div
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.8 }}
                className="border-l border-white/25 pl-6"
              >
                {overlayReviews ? null : (
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2" aria-hidden="true">
                      {reviews.map((review) => (
                        <img
                          key={review.author}
                          src={review.image}
                          alt=""
                          className="size-10 rounded-lg border-2 border-[#5a3348] object-cover"
                        />
                      ))}
                    </div>
                    <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.18em] text-white/80 backdrop-blur">
                      Preview content
                    </span>
                  </div>
                )}
                {overlayReviews ? null : (
                  <>
                    <div
                      className="mt-4 flex gap-1 text-[#e8b8ca]"
                      aria-label="Example five-star rating"
                    >
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className="size-3.5 fill-current" aria-hidden="true" />
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-white/65">
                      Example review layout. Replace the imagery, rating, and feedback before
                      publishing.
                    </p>
                  </>
                )}
              </m.div>
            </div>
          </div>
          <div className="absolute bottom-0 right-0 z-20 hidden items-center gap-8 bg-[#f7f1ed] px-8 py-5 text-[#3b2933] md:flex">
            <span className="text-xs font-bold uppercase tracking-[0.24em]">Scroll to explore</span>
            <ArrowDownRight className="size-4" />
          </div>
        </section>

        <main>
          <section className="overflow-hidden border-b border-[#3b2933]/12 px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
            <div className="mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[.72fr_1.28fr]">
              <m.div {...reveal} className="lg:pt-2">
                <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#74636c]">
                  Our point of view
                </p>
                <div className="mt-8 grid max-w-[27rem] grid-cols-[1.12fr_.88fr] items-end gap-3 sm:mt-12 sm:gap-5">
                  <figure className="group relative aspect-[4/5] overflow-hidden bg-[#d2c6c8]">
                    <img
                      src={overlayMediaUrl(content, "philosophyDetail", IMAGE.philosophyDetail)}
                      alt="Painter cutting a crisp warm-ivory line beside deep aubergine trim"
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition-transform duration-[1.2s] group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      data-tkey="media.philosophyDetail"
                    />
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#21151d]/80 to-transparent px-4 pb-4 pt-16 text-[10px] font-bold uppercase tracking-[.2em] text-white/85">
                      A crisp cut line
                    </figcaption>
                  </figure>
                  <figure className="group relative mb-[-3rem] aspect-[3/4] overflow-hidden bg-[#d2c6c8] sm:mb-[-4.5rem]">
                    <img
                      src={overlayMediaUrl(content, "philosophyCraft", IMAGE.philosophyCraft)}
                      alt="Painter repairing and smoothing a plaster edge before coating"
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover transition-transform duration-[1.2s] group-hover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      data-tkey="media.philosophyCraft"
                    />
                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#21151d]/80 to-transparent px-4 pb-4 pt-16 text-[10px] font-bold uppercase tracking-[.2em] text-white/85">
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
                  <span className="italic text-[#806b75]" data-tkey="text.philosophyAccent">
                    {philosophyAccent}
                  </span>
                </p>
                <div className="mt-12 grid gap-8 border-t border-[#3b2933]/15 pt-8 sm:grid-cols-2">
                  <p className="text-sm leading-7 text-[#74636c]" data-tkey="text.philosophyBody">
                    {philosophyBody}
                  </p>
                  <div className="flex items-start gap-3 text-sm font-semibold">
                    <ShieldCheck className="mt-0.5 size-5 text-[#8f4766]" />
                    <span>
                      Thoughtful planning
                      <br />
                      Sample crew standards
                      <br />
                      Material planning
                    </span>
                  </div>
                </div>
              </m.div>
            </div>
            <PainterSectionCta
              prompt="Tell us which rooms or exterior surfaces you are considering, and we will start with the right questions."
              onClick={openBooking}
            />
          </section>

          <section id="services" className="bg-[#ede3dc] px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
            <div className="mx-auto max-w-[1400px]">
              <m.div
                {...reveal}
                className="mb-14 flex flex-col justify-between gap-6 lg:flex-row lg:items-end"
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.28em] text-[#74636c]">
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
                  className="max-w-sm text-sm leading-6 text-[#74636c]"
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
                      className="group relative min-h-[520px] overflow-hidden bg-[#5a3348] text-white"
                    >
                      <img
                        src={overlayMediaUrl(content, `serviceImage${index}`, service.image)}
                        alt={service.title}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 size-full object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
                        data-tkey={`media.serviceImage${index}`}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#21151d]/95 via-[#21151d]/20 to-[#21151d]/10" />
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
                            className="mt-7 flex min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-[#e8b8ca] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e8b8ca]"
                          >
                            Request an estimate{" "}
                            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                          </button>
                        </div>
                      </div>
                    </m.article>
                  );
                })}
              </div>
            </div>
            <PainterSectionCta
              prompt="Not sure which service fits? Share the surfaces, condition, and finish you have in mind."
              onClick={openBooking}
            />
          </section>

          <section
            id="transformations"
            className="bg-[#5a3348] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32"
          >
            <div className="mx-auto max-w-[1400px]">
              <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:items-end">
                <m.div {...reveal}>
                  <p className="text-xs font-bold uppercase tracking-[.28em] text-[#d486a2]">
                    Before & after
                  </p>
                  <h2
                    className="mt-5 font-display text-5xl leading-[.98] tracking-[-.045em] sm:text-7xl"
                    data-tkey="text.proofTitle"
                  >
                    {proofTitle}
                    <br />
                    <span className="italic text-[#d2c6c8]" data-tkey="text.proofAccent">
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
                    className="mt-9 inline-flex min-h-12 items-center gap-3 rounded-full bg-[#d486a2] px-6 text-xs font-bold uppercase tracking-[.18em] text-[#5a3348]"
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
            <PainterSectionCta
              prompt="Have a project in mind? Request an estimate visit to discuss its condition and scope."
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
                  <p className="text-xs font-bold uppercase tracking-[.28em] text-[#74636c]">
                    Happy customers
                  </p>
                  <h2
                    className="mt-4 font-display text-5xl tracking-[-.045em] sm:text-7xl"
                    data-tkey="text.reviewsHeading"
                  >
                    {reviewsHeading}
                    <br />
                    <span className="italic text-[#806b75]" data-tkey="text.reviewsAccent">
                      {reviewsAccent}
                    </span>
                  </h2>
                </div>
                {overlayReviews ? null : (
                  <div className="flex items-center gap-3">
                    <div className="flex text-[#8f4766]">
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
                <div className="mt-14 grid gap-px overflow-hidden border border-[#3b2933]/15 bg-[#3b2933]/15 lg:grid-cols-3">
                  {(overlayReviews ?? reviews).map((review, index) => (
                    <m.article
                      key={"author" in review ? review.author : index}
                      {...reveal}
                      transition={{ duration: 0.75, ease, delay: index * 0.08 }}
                      className="group bg-[#f7f1ed] p-7 sm:p-9"
                    >
                      <div className="flex items-center justify-between">
                        <Quote className="size-8 text-[#8f4766]" strokeWidth={1.2} />
                        {"source" in review ? (
                          <span
                            className="flex min-h-8 items-center gap-2 rounded-full border border-[#3b2933]/15 bg-white/35 px-3 py-1.5"
                            aria-label={`Sample review card; source badge style shown with ${review.source} branding`}
                          >
                            <span className="text-[9px] font-bold uppercase tracking-[.16em] text-[#74636c]">
                              Sample
                            </span>
                            <span className="h-3 w-px bg-[#3b2933]/15" />
                            <img
                              src={review.sourceLogo}
                              alt=""
                              aria-hidden="true"
                              loading="lazy"
                              decoding="async"
                              className={review.source === "Yelp" ? "h-4 w-auto" : "h-3.5 w-auto"}
                            />
                          </span>
                        ) : null}
                      </div>
                      <blockquote
                        className="mt-12 font-display text-2xl leading-[1.3] tracking-[-.025em]"
                        data-tkey={`reviews.${index}.quote`}
                      >
                        “{review.quote}”
                      </blockquote>
                      <div className="mt-12 flex items-center gap-3 border-t border-[#3b2933]/12 pt-6">
                        <img
                          src={overlayMediaUrl(
                            content,
                            `reviewImage${index}`,
                            "image" in review ? review.image : IMAGE.hero,
                          )}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="size-11 rounded-lg object-cover grayscale-[.15]"
                          data-tkey={`media.reviewImage${index}`}
                        />
                        <div>
                          <p className="text-sm font-bold" data-tkey={`reviews.${index}.author`}>
                            {review.author}
                          </p>
                          {"location" in review ? (
                            <p className="mt-1 text-xs uppercase tracking-[.18em] text-[#74636c]">
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
                <p className="mt-5 text-xs text-[#74636c]">
                  Sample testimonials and project scenes demonstrate the intended layout only.
                  Replace every claim, rating, image, and attribution with verified, permissioned
                  customer feedback before publishing.
                </p>
              )}
            </div>
            <PainterSectionCta
              prompt="Bring your color ideas, priorities, and timing—we will help organize the next step."
              onClick={openBooking}
            />
          </section>

          <section id="journal" className="bg-[#eadde3] px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
            <div className="mx-auto max-w-[1400px]">
              <m.div {...reveal} className="mb-14 flex items-end justify-between gap-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.28em] text-[#74636c]">
                    Field notes
                  </p>
                  <h2
                    className="mt-4 font-display text-5xl tracking-[-.045em] sm:text-7xl"
                    data-tkey="text.journalHeading"
                  >
                    {journalHeading}
                  </h2>
                </div>
                <span className="hidden text-xs font-bold uppercase tracking-[.2em] text-[#74636c] sm:block">
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
                      <div className="aspect-[4/3] overflow-hidden bg-[#d2c6c8]">
                        <img
                          src={overlayMediaUrl(
                            content,
                            `journalImage${index}` as "journalImage0",
                            post.image,
                          )}
                          alt={overlayPost?.title ?? post.title}
                          loading="lazy"
                          decoding="async"
                          className="size-full object-cover transition-transform duration-1000 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                          data-tkey={`media.journalImage${index}`}
                        />
                      </div>
                      <div className="mt-5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.22em] text-[#74636c]">
                        <span data-tkey={`blogs.${index}.category`}>
                          {overlayPost?.category ?? post.category}
                        </span>
                        <span className="size-1 rounded-full bg-[#8f4766]" />
                        <span>{post.date}</span>
                      </div>
                      <h3
                        className="mt-4 font-display text-3xl leading-[1.1] tracking-[-.03em]"
                        data-tkey={`blogs.${index}.title`}
                      >
                        {overlayPost?.title ?? post.title}
                      </h3>
                      <span className="mt-5 inline-flex min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-[#74636c]">
                        Sample article · No linked page
                      </span>
                    </m.article>
                  );
                })}
              </div>
            </div>
            <PainterSectionCta
              prompt="See a finish that could suit your home? Start with an estimate request."
              onClick={openBooking}
            />
          </section>

          <section id="faq" className="px-5 py-20 sm:px-8 lg:px-12 lg:py-32">
            <div className="mx-auto grid max-w-[1400px] gap-14 lg:grid-cols-[.72fr_1.28fr]">
              <m.div {...reveal}>
                <p className="text-xs font-bold uppercase tracking-[.28em] text-[#74636c]">
                  Good to know
                </p>
                <h2
                  className="mt-4 font-display text-5xl leading-none tracking-[-.045em] sm:text-7xl"
                  data-tkey="text.faqTitle"
                >
                  {faqTitle}
                  <br />
                  <span className="italic text-[#806b75]" data-tkey="text.faqAccent">
                    {faqAccent}
                  </span>
                </h2>
                <p
                  className="mt-7 max-w-sm text-base leading-7 text-[#74636c]"
                  data-tkey="text.faqBody"
                >
                  {faqBody}
                </p>
              </m.div>
              <m.div {...reveal} className="border-t border-[#3b2933]/18">
                {faqs.map(([question, answer], index) => {
                  const open = openFaq === index;
                  return (
                    <div key={question} className="border-b border-[#3b2933]/18">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`faq-panel-${index}`}
                        id={`faq-button-${index}`}
                        onClick={() => setOpenFaq(open ? -1 : index)}
                        className="flex w-full items-center justify-between gap-5 py-7 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8f4766]"
                      >
                        <span className="font-display text-xl tracking-[-.02em] sm:text-2xl">
                          {question}
                        </span>
                        <span
                          className={
                            "grid size-9 shrink-0 place-items-center rounded-full border border-[#3b2933]/20 transition-transform duration-300 " +
                            (open ? "rotate-180 bg-[#5a3348] text-white" : "")
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
                          <p className="max-w-2xl pb-8 pr-12 text-base leading-7 text-[#74636c]">
                            {answer}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </m.div>
            </div>
            <PainterSectionCta
              prompt="Still deciding? Share the questions that matter most to your home and surfaces."
              onClick={openBooking}
            />
          </section>

          <section
            id="contact"
            className="relative overflow-hidden bg-[#422638] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-32"
          >
            <div className="absolute -right-28 -top-28 size-96 rounded-full border border-white/10" />
            <div className="absolute -right-8 -top-8 size-96 rounded-full border border-white/10" />
            <m.div
              {...reveal}
              className="relative mx-auto grid max-w-[1400px] gap-12 lg:grid-cols-[1fr_420px] lg:items-end"
            >
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-[11px] font-bold uppercase tracking-[.22em] text-[#e8b8ca]">
                  <Sparkles className="size-3" /> Your finish starts here
                </span>
                <h2
                  className="mt-7 max-w-4xl font-display text-[clamp(3.5rem,8vw,8rem)] leading-[.87] tracking-[-.06em]"
                  data-tkey="text.ctaTitle"
                >
                  {ctaTitle}
                  <br />
                  <span className="italic text-[#eadde3]" data-tkey="text.ctaAccent">
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
                  className="mt-7 flex min-h-14 w-full items-center justify-between rounded-full bg-[#d486a2] px-6 text-[11px] font-bold uppercase tracking-[.16em] text-[#422638] transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span>Request an estimate</span>
                  <CalendarDays className="size-4" />
                </button>
                <a
                  href={phoneHref}
                  data-tkey="contact.phone"
                  className="mt-4 flex min-h-12 w-full items-center justify-between rounded-full border border-white/25 px-6 text-[11px] font-bold uppercase tracking-[.16em]"
                >
                  <span>{rawPhone ? phoneLabel : "(555) 013-7482 · Sample number"}</span>
                  <Phone className="size-4" />
                </a>
              </div>
            </m.div>
          </section>
        </main>

        <footer className="bg-[#21151d] px-5 pb-8 pt-16 text-white sm:px-8 lg:px-12">
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
                <p className="text-[11px] font-bold uppercase tracking-[.24em] text-white/60">
                  Explore
                </p>
                <div className="mt-5 grid gap-3 text-sm text-white/75">
                  {["Services", "Transformations", "Reviews", "Journal", "FAQ"].map((item) => (
                    <a key={item} href={"#" + item.toLowerCase()} className="hover:text-[#d486a2]">
                      {item}
                    </a>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.24em] text-white/60">
                  Contact
                </p>
                <div className="mt-5 grid gap-3 text-sm text-white/75">
                  <span>Service area varies by project</span>
                  <a href={phoneHref} data-tkey="contact.phone">
                    {rawPhone ? phoneLabel : "(555) 013-7482 · Sample number"}
                  </a>
                  <a href={emailHref} data-tkey="contact.email">
                    {rawEmail ? emailLabel : "hello@truecoat.example · Sample address"}
                  </a>
                  <span>Hours · Sample hours</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-between gap-5 pt-7 text-[11px] font-semibold uppercase tracking-[.2em] text-white/60 sm:flex-row">
              <span>
                {brandName ? `© 2026 ${brandName}` : "© 2026 True Coat · Template preview"}
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
      </div>

      {menuOpen
        ? createPortal(
            <m.div
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              ref={mobileMenuRef}
              id="painter-mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label="Site navigation"
              className="fixed inset-0 z-[70] bg-[#422638] p-6 text-white lg:hidden"
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
                className="mt-12 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#d486a2] font-semibold text-[#422638]"
              >
                Request an estimate <ArrowRight className="size-4" />
              </button>
            </m.div>,
            document.body,
          )
        : null}

      <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
    </div>
  );
}
