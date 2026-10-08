import { ArrowDown, ArrowUpRight, Check, ChevronDown, MapPin, Phone, Quote } from "lucide-react";
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
  PAINTER_BLOG_POSTS,
  PAINTER_ESTIMATE_ITEMS,
  PAINTER_FAQS,
  PAINTER_PLANNING_NOTES,
  PAINTER_SECTION_COPY,
  PAINTER_SERVICES,
  PAINTER_SURFACE_COPY,
} from "./painter-shared-copy";

import "./overlay-fit.css";
import "./painter-twelve/painter-twelve.css";

const MEDIA = "/templates/lemonade-stand/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const IMAGE = {
  hero: `${MEDIA}/hero.jpg`,
  heroMotion: `${MEDIA}/hero-motion.mp4`,
  street: `${MEDIA}/street.jpg`,
  interior: `${MEDIA}/service-interior.jpg`,
  cabinets: `${MEDIA}/service-cabinets.jpg`,
  trim: `${MEDIA}/service-trim.jpg`,
  process: `${MEDIA}/process.jpg`,
  planning: `${MEDIA}/planning.jpg`,
  reviews: `${MEDIA}/reviews.jpg`,
  faq: `${MEDIA}/faq.jpg`,
  estimate: `${MEDIA}/estimate.jpg`,
  guides: [`${MEDIA}/guide-color.jpg`, `${MEDIA}/guide-prep.jpg`, `${MEDIA}/guide-sheen.jpg`],
} as const;

const projects = [
  {
    id: "porch",
    number: "01",
    title: "Blue porch hello",
    place: "Sample porch study",
    note: "Pool blue siding, paper-white trim, and a deep-cherry welcome at the door.",
    before: `${MEDIA}/project-porch-before.jpg`,
    after: `${MEDIA}/project-porch-after.jpg`,
    color: "blue",
  },
  {
    id: "sunroom",
    number: "02",
    title: "The sunny corner",
    place: "Sample sunroom study",
    note: "Lemon walls and cherry details turn a quiet corner into the happiest room on the block.",
    before: `${MEDIA}/project-sunroom-before.jpg`,
    after: `${MEDIA}/project-sunroom-after.jpg`,
    color: "lemon",
  },
  {
    id: "bungalow",
    number: "03",
    title: "Watermelon bungalow",
    place: "Sample exterior study",
    note: "A warm pink body, crisp pale trim, and leaf-green door make the small facade sing.",
    before: `${MEDIA}/project-bungalow-before.jpg`,
    after: `${MEDIA}/project-bungalow-after.jpg`,
    color: "pink",
  },
  {
    id: "door",
    number: "04",
    title: "One-door wonder",
    place: "Sample entry study",
    note: "A focused front-door and trim refresh makes the whole house feel cared for.",
    before: `${MEDIA}/project-door-before.jpg`,
    after: `${MEDIA}/project-door-after.jpg`,
    color: "green",
  },
] as const;

type Project = (typeof projects)[number];

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

const painterFaqs = [
  [
    PAINTER_FAQS[0][0],
    "Our residential painting services cover interiors, eligible exterior surfaces, trim and doors, and suitable cabinet refinishing. The right fit depends on the substrate, current condition, access, coating compatibility, and service area.",
  ],
  ...PAINTER_FAQS.slice(1),
] as const;

const services = [
  {
    title: PAINTER_SERVICES[0].title,
    subtitle: "Rooms that feel like home",
    text: PAINTER_SERVICES[0].text,
    image: IMAGE.interior,
    alt: "Painter rolling a pool-blue wall in a protected, sunlit living room",
    color: "blue",
  },
  {
    title: PAINTER_SERVICES[1].title,
    subtitle: "A brighter hello from the curb",
    text: PAINTER_SERVICES[1].text,
    image: projects[0].after,
    alt: "Photorealistic generated neighborhood bungalow with pool-blue siding and a cherry door",
    color: "lemon",
  },
  {
    title: PAINTER_SERVICES[2].title,
    subtitle: "A careful finish for busy kitchens",
    text: PAINTER_SERVICES[2].text,
    image: IMAGE.cabinets,
    alt: "Painter refinishing leaf-green cabinet frames in a protected family kitchen",
    color: "pink",
  },
  {
    title: "Trim & doors",
    subtitle: "The small lines that sharpen the whole house",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.trim,
    alt: "Painter finishing paper-white trim around a coral front door on a green bungalow",
    color: "green",
  },
] as const;

function TemplateImage({
  src,
  alt,
  eager = false,
  className,
  tkey,
}: {
  src: string;
  alt: string;
  eager?: boolean;
  className?: string;
  tkey?: string;
}) {
  const responsiveSrcSet =
    src.endsWith(".jpg") && src.startsWith("/templates/")
      ? `${src.replace(/\.jpg$/, "-800.jpg")} 800w, ${src.replace(/\.jpg$/, "-1200.jpg")} 1200w, ${src} 1600w`
      : undefined;
  return (
    <img
      src={src}
      srcSet={responsiveSrcSet}
      sizes="(max-width: 760px) 100vw, 70vw"
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

function HeroFilm({ brandName, poster }: { brandName: string | null; poster: string }) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || failed) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (query.matches || document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    sync();
    query.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      query.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [failed]);

  return (
    <figure className="p12-hero-art">
      <TemplateImage
        src={poster}
        alt="Local painting crew beside a cheerful lemon-yellow Craftsman bungalow in summer light"
        eager
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
      <figcaption>Concept photography · {brandName ?? "True Coat"} color story</figcaption>
    </figure>
  );
}

function WoodenButton({
  children,
  onClick,
  tone = "lemon",
}: {
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  tone?: "lemon" | "blue" | "pink";
}) {
  return (
    <button type="button" className="p12-wood-button" data-tone={tone} onClick={onClick}>
      <span>{children}</span>
      <ArrowUpRight aria-hidden="true" />
    </button>
  );
}

function ProjectPostcard({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(project)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="p12-postcard-dialog sm:max-w-[min(66rem,calc(100vw-2rem))]">
        {project ? (
          <>
            <DialogHeader className="p12-postcard-head">
              <p className="p12-hand">Postcard from the block · color concept</p>
              <DialogTitle>{project.title}</DialogTitle>
              <DialogDescription>
                A color study using the same property, camera, and structure. Paint color and finish
                only.
              </DialogDescription>
            </DialogHeader>
            <div
              className="p12-postcard-pair"
              role="group"
              aria-label={`${project.title} paint-only comparison`}
            >
              <figure>
                <TemplateImage
                  src={project.before}
                  alt={`${project.title} before paint-only color study`}
                />
                <figcaption>Before · existing color</figcaption>
              </figure>
              <figure>
                <TemplateImage
                  src={project.after}
                  alt={`${project.title} after paint-only color study`}
                />
                <figcaption>After · color proposal</figcaption>
              </figure>
            </div>
            <div className="p12-postcard-note">
              <span>{project.number}</span>
              <p>{project.note}</p>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
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
      <DialogContent className="p12-article-dialog sm:max-w-[min(48rem,calc(100vw-2rem))]">
        {article ? (
          <>
            <DialogHeader className="p12-article-head">
              <p className="p12-hand">Painter's field note · {article.readTime}</p>
              <DialogTitle>{article.title}</DialogTitle>
              <DialogDescription>{article.intro}</DialogDescription>
            </DialogHeader>
            <div className="p12-article-body">
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
            <p className="p12-article-note">
              General planning guidance. Confirm actual products, site conditions, and written scope
              with your painter.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function PainterTwelveTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Fresh paint.";
  const heroAccent = text?.heroAccent ?? "Happy block.";
  const heroSub =
    text?.heroSub ??
    "Friendly residential painting with the surface, preparation, protection, color, and finish written into a clear plan before the first can opens.";
  const streetTitle = text?.streetTitle ?? "Every color leaves the block a little happier.";
  const streetIntro =
    text?.streetIntro ??
    "Scroll the street, then open a house. Each postcard shows one reference-edited, same-property paint-only transformation.";
  const servicesHeading =
    text?.servicesHeading ?? "A careful crew for the rooms and curb you call home.";
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? "Paint change only. No disappearing rooflines.";
  const proofBody =
    text?.proofBody ??
    "A reference-edited color concept keeps the property, camera, roofline, porch, and landscaping fixed so the finish decision stays easy to read.";
  const processTitle = text?.processTitle ?? "Five little signs. One dependable finish.";
  const processIntro = text?.processIntro ?? PAINTER_SECTION_COPY.processIntro;
  const planHeading = text?.planHeading ?? "The nicest projects start with a useful conversation.";
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const journalTitle = text?.journalTitle ?? "Three good things to know before the crew arrives.";
  const journalIntro =
    text?.journalIntro ??
    "Practical painter guidance on color, preparation, and finish choices that hold up after project day.";
  const reviewsHeading =
    text?.reviewsHeading ?? "The kind of experience worth talking over the fence about.";
  const faqTitle = text?.faqTitle ?? "Questions are welcome at the stand.";
  const estimateTitle = text?.estimateTitle ?? "Bring the details. We’ll bring the color cards.";
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
  const brandAria = brandName ? `${brandName} home` : "True Coat neighborhood painters home";
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const callAria = brandName
    ? `Call ${brandName} at ${phoneLabel}`
    : `Call True Coat at ${PHONE_LABEL}`;
  const [bookingOpen, setBookingOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<BlogArticle | null>(null);
  const [streetGrown, setStreetGrown] = useState(false);
  const streetRef = useRef<HTMLElement>(null);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const articleTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const street = streetRef.current;
    if (!street) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStreetGrown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(street);
    return () => observer.disconnect();
  }, []);

  function openBooking(event: React.MouseEvent<HTMLButtonElement>) {
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  }

  return (
    <div className="p12" id="top">
      <a className="p12-skip" href="#p12-main">
        Skip to content
      </a>

      <header className="p12-mast">
        <a className="p12-brand" href="#top" aria-label={brandAria}>
          <span
            className="p12-brand-sun overlay-brand-mark"
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <small>your neighborhood painters</small>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#street">The block</a>
          <a href="#services">What we paint</a>
          <a href="#method">How we work</a>
          <a href="#help">Field notes</a>
        </nav>
        <a className="p12-call" href={phoneHref} aria-label={callAria} data-tkey="contact.phone">
          <Phone aria-hidden="true" />
          <span>{phoneLabel}</span>
        </a>
      </header>

      <main id="p12-main" tabIndex={-1}>
        <section className="p12-hero" aria-labelledby="p12-title">
          <div className="p12-hero-copy">
            <p className="p12-chip">Friendly residential painting · right around the corner</p>
            <h1 id="p12-title" data-tkey="text.heroTitle">
              {heroTitle}
              <span data-tkey="text.heroAccent">{heroAccent}</span>
            </h1>
            <p className="p12-lede" data-tkey="text.heroSub">
              {heroSub}
            </p>
            <div className="p12-hero-actions">
              <WoodenButton onClick={openBooking}>Plan a porch-side walkthrough</WoodenButton>
              <a href="#street" className="p12-down-link">
                Paint the neighborhood <ArrowDown aria-hidden="true" />
              </a>
            </div>
            <div className="p12-local-note">
              <MapPin aria-hidden="true" />
              <span>Serving the neighborhood and nearby streets</span>
            </div>
          </div>
          <HeroFilm brandName={brandName} poster={heroPoster} />
        </section>

        <div className="p12-marquee" aria-label="Residential painting services">
          <div>
            <span>INTERIORS</span>
            <i aria-hidden="true">✦</i>
            <span>EXTERIORS</span>
            <i aria-hidden="true">✦</i>
            <span>CABINETS</span>
            <i aria-hidden="true">✦</i>
            <span>TRIM + DOORS</span>
            <i aria-hidden="true">✦</i>
            <span>COLOR PLANNING</span>
          </div>
        </div>

        <section
          className="p12-street"
          id="street"
          ref={streetRef}
          data-grown={streetGrown || undefined}
          aria-labelledby="p12-street-title"
        >
          <TemplateImage
            src={overlayMediaUrl(content, "streetImage", IMAGE.street)}
            alt="Colorful neighborhood street with freshly painted homes"
            className="p12-street-backdrop"
            tkey="media.streetImage"
          />
          <div className="p12-section-head p12-section-head--street">
            <div>
              <p className="p12-kicker">Paint the neighborhood</p>
              <h2 id="p12-street-title" data-tkey="text.streetTitle">
                {streetTitle}
              </h2>
            </div>
            <p data-tkey="text.streetIntro">{streetIntro}</p>
          </div>
          <div
            className="p12-street-scroll"
            role="region"
            aria-label="Completed project postcards"
            tabIndex={0}
          >
            <div className="p12-street-line" aria-hidden="true" />
            <ol>
              {projects.map((project, index) => (
                <li
                  key={project.id}
                  style={{ "--p12-delay": `${index * 130}ms` } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="p12-house"
                    data-color={project.color}
                    onClick={(event) => {
                      projectTriggerRef.current = event.currentTarget;
                      setSelectedProject(project);
                    }}
                    aria-label={`Open ${project.title} before and after postcard`}
                  >
                    <TemplateImage src={project.after} alt="" eager />
                    <span className="p12-house-label">
                      <b>{project.number}</b>
                      {project.title}
                    </span>
                  </button>
                </li>
              ))}
              <li className="p12-street-tree" aria-hidden="true">
                <span />
                <span />
                <span />
                <i />
              </li>
            </ol>
          </div>
        </section>

        <section className="p12-services" id="services" aria-labelledby="p12-services-title">
          <TemplateImage
            src={overlayMediaUrl(content, "accentImage", IMAGE.trim)}
            alt=""
            className="p12-section-image-band"
            tkey="media.accentImage"
          />
          <div className="p12-section-head">
            <div>
              <p className="p12-kicker">What we paint</p>
              <h2 id="p12-services-title" data-tkey="text.servicesHeading">
                {servicesHeading}
              </h2>
            </div>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div
            className="p12-service-grid"
            role="region"
            aria-label="Residential painting services"
            tabIndex={0}
          >
            {services.map((service, index) => (
              <article className="p12-service" data-color={service.color} key={service.title}>
                <figure>
                  <TemplateImage
                    src={overlayMediaUrl(content, `serviceImage${index + 1}`, service.image)}
                    alt={service.alt}
                    tkey={`media.serviceImage${index + 1}`}
                  />
                  <figcaption>
                    Neighborhood project concept · {String(index + 1).padStart(2, "0")}
                  </figcaption>
                </figure>
                <div>
                  <p className="p12-hand">{service.subtitle}</p>
                  <h3>{service.title}</h3>
                  <p className="p12-service-detail">{service.text}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="p12-service-action">
            <WoodenButton tone="blue" onClick={openBooking}>
              Tell us what needs paint
            </WoodenButton>
          </div>
        </section>

        <section className="p12-proof" id="proof" aria-labelledby="p12-proof-title">
          <div className="p12-proof-copy">
            <p className="p12-kicker">Same porch · new hello</p>
            <h2 id="p12-proof-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
            <p className="p12-hand">
              Drag nothing. Squint at nothing. The matching view stays side by side.
            </p>
          </div>
          <div
            className="p12-proof-pair"
            role="group"
            aria-label="Same porch paint-only comparison"
          >
            <figure>
              <TemplateImage
                src={projects[0].before}
                alt="Same bungalow porch before the paint-only color study"
              />
              <figcaption>
                <span>Before</span> Existing color
              </figcaption>
            </figure>
            <figure>
              <TemplateImage
                src={projects[0].after}
                alt="Same bungalow porch after the pool-blue paint proposal"
              />
              <figcaption>
                <span>After</span> Pool-blue proposal
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="p12-method" id="method" aria-labelledby="p12-method-title">
          <div className="p12-section-head p12-section-head--light">
            <div>
              <p className="p12-kicker">How we work</p>
              <h2 id="p12-method-title" data-tkey="text.processTitle">
                {processTitle}
              </h2>
            </div>
            <p data-tkey="text.processIntro">{processIntro}</p>
          </div>
          <div className="p12-process-scroll">
            <figure className="p12-process-art">
              <TemplateImage
                src={overlayMediaUrl(content, "processImage", IMAGE.process)}
                alt="Professional painters preparing and protecting a sunlit room before coating"
                tkey="media.processImage"
              />
            </figure>
          </div>
          <div className="p12-process-summary">
            <p>
              Inspect the surface. Protect the home. Repair what the finish will reveal. Prepare for
              adhesion. Finish to the written plan.
            </p>
          </div>
        </section>

        <section className="p12-planning" id="help" aria-labelledby="p12-plan-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
              alt="Realistic overhead paint-planning table with colorful samples, brushes, roller, and tape"
              tkey="media.planningImage"
            />
            <figcaption>Color decisions belong in the real room, through the whole day.</figcaption>
          </figure>
          <div className="p12-planning-copy">
            <p className="p12-kicker">Front-porch field notes</p>
            <h2 id="p12-plan-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <div className="p12-plan-signs">
              {PAINTER_PLANNING_NOTES.map((note, index) => (
                <article key={note.label}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>{note.label}</span>
                  <h3>{note.title}</h3>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="p12-guides" aria-labelledby="p12-guides-title">
          <TemplateImage
            src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
            alt=""
            className="p12-section-image-band p12-section-image-band--guides"
          />
          <div className="p12-section-head">
            <div>
              <p className="p12-kicker">Notes from the paint cart</p>
              <h2 id="p12-guides-title" data-tkey="text.journalTitle">
                {journalTitle}
              </h2>
            </div>
            <p data-tkey="text.journalIntro">{journalIntro}</p>
          </div>
          <div
            className="p12-guide-grid"
            role="region"
            aria-label="Painter field note articles"
            tabIndex={0}
          >
            {PAINTER_BLOG_POSTS.map((post, index) => {
              const overlayPost = content?.blogs?.[index];
              return (
                <article key={post.number}>
                  <TemplateImage
                    src={overlayMediaUrl(content, `guideImage${index + 1}`, IMAGE.guides[index])}
                    alt={`${post.category} planning scene on a painter's work table`}
                    tkey={`media.guideImage${index + 1}`}
                  />
                  <div>
                    <span data-tkey={`blogs.${index}.category`}>
                      {post.number} · {overlayPost?.category ?? post.category}
                    </span>
                    <h3 data-tkey={`blogs.${index}.title`}>{overlayPost?.title ?? post.title}</h3>
                    <p data-tkey={`blogs.${index}.excerpt`}>
                      {overlayPost?.excerpt ?? post.excerpt}
                    </p>
                    <button
                      type="button"
                      onClick={(event) => {
                        articleTriggerRef.current = event.currentTarget;
                        setSelectedArticle(withOverlayBlogPost(blogArticles[index], overlayPost));
                      }}
                    >
                      Read the field note <ArrowUpRight aria-hidden="true" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="p12-trust" aria-labelledby="p12-trust-title">
          <figure>
            <TemplateImage
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              alt="Painter and homeowners reviewing the finish on a freshly painted yellow porch"
              tkey="media.reviewsImage"
            />
          </figure>
          <div className="p12-trust-card">
            <p className="p12-hand">{overlayReviews ? "Reviews" : "Review copy examples"}</p>
            <h2 id="p12-trust-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            {overlayReviews && overlayReviews.length > 0 ? (
              <div
                className="p12-review-grid"
                role="region"
                aria-label="Customer reviews"
                tabIndex={0}
              >
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
                <p>
                  Three draft homeowner voices show how verified feedback can speak to planning,
                  care, and finish as much as color.
                </p>
                <div
                  className="p12-review-grid"
                  role="region"
                  aria-label="Draft customer review examples"
                  tabIndex={0}
                >
                  {reviewExamples.map((review, index) => (
                    <blockquote key={review.name}>
                      <Quote aria-hidden="true" />
                      <p>“{review.quote}”</p>
                      <footer>
                        <strong>{review.name}</strong>
                        <span>{review.project}</span>
                        <small>
                          {review.source} · story {String(index + 1).padStart(2, "0")}
                        </small>
                      </footer>
                    </blockquote>
                  ))}
                </div>
                <div className="p12-source-badges" aria-label="Future review source placements">
                  <span aria-label="Google-style review card example">
                    <img
                      src="/templates/garden-delite/brands/google.svg"
                      width={72}
                      height={26}
                      alt=""
                    />
                    Google-style card
                  </span>
                  <span aria-label="Yelp-style review card example">
                    <img
                      src="/templates/garden-delite/brands/yelp.svg"
                      width={72}
                      height={26}
                      alt=""
                    />
                    Yelp-style card
                  </span>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="p12-faq" aria-labelledby="p12-faq-title">
          <div className="p12-faq-copy">
            <p className="p12-kicker">Ask the crew</p>
            <h2 id="p12-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div className="p12-faq-list">
              {painterFaqs.map(([question, answer], index) => (
                <details key={question} open={index === 0}>
                  <summary>
                    <span>{question}</span>
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
              alt="Painter and homeowner comparing color samples in warm afternoon light"
              tkey="media.faqImage"
            />
            <figcaption>
              There is no silly paint question. Bring the room, the light, and the problem.
            </figcaption>
          </figure>
        </section>

        <section className="p12-estimate" id="estimate" aria-labelledby="p12-estimate-title">
          <TemplateImage
            src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
            alt="Painter and homeowner walking toward a colorful bungalow for a project consultation"
            tkey="media.estimateImage"
          />
          <div className="p12-estimate-sign">
            <p className="p12-kicker">Request an estimate</p>
            <h2 id="p12-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <ul>
              {PAINTER_ESTIMATE_ITEMS.map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <WoodenButton tone="pink" onClick={openBooking}>
              Plan a neighborhood walkthrough
            </WoodenButton>
          </div>
        </section>
      </main>

      <footer className="p12-footer">
        <div className="p12-footer-brand">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : "☀"}
          </span>
          <div>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <small>your neighborhood painters</small>
          </div>
        </div>
        <p>Residential interiors · exteriors · cabinets · trim + doors</p>
        <div className="p12-footer-links">
          <a href={phoneHref} data-tkey="contact.phone">
            {phoneLabel}
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {emailLabel}
          </a>
        </div>
      </footer>

      <ProjectPostcard
        project={selectedProject}
        onClose={() => {
          setSelectedProject(null);
          requestAnimationFrame(() => projectTriggerRef.current?.focus());
        }}
      />
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
