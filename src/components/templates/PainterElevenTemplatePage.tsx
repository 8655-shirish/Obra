import { ArrowRight, Check, Menu, Phone } from "lucide-react";
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
  PAINTER_SERVICES,
  PAINTER_SURFACE_COPY,
} from "./painter-shared-copy";

import "./overlay-fit.css";
import "./painter-eleven/painter-eleven.css";

const MEDIA = "/templates/vaporwave-paint-supply/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const media = {
  hero: `${MEDIA}/hero.jpg`,
  heroMotion: `${MEDIA}/hero-motion.mp4`,
  after: `${MEDIA}/proof-after.jpg`,
  before: `${MEDIA}/proof-before.jpg`,
  projectMotion: `${MEDIA}/project-motion.mp4`,
  detail: `${MEDIA}/surface-macro.jpg`,
  services: [
    `${MEDIA}/interior.jpg`,
    `${MEDIA}/exterior.jpg`,
    `${MEDIA}/cabinetry.jpg`,
    `${MEDIA}/trim.jpg`,
  ],
  process: [
    `${MEDIA}/inspect.jpg`,
    `${MEDIA}/protect.jpg`,
    `${MEDIA}/repair.jpg`,
    `${MEDIA}/prepare.jpg`,
    `${MEDIA}/finish.jpg`,
  ],
  shades: [`${MEDIA}/study-lagoon.jpg`, `${MEDIA}/study-orchid.jpg`, `${MEDIA}/proof-after.jpg`],
  reviews: `${MEDIA}/reviews.jpg`,
  planning: `${MEDIA}/planning.jpg`,
  guides: [`${MEDIA}/help-color.jpg`, `${MEDIA}/help-prep.jpg`, `${MEDIA}/help-sheen.jpg`],
  estimate: `${MEDIA}/estimate.jpg`,
} as const;

function responsive(src: string) {
  const base = src.replace(/\.jpg$/, "");
  return `${base}-960.jpg 960w, ${base}-1440.jpg 1440w, ${src} 1920w`;
}

function intrinsicHeight(src: string) {
  if (src.includes("trim.jpg")) return 2560;
  if (
    src.includes("proof-") ||
    src.includes("study-") ||
    src.includes("reviews.jpg") ||
    src.includes("help-") ||
    src.includes("estimate.jpg") ||
    src.includes("hero.jpg")
  ) {
    return 1080;
  }
  return 1440;
}

function Photo({
  src,
  alt,
  sizes = "(max-width: 760px) 100vw, 70vw",
  eager = false,
  tkey,
}: {
  src: string;
  alt: string;
  sizes?: string;
  eager?: boolean;
  tkey?: string;
}) {
  return (
    <img
      src={src}
      srcSet={src.startsWith("/templates/") ? responsive(src) : undefined}
      sizes={src.startsWith("/templates/") ? sizes : undefined}
      width={1920}
      height={intrinsicHeight(src)}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      alt={alt}
      data-tkey={tkey}
    />
  );
}

function Film({
  src,
  poster,
  label,
  posterTkey,
}: {
  src: string;
  poster: string;
  label: string;
  posterTkey?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video || failed) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (motion.matches || document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    sync();
    motion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      motion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [failed]);

  return (
    <>
      <Photo src={poster} alt={label} sizes="100vw" eager tkey={posterTkey} />
      {!failed ? (
        <video
          ref={ref}
          autoPlay
          muted
          loop
          playsInline
          poster={poster}
          preload="metadata"
          onError={() => setFailed(true)}
          aria-hidden="true"
        >
          <source src={src} type="video/mp4" media="(prefers-reduced-motion: no-preference)" />
        </video>
      ) : null}
    </>
  );
}

const serviceEntries = [
  {
    title: PAINTER_SERVICES[0].title,
    tag: "AISLE 01 / INTERIOR",
    summary: PAINTER_SURFACE_COPY.walls,
    image: media.services[0],
    alt: "Illustrative powder-blue finished living room photographed with direct flash",
  },
  {
    title: PAINTER_SERVICES[1].title,
    tag: "AISLE 02 / EXTERIOR",
    summary: PAINTER_SURFACE_COPY.exterior,
    image: media.services[1],
    alt: "Illustrative muted blue-gray house exterior with cream trim at blue hour",
  },
  {
    title: PAINTER_SERVICES[2].title,
    tag: "AISLE 03 / CABINETS",
    summary: PAINTER_SURFACE_COPY.cabinets,
    image: media.services[2],
    alt: "Illustrative kitchen with soft aqua-gray refinished cabinets",
  },
  {
    title: "Trim & doors",
    tag: "AISLE 04 / TRIM",
    summary: PAINTER_SURFACE_COPY.trim,
    image: media.services[3],
    alt: "Illustrative cream painted door trim against a dusty-mauve wall",
  },
] as const;

const shadeEntries = [
  { file: media.shades[0], name: "Lagoon", code: "SHADE 01" },
  { file: media.shades[1], name: "Orchid", code: "SHADE 02" },
  { file: media.shades[2], name: "Powder", code: "SHADE 03" },
] as const;

/**
 * Overlay-driven template mold (plan/template-purchase.md §4).
 * Every prop is optional: omitted keys fall back to the static template
 * defaults, so `/templates/painter11` renders byte-identical with no props
 * while `/lp/<id>` passes the purchaser's overlay content.
 */
export function PainterElevenTemplatePage({
  content,
  bookingMode = content ? "disabled" : "demo",
  onOpenBooking,
}: {
  content?: TemplateMoldContent;
  bookingMode?: "demo" | "live" | "disabled";
  onOpenBooking?: () => void;
}) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Paint, after dark.";
  const heroSub =
    text?.heroSub ??
    "Residential interior, exterior, cabinet, trim, and door painting with the condition, preparation, protection, coating, and sheen written into the scope.";
  const servicesHeading = text?.servicesHeading ?? PAINTER_SECTION_COPY.servicesHeading;
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? "Same room. Paint change only.";
  const proofBody = text?.proofBody ?? PAINTER_SECTION_COPY.proofBody;
  const detailTitle = text?.detailTitle ?? "The edge tells you whether the plan held.";
  const detailBody = text?.detailBody ?? PAINTER_SURFACE_COPY.trim;
  const reviewsHeading = text?.reviewsHeading ?? PAINTER_SECTION_COPY.reviewsHeading;
  const reviewsBody = text?.reviewsBody ?? PAINTER_SECTION_COPY.reviewsBody;
  const estimateTitle = text?.estimateTitle ?? "Bring the details. Leave with a plan.";
  const estimateIntro =
    text?.estimateIntro ?? "Include these facts so a first conversation is useful:";
  const planHeading = text?.planHeading ?? "Good painting decisions happen before the first coat.";
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? PHONE_LABEL;
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : PHONE_HREF;
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "TRUE COAT SUPPLY";
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
  const heroPoster = overlayMediaUrl(content, "heroPoster", media.hero);
  const heroEyebrow = brandName ?? "TRUE COAT — VAPORWAVE PAINT SUPPLY";
  const [mobileMenu, setMobileMenu] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const bookingDisabled = bookingMode === "disabled" || (bookingMode === "live" && !onOpenBooking);

  const openBooking = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (bookingDisabled) return;
    if (bookingMode === "live") {
      onOpenBooking?.();
      return;
    }
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  };

  return (
    <div className="p11" id="top">
      <a className="p11-skip" href="#p11-main">
        Skip to content
      </a>

      <header className="p11-topbar">
        <a href="#top" className="p11-brand" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <strong className="overlay-brand-name">{brandLabel}</strong>
        </a>
        <button
          type="button"
          className="p11-menu-button"
          aria-expanded={mobileMenu}
          aria-controls="p11-nav"
          onClick={() => setMobileMenu((open) => !open)}
        >
          <Menu aria-hidden="true" /> Menu
        </button>
        <nav id="p11-nav" aria-label="Sections" data-open={mobileMenu || undefined}>
          <a href="#surfaces" onClick={() => setMobileMenu(false)}>
            Work
          </a>
          <a href="#proof" onClick={() => setMobileMenu(false)}>
            Proof
          </a>
          <a href="#method" onClick={() => setMobileMenu(false)}>
            Method
          </a>
          <a href="#plan" onClick={() => setMobileMenu(false)}>
            Plan
          </a>
        </nav>
        <a className="p11-topbar-call" href={phoneHref}>
          <Phone aria-hidden="true" /> {phoneLabel}
        </a>
      </header>

      <main className="p11-main" id="p11-main" tabIndex={-1}>
        <section className="p11-hero" aria-labelledby="p11-title">
          <figure
            className="p11-hero-film"
            aria-label="Illustrative after-hours paint showroom with a floating chrome paint bucket"
          >
            <Film
              src={media.heroMotion}
              poster={heroPoster}
              posterTkey="media.heroPoster"
              label="Illustrative after-hours paint showroom with a floating chrome paint bucket"
            />
          </figure>
          <div className="p11-hero-copy">
            <p className="p11-eyebrow">{heroEyebrow}</p>
            <h1 id="p11-title" data-tkey="text.heroTitle">
              {heroTitle}
            </h1>
            <p data-tkey="text.heroSub">{heroSub}</p>
            <div className="p11-cta-row">
              <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
                Preview a walkthrough <ArrowRight aria-hidden="true" />
              </button>
              <a className="p11-tel" href={phoneHref}>
                <Phone aria-hidden="true" /> {phoneLabel}
              </a>
            </div>
          </div>
        </section>

        <section className="p11-shades" id="shades" aria-labelledby="p11-shades-title">
          <header className="p11-sec-head">
            <p className="p11-eyebrow">SHADE INDEX</p>
            <h2 id="p11-shades-title">Three studies. One room.</h2>
          </header>
          <div className="p11-shade-row">
            {shadeEntries.map((shade, index) => (
              <figure key={shade.name}>
                <Photo
                  src={overlayMediaUrl(content, `shadeImage${index + 1}`, shade.file)}
                  alt={`Illustrative matched living room study with ${shade.name.toLowerCase()} painted walls`}
                  sizes="(max-width: 760px) 100vw, 33vw"
                  tkey={`media.shadeImage${index + 1}`}
                />
                <figcaption>
                  <span>{shade.code}</span>
                  <b>{shade.name}</b>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="p11-note">
            Illustrative color studies of the same room. Not a client project.
          </p>
        </section>

        <section className="p11-band-head" id="surfaces" aria-labelledby="p11-surfaces-title">
          <p className="p11-eyebrow">THE AISLES</p>
          <h2 id="p11-surfaces-title" data-tkey="text.servicesHeading">
            {servicesHeading}
          </h2>
          <p data-tkey="text.servicesIntro">{servicesIntro}</p>
        </section>

        {serviceEntries.map((service, index) => (
          <section className="p11-band" aria-label={service.title} key={service.tag}>
            <Photo
              src={overlayMediaUrl(content, `serviceImage${index + 1}`, service.image)}
              alt={service.alt}
              sizes="100vw"
              tkey={`media.serviceImage${index + 1}`}
            />
            <div className="p11-band-copy">
              <p className="p11-eyebrow">{service.tag}</p>
              <h3>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {service.title}
              </h3>
              <p>{service.summary}</p>
            </div>
          </section>
        ))}

        <div className="p11-cta-row p11-cta-center">
          <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
            Preview a walkthrough <ArrowRight aria-hidden="true" />
          </button>
          <a className="p11-tel" href={phoneHref} data-tkey="contact.phone">
            <Phone aria-hidden="true" /> {phoneLabel}
          </a>
        </div>
        <p className="p11-note p11-note-center">
          Illustrative project scenes. Replace with documented, permissioned work before publishing.
        </p>

        <section className="p11-proof" id="proof" aria-labelledby="p11-proof-title">
          <header className="p11-sec-head">
            <p className="p11-eyebrow">SAME ROOM</p>
            <h2 id="p11-proof-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </header>
          <div
            className="p11-proof-pair"
            role="group"
            aria-label="Illustrative matched-camera paint-only comparison"
          >
            <figure>
              <Photo
                src={media.before}
                alt="Illustrative living room before paint-only work, with tired beige walls and scuffed trim"
                sizes="(max-width: 760px) 100vw, 50vw"
              />
              <figcaption>01 / EXISTING SURFACE</figcaption>
            </figure>
            <figure className="p11-proof-after">
              <Film
                src={media.projectMotion}
                poster={media.after}
                label="Same illustrative living room after paint-only work, with powder-blue walls and cream trim"
              />
              <figcaption>02 / COMPLETED FINISH</figcaption>
            </figure>
          </div>
          <p className="p11-note">
            LOCKED CAMERA · PAINT CHANGE ONLY · ILLUSTRATIVE / NOT A CLIENT PROJECT
          </p>
          <div className="p11-cta-row">
            <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
              Preview a walkthrough <ArrowRight aria-hidden="true" />
            </button>
            <a className="p11-tel" href={phoneHref} data-tkey="contact.phone">
              <Phone aria-hidden="true" /> {phoneLabel}
            </a>
          </div>
        </section>

        <section className="p11-detail" aria-labelledby="p11-detail-title">
          <Photo
            src={overlayMediaUrl(content, "detailImage", media.detail)}
            alt="Illustrative close-up of a powder-blue satin wall meeting cream trim with a clean painted edge"
            sizes="(max-width: 760px) 100vw, 55vw"
            eager
            tkey="media.detailImage"
          />
          <div className="p11-detail-copy">
            <p className="p11-eyebrow">EDGE CHECK / DIRECT FLASH</p>
            <h2 id="p11-detail-title" data-tkey="text.detailTitle">
              {detailTitle}
            </h2>
            <p data-tkey="text.detailBody">{detailBody}</p>
            <small>{PAINTER_DISCLOSURES.generatedMedia}</small>
            <div className="p11-cta-row">
              <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
                Preview a walkthrough <ArrowRight aria-hidden="true" />
              </button>
              <a className="p11-sec-link" href="#proof">
                See the same-room comparison <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
        </section>

        <section className="p11-method" id="method" aria-labelledby="p11-method-title">
          <header className="p11-sec-head">
            <p className="p11-eyebrow">NIGHT SHIFT</p>
            <h2 id="p11-method-title">{PAINTER_SECTION_COPY.processHeading}</h2>
            <p>{PAINTER_SECTION_COPY.processIntro}</p>
          </header>
          <div
            className="p11-strip"
            role="region"
            aria-label="Painting process steps, scroll horizontally"
            tabIndex={0}
          >
            <ol>
              {PAINTER_PROCESS.map((step, index) => (
                <li key={step.title}>
                  <Photo
                    src={overlayMediaUrl(content, `processImage${index + 1}`, media.process[index])}
                    alt={`Illustrative painting process stage: ${step.title}`}
                    sizes="(max-width: 760px) 78vw, 30vw"
                    tkey={`media.processImage${index + 1}`}
                  />
                  <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="p11-cta-row">
            <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
              Preview a walkthrough <ArrowRight aria-hidden="true" />
            </button>
            <a className="p11-tel" href={phoneHref} data-tkey="contact.phone">
              <Phone aria-hidden="true" /> {phoneLabel}
            </a>
          </div>
        </section>

        <section className="p11-plan" id="plan" aria-labelledby="p11-plan-title">
          <header className="p11-sec-head">
            <p className="p11-eyebrow">FIELD NOTES</p>
            <h2 id="p11-plan-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
          </header>
          <div className="p11-plan-grid">
            <figure className="p11-plan-photo">
              <Photo
                src={overlayMediaUrl(content, "planningImage", media.planning)}
                alt="Illustrative paint planning table with sample boards, tape, roller, and brush"
                sizes="(max-width: 760px) 100vw, 40vw"
                tkey="media.planningImage"
              />
            </figure>
            <div>
              <ul className="p11-plan-notes">
                {PAINTER_PLANNING_NOTES.map((note) => (
                  <li key={note.label}>
                    <span>{note.label}</span>
                    <h3>{note.title}</h3>
                    <p>{note.text}</p>
                  </li>
                ))}
              </ul>
              <div className="p11-faqs">
                {PAINTER_FAQS.map(([question, answer], index) => (
                  <details key={question} open={index === 0}>
                    <summary>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {question}
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
          <div className="p11-guide-strip" aria-label="Sample project guides">
            {PAINTER_BLOG_POSTS.map((post, index) => {
              const overlayPost = content?.blogs?.[index];
              return (
                <article key={post.number}>
                  <Photo
                    src={overlayMediaUrl(content, `guideImage${index + 1}`, media.guides[index])}
                    alt="Illustrative paint-planning guide reference"
                    sizes="(max-width: 760px) 100vw, 31vw"
                    tkey={`media.guideImage${index + 1}`}
                  />
                  <div>
                    <span data-tkey={`blogs.${index}.category`}>
                      {overlayPost?.category ?? post.category}
                    </span>
                    <h3 data-tkey={`blogs.${index}.title`}>{overlayPost?.title ?? post.title}</h3>
                    <p data-tkey={`blogs.${index}.excerpt`}>
                      {overlayPost?.excerpt ?? post.excerpt}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="p11-note">{PAINTER_SECTION_COPY.blogsDisclosure}</p>
          <div className="p11-cta-row">
            <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
              Preview a walkthrough <ArrowRight aria-hidden="true" />
            </button>
            <a className="p11-tel" href={phoneHref} data-tkey="contact.phone">
              <Phone aria-hidden="true" /> {phoneLabel}
            </a>
          </div>
        </section>

        <section className="p11-reviews" aria-labelledby="p11-reviews-title">
          <Photo
            src={overlayMediaUrl(content, "reviewsImage", media.reviews)}
            alt=""
            sizes="100vw"
            tkey="media.reviewsImage"
          />
          <div className="p11-reviews-card">
            <p className="p11-eyebrow">{overlayReviews ? "REVIEWS" : "REVIEWS / SAMPLE ONLY"}</p>
            <h2 id="p11-reviews-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <ul className="p11-review-quotes">
                {overlayReviews.map((review, index) => (
                  <li key={`${review.author}-${index}`}>
                    <blockquote data-tkey={`reviews.${index}.quote`}>{review.quote}</blockquote>
                    <cite data-tkey={`reviews.${index}.author`}>{review.author}</cite>
                  </li>
                ))}
              </ul>
            ) : null}
            {overlayReviews ? null : (
              <div className="p11-review-sources">
                <span>
                  <img
                    src="/templates/garden-delite/brands/google.svg"
                    width={66}
                    height={24}
                    alt="Google"
                  />{" "}
                  Sample / verification required
                </span>
                <span>
                  <img
                    src="/templates/garden-delite/brands/yelp.svg"
                    width={76}
                    height={24}
                    alt="Yelp"
                  />{" "}
                  Sample / verification required
                </span>
                <span>□ Direct / verification required</span>
              </div>
            )}
            <small>{PAINTER_DISCLOSURES.reviews}</small>
            <div className="p11-cta-row">
              <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
                Preview a walkthrough <ArrowRight aria-hidden="true" />
              </button>
              <a className="p11-tel" href={phoneHref}>
                <Phone aria-hidden="true" /> {phoneLabel}
              </a>
            </div>
          </div>
        </section>

        <section className="p11-estimate" id="estimate" aria-labelledby="p11-estimate-title">
          <Photo
            src={overlayMediaUrl(content, "estimateImage", media.estimate)}
            alt="Organized painting workbench"
            sizes="100vw"
            tkey="media.estimateImage"
          />
          <div className="p11-estimate-card">
            <p className="p11-eyebrow">SAVE AS ESTIMATE</p>
            <h2 id="p11-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <p data-tkey="text.estimateIntro">{estimateIntro}</p>
            <ul>
              {PAINTER_ESTIMATE_ITEMS.map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
              Preview a walkthrough flow <ArrowRight aria-hidden="true" />
            </button>
            <a className="p11-tel" href={phoneHref} data-tkey="contact.phone">
              Or call {phoneLabel}
            </a>
            <small>{PAINTER_DISCLOSURES.demo}</small>
          </div>
        </section>
      </main>

      <footer className="p11-footer">
        <div>
          <p className="p11-brand p11-brand-foot">
            <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
              {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
            </span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
          </p>
          <p>Residential interior · exterior · cabinets · trim</p>
          <p>Licensed · bonded · insured — sample credential line</p>
        </div>
        <nav aria-label="Footer">
          <a href="#surfaces">Work</a>
          <a href="#proof">Proof</a>
          <a href="#method">Method</a>
          <a href="#plan">Plan</a>
        </nav>
        <div>
          <button type="button" className="p11-btn" onClick={openBooking} disabled={bookingDisabled}>
            Preview a walkthrough <ArrowRight aria-hidden="true" />
          </button>
          <a href={phoneHref} data-tkey="contact.phone">
            {phoneLabel}
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {emailLabel}
          </a>
        </div>
        <p>{PAINTER_DISCLOSURES.footer}</p>
      </footer>

      {bookingMode === "demo" ? (
        <SiteBookingPayDemo
          open={bookingOpen}
          onOpenChange={(open) => {
            setBookingOpen(open);
            if (!open) requestAnimationFrame(() => bookingTriggerRef.current?.focus());
          }}
          isDemoPitch={true}
        />
      ) : null}
    </div>
  );
}
