import { ArrowUp, ArrowUpRight, Check, ChevronDown, ScanLine, Star } from "lucide-react";
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
import "./painter-ten/painter-ten.css";

const MEDIA = "/templates/midnight-lacquer/generated";
const PHONE_HREF = "tel:+15550137482";
const PHONE_LABEL = "(555) 013-7482";

const IMAGE = {
  hero: MEDIA + "/hero.jpg",
  heroMotion: MEDIA + "/hero-motion.mp4",
  macro: MEDIA + "/finish-macro.jpg",
  interior: MEDIA + "/interior.jpg",
  door: MEDIA + "/door.jpg",
  cabinetry: MEDIA + "/cabinetry.jpg",
  exterior: MEDIA + "/exterior.jpg",
  before: MEDIA + "/proof-before.jpg",
  after: MEDIA + "/proof-after.jpg",
  inspect: MEDIA + "/inspect.jpg",
  protect: MEDIA + "/protect.jpg",
  repair: MEDIA + "/repair.jpg",
  prepare: MEDIA + "/prepare.jpg",
  finish: MEDIA + "/finish.jpg",
  planning: MEDIA + "/planning.jpg",
  reviews: MEDIA + "/reviews.jpg",
  faq: MEDIA + "/faq.jpg",
  estimate: MEDIA + "/estimate.jpg",
  journal: [MEDIA + "/blog-color.jpg", MEDIA + "/blog-prep.jpg", MEDIA + "/blog-sheen.jpg"],
} as const;

const finishes = [
  ["matte", "Matte", "03-10", "Diffuse light. Quiet surface."],
  ["satin", "Satin", "20-35", "Soft glow. Controlled reflection."],
  ["gloss", "Gloss", "45-70", "Tight highlight. Preparation revealed."],
  ["high-gloss", "High gloss", "80+", "Mirror response. Nothing concealed."],
] as const;

type FinishId = (typeof finishes)[number][0];

const chapters = [
  {
    title: PAINTER_SERVICES[0].title,
    scope: PAINTER_SERVICES[0].short,
    text: PAINTER_SERVICES[0].text,
    image: IMAGE.interior,
    width: 2800,
    height: 1575,
    alt: "Illustrative dark dining room with a graphite painted wall under champagne light",
    finish: "GRAPHITE / SATIN",
  },
  {
    title: "Trim & doors",
    scope: "Doors / trim / architectural detail",
    text: PAINTER_SURFACE_COPY.trim,
    image: IMAGE.door,
    width: 2100,
    height: 2800,
    alt: "Illustrative paneled residential door in deep oxblood high-gloss paint",
    finish: "OXBLOOD / HIGH GLOSS",
  },
  {
    title: PAINTER_SERVICES[2].title,
    scope: PAINTER_SERVICES[2].short,
    text: PAINTER_SERVICES[2].text,
    image: IMAGE.cabinetry,
    width: 2800,
    height: 2100,
    alt: "Illustrative kitchen with obsidian lacquer cabinetry and champagne hardware",
    finish: "OBSIDIAN / GLOSS",
  },
  {
    title: PAINTER_SERVICES[1].title,
    scope: PAINTER_SERVICES[1].short,
    text: PAINTER_SERVICES[1].text,
    image: IMAGE.exterior,
    width: 2800,
    height: 1575,
    alt: "Illustrative modern residence with graphite siding and an oxblood entry door",
    finish: "GRAPHITE / LOW LUSTRE",
  },
] as const;

const processImages = [IMAGE.inspect, IMAGE.protect, IMAGE.repair, IMAGE.prepare, IMAGE.finish];
const processAlts = [
  "Graphite wall being inspected under a narrow raking light",
  "Luxury room fully protected before painting",
  "Controlled wall repair under low inspection light",
  "Black paneled door prepared with precise cobalt masking tape",
  "Painter applying oxblood lacquer in a controlled finishing booth",
];

const sampleReviews = [
  {
    quote:
      "The sample planning flow made it easy to understand what we would discuss before any work began.",
    name: "Jordan M.",
    project: "Sample interior inquiry",
  },
  {
    quote:
      "We appreciated seeing color, preparation, access, and timing treated as one connected decision.",
    name: "Alex R.",
    project: "Sample exterior inquiry",
  },
  {
    quote: "The preview set clear expectations about surfaces, protection, and the written scope.",
    name: "Taylor K.",
    project: "Sample cabinet inquiry",
  },
] as const;

function Stars() {
  return (
    <span className="p10-stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((index) => (
        <Star key={index} />
      ))}
    </span>
  );
}

// Responsive variants (`*-960.jpg`, `*-1600.jpg`) are generated from each full-size
// midnight-lacquer asset so small screens never download 2800px originals.
function srcSetFor(src: string, fullWidth: number) {
  const base = src.replace(/\.jpg$/, "");
  return `${base}-960.jpg 960w, ${base}-1600.jpg 1600w, ${src} ${fullWidth}w`;
}

function Action({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  return (
    <button type="button" className={`p10-action ${className}`} onClick={onClick}>
      <span>{children}</span>
      <ArrowUpRight aria-hidden="true" />
    </button>
  );
}

function Index({ children }: { children: React.ReactNode }) {
  return <p className="p10-index">{children}</p>;
}

export function PainterTenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "A finish that holds the light.";
  const heroSub =
    text?.heroSub ??
    "We plan color, surface, preparation, application, and sheen for the rooms you actually live in, then put that plan in writing.";
  const detailTitle = text?.detailTitle ?? "The surface tells the truth when the light moves.";
  const detailBody =
    text?.detailBody ??
    "A dark finish amplifies preparation, edge control, application, and every change in light.";
  const servicesHeading = text?.servicesHeading ?? PAINTER_SECTION_COPY.servicesHeading;
  const servicesIntro = text?.servicesIntro ?? PAINTER_SECTION_COPY.servicesIntro;
  const proofTitle = text?.proofTitle ?? "One room. One angle. Paint only.";
  const proofBody = text?.proofBody ?? PAINTER_SECTION_COPY.proofBody;
  const processTitle = text?.processTitle ?? "Preparation becomes the finish.";
  const processIntro = text?.processIntro ?? PAINTER_SECTION_COPY.processIntro;
  const planHeading = text?.planHeading ?? "Decisions made before the first coat.";
  const planIntro = text?.planIntro ?? PAINTER_SECTION_COPY.planningIntro;
  const reviewsHeading = text?.reviewsHeading ?? "Customer voices belong in the finish.";
  const faqTitle = text?.faqTitle ?? "Ask before the first coat.";
  const journalTitle = text?.journalTitle ?? "Read the finish before choosing it.";
  const journalIntro = text?.journalIntro ?? PAINTER_SECTION_COPY.blogsIntro;
  const estimateTitle = text?.estimateTitle ?? "Bring the details. Leave with a plan.";
  const rawPhone = content?.phone?.trim() ? content.phone.trim() : null;
  const phoneLabel = rawPhone ?? PHONE_LABEL;
  const phoneHref = rawPhone ? `tel:${rawPhone.replace(/[^\d+]/g, "")}` : PHONE_HREF;
  const emailLabel = content?.email?.trim() ? content.email.trim() : "hello@example.com";
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
  const heroSrcSet = heroPoster === IMAGE.hero ? srcSetFor(IMAGE.hero, 2800) : undefined;
  const detailImage = overlayMediaUrl(content, "detailImage", IMAGE.macro);
  const planningImage = overlayMediaUrl(content, "planningImage", IMAGE.planning);
  const reviewsImage = overlayMediaUrl(content, "reviewsImage", IMAGE.reviews);
  const faqImage = overlayMediaUrl(content, "faqImage", IMAGE.faq);
  const estimateImage = overlayMediaUrl(content, "estimateImage", IMAGE.estimate);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [finish, setFinish] = useState<FinishId>("gloss");
  const [comparison, setComparison] = useState(54);
  const stageRef = useRef<HTMLDivElement>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const bookingTriggerRef = useRef<HTMLButtonElement>(null);
  const activeFinishRef = useRef<FinishId>("gloss");
  const reducedMotionRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef({ x: 62.5, y: 44 });
  const selectedFinish = finishes.find(([id]) => id === finish) ?? finishes[2];

  useEffect(() => {
    const video = videoRef.current;
    if (videoFailed || !video) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedMotionRef.current = motion.matches;
      if (document.hidden || motion.matches) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, [videoFailed]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function openBooking(event: React.MouseEvent<HTMLButtonElement>) {
    bookingTriggerRef.current = event.currentTarget;
    setBookingOpen(true);
  }

  function positionLight(x: number, y = 44) {
    stageRef.current?.style.setProperty("--light-x", `${x}%`);
    stageRef.current?.style.setProperty("--light-y", `${y}%`);
  }

  function chooseFinish(next: FinishId, move = true) {
    activeFinishRef.current = next;
    setFinish(next);
    if (move) positionLight(finishes.findIndex(([id]) => id === next) * 25 + 12.5);
  }

  function moveLight(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || reducedMotionRef.current) {
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    pendingRef.current = {
      x: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const { x, y } = pendingRef.current;
      positionLight(x, y);
      const next = finishes[Math.min(3, Math.floor(x / 25))][0];
      if (next !== activeFinishRef.current) chooseFinish(next, false);
    });
  }

  function moveFinishByKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = finishes[event.key === "Home" ? 0 : finishes.length - 1];
      chooseFinish(next[0]);
      document.getElementById(`p10-finish-${next[0]}`)?.focus();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = finishes[(index + delta + finishes.length) % finishes.length];
    chooseFinish(next[0]);
    document.getElementById(`p10-finish-${next[0]}`)?.focus();
  }

  function setComparisonFromClientX(clientX: number) {
    const stage = comparisonRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    setComparison(
      Math.round(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100))),
    );
  }

  function handleComparisonKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const increments: Record<string, number> = {
      ArrowLeft: -1,
      ArrowDown: -1,
      ArrowRight: 1,
      ArrowUp: 1,
      PageDown: -10,
      PageUp: 10,
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setComparison(event.key === "Home" ? 0 : 100);
      return;
    }
    const increment = increments[event.key];
    if (increment === undefined) return;
    event.preventDefault();
    setComparison((current) => Math.min(100, Math.max(0, current + increment)));
  }

  return (
    <div className="p10" id="top">
      <a className="p10-skip" href="#main">
        Skip to content
      </a>

      <header className="p10-header">
        <a className="p10-brand" href="#top" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <strong className="overlay-brand-name">{brandLabel}</strong>
          <span>RESIDENTIAL / INTERIOR–EXTERIOR</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#surfaces">Surfaces</a>
          <a href="#proof">Proof</a>
          <a href="#method">Method</a>
          <a href="#notes">Notes</a>
        </nav>
        <Action onClick={openBooking}>Request a visit</Action>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="p10-hero" aria-labelledby="p10-title">
          <div
            className="p10-hero-slit"
            data-finish={finish}
            ref={stageRef}
            onPointerMove={moveLight}
          >
            <figure
              data-video-failed={videoFailed || undefined}
              role="img"
              aria-label="Illustrative almost-black residential room with a glossy obsidian wall catching a narrow showroom highlight"
            >
              <img
                className="p10-hero-poster"
                src={heroPoster}
                srcSet={heroSrcSet}
                sizes="100vw"
                width={2800}
                height={1200}
                alt=""
                fetchPriority="high"
                data-tkey="media.heroPoster"
              />
              <video
                ref={videoRef}
                autoPlay
                muted
                loop
                playsInline
                poster={heroPoster}
                preload="auto"
                onCanPlay={() => {
                  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                    void videoRef.current?.play().catch(() => undefined);
                  }
                }}
                onError={() => setVideoFailed(true)}
                aria-hidden="true"
              >
                <source
                  src={IMAGE.heroMotion}
                  type="video/mp4"
                  media="(prefers-reduced-motion: no-preference)"
                />
              </video>
              <img
                className="p10-hero-reveal"
                src={heroPoster}
                srcSet={heroSrcSet}
                sizes="100vw"
                width={2800}
                height={1200}
                alt=""
                aria-hidden="true"
              />
            </figure>
            <div className="p10-light" aria-hidden="true" />
            <p>Generated finish study / replace before publishing</p>
          </div>
          <div className="p10-hero-copy">
            <Index>MIDNIGHT LACQUER / RESIDENTIAL PAINTING</Index>
            <h1 id="p10-title" data-tkey="text.heroTitle">
              {heroTitle}
            </h1>
            <p data-tkey="text.heroSub">{heroSub}</p>
            <Action onClick={openBooking}>Request a site visit</Action>
            <a className="p10-call" href={phoneHref} data-tkey="contact.phone">
              Prefer to talk? Call {phoneLabel}
            </a>
          </div>
          <div className="p10-finish-line">
            <div className="p10-finish-prompt">
              <ScanLine aria-hidden="true" />
              <span>Move the inspection light</span>
            </div>
            <div role="radiogroup" aria-label="Finish inspection">
              {finishes.map(([id, label, code], index) => (
                <button
                  id={`p10-finish-${id}`}
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={finish === id}
                  tabIndex={finish === id ? 0 : -1}
                  onClick={() => chooseFinish(id)}
                  onKeyDown={(event) => moveFinishByKey(event, index)}
                >
                  <span>{code}</span>
                  {label}
                </button>
              ))}
            </div>
            <p aria-live="polite">
              <b>{selectedFinish[1]}</b> {selectedFinish[3]}
            </p>
          </div>
        </section>

        <section className="p10-overture" aria-labelledby="p10-overture-title">
          <figure>
            <img
              src={detailImage}
              srcSet={detailImage === IMAGE.macro ? srcSetFor(IMAGE.macro, 2100) : undefined}
              sizes="(max-width: 760px) 100vw, 72vw"
              width={2100}
              height={2800}
              loading="lazy"
              decoding="async"
              alt="Illustrative macro of obsidian lacquer with a champagne reflection"
              data-tkey="media.detailImage"
            />
          </figure>
          <div>
            <Index>00 / POINT OF VIEW</Index>
            <h2 id="p10-overture-title" data-tkey="text.detailTitle">
              {detailTitle}
            </h2>
            <p data-tkey="text.detailBody">{detailBody}</p>
          </div>
          <p className="p10-overture-truth">{PAINTER_DISCLOSURES.generatedMedia}</p>
          <dl>
            <div>
              <dt>COLOR</dt>
              <dd>Test beside fixed materials</dd>
            </div>
            <div>
              <dt>FINISH</dt>
              <dd>Match coating to surface</dd>
            </div>
            <div>
              <dt>SHEEN</dt>
              <dd>Read under changing light</dd>
            </div>
            <div>
              <dt>APPLICATION</dt>
              <dd>Write method into scope</dd>
            </div>
          </dl>
        </section>

        <section className="p10-chapters" id="surfaces" aria-labelledby="p10-surfaces-title">
          <div className="p10-free-heading">
            <Index>01 / {PAINTER_SECTION_COPY.servicesLabel}</Index>
            <h2 id="p10-surfaces-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          {chapters.map((chapter, index) => {
            const chapterSrc = overlayMediaUrl(content, `serviceImage${index + 1}`, chapter.image);
            return (
              <article key={chapter.title} className={`p10-chapter p10-chapter--${index + 1}`}>
                <figure>
                  <img
                    src={chapterSrc}
                    srcSet={
                      chapterSrc === chapter.image
                        ? srcSetFor(chapter.image, chapter.width)
                        : undefined
                    }
                    sizes="100vw"
                    width={chapter.width}
                    height={chapter.height}
                    loading="lazy"
                    decoding="async"
                    alt={chapter.alt}
                    data-tkey={`media.serviceImage${index + 1}`}
                  />
                </figure>
                <div className="p10-chapter-number" aria-hidden="true">
                  0{index + 1}
                </div>
                <div className="p10-chapter-copy">
                  <Index>{chapter.finish}</Index>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.text}</p>
                  <span>{chapter.scope}</span>
                </div>
              </article>
            );
          })}
        </section>

        <section className="p10-proof" id="proof" aria-labelledby="p10-proof-title">
          <div className="p10-proof-copy">
            <Index>02 / {PAINTER_SECTION_COPY.proofLabel}</Index>
            <h2 id="p10-proof-title" data-tkey="text.proofTitle">
              {proofTitle}
            </h2>
            <p data-tkey="text.proofBody">{proofBody}</p>
          </div>
          <div
            className="p10-proof-stage"
            ref={comparisonRef}
            role="group"
            aria-label="Illustrative matched-camera paint-only comparison"
            style={{ "--p10-compare": `${comparison}%` } as React.CSSProperties}
          >
            <figure className="p10-proof-after">
              <img
                src={IMAGE.after}
                srcSet={srcSetFor(IMAGE.after, 2800)}
                sizes="100vw"
                width={2800}
                height={1575}
                loading="lazy"
                decoding="async"
                alt="Illustrative library after paint-only work, with obsidian built-ins and an oxblood niche"
              />
              <figcaption>AFTER / OBSIDIAN + OXBLOOD</figcaption>
            </figure>
            <figure className="p10-proof-before">
              <img
                src={IMAGE.before}
                srcSet={srcSetFor(IMAGE.before, 2800)}
                sizes="100vw"
                width={2800}
                height={1575}
                loading="lazy"
                decoding="async"
                alt="Illustrative matched library before paint-only work, with tired beige built-ins"
              />
              <figcaption>BEFORE / EXISTING CONDITION</figcaption>
            </figure>
            <div className="p10-proof-scan" aria-hidden="true">
              <i />
              <span>PAINT PASS</span>
            </div>
            <div
              className="p10-proof-slider"
              role="slider"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={comparison}
              aria-label="Reveal the illustrative before and after paint views"
              aria-valuetext={`${comparison}% before view visible`}
              onKeyDown={handleComparisonKeyDown}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setComparisonFromClientX(event.clientX);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  setComparisonFromClientX(event.clientX);
                }
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            />
          </div>
          <div className="p10-proof-facts" aria-label="Comparison details">
            <span>LOCKED CAMERA</span>
            <span>PAINT CHANGE ONLY</span>
            <span>ILLUSTRATIVE / NOT A CLIENT PROJECT</span>
          </div>
          <small>Generated matched-scene study. Not a documented client transformation.</small>
        </section>

        <section className="p10-method" id="method" aria-labelledby="p10-method-title">
          <div className="p10-free-heading p10-free-heading--light">
            <Index>03 / {PAINTER_SECTION_COPY.processLabel}</Index>
            <h2 id="p10-method-title" data-tkey="text.processTitle">
              {processTitle}
            </h2>
            <p data-tkey="text.processIntro">{processIntro}</p>
          </div>
          <ol className="p10-method-ribbon">
            {PAINTER_PROCESS.map((step, index) => {
              const processSrc = overlayMediaUrl(
                content,
                `processImage${index + 1}`,
                processImages[index],
              );
              return (
                <li key={step.title}>
                  <figure>
                    <img
                      src={processSrc}
                      srcSet={
                        processSrc === processImages[index]
                          ? srcSetFor(processImages[index], 2560)
                          : undefined
                      }
                      sizes="100vw"
                      width={2560}
                      height={1440}
                      loading="lazy"
                      decoding="async"
                      data-tkey={`media.processImage${index + 1}`}
                      alt={processAlts[index]}
                    />
                  </figure>
                  <div>
                    <span>0{index + 1}</span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="p10-notes" id="notes" aria-labelledby="p10-notes-title">
          <figure>
            <img
              src={planningImage}
              srcSet={
                planningImage === IMAGE.planning ? srcSetFor(IMAGE.planning, 2560) : undefined
              }
              sizes="100vw"
              width={2560}
              height={1440}
              loading="lazy"
              decoding="async"
              alt="Illustrative black-glass table with finish samples"
              data-tkey="media.planningImage"
            />
          </figure>
          <div className="p10-notes-title">
            <Index>04 / {PAINTER_SECTION_COPY.planningLabel}</Index>
            <h2 id="p10-notes-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
          </div>
          <ol aria-label="Project planning notes">
            {PAINTER_PLANNING_NOTES.map((note, index) => (
              <li key={note.label}>
                <span>
                  0{index + 1} / {note.label}
                </span>
                <h3>{note.title}</h3>
                <p>{note.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="p10-reviews" aria-labelledby="p10-reviews-title">
          <figure>
            <img
              src={reviewsImage}
              srcSet={reviewsImage === IMAGE.reviews ? srcSetFor(IMAGE.reviews, 2560) : undefined}
              sizes="100vw"
              width={2560}
              height={1440}
              loading="lazy"
              decoding="async"
              alt="Illustrative completed library with obsidian built-ins"
              data-tkey="media.reviewsImage"
            />
          </figure>
          <div className="p10-reviews-heading">
            <Index>{overlayReviews ? "05 / REVIEWS" : "05 / SAMPLE REVIEW LAYOUT"}</Index>
            <h2 id="p10-reviews-title" data-tkey="text.reviewsHeading">
              {reviewsHeading}
            </h2>
            {overlayReviews ? null : (
              <p>
                These fictional quotes demonstrate the review layout only. Replace every sample with
                real, permissioned feedback before publishing.
              </p>
            )}
          </div>
          {overlayReviews && overlayReviews.length > 0 ? (
            <div className="p10-review-voices">
              {overlayReviews.map((review, index) => (
                <blockquote key={`${review.author}-${index}`}>
                  <span aria-hidden="true">0{index + 1}</span>
                  <p data-tkey={`reviews.${index}.quote`}>“{review.quote}”</p>
                  <footer>
                    <b data-tkey={`reviews.${index}.author`}>{review.author}</b>
                  </footer>
                </blockquote>
              ))}
            </div>
          ) : overlayReviews === null ? (
            <>
              <div className="p10-review-voices">
                {sampleReviews.map((review, index) => (
                  <blockquote key={review.project}>
                    <span aria-hidden="true">0{index + 1}</span>
                    <p>“{review.quote}”</p>
                    <footer>
                      <b>{review.name} / fictional sample</b>
                      <small>{review.project}</small>
                      <span className="p10-review-source">
                        <Stars />
                        <em>Sample review — replace with permissioned feedback</em>
                      </span>
                    </footer>
                  </blockquote>
                ))}
              </div>
              <p className="p10-reviews-disclosure">{PAINTER_DISCLOSURES.reviews}</p>
            </>
          ) : null}
        </section>

        <section className="p10-questions" aria-labelledby="p10-faq-title">
          <figure>
            <img
              src={faqImage}
              srcSet={faqImage === IMAGE.faq ? srcSetFor(IMAGE.faq, 1728) : undefined}
              sizes="(max-width: 760px) 100vw, 72vw"
              width={1728}
              height={2304}
              loading="lazy"
              decoding="async"
              alt="Illustrative oxblood gloss edge meeting graphite trim"
              data-tkey="media.faqImage"
            />
          </figure>
          <div className="p10-questions-copy">
            <Index>06 / FIELD NOTES</Index>
            <h2 id="p10-faq-title" data-tkey="text.faqTitle">
              {faqTitle}
            </h2>
            <div>
              {PAINTER_FAQS.map(([question, answer], index) => (
                <details key={question} open={index === 0}>
                  <summary>
                    <span>0{index + 1}</span>
                    <b>{question}</b>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="p10-journal" aria-labelledby="p10-journal-title">
          <div className="p10-free-heading">
            <Index>07 / {PAINTER_SECTION_COPY.blogsLabel}</Index>
            <h2 id="p10-journal-title" data-tkey="text.journalTitle">
              {journalTitle}
            </h2>
            <p data-tkey="text.journalIntro">{journalIntro}</p>
          </div>
          <div className="p10-journal-scroll">
            {PAINTER_BLOG_POSTS.map((post, index) => {
              const overlayPost = content?.blogs?.[index];
              const guideFallback = IMAGE.journal[index];
              const guideSrc = overlayMediaUrl(content, `guideImage${index + 1}`, guideFallback);
              return (
                <article key={post.number}>
                  <figure>
                    <img
                      src={guideSrc}
                      srcSet={
                        guideSrc === guideFallback
                          ? srcSetFor(guideFallback, index === 2 ? 2800 : 2560)
                          : undefined
                      }
                      sizes="100vw"
                      width={index === 2 ? 2800 : 2560}
                      height={index === 2 ? 1575 : 1440}
                      loading="lazy"
                      decoding="async"
                      alt="Illustrative residential paint planning study"
                      data-tkey={`media.guideImage${index + 1}`}
                    />
                  </figure>
                  <div>
                    <span data-tkey={`blogs.${index}.category`}>
                      {post.number} / {overlayPost?.category ?? post.category}
                    </span>
                    <h3 data-tkey={`blogs.${index}.title`}>{overlayPost?.title ?? post.title}</h3>
                    <p data-tkey={`blogs.${index}.excerpt`}>
                      {overlayPost?.excerpt ?? post.excerpt}
                    </p>
                    <small>Sample guide</small>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="p10-journal-truth">{PAINTER_SECTION_COPY.blogsDisclosure}</p>
        </section>

        <section className="p10-close" aria-labelledby="p10-estimate-title">
          <figure>
            <img
              src={estimateImage}
              srcSet={
                estimateImage === IMAGE.estimate ? srcSetFor(IMAGE.estimate, 2800) : undefined
              }
              sizes="100vw"
              width={2800}
              height={1200}
              loading="lazy"
              decoding="async"
              alt="Illustrative panoramic finishing bench with dark samples"
              data-tkey="media.estimateImage"
            />
          </figure>
          <div className="p10-close-copy">
            <Index>08 / {PAINTER_SECTION_COPY.estimateLabel}</Index>
            <h2 id="p10-estimate-title" data-tkey="text.estimateTitle">
              {estimateTitle}
            </h2>
            <Action onClick={openBooking}>Request a site visit</Action>
            <a className="p10-call" href={phoneHref} data-tkey="contact.phone">
              Prefer to talk? Call {phoneLabel}
            </a>
            <p className="p10-license">
              Licensed · Bonded · Insured — CA CSLB #0000000 · Serving the greater metro area.
              Sample credential line — replace with real license before publishing.
            </p>
          </div>
          <ul>
            {PAINTER_ESTIMATE_ITEMS.map((item, index) => (
              <li key={item}>
                <span>0{index + 1}</span>
                {item}
                <Check aria-hidden="true" />
              </li>
            ))}
          </ul>
          <small>{PAINTER_DISCLOSURES.demo}</small>
          <a href="#top" className="p10-to-top">
            Top <ArrowUp aria-hidden="true" />
          </a>
        </section>
      </main>

      <footer className="p10-footer">
        <a href="#top">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : brandMark}
          </span>
          <span className="overlay-brand-name">{brandLabel}</span>
          <ArrowUpRight aria-hidden="true" />
        </a>
        <p>Midnight Lacquer / fictional painter template</p>
        <div>
          <a href={phoneHref} data-tkey="contact.phone">
            {phoneLabel}
          </a>
          <a href={emailHref} data-tkey="contact.email">
            {emailLabel}
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
