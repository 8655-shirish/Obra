import type { CSSProperties, ReactNode } from "react";

import {
  resolveNamedLayoutCatalogId,
  type NamedLayoutSection,
} from "../../lib/agent/layout-vocabulary.ts";
import { headerNavItems } from "../../lib/agent/section-order.ts";
import {
  evidenceMediaItems,
  generatedMediaItems,
  type MediaOrigin,
} from "../../lib/site-evidence.ts";
import type { EntrancePreset } from "../site-renderer/motion-presets.tsx";
import {
  Card,
  Grid,
  Heading,
  Media,
  MediaGallery,
  Nav,
  Quote,
  QuoteCta,
  Section,
  firstStill,
  useSiteEvidence,
} from "./index.tsx";

type KitBand = "base" | "soft" | "primary" | "ink" | "media";
type KitPad = "none" | "tight" | "normal" | "loose";
type KitHover = "lift" | "underline" | "zoomMedia" | "grow" | "none";

const DEFAULT_BAND: Record<NamedLayoutSection, KitBand> = {
  hero: "base",
  services: "soft",
  beforeAfter: "base",
  reviews: "soft",
  footer: "ink",
};

const DEFAULT_LAYOUT: Record<NamedLayoutSection, string> = {
  hero: "hyperui/hero/centered-type-only",
  services: "hyperui/services/three-col-bordered-cards",
  beforeAfter: "hyperui/gallery/centered-header-image-grid",
  reviews: "hyperui/reviews/stacked-quote-list",
  footer: "hyperui/footer/brand-plus-legal-bar",
};

function sectionCopy(
  evidence: NonNullable<ReturnType<typeof useSiteEvidence>>,
  type: NamedLayoutSection,
) {
  return evidence.sections.find((section) => section.type === type);
}

function HeroCta({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <div className="mt-8">
      <QuoteCta />
    </div>
  );
}

function heroType(options: {
  heading: string;
  body: string;
  align: "center" | "left";
  contactHidden: boolean;
}) {
  const align = options.align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <div className={`max-w-2xl ${align}`}>
      <Heading as="h1" level="display">
        {options.heading}
      </Heading>
      {options.body ? <p className="mt-4 text-lg leading-relaxed">{options.body}</p> : null}
      <HeroCta hidden={options.contactHidden} />
    </div>
  );
}

function ServiceCards({
  services,
  columns,
  hover,
  stagger,
  centered,
}: {
  services: string[];
  columns: 2 | 3 | 4;
  hover?: KitHover;
  stagger?: boolean;
  centered?: boolean;
}) {
  const cols =
    columns === 4
      ? "grid-cols-2 gap-6 lg:grid-cols-4"
      : columns === 2
        ? "grid-cols-1 gap-6 md:grid-cols-2"
        : "grid-cols-1 gap-6 md:grid-cols-3";
  return (
    <Grid className={cols} stagger={stagger}>
      {services.map((name) => (
        <Card key={name} hover={hover} className={`p-6 ${centered ? "text-center" : ""}`}>
          <Heading as="h3" level="section">
            {name}
          </Heading>
        </Card>
      ))}
    </Grid>
  );
}

function renderHero(options: {
  id: string;
  band?: KitBand;
  pad?: KitPad;
  entrance?: EntrancePreset;
  heading: string;
  body: string;
  catalogId: string;
  media: Array<{ url?: string; mimeType?: string; alt?: string; origin?: MediaOrigin }>;
  contactHidden: boolean;
  hover?: KitHover;
}): ReactNode {
  const still =
    firstStill(evidenceMediaItems(options.media)) ?? firstStill(generatedMediaItems(options.media));
  const pad = options.pad ?? "loose";
  const entrance = options.entrance;
  const type = (align: "center" | "left") =>
    heroType({
      heading: options.heading,
      body: options.body,
      align,
      contactHidden: options.contactHidden,
    });
  const crop = "aspect-[4/3] w-full object-cover";

  if (options.catalogId === "hyperui/hero/overlay-media" && still) {
    return (
      <Section
        id={options.id}
        band="media"
        pad={pad}
        entrance={entrance}
        media={still}
        scrim="soft"
      >
        <div className="relative mx-auto max-w-3xl py-16 text-center">{type("center")}</div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/hero/split-media-right" && still) {
    return (
      <Section id={options.id} band={options.band} pad={pad} entrance={entrance}>
        <div className="flex flex-col gap-10 md:flex-row md:items-center">
          <div className="md:w-1/2">{type("left")}</div>
          <div className="md:w-1/2">
            <Media item={still} priority hover={options.hover} className={crop} />
          </div>
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/hero/split-media-left" && still) {
    return (
      <Section id={options.id} band={options.band} pad={pad} entrance={entrance}>
        <div className="flex flex-col gap-10 md:flex-row md:items-center">
          <div className="md:w-1/2">
            <Media item={still} priority hover={options.hover} className={crop} />
          </div>
          <div className="md:w-1/2">{type("left")}</div>
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/hero/split-media-wide" && still) {
    return (
      <Section id={options.id} band={options.band} pad={pad} entrance={entrance} width="wide">
        <div className="grid items-center gap-10 md:grid-cols-5">
          <div className="md:col-span-2">{type("left")}</div>
          <div className="md:col-span-3">
            <Media
              item={still}
              priority
              hover={options.hover}
              className="aspect-[4/3] w-full object-cover md:aspect-[5/4]"
            />
          </div>
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/hero/stacked-media-below" && still) {
    return (
      <Section id={options.id} band={options.band} pad={pad} entrance={entrance}>
        <div className="mx-auto max-w-3xl">{type("center")}</div>
        <div className="mt-10">
          <Media
            item={still}
            priority
            hover={options.hover}
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/hero/left-type-only") {
    return (
      <Section id={options.id} band={options.band} pad={pad} entrance={entrance}>
        {type("left")}
      </Section>
    );
  }
  return (
    <Section id={options.id} band={options.band} pad={pad} entrance={entrance}>
      {type("center")}
    </Section>
  );
}

function renderServices(options: {
  id: string;
  band?: KitBand;
  pad?: KitPad;
  entrance?: EntrancePreset;
  heading: string;
  body: string;
  catalogId: string;
  services: string[];
  media: Array<{ url?: string; mimeType?: string; alt?: string; origin?: MediaOrigin }>;
  hover?: KitHover;
  stagger?: boolean;
}): ReactNode {
  const heading = (
    <div className="mb-8 max-w-2xl">
      <Heading as="h2" level="title">
        {options.heading}
      </Heading>
      {options.body ? <p className="mt-3 leading-relaxed">{options.body}</p> : null}
    </div>
  );
  const still = firstStill(options.media);

  if (options.catalogId === "hyperui/services/numbered-step-rows") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        <ol className="space-y-6">
          {options.services.map((name, index) => (
            <li key={name} className="flex gap-4">
              <span
                className="tabular-nums text-2xl font-semibold"
                style={{ color: "var(--site-muted)" }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <Heading as="h3" level="section">
                {name}
              </Heading>
            </li>
          ))}
        </ol>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/services/heading-left-list-right") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <Heading as="h2" level="title">
              {options.heading}
            </Heading>
            {options.body ? <p className="mt-3 leading-relaxed">{options.body}</p> : null}
          </div>
          <ul className="space-y-5">
            {options.services.map((name) => (
              <li key={name}>
                <Heading as="h3" level="section">
                  {name}
                </Heading>
              </li>
            ))}
          </ul>
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/services/four-col-icon-grid") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        <div className="mb-8 text-center">
          <Heading as="h2" level="title">
            {options.heading}
          </Heading>
          {options.body ? (
            <p className="mx-auto mt-3 max-w-2xl leading-relaxed">{options.body}</p>
          ) : null}
        </div>
        <ServiceCards
          services={options.services}
          columns={4}
          hover={options.hover}
          stagger={options.stagger}
          centered
        />
      </Section>
    );
  }
  if (options.catalogId === "hyperui/services/two-col-icon-cards") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        <ServiceCards
          services={options.services}
          columns={2}
          hover={options.hover}
          stagger={options.stagger}
        />
      </Section>
    );
  }
  if (options.catalogId === "merakiui/services/cards-left-media-right") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        <div className="grid items-start gap-8 md:grid-cols-2">
          <ServiceCards
            services={options.services}
            columns={2}
            hover={options.hover}
            stagger={options.stagger}
          />
          {still ? (
            <Media
              item={still}
              hover={options.hover}
              className="aspect-square w-full object-cover"
            />
          ) : null}
        </div>
      </Section>
    );
  }
  return (
    <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
      {heading}
      <ServiceCards
        services={options.services}
        columns={3}
        hover={options.hover}
        stagger={options.stagger}
      />
    </Section>
  );
}

function renderGallery(options: {
  id: string;
  band?: KitBand;
  pad?: KitPad;
  entrance?: EntrancePreset;
  heading: string;
  body: string;
  catalogId: string;
  media: Array<{ url?: string; mimeType?: string; alt?: string; origin?: MediaOrigin }>;
  hover?: KitHover;
}): ReactNode {
  const photos = evidenceMediaItems(options.media).filter((item) => item.url);
  if (photos.length === 0) return null;
  const heading = (
    <Heading as="h2" level="title">
      {options.heading || "Our work"}
    </Heading>
  );
  const body = options.body ? (
    <p className="mt-3 max-w-2xl leading-relaxed">{options.body}</p>
  ) : null;
  const featured = firstStill(photos);

  if (options.catalogId === "hyperui/gallery/header-left-image-grid") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        <div className="grid gap-8 md:grid-cols-4">
          <header className="md:col-span-1">
            {heading}
            {body}
          </header>
          <div className="md:col-span-3">
            <MediaGallery
              media={photos}
              excludeFirst={false}
              className="grid-cols-2 gap-4 lg:grid-cols-4"
            />
          </div>
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/gallery/captioned-project-grid") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        {body}
        <div className="mt-8">
          <MediaGallery
            media={photos}
            excludeFirst={false}
            className="grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          />
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/gallery/featured-then-grid" && featured) {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        {body}
        <div className="mt-8">
          <Media
            item={featured}
            hover={options.hover}
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
        {photos.length > 1 ? (
          <div className="mt-4">
            <MediaGallery
              media={photos}
              excludeFirst
              className="grid-cols-2 gap-4 lg:grid-cols-3"
            />
          </div>
        ) : null}
      </Section>
    );
  }
  if (options.catalogId === "tailblocks/gallery/mosaic-two-col") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        {body}
        <div className="mt-8">
          <MediaGallery
            media={photos}
            excludeFirst={false}
            className="grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-2"
          />
        </div>
      </Section>
    );
  }
  return (
    <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
      <div className="mb-8 text-center">
        {heading}
        {body}
      </div>
      <MediaGallery
        media={photos}
        excludeFirst={false}
        className="grid-cols-2 gap-4 lg:grid-cols-4"
      />
    </Section>
  );
}

function renderReviews(options: {
  id: string;
  band?: KitBand;
  pad?: KitPad;
  entrance?: EntrancePreset;
  heading: string;
  body: string;
  catalogId: string;
  reviews: Array<{ quote: string; author?: string; source?: string }>;
  hover?: KitHover;
  stagger?: boolean;
}): ReactNode {
  const quotes = options.reviews.filter((item) => item.quote.trim());
  if (quotes.length === 0) return null;
  const heading = options.heading ? (
    <Heading as="h2" level="title">
      {options.heading}
    </Heading>
  ) : null;

  if (options.catalogId === "hyperui/reviews/featured-quote") {
    const first = quotes[0]!;
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        <div className="mx-auto max-w-3xl text-center">
          <Quote
            quote={first.quote}
            author={first.author}
            source={first.source}
            hover={options.hover}
          />
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/reviews/stacked-quote-list") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        {heading}
        <div className="mt-8 space-y-6">
          {quotes.map((item, index) => (
            <Quote
              key={`${item.author ?? "q"}-${index}`}
              quote={item.quote}
              author={item.author}
              source={item.source}
              hover={options.hover}
            />
          ))}
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/reviews/compact-quote-row") {
    return (
      <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
        <div className="mb-8 text-center">{heading}</div>
        <Grid className="grid-cols-1 gap-4 md:grid-cols-3" stagger={options.stagger}>
          {quotes.map((item, index) => (
            <Quote
              key={`${item.author ?? "q"}-${index}`}
              quote={item.quote}
              author={item.author}
              source={item.source}
              hover={options.hover}
            />
          ))}
        </Grid>
      </Section>
    );
  }
  const cols =
    options.catalogId === "hyperui/reviews/two-col-quote-cards"
      ? "md:grid-cols-2"
      : "md:grid-cols-3";
  return (
    <Section id={options.id} band={options.band} pad={options.pad} entrance={options.entrance}>
      {heading}
      <Grid className={`mt-8 grid-cols-1 gap-6 ${cols}`} stagger={options.stagger}>
        {quotes.map((item, index) => (
          <Quote
            key={`${item.author ?? "q"}-${index}`}
            quote={item.quote}
            author={item.author}
            source={item.source}
            hover={options.hover}
          />
        ))}
      </Grid>
    </Section>
  );
}

function renderFooter(options: {
  id: string;
  band?: KitBand;
  pad?: KitPad;
  catalogId: string;
  heading: string;
  body: string;
  evidence: NonNullable<ReturnType<typeof useSiteEvidence>>;
}): ReactNode {
  const name = options.heading || options.evidence.businessName;
  const legal =
    options.body ||
    [
      options.evidence.licenseNumber ? `Licensed #${options.evidence.licenseNumber}` : null,
      options.evidence.city || null,
    ]
      .filter(Boolean)
      .join(" · ");
  const navItems = headerNavItems(
    options.evidence.sections.map((section) => section.type),
    { contactHidden: options.evidence.contactHidden },
  );

  if (options.catalogId === "hyperui/footer/brand-plus-legal-bar") {
    return (
      <Section
        id={options.id}
        band={options.band ?? "ink"}
        pad={options.pad ?? "tight"}
        entrance="none"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="font-semibold">{name}</p>
          <p className="text-sm tabular-nums" style={{ color: "var(--site-muted)" }}>
            {legal}
          </p>
        </div>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/footer/stacked-brand-nav-legal") {
    return (
      <Section id={options.id} band={options.band ?? "ink"} pad={options.pad} entrance="none">
        <p className="font-semibold">{name}</p>
        <div className="mt-4">
          <Nav items={navItems} />
        </div>
        <p className="mt-6 text-sm tabular-nums" style={{ color: "var(--site-muted)" }}>
          {legal}
        </p>
      </Section>
    );
  }
  if (options.catalogId === "hyperui/footer/four-col-link-columns") {
    const groups = [
      { title: "Services", items: navItems.filter((item) => item.href === "#services") },
      { title: "Work", items: navItems.filter((item) => item.href === "#beforeAfter") },
      { title: "Reviews", items: navItems.filter((item) => item.href === "#reviews") },
      {
        title: "Contact",
        items: navItems.filter(
          (item) => item.href === "#contact" || item.href === "#hours" || item.href === "#warranty",
        ),
      },
    ].filter((group) => group.items.length > 0);
    return (
      <Section id={options.id} band={options.band ?? "ink"} pad={options.pad} entrance="none">
        <Grid className="grid-cols-2 gap-8 md:grid-cols-4">
          {groups.map((group) => (
            <div key={group.title}>
              <Heading as="h3" level="sub">
                {group.title}
              </Heading>
              <Nav items={group.items} className="mt-3 flex-col gap-2" />
            </div>
          ))}
        </Grid>
        <p className="mt-8 text-sm tabular-nums" style={{ color: "var(--site-muted)" }}>
          {legal}
        </p>
      </Section>
    );
  }
  return (
    <Section id={options.id} band={options.band ?? "ink"} pad={options.pad} entrance="none">
      <div className="flex flex-col gap-8 md:flex-row md:justify-between">
        <div>
          <p className="font-semibold">{name}</p>
          {legal ? (
            <p
              className="mt-2 max-w-sm text-sm tabular-nums"
              style={{ color: "var(--site-muted)" }}
            >
              {legal}
            </p>
          ) : null}
        </div>
        <Nav items={navItems} className="md:justify-end" />
      </div>
    </Section>
  );
}

export function NamedLayout({
  section,
  band,
  pad,
  entrance,
  className,
  style,
}: {
  section: NamedLayoutSection;
  band?: KitBand;
  pad?: KitPad;
  entrance?: EntrancePreset;
  className?: string;
  style?: CSSProperties;
}) {
  void className;
  void style;
  const evidence = useSiteEvidence();
  if (!evidence) return null;
  const copy = sectionCopy(evidence, section);
  if (!copy) return null;

  const catalogId = resolveNamedLayoutCatalogId(section, copy.catalogRef, DEFAULT_LAYOUT[section]);
  const resolvedBand = band ?? DEFAULT_BAND[section];
  const resolvedEntrance = entrance ?? (copy.entrance as EntrancePreset | undefined);
  const hover = copy.hover as KitHover | undefined;
  const heading = copy.heading ?? "";
  const body = copy.body ?? "";

  if (section === "hero") {
    return renderHero({
      id: "hero",
      band: resolvedBand,
      pad,
      entrance: resolvedEntrance,
      heading,
      body,
      catalogId,
      media: evidence.media,
      contactHidden: evidence.contactHidden,
      hover,
    });
  }
  if (section === "services") {
    return renderServices({
      id: "services",
      band: resolvedBand,
      pad,
      entrance: resolvedEntrance,
      heading,
      body,
      catalogId,
      services: evidence.services,
      media: evidence.media,
      hover,
      stagger: copy.stagger,
    });
  }
  if (section === "beforeAfter") {
    return renderGallery({
      id: "beforeAfter",
      band: resolvedBand,
      pad,
      entrance: resolvedEntrance,
      heading,
      body,
      catalogId,
      media: evidence.media,
      hover,
    });
  }
  if (section === "reviews") {
    return renderReviews({
      id: "reviews",
      band: resolvedBand,
      pad,
      entrance: resolvedEntrance,
      heading,
      body,
      catalogId,
      reviews: evidence.reviews,
      hover,
      stagger: copy.stagger,
    });
  }
  return renderFooter({
    id: "footer",
    band: resolvedBand,
    pad,
    catalogId,
    heading,
    body,
    evidence,
  });
}
