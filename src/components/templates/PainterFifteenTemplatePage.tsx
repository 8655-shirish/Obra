import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  MapPin,
  Phone,
  Quote,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

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
  PAINTER_BLOG_POSTS,
  PAINTER_ESTIMATE_ITEMS,
  PAINTER_FAQS,
  PAINTER_PLANNING_NOTES,
  PAINTER_PROCESS,
  PAINTER_SECTION_COPY,
  PAINTER_SERVICES,
  PAINTER_SURFACE_COPY,
} from "./painter-shared-copy";

import "./overlay-fit.css";
import "./painter-fifteen/painter-fifteen.css";

const MEDIA = "/templates/moroccan-zellige/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const IMAGE = {
  hero: `${MEDIA}/hero.jpg`,
  heroMotion: `${MEDIA}/hero-motion.mp4`,
  courtyard: `${MEDIA}/courtyard.jpg`,
  interior: `${MEDIA}/service-interior.jpg`,
  exterior: `${MEDIA}/service-exterior.jpg`,
  cabinets: `${MEDIA}/service-cabinets.jpg`,
  doors: `${MEDIA}/service-doors.jpg`,
  detail: `${MEDIA}/zellige-detail.jpg`,
  before: `${MEDIA}/proof-before.jpg`,
  after: `${MEDIA}/proof-after.jpg`,
  process: `${MEDIA}/process.jpg`,
  planningWall: `${MEDIA}/planning-wall.jpg`,
  notesWall: `${MEDIA}/notes-wall.jpg`,
  reviews: `${MEDIA}/reviews.jpg`,
  faq: `${MEDIA}/faq.jpg`,
  estimate: `${MEDIA}/estimate.jpg`,
  guides: [`${MEDIA}/guide-color.jpg`, `${MEDIA}/guide-prep.jpg`, `${MEDIA}/guide-sheen.jpg`],
} as const;

const services = [
  {
    number: "01",
    title: PAINTER_SERVICES[0].title,
    detail: "Walls · ceilings · arches",
    text: PAINTER_SERVICES[0].text,
    image: IMAGE.interior,
    alt: "Illustrative painter rolling a deep emerald interior wall in a protected riad-inspired room",
  },
  {
    number: "02",
    title: PAINTER_SERVICES[1].title,
    detail: "Stucco · trim · shutters",
    text: PAINTER_SERVICES[1].text,
    image: IMAGE.exterior,
    alt: "Illustrative painter working on a riad-inspired exterior with emerald shutters and saffron trim",
  },
  {
    number: "03",
    title: PAINTER_SERVICES[2].title,
    detail: "Doors · frames · cure time",
    text: PAINTER_SERVICES[2].text,
    image: IMAGE.cabinets,
    alt: "Illustrative painter refinishing deep emerald kitchen cabinets beside lapis zellige tile",
  },
  {
    number: "04",
    title: "Trim & doors",
    detail: "Edges · enamel · joinery",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.doors,
    alt: "Illustrative painter applying aubergine enamel to a carved residential door",
  },
] as const;

const starTiles = new Set([
  4, 12, 13, 14, 20, 21, 22, 23, 24, 28, 29, 30, 31, 32, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
  47, 48, 49, 50, 51, 52, 58, 59, 60, 61, 62, 68, 69, 70, 76,
]);
const mosaicTiles = Array.from({ length: 81 }, (_, index) => index);

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
    ...PAINTER_BLOG_POSTS[0],
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
    ...PAINTER_BLOG_POSTS[1],
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
    ...PAINTER_BLOG_POSTS[2],
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
  sizes = "(max-width: 760px) 100vw, 55vw",
  className,
  tkey,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  sizes?: string;
  className?: string;
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
    <figure className="p15-hero-film">
      <TemplateImage
        src={poster}
        alt="Illustrative riad-inspired courtyard facade with a lapis zellige mosaic wall and deep painted architectural finishes"
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
        Illustrative generated finish study · replace with documented project photography
      </figcaption>
    </figure>
  );
}

function MosaicMark() {
  return (
    <div className="p15-hero-mark" aria-hidden="true">
      {mosaicTiles.map((tile) => (
        <span
          key={tile}
          className={starTiles.has(tile) ? "p15-mark-tile p15-mark-tile--star" : "p15-mark-tile"}
          style={
            {
              "--tile-delay": `${tile * 16}ms`,
              "--tile-x": `${((tile % 9) - 4) * 0.75}rem`,
              "--tile-y": `${(Math.floor(tile / 9) - 4) * 0.75}rem`,
            } as CSSProperties
          }
        />
      ))}
    </div>
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
      <DialogContent className="p15-article-dialog sm:max-w-[min(48rem,calc(100vw-2rem))]">
        {article ? (
          <>
            <DialogHeader>
              <p className="p15-dialog-kicker">Field note · {article.readTime}</p>
              <DialogTitle>{article.title}</DialogTitle>
              <DialogDescription>{article.intro}</DialogDescription>
            </DialogHeader>
            <div className="p15-article-body">
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
            <p className="p15-dialog-note">
              General planning guidance. Confirm actual products, site conditions, and written scope
              with your painter.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function PainterFifteenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle;
  const heroSub =
    text?.heroSub ??
    "A deliberate painting plan for the rooms, facades, doors, and details that give a home its rhythm. We begin with the condition beneath the color.";
  const courtyardTitle = text?.courtyardTitle ?? "Color has an address.";
  const courtyardBody =
    text?.courtyardBody ??
    "We look at the plaster, joinery, light, tile, and surrounding rooms before choosing a color. The result is a finish that belongs to the architecture instead of sitting on top of it.";
  const servicesHeading = text?.servicesHeading ?? "A finish plan for every threshold.";
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? "Same walls. A more intentional arrival.";
  const proofBody =
    text?.proofBody ??
    "This matched study keeps the property, camera, architecture, planting, and light in place. Paint changes only, so a color direction can be evaluated without pretending it is a remodel.";
  const processTitle = text?.processTitle ?? "The work beneath the color is the work that lasts.";
  const planHeading = text?.planHeading ?? "Good color sits beside the life already in the room.";
  const notesHeading = text?.notesHeading ?? "Field notes for a finish that holds up.";
  const notesIntro =
    text?.notesIntro ??
    "Practical painter guidance on color, preparation, and finish choices before project day.";
  const reviewsHeading = text?.reviewsHeading ?? "Feedback deserves the same care as the finish.";
  const reviewsBody =
    text?.reviewsBody ??
    "These fictional homeowner voices show how verified feedback can describe planning, protection, and finished details without making claims this template cannot prove.";
  const faqTitle = text?.faqTitle ?? "Ask before the first coat.";
  const estimateTitle = text?.estimateTitle ?? "Let the house tell us where to start.";
  const estimateIntro =
    text?.estimateIntro ??
    "Begin with the surfaces that need attention, the condition beneath them, and the way you want each room to feel when the work is complete.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? PHONE_LABEL;
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : PHONE_HREF;
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "True Coat";
  const brandAria = brandName ? `${brandName} home` : "True Coat Moroccan Zellige home";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const mosaicAria = brandName
    ? `Animated mosaic mark for ${brandName}`
    : "Animated mosaic mark for True Coat";
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
    <div className="p15" id="top">
      <a className="p15-skip" href="#p15-main">
        Skip to content
      </a>

      <header className="p15-header">
        <a className="p15-brand" href="#top" aria-label={brandAria}>
          <span
            className={logoUrl ? "overlay-brand-mark" : "p15-brand-star overlay-brand-mark"}
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? <img src={logoUrl} alt="" /> : <i />}
          </span>
          <span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <small>Atelier des surfaces</small>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#services">Services</a>
          <a href="#proof">Paint study</a>
          <a href="#notes">Field notes</a>
        </nav>
        <a className="p15-phone" href={phoneHref} aria-label={callAria} data-tkey="contact.phone">
          <Phone aria-hidden="true" />
          <span>{phoneLabel}</span>
        </a>
      </header>

      <main id="p15-main" tabIndex={-1}>
        <section className="p15-hero" aria-labelledby="p15-title">
          <HeroFilm poster={heroPoster} />
          <div className="p15-hero-copy p15-tile-surface">
            <p className="p15-kicker">Residential painting with an architectural eye</p>
            <h1 id="p15-title" data-tkey="text.heroTitle">
              {heroTitle ?? (
                <>
                  Make every surface part of the <em>courtyard.</em>
                </>
              )}
            </h1>
            <p data-tkey="text.heroSub">{heroSub}</p>
            <div className="p15-hero-actions">
              <button type="button" className="p15-button" onClick={openBooking}>
                Plan a color visit <ArrowUpRight aria-hidden="true" />
              </button>
              <a href="#services" className="p15-quiet-link">
                See painted passages <ArrowDownRight aria-hidden="true" />
              </a>
            </div>
            <p className="p15-service-area">
              <MapPin aria-hidden="true" /> Serving the neighborhood and nearby streets
            </p>
          </div>
          <div className="p15-hero-mosaic" aria-label={mosaicAria}>
            <MosaicMark />
            <p>Tiles settle into the {brandLabel} mark.</p>
          </div>
        </section>

        <section className="p15-courtyard" aria-labelledby="p15-courtyard-title">
          <div className="p15-courtyard-copy">
            <p className="p15-kicker">A point of view</p>
            <h2 id="p15-courtyard-title" data-tkey="text.courtyardTitle">
              {courtyardTitle}
            </h2>
            <p data-tkey="text.courtyardBody">{courtyardBody}</p>
            <p className="p15-courtyard-note">Surface · light · material · finish</p>
          </div>
          <figure className="p15-courtyard-image p15-arch-frame">
            <TemplateImage
              src={overlayMediaUrl(content, "courtyardImage", IMAGE.courtyard)}
              alt="Illustrative riad-inspired residential courtyard with painted arches, glazed lapis tile, and emerald shutters"
              sizes="(max-width: 800px) 100vw, 65vw"
              tkey="media.courtyardImage"
            />
            <figcaption>Paint decisions are reviewed beside the materials that stay.</figcaption>
          </figure>
          <figure className="p15-detail-image">
            <TemplateImage
              src={overlayMediaUrl(content, "detailImage", IMAGE.detail)}
              alt="Illustrative close study of hand-cut lapis and ivory zellige meeting emerald painted plaster and brass"
              sizes="(max-width: 800px) 55vw, 25vw"
              tkey="media.detailImage"
            />
          </figure>
        </section>

        <section className="p15-services" id="services" aria-labelledby="p15-services-title">
          <div className="p15-section-heading">
            <p className="p15-kicker">Painted passages</p>
            <h2 id="p15-services-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div className="p15-service-grid">
            {services.map((service, index) => (
              <article key={service.number} className="p15-service-card p15-tile-surface">
                <figure>
                  <TemplateImage
                    src={overlayMediaUrl(content, `serviceImage${index + 1}`, service.image)}
                    alt={service.alt}
                    tkey={`media.serviceImage${index + 1}`}
                  />
                  <figcaption>
                    <span>{service.number}</span>
                    {service.detail}
                  </figcaption>
                </figure>
                <div>
                  <h3>{service.title}</h3>
                  <p>{service.text}</p>
                  <a href="#estimate">
                    Discuss the scope <ArrowDownRight aria-hidden="true" />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="p15-proof" id="proof" aria-labelledby="p15-proof-title">
          <figure className="p15-proof-backdrop" aria-hidden="true">
            <TemplateImage src={IMAGE.after} alt="" sizes="100vw" />
          </figure>
          <div className="p15-proof-copy">
            <p className="p15-kicker">Paint-only study</p>
            <h2 id="p15-proof-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div
            className="p15-proof-arches"
            role="group"
            aria-label="Illustrative matched paint-only facade comparison"
          >
            <figure className="p15-arch-frame">
              <TemplateImage
                src={IMAGE.before}
                alt="Illustrative riad-inspired facade before the paint-only color study"
              />
              <figcaption>
                <strong>Before</strong>
                Existing condition
              </figcaption>
            </figure>
            <figure className="p15-arch-frame">
              <TemplateImage
                src={IMAGE.after}
                alt="Illustrative same riad-inspired facade after the ivory, aubergine, emerald, lapis, and saffron paint proposal"
              />
              <figcaption>
                <strong>After</strong>
                Courtyard palette proposal
              </figcaption>
            </figure>
          </div>
          <p className="p15-proof-note">
            Illustrative generated matched-scene study, not a documented client transformation.
            Replace with permissioned project photography before publishing.
          </p>
        </section>

        <section className="p15-process" aria-labelledby="p15-process-title">
          <div className="p15-process-visual p15-arch-frame">
            <TemplateImage
              src={overlayMediaUrl(content, "processImage", IMAGE.process)}
              alt="Illustrative professional painters repairing and masking a limewashed interior arch before painting"
              sizes="(max-width: 800px) 100vw, 55vw"
              tkey="media.processImage"
            />
            <span aria-hidden="true">Finish follows preparation</span>
          </div>
          <div className="p15-process-copy">
            <p className="p15-kicker">The craft sequence</p>
            <h2 id="p15-process-title" data-tkey="text.processTitle">
              {processTitle}
            </h2>
            <p>{PAINTER_SECTION_COPY.processIntro}</p>
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
          </div>
        </section>

        <section className="p15-planning" aria-labelledby="p15-planning-title">
          <div className="p15-planning-heading">
            <p className="p15-kicker">A good order</p>
            <h2 id="p15-planning-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
          </div>
          <div className="p15-planning-stage">
            <figure className="p15-planning-image p15-arch-frame">
              <TemplateImage
                src={overlayMediaUrl(content, "planningImage", IMAGE.planningWall)}
                alt="Illustrative painter arranging painted samples beside zellige tile and carved wood in a residential courtyard"
                sizes="(max-width: 800px) 100vw, 70vw"
                tkey="media.planningImage"
              />
              <figcaption>
                Each color is reviewed with the surfaces and light that remain.
              </figcaption>
            </figure>
            <div className="p15-planning-grid">
              {PAINTER_PLANNING_NOTES.map((note, index) => (
                <article key={note.label} className="p15-tile-surface">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{note.label}</p>
                  <h3>{note.title}</h3>
                  <small>{note.text}</small>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="p15-notes" id="notes" aria-labelledby="p15-notes-title">
          <figure className="p15-notes-backdrop" aria-hidden="true">
            <TemplateImage
              src={overlayMediaUrl(content, "notesWall", IMAGE.notesWall)}
              alt=""
              sizes="100vw"
              tkey="media.notesWall"
            />
          </figure>
          <div className="p15-notes-heading">
            <p className="p15-kicker">From the paint table</p>
            <h2 id="p15-notes-title" data-tkey="text.notesHeading">
              {notesHeading}
            </h2>
            <p data-tkey="text.notesIntro">{notesIntro}</p>
          </div>
          <div className="p15-note-grid">
            {blogArticles.map((article, index) => {
              const overlayPost = content?.blogs?.[index];
              const category = overlayPost?.category ?? article.category;
              const title = overlayPost?.title ?? article.title;
              const excerpt = overlayPost?.excerpt ?? article.excerpt;
              return (
                <article key={article.number} className="p15-tile-surface">
                  <figure className="p15-arch-frame">
                    <TemplateImage
                      src={overlayMediaUrl(content, `guideImage${index + 1}`, IMAGE.guides[index])}
                      alt={`Illustrative ${article.category.toLowerCase()} paint planning study`}
                      tkey={`media.guideImage${index + 1}`}
                    />
                  </figure>
                  <div>
                    <p data-tkey={`blogs.${index}.category`}>{category}</p>
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
          <p className="p15-notes-disclosure">
            Educational sample guides in a fictional template. Add published article links and
            verified business guidance before launch.
          </p>
        </section>

        <section className="p15-reviews" aria-labelledby="p15-reviews-title">
          <figure className="p15-reviews-image p15-arch-frame">
            <TemplateImage
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              alt="Illustrative painter and homeowners reviewing a completed courtyard finish"
              sizes="(max-width: 800px) 100vw, 48vw"
              tkey="media.reviewsImage"
            />
          </figure>
          <div className="p15-reviews-copy">
            <p className="p15-kicker">{overlayReviews ? "Reviews" : "Review copy examples"}</p>
            <h2 id="p15-reviews-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <div className="p15-review-grid">
                {overlayReviews.map((review, index) => (
                  <blockquote key={`${review.author}-${index}`} className="p15-tile-surface">
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
                <div className="p15-review-grid">
                  {reviewExamples.map((review) => (
                    <blockquote key={review.name} className="p15-tile-surface">
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
                <div className="p15-source-badges" aria-label="Future review source placements">
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

        <section className="p15-faq" aria-labelledby="p15-faq-title">
          <div className="p15-faq-copy">
            <p className="p15-kicker">Questions before paint day</p>
            <h2 id="p15-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div className="p15-faq-list">
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
          <figure className="p15-faq-image p15-arch-frame">
            <TemplateImage
              src={overlayMediaUrl(content, "faqImage", IMAGE.faq)}
              alt="Illustrative interior consultation between a painter and homeowner with paint samples"
              sizes="(max-width: 800px) 100vw, 45vw"
              tkey="media.faqImage"
            />
            <figcaption>Bring the room, materials, light, and every question.</figcaption>
          </figure>
        </section>

        <section className="p15-estimate" id="estimate" aria-labelledby="p15-estimate-title">
          <TemplateImage
            src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
            alt="Illustrative painter and homeowner discussing colors at a riad-inspired courtyard home"
            sizes="100vw"
            tkey="media.estimateImage"
          />
          <div className="p15-estimate-card p15-tile-surface">
            <p className="p15-kicker">Your next step</p>
            <h2 id="p15-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <p data-tkey="text.estimateIntro">{estimateIntro}</p>
            <ul>
              {PAINTER_ESTIMATE_ITEMS.slice(0, 4).map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <button type="button" className="p15-button" onClick={openBooking}>
              Plan a color visit <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      <footer className="p15-footer">
        <div className="p15-footer-brand">
          <span
            className={logoUrl ? "overlay-brand-mark" : "p15-brand-star overlay-brand-mark"}
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? <img src={logoUrl} alt="" /> : <i />}
          </span>
          <div>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <span>Moroccan Zellige</span>
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
