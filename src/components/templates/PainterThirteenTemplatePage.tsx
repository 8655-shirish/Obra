import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  MapPin,
  Phone,
  Quote,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SiteBookingPayDemo } from "@/components/site-renderer/SiteBookingPayDemo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  overlayLogoUrl,
  overlayMediaUrl,
  purchasedReviewList,
  withOverlayBlogPost,
  type TemplateMoldContent,
} from "@/lib/template-content/overlay";

import {
  PAINTER_ESTIMATE_ITEMS,
  PAINTER_FAQS,
  PAINTER_PLANNING_NOTES,
  PAINTER_PROCESS,
  PAINTER_SECTION_COPY,
  PAINTER_SERVICES,
  PAINTER_SURFACE_COPY,
} from "./painter-shared-copy";

import "./overlay-fit.css";
import "./painter-thirteen/painter-thirteen.css";

const MEDIA = "/templates/blueberry-gelato/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const IMAGE = {
  hero: `${MEDIA}/hero.jpg`,
  heroMotion: `${MEDIA}/hero-motion.mp4`,
  flavorWall: `${MEDIA}/flavor-wall.jpg`,
  interior: `${MEDIA}/service-interior.jpg`,
  exterior: `${MEDIA}/service-exterior.jpg`,
  cabinets: `${MEDIA}/service-cabinets.jpg`,
  trim: `${MEDIA}/service-trim.jpg`,
  ceramic: `${MEDIA}/ceramic-detail.jpg`,
  before: `${MEDIA}/proof-before.jpg`,
  after: `${MEDIA}/proof-after.jpg`,
  process: `${MEDIA}/process.jpg`,
  planning: `${MEDIA}/planning.jpg`,
  reviews: `${MEDIA}/reviews.jpg`,
  faq: `${MEDIA}/faq.jpg`,
  estimate: `${MEDIA}/estimate.jpg`,
  guides: [`${MEDIA}/guide-color.jpg`, `${MEDIA}/guide-prep.jpg`, `${MEDIA}/guide-sheen.jpg`],
} as const;

const services = [
  {
    number: "01",
    flavor: "INTERIORS",
    title: PAINTER_SERVICES[0].title,
    text: PAINTER_SERVICES[0].text,
    image: IMAGE.interior,
    alt: "Illustrative painter rolling a blueberry wall in a protected Mediterranean-revival living room",
    detail: "2 COATS · WALLS · CEILINGS",
  },
  {
    number: "02",
    flavor: "EXTERIORS",
    title: PAINTER_SERVICES[1].title,
    text: PAINTER_SERVICES[1].text,
    image: IMAGE.exterior,
    alt: "Illustrative painter carefully working on a peach Mediterranean-revival exterior",
    detail: "STUCCO · SHUTTERS · SUN",
  },
  {
    number: "03",
    flavor: "CABINETS",
    title: PAINTER_SERVICES[2].title,
    text: PAINTER_SERVICES[2].text,
    image: IMAGE.cabinets,
    alt: "Illustrative painter refinishing blueberry kitchen cabinet frames in a protected interior",
    detail: "DOORS · FRAMES · CURE",
  },
  {
    number: "04",
    flavor: "TRIM + DOORS",
    title: "Trim & doors",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.trim,
    alt: "Illustrative painter hand-finishing pistachio shutters and cream architectural trim",
    detail: "EDGES · ENAMEL · DETAIL",
  },
] as const;

const reviewExamples = [
  {
    quote:
      "The walkthrough felt neighborly, but the written scope still covered the repairs, protection, color, and timing we would want in writing.",
    name: "Priya S.",
    project: "Interior repaint draft",
    source: "Google-style card",
  },
  {
    quote:
      "The porch palette was cheerful without shouting. We especially liked seeing siding, trim, and the front door treated as separate finish decisions.",
    name: "Mateo L.",
    project: "Exterior refresh draft",
    source: "Yelp-style card",
  },
  {
    quote:
      "The cabinet conversation included labeling, hardware, adhesion, and cure time before color. That is the kind of detail that builds confidence.",
    name: "Erin & Jo",
    project: "Cabinet refinishing draft",
    source: "Direct-note card",
  },
] as const;

const blogArticles = [
  {
    number: "01",
    category: "Color planning",
    title: "How to test paint color before committing to a room",
    excerpt:
      "A practical three-step sample routine: place it beside fixed finishes, view it through the day, and compare it with the intended sheen before you choose.",
    readTime: "4 minute field note",
    intro:
      "Color behaves differently beside flooring, trim, daylight, and evening lamps. A useful test recreates those conditions before gallons are ordered.",
    sections: [
      {
        title: "Make the sample movable",
        body: "Paint two coats on a large loose board instead of scattering test patches across every wall. Move the board beside the window, trim, cabinetry, flooring, and the furniture that will remain.",
      },
      {
        title: "Watch a full day",
        body: "Check the color in morning light, direct afternoon sun, shade, and the lamps you use at night. A color that feels balanced at noon can turn cold or overly vivid after sunset.",
      },
      {
        title: "Approve color and sheen together",
        body: "Sheen changes reflected light and can reveal more wall texture. Record the final color, product, and sheen by room in the written scope so the sample decision reaches the finished wall.",
      },
    ],
  },
  {
    number: "02",
    category: "Preparation",
    title: "What a thorough paint-prep plan should cover",
    excerpt:
      "From patching and sanding to protection, priming, and edge work, these are the questions that make a painting proposal easier to compare.",
    readTime: "5 minute field note",
    intro:
      "Preparation is not one generic line item. The right plan follows the existing coating, substrate, damage, moisture, access, and finish standard for each surface.",
    sections: [
      {
        title: "Start with what is already there",
        body: "Identify peeling, chalking, stains, cracks, failed caulk, glossy coatings, loose repairs, and moisture concerns. The estimate should distinguish visible preparation from conditions that may appear after work begins.",
      },
      {
        title: "Write protection into the scope",
        body: "Confirm furniture moves, floor and landscape protection, hardware handling, dust control, ventilation, pets, parking, and daily cleanup. Protection is part of production, not a courtesy added later.",
      },
      {
        title: "Match preparation to adhesion",
        body: "Cleaning, sanding, patching, caulking, priming, and test areas should respond to the actual surface and coating system. Ask how newly discovered conditions are approved before they become extra work.",
      },
    ],
  },
  {
    number: "03",
    category: "Finish guide",
    title: "Matte, eggshell, satin, or semi-gloss: choosing a sheen",
    excerpt:
      "Use light, traffic, cleanability, wall condition, and adjacent trim to choose a finish that feels right after the paint has cured.",
    readTime: "4 minute field note",
    intro:
      "The most reflective finish is not automatically the most durable choice. Room use, cleanability, light, wall condition, and adjacent trim all shape a good sheen decision.",
    sections: [
      {
        title: "Begin with wall condition",
        body: "Lower-sheen finishes soften reflected light and tend to show fewer surface variations. Satin and semi-gloss can make dents, patches, and roller texture more visible, so preparation and sheen should be planned together.",
      },
      {
        title: "Consider traffic and cleaning",
        body: "Bedrooms and quiet living areas may suit matte or eggshell, while busy halls, kitchens, baths, doors, and trim often benefit from more washable systems. Product guidance matters as much as the finish name.",
      },
      {
        title: "Create intentional contrast",
        body: "A subtle step from walls to trim can clarify architectural edges without making every surface glossy. View real samples under the room's light and write each approved sheen into the proposal.",
      },
    ],
  },
] as const;

type BlogArticle = (typeof blogArticles)[number];

function TemplateImage({
  src,
  alt,
  eager = false,
  className,
  sizes = "(max-width: 760px) 100vw, 65vw",
  tkey,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
  sizes?: string;
  tkey?: string;
}) {
  const srcSet =
    src.endsWith(".jpg") && src.startsWith("/templates/")
      ? `${src.replace(/\.jpg$/, "-800.jpg")} 800w, ${src.replace(/\.jpg$/, "-1200.jpg")} 1200w, ${src} 1600w`
      : undefined;

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      width={1600}
      height={1000}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      data-tkey={tkey}
    />
  );
}

function HeroFilm({ poster }: { poster: string }) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (document.hidden || motion.matches) video.pause();
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
    <figure className="p13-hero-film">
      <TemplateImage
        src={poster}
        alt="Illustrative Mediterranean-revival home with a blueberry facade, pistachio shutters, and peach entry"
        eager
        sizes="100vw"
        tkey="media.heroPoster"
      />
      {!failed ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          poster={poster}
          preload="metadata"
          aria-hidden="true"
          onError={() => setFailed(true)}
        >
          <source
            src={IMAGE.heroMotion}
            type="video/mp4"
            media="(prefers-reduced-motion: no-preference)"
          />
        </video>
      ) : null}
      <figcaption>
        Illustrative generated color study · replace with documented project photography
      </figcaption>
    </figure>
  );
}

function FieldNoteDialog({
  article,
  onClose,
}: {
  article: BlogArticle | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(article)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p13-article-dialog sm:max-w-[min(48rem,calc(100vw-2rem))]">
        {article ? (
          <>
            <DialogHeader>
              <p className="p13-dialog-kicker">PAINTER'S FIELD NOTE · {article.readTime}</p>
              <DialogTitle>{article.title}</DialogTitle>
              <DialogDescription>{article.intro}</DialogDescription>
            </DialogHeader>
            <div className="p13-article-body">
              {article.sections.map((section, index) => (
                <section key={section.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{section.title}</h3>
                    <p>{section.body}</p>
                  </div>
                </section>
              ))}
            </div>
            <p className="p13-dialog-note">
              General planning guidance. Confirm actual products, site conditions, and written scope
              with your painter.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function PainterThirteenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle;
  const heroSub =
    text?.heroSub ??
    "Painting for the rooms and facades you live with every day, planned from surface condition through preparation, protection, coats, and the final finish.";
  const introTitle = text?.introTitle ?? "A home is more than one painted surface.";
  const introBody =
    text?.introBody ??
    "We treat a home as a collection of neighboring surfaces, not one broad bucket of paint. That makes it easier to see where an arch, shutter, cabinet, threshold, or door deserves a different finish.";
  const servicesHeading = text?.servicesHeading ?? "The surfaces that make a home feel composed.";
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? "Same facade. A new color direction.";
  const proofBody =
    text?.proofBody ??
    "One reference-edited study keeps the home, camera, architecture, planting, and light in place. The paint changes only, so the color decision stays readable.";
  const methodTitle = text?.methodTitle ?? "A beautiful finish starts long before the final coat.";
  const planHeading = text?.planHeading ?? "Good color sits beside the life already in the room.";
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const notesHeading = text?.notesHeading ?? "Field notes for a finish that holds up.";
  const notesIntro =
    text?.notesIntro ??
    "Practical painter guidance on color, preparation, and finish choices before project day.";
  const reviewsHeading = text?.reviewsHeading ?? "Review copy examples.";
  const reviewsBody =
    text?.reviewsBody ??
    "Three draft homeowner voices show how verified feedback can speak to planning, care, and finish as much as color.";
  const faqTitle = text?.faqTitle ?? "Ask before the first coat.";
  const estimateTitle = text?.estimateTitle ?? "Bring the house. We will bring the color cards.";
  const estimateIntro =
    text?.estimateIntro ??
    "Start with the surfaces that need attention, the conditions that affect them, and the look you want to live with.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? PHONE_LABEL;
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : PHONE_HREF;
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "TRUE COAT";
  const brandMark = brandName
    ? brandName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0]!.toUpperCase())
        .join("")
        .slice(0, 2)
    : "TC";
  const brandAria = brandName ? `${brandName} home` : "True Coat Blueberry Gelato home";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const callAria = `Call ${brandName ?? "True Coat"} at ${phoneLabel}`;
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<BlogArticle | null>(null);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const articleTriggerRef = useRef<HTMLButtonElement>(null);

  function openBooking(event: React.MouseEvent<HTMLButtonElement>) {
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  }

  return (
    <div className="p13" id="top">
      <a className="p13-skip" href="#p13-main">
        Skip to content
      </a>

      <header className="p13-header">
        <a className="p13-brand" href="#top" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <strong className="overlay-brand-name">{brandLabel}</strong>
          <small>CASA DEL COLORE</small>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#services">Services</a>
          <a href="#proof">Paint study</a>
          <a href="#notes">Field notes</a>
        </nav>
        <a className="p13-phone" href={phoneHref} aria-label={callAria} data-tkey="contact.phone">
          <Phone aria-hidden="true" />
          <span>{phoneLabel}</span>
        </a>
      </header>

      <main id="p13-main" tabIndex={-1}>
        <section className="p13-hero" aria-labelledby="p13-title">
          <HeroFilm poster={heroPoster} />
          <div className="p13-hero-copy">
            <p className="p13-eyebrow">RESIDENTIAL PAINTING · CONSIDERED COLOR</p>
            <h1 id="p13-title" data-tkey="text.heroTitle">
              {heroTitle ?? (
                <>
                  Color with a finish worth <em>lingering</em> over.
                </>
              )}
            </h1>
            <p data-tkey="text.heroSub">{heroSub}</p>
            <div className="p13-hero-actions">
              <button type="button" className="p13-button p13-button--cherry" onClick={openBooking}>
                Plan a color visit <ArrowUpRight aria-hidden="true" />
              </button>
              <a href="#services" className="p13-text-link">
                See what we paint <ArrowDownRight aria-hidden="true" />
              </a>
            </div>
            <p className="p13-place">
              <MapPin aria-hidden="true" /> Serving the neighborhood and nearby streets
            </p>
          </div>
          <ol className="p13-hero-scoops" aria-label="Blueberry Gelato color palette">
            <li data-flavor="blueberry">BLUEBERRY</li>
            <li data-flavor="pistachio">PISTACHIO</li>
            <li data-flavor="peach">PEACH</li>
            <li data-flavor="cream">CREAM</li>
          </ol>
        </section>

        <section className="p13-intro" aria-labelledby="p13-intro-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "introImage", IMAGE.flavorWall)}
              alt="Illustrative architectural color study of painted Mediterranean arches"
              sizes="(max-width: 760px) 100vw, 72vw"
              tkey="media.introImage"
            />
          </figure>
          <div>
            <p className="p13-eyebrow">A POINT OF VIEW</p>
            <h2 id="p13-intro-title" data-tkey="text.introTitle">
              {introTitle}
            </h2>
            <p data-tkey="text.introBody">{introBody}</p>
            <p className="p13-intro-note">
              <span>COLOR · FINISH · PREP</span> Chosen in the real light, then written into the
              scope.
            </p>
          </div>
        </section>

        <section className="p13-services" id="services" aria-labelledby="p13-services-title">
          <div className="p13-services-heading">
            <p className="p13-eyebrow">SURFACES WE PAINT</p>
            <div>
              <h2 id="p13-services-title" data-tkey="text.servicesHeading">
                {servicesHeading}
              </h2>
            </div>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div className="p13-service-grid">
            {services.map((service, index) => (
              <article key={service.number} className="p13-service-card">
                <TemplateImage
                  src={overlayMediaUrl(content, `serviceImage${index + 1}`, service.image)}
                  alt={service.alt}
                  tkey={`media.serviceImage${index + 1}`}
                />
                <div className="p13-service-label">
                  <span>{service.number}</span>
                  <p>{service.flavor}</p>
                </div>
                <div className="p13-service-copy">
                  <small>{service.detail}</small>
                  <h3>{service.title}</h3>
                  <p>{service.text}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="p13-ceramic-strip">
            <TemplateImage
              src={overlayMediaUrl(content, "ceramicImage", IMAGE.ceramic)}
              alt="Illustrative close study of blueberry plaster, ceramic tile, and terrazzo"
              tkey="media.ceramicImage"
            />
            <p>
              <span>HAND PREPPED</span>
              <span>2 COATS</span>
              <span>FINISH CHECKED IN REAL LIGHT</span>
            </p>
          </div>
        </section>

        <section className="p13-proof" id="proof" aria-labelledby="p13-proof-title">
          <div className="p13-proof-heading">
            <p className="p13-eyebrow">PAINT-ONLY STUDY</p>
            <div>
              <h2 id="p13-proof-title" data-tkey="text.proofTitle">
                {proofTitle}
              </h2>
            </div>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div
            className="p13-proof-pair"
            role="group"
            aria-label="Illustrative matched paint-only facade comparison"
          >
            <figure>
              <TemplateImage
                src={IMAGE.before}
                alt="Illustrative Mediterranean bungalow before the paint-only color study"
              />
              <figcaption>
                <span>BEFORE</span> Existing condition
              </figcaption>
            </figure>
            <figure>
              <TemplateImage
                src={IMAGE.after}
                alt="Illustrative same Mediterranean bungalow after the blueberry and pistachio paint proposal"
              />
              <figcaption>
                <span>AFTER</span> Blueberry + pistachio proposal
              </figcaption>
            </figure>
          </div>
          <p className="p13-proof-note">
            Illustrative generated matched-scene study, not a documented client transformation.
            Replace with permissioned project photography before publishing.
          </p>
        </section>

        <section className="p13-method" aria-labelledby="p13-method-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "processImage", IMAGE.process)}
              alt="Illustrative professional painters masking and preparing an interior arch before painting"
              sizes="100vw"
              tkey="media.processImage"
            />
          </figure>
          <div className="p13-method-intro">
            <p className="p13-eyebrow">HOW WE WORK</p>
            <h2 id="p13-method-title" data-tkey="text.methodTitle">
              {methodTitle}
            </h2>
            <p>{PAINTER_SECTION_COPY.processIntro}</p>
          </div>
          <ol>
            {PAINTER_PROCESS.map((step, index) => (
              <li key={step.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="p13-planning" aria-labelledby="p13-planning-title">
          <div className="p13-planning-copy">
            <p className="p13-eyebrow">A GOOD ORDER</p>
            <h2 id="p13-planning-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <div>
              {PAINTER_PLANNING_NOTES.map((note, index) => (
                <article key={note.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{note.label}</p>
                  <h3>{note.title}</h3>
                </article>
              ))}
            </div>
          </div>
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
              alt="Illustrative top-down terrazzo color-planning table with paint swatches, brushes, roller, tape, and ceramic fragments"
              tkey="media.planningImage"
            />
            <figcaption>
              Color test: two coats on a movable sample, viewed through the day.
            </figcaption>
          </figure>
        </section>

        <section className="p13-notes" id="notes" aria-labelledby="p13-notes-title">
          <div className="p13-notes-heading">
            <p className="p13-eyebrow">FROM THE PAINT TABLE</p>
            <div>
              <h2 id="p13-notes-title" data-tkey="text.notesHeading">
                {notesHeading}
              </h2>
            </div>
            <p data-tkey="text.notesIntro">{notesIntro}</p>
          </div>
          <div className="p13-note-grid">
            {blogArticles.map((article, index) => {
              const overlayPost = content?.blogs?.[index];
              const category = overlayPost?.category ?? article.category;
              const title = overlayPost?.title ?? article.title;
              const excerpt = overlayPost?.excerpt ?? article.excerpt;
              return (
                <article key={article.number}>
                  <TemplateImage
                    src={overlayMediaUrl(content, `guideImage${index + 1}`, IMAGE.guides[index])}
                    alt={`Illustrative ${article.category.toLowerCase()} paint planning study`}
                    tkey={`media.guideImage${index + 1}`}
                  />
                  <div>
                    <p data-tkey={`blogs.${index}.category`}>
                      {article.number} · {category}
                    </p>
                    <h3 data-tkey={`blogs.${index}.title`}>{title}</h3>
                    <span data-tkey={`blogs.${index}.excerpt`}>{excerpt}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        articleTriggerRef.current = event.currentTarget;
                        setSelectedArticle(withOverlayBlogPost(article, overlayPost));
                      }}
                    >
                      Read the field note <ArrowUpRight aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="p13-notes-disclosure">
            Educational sample guides in a fictional template. Add published article links and
            verified business guidance before launch.
          </p>
        </section>

        <section className="p13-reviews" aria-labelledby="p13-reviews-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              alt="Illustrative painter and homeowners reviewing a completed blueberry exterior finish"
              sizes="(max-width: 760px) 100vw, 60vw"
              tkey="media.reviewsImage"
            />
          </figure>
          <div className="p13-reviews-copy">
            <p className="p13-eyebrow">{overlayReviews ? "Reviews" : "REVIEW COPY EXAMPLES"}</p>
            <h2 id="p13-reviews-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <div className="p13-review-grid">
                {overlayReviews.map((review, index) => (
                  <blockquote key={`${review.author}-${index}`}>
                    <Quote aria-hidden="true" />
                    <p data-tkey={`reviews.${index}.quote`}>“{review.quote}”</p>
                    <footer>
                      <strong data-tkey={`reviews.${index}.author`}>{review.author}</strong>
                    </footer>
                  </blockquote>
                ))}
              </div>
            ) : overlayReviews ? null : (
              <>
                <div className="p13-review-grid">
                  {reviewExamples.map((review) => (
                    <blockquote key={review.name}>
                      <Quote aria-hidden="true" />
                      <p>“{review.quote}”</p>
                      <footer>
                        <strong>{review.name}</strong>
                        <span>{review.project}</span>
                        <small>{review.source}</small>
                      </footer>
                    </blockquote>
                  ))}
                </div>
                <div className="p13-source-badges" aria-label="Future review source placements">
                  <span aria-label="Google-style review card example">
                    <img
                      src="/templates/garden-delite/brands/google.svg"
                      width={66}
                      height={24}
                      alt=""
                    />
                    <b>Sample</b>
                    Google-style card
                  </span>
                  <span aria-label="Yelp-style review card example">
                    <img
                      src="/templates/garden-delite/brands/yelp.svg"
                      width={66}
                      height={24}
                      alt=""
                    />
                    <b>Sample</b>
                    Yelp-style card
                  </span>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="p13-faq" aria-labelledby="p13-faq-title">
          <div>
            <p className="p13-eyebrow">QUESTIONS BEFORE PAINT DAY</p>
            <h2 id="p13-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div className="p13-faq-list">
              {PAINTER_FAQS.map(([question, answer], index) => (
                <details key={question} open={index === 0}>
                  <summary>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{question}</b>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "faqImage", IMAGE.faq)}
              alt="Illustrative indoor consultation between a painter and homeowner with paint samples"
              tkey="media.faqImage"
            />
            <figcaption>Bring the room, the materials, the light, and every question.</figcaption>
          </figure>
        </section>

        <section className="p13-estimate" id="estimate" aria-labelledby="p13-estimate-title">
          <TemplateImage
            src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
            alt="Illustrative painter and homeowner discussing colors at a Mediterranean-revival home"
            sizes="100vw"
            tkey="media.estimateImage"
          />
          <div className="p13-estimate-card">
            <p className="p13-eyebrow">YOUR NEXT STEP</p>
            <h2 id="p13-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <p className="p13-estimate-empty" data-tkey="text.estimateIntro">
              {estimateIntro}
            </p>
            <ul>
              {PAINTER_ESTIMATE_ITEMS.slice(0, 4).map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <button type="button" className="p13-button p13-button--cherry" onClick={openBooking}>
              Plan a color visit <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      <footer className="p13-footer">
        <div className="p13-footer-brand">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <div>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <span>BLUEBERRY GELATO</span>
          </div>
        </div>
        <p>Residential interiors · exteriors · cabinets · trim + doors</p>
        <div>
          <a href={phoneHref} data-tkey="contact.phone">
            {phoneLabel}
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {emailLabel}
          </a>
        </div>
        <small>
          Fictional True Coat painter template. Generated illustrative media and review copy
          examples; replace business details, media, and customer feedback before publishing.
        </small>
      </footer>

      <FieldNoteDialog
        article={selectedArticle}
        onClose={() => {
          setSelectedArticle(null);
          requestAnimationFrame(() => articleTriggerRef.current?.focus());
        }}
      />
      <SiteBookingPayDemo
        open={bookingOpen}
        onOpenChange={(open) => {
          setBookingOpen(open);
          if (!open) requestAnimationFrame(() => bookingTriggerRef.current?.focus());
        }}
        isDemoPitch={true}
        demoWording="walkthrough"
      />
    </div>
  );
}
