import { ArrowDownRight, ArrowUpRight, Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";

import type { TemplateMoldContent } from "@/lib/template-content/overlay";
import {
  overlayLogoUrl,
  overlayMediaUrl,
  purchasedReviewList,
} from "@/lib/template-content/overlay";

import { PainterBlogSection } from "./PainterBlogSection";

import {
  PAINTER_ESTIMATE_ITEMS,
  PAINTER_FAQS,
  PAINTER_PLANNING_NOTES,
  PAINTER_PROCESS,
  PAINTER_SERVICES,
  PAINTER_SECTION_COPY,
  PAINTER_SURFACE_COPY,
} from "./painter-shared-copy";

import "./overlay-fit.css";
import "./painter-five/painter-five.css";

const MEDIA = "/templates/true-coat-california/generated";
const GOOGLE_LOGO = "/templates/garden-delite/brands/google.svg";
const YELP_LOGO = "/templates/garden-delite/brands/yelp.svg";
const IMAGE = {
  hero: MEDIA + "/hero.jpg",
  exteriorSage: MEDIA + "/exterior-sage.jpg",
  exteriorBlue: MEDIA + "/exterior-blue.jpg",
  interior: MEDIA + "/interior.jpg",
  trim: MEDIA + "/trim-clean.jpg",
  cabinets: MEDIA + "/cabinets.jpg",
  before: MEDIA + "/before.jpg",
  after: MEDIA + "/after.jpg",
  inspect: MEDIA + "/inspect.jpg",
  protect: MEDIA + "/protect-clean.jpg",
  repair: MEDIA + "/repair.jpg",
  prepare: MEDIA + "/prepare.jpg",
  finish: MEDIA + "/finish.jpg",
  notes: MEDIA + "/notes.jpg",
  reviews: MEDIA + "/reviews.jpg",
  faq: MEDIA + "/faq.jpg",
  estimate: MEDIA + "/estimate.jpg",
  facadeIvory: MEDIA + "/facade-ivory.jpg",
  facadeTerracotta: MEDIA + "/facade-terracotta.jpg",
  facadeNavy: MEDIA + "/facade-navy.jpg",
  heroVideo: MEDIA + "/hero.mp4",
} as const;
const surfaces = [
  {
    title: "Walls & ceilings",
    scope: PAINTER_SERVICES[0].scope,
    text: PAINTER_SURFACE_COPY.walls,
    image: IMAGE.interior,
    alt: "Sunlit California living room with warm white plaster walls, green built-ins, and blue arched doors",
    meta: "INTERIOR / SAMPLE / PLASTER",
  },
  {
    title: "Trim & doors",
    scope: "Detail work",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.trim,
    alt: "Terracotta front door within a warm white arch and weathered blue trim",
    meta: "DETAIL / SAMPLE / ARCH",
  },
  {
    title: "Siding & stucco",
    scope: PAINTER_SERVICES[1].scope,
    text: PAINTER_SURFACE_COPY.exterior,
    image: IMAGE.exteriorSage,
    alt: "California house with eucalyptus siding, warm stucco, and terracotta entry",
    meta: "EXTERIOR / SAMPLE / STUCCO",
  },
  {
    title: "Cabinet doors & frames",
    scope: PAINTER_SERVICES[2].scope,
    text: PAINTER_SURFACE_COPY.cabinets,
    image: IMAGE.cabinets,
    alt: "Bright California kitchen with pale eucalyptus cabinet doors and dark hardware",
    meta: "CABINETRY / SAMPLE / SATIN",
  },
] as const;
const process = PAINTER_PROCESS.map((step, index) => ({
  ...step,
  image: [IMAGE.inspect, IMAGE.protect, IMAGE.repair, IMAGE.prepare, IMAGE.finish][index],
  alt: [
    "Gloved painter inspecting stucco and window condition with a meter",
    "Canvas-protected sofa and floors in an arched California living room",
    "Gloved painter making a controlled patch beside a terracotta door",
    "Painter masking a blue arched window before coating",
    "Painter applying a controlled exterior stucco coat in bright daylight",
  ][index],
}));
const notes = PAINTER_PLANNING_NOTES;
const faqs = PAINTER_FAQS;
const reviewSlots = [
  { service: "Interior", source: "Google", logo: GOOGLE_LOGO },
  { service: "Exterior", source: "Yelp", logo: YELP_LOGO },
  { service: "Cabinet refinishing", source: "Google", logo: GOOGLE_LOGO },
] as const;
const estimateItems = PAINTER_ESTIMATE_ITEMS;
const schemes = [
  {
    id: "ivory",
    label: "Ivory",
    wall: "#ede5d5",
    trim: "#7699aa",
    door: "#b85d43",
    image: IMAGE.facadeIvory,
  },
  {
    id: "sage",
    label: "Sage",
    wall: "#7f907c",
    trim: "#f0e6d3",
    door: "#b85d43",
    image: IMAGE.after,
  },
  {
    id: "terracotta",
    label: "Terracotta",
    wall: "#bd694d",
    trim: "#efe5d2",
    door: "#1d2528",
    image: IMAGE.facadeTerracotta,
  },
  {
    id: "navy",
    label: "Navy",
    wall: "#253b4a",
    trim: "#eee4d3",
    door: "#bd694d",
    image: IMAGE.facadeNavy,
  },
] as const;
type SchemeId = (typeof schemes)[number]["id"];

export function PainterFiveTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const servicesHeading = text?.servicesHeading ?? PAINTER_SECTION_COPY.servicesHeading;
  const introTagline = text?.introTagline ?? "Sun, shadow, and a finish with a point of view.";
  const labHeading = text?.labHeading ?? "Choose sheen in the room’s actual light.";
  const labIntro = text?.labIntro ?? "Hover or focus to preview. Click to keep a finish schedule.";
  const proofTitle = text?.proofTitle ?? PAINTER_SECTION_COPY.proofHeading;
  const processHeading = text?.processHeading ?? PAINTER_SECTION_COPY.processHeading;
  const processIntro = text?.processIntro ?? PAINTER_SECTION_COPY.processIntro;
  const planHeading = text?.planHeading ?? PAINTER_SECTION_COPY.planningHeading;
  const reviewsHeading = text?.reviewsHeading ?? PAINTER_SECTION_COPY.reviewsHeading;
  const reviewsBody = text?.reviewsBody ?? PAINTER_SECTION_COPY.reviewsBody;
  const faqTitle = text?.faqTitle ?? PAINTER_SECTION_COPY.planningHeading;
  const estimateTitle = text?.estimateTitle ?? PAINTER_SECTION_COPY.estimateHeading;
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const rawEmail = content?.email?.trim() ? content.email.trim() : null;
  const emailLabel = rawEmail ?? "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "TRUE COAT";
  const brandAria = brandName ? `${brandName} home` : "True Coat home";
  const brandMark = brandName
    ? brandName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0]!.toUpperCase())
        .join("")
        .slice(0, 2)
    : "TC";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [committedScheme, setCommittedScheme] = useState<SchemeId>("ivory");
  const [previewScheme, setPreviewScheme] = useState<SchemeId | null>(null);
  const [reduceMotion, setReduceMotion] = useState(true);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const visibleScheme =
    schemes.find((scheme) => scheme.id === (previewScheme ?? committedScheme)) ?? schemes[0];
  const schemeIndex = schemes.findIndex((scheme) => scheme.id === visibleScheme.id) + 1;
  const schemeSlot = `schemeImage${schemeIndex}`;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <div className="p5" id="top">
      <a className="p5-skip" href="#main">
        Skip to content
      </a>
      <header className="p5-header" aria-label="Primary navigation">
        <a className="p5-brand" href="#top" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          {brandName ? (
            <span className="overlay-brand-name">{brandLabel}</span>
          ) : (
            <span className="overlay-brand-name">
              <span>TRUE</span>
              <span>COAT</span>
            </span>
          )}
        </a>
        <p className="p5-edition">California house issue · 2026</p>
        <nav className="p5-nav">
          <a href="#work">Projects</a>
          <a href="#surfaces">Surfaces</a>
          <a href="#process">Process</a>
          <a href="#notes">Color notes</a>
        </nav>
        <div className="p5-header-action">
          <button
            className="p5-header-cta"
            type="button"
            onClick={(event) => {
              bookingTriggerRef.current = event.currentTarget;
              setBookingOpen(true);
            }}
          >
            Plan a finish <ArrowUpRight aria-hidden="true" />
          </button>
          <span>Demo · no booking</span>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="p5-hero" aria-labelledby="p5-title">
          <img
            src={heroPoster}
            width={2400}
            height={1028}
            alt="Sunlit two-story California home with warm white stucco, blue trim, terracotta arch, and olive trees"
            fetchPriority="high"
            data-tkey="media.heroPoster"
          />
          {reduceMotion ? null : (
            <video
              aria-label="Sunlight and olive branches moving gently across a California home"
              autoPlay
              muted
              playsInline
              loop
              poster={heroPoster}
              preload="metadata"
            >
              <source src={IMAGE.heroVideo} type="video/mp4" />
            </video>
          )}
          <div className="p5-sunwash" aria-hidden="true" />
          <h1 id="p5-title" data-tkey="text.heroTitle">
            {text?.heroTitle ?? (
              <>
                <span>The right finish</span>
                <span>starts with prep.</span>
              </>
            )}
          </h1>
          <div className="p5-hero-deck">
            <p>Residential painting / fictional template</p>
            <p data-tkey="text.heroSub">
              {text?.heroSub ??
                "A clear plan for sunlit homes, careful preparation, and finishes that respect the architecture."}
            </p>
          </div>
          <div className="p5-hero-folio" aria-hidden="true">
            VOL. 05
          </div>
          <a className="p5-hero-scroll" href="#work">
            View the issue <ArrowDownRight aria-hidden="true" />
          </a>
        </section>
        <section className="p5-intro" id="work" aria-labelledby="p5-projects-heading">
          <div className="p5-folio">01 / PROJECT ATLAS</div>
          <div className="p5-intro-title">
            <p data-tkey="text.introTagline">{introTagline}</p>
            <h2 id="p5-projects-heading" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
          </div>
          <figure className="p5-atlas-lead">
            <img
              src={overlayMediaUrl(content, "galleryImage", IMAGE.exteriorBlue)}
              width={2400}
              height={1800}
              alt="Warm white Spanish bungalow with blue arched entry and terracotta roof"
              loading="lazy"
              data-tkey="media.galleryImage"
            />
            <figcaption>
              <span>EXTERIOR / 2026 / 2,400 SQ FT</span>
              <strong>Blue arch study</strong>
              <small>Illustrative template media—not client work.</small>
            </figcaption>
          </figure>
          <figure className="p5-atlas-detail">
            <img
              src={overlayMediaUrl(content, "trimImage", IMAGE.trim)}
              width={1800}
              height={2400}
              alt="Terracotta paneled door in a warm stucco arch with weathered blue trim"
              loading="lazy"
              data-tkey="media.trimImage"
            />
            <figcaption>ENTRY / TERRACOTTA / SAMPLE</figcaption>
          </figure>
          <figure className="p5-atlas-room">
            <img
              src={overlayMediaUrl(content, "interiorImage", IMAGE.interior)}
              width={2400}
              height={1800}
              alt="California living room framed by warm white arches and green built-ins"
              loading="lazy"
              data-tkey="media.interiorImage"
            />
            <figcaption>INTERIOR / WARM WHITE / SAMPLE</figcaption>
          </figure>
          <p className="p5-media-note">
            Illustrative template media. Replace with documented project photography before
            publishing.
          </p>
        </section>
        <section className="p5-lab" aria-labelledby="p5-lab-heading">
          <div className="p5-folio p5-folio-light">02 / FACADE LAB</div>
          <div className="p5-lab-copy">
            <p className="p5-kicker">Color study / interactive elevation</p>
            <h2 id="p5-lab-heading" data-tkey="text.labHeading">
              {labHeading}
            </h2>
            <p data-tkey="text.labIntro">{labIntro}</p>
          </div>
          <div className="p5-house-stage" data-scheme={visibleScheme.id}>
            <img
              key={visibleScheme.id}
              className="is-visible"
              src={overlayMediaUrl(content, schemeSlot, visibleScheme.image)}
              width={2400}
              height={1800}
              alt={`California bungalow in the ${visibleScheme.label} exterior finish palette`}
              loading="lazy"
              decoding="async"
              data-tkey={`media.schemeImage${schemeIndex}`}
            />
            <div className="p5-lab-status" aria-live="polite">
              {visibleScheme.label} finish preview
            </div>
          </div>
          <div
            className="p5-scheme-list"
            aria-label="Exterior finish palettes"
            onPointerLeave={() => setPreviewScheme(null)}
          >
            {schemes.map((scheme, index) => (
              <button
                type="button"
                key={scheme.id}
                aria-pressed={committedScheme === scheme.id}
                onPointerEnter={() => setPreviewScheme(scheme.id)}
                onFocus={() => setPreviewScheme(scheme.id)}
                onBlur={() => setPreviewScheme(null)}
                onClick={() => {
                  setCommittedScheme(scheme.id);
                  setPreviewScheme(null);
                }}
              >
                <span className="p5-scheme-no">0{index + 1}</span>
                <span className="p5-scheme-label">{scheme.label}</span>
                <span className="p5-scheme-materials">
                  <i style={{ background: scheme.wall }} />
                  <i style={{ background: scheme.trim }} />
                  <i style={{ background: scheme.door }} />
                </span>
              </button>
            ))}
          </div>
          <p className="p5-lab-note">
            Conceptual interface effect. Confirm real colors with physical samples in site
            conditions.
          </p>
        </section>
        <section className="p5-surfaces" id="surfaces" aria-labelledby="p5-surfaces-heading">
          <div className="p5-folio">03 / THE OPENINGS</div>
          <div className="p5-section-head">
            <p className="p5-kicker">Four capabilities / one house</p>
            <h2 id="p5-surfaces-heading" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
          </div>
          <div className="p5-openings-wall">
            {surfaces.map((surface, index) => (
              <article
                className={index === 1 ? "p5-opening p5-opening-arch" : "p5-opening"}
                key={surface.title}
              >
                <div className="p5-opening-image">
                  <img
                    src={overlayMediaUrl(content, `serviceImage${index + 1}`, surface.image)}
                    width={index === 1 ? 1800 : 2400}
                    height={index === 1 ? 2400 : 1800}
                    alt={surface.alt}
                    loading="lazy"
                    data-tkey={`media.serviceImage${index + 1}`}
                  />
                </div>
                <div className="p5-opening-copy">
                  <span>{surface.meta}</span>
                  <p>{surface.scope}</p>
                  <h3>{surface.title}</h3>
                  <small>{surface.text}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="p5-proof" aria-labelledby="p5-proof-heading">
          <div className="p5-folio p5-folio-light">04 / PAINT-ONLY STUDY</div>
          <div className="p5-proof-head">
            <p className="p5-kicker">Same property / matched camera</p>
            <h2 id="p5-proof-heading" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
          </div>
          <figure className="p5-proof-spread">
            <div className="p5-proof-image">
              <img
                src={IMAGE.before}
                width={2400}
                height={1800}
                alt="California bungalow before the illustrative color study"
                loading="lazy"
              />
              <span>Before / illustrative</span>
            </div>
            <div className="p5-proof-image">
              <img
                src={IMAGE.after}
                width={2400}
                height={1800}
                alt="Same California bungalow after an illustrative sage and terracotta paint-only study"
                loading="lazy"
              />
              <span>After / illustrative</span>
            </div>
            <figcaption>
              These matched-camera images illustrate how finish can alter a room without pretending
              a paint project is a remodel or a completed client job.
            </figcaption>
          </figure>
          <dl className="p5-proof-spec">
            {[
              ["Substrate", "Plaster"],
              ["Repairs", "Illustrative"],
              ["Primer", "As required"],
              ["Coats", "Per product"],
              ["Sheen", "Sample only"],
              ["Duration", "Scope-led"],
            ].map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="p5-process" id="process" aria-labelledby="p5-process-heading">
          <div className="p5-folio">05 / SITE SEQUENCE</div>
          <div className="p5-process-head">
            <p className="p5-kicker">{PAINTER_SECTION_COPY.processLabel}</p>
            <h2 id="p5-process-heading" data-tkey="text.processHeading">
              {processHeading}
            </h2>
            <p data-tkey="text.processIntro">{processIntro}</p>
          </div>
          <p className="p5-process-cue" id="p5-process-cue">
            Swipe or scroll to view all five stages.
          </p>
          <ol
            className="p5-process-rail"
            aria-label="Painting process: five stages"
            aria-describedby="p5-process-cue"
          >
            {process.map((step, index) => (
              <li key={step.title}>
                <figure>
                  <img
                    src={overlayMediaUrl(content, `processImage${index + 1}`, step.image)}
                    width={1800}
                    height={2400}
                    alt={step.alt}
                    loading="lazy"
                    data-tkey={`media.processImage${index + 1}`}
                  />
                  <figcaption>
                    <span>0{index + 1}</span>
                    <strong>{step.title}</strong>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ol>
        </section>
        <section className="p5-notes" id="notes" aria-labelledby="p5-notes-heading">
          <div className="p5-notes-image">
            <img
              src={overlayMediaUrl(content, "planningImage", IMAGE.notes)}
              width={2400}
              height={1350}
              alt="Four large paint samples in ivory, eucalyptus, terracotta, and navy under California window light"
              loading="lazy"
              data-tkey="media.planningImage"
            />
          </div>
          <div className="p5-folio p5-folio-light">06 / FIELD NOTES</div>
          <div className="p5-notes-head">
            <p className="p5-kicker">California conditions</p>
            <h2 id="p5-notes-heading" data-tkey="text.planHeading">
              {planHeading}
            </h2>
          </div>
          <div className="p5-note-list">
            {notes.map((note, index) => (
              <article key={note.label}>
                <span>
                  0{index + 1} / {note.label}
                </span>
                <h3>{note.title}</h3>
                <p>{note.text}</p>
              </article>
            ))}
          </div>
        </section>
        <PainterBlogSection posts={content?.blogs} />

        <section className="p5-reviews" aria-labelledby="p5-reviews-heading">
          <div className="p5-folio">07 / PROOF PLACEHOLDERS</div>
          <div className="p5-reviews-visual">
            <img
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              width={2400}
              height={1350}
              alt="Quiet California reading room with warm stucco, blue windows, and terracotta chair"
              loading="lazy"
              data-tkey="media.reviewsImage"
            />
          </div>
          <div className="p5-reviews-copy">
            <p className="p5-kicker">{PAINTER_SECTION_COPY.reviewsHeading}</p>
            <h2 id="p5-reviews-heading" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
          </div>
          {overlayReviews && overlayReviews.length > 0 ? (
            <ul className="p5-review-list">
              {overlayReviews.map((review, index) => (
                <li key={`${review.author}-${index}`}>
                  <blockquote data-tkey={`reviews.${index}.quote`}>{review.quote}</blockquote>
                  <strong data-tkey={`reviews.${index}.author`}>{review.author}</strong>
                </li>
              ))}
            </ul>
          ) : overlayReviews === null ? (
            <ul className="p5-review-list">
              {reviewSlots.map((slot, index) => (
                <li key={slot.service}>
                  <span>Empty review role 0{index + 1}</span>
                  <strong>{slot.service}</strong>
                  <div aria-label={"Verification-required " + slot.source + " source placement"}>
                    <img src={slot.logo} alt="" aria-hidden="true" />
                    <em>Verification required</em>
                  </div>
                  <small>Verification-required source placement</small>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <section className="p5-faq" aria-labelledby="p5-faq-heading">
          <div className="p5-folio">08 / OWNER’S BRIEF</div>
          <div className="p5-faq-image">
            <img
              src={overlayMediaUrl(content, "faqImage", IMAGE.faq)}
              width={2400}
              height={1350}
              alt="Architectural consultation table with plans and paint samples below an arched window"
              loading="lazy"
              data-tkey="media.faqImage"
            />
          </div>
          <div className="p5-faq-copy">
            <p className="p5-kicker">{PAINTER_SECTION_COPY.planningLabel}</p>
            <h2 id="p5-faq-heading" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div className="p5-faq-list">
              {faqs.map(([question, answer], index) => (
                <details key={question}>
                  <summary>
                    <span>0{index + 1}</span>
                    {question}
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
        <section className="p5-estimate" aria-labelledby="p5-estimate-heading">
          <img
            src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
            width={2400}
            height={1028}
            alt="Warm white California house with blue trim and glowing windows at dusk"
            loading="lazy"
            data-tkey="media.estimateImage"
          />
          <div className="p5-estimate-wash" aria-hidden="true" />
          <div className="p5-folio p5-folio-light">09 / PROJECT BRIEF</div>
          <div className="p5-estimate-copy">
            <p className="p5-kicker">{PAINTER_SECTION_COPY.estimateLabel}</p>
            <h2 id="p5-estimate-heading" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <ul>
              {estimateItems.map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <p>
              Demo scheduling and simulated payment only. No service is booked and no real charge
              occurs.
            </p>
            <div className="p5-estimate-actions">
              <div>
                <button
                  type="button"
                  onClick={(event) => {
                    bookingTriggerRef.current = event.currentTarget;
                    setBookingOpen(true);
                  }}
                >
                  Request a site visit <ArrowUpRight aria-hidden="true" />
                </button>
                <small>Demo · no appointment or charge</small>
              </div>
              <a href={phoneHref} data-tkey="contact.phone">
                {rawPhone ? `Call ${phoneLabel}` : "Sample call · (555) 013-7482"}
              </a>
            </div>
          </div>
        </section>
      </main>
      <footer className="p5-footer">
        <a href="#top" aria-label="Back to top" className="p5-footer-brand">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <span className="overlay-brand-name">{brandLabel}</span>
        </a>
        <p>
          {brandName ? `${brandName} painter template` : "Fictional True Coat painter template"}
        </p>
        <div>
          <a href={phoneHref} data-tkey="contact.phone">
            {rawPhone ? phoneLabel : "(555) 013-7482 · Sample number"}
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {rawEmail ? emailLabel : "hello@example.com · Sample address"}
          </a>
        </div>
        <p>
          Replace all sample content, media, scope, reviews, and contact details before publishing.
        </p>
      </footer>
      <SiteBookingPayDemo
        open={bookingOpen}
        onOpenChange={(next) => {
          setBookingOpen(next);
          if (!next) {
            requestAnimationFrame(() => bookingTriggerRef.current?.focus());
          }
        }}
        isDemoPitch={true}
      />
    </div>
  );
}
