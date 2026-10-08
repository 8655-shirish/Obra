# Contractor Classifications & Services Reference (`/docs/services.md`)

Build a single markdown reference covering every CSLB contractor classification and the services typically offered under each, so the onboarding flow and agent prompts can suggest realistic service lists per trade.

## Source

The CSLB "Licensing Classifications" index lists 47 classification pages:
- A — General Engineering, B — General Building, B-2 — Residential Remodeling
- C — Specialty, with 42 sub-classifications (C-2 through C-61)
- Two certifications: ASB (Asbestos), HAZ (Hazardous Substance Removal)

Each classification links to its own detail page containing the official statutory scope-of-work description.

## What gets built

`docs/services.md` with:

1. Header: source URL, date captured, note that descriptions are California/CSLB statutory scope and services lists are typical consumer-facing offerings.
2. Quick index table: code, name, anchor link.
3. One section per classification:
   - Heading: `### C-36 — Plumbing Contractor`
   - **Official scope** — condensed paraphrase of the CSLB description (1-3 sentences).
   - **Typical services** — 6-12 bullet items in plain homeowner language (e.g. "Water heater installation & replacement", "Drain cleaning & hydro jetting"), suitable for a website services section.
   - **Common keywords** — short list for SEO/copy grounding.
4. Certifications section for ASB and HAZ.

## How it will be produced

1. Fetch the index page and extract all classification detail URLs.
2. Fetch each of the ~47 detail pages in batches (parallel curl per batch, own output file each), saving raw markdown to `/tmp`.
3. For each classification, derive the typical-services list from the official scope text plus standard industry offerings for that trade; no invented licensing claims.
4. Assemble the pages into `docs/services.md` in classification-code order.
5. Verify: every classification from the index appears exactly once, no empty sections, all anchors in the index table resolve.

## Notes

- Documentation only — no app code, routes, or database changes.
- If a detail page fails to fetch, it is retried once and, if still failing, marked in the file with the source link rather than filled with guesses.
