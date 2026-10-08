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
import "./painter-six/painter-six.css";

const MEDIA = "/templates/true-coat-eggshell/generated";
const GOOGLE_LOGO = "/templates/garden-delite/brands/google.svg";
const YELP_LOGO = "/templates/garden-delite/brands/yelp.svg";

const IMAGE = {
  hero: MEDIA + "/hero.jpg",
  heroMotion: MEDIA + "/hero-motion.mp4",
  macro: MEDIA + "/macro-plaster.jpg",
  sheen: MEDIA + "/sheen-panel.jpg",
  overview: MEDIA + "/overview.jpg",
  interior: MEDIA + "/interior.jpg",
  trim: MEDIA + "/trim-detail.jpg",
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
  notes: MEDIA + "/notes.jpg",
  reviews: MEDIA + "/reviews.jpg",
  faq: MEDIA + "/faq.jpg",
  cta: MEDIA + "/cta.jpg",
} as const;

const surfaces = [
  {
    title: "Walls & ceilings",
    scope: PAINTER_SERVICES[0].scope,
    text: PAINTER_SURFACE_COPY.walls,
    image: IMAGE.interior,
    alt: "Immaculate warm-white walls and ceiling in a quiet residential room",
    finish: "EGGSHELL",
  },
  {
    title: "Trim & doors",
    scope: "Detail work",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.trim,
    alt: "Crisp near-black trim edge meeting a warm-white painted wall",
    finish: "SEMI-GLOSS",
  },
  {
    title: "Siding & stucco",
    scope: PAINTER_SERVICES[1].scope,
    text: PAINTER_SURFACE_COPY.exterior,
    image: IMAGE.exterior,
    alt: "Freshly painted warm-white stucco home with crisp dark trim",
    finish: "MATTE",
  },
  {
    title: "Cabinet doors & frames",
    scope: PAINTER_SERVICES[2].scope,
    text: PAINTER_SURFACE_COPY.cabinets,
    image: IMAGE.cabinetry,
    alt: "Immaculate warm-white flat-panel kitchen cabinetry with dark pulls",
    finish: "SATIN",
  },
] as const;
const process = PAINTER_PROCESS.map((step, index) => ({
  ...step,
  image: [IMAGE.inspect, IMAGE.protect, IMAGE.repair, IMAGE.prepare, IMAGE.finish][index],
  alt: [
    "Painter inspecting a smooth plaster wall and trim detail in raking light",
    "Linen chair and floor protected with clean canvas before painting",
    "Painter making a controlled small plaster repair beside a trim edge",
    "Painter masking a precise window trim edge before coating",
    "Painter applying an even coat to a warm-white plaster wall",
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
const sheens = [
  {
    id: "matte",
    label: "MATTE",
    description: "A broad, quiet light response across the painted plane.",
  },
  {
    id: "eggshell",
    label: "EGGSHELL",
    description: "A gentle, balanced reflection across the painted plane.",
  },
  {
    id: "satin",
    label: "SATIN",
    description: "A more defined raking-light response across the painted plane.",
  },
  {
    id: "semi-gloss",
    label: "SEMI-GLOSS",
    description: "A narrow, crisp highlight across the painted plane.",
  },
] as const;

type SheenId = (typeof sheens)[number]["id"];

export function PainterSixTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "A finish that holds the light.";
  const heroSub =
    text?.heroSub ??
    "A precise, prep-first template for interior painting, exterior preparation, and cabinet refinishing.";
  const introTitle = text?.introTitle ?? "Quiet work. Clear edges.";
  const introBody =
    text?.introBody ??
    "Care shows up in the line where wall meets trim, in the evenness of a finish, and in the preparation beneath it. This is an image-led template for making that care easy to see.";
  const sheenHeading = text?.sheenHeading ?? "One color. Four ways of receiving light.";
  const servicesHeading = text?.servicesHeading ?? PAINTER_SECTION_COPY.servicesHeading;
  const proofTitle = text?.proofTitle ?? PAINTER_SECTION_COPY.proofHeading;
  const proofBody =
    text?.proofBody ??
    "This illustrative paint-only comparison explores how finish can alter a room without pretending a paint project is a remodel or a completed client job.";
  const processHeading = text?.processHeading ?? PAINTER_SECTION_COPY.processHeading;
  const processIntro = text?.processIntro ?? PAINTER_SECTION_COPY.processIntro;
  const planHeading = text?.planHeading ?? PAINTER_SECTION_COPY.planningHeading;
  const planIntro =
    text?.planIntro ??
    "Useful decisions before beautiful finishes: color, scope, schedule, and project-day access.";
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
  const [reducedMotion, setReducedMotion] = useState(true);
  const [sheen, setSheen] = useState<SheenId>("eggshell");
  const pageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const sheenSpecimenRef = useRef<HTMLDivElement>(null);
  const selectedSheen = sheens.find((item) => item.id === sheen) ?? sheens[1];

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    const header = headerRef.current;
    const preview = page?.closest(".overflow-auto") as HTMLElement | null;
    if (!page || !header || !preview) return;

    const syncHeroHeight = () => {
      page.style.setProperty(
        "--p6-hero-available",
        Math.max(0, preview.clientHeight - header.offsetHeight) + "px",
      );
    };

    syncHeroHeight();
    const observer = new ResizeObserver(syncHeroHeight);
    observer.observe(preview);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  function openBooking(event: React.MouseEvent<HTMLButtonElement>) {
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  }

  function chooseSheen(next: SheenId) {
    setSheen(next);
  }

  function resetBeam() {
    const specimen = sheenSpecimenRef.current;
    specimen?.style.setProperty("--p6-beam-x", "68%");
    specimen?.style.setProperty("--p6-beam-y", "38%");
  }

  function moveBeam(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || reducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--p6-beam-x",
      ((event.clientX - bounds.left) / bounds.width) * 100 + "%",
    );
    event.currentTarget.style.setProperty(
      "--p6-beam-y",
      ((event.clientY - bounds.top) / bounds.height) * 100 + "%",
    );
  }

  function handleSheenKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = sheens[event.key === "Home" ? 0 : sheens.length - 1];
      chooseSheen(next.id);
      document.getElementById("p6-sheen-" + next.id)?.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const nextIndex = (index + direction + sheens.length) % sheens.length;
    const next = sheens[nextIndex];
    chooseSheen(next.id);
    document.getElementById("p6-sheen-" + next.id)?.focus();
  }

  return (
    <div className="p6" id="top" ref={pageRef}>
      <a className="p6-skip" href="#main">
        Skip to content
      </a>
      <header className="p6-header" ref={headerRef}>
        <a href="#top" className="p6-brand" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <span className="overlay-brand-name">{brandLabel}</span>
        </a>
        <p className="p6-edition">Surface study / 06</p>
        <nav aria-label="Primary navigation">
          <a href="#work">Projects</a>
          <a href="#surfaces">Surfaces</a>
          <a href="#process">Process</a>
          <a href="#notes">Color notes</a>
        </nav>
        <div className="p6-header-action">
          <button type="button" onClick={openBooking}>
            Plan a finish <ArrowUpRight aria-hidden="true" />
          </button>
          <span>Demo · no booking</span>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="p6-hero" aria-labelledby="p6-title">
          <div className="p6-hero-copy">
            <p className="p6-eyebrow">Residential painting · fictional template</p>
            <h1 id="p6-title" data-tkey="text.heroTitle">
              {heroTitle}
            </h1>
            <p data-tkey="text.heroSub">{heroSub}</p>
            <div className="p6-hero-actions">
              <button type="button" onClick={openBooking}>
                Request a site visit <ArrowUpRight aria-hidden="true" />
              </button>
              <a href={phoneHref} data-tkey="contact.phone">
                {rawPhone ? `Call ${phoneLabel}` : "Sample call · (555) 013-7482"}
              </a>
            </div>
            <small>Demo scheduling only. No appointment or charge is created.</small>
          </div>
          <figure className="p6-hero-surface">
            <img
              src={heroPoster}
              width={2560}
              height={1097}
              alt=""
              aria-hidden="true"
              fetchPriority="high"
              data-tkey="media.heroPoster"
            />
            {reducedMotion ? null : (
              <video
                autoPlay
                muted
                loop
                playsInline
                poster={heroPoster}
                preload="metadata"
                aria-hidden="true"
              >
                <source src={IMAGE.heroMotion} type="video/mp4" />
              </video>
            )}
            <figcaption>
              Generated illustrative surface study · replace before publishing
            </figcaption>
          </figure>
          <a className="p6-scroll" href="#work">
            See the surface study <ArrowDownRight aria-hidden="true" />
          </a>
        </section>

        <section className="p6-intro" id="work" aria-labelledby="p6-intro-heading">
          <figure>
            <img
              src={overlayMediaUrl(content, "introImage", IMAGE.macro)}
              width={1728}
              height={2304}
              alt="Flawless warm-white plaster meeting a crisp dark trim edge"
              loading="lazy"
              data-tkey="media.introImage"
            />
            <figcaption>Close inspection / generated illustrative study</figcaption>
          </figure>
          <div>
            <p className="p6-eyebrow">The surface tells the story</p>
            <h2 id="p6-intro-heading" data-tkey="text.introTitle">
              {introTitle}
            </h2>
            <p data-tkey="text.introBody">{introBody}</p>
            <p className="p6-truth">
              Illustrative template media. Replace with documented project photography before
              publishing.
            </p>
          </div>
        </section>

        <section className="p6-sheen" aria-labelledby="p6-sheen-heading">
          <div className="p6-section-heading">
            <p className="p6-eyebrow">Sheen in light</p>
            <h2 id="p6-sheen-heading" data-tkey="text.sheenHeading">
              {sheenHeading}
            </h2>
            <p>
              Move across the panel for a soft light study, then choose a finish to hold the
              specimen. This is a conceptual interface effect; confirm real finish choices with
              physical samples.
            </p>
          </div>
          <div
            ref={sheenSpecimenRef}
            className="p6-specimen"
            data-sheen={sheen}
            onPointerMove={moveBeam}
            onPointerLeave={resetBeam}
          >
            <img
              src={overlayMediaUrl(content, "sheenImage", IMAGE.sheen)}
              width={2304}
              height={1728}
              alt="Warm-white painted plaster panel under raking daylight"
              loading="lazy"
              data-tkey="media.sheenImage"
            />
            <div className="p6-specimen-light" aria-hidden="true" />
            <span className="p6-specimen-label" aria-hidden="true">
              {selectedSheen.label}
            </span>
          </div>
          <div className="p6-sheen-controls" role="radiogroup" aria-label="Finish sheen study">
            <p className="p6-sheen-live" aria-live="polite">
              {selectedSheen.description}
            </p>
            {sheens.map((item, index) => (
              <button
                type="button"
                role="radio"
                id={"p6-sheen-" + item.id}
                key={item.id}
                aria-checked={sheen === item.id}
                tabIndex={sheen === item.id ? 0 : -1}
                onClick={() => chooseSheen(item.id)}
                onKeyDown={(event) => handleSheenKeyDown(event, index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="p6-surfaces" id="surfaces" aria-labelledby="p6-surfaces-heading">
          <div className="p6-section-heading">
            <p className="p6-eyebrow">Where care lands</p>
            <h2 id="p6-surfaces-heading" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
          </div>
          <figure className="p6-overview">
            <img
              src={overlayMediaUrl(content, "overviewImage", IMAGE.overview)}
              width={2304}
              height={1536}
              alt="Warm-white wall plane, blank gray board, crisp dark trim and linen in soft light"
              loading="lazy"
              data-tkey="media.overviewImage"
            />
            <figcaption>Generated finish study · no real product labels</figcaption>
          </figure>
          <div className="p6-surface-list">
            {surfaces.map((surface, index) => (
              <article key={surface.title}>
                <figure>
                  <img
                    src={overlayMediaUrl(content, `serviceImage${index + 1}`, surface.image)}
                    width={surface.title === "Trim & doors" ? 1728 : 2304}
                    height={surface.title === "Trim & doors" ? 2304 : 1728}
                    alt={surface.alt}
                    loading="lazy"
                    data-tkey={`media.serviceImage${index + 1}`}
                  />
                </figure>
                <div>
                  <span>
                    {String(index + 1).padStart(2, "0")} / {surface.finish}
                  </span>
                  <p>{surface.scope}</p>
                  <h3>{surface.title}</h3>
                  <small>{surface.text}</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="p6-proof" aria-labelledby="p6-proof-heading">
          <div className="p6-section-heading">
            <p className="p6-eyebrow">Same room · paint only</p>
            <h2 id="p6-proof-heading" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div
            className="p6-proof-pair"
            role="group"
            aria-label="Illustrative paint-only finish comparison"
          >
            <figure>
              <img
                src={IMAGE.proofBefore}
                width={2304}
                height={1728}
                alt="Minimal room before an illustrative paint and surface repair study"
                loading="lazy"
              />
              <figcaption>
                01 / Existing surface <small>Generated study</small>
              </figcaption>
            </figure>
            <figure>
              <img
                src={IMAGE.proofAfter}
                width={2304}
                height={1728}
                alt="The same minimal room after an illustrative warm-white paint-only study"
                loading="lazy"
              />
              <figcaption>
                02 / Finished surface <small>Generated paint-only edit</small>
              </figcaption>
            </figure>
          </div>
          <dl className="p6-proof-facts">
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

        <section className="p6-process" id="process" aria-labelledby="p6-process-heading">
          <div className="p6-section-heading">
            <p className="p6-eyebrow">Built beneath the surface</p>
            <h2 id="p6-process-heading" data-tkey="text.processHeading">
              {processHeading}
            </h2>
            <p data-tkey="text.processIntro">{processIntro}</p>
          </div>
          <ol className="p6-process-list">
            {process.map((step, index) => (
              <li key={step.title}>
                <figure>
                  <img
                    src={overlayMediaUrl(content, `processImage${index + 1}`, step.image)}
                    width={1728}
                    height={2304}
                    alt={step.alt}
                    loading="lazy"
                    data-tkey={`media.processImage${index + 1}`}
                  />
                </figure>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="p6-notes" id="notes" aria-labelledby="p6-notes-heading">
          <figure>
            <img
              src={overlayMediaUrl(content, "notesImage", IMAGE.notes)}
              width={2304}
              height={1536}
              alt="Warm-white painted architectural wall and dark base trim in soft daylight"
              loading="lazy"
              data-tkey="media.notesImage"
            />
            <figcaption>Generated light study · no real product labels</figcaption>
          </figure>
          <div className="p6-notes-copy">
            <p className="p6-eyebrow">The measured brief</p>
            <h2 id="p6-notes-heading" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <img
              src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
              width={2304}
              height={1728}
              alt="Four blank painted finish panels and linen on a pale plaster table"
              loading="lazy"
              data-tkey="media.planningImage"
            />
          </div>
          <ol>
            {notes.map((note, index) => (
              <li key={note.label}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <small>{note.label}</small>
                  <h3>{note.title}</h3>
                  <p>{note.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <PainterBlogSection posts={content?.blogs} />

        <section className="p6-reviews" aria-labelledby="p6-reviews-heading">
          <figure>
            <img
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              width={2304}
              height={1728}
              alt="Quiet finished sitting room with warm-white walls and pale linen seating"
              loading="lazy"
              data-tkey="media.reviewsImage"
            />
            <figcaption>Generated finished-room study · not a client project</figcaption>
          </figure>
          <div>
            <p className="p6-eyebrow">A place for real words</p>
            <h2 id="p6-reviews-heading" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <ul>
                {overlayReviews.map((review, index) => (
                  <li key={`${review.author}-${index}`}>
                    <blockquote data-tkey={`reviews.${index}.quote`}>{review.quote}</blockquote>
                    <strong data-tkey={`reviews.${index}.author`}>{review.author}</strong>
                  </li>
                ))}
              </ul>
            ) : overlayReviews === null ? (
              <ul>
                {reviewSlots.map((slot, index) => (
                  <li key={slot.service}>
                    <span>Empty review role {String(index + 1).padStart(2, "0")}</span>
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
          </div>
        </section>

        <section className="p6-faq" aria-labelledby="p6-faq-heading">
          <figure>
            <img
              src={overlayMediaUrl(content, "faqImage", IMAGE.faq)}
              width={2304}
              height={1728}
              alt="Pale plaster consultation table with a blank sheet of paper and a pencil"
              loading="lazy"
              data-tkey="media.faqImage"
            />
            <figcaption>Generated consultation study · unlabeled fictional materials</figcaption>
          </figure>
          <div className="p6-faq-copy">
            <p className="p6-eyebrow">{PAINTER_SECTION_COPY.planningLabel}</p>
            <h2 id="p6-faq-heading" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div>
              {faqs.map(([question, answer], index) => (
                <details key={question}>
                  <summary>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{question}</strong>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="p6-estimate" aria-labelledby="p6-estimate-heading">
          <img
            src={overlayMediaUrl(content, "estimateImage", IMAGE.cta)}
            width={2304}
            height={1536}
            alt="Immaculate warm-white painted stucco facade in gentle dusk light"
            loading="lazy"
            data-tkey="media.estimateImage"
          />
          <div className="p6-estimate-wash" aria-hidden="true" />
          <div className="p6-estimate-copy">
            <p className="p6-eyebrow">{PAINTER_SECTION_COPY.estimateLabel}</p>
            <h2 id="p6-estimate-heading" data-tkey="text.estimateTitle">
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
            <div className="p6-estimate-actions">
              <div>
                <button type="button" onClick={openBooking}>
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

      <footer className="p6-footer">
        <a href="#top" aria-label="Back to top">
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
          if (!next) requestAnimationFrame(() => bookingTriggerRef.current?.focus());
        }}
        isDemoPitch={true}
      />
    </div>
  );
}
