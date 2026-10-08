/**
 * Shared homeowner-facing copy for the True Coat Painter template family.
 *
 * The creative direction may change by template; the offer, guidance, and
 * editorial topics stay consistent. Claims remain deliberately scope-led: a
 * publishing contractor must replace fictional-template disclosures, sample
 * contact details, media, and review slots with verified business information.
 */
export const PAINTER_SECTION_COPY = {
  servicesLabel: "Painting services",
  servicesHeading: "Painting that starts with a clear plan.",
  servicesIntro:
    "From the first walkthrough to the final check, we make the surface condition, preparation, protection, coating choices, and next steps easy to understand.",
  proofLabel: "Paint-only study",
  proofHeading: "A paint change starts with a surface review.",
  proofBody:
    "These illustrative matched views show how color and finish can change a room—not a remodel or a documented client project. Real project photography belongs here before publishing.",
  processLabel: "How we work",
  processHeading: "A careful sequence from walkthrough to final check.",
  processIntro:
    "Every project is different, but a dependable painting plan follows the same discipline: inspect, protect, repair, prepare, and finish.",
  planningLabel: "Plan with confidence",
  planningHeading: "Good painting decisions happen before the first coat.",
  planningIntro:
    "Use color, scope, schedule, and project-day logistics to create a finished space that works as well as it looks.",
  blogsLabel: "From the True Coat journal",
  blogsHeading: "Practical guidance for your next paint project.",
  blogsIntro:
    "Straightforward planning advice for choosing color, comparing a proposal, and selecting a sheen that suits the room.",
  blogsDisclosure:
    "These are educational sample guides in a fictional template. Add your published article links and verified business guidance before launch.",
  reviewsHeading: "Customer feedback belongs to real customers.",
  reviewsBody:
    "No verified reviews are included in this template. Add only real, permissioned customer feedback with accurate attribution before publishing.",
  estimateLabel: "Request an estimate",
  estimateHeading: "Start with the details that shape a good finish.",
} as const;

export const PAINTER_SERVICES = [
  {
    title: "Interior painting",
    scope: "Interior painting",
    short: "Walls · ceilings · trim · doors",
    body: "Thoughtful repainting for rooms, ceilings, trim, doors, and architectural details. We start with surface condition, repairs, protection, color, and the way each room is used.",
    text: "Thoughtful repainting for rooms, ceilings, trim, doors, and architectural details—planned around surface condition, repairs, protection, color, and everyday use.",
  },
  {
    title: "Exterior painting",
    scope: "Exterior painting",
    short: "Siding · stucco · trim · doors",
    body: "A clear exterior plan begins with the substrate, existing coatings, exposure, moisture, access, and weather window—then matches preparation and coatings to those conditions.",
    text: "An exterior plan that starts with substrate, existing coatings, exposure, moisture, access, and weather—then matches preparation and coatings to the conditions.",
  },
  {
    title: "Cabinet refinishing",
    scope: "Cabinet refinishing",
    short: "Doors · frames · finish systems",
    body: "For suitable cabinet doors and frames, we define cleaning, repairs, hardware handling, adhesion preparation, finish options, application, reassembly, and cure time before work starts.",
    text: "For suitable cabinet doors and frames, scope includes cleaning, repairs, hardware handling, adhesion preparation, finish options, application, reassembly, and cure time.",
  },
] as const;

export const PAINTER_SURFACE_COPY = {
  walls:
    "A room-by-room plan for walls and ceilings: identify repairs, protect adjoining finishes, choose a practical sheen, and agree on the finish standard before the first coat.",
  trim: "Clean lines depend on adhesion, sanding, caulk, hardware handling, masking, and cure time—not a quick final coat. Those decisions belong in the scope.",
  exterior:
    "Exterior work starts with the surface itself: substrate, existing coating, moisture, exposure, access, and weather all inform preparation, timing, and the coating system.",
  cabinets:
    "Cabinet refinishing is a separate finish system. Suitable doors and frames need a plan for cleaning, repairs, labeling, hardware, adhesion, application, reassembly, and cure time.",
} as const;

export const PAINTER_PROCESS = [
  {
    title: "Inspect",
    text: "Walk the property together. Note surfaces, existing coatings, repairs, moisture concerns, access, furnishings, and the outcome you want from each space.",
  },
  {
    title: "Protect",
    text: "Agree on furniture moves, floors, landscaping, hardware, adjacent finishes, ventilation, pets, parking, and daily access before the work zone is set.",
  },
  {
    title: "Repair",
    text: "List visible patching, filling, caulking, and surface corrections in the scope. Discuss newly discovered conditions before they become extra work.",
  },
  {
    title: "Prepare",
    text: "Clean, sand, mask, prime, and test adhesion where the surface and selected coating system call for it. Preparation is where a lasting finish begins.",
  },
  {
    title: "Finish",
    text: "Apply the agreed compatible coating system, maintain a tidy work area, review touch-ups, and finish with a final walkthrough of the included scope.",
  },
] as const;

export const PAINTER_PLANNING_NOTES = [
  {
    label: "Color",
    title: "Choose color where you live with it.",
    text: "Compare physical samples beside flooring, tile, fabrics, and trim in morning, afternoon, and evening light. Screens are a starting point, not final approval.",
  },
  {
    label: "Scope",
    title: "Put the finish plan in writing.",
    text: "A useful proposal names included surfaces, preparation, products, coats, protection, cleanup, exclusions, and how hidden conditions are handled.",
  },
  {
    label: "Schedule",
    title: "Plan around the work, not a promise.",
    text: "Timing follows room count, repair needs, access, product instructions, drying and cure time, crew size, and—outside—weather conditions.",
  },
  {
    label: "Project day",
    title: "Make daily access simple.",
    text: "Before the crew arrives, confirm furniture, fragile items, pets, parking, ventilation, staging, work hours, and the day-to-day communication plan.",
  },
] as const;

export const PAINTER_FAQS = [
  [
    "What painting projects do you take on?",
    "This sample offering covers residential interiors, eligible exterior surfaces, trim and doors, and suitable cabinet refinishing. The right fit depends on the substrate, current condition, access, coating compatibility, and service area.",
  ],
  [
    "What happens when I request an estimate?",
    "Start by sharing the address, rooms or elevations, current condition, color goals, timing, and access considerations. If the project is a fit, the next useful step is a site visit and a written scope—not a guess from a single photo.",
  ],
  [
    "Can you help with paint colors and sheen?",
    "Yes—begin with light, undertones, nearby materials, room use, and the look you want. Review physical samples in the actual space and record the final color and sheen in the written scope.",
  ],
  [
    "How long will a painting project take?",
    "Duration depends on the scope, repairs, access, number of rooms or elevations, drying and cure time, crew size, and—for exteriors—weather. A site review makes the schedule more useful and more honest.",
  ],
  [
    "What should be included in a painting proposal?",
    "Look for included surfaces, preparation, products and coats, protection, cleanup, exclusions, schedule assumptions, payment terms, and a plan for conditions found after work begins.",
  ],
  [
    "Can we stay in the home while work is underway?",
    "Often, but it depends on the rooms involved, ventilation, products, household needs, work-zone separation, and the daily plan. Agree on access and safety before the first day.",
  ],
  [
    "What does cabinet refinishing involve?",
    "For suitable doors and frames, the written scope should cover cleaning, disassembly, labeling, repairs, hardware handling, adhesion preparation, application, reassembly, cure guidance, care, and exclusions.",
  ],
  [
    "How do weather and surface conditions affect exterior work?",
    "Exterior scheduling follows surface dryness, temperature, moisture, wind, direct sun, exposure, forecast, product instructions, and access. Good planning protects both the coating system and the property.",
  ],
] as const;

export const PAINTER_BLOG_POSTS = [
  {
    number: "01",
    category: "Color planning",
    title: "How to test paint color before committing to a room",
    excerpt:
      "A practical three-step sample routine: place it beside fixed finishes, view it through the day, and compare it with the intended sheen before you choose.",
  },
  {
    number: "02",
    category: "Preparation",
    title: "What a thorough paint-prep plan should cover",
    excerpt:
      "From patching and sanding to protection, priming, and edge work, these are the questions that make a painting proposal easier to compare.",
  },
  {
    number: "03",
    category: "Finish guide",
    title: "Matte, eggshell, satin, or semi-gloss: choosing a sheen",
    excerpt:
      "Use light, traffic, cleanability, wall condition, and adjacent trim to choose a finish that feels right after the paint has cured.",
  },
] as const;

export const PAINTER_ESTIMATE_ITEMS = [
  "Rooms, elevations, and included surfaces",
  "Current condition, repairs, and access",
  "Color, sheen, and coating decisions",
  "Protection, ventilation, and occupancy needs",
  "Schedule, drying conditions, and project timing",
  "Property address and service-area confirmation",
] as const;

export const PAINTER_DISCLOSURES = {
  generatedMedia:
    "Generated illustrative media for this fictional template. Replace it with documented, permissioned project photography before publishing.",
  reviews:
    "No verified reviews are included in this template. Add only real, permissioned customer feedback with accurate attribution before publishing.",
  demo: "Demo scheduling and simulated payment only. No service, appointment, lead, or charge is created.",
  footer:
    "Fictional True Coat painter template. Replace all sample business details, media, service scope, and customer feedback before publishing.",
} as const;
