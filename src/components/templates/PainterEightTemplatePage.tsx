import { ArrowUpRight, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";

import type { TemplateMoldContent } from "@/lib/template-content/overlay";
import {
  overlayLogoUrl,
  overlayMediaUrl,
  purchasedReviewList,
} from "@/lib/template-content/overlay";

import {
  PAINTER_BLOG_POSTS,
  PAINTER_DISCLOSURES,
  PAINTER_ESTIMATE_ITEMS,
  PAINTER_FAQS,
  PAINTER_PLANNING_NOTES,
  PAINTER_PROCESS,
  PAINTER_SECTION_COPY,
  PAINTER_SURFACE_COPY,
} from "./painter-shared-copy";

import "./overlay-fit.css";
import "./painter-eight/painter-eight.css";

const MEDIA = "/templates/candy-capsule-lab/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const IMAGE = {
  hero: MEDIA + "/hero.jpg",
  heroMotion: MEDIA + "/hero-motion.mp4",
  macro: MEDIA + "/macro.jpg",
  interior: MEDIA + "/interior.jpg",
  trim: MEDIA + "/trim.jpg",
  exterior: MEDIA + "/exterior.jpg",
  cabinetry: MEDIA + "/cabinetry.jpg",
  proofBefore: MEDIA + "/proof-before.jpg",
  proofAfter: MEDIA + "/proof-after.jpg",
  inspect: MEDIA + "/inspect.jpg",
  protect: MEDIA + "/protect.jpg",
  repair: MEDIA + "/repair.jpg",
  prepare: MEDIA + "/prepare.jpg",
  finish: MEDIA + "/finish.jpg",
  planning: MEDIA + "/planning.jpg",
  reviews: MEDIA + "/reviews.jpg",
  faq: MEDIA + "/faq.jpg",
  estimate: MEDIA + "/estimate.jpg",
  blogColor: MEDIA + "/blog-color.jpg",
  blogPrep: MEDIA + "/blog-prep.jpg",
  blogSheen: MEDIA + "/blog-sheen.jpg",
} as const;

const paintSwatches = [
  {
    id: "bubblegum",
    label: "walls",
    name: "Bubblegum",
    color: "#ff69b4",
    glow: "rgba(255, 105, 180, 0.72)",
  },
  {
    id: "lavender",
    label: "trim",
    name: "Lavender",
    color: "#baa6ff",
    glow: "rgba(186, 164, 255, 0.68)",
  },
  {
    id: "aqua",
    label: "cabinets",
    name: "Aqua",
    color: "#40e0d0",
    glow: "rgba(64, 224, 208, 0.64)",
  },
  {
    id: "lemon",
    label: "color",
    name: "Lemon",
    color: "#ffe65a",
    glow: "rgba(255, 230, 90, 0.58)",
  },
  {
    id: "cherry",
    label: "accent",
    name: "Cherry",
    color: "#ff3b5c",
    glow: "rgba(255, 59, 92, 0.66)",
  },
] as const;

type SwatchId = (typeof paintSwatches)[number]["id"];

const blogImages = [IMAGE.blogColor, IMAGE.blogPrep, IMAGE.blogSheen] as const;
const blogAlts = [
  "Illustrative candy-colored paint swatches on a planning table",
  "Illustrative masked wall prep with cherry tape line",
  "Illustrative sheen comparison panels in candy palette",
] as const;

const surfaces = [
  {
    tag: "walls",
    title: "Walls & ceilings",
    text: PAINTER_SURFACE_COPY.walls,
    image: IMAGE.interior,
    alt: "Illustrative bubblegum pink interior with lavender trim in a residential room",
  },
  {
    tag: "trim",
    title: "Trim & doors",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.trim,
    alt: "Illustrative cherry gloss trim meeting a bubblegum wall",
  },
  {
    tag: "cabinets",
    title: "Cabinet doors & frames",
    text: PAINTER_SURFACE_COPY.cabinets,
    image: IMAGE.cabinetry,
    alt: "Illustrative glossy aqua and pink cabinet fronts",
  },
  {
    tag: "exterior",
    title: "Exterior painting",
    text: PAINTER_SURFACE_COPY.exterior,
    image: IMAGE.exterior,
    alt: "Illustrative lemon exterior with cherry entry door",
  },
] as const;

const processSteps = PAINTER_PROCESS.map((step, index) => ({
  ...step,
  image: [IMAGE.inspect, IMAGE.protect, IMAGE.repair, IMAGE.prepare, IMAGE.finish][index],
  alt: [
    "Painter inspecting a glossy candy-colored wall through preparation",
    "Protected room staged before painting with drop cloths",
    "Controlled wall repair beside cherry trim tape",
    "Masking prep on an aqua accent wall",
    "Roller finishing a bubblegum pink wall",
  ][index],
}));

function mediaClass(tint?: boolean, splash?: boolean, extra = "") {
  return ["p8-media", extra, tint ? "p8-media--tint" : "", splash ? "p8-media--splash" : ""]
    .filter(Boolean)
    .join(" ");
}

export function PainterEightTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "glossy rooms,";
  const heroAccent = text?.heroAccent ?? "packaged like candy.";
  const heroSub =
    text?.heroSub ??
    "A professional painting company trapped inside the packaging of an extremely expensive box of candy—same careful scope, wildly glossy results.";
  const introTitle = text?.introTitle ?? "Glossy rooms you can almost taste.";
  const introBody =
    text?.introBody ??
    "Atmosphere and craft in candy-bright finishes—these illustrative studies show how preparation and sheen read before you publish real project photography.";
  const servicesHeading = text?.servicesHeading ?? PAINTER_SECTION_COPY.servicesHeading;
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? PAINTER_SECTION_COPY.proofHeading;
  const proofBody = text?.proofBody ?? PAINTER_SECTION_COPY.proofBody;
  const processTitle = text?.processTitle ?? PAINTER_SECTION_COPY.processHeading;
  const processIntro = text?.processIntro ?? PAINTER_SECTION_COPY.processIntro;
  const planHeading = text?.planHeading ?? PAINTER_SECTION_COPY.planningHeading;
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const faqTitle = text?.faqTitle ?? "Questions before the first coat.";
  const journalTitle = text?.journalTitle ?? PAINTER_SECTION_COPY.blogsHeading;
  const journalIntro = text?.journalIntro ?? PAINTER_SECTION_COPY.blogsIntro;
  const estimateTitle = text?.estimateTitle ?? PAINTER_SECTION_COPY.estimateHeading;
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? PHONE_LABEL;
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : PHONE_HREF;
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "true coat";
  const brandMark = brandName
    ? brandName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0]!.toUpperCase())
        .join("")
        .slice(0, 2)
    : "TC";
  const brandAria = brandName ? `${brandName} home` : "True Coat home";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [activeSwatch, setActiveSwatch] = useState<SwatchId>("bubblegum");
  const [poppedSwatch, setPoppedSwatch] = useState<SwatchId | null>(null);
  const [splashOn, setSplashOn] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const selected = paintSwatches.find((swatch) => swatch.id === activeSwatch) ?? paintSwatches[0];

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty("--p8-room-tint", selected.glow);
    root.dataset.swatch = selected.id;
  }, [selected]);

  function openBooking(event: React.MouseEvent<HTMLButtonElement>) {
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  }

  function handleSwatchClick(id: SwatchId) {
    setActiveSwatch(id);
    setPoppedSwatch(id);
    setSplashOn(true);
    window.setTimeout(() => setSplashOn(false), reducedMotion ? 0 : 800);
    window.setTimeout(() => setPoppedSwatch(null), reducedMotion ? 0 : 480);
  }

  function scrollToSection(event: React.MouseEvent<HTMLAnchorElement>) {
    const href = event.currentTarget.getAttribute("href");
    if (!href?.startsWith("#")) return;
    const target = document.getElementById(href.slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleSwatchKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = paintSwatches[event.key === "Home" ? 0 : paintSwatches.length - 1];
      handleSwatchClick(next.id);
      document.getElementById(`p8-swatch-${next.id}`)?.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = paintSwatches[(index + delta + paintSwatches.length) % paintSwatches.length];
    handleSwatchClick(next.id);
    document.getElementById(`p8-swatch-${next.id}`)?.focus();
  }

  return (
    <div className="p8" ref={rootRef} id="top" data-swatch={activeSwatch}>
      <a className="p8-skip" href="#main">
        Skip to content
      </a>

      <header className="p8-mast">
        <a className="p8-brand" href="#top" aria-label={brandAria}>
          <span
            className="p8-brand-mark overlay-brand-mark"
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <small>candy capsule lab</small>
          </span>
        </a>
        <nav aria-label="Primary">
          <a href="#surfaces" onClick={scrollToSection}>
            Surfaces
          </a>
          <a href="#proof" onClick={scrollToSection}>
            Proof
          </a>
          <a href="#process" onClick={scrollToSection}>
            Method
          </a>
          <a href="#plan" onClick={scrollToSection}>
            Plan
          </a>
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="p8-hero" aria-labelledby="p8-hero-title">
          <div className="p8-hero-stage">
            <figure className={mediaClass(false, splashOn, "p8-hero-photo")}>
              <img
                src={heroPoster}
                width={2560}
                height={1440}
                alt="Illustrative bubblegum pink living room with lavender trim and soft daylight"
                fetchPriority="high"
                data-tkey="media.heroPoster"
              />
              {reducedMotion ? null : (
                <video autoPlay muted loop playsInline poster={heroPoster} preload="metadata">
                  <source src={IMAGE.heroMotion} type="video/mp4" />
                </video>
              )}
            </figure>
            <div className="p8-sleeve">
              <p className="p8-kicker">Residential painting</p>
              <h1 id="p8-hero-title" data-tkey="text.heroTitle">
                {heroTitle}
                <em data-tkey="text.heroAccent">{heroAccent}</em>
              </h1>
              <p className="p8-sr" data-tkey="text.heroSub">
                {heroSub}
              </p>
              <button type="button" className="p8-btn" onClick={openBooking}>
                Request a site visit
                <ArrowUpRight aria-hidden="true" />
              </button>
              <ul className="p8-tray" aria-label="Finish swatches">
                {paintSwatches.map((swatch, index) => (
                  <li key={swatch.id}>
                    <button
                      id={`p8-swatch-${swatch.id}`}
                      type="button"
                      className={poppedSwatch === swatch.id ? "p8-tray--pop" : ""}
                      style={{ "--p8-swatch-color": swatch.color } as React.CSSProperties}
                      aria-pressed={activeSwatch === swatch.id}
                      aria-label={`${swatch.name} swatch for ${swatch.label}`}
                      onClick={() => handleSwatchClick(swatch.id)}
                      onKeyDown={(event) => handleSwatchKeyDown(event, index)}
                    >
                      <span className="p8-tray__orb" aria-hidden="true" />
                      <span>{swatch.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="p8-sr" aria-live="polite">
                Active tint: {selected.name}
              </p>
            </div>
          </div>
        </section>

        <section className="p8-pov" id="work" aria-labelledby="p8-intro-title">
          <figure className="p8-media">
            <img
              src={overlayMediaUrl(content, "introMacro", IMAGE.macro)}
              width={1200}
              height={1600}
              alt="Macro glossy bubblegum enamel paint texture"
              loading="lazy"
              data-tkey="media.introMacro"
            />
          </figure>
          <figure className="p8-media">
            <img
              src={overlayMediaUrl(content, "introInterior", IMAGE.interior)}
              width={1920}
              height={1440}
              alt="Candy-colored interior living room with playful paint finish"
              loading="lazy"
              data-tkey="media.introInterior"
            />
          </figure>
          <div className="p8-pov-copy">
            <p className="p8-kicker">Point of view</p>
            <h2 id="p8-intro-title" data-tkey="text.introTitle">
              {introTitle}
            </h2>
            <p className="p8-sr" data-tkey="text.introBody">
              {introBody}
            </p>
          </div>
        </section>

        <section className="p8-shot" id="surfaces" aria-labelledby="p8-surfaces-title">
          <div className="p8-label">
            <p className="p8-kicker">Surfaces</p>
            <h2 id="p8-surfaces-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <p className="p8-sr" data-tkey="text.servicesIntro">
              {servicesIntro}
            </p>
          </div>
          <div className="p8-surfaces">
            {surfaces.map((surface, index) => (
              <article key={surface.title} className="p8-surface">
                <img
                  src={overlayMediaUrl(content, `serviceImage${index + 1}`, surface.image)}
                  width={1920}
                  height={1440}
                  loading="lazy"
                  alt={surface.alt}
                  data-tkey={`media.serviceImage${index + 1}`}
                />
                <div>
                  <b>{surface.tag}</b>
                  <h3>{surface.title}</h3>
                  <p className="p8-sr">{surface.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="p8-shot" id="proof" aria-labelledby="p8-proof-title">
          <div className="p8-label">
            <p className="p8-kicker">{PAINTER_SECTION_COPY.proofLabel}</p>
            <h2 id="p8-proof-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p className="p8-sr" data-tkey="text.proofBody">
              {proofBody}
            </p>
          </div>
          <div className="p8-proof-pair" aria-label="Illustrative paint-only comparison">
            <figure className="p8-media">
              <img
                src={IMAGE.proofBefore}
                width={1920}
                height={1440}
                alt="Same room before paint-only work with tired neutral walls"
                loading="lazy"
              />
              <figcaption>Before</figcaption>
            </figure>
            <figure className={mediaClass(false, splashOn)}>
              <img
                src={IMAGE.proofAfter}
                width={1920}
                height={1440}
                alt="Same room after bubblegum paint-only finish"
                loading="lazy"
              />
              <figcaption>After</figcaption>
            </figure>
          </div>
        </section>

        <section className="p8-shot" id="process" aria-labelledby="p8-process-title">
          <div className="p8-label">
            <p className="p8-kicker">{PAINTER_SECTION_COPY.processLabel}</p>
            <h2 id="p8-process-title" data-tkey="text.processTitle">
              {processTitle}
            </h2>
            <p className="p8-sr" data-tkey="text.processIntro">
              {processIntro}
            </p>
          </div>
          <ol className="p8-process">
            {processSteps.map((step, index) => (
              <li key={step.title}>
                <figure className="p8-media">
                  <img
                    src={overlayMediaUrl(content, `processImage${index + 1}`, step.image)}
                    width={1920}
                    height={1440}
                    alt={step.alt}
                    loading="lazy"
                    data-tkey={`media.processImage${index + 1}`}
                  />
                  <figcaption>
                    <small>0{index + 1}</small>
                    <h3>{step.title}</h3>
                  </figcaption>
                </figure>
                <p className="p8-sr">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="p8-plan" id="plan" aria-labelledby="p8-plan-title">
          <div className="p8-plan-head">
            <div className="p8-wrap">
              <p className="p8-kicker">{PAINTER_SECTION_COPY.planningLabel}</p>
              <div className="p8-plan-lede">
                <h2 id="p8-plan-title" data-tkey="text.planHeading">
                  {planHeading}
                </h2>
                <p data-tkey="text.planIntro">{planIntro}</p>
              </div>
            </div>
          </div>
          <figure className="p8-media p8-plan-photo">
            <img
              src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
              width={1920}
              height={1440}
              alt="Physical candy-colored paint swatches and rollers on a clean bench"
              loading="lazy"
              data-tkey="media.planningImage"
            />
          </figure>
          <ol className="p8-notes">
            {PAINTER_PLANNING_NOTES.map((note) => (
              <li key={note.label}>
                <b>{note.label}</b>
                <h3>{note.title}</h3>
                <p>{note.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="p8-field" aria-labelledby="p8-faq-title">
          <figure className="p8-media p8-field-photo">
            <img
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              width={1920}
              height={1440}
              alt="Glossy candy-colored interior after a careful paint finish"
              loading="lazy"
              data-tkey="media.reviewsImage"
            />
          </figure>
          <div className="p8-field-copy">
            <p className="p8-kicker">Field notes</p>
            <h2 id="p8-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            {overlayReviews && overlayReviews.length > 0 ? (
              <ul>
                {overlayReviews.map((review, index) => (
                  <li key={`${review.author}-${index}`}>
                    <blockquote data-tkey={`reviews.${index}.quote`}>{review.quote}</blockquote>
                    <strong data-tkey={`reviews.${index}.author`}>{review.author}</strong>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="p8-faq">
              {PAINTER_FAQS.map(([question, answer], index) => (
                <details key={question} open={index === 0}>
                  <summary>
                    <b>{question}</b>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="p8-shot" id="journal" aria-labelledby="p8-journal-title">
          <div className="p8-label">
            <p className="p8-kicker">{PAINTER_SECTION_COPY.blogsLabel}</p>
            <h2 id="p8-journal-title" data-tkey="text.journalTitle">
              {journalTitle}
            </h2>
            <p className="p8-sr" data-tkey="text.journalIntro">
              {journalIntro}
            </p>
          </div>
          <div className="p8-journal">
            {PAINTER_BLOG_POSTS.map((post, index) => {
              const overlayPost = content?.blogs?.[index];
              return (
                <article key={post.number}>
                  <figure className="p8-media">
                    <img
                      src={overlayMediaUrl(content, `guideImage${index + 1}`, blogImages[index])}
                      width={1600}
                      height={1000}
                      loading="lazy"
                      alt={blogAlts[index]}
                      data-tkey={`media.guideImage${index + 1}`}
                    />
                    <figcaption>
                      <span data-tkey={`blogs.${index}.category`}>
                        {post.number} · {overlayPost?.category ?? post.category}
                      </span>
                      <h3 data-tkey={`blogs.${index}.title`}>{overlayPost?.title ?? post.title}</h3>
                    </figcaption>
                  </figure>
                  <p className="p8-sr" data-tkey={`blogs.${index}.excerpt`}>
                    {overlayPost?.excerpt ?? post.excerpt}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="p8-close" aria-labelledby="p8-estimate-title">
          <figure className="p8-media p8-close-photo">
            <img
              src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
              width={2560}
              height={1440}
              alt="Organized candy-colored painting workbench with rollers and swatches"
              loading="lazy"
              data-tkey="media.estimateImage"
            />
          </figure>
          <div className="p8-close-sleeve">
            <p className="p8-kicker">{PAINTER_SECTION_COPY.estimateLabel}</p>
            <h2 id="p8-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <ul className="p8-checks">
              {PAINTER_ESTIMATE_ITEMS.map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <button type="button" className="p8-btn" onClick={openBooking}>
              Request a site visit
              <ArrowUpRight aria-hidden="true" />
            </button>
            <small>{PAINTER_DISCLOSURES.demo}</small>
          </div>
        </section>
      </main>

      <footer className="p8-footer">
        <a className="p8-brand" href="#top" aria-label={brandAria}>
          <span
            className="p8-brand-mark overlay-brand-mark"
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <small>candy capsule lab / 08</small>
          </span>
        </a>
        <p>{PAINTER_DISCLOSURES.footer}</p>
        <div className="p8-footer-links">
          <a href={phoneHref} data-tkey="contact.phone">
            {phoneLabel}
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {emailLabel}
          </a>
        </div>
      </footer>

      <SiteBookingPayDemo
        open={bookingOpen}
        onOpenChange={(next) => {
          setBookingOpen(next);
          if (!next) requestAnimationFrame(() => bookingTriggerRef.current?.focus());
        }}
        isDemoPitch={true}
      />
    </div>
  );
}
