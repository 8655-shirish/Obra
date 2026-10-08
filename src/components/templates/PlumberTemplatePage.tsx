import {
  ArrowDownRight,
  ArrowRight,
  Check,
  ChevronDown,
  Droplet,
  Gauge,
  Menu,
  Phone,
  Quote,
  ShieldCheck,
  Waves,
  Wrench,
  X,
} from "lucide-react";
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

const IMAGE = {
  hero: "/templates/leak-geeks/generated/hero.jpg",
  heroVideo: "/templates/leak-geeks/generated/hero-loop.mp4",
  ethosFlow: "/templates/leak-geeks/generated/ethos-flow.jpg",
  ethosCraft: "/templates/leak-geeks/generated/ethos-craft.jpg",
  serviceLeak: "/templates/leak-geeks/generated/service-leak.jpg",
  serviceBackflow: "/templates/leak-geeks/generated/service-backflow.jpg",
  servicePlumbing: "/templates/leak-geeks/generated/service-plumbing.jpg",
  projectBefore: "/templates/leak-geeks/generated/project-before.jpg",
  projectAfter: "/templates/leak-geeks/generated/project-after.jpg",
  journalPressure: "/templates/leak-geeks/generated/journal-pressure.jpg",
  journalSigns: "/templates/leak-geeks/generated/journal-signs.jpg",
  journalBackflow: "/templates/leak-geeks/generated/journal-backflow.jpg",
  reviewKitchen: "/templates/leak-geeks/generated/review-kitchen.jpg",
  reviewYard: "/templates/leak-geeks/generated/review-yard.jpg",
  reviewBath: "/templates/leak-geeks/generated/review-bath.jpg",
} as const;

const services = [
  {
    code: "LD—01",
    title: "Leak detection",
    text: "We follow moisture, pressure, fixture, and supply-line clues to narrow the source before recommending access or repair.",
    image: IMAGE.serviceLeak,
    icon: Waves,
    stat: "Trace the source",
  },
  {
    code: "BF—02",
    title: "Backflow testing & repair",
    text: "Assessment and service options for backflow prevention assemblies, with findings and next steps explained in plain language.",
    image: IMAGE.serviceBackflow,
    icon: ShieldCheck,
    stat: "Help protect the supply",
  },
  {
    code: "PL—03",
    title: "Fixtures, pressure & supply lines",
    text: "Troubleshooting for fixture problems, water-pressure concerns, and supply-line repairs, subject to property access and project fit.",
    image: IMAGE.servicePlumbing,
    icon: Wrench,
    stat: "Address the flow problem",
  },
] as const;

const reviews = [
  {
    quote:
      "Sample story: the leak was found fast, every surface was protected, and each step was explained before the work began.",
    author: "Sample customer 1",
    source: "Google",
    image: IMAGE.reviewKitchen,
  },
  {
    quote:
      "Sample story: clear explanation of the backflow repair, fair pricing, and everything tested before sign-off.",
    author: "Sample customer 2",
    source: "Yelp",
    image: IMAGE.reviewYard,
  },
  {
    quote:
      "Sample story: tidy work from the first call to the finished repair, with honest updates throughout.",
    author: "Sample customer 3",
    source: "Google",
    image: IMAGE.reviewBath,
  },
] as const;

const posts = [
  {
    number: "01",
    category: "Water pressure",
    title: "What your pressure gauge is trying to tell you",
    text: "A practical guide to the quiet signals behind noisy pipes, weak flow, and stressed fixtures.",
    image: IMAGE.journalPressure,
  },
  {
    number: "02",
    category: "Leak guide",
    title: "Five early signs of a hidden water leak",
    text: "A practical overview of clues that may point to a concealed leak—even before you see visible water.",
    image: IMAGE.journalSigns,
  },
  {
    number: "03",
    category: "Backflow basics",
    title: "Why backflow protection matters at home",
    text: "A plain-English look at the device that helps protect your drinking-water supply.",
    image: IMAGE.journalBackflow,
  },
] as const;

const faqs = [
  [
    "What kinds of plumbing work do you handle?",
    "We focus on residential leak diagnostics, backflow testing and repair, water-pressure concerns, fixture and supply-line repairs, and practical plumbing troubleshooting. Project fit depends on the property, access, scope, and service area.",
  ],
  [
    "How do you find a leak without unnecessary damage?",
    "We begin with the evidence: meter behavior, pressure, moisture patterns, fixture isolation, and targeted diagnostic tools. The goal is to narrow the source before recommending access or repair, then explain what we found in straightforward language.",
  ],
  [
    "What is backflow, and why does it matter?",
    "Backflow is an unwanted reversal of water through a plumbing connection. A properly functioning prevention assembly helps protect the potable water supply. Testing and requirements vary by property and local authority, so we confirm the correct next step for your setup.",
  ],
  [
    "Do you repair or replace backflow assemblies?",
    "Both, when appropriate. We assess the assembly, explain whether a focused repair or replacement offers better long-term value, complete the agreed work, and test operation afterward. Any certification or reporting requirement should be confirmed for the local jurisdiction.",
  ],
  [
    "How quickly can you visit?",
    "Availability depends on location, current scheduling, and urgency. Tell us what you are seeing, when it started, and whether you can safely isolate the water. We will confirm the earliest appropriate appointment and share practical next steps in the meantime.",
  ],
  [
    "How do estimates and pricing work?",
    "We discuss the likely diagnostic path before work begins. Once the source and repair options are clear, we explain the recommended scope and pricing so you can make an informed choice. Some concealed conditions only become visible after approved access.",
  ],
  [
    "What should I do if water is actively leaking?",
    "If it is safe, shut off the nearest fixture valve or the home's main water supply and move belongings away from the area. Avoid standing water near electrical sources. For an immediate safety risk or major uncontrolled flooding, contact the appropriate emergency service first.",
  ],
  [
    "What happens after I request an appointment?",
    "We will ask a few focused questions about the property and symptoms, confirm service-area and scheduling fit, and set expectations for the visit. A technician can then diagnose the issue and talk through repair options before proceeding.",
  ],
] as const;

const navItems = [
  { label: "Services", target: "services" },
  { label: "How it works", target: "process" },
  { label: "Sample project", target: "results" },
  { label: "Sample reviews", target: "reviews" },
  { label: "Guides", target: "journal" },
  { label: "FAQ", target: "faq" },
] as const;
const displayFont = { fontFamily: '"Arial Black", "Helvetica Neue", Arial, sans-serif' };
const monoFont = { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' };

function Mark({ brand, logoUrl }: { brand: string; logoUrl: string | null }) {
  return (
    <a
      href="#top"
      className="flex min-h-12 min-w-0 items-center gap-3"
      aria-label={`${brand} — backflow and plumbing, back to top`}
    >
      <span
        className="overlay-brand-mark relative grid size-11 place-items-center overflow-hidden bg-[#73e6df] text-[#090f13]"
        data-tkey="media.logo"
      >
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-full object-contain" />
        ) : (
          <>
            <Droplet className="relative z-10 size-5 fill-current" />
            <span className="absolute -bottom-3 -right-3 size-8 rounded-full bg-[#079bb2]" />
          </>
        )}
      </span>
      <span className="min-w-0 leading-none">
        <span
          className="overlay-brand-name block text-lg font-black uppercase tracking-[-.055em]"
          style={displayFont}
        >
          {brand}
        </span>
        <span
          className="mt-1.5 block text-[8px] font-bold uppercase tracking-[.22em] text-[#526068]"
          style={monoFont}
        >
          Leak detection · backflow · plumbing
        </span>
      </span>
    </a>
  );
}

function SectionTag({
  number,
  children,
  light = false,
}: {
  number: string;
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div
      className={
        "flex items-center gap-3 text-[10px] font-bold uppercase tracking-[.18em] " +
        (light ? "text-white/60" : "text-[#5b6870]")
      }
      style={monoFont}
    >
      <span className={light ? "text-[#73e6df]" : "text-[#079bb2]"}>{number}</span>
      <span className={light ? "h-px w-8 bg-white/25" : "h-px w-8 bg-[#11191e]/20"} />
      {children}
    </div>
  );
}

function PlumberSectionCta({
  prompt,
  onClick,
  disabled,
  dark = false,
}: {
  prompt: string;
  onClick: () => void;
  disabled: boolean;
  dark?: boolean;
}) {
  return (
    <div
      data-section-cta
      className={
        "mx-auto mt-14 flex max-w-[1600px] flex-col gap-5 border-t pt-6 sm:flex-row sm:items-center sm:justify-between " +
        (dark ? "border-white/20" : "border-[#0a3945]/20")
      }
    >
      <div>
        <p
          className={
            "text-[8px] font-bold uppercase tracking-[.18em] " +
            (dark ? "text-[#73e6df]" : "text-[#079bb2]")
          }
          style={monoFont}
        >
          Have a plumbing concern?
        </p>
        <p
          className={
            "mt-2 max-w-2xl text-sm leading-6 " + (dark ? "text-white/65" : "text-[#40545d]")
          }
        >
          {prompt}
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={
          "flex min-h-12 shrink-0 items-center justify-between gap-8 px-5 text-[9px] font-bold uppercase tracking-[.16em] " +
          (dark ? "bg-[#73e6df] text-[#062d3a]" : "bg-[#062d3a] text-white")
        }
        style={monoFont}
      >
        Request a visit <ArrowRight className="size-4" />
      </button>
    </div>
  );
}

/**
 * Overlay-driven template mold (plan/template-purchase.md §4).
 * Every prop is optional: omitted keys fall back to static defaults, so
 * `/templates/plumber` renders byte-identical with no props while
 * `/lp/<id>` passes the purchaser's overlay content.
 */
export function PlumberTemplatePage({
  content,
  bookingMode = content ? "disabled" : "demo",
  onOpenBooking,
}: {
  content?: TemplateMoldContent;
  bookingMode?: "demo" | "live" | "disabled";
  onOpenBooking?: () => void;
}) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Find the leak.";
  const heroAccent = text?.heroAccent ?? "Fix the flow.";
  const heroSub =
    text?.heroSub ??
    "Clear diagnostic help for hidden leaks, water-pressure concerns, backflow assemblies, and common residential plumbing problems.";
  const processTitle = text?.processTitle ?? "Water leaves evidence.";
  const processBody =
    text?.processBody ??
    "We start with the symptoms, narrow the likely source, and explain what the evidence supports before recommending access or repair.";
  const servicesTitle = text?.servicesTitle ?? "Leaks. Backflow. Plumbing repairs.";
  const servicesBody =
    text?.servicesBody ??
    "Start with the issue closest to what you are seeing. Project fit depends on the property, access, scope, and service area.";
  const resultsTitle = text?.resultsTitle ?? "Sample project comparison.";
  const resultsBody =
    text?.resultsBody ??
    "Drag the slider to compare sample before-and-after images from one fixed camera angle. Replace both images with verified project photography before publishing.";
  const reviewsTitle = text?.reviewsTitle ?? "Neighbors call back.";
  const reviewsBody =
    text?.reviewsBody ??
    "Illustrative review content for this template preview. Replace every quote and attribution with verified feedback.";
  const journalTitle = text?.journalTitle ?? "Know the signs.";
  const faqTitle = text?.faqTitle ?? "Clear answers.";
  const faqBody =
    text?.faqBody ??
    "Practical answers about service fit, diagnosis, pricing, scheduling, and active leaks.";
  const ctaTitle = text?.ctaTitle ?? "Put water back in place.";
  const ctaBody =
    text?.ctaBody ??
    "Tell us where you see the problem, when it started, and whether water is still running. We will confirm whether the job fits and explain the next step.";
  const footerBlurb =
    text?.footerBlurb ??
    "Leak detection, backflow service, and residential plumbing—with the findings, options, and next step explained clearly.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 014-7263";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550147263";
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@leakgeeks.example";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "Leak Geeks";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const renderedReviews =
    overlayReviews && overlayReviews.length > 0
      ? overlayReviews.map((item, index) => ({
          quote: item.quote,
          author: item.author,
          attribution: item.attribution,
          image: overlayMediaUrl(
            content,
            `reviewImage${index % 3}`,
            [IMAGE.reviewKitchen, IMAGE.reviewYard, IMAGE.reviewBath][index % 3],
          ),
          source: item.attribution,
        }))
      : overlayReviews
        ? []
        : reviews.map((item, index) => ({
            ...item,
            attribution: "Sample" as string | null,
            image: overlayMediaUrl(content, `reviewImage${index}`, item.image),
          }));
  const showSampleReviews = overlayReviews === null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const bookingDisabled = bookingMode === "disabled" || (bookingMode === "live" && !onOpenBooking);
  const [openFaq, setOpenFaq] = useState(0);
  const [comparison, setComparison] = useState(50);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = useReducedMotion();
  const [motionPreferenceReady, setMotionPreferenceReady] = useState(false);

  useEffect(() => {
    setMotionPreferenceReady(true);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (reduceMotion) return;
    void heroVideoRef.current?.play().catch(() => undefined);
  }, [reduceMotion]);

  const openBooking = () => {
    if (bookingDisabled) return;
    setMenuOpen(false);
    if (bookingMode === "live") onOpenBooking?.();
    else setBookingOpen(true);
  };

  return (
    <div
      id="top"
      className="min-h-screen overflow-x-visible bg-[#eaf8f7] text-[#062d3a] selection:bg-[#73e6df]"
      style={{ fontFamily: 'Arial, "Helvetica Neue", sans-serif' }}
    >
      <header className="relative z-30 border-b border-[#0a3945]/15 bg-[#eaf8f7]">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-3 sm:px-8 lg:px-12">
          <Mark brand={brandLabel} logoUrl={logoUrl} />
          <nav className="hidden items-center gap-7 xl:flex" aria-label="Primary navigation">
            {navItems.map((item, index) => (
              <a
                key={item.target}
                href={"#" + item.target}
                className="group flex min-h-11 items-center gap-2 text-[9px] font-bold uppercase tracking-[.17em]"
                style={monoFont}
              >
                <span className="text-[#079bb2]">0{index + 1}</span>
                <span className="transition group-hover:text-[#079bb2]">{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a
              href={phoneHref}
              aria-label={rawPhone ? `Call ${phoneLabel}` : "Call sample number (555) 014-7263"}
              data-tkey="contact.phone"
              className="hidden min-h-12 items-center gap-2 border border-[#0a3945]/20 px-5 text-[9px] font-bold uppercase tracking-[.15em] md:flex"
              style={monoFont}
            >
              <Phone className="size-3.5 text-[#079bb2]" />{" "}
              {rawPhone ? phoneLabel : "Sample phone · (555) 014-7263"}
            </a>
            <button
              type="button"
              onClick={openBooking}
              disabled={bookingDisabled}
              className="hidden min-h-12 bg-[#079bb2] px-6 text-[9px] font-bold uppercase tracking-[.17em] text-white transition hover:bg-[#087f94] sm:block"
              style={monoFont}
            >
              Request a visit ↗
            </button>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="plumber-mobile-menu"
              onClick={() => setMenuOpen(true)}
              className="grid size-12 place-items-center border border-[#0a3945]/20 xl:hidden"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div
          id="plumber-mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="fixed inset-0 z-[70] flex flex-col bg-[#079bb2] px-5 py-5 text-white"
        >
          <div className="flex items-center justify-between">
            <span className="text-xl font-black uppercase tracking-[-.055em]" style={displayFont}>
              {brandLabel}
            </span>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => {
                setMenuOpen(false);
                menuButtonRef.current?.focus();
              }}
              className="grid size-12 place-items-center border border-white/30"
            >
              <X className="size-5" />
            </button>
          </div>
          <nav className="mt-14 border-t border-white/25" aria-label="Mobile navigation">
            {navItems.map((item, index) => (
              <a
                key={item.target}
                href={"#" + item.target}
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[76px] items-center justify-between border-b border-white/25 text-3xl font-black uppercase tracking-[-.055em]"
                style={displayFont}
              >
                {item.label}
                <span className="text-xs text-[#73e6df]" style={monoFont}>
                  0{index + 1}
                </span>
              </a>
            ))}
          </nav>
          <button
            type="button"
            onClick={openBooking}
            disabled={bookingDisabled}
            className="mt-auto min-h-16 bg-[#73e6df] text-[10px] font-bold uppercase tracking-[.18em] text-[#062d3a]"
            style={monoFont}
          >
            Request a visit ↗
          </button>
        </div>
      ) : null}

      <main>
        <section className="relative min-h-[calc(100svh-113px)] overflow-hidden border-b border-white/15 bg-[#062d3a] text-white">
          <img
            src={heroPoster}
            alt="Sample image of a plumbing technician testing a water system"
            className="absolute inset-0 size-full object-cover object-[62%_center] sm:object-center"
            fetchPriority="high"
            data-tkey="media.heroPoster"
          />
          {!motionPreferenceReady || reduceMotion ? null : (
            <video
              ref={heroVideoRef}
              aria-label="Cinematic sample footage of a technician diagnosing a plumbing leak"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              poster={heroPoster}
              onCanPlay={(event) => {
                void event.currentTarget.play().catch(() => undefined);
              }}
              className="absolute inset-0 size-full object-cover object-[62%_center] sm:object-center"
            >
              <source src={IMAGE.heroVideo} type="video/mp4" />
            </video>
          )}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,34,45,.88)_0%,rgba(3,34,45,.64)_37%,rgba(3,34,45,.05)_74%),linear-gradient(0deg,rgba(3,34,45,.78)_0%,transparent_45%)] max-lg:bg-[linear-gradient(0deg,rgba(3,34,45,.94)_0%,rgba(3,34,45,.55)_54%,rgba(3,34,45,.08)_100%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(147,237,235,.3)_1px,transparent_1px),linear-gradient(90deg,rgba(147,237,235,.3)_1px,transparent_1px)] [background-size:54px_54px] [mask-image:linear-gradient(90deg,black,transparent_58%)]" />

          <div className="relative mx-auto flex min-h-[calc(100svh-113px)] max-w-[1600px] flex-col justify-between px-5 py-7 sm:px-8 sm:py-10 lg:px-12 lg:py-12">
            <div className="flex items-center justify-between gap-5">
              <span
                className="inline-flex items-center gap-2 border border-white/30 bg-[#062d3a]/30 px-3 py-2 text-[9px] font-bold uppercase tracking-[.15em] backdrop-blur-md"
                style={monoFont}
              >
                <span className="size-2 animate-pulse rounded-full bg-[#73e6df] motion-reduce:animate-none" />{" "}
                Leak, pressure, or backflow concern?
              </span>
              <span
                className="text-[9px] uppercase tracking-[.16em] text-white/55"
                style={monoFont}
              >
                Template preview
              </span>
            </div>

            <div className="grid gap-6 py-9 sm:py-14 lg:grid-cols-[1.15fr_.85fr] lg:items-end">
              <div>
                <p
                  className="mb-5 text-[9px] font-bold uppercase tracking-[.2em] text-[#73e6df] sm:text-[10px]"
                  style={monoFont}
                >
                  Leak detection · backflow · plumbing
                </p>
                <h1
                  className="max-w-[900px] text-[clamp(3.55rem,8.5vw,9.4rem)] font-black uppercase leading-[.74] tracking-[-.09em]"
                  style={displayFont}
                  data-tkey="text.heroTitle"
                >
                  {heroTitle}
                  <span className="block text-[#73e6df]" data-tkey="text.heroAccent">
                    {heroAccent}
                  </span>
                </h1>
              </div>
              <div className="max-w-lg lg:justify-self-end">
                <p
                  className="text-base font-medium leading-7 text-white/78 sm:text-lg sm:leading-8"
                  data-tkey="text.heroSub"
                >
                  {heroSub}
                </p>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={openBooking}
                    disabled={bookingDisabled}
                    className="group flex min-h-16 items-center justify-between bg-[#73e6df] px-6 text-[10px] font-bold uppercase tracking-[.16em] text-[#062d3a]"
                    style={monoFont}
                  >
                    Request a visit{" "}
                    <ArrowDownRight className="size-5 transition group-hover:translate-x-1 group-hover:translate-y-1" />
                  </button>
                  <a
                    href="#services"
                    className="flex min-h-16 items-center justify-between border border-white/40 bg-[#062d3a]/20 px-6 text-[10px] font-bold uppercase tracking-[.16em] text-white backdrop-blur-sm"
                    style={monoFont}
                  >
                    See plumbing services <ArrowRight className="size-4" />
                  </a>
                </div>
              </div>
            </div>

            <div className="grid gap-5 border-t border-white/25 pt-5 sm:grid-cols-[1fr_auto] sm:items-end max-sm:[&>div:first-child]:hidden">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-3">
                  <Gauge className="size-4 text-[#73e6df]" />
                  <span
                    className="text-[8px] font-bold uppercase tracking-[.15em]"
                    style={monoFont}
                  >
                    Diagnose before disturbing
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="size-4 text-[#73e6df]" />
                  <span
                    className="text-[8px] font-bold uppercase tracking-[.15em]"
                    style={monoFont}
                  >
                    Protect the water supply
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Check className="size-4 text-[#73e6df]" />
                  <span
                    className="text-[8px] font-bold uppercase tracking-[.15em]"
                    style={monoFont}
                  >
                    Repair options explained first
                  </span>
                </div>
              </div>
              <div className="hidden sm:block sm:max-w-sm">
                <p
                  className="text-[8px] font-bold uppercase tracking-[.18em] text-[#73e6df]"
                  style={monoFont}
                >
                  Sample 10-second video · Loops automatically
                </p>
                <p className="mt-1 text-xs leading-5 text-white/58">
                  Sample generated footage. Replace before publishing.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="process"
          className="border-b border-[#0a3945]/15 bg-[#eaf8f7] px-5 py-24 sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto grid max-w-[1600px] gap-14 lg:grid-cols-[.62fr_1.38fr]">
            <div>
              <SectionTag number="01">How diagnosis works</SectionTag>
              <h2
                className="mt-8 text-[clamp(3.4rem,6vw,6.8rem)] font-black uppercase leading-[.82] tracking-[-.075em]"
                style={displayFont}
                data-tkey="text.processTitle"
              >
                {processTitle}
              </h2>
              <p
                className="mt-8 max-w-md text-base leading-8 text-[#526068]"
                data-tkey="text.processBody"
              >
                {processBody}
              </p>
            </div>
            <div className="grid min-h-[650px] grid-cols-2 grid-rows-2 gap-3">
              <figure className="relative row-span-2 overflow-hidden bg-[#062d3a]">
                <img
                  src={overlayMediaUrl(content, "ethosFlow", IMAGE.ethosFlow)}
                  alt="Water folding over a brushed-steel fixture"
                  loading="lazy"
                  className="size-full object-cover"
                  data-tkey="media.ethosFlow"
                />
                <figcaption
                  className="absolute inset-x-0 bottom-0 bg-[#062d3a] p-5 text-[9px] font-bold uppercase tracking-[.16em] text-white"
                  style={monoFont}
                >
                  A / Read the signal
                </figcaption>
              </figure>
              <figure className="relative overflow-hidden bg-[#062d3a]">
                <img
                  src={overlayMediaUrl(content, "ethosCraft", IMAGE.ethosCraft)}
                  alt="A technician testing a backflow assembly"
                  loading="lazy"
                  className="size-full object-cover"
                  data-tkey="media.ethosCraft"
                />
                <figcaption
                  className="absolute inset-x-0 bottom-0 bg-[#73e6df] p-4 text-[9px] font-bold uppercase tracking-[.16em]"
                  style={monoFont}
                >
                  B / Test the system
                </figcaption>
              </figure>
              <figure className="relative grid overflow-hidden bg-[#062d3a] text-white">
                <img
                  src={overlayMediaUrl(content, "ethosRepair", IMAGE.servicePlumbing)}
                  alt="A technician completing a careful plumbing repair beneath a sink"
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                  data-tkey="media.ethosRepair"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#062d3a] via-[#062d3a]/72 to-[#062d3a]/10" />
                <div className="relative grid min-h-[300px] p-4 sm:p-8">
                  <div
                    className="flex justify-between text-[9px] uppercase tracking-[.17em] text-white/70"
                    style={monoFont}
                  >
                    <span>C / Repair plan</span>
                    <span className="hidden sm:inline">03 steps</span>
                  </div>
                  <ol
                    className="mt-auto space-y-2 text-base font-black uppercase tracking-[-.04em] sm:space-y-3 sm:text-2xl"
                    style={displayFont}
                  >
                    <li>01 — Gather clues</li>
                    <li>02 — Narrow source</li>
                    <li className="text-[#73e6df]">03 — Explain options</li>
                  </ol>
                </div>
              </figure>
            </div>
          </div>
          <PlumberSectionCta
            prompt="Tell us what you are seeing and we will start with the right diagnostic questions."
            onClick={openBooking}
            disabled={bookingDisabled}
          />
        </section>

        <section
          id="services"
          className="border-b border-white/15 bg-[#062d3a] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto max-w-[1600px]">
            <div className="grid gap-8 border-b border-white/20 pb-10 lg:grid-cols-[1fr_1fr] lg:items-end">
              <div>
                <SectionTag number="02" light>
                  Plumbing services
                </SectionTag>
                <h2
                  className="mt-7 text-[clamp(4rem,8vw,9rem)] font-black uppercase leading-[.76] tracking-[-.085em]"
                  style={displayFont}
                  data-tkey="text.servicesTitle"
                >
                  {servicesTitle}
                </h2>
              </div>
              <p
                className="max-w-md justify-self-end text-base leading-8 text-white/55"
                data-tkey="text.servicesBody"
              >
                {servicesBody}
              </p>
            </div>
            <div className="divide-y divide-white/20">
              {services.map((service, index) => {
                const Icon = service.icon;
                return (
                  <article
                    key={service.title}
                    className="group grid gap-7 py-8 lg:grid-cols-[.18fr_.48fr_1fr_.8fr_.16fr] lg:items-center"
                  >
                    <span className="text-[10px] font-bold text-[#73e6df]" style={monoFont}>
                      {service.code}
                    </span>
                    <div className="aspect-[5/3] overflow-hidden bg-white/5 lg:aspect-[4/3]">
                      <img
                        src={overlayMediaUrl(content, `serviceImage${index}`, service.image)}
                        alt={service.title}
                        loading="lazy"
                        className="size-full object-cover transition duration-700 group-hover:scale-[1.04]"
                        data-tkey={`media.serviceImage${index}`}
                      />
                    </div>
                    <div>
                      <h3
                        className="text-3xl font-black uppercase tracking-[-.06em] sm:text-5xl"
                        style={displayFont}
                      >
                        {service.title}
                      </h3>
                      <p
                        className="mt-3 text-[9px] font-bold uppercase tracking-[.15em] text-[#7adfe0]"
                        style={monoFont}
                      >
                        {service.stat}
                      </p>
                    </div>
                    <p className="text-sm leading-7 text-white/55">{service.text}</p>
                    <button
                      type="button"
                      onClick={openBooking}
                      disabled={bookingDisabled}
                      aria-label={"Request a visit for " + service.title}
                      className="grid size-14 place-items-center border border-white/25 transition group-hover:border-[#73e6df] group-hover:bg-[#73e6df] group-hover:text-[#062d3a]"
                    >
                      <Icon className="size-5" />
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
          <PlumberSectionCta
            prompt="Not sure which service fits? Describe the symptom and we will help identify the next step."
            onClick={openBooking}
            disabled={bookingDisabled}
            dark
          />
        </section>

        <section
          id="results"
          className="border-b border-[#0a3945]/15 bg-[#73e6df] px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
        >
          <div className="mx-auto max-w-[1600px]">
            <div className="grid gap-8 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
              <div>
                <SectionTag number="03">Result preview</SectionTag>
                <h2
                  className="mt-7 text-[clamp(3.05rem,8vw,8.5rem)] font-black uppercase leading-[.76] tracking-[-.085em]"
                  style={displayFont}
                  data-tkey="text.resultsTitle"
                >
                  {resultsTitle}
                </h2>
              </div>
              <p
                className="max-w-lg justify-self-end text-base leading-8 text-[#304047]"
                data-tkey="text.resultsBody"
              >
                {resultsBody}
              </p>
            </div>
            <div className="relative mt-14 aspect-[16/9] touch-none overflow-hidden border-[10px] border-[#062d3a] bg-[#062d3a]">
              <img
                src={IMAGE.projectAfter}
                alt="Sample water-service area after renewal"
                className="absolute inset-0 size-full object-cover"
              />
              <img
                src={IMAGE.projectBefore}
                alt="Sample water-service area before renewal"
                className="absolute inset-0 size-full object-cover"
                style={{ clipPath: "inset(0 " + (100 - comparison) + "% 0 0)" }}
              />
              <div
                className="pointer-events-none absolute inset-y-0 w-1 bg-[#73e6df]"
                style={{ left: comparison + "%" }}
              >
                <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center bg-[#079bb2] text-white">
                  <Gauge className="size-6" />
                </span>
              </div>
              <input
                aria-label="Compare sample plumbing project before and after"
                aria-valuetext={
                  comparison + "% before image shown on the left; after image on the right"
                }
                type="range"
                min="0"
                max="100"
                value={comparison}
                onChange={(event) => setComparison(Number(event.target.value))}
                className="absolute inset-0 z-10 size-full cursor-ew-resize opacity-0"
              />
              <span
                className="absolute bottom-5 left-5 bg-[#079bb2] px-4 py-2 text-[9px] font-bold uppercase tracking-[.15em] text-white"
                style={monoFont}
              >
                Before
              </span>
              <span
                className="absolute bottom-5 right-5 bg-[#eaf8f7] px-4 py-2 text-[9px] font-bold uppercase tracking-[.15em]"
                style={monoFont}
              >
                After
              </span>
            </div>
          </div>
          <PlumberSectionCta
            prompt="Have a leak, pressure, or backflow concern? Request a time to walk through it."
            onClick={openBooking}
            disabled={bookingDisabled}
          />
        </section>

        <section
          id="reviews"
          className="border-b border-[#0a3945]/15 bg-[#eaf8f7] px-5 py-24 sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto max-w-[1600px]">
            <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
              <div>
                <SectionTag number="04">
                  {showSampleReviews ? "Sample reviews" : "Reviews"}
                </SectionTag>
                <h2
                  className="mt-7 text-[clamp(3.8rem,7vw,7.8rem)] font-black uppercase leading-[.78] tracking-[-.08em]"
                  style={displayFont}
                  data-tkey="text.reviewsTitle"
                >
                  {reviewsTitle}
                </h2>
                {showSampleReviews || renderedReviews.length === 0 ? (
                  <p
                    className="mt-8 max-w-sm text-sm leading-7 text-[#5b6870]"
                    data-tkey="text.reviewsBody"
                  >
                    {reviewsBody}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {renderedReviews.map((review, index) => (
                  <article
                    key={`${review.author}-${index}`}
                    className={
                      (index === 0 ? "md:col-span-2 md:grid-cols-[.72fr_1.28fr]" : "") +
                      " grid overflow-hidden border border-[#0a3945]/15 bg-white"
                    }
                  >
                    <img
                      src={review.image}
                      alt=""
                      loading="lazy"
                      className={
                        (index === 0 ? "h-full min-h-[310px]" : "aspect-[4/3]") +
                        " w-full object-cover"
                      }
                      data-tkey={`media.reviewImage${index}`}
                    />
                    <div className="flex min-h-[300px] flex-col p-6 sm:p-8">
                      <div className="flex items-center justify-between">
                        <Quote className="size-8 text-[#079bb2]" />
                        {showSampleReviews && review.attribution ? (
                          <span
                            className="bg-[#73e6df] px-3 py-2 text-[8px] font-bold uppercase tracking-[.15em]"
                            style={monoFont}
                          >
                            {review.attribution} · {review.source}
                          </span>
                        ) : review.attribution ? (
                          <span
                            className="bg-[#73e6df] px-3 py-2 text-[8px] font-bold uppercase tracking-[.15em]"
                            style={monoFont}
                          >
                            {review.attribution}
                          </span>
                        ) : null}
                      </div>
                      <blockquote
                        className="mt-8 text-2xl font-black uppercase leading-[1.08] tracking-[-.05em] sm:text-3xl"
                        style={displayFont}
                        data-tkey={`reviews.${index}.quote`}
                      >
                        “{review.quote}”
                      </blockquote>
                      <div className="mt-auto flex items-end justify-between border-t border-[#0a3945]/15 pt-5">
                        <div>
                          <p className="font-bold" data-tkey={`reviews.${index}.author`}>
                            {review.author}
                          </p>
                          {showSampleReviews ? (
                            <p
                              className="mt-1 text-[8px] uppercase tracking-[.15em] text-[#6e7b82]"
                              style={monoFont}
                            >
                              Sample homeowner story
                            </p>
                          ) : null}
                        </div>
                        <Check className="size-5 text-[#079bb2]" />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <PlumberSectionCta
            prompt="Ready to replace the sample stories with your own? Start with a real service request."
            onClick={openBooking}
            disabled={bookingDisabled}
          />
        </section>

        <section
          id="journal"
          className="border-b border-[#0a3945]/15 bg-[#d9f3f1] px-5 py-24 sm:px-8 lg:px-12 lg:py-32"
        >
          <div className="mx-auto max-w-[1600px]">
            <div className="grid gap-8 border-b border-[#0a3945]/20 pb-10 lg:grid-cols-[1fr_1fr] lg:items-end">
              <div>
                <SectionTag number="05">Homeowner guides</SectionTag>
                <h2
                  className="mt-7 text-[clamp(4rem,8vw,8.4rem)] font-black uppercase leading-[.77] tracking-[-.085em]"
                  style={displayFont}
                  data-tkey="text.journalTitle"
                >
                  {journalTitle}
                </h2>
              </div>
              <p
                className="justify-self-end text-[9px] font-bold uppercase tracking-[.17em] text-[#536274]"
                style={monoFont}
              >
                Sample article topics · No linked pages
              </p>
            </div>
            <div className="divide-y divide-[#0a3945]/20">
              {posts.map((post, index) => {
                const overlayPost = content?.blogs?.[index];
                return (
                  <article
                    key={post.title}
                    className="group grid gap-6 py-7 md:grid-cols-[.12fr_.42fr_1fr_.75fr] md:items-center"
                  >
                    <span className="text-[11px] font-bold text-[#079bb2]" style={monoFont}>
                      {post.number}
                    </span>
                    <div className="aspect-[16/10] overflow-hidden bg-[#062d3a]">
                      <img
                        src={overlayMediaUrl(content, `journalImage${index}`, post.image)}
                        alt={post.title}
                        loading="lazy"
                        className="size-full object-cover transition duration-700 group-hover:scale-[1.04]"
                        data-tkey={`media.journalImage${index}`}
                      />
                    </div>
                    <div>
                      <p
                        className="text-[8px] font-bold uppercase tracking-[.17em] text-[#079bb2]"
                        style={monoFont}
                        data-tkey={`blogs.${index}.category`}
                      >
                        {overlayPost?.category ?? post.category}
                      </p>
                      <h3
                        className="mt-3 text-2xl font-black uppercase leading-[.95] tracking-[-.055em] sm:text-4xl"
                        style={displayFont}
                        data-tkey={`blogs.${index}.title`}
                      >
                        {overlayPost?.title ?? post.title}
                      </h3>
                    </div>
                    <p
                      className="text-sm leading-7 text-[#536274]"
                      data-tkey={`blogs.${index}.excerpt`}
                    >
                      {overlayPost?.excerpt ?? post.text}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
          <PlumberSectionCta
            prompt="Recognize one of these warning signs? Share what you are noticing before it changes."
            onClick={openBooking}
            disabled={bookingDisabled}
          />
        </section>

        <section
          id="faq"
          className="border-b border-white/15 bg-[#079bb2] px-5 py-24 text-white sm:px-8 lg:px-12 lg:py-36"
        >
          <div className="mx-auto grid max-w-[1600px] gap-14 lg:grid-cols-[.62fr_1.38fr]">
            <div>
              <SectionTag number="06" light>
                Good to know
              </SectionTag>
              <h2
                className="mt-7 text-[clamp(4rem,8vw,8rem)] font-black uppercase leading-[.75] tracking-[-.085em]"
                style={displayFont}
                data-tkey="text.faqTitle"
              >
                {faqTitle}
              </h2>
              <p className="mt-8 max-w-sm text-sm leading-7 text-white/60" data-tkey="text.faqBody">
                {faqBody}
              </p>
            </div>
            <div className="border-t border-white/25">
              {faqs.map(([question, answer], index) => {
                const open = openFaq === index;
                return (
                  <div key={question} className="border-b border-white/25">
                    <button
                      id={"plumber-faq-button-" + index}
                      type="button"
                      aria-expanded={open}
                      aria-controls={"plumber-faq-panel-" + index}
                      onClick={() => setOpenFaq(open ? -1 : index)}
                      className="grid min-h-24 w-full grid-cols-[auto_1fr_auto] items-center gap-5 py-5 text-left"
                    >
                      <span className="text-[9px] font-bold text-[#73e6df]" style={monoFont}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        className="text-xl font-black uppercase tracking-[-.045em] sm:text-3xl"
                        style={displayFont}
                      >
                        {question}
                      </span>
                      <span
                        className={
                          (open
                            ? "rotate-180 bg-[#73e6df] text-[#062d3a]"
                            : "border border-white/30") +
                          " grid size-11 place-items-center transition"
                        }
                      >
                        <ChevronDown className="size-4" />
                      </span>
                    </button>
                    {open ? (
                      <div
                        id={"plumber-faq-panel-" + index}
                        role="region"
                        aria-labelledby={"plumber-faq-button-" + index}
                        className="grid grid-cols-[2.3rem_1fr]"
                      >
                        <span />
                        <p className="max-w-3xl pb-8 pr-12 text-sm leading-7 text-white/65">
                          {answer}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <PlumberSectionCta
            prompt="Still have a question? Request a visit and include the details that matter to you."
            onClick={openBooking}
            disabled={bookingDisabled}
            dark
          />
        </section>

        <section className="bg-[#73e6df] px-5 py-24 sm:px-8 lg:px-12 lg:py-32">
          <div className="mx-auto grid max-w-[1600px] gap-10 lg:grid-cols-[1.35fr_.65fr] lg:items-end">
            <h2
              className="text-[clamp(4.3rem,9vw,10rem)] font-black uppercase leading-[.74] tracking-[-.09em]"
              style={displayFont}
              data-tkey="text.ctaTitle"
            >
              {ctaTitle}
            </h2>
            <div>
              <p className="max-w-md text-base leading-8 text-[#324149]" data-tkey="text.ctaBody">
                {ctaBody}
              </p>
              <button
                type="button"
                onClick={openBooking}
                disabled={bookingDisabled}
                className="mt-8 flex min-h-16 w-full items-center justify-between bg-[#062d3a] px-6 text-[10px] font-bold uppercase tracking-[.16em] text-white"
                style={monoFont}
              >
                Request a visit <ArrowDownRight className="size-5" />
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#062d3a] px-5 pb-28 pt-16 text-white sm:px-8 lg:px-12">
        <div className="mx-auto max-w-[1600px]">
          <div className="grid gap-12 border-b border-white/20 pb-14 lg:grid-cols-[1.2fr_.55fr_.75fr]">
            <div>
              <p
                className="overlay-brand-name text-5xl font-black uppercase tracking-[-.07em] sm:text-7xl"
                style={displayFont}
              >
                {brandLabel}
                <span className="text-[#73e6df]">.</span>
              </p>
              <p
                className="mt-5 max-w-sm text-sm leading-7 text-white/50"
                data-tkey="text.footerBlurb"
              >
                {footerBlurb}
              </p>
            </div>
            <div>
              <p
                className="text-[9px] font-bold uppercase tracking-[.17em] text-[#73e6df]"
                style={monoFont}
              >
                Index
              </p>
              <div className="mt-5 flex flex-col gap-3 text-sm text-white/55">
                {navItems.map((item) => (
                  <a key={item.target} href={"#" + item.target} className="hover:text-white">
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <p
                className="text-[9px] font-bold uppercase tracking-[.17em] text-[#73e6df]"
                style={monoFont}
              >
                Sample contact
              </p>
              <div className="mt-5 flex flex-col gap-3 text-sm text-white/55">
                <span>Service area · Sample coverage</span>
                <a href={phoneHref} data-tkey="contact.phone">
                  {phoneLabel}
                </a>
                <a href={emailHref} data-tkey="contact.email">
                  {emailLabel}
                </a>
                <span>Hours · Sample hours</span>
              </div>
            </div>
          </div>
          <div
            className="flex flex-col justify-between gap-4 pt-7 text-[8px] font-bold uppercase tracking-[.17em] text-white/35 sm:flex-row"
            style={monoFont}
          >
            <span>
              {brandName ? `© 2026 ${brandName}` : "© 2026 Leak Geeks · Template preview"}
            </span>
            <a href="#top" className="min-h-11 py-3 text-white/60 hover:text-white">
              Back to top ↑
            </a>
          </div>
        </div>
      </footer>

      {bookingMode === "demo" ? (
        <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
      ) : null}
    </div>
  );
}
