import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Minus,
  Plus,
} from "lucide-react";
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
import "./painter-seven/painter-seven.css";

const MEDIA = "/templates/true-coat-ultraviolet/generated";

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
} as const;

const lightingProfiles = [
  {
    id: "ultraviolet",
    name: "Ultraviolet",
    code: "UV-07",
    formula: "Violet / cool",
    note: "Ultraviolet atmosphere active: a cool violet wash with lavender edge light.",
  },
  {
    id: "lime",
    name: "Electric lime",
    code: "EL-22",
    formula: "Lime / electric",
    note: "Electric lime atmosphere active: a bright acid-lime reflection across the workshop.",
  },
  {
    id: "magenta",
    name: "Hot magenta",
    code: "HM-33",
    formula: "Magenta / warm",
    note: "Hot magenta atmosphere active: a saturated pink glow across the workshop.",
  },
] as const;

type LightingId = (typeof lightingProfiles)[number]["id"];

const surfaces = [
  {
    ...PAINTER_SERVICES[0],
    image: IMAGE.interior,
    alt: "Illustrative contemporary living room with a deep ultraviolet painted feature wall and crisp indigo trim",
    treatment: "Interior plane",
    channel: "A",
  },
  {
    ...PAINTER_SERVICES[1],
    image: IMAGE.exterior,
    alt: "Illustrative modern home exterior with deep-indigo painted siding and a violet entry at blue hour",
    treatment: "Exterior skin",
    channel: "B",
  },
  {
    ...PAINTER_SERVICES[2],
    image: IMAGE.cabinetry,
    alt: "Illustrative ultraviolet lacquer cabinet fronts with polished steel pulls and clean edges",
    treatment: "Fine finish",
    channel: "C",
  },
  {
    title: "Trim & doors",
    scope: "Detail work",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.trim,
    alt: "Illustrative close-up of a gloved painter cutting a crisp glossy magenta trim line",
    treatment: "Edge channel",
    channel: "D",
  },
] as const;

const processImages = [
  IMAGE.inspect,
  IMAGE.protect,
  IMAGE.repair,
  IMAGE.prepare,
  IMAGE.finish,
] as const;

const processAlts = [
  "Illustrative gloved painter inspecting a wall and trim edge under ultraviolet raking light",
  "Illustrative residential room with furniture and flooring protected before painting",
  "Illustrative gloved hand making a controlled wall repair with a broad knife",
  "Illustrative gloved painter masking a sharp trim edge before coating",
  "Illustrative gloved painter applying a smooth ultraviolet coat with a roller",
] as const;

const reviewSlots = [
  { role: "Interior painting", source: "Google" },
  { role: "Exterior painting", source: "Yelp" },
  { role: "Cabinet refinishing", source: "Google" },
] as const;

function OrbitalAction({
  children,
  onClick,
  tone = "ink",
  className = "",
}: {
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  tone?: "ink" | "signal";
  className?: string;
}) {
  return (
    <button
      className={"p7-orbital-action p7-orbital-action--" + tone + " " + className}
      type="button"
      onClick={onClick}
    >
      <span>{children}</span>
      <i aria-hidden="true">
        <ArrowUpRight />
      </i>
    </button>
  );
}

function SignalLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="p7-signal-label">
      <i aria-hidden="true" />
      {children}
    </p>
  );
}

export function PainterSevenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroSub =
    text?.heroSub ??
    "Residential painting planned with the same discipline—surface by surface, coat by coat—then tuned for the light you actually live with.";
  const servicesHeading = text?.servicesHeading ?? PAINTER_SECTION_COPY.servicesHeading;
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const calibrationTitle =
    text?.calibrationTitle ?? "Color is one input. Light, sheen, and use complete the circuit.";
  const proofTitle = text?.proofTitle ?? PAINTER_SECTION_COPY.proofHeading;
  const proofBody = text?.proofBody ?? PAINTER_SECTION_COPY.proofBody;
  const processHeading = text?.processHeading ?? PAINTER_SECTION_COPY.processHeading;
  const processIntro = text?.processIntro ?? PAINTER_SECTION_COPY.processIntro;
  const planHeading = text?.planHeading ?? PAINTER_SECTION_COPY.planningHeading;
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const reviewsHeading = text?.reviewsHeading ?? PAINTER_SECTION_COPY.reviewsHeading;
  const reviewsBody = text?.reviewsBody ?? PAINTER_SECTION_COPY.reviewsBody;
  const faqTitle = text?.faqTitle ?? "Questions before the first coat.";
  const journalTitle = text?.journalTitle ?? PAINTER_SECTION_COPY.blogsHeading;
  const estimateTitle = text?.estimateTitle ?? PAINTER_SECTION_COPY.estimateHeading;
  const estimateIntro =
    text?.estimateIntro ??
    "Bring the project details that help turn a color idea into a useful written plan.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? "(555) 013-7482";
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : "tel:+15550137482";
  const rawEmail = content?.email?.trim() ? content.email.trim() : null;
  const emailLabel = rawEmail ?? "hello@example.com";
  const emailHref = `mailto:${emailLabel}`;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "TRUE COAT";
  const brandAria = brandName ? `${brandName} home` : "True Coat home";
  const brandInitials = brandName
    ? brandName
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0]!.toUpperCase())
        .join("")
        .slice(0, 2)
    : null;
  const logoUrl = overlayLogoUrl(content);
  const overlayReviews = purchasedReviewList(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", IMAGE.hero);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [lighting, setLighting] = useState<LightingId>("ultraviolet");
  const workshopRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedLighting =
    lightingProfiles.find((profile) => profile.id === lighting) ?? lightingProfiles[0];

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const workshop = workshopRef.current;
    const header = headerRef.current;
    const preview = workshop?.closest(".overflow-auto") as HTMLElement | null;
    if (!workshop || !header || !preview) return;

    const syncHeroHeight = () => {
      workshop.style.setProperty(
        "--p7-hero-available",
        Math.max(0, preview.clientHeight - header.offsetHeight) + "px",
      );
    };

    syncHeroHeight();
    const observer = new ResizeObserver(syncHeroHeight);
    observer.observe(preview);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = heroVideoRef.current;
    if (reducedMotion || videoFailed || !video) return;

    const resumePlayback = () => {
      if (!document.hidden) void video.play().catch(() => undefined);
    };

    resumePlayback();
    document.addEventListener("visibilitychange", resumePlayback);
    return () => document.removeEventListener("visibilitychange", resumePlayback);
  }, [reducedMotion, videoFailed]);

  function openBooking(event: React.MouseEvent<HTMLButtonElement>) {
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  }

  function chooseLighting(next: LightingId) {
    setLighting(next);
  }

  function handleLightingKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = lightingProfiles[event.key === "Home" ? 0 : lightingProfiles.length - 1];
      chooseLighting(next.id);
      document.getElementById("p7-light-" + next.id)?.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next =
      lightingProfiles[(index + direction + lightingProfiles.length) % lightingProfiles.length];
    chooseLighting(next.id);
    document.getElementById("p7-light-" + next.id)?.focus();
  }

  function moveGlow(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse" || reducedMotion) return;
    const root = workshopRef.current;
    if (!root) return;
    const bounds = root.getBoundingClientRect();
    root.style.setProperty(
      "--p7-glow-x",
      ((event.clientX - bounds.left) / bounds.width) * 100 + "%",
    );
    root.style.setProperty(
      "--p7-glow-y",
      ((event.clientY - bounds.top) / bounds.height) * 100 + "%",
    );
  }

  return (
    <div
      className="p7"
      id="top"
      data-lighting={lighting}
      ref={workshopRef}
      onPointerMove={moveGlow}
    >
      <a className="p7-skip" href="#main">
        Skip to content
      </a>
      <header className="p7-header" ref={headerRef}>
        <a className="p7-brand" href="#top" aria-label={brandAria}>
          <span
            className="p7-brand-mark overlay-brand-mark"
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" />
            ) : brandInitials ? (
              <b>{brandInitials}</b>
            ) : (
              <>
                <b>T</b>
                <b>C</b>
              </>
            )}
          </span>
          <span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            <small>FINISH LAB / 07</small>
          </span>
        </a>
        <nav className="p7-rail-nav" aria-label="Primary navigation">
          <a href="#work">
            <span>01</span>WORK
          </a>
          <a href="#surfaces">
            <span>02</span>SURFACES
          </a>
          <a href="#process">
            <span>03</span>METHOD
          </a>
          <a href="#notes">
            <span>04</span>NOTES
          </a>
        </nav>
        <OrbitalAction className="p7-header-action" onClick={openBooking}>
          Start a scope
        </OrbitalAction>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="p7-hero" aria-labelledby="p7-title">
          <figure className="p7-hero-media">
            <img
              src={heroPoster}
              width={2560}
              height={1440}
              alt=""
              aria-hidden="true"
              fetchPriority="high"
              data-tkey="media.heroPoster"
            />
            {reducedMotion || videoFailed ? null : (
              <video
                ref={heroVideoRef}
                autoPlay
                muted
                loop
                playsInline
                poster={heroPoster}
                preload="auto"
                onCanPlay={() => void heroVideoRef.current?.play().catch(() => undefined)}
                onError={() => setVideoFailed(true)}
                aria-hidden="true"
              >
                <source src={IMAGE.heroMotion} type="video/mp4" />
              </video>
            )}
          </figure>
          <div className="p7-hero-rim" aria-hidden="true" />
          <div className="p7-hero-copy">
            <SignalLabel>Residential painting / finish calibration</SignalLabel>
            <h1 id="p7-title" data-tkey="text.heroTitle">
              {text?.heroTitle ?? (
                <>
                  <span>Paint under</span>
                  <em>a different</em>
                  <span>voltage.</span>
                </>
              )}
            </h1>
            <p className="p7-hero-dek" data-tkey="text.heroSub">
              {heroSub}
            </p>
            <div className="p7-hero-actions">
              <OrbitalAction onClick={openBooking} tone="signal">
                Request a site visit
              </OrbitalAction>
              <a className="p7-contact-line" href={phoneHref} data-tkey="contact.phone">
                <Circle aria-hidden="true" /> Call {phoneLabel}
              </a>
            </div>
          </div>
          <aside className="p7-pigment-bench" aria-labelledby="p7-bench-title">
            <div className="p7-bench-head">
              <span id="p7-bench-title">PIGMENT BENCH</span>
              <span>07 / 03</span>
            </div>
            <div
              className="p7-lighting-options"
              role="radiogroup"
              aria-label="Workshop lighting profile"
            >
              {lightingProfiles.map((profile, index) => (
                <button
                  id={"p7-light-" + profile.id}
                  key={profile.id}
                  type="button"
                  role="radio"
                  aria-checked={lighting === profile.id}
                  tabIndex={lighting === profile.id ? 0 : -1}
                  className="p7-lighting-option"
                  onClick={() => chooseLighting(profile.id)}
                  onKeyDown={(event) => handleLightingKeyDown(event, index)}
                >
                  <span className="p7-pigment-vial" aria-hidden="true">
                    <i />
                  </span>
                  <span className="p7-pigment-copy">
                    <b>{profile.name}</b>
                    <small>{profile.formula}</small>
                  </span>
                  <span className="p7-pigment-code">{profile.code}</span>
                </button>
              ))}
            </div>
            <div className="p7-bench-readout">
              <i aria-hidden="true" /> ACTIVE: {selectedLighting.code} / {selectedLighting.name}
            </div>
          </aside>
          <div className="p7-hero-technical" aria-hidden="true">
            <span>PIGMENT 07</span>
            <span>HIGH GLOSS*</span>
            <span>LAB STUDY</span>
          </div>
          <p className="p7-hero-truth">
            *Creative finish-study label. Confirm products and performance claims in the written
            scope.
          </p>
          <p className="p7-lighting-live" aria-live="polite" aria-atomic="true">
            {selectedLighting.note}
          </p>
          <figcaption className="p7-hero-caption">
            Generated illustrative workshop study · replace before publishing
          </figcaption>
        </section>

        <section className="p7-manifesto" id="work" aria-labelledby="p7-manifesto-title">
          <div className="p7-manifesto-copy">
            <SignalLabel>{PAINTER_SECTION_COPY.servicesLabel}</SignalLabel>
            <h2 id="p7-manifesto-title" data-tkey="text.manifestoTitle">
              {text?.manifestoTitle ?? (
                <>
                  Build the <em>finish</em> from the surface outward.
                </>
              )}
            </h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
            <p className="p7-truth">{PAINTER_DISCLOSURES.generatedMedia}</p>
          </div>
          <figure className="p7-manifesto-macro">
            <img
              src={overlayMediaUrl(content, "detailImage", IMAGE.macro)}
              width={1350}
              height={1800}
              loading="lazy"
              alt="Illustrative reflective roller loaded with ultraviolet enamel over a polished metal tray"
              data-tkey="media.detailImage"
            />
            <figcaption>TEST ROLL / 1 OF 1 / GENERATED</figcaption>
          </figure>
          <figure className="p7-manifesto-room">
            <img
              src={overlayMediaUrl(content, "interiorImage", IMAGE.interior)}
              width={1920}
              height={1440}
              loading="lazy"
              alt="Illustrative finished ultraviolet feature wall in a contemporary residential living room"
              data-tkey="media.interiorImage"
            />
            <figcaption>LIVE FIELD / INTERIOR / GENERATED</figcaption>
          </figure>
          <div className="p7-manifesto-marker" aria-hidden="true">
            <span>TC</span>
            <i />
          </div>
        </section>

        <section className="p7-calibration" aria-labelledby="p7-calibration-title">
          <figure className="p7-calibration-image">
            <img
              src={overlayMediaUrl(content, "calibrationImage", IMAGE.trim)}
              width={1350}
              height={1800}
              loading="lazy"
              alt="Illustrative gloved painter cutting a precise glossy magenta trim line against indigo trim"
              data-tkey="media.calibrationImage"
            />
          </figure>
          <div className="p7-calibration-copy">
            <SignalLabel>Calibration pass</SignalLabel>
            <h2 id="p7-calibration-title" data-tkey="text.calibrationTitle">
              {calibrationTitle}
            </h2>
            <p>
              Use the pigment bench to audition atmosphere. Then choose the actual color and finish
              beside fixed materials, throughout the day, where the room will be used.
            </p>
            <dl className="p7-dial-readouts">
              <div>
                <dt>
                  <i aria-hidden="true" />
                  01 / COLOR
                </dt>
                <dd>Test physical samples</dd>
              </div>
              <div>
                <dt>
                  <i aria-hidden="true" />
                  02 / SHEEN
                </dt>
                <dd>Match use and light</dd>
              </div>
              <div>
                <dt>
                  <i aria-hidden="true" />
                  03 / SCOPE
                </dt>
                <dd>Write it down</dd>
              </div>
            </dl>
          </div>
          <div className="p7-calibration-scale" aria-hidden="true">
            <span>LOW</span>
            <i />
            <span>HIGH</span>
          </div>
        </section>

        <section className="p7-surface-bay" id="surfaces" aria-labelledby="p7-surfaces-title">
          <div className="p7-bay-heading">
            <SignalLabel>01 / surface channels</SignalLabel>
            <h2 id="p7-surfaces-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div className="p7-service-rack">
            {surfaces.map((surface, index) => (
              <article key={surface.title} className={"p7-service-card p7-service-card--" + index}>
                <figure>
                  <img
                    src={overlayMediaUrl(content, `serviceImage${index + 1}`, surface.image)}
                    width={1920}
                    height={1440}
                    loading="lazy"
                    alt={surface.alt}
                    data-tkey={`media.serviceImage${index + 1}`}
                  />
                  <figcaption>
                    {surface.channel} / {surface.treatment}
                  </figcaption>
                </figure>
                <div className="p7-service-info">
                  <span>{surface.scope}</span>
                  <h3>{surface.title}</h3>
                  <p>{surface.text}</p>
                  <i aria-hidden="true">
                    <ArrowDownRight />
                  </i>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="p7-comparison" aria-labelledby="p7-comparison-title">
          <div className="p7-comparison-head">
            <SignalLabel>{PAINTER_SECTION_COPY.proofLabel}</SignalLabel>
            <h2 id="p7-comparison-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div className="p7-compare-stage" aria-label="Illustrative paint-only comparison">
            <figure className="p7-compare-before">
              <img
                src={IMAGE.proofBefore}
                width={1920}
                height={1440}
                loading="lazy"
                alt="Illustrative room before paint-only work, with a tired charcoal-violet wall and minor patch texture"
              />
              <figcaption>
                <span>INPUT</span> BEFORE / CONDITION STUDY
              </figcaption>
            </figure>
            <div className="p7-compare-axis" aria-hidden="true">
              <span>PAINT ONLY</span>
              <i />
              <b>→</b>
            </div>
            <figure className="p7-compare-after">
              <img
                src={IMAGE.proofAfter}
                width={1920}
                height={1440}
                loading="lazy"
                alt="Illustrative matched room after paint-only work, with a clean ultraviolet wall and crisp existing trim"
              />
              <figcaption>
                <span>OUTPUT</span> AFTER / FINISH STUDY
              </figcaption>
            </figure>
          </div>
          <div className="p7-comparison-legend">
            <span>
              <i /> MATCHED CAMERA
            </span>
            <span>
              <i /> PAINT CHANGE
            </span>
            <span>
              <i /> ILLUSTRATIVE
            </span>
          </div>
        </section>

        <section className="p7-method" id="process" aria-labelledby="p7-method-title">
          <div className="p7-method-heading">
            <SignalLabel>02 / {PAINTER_SECTION_COPY.processLabel}</SignalLabel>
            <h2 id="p7-method-title" data-tkey="text.processHeading">
              {processHeading}
            </h2>
            <p data-tkey="text.processIntro">{processIntro}</p>
          </div>
          <ol className="p7-method-loop">
            {PAINTER_PROCESS.map((step, index) => (
              <li key={step.title}>
                <div className="p7-method-index">
                  <span>0{index + 1}</span>
                  <i />
                </div>
                <figure>
                  <img
                    src={overlayMediaUrl(content, `processImage${index + 1}`, processImages[index])}
                    width={1920}
                    height={1440}
                    loading="lazy"
                    data-tkey={`media.processImage${index + 1}`}
                    alt={processAlts[index]}
                  />
                </figure>
                <div className="p7-method-copy">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="p7-planning-desk" id="notes" aria-labelledby="p7-notes-title">
          <div className="p7-note-stack">
            <figure>
              <img
                src={overlayMediaUrl(content, "planningImage", IMAGE.planning)}
                width={1920}
                height={1440}
                loading="lazy"
                alt="Illustrative physical ultraviolet, lime, and magenta finish boards on a polished metal painting workbench"
                data-tkey="media.planningImage"
              />
              <figcaption>PHYSICAL BOARD / GENERATED</figcaption>
            </figure>
            <div className="p7-note-chip">
              <span>COLOR</span>
              <b>7° / 22° / 33°</b>
              <i aria-hidden="true" />
            </div>
          </div>
          <div className="p7-planning-copy">
            <SignalLabel>03 / {PAINTER_SECTION_COPY.planningLabel}</SignalLabel>
            <h2 id="p7-notes-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <ol>
              {PAINTER_PLANNING_NOTES.map((note, index) => (
                <li key={note.label}>
                  <span>0{index + 1}</span>
                  <div>
                    <b>{note.label}</b>
                    <h3>{note.title}</h3>
                    <p>{note.text}</p>
                  </div>
                  <i aria-hidden="true">
                    <Plus />
                  </i>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="p7-proof-wall" aria-labelledby="p7-reviews-title">
          <div className="p7-proof-image">
            <img
              src={overlayMediaUrl(content, "reviewsImage", IMAGE.reviews)}
              width={1920}
              height={1440}
              loading="lazy"
              alt="Illustrative polished steel, reflective violet vinyl, and ultraviolet enamel material study"
              data-tkey="media.reviewsImage"
            />
          </div>
          <div className="p7-proof-copy">
            <SignalLabel>04 / proof wall</SignalLabel>
            <h2 id="p7-reviews-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            <p data-tkey="text.reviewsBody">{reviewsBody}</p>
            {overlayReviews && overlayReviews.length > 0 ? (
              <div className="p7-empty-slots">
                {overlayReviews.map((review, index) => (
                  <article key={`${review.author}-${index}`}>
                    <span>0{index + 1}</span>
                    <div>
                      <blockquote data-tkey={`reviews.${index}.quote`}>{review.quote}</blockquote>
                      <b data-tkey={`reviews.${index}.author`}>{review.author}</b>
                    </div>
                  </article>
                ))}
              </div>
            ) : overlayReviews === null ? (
              <div className="p7-empty-slots">
                {reviewSlots.map((slot, index) => (
                  <article key={slot.role}>
                    <span>0{index + 1}</span>
                    <div>
                      <b>{slot.role}</b>
                      <small>{slot.source} / verification required</small>
                    </div>
                    <i aria-hidden="true">—</i>
                  </article>
                ))}
              </div>
            ) : null}
            {overlayReviews && overlayReviews.length > 0 ? null : (
              <small className="p7-proof-note">
                NO CUSTOMER PROOF INCLUDED / GENERATED MATERIAL STUDY
              </small>
            )}
          </div>
        </section>

        <section className="p7-field-notes" aria-labelledby="p7-faq-title">
          <figure>
            <img
              src={overlayMediaUrl(content, "faqImage", IMAGE.faq)}
              width={1920}
              height={1440}
              loading="lazy"
              alt="Illustrative reflective violet wall with a sharp lime tape line under raking light"
              data-tkey="media.faqImage"
            />
            <figcaption>DETAIL / EDGE CHECK</figcaption>
          </figure>
          <div className="p7-faq-copy">
            <SignalLabel>05 / field notes</SignalLabel>
            <h2 id="p7-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div className="p7-faq-list">
              {PAINTER_FAQS.map(([question, answer], index) => (
                <details key={question} open={index === 0}>
                  <summary>
                    <span>0{index + 1}</span>
                    <b>{question}</b>
                    <i aria-hidden="true">
                      <Plus />
                      <Minus />
                    </i>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="p7-signal-journal" id="journal" aria-labelledby="p7-journal-title">
          <div className="p7-journal-heading">
            <SignalLabel>06 / {PAINTER_SECTION_COPY.blogsLabel}</SignalLabel>
            <h2 id="p7-journal-title" data-tkey="text.journalTitle">
              {journalTitle}
            </h2>
            <p>{PAINTER_SECTION_COPY.blogsIntro}</p>
          </div>
          <div className="p7-journal-tape">
            {PAINTER_BLOG_POSTS.map((post, index) => {
              const overlayPost = content?.blogs?.[index];
              return (
                <article key={post.number}>
                  <div className="p7-article-orb" aria-hidden="true">
                    <span>0{index + 1}</span>
                  </div>
                  <p data-tkey={`blogs.${index}.category`}>
                    {overlayPost?.category ?? post.category}
                  </p>
                  <h3 data-tkey={`blogs.${index}.title`}>{overlayPost?.title ?? post.title}</h3>
                  <span data-tkey={`blogs.${index}.excerpt`}>
                    {overlayPost?.excerpt ?? post.excerpt}
                  </span>
                  <i>
                    Planning guide <ArrowUpRight aria-hidden="true" />
                  </i>
                </article>
              );
            })}
          </div>
          <p className="p7-truth">{PAINTER_SECTION_COPY.blogsDisclosure}</p>
        </section>

        <section className="p7-final-bench" aria-labelledby="p7-estimate-title">
          <figure>
            <img
              src={overlayMediaUrl(content, "estimateImage", IMAGE.estimate)}
              width={2560}
              height={1440}
              loading="lazy"
              alt="Illustrative organized painter workbench with roller, brushes, polished tray, and fluorescent finish samples"
              data-tkey="media.estimateImage"
            />
          </figure>
          <div className="p7-final-panel">
            <SignalLabel>07 / {PAINTER_SECTION_COPY.estimateLabel}</SignalLabel>
            <h2 id="p7-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <p data-tkey="text.estimateIntro">{estimateIntro}</p>
            <ul>
              {PAINTER_ESTIMATE_ITEMS.map((item, index) => (
                <li key={item}>
                  <span>0{index + 1}</span>
                  {item}
                  <Check aria-hidden="true" />
                </li>
              ))}
            </ul>
            <OrbitalAction onClick={openBooking} tone="signal">
              Request a site visit
            </OrbitalAction>
            <small>{PAINTER_DISCLOSURES.demo}</small>
          </div>
        </section>
      </main>

      <footer className="p7-footer">
        <a className="p7-footer-mark" href="#top" aria-label={brandAria}>
          <span
            className="p7-brand-mark overlay-brand-mark"
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" />
            ) : brandInitials ? (
              <b>{brandInitials}</b>
            ) : (
              <>
                <b>T</b>
                <b>C</b>
              </>
            )}
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
        <p>
          Fictional finish-lab template
          <br />
          Ultraviolet Workshop / 07
        </p>
        <div>
          <a href={phoneHref} data-tkey="contact.phone">
            {phoneLabel} <ArrowUpRight aria-hidden="true" />
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {emailLabel} <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
        <p>{PAINTER_DISCLOSURES.footer}</p>
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
