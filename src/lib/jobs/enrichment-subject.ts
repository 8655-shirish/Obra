export type EnrichmentSubject =
  { kind: "website"; websiteId: string } | { kind: "research_row"; researchRowId: string };

export function enrichmentSubjectId(subject: EnrichmentSubject): string {
  return subject.kind === "website" ? subject.websiteId : subject.researchRowId;
}

export function websiteSubject(websiteId: string): EnrichmentSubject {
  return { kind: "website", websiteId };
}

export function researchRowSubject(researchRowId: string): EnrichmentSubject {
  return { kind: "research_row", researchRowId };
}

export function enrichmentSubjectFromJob(job: {
  website_id: string | null;
  research_row_id: string | null;
}): EnrichmentSubject {
  const websiteId = job.website_id;
  const researchRowId = job.research_row_id;
  if (websiteId && !researchRowId) return { kind: "website", websiteId };
  if (researchRowId && !websiteId) return { kind: "research_row", researchRowId };
  throw new Error("Enrichment job must belong to exactly one subject");
}

export function requireWebsiteId(job: { website_id: string | null }): string {
  if (!job.website_id) throw new Error("Job is missing website_id");
  return job.website_id;
}

export function applyEnrichmentSubjectFilter<
  T extends { eq: (column: string, value: string) => T },
>(query: T, subject: EnrichmentSubject): T {
  return subject.kind === "website"
    ? query.eq("website_id", subject.websiteId)
    : query.eq("research_row_id", subject.researchRowId);
}
