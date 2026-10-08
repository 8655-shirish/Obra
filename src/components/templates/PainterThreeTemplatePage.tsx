import { ArrowUpRight, Check } from "lucide-react";
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
import "./painter-three/painter-three.css";

const MEDIA = "/templates/true-coat-spectrum/generated";
const IMAGE = {
  hero: MEDIA + "/hero-room.jpg",
  pigment: MEDIA + "/hero-splash.jpg",
  video: MEDIA + "/lacquer-spine.mp4",
  before: MEDIA + "/proof-before.jpg",
  after: MEDIA + "/proof-after.jpg",
  color: MEDIA + "/planning-color.jpg",
  sheen: MEDIA + "/planning-sheen.jpg",
  interior: MEDIA + "/service-interior.jpg",
  exterior: MEDIA + "/service-exterior.jpg",
  cabinetry: MEDIA + "/service-cabinetry.jpg",
  cut: MEDIA + "/craft-cut.jpg",
  repair: MEDIA + "/process-repair.jpg",
} as const;

const SERVICES = [
  {
    n: "01",
    title: "Interior painting",
    short: "Interiors",
    image: IMAGE.interior,
    alt: "Illustrative finished living room with a deep blue wall and precise white trim",
    body: "Walls, ceilings, trim, doors, and architectural details—planned around surface condition, repairs, room use, access, color, and sheen.",
  },
  {
    n: "02",
    title: "Eligible exterior painting",
    short: "Exteriors",
    image: IMAGE.exterior,
    alt: "Illustrative finished house exterior with white siding, deep blue porch, and red front door",
    body: "Suitable siding, stucco, trim, and doors—reviewed for substrate, exposure, moisture, access, weather, and coating compatibility.",
  },
  {
    n: "03",
    title: "Cabinet refinishing",
    short: "Cabinetry",
    image: IMAGE.cabinetry,
    alt: "Illustrative sunlit kitchen with deep blue refinished cabinets and crisp warm-white surfaces",
    body: "Suitable doors and frames—with cleaning, repairs, hardware handling, adhesion preparation, application, reassembly, finish, and cure guidance defined first.",
  },
] as const;

const METHODS = [
  {
    n: "01",
    title: "Inspect",
    text: "Read current coatings, damage, moisture, access, and the substrate before defining work.",
  },
  {
    n: "02",
    title: "Protect",
    text: "Agree on moving, masking, coverings, ventilation, pets, parking, staging, and safe access.",
  },
  {
    n: "03",
    title: "Repair",
    text: "Identify and approve patching, filling, caulking, and newly discovered conditions before extra work.",
  },
  {
    n: "04",
    title: "Prepare",
    text: "Clean, mask, sand, and prime where the surface and chosen coating system require it.",
  },
  {
    n: "05",
    title: "Finish",
    text: "Apply compatible coats, maintain clean edges, tidy the work zone, and complete a final walkthrough.",
  },
] as const;

const FAQS = [
  {
    q: "What projects and surfaces fit?",
    a: "This preview covers residential interiors, eligible exteriors, trim and door detail work, and suitable cabinet refinishing. A real operator should publish only verified services, surfaces, service area, and coating compatibility.",
  },
  {
    q: "What happens after first contact?",
    a: "A real painter should check address and project fit, gather project basics, arrange a site review when needed, and follow with a written scope. This preview booking flow creates no lead or appointment.",
  },
  {
    q: "What should the process and proposal cover?",
    a: "Inquiry, site review, inspection, protection, repairs, preparation, application, cleanup, and walkthrough. A proposal should name included surfaces, preparation, products, exclusions, protection, schedule and payment assumptions, and how hidden conditions are handled.",
  },
  {
    q: "Can you help with color and coating choices?",
    a: "Color support can compare undertones, room light, neighboring finishes, and sheen. Physical samples viewed morning, afternoon, and evening are more useful than a screen. Products must suit the substrate, exposure, compatibility, and cure conditions.",
  },
  {
    q: "How are schedule and exterior weather handled?",
    a: "Duration should follow scope, repairs, drying, access, crew, products, cure, and weather. Exterior timing must respect temperature, moisture, wind, direct sun, surface dryness, forecasts, and manufacturer requirements.",
  },
  {
    q: "How should I prepare, and can the home stay occupied?",
    a: "Confirm belongings, fragile items, pets, parking, ventilation, work zones, moving needs, drying or cure requirements, daily cleanup, communication, and safe access. The written plan should explain what the crew moves or protects.",
  },
  {
    q: "What does cabinet refinishing include?",
    a: "For suitable doors and frames, scope may include cleaning, disassembly, repairs, labeling and hardware handling, adhesion preparation, application, reassembly, finish and cure guidance, care, and exclusions.",
  },
  {
    q: "How does this site-visit preview work?",
    a: "Choose sample weekday availability and a time, then view the simulated deposit screen. Demo only—no lead, appointment, charge, or card data is created.",
  },
] as const;

const SAMPLE_REVIEWS = [
  {
    quote:
      "The sample planning flow made it easy to understand what we would discuss before any work began.",
    name: "Jordan M.",
    project: "Sample interior inquiry",
    source: "Google",
  },
  {
    quote:
      "We appreciated seeing color, preparation, access, and timing treated as one connected decision.",
    name: "Alex R.",
    project: "Sample exterior inquiry",
    source: "Yelp",
  },
  {
    quote: "The preview set clear expectations about surfaces, protection, and the written scope.",
    name: "Taylor K.",
    project: "Sample cabinet inquiry",
    source: "Google",
  },
] as const;

const NOTES = [
  {
    n: "01",
    title: "How undertones change in daylight",
    image: IMAGE.color,
    alt: "Illustrative physical color samples and glossy pigment viewed in bright light",
  },
  {
    n: "02",
    title: "What thorough surface preparation includes",
    image: IMAGE.repair,
    alt: "Illustrative close view of a wall repair being prepared",
  },
  {
    n: "03",
    title: "Where matte, eggshell, and satin fit",
    image: IMAGE.sheen,
    alt: "Illustrative glossy brush-outs showing reflected light across colors",
  },
] as const;

function BrandLockup({
  brandLabel,
  brandName,
  brandMark,
  logoUrl,
}: {
  brandLabel: string;
  brandName: string | null;
  brandMark: string;
  logoUrl: string | null;
}) {
  return (
    <>
      <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
        {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
      </span>
      <span className="overlay-brand-name">
        {brandName ? (
          brandLabel
        ) : (
          <>
            <span>TRUE</span>
            <b>COAT</b>
          </>
        )}
      </span>
    </>
  );
}

function Kicker({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return <p className={"p3-kicker" + (light ? " p3-kicker--light" : "")}>{children}</p>;
}

function BookingButton({
  children,
  light = false,
  onClick,
}: {
  children: React.ReactNode;
  light?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"p3-action" + (light ? " p3-action--light" : "")}
    >
      <span>{children}</span>
      <ArrowUpRight aria-hidden="true" />
    </button>
  );
}

export function PainterThreeTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Live in";
  const heroAccent = text?.heroAccent ?? "full color.";
  const heroSub =
    text?.heroSub ??
    "Residential interiors, eligible exteriors, and cabinet refinishing—planned around the surface, the light, and the life of the room.";
  const proofTitle = text?.proofTitle ?? "One room.";
  const proofAccent = text?.proofAccent ?? "Two readings.";
  const proofBody =
    text?.proofBody ??
    "These generated frames explore a paint-only finish direction. They are not a registered before-and-after, a measured transformation, or a client project.";
  const colorTitle = text?.colorTitle ?? "Read the light.";
  const colorAccent = text?.colorAccent ?? "Then choose.";
  const colorBody =
    text?.colorBody ??
    "Compare physical samples with undertones, daylight, neighboring materials, and the intended sheen. Revisit them morning, afternoon, and evening.";
  const servicesHeading = text?.servicesHeading ?? "Scope, made visible.";
  const servicesIntro =
    text?.servicesIntro ??
    "Capability is explained beside the surface it affects—not hidden inside a generic service card.";
  const methodTitle = text?.methodTitle ?? "The work";
  const methodAccent = text?.methodAccent ?? "under the color.";
  const reviewsHeading = text?.reviewsHeading ?? "How the experience could sound.";
  const reviewsBody =
    text?.reviewsBody ??
    "Sample reviews from fictional customers—not real clients, projects, ratings, or endorsements. Replace with permissioned feedback before publishing.";
  const faqTitle = text?.faqTitle ?? "Questions";
  const faqAccent = text?.faqAccent ?? "left open.";
  const notesHeading = text?.notesHeading ?? "Look closer.";
  const estimateTitle = text?.estimateTitle ?? "Bring the room.";
  const estimateAccent = text?.estimateAccent ?? "We’ll bring the questions.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@truecoat.example";
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
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.pigment);
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted || reducedMotion || videoFailed) return;
    void videoRef.current?.play().catch(() => setVideoFailed(true));
  }, [mounted, reducedMotion, videoFailed]);

  const showVideo = mounted && !reducedMotion && !videoFailed;
  const openBooking = () => setBookingOpen(true);

  return (
    <div id="top" className="p3-shell">
      <a href="#main" className="p3-skip">
        Skip to content
      </a>
      <header className="p3-header">
        <a href="#top" className="p3-logo" aria-label={brandAria}>
          <BrandLockup
            brandLabel={brandLabel}
            brandName={brandName}
            brandMark={brandMark}
            logoUrl={logoUrl}
          />
        </a>
        <p className="p3-header-note">Residential color studio</p>
        <nav className="p3-nav" aria-label="Page sections">
          <a href="#scope">Scope</a>
          <a href="#method">Method</a>
          <a href="#manual">Manual</a>
        </nav>
        <button type="button" className="p3-header-action" onClick={openBooking}>
          Preview booking <ArrowUpRight aria-hidden="true" />
        </button>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="p3-hero" aria-labelledby="p3-title">
          <div className="p3-hero-copy">
            <Kicker>Residential painting · fictional preview</Kicker>
            <h1 id="p3-title" data-tkey="text.heroTitle">
              {heroTitle}
              <br />
              <em data-tkey="text.heroAccent">{heroAccent}</em>
            </h1>
          </div>
          <figure className="p3-hero-room">
            <img
              src={overlayMediaUrl(content, "heroRoom", IMAGE.hero)}
              alt="Generated residential color-direction scene with warm-white trim, a deep-blue room, and a red door"
              width={2200}
              height={1650}
              loading="eager"
              data-tkey="media.heroRoom"
            />
            <figcaption>01 / Generated finished-space direction · not client work</figcaption>
          </figure>
          <figure className="p3-hero-film">
            <img
              src={heroPoster}
              alt=""
              width={1237}
              height={2200}
              data-tkey="media.heroPoster"
              style={{ position: "absolute", inset: 0 }}
            />
            {showVideo ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                onTimeUpdate={(event) => {
                  if (event.currentTarget.currentTime >= 4.5) event.currentTarget.pause();
                }}
                playsInline
                preload="metadata"
                poster={heroPoster}
                onError={() => setVideoFailed(true)}
                aria-label="Five-second illustrative lacquer-paint study"
                style={{ position: "absolute", inset: 0 }}
              >
                <source src={IMAGE.video} type="video/mp4" />
              </video>
            ) : null}
            <figcaption>
              <span className="p3-film-caption-full">
                02 / Generated color-material study · not application footage
              </span>
              <span className="p3-film-caption-short">02 / Generated study</span>
            </figcaption>
          </figure>
          <p className="p3-dek" data-tkey="text.heroSub">
            {heroSub}
          </p>
          <div className="p3-hero-actions">
            <BookingButton onClick={openBooking}>Preview site-visit booking</BookingButton>
            <a href={phoneHref} className="p3-phone" data-tkey="contact.phone">
              {rawPhone ? phoneLabel : "Sample · (555) 013-7482"}
            </a>
          </div>
          <small className="p3-hero-demo-note">
            Demo only—no lead, booking, payment, or card data is created.
          </small>
        </section>

        <section id="proof" className="p3-proof" aria-labelledby="proof-title">
          <div className="p3-proof-head">
            <Kicker light>Color direction study · not client proof</Kicker>
            <h2 id="proof-title" data-tkey="text.proofTitle">
              {proofTitle}
              <br />
              <span data-tkey="text.proofAccent">{proofAccent}</span>
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div className="p3-proof-pair">
            <figure className="p3-proof-before">
              <img
                src={IMAGE.before}
                alt="Generated room condition study used as the first frame of a color concept"
                width={2200}
                height={1237}
                loading="eager"
              />
              <figcaption>
                <span>Frame 01</span>
                <b>Existing surface study</b>
              </figcaption>
            </figure>
            <figure className="p3-proof-after">
              <img
                src={IMAGE.after}
                alt="Generated finish-direction study with different framing and geometry"
                width={2200}
                height={1237}
                loading="eager"
              />
              <figcaption>
                <span>Frame 02</span>
                <b>Finish direction</b>
              </figcaption>
            </figure>
          </div>
          <p className="p3-proof-disclosure">
            Two generated studies. Framing and geometry differ; this is not a matched-camera
            before-and-after or client proof. Replace with documented same-camera project
            photography before publishing.
          </p>
        </section>

        <section id="color" className="p3-color" aria-labelledby="color-title">
          <div className="p3-color-title">
            <Kicker>Color is a condition, not a chip</Kicker>
            <h2 id="color-title" data-tkey="text.colorTitle">
              {colorTitle}
              <br />
              {colorAccent}
            </h2>
          </div>
          <figure className="p3-color-main">
            <img
              src={overlayMediaUrl(content, "colorImage", IMAGE.color)}
              alt="Illustrative physical color samples and glossy pigment viewed in bright light"
              width={2200}
              height={1466}
              loading="lazy"
              data-tkey="media.colorImage"
            />
            <figcaption>Physical samples / daylight / adjacent finishes</figcaption>
          </figure>
          <div className="p3-color-copy">
            <p data-tkey="text.colorBody">{colorBody}</p>
            <dl>
              <div>
                <dt>Morning</dt>
                <dd>Cooler, quieter undertones</dd>
              </div>
              <div>
                <dt>Afternoon</dt>
                <dd>Full saturation and glare</dd>
              </div>
              <div>
                <dt>Evening</dt>
                <dd>Warm lamps and shadow</dd>
              </div>
            </dl>
          </div>
          <figure className="p3-color-detail">
            <img
              src={overlayMediaUrl(content, "sheenImage", IMAGE.sheen)}
              alt="Illustrative glossy brush-outs showing how reflected light changes perceived color and sheen"
              width={2200}
              height={1466}
              loading="lazy"
              data-tkey="media.sheenImage"
            />
            <figcaption>Sheen changes the way light returns</figcaption>
          </figure>
        </section>

        <section id="scope" className="p3-services" aria-labelledby="scope-title">
          <div className="p3-services-head">
            <Kicker light>Three kinds of surface</Kicker>
            <h2 id="scope-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div className="p3-service-stack">
            {SERVICES.map((service, index) => (
              <article
                className="p3-service"
                key={service.n}
                style={{ "--p3-index": index } as React.CSSProperties}
              >
                <figure>
                  <img
                    src={overlayMediaUrl(content, `serviceImage${index}`, service.image)}
                    alt={service.alt}
                    width={2200}
                    height={1650}
                    loading="lazy"
                    data-tkey={`media.serviceImage${index}`}
                  />
                  <figcaption>{service.n} / Generated service direction</figcaption>
                </figure>
                <div>
                  <span>{service.n}</span>
                  <h3>{service.title}</h3>
                  <p>{service.body}</p>
                </div>
              </article>
            ))}
          </div>
          <BookingButton light onClick={openBooking}>
            Preview site-visit booking
          </BookingButton>
        </section>

        <section id="method" className="p3-method" aria-labelledby="method-title">
          <div className="p3-method-intro">
            <Kicker>Behind every clean finish</Kicker>
            <h2 id="method-title" data-tkey="text.methodTitle">
              {methodTitle}
              <br />
              {methodAccent}
            </h2>
            <p>
              A finish is only as considered as the inspection, protection, and preparation beneath
              it.
            </p>
          </div>
          <figure className="p3-method-image">
            <img
              src={overlayMediaUrl(content, "methodImage", IMAGE.cut)}
              alt="Illustrative close view of a painter cutting a blue edge along white trim"
              width={1650}
              height={2200}
              loading="lazy"
              data-tkey="media.methodImage"
            />
            <figcaption>Edge work / illustrative craft detail</figcaption>
          </figure>
          <ol className="p3-method-list">
            {METHODS.map((step) => (
              <li key={step.n}>
                <span>{step.n}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <aside className="p3-scope-note">
            <b>What the written scope should hold</b>
            <p>
              Included surfaces, preparation, repairs, compatible products or coating system,
              protection, exclusions, access, cleanup, schedule and payment assumptions, and
              approval before extra work caused by hidden conditions.
            </p>
          </aside>
        </section>

        <section className="p3-trust" aria-labelledby="trust-title">
          <div className="p3-trust-head">
            <Kicker>{overlayReviews ? "Reviews" : "Sample reviews · fictional customers"}</Kicker>
            <h2 id="trust-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
          </div>
          {overlayReviews && overlayReviews.length > 0 ? (
            <div className="p3-review-list">
              {overlayReviews.map((review, index) => (
                <figure key={`${review.author}-${index}`} className="p3-review">
                  <span>0{index + 1}</span>
                  <blockquote data-tkey={`reviews.${index}.quote`}>“{review.quote}”</blockquote>
                  <figcaption>
                    <b data-tkey={`reviews.${index}.author`}>{review.author}</b>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : overlayReviews === null ? (
            <div className="p3-review-list">
              {SAMPLE_REVIEWS.map((review, index) => (
                <figure key={review.name} className="p3-review">
                  <span>0{index + 1}</span>
                  <blockquote>“{review.quote}”</blockquote>
                  <figcaption>
                    <span
                      className={`p3-review-source p3-review-source--${review.source.toLowerCase()}`}
                    >
                      {review.source} · sample review
                    </span>
                    <b>{review.name}</b>
                    <small>{review.project} · fictional sample</small>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </section>

        <section id="manual" className="p3-manual" aria-labelledby="manual-title">
          <div className="p3-manual-head">
            <Kicker>Project manual</Kicker>
            <h2 id="manual-title" data-tkey="text.faqTitle">
              {faqTitle}
              <br />
              {faqAccent}
            </h2>
            <p>
              Practical planning guidance for the visit, written scope, project days, and finish.
            </p>
          </div>
          <div className="p3-faqs">
            {FAQS.map((item, index) => (
              <details key={item.q} open={index === 0}>
                <summary>
                  <span>0{index + 1}</span>
                  {item.q}
                  <i aria-hidden="true">+</i>
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="notes" className="p3-notes" aria-labelledby="notes-title">
          <div className="p3-notes-head">
            <Kicker light>Material notes · sample topics</Kicker>
            <h2 id="notes-title" data-tkey="text.notesHeading">
              {notesHeading}
            </h2>
          </div>
          <div className="p3-note-strip">
            {NOTES.map((note, index) => (
              <article key={note.n}>
                <img
                  src={overlayMediaUrl(content, `noteImage${index}`, note.image)}
                  alt={note.alt}
                  width={900}
                  height={700}
                  loading="lazy"
                  data-tkey={`media.noteImage${index}`}
                />
                <span>{note.n}</span>
                <h3 data-tkey={`blogs.${index}.title`}>
                  {content?.blogs?.[index]?.title ?? note.title}
                </h3>
                <p>Sample editorial topic · no linked or published article</p>
              </article>
            ))}
          </div>
        </section>

        <section id="estimate" className="p3-estimate" aria-labelledby="estimate-title">
          <figure>
            <img
              src={overlayMediaUrl(content, "estimateImage", IMAGE.repair)}
              alt="Illustrative close view of wall repair work before a finish is applied"
              width={1650}
              height={2200}
              loading="lazy"
              data-tkey="media.estimateImage"
            />
            <figcaption>Begin with the surface as it is · illustrative</figcaption>
          </figure>
          <div className="p3-estimate-copy">
            <Kicker>Project-fit desk</Kicker>
            <h2 id="estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
              <br />
              {estimateAccent}
            </h2>
            <p>Before a real visit, be ready to discuss:</p>
            <ul>
              {[
                "Surfaces + condition",
                "Repairs + access",
                "Color + finish",
                "Timing + occupancy",
                "Protection needs",
                "Address + service-area fit",
              ].map((item) => (
                <li key={item}>
                  <Check aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <BookingButton onClick={openBooking}>Preview site-visit booking</BookingButton>
            <a href={phoneHref} className="p3-phone" data-tkey="contact.phone">
              {rawPhone ? phoneLabel : "Sample · (555) 013-7482"}
            </a>
            <small>
              Demo only—the scheduler and deposit screen create no lead, appointment, charge, or
              card data.
            </small>
          </div>
        </section>
      </main>

      <footer className="p3-footer">
        <div className="p3-footer-brand">
          <p className="p3-logo">
            <BrandLockup
              brandLabel={brandLabel}
              brandName={brandName}
              brandMark={brandMark}
              logoUrl={logoUrl}
            />
          </p>
          <p>
            Fictional residential painting template. Replace all media, services, scope, proof,
            reviews, service-area information, and contact details before publishing.
          </p>
        </div>
        <div>
          <b>Sample contact</b>
          <p>
            {phoneLabel}
            <br />
            {emailLabel}
            <br />
            Service area · replace
          </p>
        </div>
        <div>
          <b>Template scope</b>
          <p>
            Interiors · eligible exteriors
            <br />
            Cabinet refinishing
            <br />
            Site-visit preview
          </p>
        </div>
        <div className="p3-footer-bottom">
          <span>{brandName ? `© 2026 ${brandName}` : "© 2026 True Coat · sample identity"}</span>
          <a href="#top">Return to top ↑</a>
        </div>
      </footer>
      <SiteBookingPayDemo open={bookingOpen} onOpenChange={setBookingOpen} isDemoPitch={true} />
    </div>
  );
}
