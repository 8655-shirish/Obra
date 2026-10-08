import { ArrowDown, ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import {
  overlayLogoUrl,
  overlayMediaUrl,
  withOverlayBlogPost,
  type TemplateMoldContent,
} from "@/lib/template-content/overlay";

import { PainterProjectPlanner } from "./PainterProjectPlanner";
import { PainterTemplateDialog } from "./PainterTemplateDialog";
import media from "./painter-seventeen/media.json";

import "./overlay-fit.css";
import "./painter-seventeen/painter-seventeen.css";

const notes = [
  {
    id: "colour",
    number: "01",
    category: "Colour / daylight",
    title: "Let the mountain light have a say.",
    image: "pine-finish",
    intro:
      "A cabin colour has more neighbours than its trim. The roof, timber door, gravel and evergreens all change how a painted surface reads.",
    sections: [
      {
        title: "Start with the things that stay",
        body: "Put a sample beside the roof finish, stonework and natural timber before comparing it with another paint colour. Decide whether the siding should sit quietly among those materials or stand apart from them. Give the main wall colour, trim and door separate places in your plan.",
      },
      {
        title: "Move the sample, not the goalposts",
        body: "Use a substantial sample board prepared with the proposed coating system. View it upright on more than one side of the cabin, in direct light and under the eaves. Look again in the morning and later in the day. A screen or a small colour chip cannot show how a whole wall will feel.",
      },
      {
        title: "Write down the complete finish",
        body: "Keep the colour name, manufacturer, product and sheen together. Photograph the approved board in place for your own reference, but retain the physical sample: phone cameras and screens alter colour. Confirm any local or property-specific colour restrictions before ordering paint.",
      },
    ],
  },
  {
    id: "weather",
    number: "02",
    category: "Preparation / weather",
    title: "A dry day is only half the story.",
    image: "weathered-cabin",
    intro:
      "Dry-looking siding can still hold moisture. A useful painting window considers the timber, surface temperature and the hours after application, not just the afternoon forecast.",
    sections: [
      {
        title: "Follow the moisture first",
        body: "Look for leaking gutters, splashback, failed flashing and places where snow or damp planting sits against the wall. Resolve the source before covering a stain or peeling patch. Soft or decayed timber needs assessment and repair, not another coat to hide it.",
      },
      {
        title: "Check the surface, not just the air",
        body: "A sunny wall can be much warmer than the air, while shaded timber stays cold. Check the coating manufacturer's limits for surface temperature, humidity and wood moisture. There is no single temperature or drying interval that suits every product and site.",
      },
      {
        title: "Leave room for the night ahead",
        body: "Review overnight lows, dew, rain and the required rain-free and recoat windows. Plan the order of work around sun and shade, and keep an alternative task for unsuitable weather. Record those conditions in the scope rather than treating a calendar date as a guarantee.",
      },
    ],
  },
  {
    id: "timber",
    number: "03",
    category: "Materials / maintenance",
    title: "Look after the board beneath the colour.",
    image: "timber-care",
    intro:
      "A clean paint line is the visible part. Coating compatibility, sound timber and careful preparation are what make the next maintenance visit easier to plan.",
    sections: [
      {
        title: "Know the existing coating",
        body: "Identify what is already on the siding and whether the new system can bond to it. Cleaning, removing loose coating, feathering edges and priming should follow the substrate and product guidance. Test adhesion in a small area instead of assuming a fresh coat will hold.",
      },
      {
        title: "Make preparation safe",
        body: "Older coatings can contain lead. Before scraping or sanding, arrange appropriate testing and follow local lead-safe requirements; do not dry-sand suspect paint. Plan access, dust control, eye and respiratory protection, and protection for the ground and nearby plants. Leave high or awkward work to people with the right equipment and training.",
      },
      {
        title: "Keep a small maintenance record",
        body: "Note the product, colour, sheen, preparation and application date for each surface. Inspect exposed edges, joints and the lower boards periodically and after harsh weather. Deal with new moisture problems promptly, and keep touch-up material stored as its label directs, away from freezing temperatures.",
      },
    ],
  },
] as const;

const questions = [
  [
    "Paint or stain for exterior timber?",
    "Start with the wood and the existing finish. Opaque paint covers the grain; a translucent stain leaves more of it visible. Compatibility, exposure and the preparation needed matter more than the colour alone. Ask for a small test area and the proposed product system before committing.",
  ],
  [
    "When is a cabin ready for another coat?",
    "Inspect peeling, chalking, open joints and moisture marks rather than relying on a fixed number of years. Check shaded walls, exposed end grain and lower boards separately. Resolve leaks and damaged timber first, and assess older coatings for lead before disturbing them.",
  ],
  [
    "What should an exterior painting scope include?",
    "Name each surface, repairs, preparation, compatible primer and finish, colour and sheen. Include safe access, protection, weather limits, drying and cure guidance, cleanup and exclusions. Agree on how hidden damage will be assessed and approved before extra work begins.",
  ],
] as const;

type PhotoRole = keyof typeof media.photos;
type DialogView = (typeof notes)[number]["id"] | "planner";

function Photo({
  role,
  eager = false,
  sizes = "100vw",
  src,
  tkey,
}: {
  role: PhotoRole;
  eager?: boolean;
  sizes?: string;
  src?: string;
  tkey?: string;
}) {
  const photo = media.photos[role];
  const resolved = src ?? `${media.directory}/${role}.jpg`;
  const catalogSrcSet =
    resolved.startsWith("/templates/") && resolved.endsWith(".jpg")
      ? `${media.directory}/${role}-800.jpg 800w, ${media.directory}/${role}.jpg ${photo.width}w`
      : undefined;
  return (
    <img
      src={resolved}
      srcSet={catalogSrcSet}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={photo.alt}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      data-tkey={tkey}
    />
  );
}

function subscribeToMotion(onChange: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function serverPrefersReducedMotion() {
  return true;
}

function CabinFilm({ poster }: { poster: string }) {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    prefersReducedMotion,
    serverPrefersReducedMotion,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || reducedMotion || failed) return;
    let inView = false;
    const syncPlayback = () => {
      if (document.hidden || !inView) video.pause();
      else void video.play().catch(() => undefined);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        syncPlayback();
      },
      { threshold: 0.05 },
    );
    observer.observe(video);
    document.addEventListener("visibilitychange", syncPlayback);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", syncPlayback);
      video.pause();
    };
  }, [reducedMotion, failed]);

  return (
    <>
      <div className="p17-hero-media">
        <Photo role="hero" eager src={poster} tkey="media.heroPoster" />
        {/* SSR and reduced-motion visits contain no video source to request. */}
        {!reducedMotion && !failed ? (
          <video
            ref={videoRef}
            src={`${media.directory}/${media.film.file}`}
            poster={poster}
            className={ready ? "p17-film-ready" : undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            onLoadedData={() => setReady(true)}
            onError={() => setFailed(true)}
          />
        ) : null}
      </div>
    </>
  );
}

export function PainterSeventeenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTagline = text?.heroTagline ?? "For the place you come back to.";
  const heroTitle = text?.heroTitle ?? "A little cabin.";
  const heroAccent = text?.heroAccent ?? "A bolder coat.";
  const heroSub =
    text?.heroSub ?? "Cabin colour, sound timber and a practical plan for the next coat.";
  const studiesTitle = text?.studiesTitle ?? "Cabin colour studies.";
  const detailTitle = text?.detailTitle ?? "Timber before colour.";
  const detailBody =
    text?.detailBody ??
    "Resolve moisture. Check the old coating. Give sound wood a compatible finish.";
  const journalTitle = text?.journalTitle ?? "Notes for the next coat.";
  const journalIntro = text?.journalIntro ?? "Three practical reads before you open a tin.";
  const planHeading = text?.planHeading ?? "Make a plan.";
  const planIntro =
    text?.planIntro ?? "Your surfaces, colour notes and questions, in one handy checklist.";
  const footerBlurb = text?.footerBlurb ?? "Timber. Colour. Care.";
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "Alpine Enamel";
  const brandAria = brandName ? `${brandName}, back to top` : "Alpine Enamel, back to top";
  const logoUrl = overlayLogoUrl(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", `${media.directory}/hero.jpg`);
  const [study, setStudy] = useState<"cranberry" | "pine">("cranberry");
  const [pendingStudy, setPendingStudy] = useState<typeof study | null>(null);
  const [studyError, setStudyError] = useState("");
  const studyRequest = useRef(0);
  const [dialog, setDialog] = useState<DialogView | null>(null);
  const [noteFromBlogCard, setNoteFromBlogCard] = useState(false);
  const dialogTrigger = useRef<HTMLButtonElement | null>(null);
  const article = (() => {
    const found = notes.find((note) => note.id === dialog);
    if (!found) return undefined;
    if (!noteFromBlogCard) return found;
    const index = notes.findIndex((note) => note.id === found.id);
    return withOverlayBlogPost(found, content?.blogs?.[index]);
  })();

  async function selectStudy(next: typeof study) {
    const request = ++studyRequest.current;
    setStudyError("");
    if (next === study) {
      setPendingStudy(null);
      return;
    }
    setPendingStudy(next);
    const role = next === "cranberry" ? "hero" : "pine-cabin";
    const nextSrc =
      next === "cranberry"
        ? overlayMediaUrl(content, "heroPoster", `${media.directory}/hero.jpg`)
        : overlayMediaUrl(content, "pineCabin", `${media.directory}/pine-cabin.jpg`);
    const image = new Image();
    image.sizes = "100vw";
    if (nextSrc.startsWith("/templates/") && nextSrc.endsWith(".jpg")) {
      image.srcset = `${media.directory}/${role}-800.jpg 800w, ${media.directory}/${role}.jpg ${media.photos[role].width}w`;
    }
    image.src = nextSrc;
    try {
      // Keep the current photograph and its label together until the next one decodes.
      await image.decode();
      if (studyRequest.current === request) setStudy(next);
    } catch {
      if (studyRequest.current === request) {
        setStudyError("That photograph could not load. Choose it again to retry.");
      }
    } finally {
      if (studyRequest.current === request) setPendingStudy(null);
    }
  }

  function openDialog(view: DialogView, trigger: HTMLButtonElement, fromBlogCard = false) {
    dialogTrigger.current = trigger;
    setDialog(view);
    setNoteFromBlogCard(fromBlogCard);
  }

  return (
    <div className="p17" id="p17-top">
      <a className="p17-skip" href="#p17-main">
        Skip to content
      </a>
      <header className="p17-header">
        <a className="p17-brand" href="#p17-top" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : null}
          </span>
          <span className="overlay-brand-name">
            {brandName ? (
              brandName
            ) : (
              <>
                Alpine <span>Enamel</span>
              </>
            )}
          </span>
        </a>
        <p className="p17-header-caption">Cabin colour &amp; timber care</p>
        <nav className="p17-nav" aria-label={brandLabel}>
          <a href="#p17-colours">Cabin colours</a>
          <a href="#p17-care">Timber care</a>
          <a href="#p17-notes">Field notes</a>
        </nav>
        <button
          type="button"
          className="p17-header-plan"
          data-painter-plan
          onClick={(event) => openDialog("planner", event.currentTarget)}
        >
          Plan a project <ArrowUpRight size={18} aria-hidden="true" />
        </button>
      </header>

      <main id="p17-main" tabIndex={-1}>
        <section className="p17-hero" data-painter-section="hero" aria-labelledby="p17-hero-title">
          <CabinFilm poster={heroPoster} />
          <div className="p17-hero-copy">
            <p className="p17-eyebrow" data-tkey="text.heroTagline">
              {heroTagline}
            </p>
            <h1 id="p17-hero-title" data-tkey="text.heroTitle">
              {heroTitle}
              <br />
              <span data-tkey="text.heroAccent">{heroAccent}</span>
            </h1>
            <p className="p17-hero-intro" data-tkey="text.heroSub">
              {heroSub}
            </p>
            <button
              type="button"
              className="p17-action p17-hero-action"
              data-painter-plan
              onClick={(event) => openDialog("planner", event.currentTarget)}
            >
              Plan my project <ArrowUpRight size={20} aria-hidden="true" />
            </button>
          </div>
          <a className="p17-hero-wayfinding" href="#p17-colours">
            <ArrowDown size={17} aria-hidden="true" />
            <span>Find your cabin colour</span>
          </a>
          <p className="p17-hero-label">Cranberry siding / Snow-white trim</p>
        </section>

        <section
          className="p17-studies"
          id="p17-colours"
          data-painter-section="colour-studies"
          aria-labelledby="p17-studies-title"
        >
          <div className="p17-section-heading">
            <div>
              <p className="p17-eyebrow">01 / The colour board</p>
              <h2 id="p17-studies-title" data-tkey="text.studiesTitle">
                {studiesTitle}
              </h2>
            </div>
          </div>
          <figure
            className="p17-study-photo"
            id="p17-study-photo"
            aria-describedby="p17-study-context"
            aria-busy={pendingStudy !== null}
          >
            {study === "cranberry" ? (
              <Photo
                role="hero"
                src={overlayMediaUrl(content, "heroPoster", `${media.directory}/hero.jpg`)}
                tkey="media.heroPoster"
              />
            ) : (
              <Photo
                role="pine-cabin"
                src={overlayMediaUrl(content, "pineCabin", `${media.directory}/pine-cabin.jpg`)}
                tkey="media.pineCabin"
              />
            )}
            <figcaption className="p17-photo-sign" aria-live="polite" aria-atomic="true">
              <span>Photo {study === "cranberry" ? "01" : "02"}</span>
              <strong>{study === "cranberry" ? "Cranberry" : "Pine"}</strong>
              <span>
                {study === "cranberry" ? "Front-facing cabin" : "Different cabin / angled view"}
              </span>
            </figcaption>
          </figure>
          <div className="p17-study-bottom">
            <fieldset className="p17-photo-choices" aria-describedby="p17-study-context">
              <legend>Choose a photograph</legend>
              <button
                type="button"
                aria-pressed={study === "cranberry"}
                aria-controls="p17-study-photo"
                onClick={() => void selectStudy("cranberry")}
                data-p17-study="cranberry"
              >
                <span className="p17-swatch p17-swatch-cranberry" aria-hidden="true" />
                <span>Photo 01 / Cranberry</span>
              </button>
              <button
                type="button"
                aria-pressed={study === "pine"}
                aria-controls="p17-study-photo"
                onClick={() => void selectStudy("pine")}
                data-p17-study="pine"
              >
                <span className="p17-swatch p17-swatch-pine" aria-hidden="true" />
                <span>Photo 02 / Pine</span>
              </button>
            </fieldset>
            <div className="p17-study-context">
              <p id="p17-study-context">
                Two photographs of different cabins, not one property recoloured. Test a real sample
                in your own light.
              </p>
              <p className="p17-study-status" role="status">
                {pendingStudy
                  ? `Loading the ${pendingStudy === "pine" ? "pine" : "cranberry"} photograph...`
                  : studyError}
              </p>
            </div>
          </div>
        </section>

        <section
          className="p17-care"
          id="p17-care"
          data-painter-section="timber-care"
          aria-labelledby="p17-care-title"
        >
          <div className="p17-care-photo">
            <Photo
              role="timber-care"
              sizes="(max-width: 930px) 100vw, 72vw"
              src={overlayMediaUrl(content, "detailImage", `${media.directory}/timber-care.jpg`)}
              tkey="media.detailImage"
            />
            <span className="p17-material-label">Timber / Grain / A careful edge</span>
          </div>
          <div className="p17-care-copy">
            <p className="p17-eyebrow">02 / Groundwork first</p>
            <h2 id="p17-care-title" data-tkey="text.detailTitle">
              {detailTitle}
            </h2>
            <p data-tkey="text.detailBody">{detailBody}</p>
            <button
              type="button"
              className="p17-text-action"
              data-painter-note="timber"
              onClick={(event) => openDialog("timber", event.currentTarget)}
            >
              Read the care checklist <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section
          className="p17-notes"
          id="p17-notes"
          data-painter-section="field-notes"
          aria-labelledby="p17-notes-title"
        >
          <div className="p17-section-heading">
            <div>
              <p className="p17-eyebrow">03 / Notes from the workbench</p>
              <h2 id="p17-notes-title" data-tkey="text.journalTitle">
                {journalTitle}
              </h2>
            </div>
            <p data-tkey="text.journalIntro">{journalIntro}</p>
          </div>
          <div className="p17-note-grid">
            {notes.map((note, index) => {
              const overlayPost = content?.blogs?.[index];
              const noteTitle = overlayPost?.title ?? note.title;
              return (
                <button
                  type="button"
                  className="p17-note"
                  key={note.id}
                  data-painter-note={note.id}
                  onClick={(event) => openDialog(note.id, event.currentTarget, true)}
                  aria-label={`Read: ${noteTitle}`}
                >
                  <Photo
                    role={note.image}
                    sizes="(max-width: 930px) 100vw, 33vw"
                    src={overlayMediaUrl(
                      content,
                      `guideImage${index + 1}`,
                      `${media.directory}/${note.image}.jpg`,
                    )}
                    tkey={`media.guideImage${index + 1}`}
                  />
                  <span className="p17-note-number" aria-hidden="true">
                    {note.number}
                  </span>
                  <span className="p17-note-caption">
                    <span className="p17-eyebrow" data-tkey={`blogs.${index}.category`}>
                      {overlayPost?.category ?? note.category}
                    </span>
                    <span className="p17-note-title" data-tkey={`blogs.${index}.title`}>
                      {noteTitle}
                    </span>
                    <span className="p17-note-link">
                      Read field note <ArrowUpRight size={19} aria-hidden="true" />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="p17-planning"
          id="p17-planning"
          data-painter-section="project-planner"
          aria-labelledby="p17-planning-title"
        >
          <div className="p17-planning-photo">
            <Photo
              role="worktable"
              sizes="(max-width: 930px) 100vw, 72vw"
              src={overlayMediaUrl(content, "planningImage", `${media.directory}/worktable.jpg`)}
              tkey="media.planningImage"
            />
          </div>
          <div className="p17-planning-copy">
            <p className="p17-eyebrow">04 / Your next coat</p>
            <h2 id="p17-planning-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <button
              type="button"
              className="p17-action"
              data-painter-plan
              onClick={(event) => openDialog("planner", event.currentTarget)}
            >
              Planner &amp; quick answers <ArrowUpRight size={20} aria-hidden="true" />
            </button>
            <p className="p17-planning-small">Local notes. Nothing is sent.</p>
          </div>
        </section>
      </main>

      <footer className="p17-footer">
        <p className="p17-footer-wordmark">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : null}
          </span>
          <span className="overlay-brand-name">{brandLabel}</span>
        </p>
        <p data-tkey="text.footerBlurb">{footerBlurb}</p>
        <a href="/templates/alpine-enamel/media-ledger.json" target="_blank" rel="noreferrer">
          Media credits <ArrowUpRight size={15} aria-hidden="true" />
        </a>
        <a href="#p17-top">
          Back to top <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </footer>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <PainterTemplateDialog
          className="p17-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogTrigger.current?.focus({ preventScroll: true });
          }}
        >
          {dialog === "planner" ? (
            <div className="p17-dialog-body">
              <p className="p17-eyebrow">{brandLabel} / Project notes</p>
              <DialogTitle className="p17-dialog-title">A plan for your next coat.</DialogTitle>
              <DialogDescription className="p17-dialog-intro">
                Gather the surfaces, colours and questions to discuss with your painter. Add your
                notes and copy a plan to keep.
              </DialogDescription>
              <PainterProjectPlanner className="p17-planner" />
              <div className="p17-faq" aria-labelledby="p17-faq-title">
                <h3 id="p17-faq-title">Before you open the tin.</h3>
                {questions.map(([question, answer]) => (
                  <details key={question}>
                    <summary>
                      {question} <ChevronDown size={18} aria-hidden="true" />
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          ) : article ? (
            <article className="p17-dialog-body">
              <p className="p17-eyebrow">
                Field note {article.number} / {article.category}
              </p>
              <DialogTitle className="p17-dialog-title">{article.title}</DialogTitle>
              <DialogDescription className="p17-dialog-intro">{article.intro}</DialogDescription>
              <div className="p17-article-photo">
                <Photo
                  role={article.image}
                  sizes="(max-width: 760px) 90vw, 720px"
                  src={overlayMediaUrl(
                    content,
                    `guideImage${notes.findIndex((note) => note.id === article.id) + 1}`,
                    `${media.directory}/${article.image}.jpg`,
                  )}
                  tkey={`media.guideImage${notes.findIndex((note) => note.id === article.id) + 1}`}
                />
              </div>
              {article.sections.map((section) => (
                <div className="p17-article-section" key={section.title}>
                  <h3>{section.title}</h3>
                  <p>{section.body}</p>
                </div>
              ))}
            </article>
          ) : null}
        </PainterTemplateDialog>
      </Dialog>
    </div>
  );
}
