import { ArrowDown, ArrowRight, ArrowUpRight, Plus } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";

import { Dialog, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import {
  overlayLogoUrl,
  overlayMediaUrl,
  withOverlayBlogPost,
  type TemplateMoldContent,
} from "@/lib/template-content/overlay";

import { PainterProjectPlanner } from "./PainterProjectPlanner";
import { PainterTemplateDialog } from "./PainterTemplateDialog";
import media from "./painter-sixteen/media.json";

import "./overlay-fit.css";
import "./painter-sixteen/painter-sixteen.css";

type PhotoName = keyof typeof media.photos;

const surfaces = [
  {
    image: "interior",
    title: "Interiors",
    detail: "Walls & ceilings",
    text: "Read the wall in daylight. Agree on repairs, protection and the finish before choosing a colour.",
  },
  {
    image: "exterior",
    title: "Exteriors",
    detail: "Facades & thresholds",
    text: "Check weather exposure, moisture and the existing coating. Set the painting window around the product, not just the calendar.",
  },
  {
    image: "cabinetry",
    title: "Cabinetry",
    detail: "Doors & frames",
    text: "Plan cleaning, adhesion testing and hardware removal together. Leave time for the coating to cure before everyday use.",
  },
  {
    image: "woodwork",
    title: "Woodwork",
    detail: "Trim & joinery",
    text: "Decide which timber stays natural and which edges take colour. Confirm the sheen against the neighbouring wall.",
  },
] as const;

const notes = [
  {
    id: "colour",
    image: "colour",
    category: "Colour",
    title: "Colour beside timber",
    intro:
      "Oak, cedar and changing daylight all influence a painted wall. Judge the relationship, not a small swatch in isolation.",
    sections: [
      {
        title: "Begin with what stays",
        text: "Floorboards, joinery, stone and upholstery are part of the palette even when they are not being painted. Put your shortlist beside each of them. Warm timber can make a white look pink or a grey look green; neither effect is obvious on a screen.",
      },
      {
        title: "Give the sample a full day",
        text: "Use a large movable board prepared and coated according to the product instructions. Move it from the window to a shaded corner, then look again with your evening lamps on. Compare a few options rather than covering every wall with competing patches.",
      },
      {
        title: "Choose colour and sheen together",
        text: "A sheen change alters reflected light, so the final test should use the intended finish. View the board vertically, beside the trim, from the places you actually sit. Keep the approved board until the work is complete.",
      },
    ],
    takeaway: "Record the room, surface, colour code, product and sheen in one place.",
  },
  {
    id: "preparation",
    image: "preparation",
    category: "Preparation",
    title: "Before the first stroke",
    intro:
      "A clean painted edge begins with the surface beneath it and a clear agreement about what needs attention.",
    sections: [
      {
        title: "Resolve the cause first",
        text: "Stains, bubbling and peeling may point to moisture or an unstable coating. Identify and address the cause before covering it. Where an older coating may contain lead or another hazardous material, arrange an appropriate assessment before sanding or disturbing it.",
      },
      {
        title: "Make protection specific",
        text: "Agree on furniture moves, floor coverings, masking, hardware removal, dust control and ventilation. Note which routes through the home must stay usable, and how children and pets will be kept away from the work. Protection belongs in the written scope.",
      },
      {
        title: "Describe the preparation",
        text: "Cleaning, sanding, filling and priming are different tasks. Ask which are needed for each surface and how a test area will be checked for adhesion. Decide how newly discovered damage will be priced and approved before extra work begins.",
      },
    ],
    takeaway: "Photograph visible damage and list the repairs separately from the paint finish.",
  },
  {
    id: "sheen",
    image: "sheen",
    category: "Finish",
    title: "Let the light choose",
    intro:
      "Matte, eggshell and satin are starting points, not universal specifications. The room and the actual product matter more than the name.",
    sections: [
      {
        title: "Look along the wall",
        text: "Low side-light reveals repairs and texture that front-on light can hide. Higher sheen often makes those variations more apparent. View a sample from the doorway and from beside the window before agreeing on the preparation standard.",
      },
      {
        title: "Match the product to daily use",
        text: "A quiet bedroom, a busy hall and a steamy bathroom ask different things of a coating. Check the manufacturer's guidance for the surface, moisture conditions and cleaning method. A higher sheen alone is not a promise of greater durability.",
      },
      {
        title: "Leave room for curing",
        text: "Touch-dry is not the same as ready for scrubbing, closed cabinet doors or heavy use. Drying and curing depend on the coating and room conditions. Ask for the product's return-to-use and cleaning instructions, and keep them with the colour record.",
      },
    ],
    takeaway: "Write the product and sheen against each surface, not just against each room.",
  },
] as const;

const faqs = [
  [
    "What belongs in a paint brief?",
    "List the rooms and surfaces, visible repairs, access needs and finishes you want to keep. Add photos and your preferred timing. Let a site assessment establish the final preparation and coating system.",
  ],
  [
    "When should I test colour?",
    "Before ordering the full quantity. Try the intended product and sheen on a movable board, then review it in daylight and evening light beside the materials that stay.",
  ],
  [
    "How much drying time should I allow?",
    "Use the chosen product's instructions and the actual site conditions. Recoat time, touch-dry time and full cure are different. Confirm when furniture, cabinet doors and regular cleaning can return.",
  ],
] as const;

function Photograph({
  name,
  eager = false,
  sizes = "(max-width: 740px) 100vw, 74vw",
  className,
  alt,
  src,
  tkey,
}: {
  name: PhotoName;
  eager?: boolean;
  sizes?: string;
  className?: string;
  alt?: string;
  src?: string;
  tkey?: string;
}) {
  const photo = media.photos[name];
  const resolved = src ?? `${media.directory}/${photo.file}`;
  const catalogSrcSet =
    resolved.startsWith("/templates/") && resolved.endsWith(".jpg")
      ? `${resolved.replace(/\.jpg$/, "-800.jpg")} 800w, ${resolved} ${photo.width}w`
      : undefined;
  return (
    <img
      src={resolved}
      srcSet={catalogSrcSet}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={alt ?? photo.alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      data-tkey={tkey}
    />
  );
}

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function serverPrefersReducedMotion() {
  return true;
}

function HeroFilm({ poster }: { poster: string }) {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    prefersReducedMotion,
    serverPrefersReducedMotion,
  );
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    function syncPlayback() {
      if (document.hidden) video?.pause();
      else void video?.play().catch(() => undefined);
    }
    syncPlayback();
    document.addEventListener("visibilitychange", syncPlayback);
    return () => document.removeEventListener("visibilitychange", syncPlayback);
  }, [reducedMotion, failed]);

  return (
    <figure className="p16-hero-media">
      <Photograph name="hero" eager sizes="100vw" src={poster} tkey="media.heroPoster" />
      {/* No video element or source is sent by SSR or mounted for reduced motion. */}
      {!reducedMotion && !failed ? (
        <>
          <video
            ref={videoRef}
            src={`${media.directory}/${media.film.file}`}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            onError={() => setFailed(true)}
          />
        </>
      ) : null}
      <figcaption>Indigo, oak and paper-soft light.</figcaption>
    </figure>
  );
}

export function PainterSixteenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTitle = text?.heroTitle ?? "Colour,";
  const heroAccent = text?.heroAccent ?? "considered.";
  const heroSub = text?.heroSub ?? "For walls, woodwork and the quiet life between them.";
  const servicesHeading = text?.servicesHeading ?? "From wall to woodwork.";
  const detailTitle = text?.detailTitle ?? "Care at the edge.";
  const detailBody =
    text?.detailBody ?? "Protect the timber. Prepare the plaster. Test the colour.";
  const journalTitle = text?.journalTitle ?? "A little knowledge. A better finish.";
  const planHeading = text?.planHeading ?? "One room first.";
  const planIntro =
    text?.planIntro ??
    "List your surfaces, repairs and colour ideas. Make a brief to discuss with a painter.";
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "True Coat";
  const brandAria = brandName ? `${brandName} home` : "True Coat, Ink Wash home";
  const logoUrl = overlayLogoUrl(content);
  const heroPoster = overlayMediaUrl(
    content,
    "heroPoster",
    `${media.directory}/${media.photos.hero.file}`,
  );
  const strokeSrc = overlayMediaUrl(
    content,
    "strokeImage",
    `${media.directory}/${media.photos.stroke.file}`,
  );
  const [surfaceIndex, setSurfaceIndex] = useState(0);
  const [stroke, setStroke] = useState(0);
  const [activeNote, setActiveNote] = useState<(typeof notes)[number]>(notes[0]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surface = surfaces[surfaceIndex];
  const surfaceDetail = text?.[`surface${surfaceIndex + 1}Detail`] ?? surface.detail;
  const surfaceText = text?.[`surface${surfaceIndex + 1}Text`] ?? surface.text;

  function openPlanner(event: MouseEvent<HTMLButtonElement>) {
    triggerRef.current = event.currentTarget;
    setPlannerOpen(true);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="p16" id="p16-top">
      <a className="p16-skip" href="#p16-main">
        Skip to content
      </a>

      <header className="p16-header">
        <a className="p16-brand" href="#p16-top" aria-label={brandAria}>
          <span
            className={logoUrl ? "overlay-brand-mark" : "p16-brand-mark overlay-brand-mark"}
            data-tkey="media.logo"
            aria-hidden="true"
          >
            {logoUrl ? <img src={logoUrl} alt="" /> : null}
          </span>
          <span>
            <strong className="overlay-brand-name">{brandLabel}</strong>
            {brandName ? null : <small>Ink Wash</small>}
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#p16-surfaces">Surfaces</a>
          <a href="#p16-notes">Field notes</a>
          <a className="p16-header-plan" href="#p16-plan">
            Make a plan <ArrowUpRight aria-hidden="true" />
          </a>
        </nav>
      </header>

      <main id="p16-main" tabIndex={-1}>
        <section className="p16-hero" data-painter-section="hero" aria-labelledby="p16-title">
          <HeroFilm poster={heroPoster} />
          <div className="p16-hero-copy">
            <p className="p16-kicker">Residential painting</p>
            <h1 id="p16-title" data-tkey="text.heroTitle">
              {heroTitle}
              <br />
              <span data-tkey="text.heroAccent">{heroAccent}</span>
            </h1>
            <p className="p16-hero-intro" data-tkey="text.heroSub">
              {heroSub}
            </p>
            <button
              type="button"
              className="p16-button"
              data-painter-plan
              aria-haspopup="dialog"
              onClick={openPlanner}
            >
              Plan your project <ArrowUpRight aria-hidden="true" />
            </button>
            <a className="p16-hero-link" href="#p16-surfaces">
              Explore the surfaces <ArrowDown aria-hidden="true" />
            </a>
          </div>
        </section>

        <section
          className="p16-surfaces"
          id="p16-surfaces"
          data-painter-section="surfaces"
          aria-labelledby="p16-surfaces-title"
        >
          <div className="p16-surfaces-copy">
            <p className="p16-kicker">01 / Surfaces</p>
            <h2 id="p16-surfaces-title" data-tkey="text.servicesHeading">
              {servicesHeading}
            </h2>
            <div className="p16-surface-choices" role="group" aria-label="Choose a surface">
              {surfaces.map((item, index) => (
                <button
                  key={item.image}
                  type="button"
                  data-painter-surface={item.image}
                  aria-pressed={surfaceIndex === index}
                  aria-controls="p16-surface-view"
                  onClick={() => setSurfaceIndex(index)}
                >
                  <span>{item.title}</span>
                  <ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <figure className="p16-surface-view" id="p16-surface-view">
            <Photograph
              key={surface.image}
              name={surface.image}
              className="p16-surface-photo"
              src={overlayMediaUrl(
                content,
                `surfaceImage${surfaceIndex + 1}`,
                `${media.directory}/${media.photos[surface.image].file}`,
              )}
              tkey={`media.surfaceImage${surfaceIndex + 1}`}
            />
            <figcaption aria-live="polite" aria-atomic="true">
              <h3 data-tkey={`text.surface${surfaceIndex + 1}Detail`}>{surfaceDetail}</h3>
              <p data-tkey={`text.surface${surfaceIndex + 1}Text`}>{surfaceText}</p>
            </figcaption>
          </figure>
        </section>

        <section
          className="p16-stroke"
          data-painter-section="one-stroke"
          aria-labelledby="p16-stroke-title"
        >
          <figure className="p16-stroke-media" id="p16-stroke-view">
            <Photograph
              name="stroke"
              className="p16-stroke-base"
              src={strokeSrc}
              tkey="media.strokeImage"
            />
            <Photograph
              key={stroke}
              name="stroke"
              alt=""
              className={`p16-stroke-colour${stroke ? " p16-stroke-reveal" : ""}`}
              src={strokeSrc}
              tkey="media.strokeImage"
            />
            <figcaption>A brushwork study in dusty plum.</figcaption>
          </figure>
          <div className="p16-stroke-copy">
            <p className="p16-kicker">02 / One Stroke</p>
            <h2 id="p16-stroke-title" data-tkey="text.detailTitle">
              {detailTitle}
            </h2>
            <p data-tkey="text.detailBody">{detailBody}</p>
            <button
              type="button"
              className="p16-stroke-button"
              data-painter-stroke
              aria-controls="p16-stroke-view"
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse") setStroke((value) => value + 1);
              }}
              onFocus={(event) => {
                if (event.currentTarget.matches(":focus-visible")) setStroke((value) => value + 1);
              }}
              onClick={() => setStroke((value) => value + 1)}
            >
              Replay the stroke <ArrowRight aria-hidden="true" />
            </button>
          </div>
        </section>

        <section
          className="p16-notes"
          id="p16-notes"
          data-painter-section="notes"
          aria-labelledby="p16-notes-title"
        >
          <div className="p16-notes-heading">
            <p className="p16-kicker">03 / Field notes</p>
            <h2 id="p16-notes-title" data-tkey="text.journalTitle">
              {journalTitle}
            </h2>
          </div>
          <div className="p16-note-grid">
            {notes.map((note, index) => {
              const overlayPost = content?.blogs?.[index];
              return (
                <article className="p16-note" key={note.id}>
                  <figure>
                    <Photograph
                      name={note.image}
                      sizes="(max-width: 740px) 100vw, 32vw"
                      src={overlayMediaUrl(
                        content,
                        `guideImage${index + 1}`,
                        `${media.directory}/${media.photos[note.image].file}`,
                      )}
                      tkey={`media.guideImage${index + 1}`}
                    />
                  </figure>
                  <p data-tkey={`blogs.${index}.category`}>
                    {overlayPost?.category ?? note.category}
                  </p>
                  <h3 data-tkey={`blogs.${index}.title`}>
                    <button
                      type="button"
                      data-painter-note={note.id}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        triggerRef.current = event.currentTarget;
                        setActiveNote(withOverlayBlogPost(note, overlayPost));
                        setNoteOpen(true);
                      }}
                    >
                      {overlayPost?.title ?? note.title} <ArrowUpRight aria-hidden="true" />
                    </button>
                  </h3>
                </article>
              );
            })}
          </div>
        </section>

        <section
          className="p16-planning"
          id="p16-plan"
          data-painter-section="planning"
          aria-labelledby="p16-planning-title"
        >
          <figure className="p16-planning-media">
            <Photograph
              name="planning"
              src={overlayMediaUrl(
                content,
                "planningImage",
                `${media.directory}/${media.photos.planning.file}`,
              )}
              tkey="media.planningImage"
            />
          </figure>
          <div className="p16-planning-copy">
            <p className="p16-kicker">04 / A place to begin</p>
            <h2 id="p16-planning-title" data-tkey="text.planHeading">
              {planHeading}
            </h2>
            <p data-tkey="text.planIntro">{planIntro}</p>
            <button
              type="button"
              className="p16-button"
              data-painter-plan
              aria-haspopup="dialog"
              onClick={openPlanner}
            >
              Make your checklist <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      <footer className="p16-footer">
        <div className="p16-faq" role="group" aria-label="Planning questions">
          {faqs.map(([question, answer]) => (
            <details key={question} data-painter-faq>
              <summary>
                {question} <Plus aria-hidden="true" />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
        <div className="p16-footer-line">
          <a className="p16-footer-brand" href="#p16-top">
            <span
              className={logoUrl ? "overlay-brand-mark" : "p16-brand-mark overlay-brand-mark"}
              data-tkey="media.logo"
              aria-hidden="true"
            >
              {logoUrl ? <img src={logoUrl} alt="" /> : null}
            </span>
            {brandName ? (
              <strong className="overlay-brand-name">{brandName}</strong>
            ) : (
              <>
                <strong className="overlay-brand-name">True Coat</strong>
                <span>Ink Wash</span>
              </>
            )}
          </a>
          <a href="#p16-top">
            Back to top <ArrowUpRight aria-hidden="true" />
          </a>
          <a href="/templates/ink-wash/CREDITS.md">Image credits</a>
        </div>
      </footer>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <PainterTemplateDialog className="p16-dialog" onCloseAutoFocus={restoreFocus}>
          <p className="p16-kicker">Field notes / {activeNote.category}</p>
          <DialogTitle className="p16-dialog-title">{activeNote.title}</DialogTitle>
          <DialogDescription className="p16-dialog-intro">{activeNote.intro}</DialogDescription>
          <figure className="p16-article-photo">
            <Photograph
              name={activeNote.image}
              sizes="(max-width: 740px) 100vw, 660px"
              eager
              src={overlayMediaUrl(
                content,
                `guideImage${notes.findIndex((note) => note.id === activeNote.id) + 1}`,
                `${media.directory}/${media.photos[activeNote.image].file}`,
              )}
              tkey={`media.guideImage${notes.findIndex((note) => note.id === activeNote.id) + 1}`}
            />
          </figure>
          <div className="p16-article-body">
            {activeNote.sections.map((section) => (
              <section className="p16-article-section" key={section.title}>
                <h3>{section.title}</h3>
                <p>{section.text}</p>
              </section>
            ))}
          </div>
          {activeNote.takeaway ? (
            <p className="p16-article-takeaway">
              <strong>Keep in your brief</strong>
              {activeNote.takeaway}
            </p>
          ) : null}
        </PainterTemplateDialog>
      </Dialog>

      <Dialog open={plannerOpen} onOpenChange={setPlannerOpen}>
        <PainterTemplateDialog className="p16-dialog" onCloseAutoFocus={restoreFocus}>
          <p className="p16-kicker">A place to begin</p>
          <DialogTitle className="p16-dialog-title">Your project, on paper.</DialogTitle>
          <DialogDescription className="p16-dialog-intro">
            Build a practical checklist before you speak with a painter. Copy your brief to keep it;
            this planner does not send your notes.
          </DialogDescription>
          <PainterProjectPlanner className="p16-planner" />
        </PainterTemplateDialog>
      </Dialog>
    </div>
  );
}
