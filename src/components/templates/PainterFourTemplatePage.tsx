import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useState } from "react";

import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";

import type { TemplateMoldContent } from "@/lib/template-content/overlay";
import {
  overlayLogoUrl,
  overlayMediaUrl,
  purchasedReviewList,
} from "@/lib/template-content/overlay";

import "./overlay-fit.css";
import "./painter-four/painter-four.css";

const MEDIA = "/templates/true-coat-colorbook/generated";

const IMAGE = {
  hero: MEDIA + "/hero.jpg",
  heroVideo: MEDIA + "/hero-loop.mp4",
  services: MEDIA + "/services.jpg",
  cleanEdge: MEDIA + "/clean-edge.jpg",
  sheen: MEDIA + "/sheen.jpg",
  faq: MEDIA + "/faq-v2.jpg",
  walls: MEDIA + "/walls.jpg",
  trim: MEDIA + "/trim.jpg",
  exterior: MEDIA + "/exterior.jpg",
  cabinets: MEDIA + "/cabinets.jpg",
  before: MEDIA + "/proof-before.jpg",
  after: MEDIA + "/proof-after.jpg",
  planning: MEDIA + "/planning.jpg",
  review: MEDIA + "/review.jpg",
  cta: MEDIA + "/cta.jpg",
  inspect: MEDIA + "/inspect.jpg",
  protect: MEDIA + "/protect-v2.jpg",
  repair: MEDIA + "/repair.jpg",
  prepare: MEDIA + "/prepare.jpg",
  finish: MEDIA + "/finish.jpg",
} as const;

const surfaces = [
  {
    title: "Walls & ceilings",
    scope: "Interior painting",
    text: "Condition, repairs, access, room use, and desired sheen shape the example scope.",
    image: IMAGE.walls,
    alt: "Traditional living room with muted sage walls, ivory trim, dark furnishings, and oak flooring in daylight",
    color: "sage",
  },
  {
    title: "Trim & doors",
    scope: "Detail work",
    text: "Existing coatings, adhesion, edge condition, hardware, and finish compatibility should be verified on site.",
    image: IMAGE.trim,
    alt: "Gloved painter brushing oxblood trim beside a muted sage wall",
    color: "oxblood",
  },
  {
    title: "Siding & stucco",
    scope: "Exterior painting",
    text: "Weather, substrate, exposure, access, and coating requirements determine suitability and timing.",
    image: IMAGE.exterior,
    alt: "Craftsman house exterior with sage siding, ivory trim, and oxblood accents",
    color: "blue",
  },
  {
    title: "Cabinet doors & frames",
    scope: "Cabinet refinishing",
    text: "A sample cabinet process organized around cleaning, adhesion, smooth application, and finish planning.",
    image: IMAGE.cabinets,
    alt: "Traditional kitchen with oxblood cabinetry, muted sage doors, stone counters, and brass hardware",
    color: "umber",
  },
] as const;

const preparation = [
  {
    title: "Inspect",
    image: IMAGE.inspect,
    alt: "Gloved painter inspecting a trim edge in raking light",
    color: "sage",
  },
  {
    title: "Protect",
    image: IMAGE.protect,
    alt: "Floor and furniture protected before residential painting",
    color: "blue",
  },
  {
    title: "Repair",
    image: IMAGE.repair,
    alt: "Small plaster repair prepared under raking light",
    color: "bone",
  },
  {
    title: "Prepare",
    image: IMAGE.prepare,
    alt: "Painter masking architectural trim before coating",
    color: "oxblood",
  },
  {
    title: "Finish",
    image: IMAGE.finish,
    alt: "Painter applying the final controlled wall coat",
    color: "umber",
  },
] as const;

const notes = [
  {
    eyebrow: "Color",
    title: "Read undertones in the room’s actual light.",
    text: "Use physical samples and review them across morning, afternoon, and evening conditions before confirming a color direction.",
  },
  {
    eyebrow: "Scope",
    title: "Preparation belongs in the written plan.",
    text: "Repairs, protection, cleaning, sanding, priming, access, and exclusions should be explicit rather than implied.",
  },
  {
    eyebrow: "Schedule",
    title: "Let conditions—not slogans—set timing.",
    text: "Project length depends on verified scope, repairs, drying conditions, crew size, access, and product requirements.",
  },
  {
    eyebrow: "Project day",
    title: "Confirm access before work begins.",
    text: "Secure fragile items, review moving needs, clarify pets and parking, and agree on daily cleanup and communication.",
  },
] as const;

const faqs = [
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
  ["Interior", "Google"],
  ["Exterior", "Yelp"],
  ["Cabinet refinishing", "Google"],
] as const;

const worksheet = [
  "Surfaces and current condition",
  "Repairs and access",
  "Color and finish goals",
  "Timing and occupancy",
  "Protection requirements",
  "Address and service-area fit",
] as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="p4-section-label">{children}</p>;
}

function BookingButton({
  onClick,
  children,
  light = false,
}: {
  onClick: () => void;
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <button
      className={light ? "p4-button p4-button-light" : "p4-button"}
      type="button"
      onClick={onClick}
    >
      <span>{children}</span>
      <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.7} />
    </button>
  );
}

function BrandLockup({
  brand,
  logoUrl,
  note,
}: {
  brand: string;
  logoUrl: string | null;
  note: string;
}) {
  const initials = brand
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("")
    .slice(0, 2);
  return (
    <>
      <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
        {logoUrl ? <img src={logoUrl} alt="" /> : initials}
      </span>
      <span>
        <span className="p4-brand-main overlay-brand-name">{brand}</span>
        <span className="p4-brand-note">{note}</span>
      </span>
    </>
  );
}

function HeroMedia({ reducedMotion, poster }: { reducedMotion: boolean; poster: string }) {
  return (
    <div className="p4-hero-media">
      <img
        src={poster}
        width={2200}
        height={1466}
        alt="Professional color fan, used brush, canvas tool roll, and painted hand selecting a muted sage swatch on a worn workbench"
        data-tkey="media.heroPoster"
        style={{ position: "absolute", inset: 0, width: "100%" }}
      />
      {reducedMotion ? null : (
        <video
          autoPlay
          muted
          onTimeUpdate={(event) => {
            if (event.currentTarget.currentTime >= 4.5) event.currentTarget.pause();
          }}
          playsInline
          preload="metadata"
          poster={poster}
          aria-label="Painter selecting a muted sage swatch from a physical color fan on a workbench"
          style={{ position: "absolute", inset: 0, width: "100%" }}
        >
          <source src={IMAGE.heroVideo} type="video/mp4" />
        </video>
      )}
      <div className="p4-hero-shade" />
      <p className="p4-media-truth">Generated colorbook study · replace before publishing</p>
    </div>
  );
}
export function PainterFourTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "The finish starts before the first coat.";
  const heroSub =
    text?.heroSub ??
    "A precise, prep-first template for interior painting, exterior preparation, and cabinet refinishing.";
  const detailTitle = text?.detailTitle ?? "Prep is the performance. Color is the reveal.";
  const servicesHeading = text?.servicesHeading ?? "Let every finish take the frame.";
  const servicesIntro =
    text?.servicesIntro ??
    "Each chapter pairs a large visual with the condition, preparation, access, and finish questions that shape real scope.";
  const processHeading = text?.processHeading ?? "The good mess before the clean edge.";
  const processIntro =
    text?.processIntro ??
    "A serious sequence in a playful frame: inspect, protect, repair, prepare, and finish.";
  const proofTitle = text?.proofTitle ?? "Illustrated change, shown side by side.";
  const proofBody =
    text?.proofBody ??
    "These matched-camera images illustrate how finish can alter a room without pretending a paint project is a remodel or a completed client job.";
  const planHeading = text?.planHeading ?? "Color likes context.";
  const planIntro =
    text?.planIntro ??
    "Useful decisions before beautiful finishes: color, scope, schedule, and project-day access.";
  const reviewsHeading = text?.reviewsHeading ?? "No verified reviews supplied.";
  const reviewsBody =
    text?.reviewsBody ??
    "These empty roles show structure only. There are no ratings, portraits, names, locations, or fabricated quotes. Replace every slot with verified, permissioned feedback before publishing.";
  const faqTitle = text?.faqTitle ?? "Ask before the lid opens.";
  const estimateTitle = text?.estimateTitle ?? "Bring the real scope into view.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const rawEmail = content?.email?.trim() ? content.email.trim() : null;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "TRUE COAT";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const reducedMotion = useReducedMotion() ?? false;
  const [bookingOpen, setBookingOpen] = useState(false);

  return (
    <div className="p4-shell" id="top">
      <a className="p4-skip" href="#main">
        Skip to content
      </a>
      <header className="p4-header">
        <a className="p4-brand" href="#top" aria-label="Back to top">
          <BrandLockup brand={brandLabel} logoUrl={logoUrl} note="Field colorbook / 04" />
        </a>
        <nav aria-label="Primary navigation">
          <a href="#work">Projects</a>
          <a href="#surfaces">Surfaces</a>
          <a href="#process">Process</a>
          <a href="#notes">Color notes</a>
        </nav>
        <button className="p4-header-cta" type="button" onClick={() => setBookingOpen(true)}>
          Plan a finish <span aria-hidden="true">↗</span>
        </button>
      </header>

      <nav className="p4-mobile-index" aria-label="Page sections">
        <a href="#work">Projects</a>
        <a href="#surfaces">Surfaces</a>
        <a href="#process">Process</a>
        <a href="#notes">Color notes</a>
      </nav>

      <main id="main" tabIndex={-1}>
        <section className="p4-hero" aria-labelledby="p4-title">
          <HeroMedia reducedMotion={reducedMotion} poster={heroPoster} />
          <div className="p4-hero-copy">
            <SectionLabel>Residential painting</SectionLabel>
            <h1 id="p4-title" data-tkey="text.heroTitle">
              {heroTitle}
            </h1>
            <p className="p4-hero-intro" data-tkey="text.heroSub">
              {heroSub}
            </p>
            <div className="p4-hero-actions">
              <BookingButton onClick={() => setBookingOpen(true)} light>
                Request a site visit
              </BookingButton>
              <a className="p4-phone" href={phoneHref} data-tkey="contact.phone">
                {rawPhone ? phoneLabel : "Sample call · (555) 013-7482"}
              </a>
            </div>
          </div>
          <div className="p4-swatch-index" aria-hidden="true">
            <span>Bone paper</span>
            <span>Sage field</span>
            <span>Oxblood</span>
            <span>Cornflower</span>
            <span>Toolbox umber</span>
          </div>
        </section>

        <section className="p4-proof-intro" aria-label="Clean-edge proof">
          <figure>
            <img
              src={overlayMediaUrl(content, "cleanEdgeImage", IMAGE.cleanEdge)}
              width={2200}
              height={1466}
              alt="Gloved painter pulling cream masking tape from a freshly finished oxblood door edge"
              loading="lazy"
              data-tkey="media.cleanEdgeImage"
            />
            <figcaption>
              Generated illustrative craft study · not a completed client project
            </figcaption>
          </figure>
          <div className="p4-proof-note">
            <span className="p4-note-hole" aria-hidden="true" />
            <SectionLabel>The clean-edge payoff</SectionLabel>
            <h2 data-tkey="text.detailTitle">{detailTitle}</h2>
            <p>
              Illustrative template media. Replace with documented project photography before
              publishing.
            </p>
          </div>
        </section>

        <section id="surfaces" className="p4-surfaces">
          <div className="p4-section-heading">
            <SectionLabel>Surface stories</SectionLabel>
            <h2 data-tkey="text.servicesHeading">{servicesHeading}</h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <figure className="p4-surface-overview">
            <img
              src={overlayMediaUrl(content, "servicesImage", IMAGE.services)}
              width={2200}
              height={1466}
              alt="Unlabeled painted finish boards and professional painting tools beside a well-used toolbox"
              loading="lazy"
              data-tkey="media.servicesImage"
            />
            <figcaption>Generated finish-board study · no real product labels</figcaption>
          </figure>
          <div className="p4-surface-deck">
            {surfaces.map((surface, index) => (
              <article className={"p4-surface-study p4-study-" + surface.color} key={surface.title}>
                <img
                  src={overlayMediaUrl(content, `surfaceImage${index + 1}`, surface.image)}
                  alt={surface.alt}
                  width={2200}
                  height={1650}
                  loading="lazy"
                  data-tkey={`media.surfaceImage${index + 1}`}
                />
                <div className="p4-surface-annotation">
                  <div>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>{surface.scope}</span>
                  </div>
                  <h3>{surface.title}</h3>
                  <p>{surface.text}</p>
                  <small>Generated illustrative template media</small>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="process" className="p4-process">
          <div className="p4-process-heading" id="p4-process-heading">
            <SectionLabel>Preparation contact sheet</SectionLabel>
            <h2 data-tkey="text.processHeading">{processHeading}</h2>
            <p data-tkey="text.processIntro">{processIntro}</p>
          </div>
          <ol
            className="p4-process-strip"
            role="region"
            aria-labelledby="p4-process-heading"
            aria-describedby="p4-process-hint"
            tabIndex={0}
          >
            {preparation.map((step, index) => (
              <li className={"p4-process-view p4-view-" + step.color} key={step.title}>
                <figure>
                  <img
                    src={overlayMediaUrl(content, `processImage${index + 1}`, step.image)}
                    alt={step.alt}
                    width={2200}
                    height={1650}
                    loading="lazy"
                    data-tkey={`media.processImage${index + 1}`}
                  />
                  <figcaption>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{step.title}</strong>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ol>
          <p className="p4-process-hint" id="p4-process-hint">
            Scroll to follow all five preparation steps →
          </p>
          <p className="p4-process-truth">
            Generated illustrative process studies · replace with documented, permissioned media
            before publishing.
          </p>
        </section>

        <section id="work" className="p4-work">
          <div className="p4-work-copy">
            <SectionLabel>Same room · two moods</SectionLabel>
            <h2 data-tkey="text.proofTitle">{proofTitle}</h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div
            className="p4-proof-pair"
            role="group"
            aria-label="Generated illustrative room comparison"
          >
            <figure>
              <img
                src={IMAGE.before}
                width={2200}
                height={1650}
                alt="Traditional room with worn yellowed plaster walls and scattered repairs before painting"
                loading="lazy"
              />
              <figcaption>
                01 · Existing surface <small>Generated study</small>
              </figcaption>
            </figure>
            <figure>
              <img
                src={IMAGE.after}
                width={2200}
                height={1650}
                alt="Same traditional room with completed dusty cornflower-blue walls and preserved ivory trim"
                loading="lazy"
              />
              <figcaption>
                02 · Completed finish <small>Generated paint-only edit</small>
              </figcaption>
            </figure>
          </div>
          <dl className="p4-facts">
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

        <section id="notes" className="p4-notes">
          <figure className="p4-notes-image">
            <img
              src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
              width={2200}
              height={1466}
              alt="Unlabeled paint swatches viewed in daylight"
              loading="lazy"
              data-tkey="media.planningImage"
            />
            <figcaption>
              Generated planning study · synthetic markings are not product labels
            </figcaption>
          </figure>
          <div className="p4-notes-book">
            <div className="p4-notes-heading">
              <SectionLabel>Color lab / scope notebook</SectionLabel>
              <h2 data-tkey="text.planHeading">{planHeading}</h2>
              <p data-tkey="text.planIntro">{planIntro}</p>
              <figure className="p4-sheen-study">
                <img
                  src={overlayMediaUrl(content, "sheenImage", IMAGE.sheen)}
                  width={2200}
                  height={1650}
                  alt="Four painted sample boards showing varied color and surface reflection"
                  loading="lazy"
                  data-tkey="media.sheenImage"
                />
                <figcaption>Generated finish study · unlabeled fictional samples</figcaption>
              </figure>
            </div>
            <ol>
              {notes.map((note, index) => (
                <li key={note.eyebrow}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <small>{note.eyebrow}</small>
                    <h3>{note.title}</h3>
                    <p>{note.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="p4-reviews">
          <figure className="p4-review-image">
            <img
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.review)}
              width={2200}
              height={1650}
              alt="Generated finished reading room with color swatches and an open contractor toolbox"
              loading="lazy"
              data-tkey="media.reviewsImage"
            />
            <figcaption>Generated room study · not a client project</figcaption>
          </figure>
          <div className="p4-review-ledger">
            <SectionLabel>Review layout preview</SectionLabel>
            <h2 data-tkey="text.reviewsHeading">{reviewsHeading}</h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <ul className="p4-review-slots">
                {overlayReviews.map((review, index) => (
                  <li key={`${review.author}-${index}`}>
                    <blockquote data-tkey={`reviews.${index}.quote`}>{review.quote}</blockquote>
                    <strong data-tkey={`reviews.${index}.author`}>{review.author}</strong>
                  </li>
                ))}
              </ul>
            ) : overlayReviews === null ? (
              <ul className="p4-review-slots">
                {reviewSlots.map(([role, source], index) => (
                  <li key={role}>
                    <span>Empty review role {String(index + 1).padStart(2, "0")}</span>
                    <strong>{role}</strong>
                    <span className="p4-review-source">{source}</span>
                    <small>Example source badge placement — not a live review</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="p4-faq">
          <figure className="p4-faq-image">
            <img
              src={overlayMediaUrl(content, "faqImage", IMAGE.faq)}
              width={2200}
              height={1466}
              alt="Blank field notebook, five solid-color finish boards, brush, tool roll, scraper, brass key, rag, and open blue paint can on a worktable"
              loading="lazy"
              data-tkey="media.faqImage"
            />
            <figcaption>Generated consultation study · unlabeled fictional materials</figcaption>
          </figure>
          <div className="p4-faq-heading">
            <SectionLabel>Eight practical questions</SectionLabel>
            <h2 data-tkey="text.faqTitle">{faqTitle}</h2>
          </div>
          <div className="p4-faq-list">
            {faqs.map(([question, answer], index) => (
              <details key={question}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")} /</span>
                  <strong>{question}</strong>
                  <Plus aria-hidden="true" size={20} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="p4-estimate">
          <img
            src={overlayMediaUrl(content, "estimateImage", IMAGE.cta)}
            width={2200}
            height={1466}
            alt="Well-used contractor toolbox beside physical color swatches on a craftsman’s workbench"
            loading="lazy"
            data-tkey="media.estimateImage"
          />
          <div className="p4-estimate-shade" />
          <div className="p4-estimate-copy">
            <SectionLabel>Estimate worksheet</SectionLabel>
            <h2 data-tkey="text.estimateTitle">{estimateTitle}</h2>
            <p>
              Demo scheduling and simulated payment only. No service is booked and no real charge
              occurs.
            </p>
            <ul>
              {worksheet.map((item) => (
                <li key={item}>
                  <ArrowDownRight aria-hidden="true" size={16} />
                  {item}
                </li>
              ))}
            </ul>
            <div className="p4-estimate-actions">
              <BookingButton onClick={() => setBookingOpen(true)} light>
                Request a site visit
              </BookingButton>
              <a className="p4-phone" href={phoneHref} data-tkey="contact.phone">
                {rawPhone ? phoneLabel : "Sample call · (555) 013-7482"}
              </a>
            </div>
          </div>
          <p className="p4-estimate-truth">Generated illustrative workshop study</p>
        </section>
      </main>

      <footer className="p4-footer">
        <a className="p4-brand" href="#top" aria-label="Back to top">
          <BrandLockup
            brand={brandLabel}
            logoUrl={logoUrl}
            note="Fictional True Coat painter template"
          />
        </a>
        <div>
          <a href={phoneHref} data-tkey="contact.phone">
            {rawPhone ? phoneLabel : "(555) 013-7482 · Sample number"}
          </a>
          <p>{rawEmail ?? "hello@example.com · Sample address"}</p>
        </div>
        <p>
          Replace all sample content, media, scope, reviews, and contact details before publishing.
        </p>
      </footer>

      <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
    </div>
  );
}
