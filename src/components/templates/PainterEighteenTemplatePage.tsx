import { ArrowDown, ArrowLeftRight, ArrowUpRight, Check, ChevronDown, Leaf } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import {
  overlayLogoUrl,
  overlayMediaUrl,
  withOverlayBlogPost,
  type TemplateMoldContent,
} from "@/lib/template-content/overlay";

import media from "./painter-eighteen/media.json";
import { PainterTemplateDialog } from "./PainterTemplateDialog";
import "./overlay-fit.css";
import "./painter-eighteen/painter-eighteen.css";

type PhotoName = keyof typeof media.photos;
type Reading = { category: string; title: string; photo: PhotoName; body: readonly string[] };

const rooms = [
  {
    photo: "drawing-room",
    category: "01 / Lavender & linen",
    title: "Walls & ceilings",
    colour: "#b5a6bd",
    body: [
      "Start with the room's light, fixed finishes and the furniture that will stay. Move a large painted board between the window and the quieter corners before settling on a colour.",
      "Agree on repairs, protection, the coating system and the finish standard by room. A lower-sheen finish can soften reflected light, but the right choice also depends on use and cleanability.",
    ],
  },
  {
    photo: "kitchen",
    category: "02 / Sage & old brass",
    title: "Painted cabinetry",
    colour: "#939e86",
    body: [
      "Sound timber doors and frames can be candidates for refinishing. Check the existing coating, grease, damage and adhesion before choosing a new system.",
      "The written scope should cover cleaning, disassembly, hardware, repairs, preparation, application and reassembly. Ask for product-specific drying, curing and care guidance.",
    ],
  },
  {
    photo: "dining-room",
    category: "03 / Dusty rose & oak",
    title: "Panelling & period details",
    colour: "#c69f9f",
    body: [
      "The proportions of panelling and mouldings are part of a room's character. Review loose joints, previous coatings and damaged profiles before deciding what should be repaired or repainted.",
      "Older coatings may need specialist assessment before disturbance. Keep that decision separate from colour selection, and record the agreed preparation and compatible finish in the scope.",
    ],
  },
  {
    photo: "joinery",
    category: "04 / Oxblood & buttercream",
    title: "Doors & fine woodwork",
    colour: "#673544",
    body: [
      "Doors, skirting and architraves reward careful preparation. Agree on hardware handling, edge protection, repairs and adhesion before the first coat.",
      "View the chosen sheen in the room's own light. A little reflection can bring out a profile; too much can draw attention to imperfections. Follow the product's cure guidance before returning hardware and surfaces to full use.",
    ],
  },
] as const satisfies readonly (Reading & { colour: string })[];

const notes: readonly Reading[] = [
  {
    category: "Colour, in context",
    title: "Live with a colour before you choose it.",
    photo: "colour-notes",
    body: [
      "Use a large loose board and the intended paint system, rather than a collection of small patches scattered across the wall. Place it beside the flooring, fabrics and trim that will remain.",
      "Look again in morning light, afternoon shade and evening lamplight. Compare the colour and sheen together, and record the final choice by room. A screen cannot replace that in-room decision.",
    ],
  },
  {
    category: "Before the brush",
    title: "The finish begins with the preparation.",
    photo: "prep-notes",
    body: [
      "Note peeling, stains, cracks, loose joints and signs of moisture before comparing paint proposals. The cause of a defect matters as much as the visible repair.",
      "A useful scope names repairs, cleaning, protection, preparation and compatible products. It also explains how newly discovered conditions will be discussed, rather than silently becoming extra work.",
    ],
  },
  {
    category: "A matter of finish",
    title: "A softer wall. A little light on the trim.",
    photo: "joinery",
    body: [
      "Lower-sheen finishes diffuse light and can make a wall feel quieter. More reflective finishes bring attention to profiles, but can also reveal dents, patches and surface texture.",
      "Let the surface, traffic, moisture and cleaning needs guide the choice. Review the actual product with your painter; finish names are not identical across manufacturers.",
    ],
  },
];

const preparation: Reading = {
  category: "Care before colour",
  title: "The work you notice. The care you don't.",
  photo: "preparation",
  body: [
    "Inspect first. Identify the substrate, existing coating, moisture concerns and repairs. Older or suspect coatings may require assessment before any sanding or disturbance.",
    "Protect the house. Agree on floors, furniture, hardware, ventilation, pets and access, then define how the work zone will be kept separate from daily life.",
    "Prepare for the selected system. Cleaning, repairs, adhesion testing and priming should follow the surface condition and the manufacturer's instructions, not a one-size-fits-all routine.",
    "Finish with a shared standard. Record the included surfaces, colour and sheen, then agree on inspection, touch-ups, cleanup and cure guidance.",
  ],
};

const questions = [
  [
    "Where should I start with colour?",
    "Begin with what will stay: flooring, stone, tiles, fabrics and timber. Test large movable painted boards in the room through the day, and consider colour and sheen together.",
  ],
  [
    "Can old cabinetry and woodwork be repainted?",
    "Often, if the substrate and existing coating are suitable. A surface review should establish repairs, adhesion, preparation and a compatible finish. Some materials or previous coatings call for specialist advice.",
  ],
  [
    "What belongs in a written quote?",
    "Look for included surfaces, repairs, preparation, protection, products, finish standard, cleanup, exclusions and schedule assumptions. Ask how hidden conditions will be handled and approved.",
  ],
  [
    "Can the house stay in use during decorating?",
    "That depends on the rooms, products, ventilation and household needs. Agree on work-zone separation, safe access, drying times and a daily plan before work starts.",
  ],
  [
    "Do older coatings need special care?",
    "Yes. Unknown older coatings can require testing and a specialist preparation method. Do not sand or disturb a suspect finish until the risk has been assessed and a suitable work plan agreed.",
  ],
] as const;

const planItems = [
  "Rooms and surfaces to include",
  "Existing finishes and visible repairs",
  "Colour, sheen and material references",
  "Furniture, protection and daily access",
  "Timing, drying and cure guidance",
  "Questions for a written quote",
] as const;

function subscribeMotionPreference(onChange: () => void) {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function Photo({
  name,
  className = "",
  sizes = "100vw",
  priority = false,
  decorative = false,
  src,
  tkey,
}: {
  name: PhotoName;
  className?: string;
  sizes?: string;
  priority?: boolean;
  decorative?: boolean;
  src?: string;
  tkey?: string;
}) {
  const photo = media.photos[name];
  const widths = [...new Set([800, 1200, photo.width])];
  const resolved = src ?? `${media.directory}/${name}.jpg`;
  const catalogSrcSet =
    resolved.startsWith("/templates/") && resolved.endsWith(".jpg")
      ? widths
          .map(
            (width) =>
              `${media.directory}/${name}${width === photo.width ? "" : `-${width}`}.jpg ${width}w`,
          )
          .join(", ")
      : undefined;
  return (
    <img
      className={`lv-photo ${className}`}
      data-lv-photo={name}
      src={resolved}
      srcSet={catalogSrcSet}
      sizes={sizes}
      width={photo.width}
      height={photo.height}
      alt={decorative ? "" : photo.alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      data-tkey={tkey}
    />
  );
}

function overlayNamedPhoto(
  content: TemplateMoldContent | undefined,
  name: PhotoName,
): { src: string; tkey?: string } {
  const catalog = `${media.directory}/${name}.jpg`;
  const roomIndex = rooms.findIndex((room) => room.photo === name);
  if (roomIndex >= 0) {
    const slot = `roomImage${roomIndex + 1}`;
    return { src: overlayMediaUrl(content, slot, catalog), tkey: `media.${slot}` };
  }
  const noteIndex = notes.findIndex((note) => note.photo === name);
  if (noteIndex >= 0) {
    const slot = `guideImage${noteIndex + 1}`;
    return { src: overlayMediaUrl(content, slot, catalog), tkey: `media.${slot}` };
  }
  if (name === "preparation") {
    return {
      src: overlayMediaUrl(content, "preparationImage", catalog),
      tkey: "media.preparationImage",
    };
  }
  if (name === "hero") {
    return { src: overlayMediaUrl(content, "heroPoster", catalog), tkey: "media.heroPoster" };
  }
  if (name === "planning") {
    return { src: overlayMediaUrl(content, "planningImage", catalog), tkey: "media.planningImage" };
  }
  return { src: catalog };
}

function WallpaperReveal({ title }: { title: string }) {
  const [revealed, setRevealed] = useState(84);
  const drag = useRef<{ id: number; x: number; value: number } | null>(null);

  return (
    <figure className="lv-wallpaper-study">
      <div
        className="lv-peel"
        data-revealed={revealed}
        style={{ "--lv-reveal": `${revealed}%` } as CSSProperties}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          drag.current = { id: event.pointerId, x: event.clientX, value: revealed };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          const width = event.currentTarget.getBoundingClientRect().width;
          const delta = ((event.clientX - drag.current.x) / width) * 100;
          setRevealed(Math.round(Math.min(100, Math.max(0, drag.current.value + delta))));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <Photo name="standen-room" sizes="(max-width: 900px) 1400px, 100vw" />
        <div className="lv-paper-layer" aria-hidden="true">
          <Photo name="wallpaper" decorative />
        </div>
        <span className="lv-paper-edge" aria-hidden="true" />
        <span className="lv-peel-handle" aria-hidden="true">
          <ArrowLeftRight />
        </span>
      </div>
      <figcaption className="lv-caption lv-colour-caption">
        <div>
          <p className="lv-eyebrow">Pattern, paint & possibility</p>
          <h2 id="lv-colour-title" data-tkey="text.colourTitle">
            {title}
          </h2>
        </div>
        <div className="lv-reveal-caption">
          <p>Room inspiration: the drawing room at Standen House.</p>
          <label className="lv-reveal-control">
            <span>Uncover the room</span>
            <input
              type="range"
              min={0}
              max={100}
              value={revealed}
              onChange={(event) => setRevealed(Number(event.target.value))}
              aria-valuetext={`${revealed}% of the room visible`}
            />
          </label>
        </div>
      </figcaption>
    </figure>
  );
}

export function PainterEighteenTemplatePage({ content }: { content?: TemplateMoldContent }) {
  const text = content?.text;
  const heroTagline = text?.heroTagline ?? "For the love of a well-painted home";
  const heroTitle = text?.heroTitle ?? "Old soul.";
  const heroAccent = text?.heroAccent ?? "Fresh colour.";
  const heroSub =
    text?.heroSub ??
    "Considered painting for walls, cabinetry and the details that make a house a home.";
  const heroCaption = text?.heroCaption;
  const servicesHeading = text?.servicesHeading ?? "A little colour. A lovely difference.";
  const servicesIntro = text?.servicesIntro ?? "Four ways to see the familiar afresh.";
  const colourTitle = text?.colourTitle ?? "Let the house set the palette.";
  const detailTitle = text?.detailTitle ?? "Beautiful starts beneath the paint.";
  const detailBody =
    text?.detailBody ??
    "Careful repairs. Protected floors. Preparation that starts with the surface.";
  const journalTitle = text?.journalTitle ?? "From the decorating desk.";
  const journalIntro = text?.journalIntro ?? "Good decisions, before the first brushstroke.";
  const planHeading = text?.planHeading ?? "A lovely place to start.";
  const planIntro =
    text?.planIntro ?? "Your rooms, colours and questions. One useful list for your painter.";
  const footerBlurb = text?.footerBlurb;
  const brandName = content?.businessName?.trim() ? content.businessName.trim() : null;
  const brandLabel = brandName ?? "Lavender Estate";
  const brandAria = brandName ? `${brandName} home` : "Lavender Estate home";
  const logoUrl = overlayLogoUrl(content);
  const heroPoster = overlayMediaUrl(content, "heroPoster", `${media.directory}/arrival.jpg`);
  // Keep the poster-only server snapshot through hydration, then respect the live preference.
  const reducedMotion = useSyncExternalStore(
    subscribeMotionPreference,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  const [filmPlaying, setFilmPlaying] = useState(false);
  const [filmFailed, setFilmFailed] = useState(false);
  const [dialog, setDialog] = useState<Reading | "planner" | "questions" | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const manualCopy = useRef<HTMLTextAreaElement | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [planNotes, setPlanNotes] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const planText = `Painting project notes\n${checks.map((item) => `- ${item}`).join("\n")}${planNotes.trim() ? `\n\nRoom notes: ${planNotes.trim()}` : ""}`;

  function openDialog(next: Exclude<typeof dialog, null>, button: HTMLButtonElement) {
    trigger.current = button;
    setDialog(next);
  }

  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(planText);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
      requestAnimationFrame(() => manualCopy.current?.focus());
    }
  }

  return (
    <div className="lv" id="lv-top">
      <a className="lv-skip" href="#lv-main">
        Skip to content
      </a>
      <header className="lv-header">
        <a className="lv-brand" href="#lv-top" aria-label={brandAria}>
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : <Leaf aria-hidden="true" />}
          </span>
          <span>
            <span className="overlay-brand-name">{brandLabel}</span>
            <small>Painting & decorating</small>
          </span>
        </a>
        <nav aria-label="Primary">
          <a href="#rooms">The rooms</a>
          <a href="#colour">Colour & pattern</a>
          <a href="#approach">Our approach</a>
          <a href="#notes">Field notes</a>
        </nav>
        <a className="lv-header-plan" href="#planner">
          Plan a room <ArrowUpRight aria-hidden="true" />
        </a>
      </header>

      <main id="lv-main" tabIndex={-1}>
        <section className="lv-hero" aria-labelledby="lv-title" data-lv-section="hero">
          <div className="lv-hero-media">
            <Photo
              name="arrival"
              sizes="(max-width: 900px) 1600px, 100vw"
              priority
              decorative
              src={heroPoster}
              tkey="media.heroPoster"
            />
            {reducedMotion === false && !filmFailed ? (
              <video
                className="lv-hero-film"
                data-playing={filmPlaying}
                src={`${media.directory}/hero-motion.mp4`}
                poster={heroPoster}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-hidden="true"
                onPlaying={() => setFilmPlaying(true)}
                onError={() => setFilmFailed(true)}
              />
            ) : null}
          </div>
          <div className="lv-hero-shade" aria-hidden="true" />
          <div className="lv-hero-copy" data-lv-occlusion>
            <p className="lv-eyebrow" data-tkey="text.heroTagline">
              {heroTagline}
            </p>
            <h1 id="lv-title" data-tkey="text.heroTitle">
              {heroTitle}
              <br />
              <em data-tkey="text.heroAccent">{heroAccent}</em>
            </h1>
            <p className="lv-hero-lede" data-tkey="text.heroSub">
              {heroSub}
            </p>
            <a className="lv-button lv-button-light" href="#rooms">
              Step inside <ArrowDown aria-hidden="true" />
            </a>
          </div>
          <p className="lv-hero-caption" data-tkey="text.heroCaption">
            {heroCaption ?? (
              <>
                Country-house colour.
                <br />A softer way to come home.
              </>
            )}
          </p>
        </section>

        <section
          className="lv-rooms"
          id="rooms"
          aria-labelledby="lv-rooms-title"
          data-lv-section="rooms"
        >
          <div className="lv-section-head">
            <div>
              <p className="lv-eyebrow">The decorating album</p>
              <h2 id="lv-rooms-title" data-tkey="text.servicesHeading">
                {servicesHeading}
              </h2>
            </div>
            <p data-tkey="text.servicesIntro">{servicesIntro}</p>
          </div>
          <div className="lv-room-grid">
            {rooms.map((room, index) => (
              <article className="lv-room" key={room.photo}>
                <div className="lv-room-photo">
                  <Photo
                    name={room.photo}
                    sizes="(max-width: 900px) 100vw, 50vw"
                    src={overlayMediaUrl(
                      content,
                      `roomImage${index + 1}`,
                      `${media.directory}/${room.photo}.jpg`,
                    )}
                    tkey={`media.roomImage${index + 1}`}
                  />
                </div>
                <div className="lv-room-caption">
                  <span
                    className="lv-paint-chip"
                    style={{ backgroundColor: room.colour }}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="lv-eyebrow">{room.category}</p>
                    <h3>{room.title}</h3>
                  </div>
                  <button
                    type="button"
                    className="lv-room-link"
                    onClick={(event) => openDialog(room, event.currentTarget)}
                    aria-label={`Read about ${room.title.toLowerCase()}`}
                  >
                    <ArrowUpRight aria-hidden="true" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          className="lv-colour"
          id="colour"
          aria-labelledby="lv-colour-title"
          data-lv-section="colour"
        >
          <WallpaperReveal title={colourTitle} />
        </section>

        <section
          className="lv-approach"
          id="approach"
          aria-labelledby="lv-approach-title"
          data-lv-section="approach"
        >
          <div className="lv-care-photographs">
            <Photo
              name="preparation"
              sizes="(max-width: 900px) 1200px, 90vw"
              src={overlayMediaUrl(
                content,
                "preparationImage",
                `${media.directory}/preparation.jpg`,
              )}
              tkey="media.preparationImage"
            />
            <Photo
              name="prep-notes"
              className="lv-care-detail"
              sizes="25vw"
              src={overlayMediaUrl(content, "prepNotesImage", `${media.directory}/prep-notes.jpg`)}
              tkey="media.prepNotesImage"
            />
          </div>
          <div className="lv-caption lv-care-caption">
            <div>
              <p className="lv-eyebrow">Care before colour</p>
              <h2 id="lv-approach-title" data-tkey="text.detailTitle">
                {detailTitle}
              </h2>
            </div>
            <div>
              <p data-tkey="text.detailBody">{detailBody}</p>
              <button
                type="button"
                className="lv-text-link"
                onClick={(event) => openDialog(preparation, event.currentTarget)}
              >
                The preparation plan <ArrowUpRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <section
          className="lv-notes"
          id="notes"
          aria-labelledby="lv-notes-title"
          data-lv-section="notes"
        >
          <div className="lv-section-head">
            <div>
              <p className="lv-eyebrow">A few things worth knowing</p>
              <h2 id="lv-notes-title" data-tkey="text.journalTitle">
                {journalTitle}
              </h2>
            </div>
            <p data-tkey="text.journalIntro">{journalIntro}</p>
          </div>
          <div className="lv-note-grid">
            {notes.map((note, index) => {
              const overlayPost = content?.blogs?.[index];
              const noteTitle = overlayPost?.title ?? note.title;
              return (
                <button
                  className="lv-note"
                  type="button"
                  key={note.photo}
                  onClick={(event) =>
                    openDialog(withOverlayBlogPost(note, overlayPost), event.currentTarget)
                  }
                  aria-label={`Read: ${noteTitle}`}
                >
                  <span className="lv-note-photo">
                    <Photo
                      name={note.photo}
                      sizes="(max-width: 900px) 100vw, 33vw"
                      src={overlayMediaUrl(
                        content,
                        `guideImage${index + 1}`,
                        `${media.directory}/${note.photo}.jpg`,
                      )}
                      tkey={`media.guideImage${index + 1}`}
                    />
                  </span>
                  <span className="lv-note-caption">
                    <span className="lv-eyebrow" data-tkey={`blogs.${index}.category`}>
                      {overlayPost?.category ?? note.category}
                    </span>
                    <span className="lv-note-title" data-tkey={`blogs.${index}.title`}>
                      {noteTitle}
                    </span>
                    <ArrowUpRight aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className="lv-planner"
          id="planner"
          aria-labelledby="lv-planner-title"
          data-lv-section="planner"
        >
          <div className="lv-planning-photographs">
            <Photo
              name="hero"
              sizes="(max-width: 900px) 1000px, 90vw"
              src={overlayMediaUrl(content, "heroPoster", `${media.directory}/hero.jpg`)}
              tkey="media.heroPoster"
            />
            <Photo
              name="planning"
              sizes="(max-width: 900px) 100vw, 50vw"
              src={overlayMediaUrl(content, "planningImage", `${media.directory}/planning.jpg`)}
              tkey="media.planningImage"
            />
          </div>
          <div className="lv-caption lv-planner-caption">
            <div>
              <p className="lv-eyebrow">Begin with your room</p>
              <h2 id="lv-planner-title" data-tkey="text.planHeading">
                {planHeading}
              </h2>
            </div>
            <div>
              <p data-tkey="text.planIntro">{planIntro}</p>
              <div className="lv-planner-actions">
                <button
                  type="button"
                  className="lv-button"
                  onClick={(event) => openDialog("planner", event.currentTarget)}
                >
                  Make my project list <ArrowUpRight aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="lv-text-link"
                  onClick={(event) => openDialog("questions", event.currentTarget)}
                >
                  Questions before you begin <ArrowUpRight aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lv-footer">
        <a className="lv-brand" href="#lv-top">
          <span className="overlay-brand-mark" data-tkey="media.logo" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : <Leaf aria-hidden="true" />}
          </span>
          <span>
            <span className="overlay-brand-name">{brandLabel}</span>
            <small>Painting & decorating</small>
          </span>
        </a>
        <p data-tkey="text.footerBlurb">
          {footerBlurb ?? (
            <>
              For rooms with character.
              <br />
              And the life that happens in them.
            </>
          )}
        </p>
        <nav aria-label="Footer">
          <a href="#rooms">The rooms</a>
          <a href="#planner">Plan a room</a>
          <a href="/templates/lavender-estate/MEDIA-CREDITS.md">Image credits</a>
        </nav>
      </footer>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <PainterTemplateDialog
          className={`lv-dialog ${typeof dialog === "object" && dialog ? "lv-reading-dialog" : ""}`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          {dialog === "planner" ? (
            <>
              <DialogHeader className="lv-dialog-header">
                <p className="lv-eyebrow">Your decorating notes</p>
                <DialogTitle className="lv-dialog-title">A thoughtful place to start.</DialogTitle>
                <DialogDescription className="lv-dialog-description">
                  Choose what matters for your room. This list stays in this page; nothing is sent
                  or booked.
                </DialogDescription>
              </DialogHeader>
              <fieldset className="lv-plan-checks">
                <legend>Include in my project list</legend>
                {planItems.map((item) => (
                  <label key={item}>
                    <input
                      type="checkbox"
                      checked={checks.includes(item)}
                      onChange={() => {
                        setCopyState("idle");
                        setChecks((current) =>
                          current.includes(item)
                            ? current.filter((value) => value !== item)
                            : [...current, item],
                        );
                      }}
                    />
                    <span>{item}</span>
                  </label>
                ))}
              </fieldset>
              <label className="lv-plan-notes">
                Anything particular to the room
                <textarea
                  rows={3}
                  value={planNotes}
                  onChange={(event) => {
                    setPlanNotes(event.target.value);
                    setCopyState("idle");
                  }}
                  placeholder="Light, fixed finishes, access or timing"
                />
              </label>
              <button
                className="lv-button"
                type="button"
                disabled={checks.length === 0 && !planNotes.trim()}
                onClick={() => void copyPlan()}
              >
                <Check aria-hidden="true" /> Copy my list
              </button>
              <p className="lv-copy-status" role="status">
                {copyState === "copied"
                  ? "Copied. Your list is ready to share with your painter."
                  : copyState === "manual"
                    ? "Clipboard access isn't available. Select and copy your list below."
                    : "Choose a topic or add a note to create your list."}
              </p>
              {copyState === "manual" ? (
                <label className="lv-plan-notes">
                  Your list
                  <textarea
                    ref={manualCopy}
                    readOnly
                    rows={6}
                    value={planText}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
              ) : null}
            </>
          ) : dialog === "questions" ? (
            <>
              <DialogHeader className="lv-dialog-header">
                <p className="lv-eyebrow">Questions before paint day</p>
                <DialogTitle className="lv-dialog-title">Before the first brushstroke.</DialogTitle>
                <DialogDescription className="lv-dialog-description">
                  A little clarity makes a better starting point.
                </DialogDescription>
              </DialogHeader>
              <div className="lv-faq-list">
                {questions.map(([question, answer]) => (
                  <details key={question}>
                    <summary>
                      <span>{question}</span>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            </>
          ) : dialog ? (
            <>
              <Photo
                name={dialog.photo}
                className="lv-reading-photo"
                sizes="(max-width: 900px) 100vw, 40vw"
                src={overlayNamedPhoto(content, dialog.photo).src}
                tkey={overlayNamedPhoto(content, dialog.photo).tkey}
              />
              <div className="lv-reading-copy">
                <DialogHeader className="lv-dialog-header">
                  <p className="lv-eyebrow">{dialog.category}</p>
                  <DialogTitle className="lv-dialog-title">{dialog.title}</DialogTitle>
                  <DialogDescription className="lv-dialog-description">
                    {dialog.body[0]}
                  </DialogDescription>
                </DialogHeader>
                {dialog.body.slice(1).map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </>
          ) : null}
        </PainterTemplateDialog>
      </Dialog>
    </div>
  );
}
