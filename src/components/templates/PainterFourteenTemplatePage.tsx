import { ArrowDown, ArrowUpRight, Check, ChevronDown, Phone, Quote } from "lucide-react";
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
import "./painter-fourteen/painter-fourteen.css";

const MEDIA = "/templates/juice-bar-renovation/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const IMAGE = {
  hero: `${MEDIA}/hero.jpg`,
  heroMotion: `${MEDIA}/hero-motion.mp4`,
  pointOfView: `${MEDIA}/point-of-view.jpg`,
  interior: `${MEDIA}/service-interior.jpg`,
  exterior: `${MEDIA}/service-exterior.jpg`,
  cabinets: `${MEDIA}/service-cabinets.jpg`,
  doors: `${MEDIA}/service-doors.jpg`,
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
    label: "Flavor: Coconut",
    title: PAINTER_SERVICES[0].title,
    text: PAINTER_SERVICES[0].text,
    detail: "Finish: Eggshell / Coverage: Room by room",
    image: IMAGE.interior,
    alt: "Illustrative painter rolling a grape-purple living room wall with protected colorful finishes",
  },
  {
    number: "02",
    label: "Flavor: Papaya",
    title: PAINTER_SERVICES[1].title,
    text: PAINTER_SERVICES[1].text,
    detail: "Finish: Low lustre / Coverage: Exteriors",
    image: IMAGE.exterior,
    alt: "Illustrative painter working on a colorful 1980s-inspired stucco home exterior",
  },
  {
    number: "03",
    label: "Flavor: Kiwi",
    title: PAINTER_SERVICES[2].title,
    text: PAINTER_SERVICES[2].text,
    detail: "Finish: Cabinet system / Coverage: Doors and frames",
    image: IMAGE.cabinets,
    alt: "Illustrative painter refinishing kiwi-green kitchen cabinet frames in a protected interior",
  },
  {
    number: "04",
    label: "Flavor: Dragon fruit",
    title: "Trim & doors",
    text: PAINTER_SURFACE_COPY.trim,
    detail: "Finish: Enamel / Coverage: Crisp edges",
    image: IMAGE.doors,
    alt: "Illustrative glossy dragon-fruit-pink residential door with clean bright trim",
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
  sizes = "(max-width: 800px) 100vw, 65vw",
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
    <figure className="p14-hero-film">
      <TemplateImage
        src={poster}
        alt="Illustrative colorful kitchen with electric-teal tile, kiwi cabinets, and bold painted architectural forms"
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

function FieldNoteDialog({
  article,
  onClose,
}: {
  article: BlogArticle | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(article)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p14-article-dialog sm:max-w-[min(48rem,calc(100vw-2rem))]">
        {article ? (
          <>
            <DialogHeader>
              <p className="p14-dialog-kicker">PAINT TABLE NOTE · {article.readTime}</p>
              <DialogTitle>{article.title}</DialogTitle>
              <DialogDescription>{article.intro}</DialogDescription>
            </DialogHeader>
            <div className="p14-article-body">
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
            <p className="p14-dialog-note">
              General planning guidance. Confirm actual products, site conditions, and written scope
              with your painter.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function PainterFourteenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle;
  const heroSub =
    text?.heroSub ??
    "Confident residential painting for walls, cabinets, doors, trim, and exteriors, with the condition, protection, coating, and finish standard written into the plan.";
  const povTitle = text?.povTitle ?? "Color is better when the surface can keep up.";
  const povBody =
    text?.povBody ??
    "High-energy color still asks for disciplined preparation. We start with the existing coating, repair needs, light, access, and how the surface will be used.";
  const servicesHeading = text?.servicesHeading ?? "A bright finish for the real places you use.";
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? "Same house. Fresh squeeze of color.";
  const proofBody =
    text?.proofBody ??
    "The property, camera, structure, path, planting, and light stay fixed. This illustrative study changes paint only so the choice is clear.";
  const processTitle =
    text?.processTitle ?? "The bright part only works because the boring part is careful.";
  const planHeading = text?.planHeading ?? "The best color call happens before the can opens.";
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const notesHeading = text?.notesHeading ?? "Fresh guidance before project day.";
  const notesIntro =
    text?.notesIntro ??
    "Practical painter guidance on color, preparation, and finish choices that hold up after the project.";
  const reviewsHeading = text?.reviewsHeading ?? "Good paint makes room for good feedback.";
  const reviewsBody =
    text?.reviewsBody ??
    "Three draft homeowner voices show how verified feedback can speak to planning, care, and finish as much as color.";
  const faqTitle = text?.faqTitle ?? "Questions are part of a good color plan.";
  const estimateTitle = text?.estimateTitle ?? "Bring the project. We will bring a clear plan.";
  const estimateIntro =
    text?.estimateIntro ??
    "Share the rooms or elevations, current condition, access, timing, and color goals. The next useful step is a site visit and written scope.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? PHONE_LABEL;
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : PHONE_HREF;
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "True Coat";
  const brandMark = brandName
    ? brandName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0]!.toUpperCase())
        .join("")
        .slice(0, 2)
    : "TC";
  const brandAria = brandName ? `${brandName} home` : "True Coat Juice Bar Renovation home";
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
    <div className="p14" id="top">
      <a className="p14-skip" href="#p14-main">
        Skip to content
      </a>

      <header className="p14-header">
        <a className="p14-brand" href="#top" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <strong className="overlay-brand-name">{brandLabel}</strong>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#services">Services</a>
          <a href="#proof">Proof</a>
          <a href="#notes">Notes</a>
        </nav>
        <a className="p14-call" href={phoneHref} aria-label={callAria} data-tkey="contact.phone">
          <Phone aria-hidden="true" />
          <span>{phoneLabel}</span>
        </a>
      </header>

      <main id="p14-main" tabIndex={-1}>
        <section className="p14-hero" aria-labelledby="p14-title">
          <HeroFilm poster={heroPoster} />
          <div className="p14-hero-copy">
            <p className="p14-kicker">Residential painting / Fresh color, clear scope</p>
            <h1 id="p14-title" data-tkey="text.heroTitle">
              {heroTitle ?? (
                <>
                  Fresh color.<span>Careful finish.</span>
                </>
              )}
            </h1>
            <p data-tkey="text.heroSub">{heroSub}</p>
            <div className="p14-hero-actions">
              <button type="button" className="p14-button" onClick={openBooking}>
                Plan a color visit <ArrowUpRight aria-hidden="true" />
              </button>
              <a href="#services" className="p14-down-link">
                See what we paint <ArrowDown aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section className="p14-pov" aria-labelledby="p14-pov-title">
          <figure className="p14-pov-main">
            <TemplateImage
              src={overlayMediaUrl(content, "povImage", IMAGE.pointOfView)}
              alt="Illustrative close study of electric-teal tile, kiwi-green cabinet finish, and papaya paint"
              sizes="(max-width: 800px) 100vw, 60vw"
              tkey="media.povImage"
            />
          </figure>
          <div className="p14-pov-copy">
            <p className="p14-kicker">The finish bar / 01</p>
            <h2 id="p14-pov-title" data-tkey="text.povTitle">
              {povTitle}
            </h2>
            <p data-tkey="text.povBody">{povBody}</p>
            <p className="p14-detail-line">Glossy tile / Acrylic / Chrome / Wet-paint sheen</p>
          </div>
        </section>

        <section className="p14-services" id="services" aria-labelledby="p14-services-title">
          <div className="p14-services-head">
            <p className="p14-kicker">What we paint / 02</p>
            <h2 id="p14-services-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div className="p14-service-list">
            {services.map((service, index) => (
              <article key={service.number} className="p14-service">
                <figure>
                  <TemplateImage
                    src={overlayMediaUrl(content, `serviceImage${index + 1}`, service.image)}
                    alt={service.alt}
                    tkey={`media.serviceImage${index + 1}`}
                  />
                  <figcaption>{service.number}</figcaption>
                </figure>
                <div>
                  <p>{service.label}</p>
                  <h3>{service.title}</h3>
                  <span>{service.detail}</span>
                  <p>{service.text}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="p14-proof" id="proof" aria-labelledby="p14-proof-title">
          <div className="p14-proof-copy">
            <p className="p14-kicker">Paint-only study / 03</p>
            <h2 id="p14-proof-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div
            className="p14-proof-pair"
            role="group"
            aria-label="Illustrative paint-only facade comparison"
          >
            <figure>
              <TemplateImage
                src={IMAGE.before}
                alt="Illustrative 1980s home before the paint-only color study"
              />
              <figcaption>Before / Existing condition</figcaption>
            </figure>
            <figure>
              <TemplateImage
                src={IMAGE.after}
                alt="Illustrative same 1980s home after the tropical paint proposal"
              />
              <figcaption>After / Coconut, teal, and grape</figcaption>
            </figure>
          </div>
          <p className="p14-proof-note">
            Illustrative generated matched-scene study, not a documented client transformation.
            Replace with permissioned project photography before publishing.
          </p>
        </section>

        <section className="p14-process" aria-labelledby="p14-process-title">
          <figure className="p14-process-image">
            <TemplateImage
              src={overlayMediaUrl(content, "processImage", IMAGE.process)}
              alt="Illustrative professional painters preparing and protecting a bright interior before coating"
              sizes="(max-width: 760px) 100vw, 48vw"
              tkey="media.processImage"
            />
          </figure>
          <div className="p14-process-body">
            <div className="p14-process-head">
              <p className="p14-kicker">How we work / 04</p>
              <h2 id="p14-process-title" data-tkey="text.processTitle">
                {processTitle}
              </h2>
              <p>{PAINTER_SECTION_COPY.processIntro}</p>
            </div>
            <ol>
              {PAINTER_PROCESS.map((step, index) => (
                <li key={step.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="p14-plan" aria-labelledby="p14-plan-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
              alt="Illustrative overhead color planning table with tropical paint swatches, tools, acrylic, and chrome"
              sizes="(max-width: 800px) 100vw, 58vw"
              tkey="media.planningImage"
            />
          </figure>
          <div className="p14-plan-copy">
            <p className="p14-kicker">Plan the finish / 05</p>
            <h2 id="p14-plan-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <div>
              {PAINTER_PLANNING_NOTES.map((note, index) => (
                <article key={note.label}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <p>{note.label}</p>
                    <h3>{note.title}</h3>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="p14-notes" id="notes" aria-labelledby="p14-notes-title">
          <div className="p14-notes-head">
            <p className="p14-kicker">Paint table notes / 06</p>
            <h2 id="p14-notes-title" data-tkey="text.notesHeading">
              {notesHeading}
            </h2>
            <p data-tkey="text.notesIntro">{notesIntro}</p>
          </div>
          <div className="p14-note-grid">
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
          <p className="p14-notes-disclosure">
            Educational sample guides in a fictional template. Add published article links and
            verified business guidance before launch.
          </p>
        </section>

        <section className="p14-reviews" aria-labelledby="p14-reviews-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              alt="Illustrative painter and homeowners reviewing a completed colorful kitchen"
              sizes="(max-width: 800px) 100vw, 54vw"
              tkey="media.reviewsImage"
            />
          </figure>
          <div className="p14-reviews-copy">
            <p className="p14-kicker">
              {overlayReviews ? "Reviews / 07" : "Review copy examples / 07"}
            </p>
            <h2 id="p14-reviews-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <div className="p14-review-list">
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
                <p className="p14-review-disclosure">
                  Review copy examples. Replace with real, permissioned feedback before publishing.
                </p>
                <div className="p14-review-list">
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
                <div className="p14-source-badges" aria-label="Future review source placements">
                  <span aria-label="Google-style review card example">
                    <img
                      src="/templates/garden-delite/brands/google.svg"
                      width={66}
                      height={24}
                      alt=""
                    />
                    <b>Sample</b> Google-style card
                  </span>
                  <span aria-label="Yelp-style review card example">
                    <img
                      src="/templates/garden-delite/brands/yelp.svg"
                      width={66}
                      height={24}
                      alt=""
                    />
                    <b>Sample</b> Yelp-style card
                  </span>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="p14-faq" aria-labelledby="p14-faq-title">
          <div className="p14-faq-copy">
            <p className="p14-kicker">Ask before paint day / 08</p>
            <h2 id="p14-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div>
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
              alt="Illustrative indoor consultation with a painter and homeowner comparing color samples"
              tkey="media.faqImage"
            />
            <figcaption>Bring the room, the light, the materials, and every question.</figcaption>
          </figure>
        </section>

        <section className="p14-estimate" aria-labelledby="p14-estimate-title">
          <figure className="p14-estimate-image">
            <TemplateImage
              src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
              alt="Illustrative painter and homeowner discussing a colorful exterior paint project"
              sizes="(max-width: 760px) 100vw, 48vw"
              tkey="media.estimateImage"
            />
          </figure>
          <div className="p14-estimate-copy">
            <p className="p14-kicker">Ready for a fresh start / 09</p>
            <h2 id="p14-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <p data-tkey="text.estimateIntro">{estimateIntro}</p>
            <ul>
              {PAINTER_ESTIMATE_ITEMS.slice(0, 4).map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>
            <button type="button" className="p14-button" onClick={openBooking}>
              Plan a color visit <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      <footer className="p14-footer">
        <div className="p14-footer-brand">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <div>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <span>Juice Bar Renovation</span>
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
