export default function Site(props: SiteProps) {
  const hero = props.sections.find((s) => s.type === "hero");
  const still = firstStill(props.media);
  return (
    <div>
      <Header businessName={props.businessName} contactHidden={props.contactHidden} />
      <Section id="hero" band="primary" className="relative min-h-[70vh]">
        <Media item={still} className="absolute inset-0 h-full w-full object-cover opacity-55" />
        <div className="absolute inset-0 bg-primary/80" />
        <Heading as="h1" className="relative text-4xl font-bold tracking-tight">
          {hero?.heading}
        </Heading>
        <p className="relative">{hero?.body}</p>
      </Section>
      <Section id="trustmarkers" band="soft">
        <TrustMarkerList markers={props.trustMarkers} />
      </Section>
      <Section id="services" band="soft">
        {props.services.map((name) => (
          <Card key={name} hover="lift" className="bg-transparent px-0 py-7 shadow-none">
            {name}
          </Card>
        ))}
      </Section>
      <Section id="beforeAfter" band="base">
        <Heading className="text-3xl">Our work</Heading>
        <MediaGallery media={props.media} stagger={true} hover="lift" />
      </Section>
      <Section id="reviews" band="soft">
        {props.reviews.map((review, index) => (
          <Quote key={index} quote={review.quote} author={review.author} source={review.source} />
        ))}
      </Section>
      <Section id="contact" band="soft">
        <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />
      </Section>
      <Section id="footer" band="base">
        {props.businessName}
      </Section>
    </div>
  );
}
