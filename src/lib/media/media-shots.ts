import { z } from "zod";

export const MEDIA_SHOT_ROLES = ["hero", "atmosphere"] as const;
export type MediaShotRole = (typeof MEDIA_SHOT_ROLES)[number];
export const MEDIA_SHOT_ASPECT_RATIOS = ["wide", "landscape", "portrait", "square"] as const;
export type MediaShotAspectRatio = (typeof MEDIA_SHOT_ASPECT_RATIOS)[number];

export const MAX_STILL_SHOTS = 3;
export const MAX_UNIFIED_STILL_SHOTS = 5;
export const MIN_UNIFIED_STILL_SHOTS = 1;
export const MAX_VIDEO_SHOTS = 1;

const stillShotSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("image"),
  role: z.enum(MEDIA_SHOT_ROLES),
  prompt: z.string().min(1),
  aspectRatio: z.enum(MEDIA_SHOT_ASPECT_RATIOS).optional(),
  cropGuidance: z.string().trim().min(1).max(160).optional(),
});

const videoShotSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("video"),
  prompt: z.string().min(1),
  sourceShotId: z.string().min(1).optional(),
  sourceEvidenceIndex: z.number().int().min(0).optional(),
});

export const mediaShotSchema = z.discriminatedUnion("kind", [stillShotSchema, videoShotSchema]);
export type MediaShot = z.infer<typeof mediaShotSchema>;

export const mediaShotsSchema = z.array(mediaShotSchema).optional();

const FAKE_PROOF =
  /\b(crew on (the )?job|fake (job|crew)|before[- ]and[- ]after transformation|unlabeled photos as before)\b/i;

export function isForeignMediaUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return /^https?:\/\//i.test(trimmed);
}

export function isOurStoragePath(raw: string): boolean {
  const path = raw.trim();
  if (!path) return false;
  if (path.includes("://") || path.includes("..") || path.startsWith("/")) return false;
  return path.includes("/");
}

function asShot(value: unknown): MediaShot | null {
  const parsed = mediaShotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Cap, drop fake-proof roles/prompts, keep stills before the single clip. */
export function clampMediaShots(value: unknown, options?: { maxStills?: number }): MediaShot[] {
  if (!Array.isArray(value)) return [];
  const stills: MediaShot[] = [];
  const videos: MediaShot[] = [];
  const seen = new Set<string>();
  const maxStills = options?.maxStills ?? MAX_STILL_SHOTS;
  for (const entry of value) {
    const shot = asShot(entry);
    if (!shot) continue;
    if (seen.has(shot.id)) continue;
    if (FAKE_PROOF.test(shot.prompt)) continue;
    seen.add(shot.id);
    if (shot.kind === "image") {
      if (stills.length >= maxStills) continue;
      stills.push(shot);
    } else {
      if (videos.length >= MAX_VIDEO_SHOTS) continue;
      videos.push(shot);
    }
  }
  return [...stills, ...videos];
}

export function unifiedStillTarget(evidenceStillCount: number): number {
  return Math.max(
    MIN_UNIFIED_STILL_SHOTS,
    Math.min(MAX_UNIFIED_STILL_SHOTS, MAX_UNIFIED_STILL_SHOTS - evidenceStillCount),
  );
}

export function normalizeUnifiedMediaShots(
  value: unknown,
  options: { evidenceStillCount: number; fallbackPrompt: string },
): MediaShot[] {
  const target = unifiedStillTarget(options.evidenceStillCount);
  const shots = clampMediaShots(value, { maxStills: MAX_UNIFIED_STILL_SHOTS });
  const stills = shots.filter(
    (shot): shot is Extract<MediaShot, { kind: "image" }> => shot.kind === "image",
  );
  const videos = shots.filter(
    (shot): shot is Extract<MediaShot, { kind: "video" }> => shot.kind === "video",
  );

  const selectedStills = stills.slice(0, target);
  const usedIds = new Set(shots.map((shot) => shot.id));
  while (selectedStills.length < target) {
    const ordinal = selectedStills.length + 1;
    let id = `unified-atmosphere-${ordinal}`;
    while (usedIds.has(id)) id += "-fallback";
    usedIds.add(id);
    selectedStills.push({
      id,
      kind: "image",
      role: ordinal === 1 ? "hero" : "atmosphere",
      prompt: `${options.fallbackPrompt}. Distinct brand atmosphere still ${ordinal} of ${target}; no people, logos, text, or project-proof claims.`,
    });
  }

  const video = videos[0] ?? {
    id: "unified-brand-motion",
    kind: "video" as const,
    prompt: `${options.fallbackPrompt}. Subtle four-second cinematic motion, no people, logos, text, or project-proof claims.`,
    sourceShotId: selectedStills[0]?.id,
  };
  return [...selectedStills, video];
}

export const MEDIA_SHOTS_PLAN_CONTRACT = `You may request brand stills (GPT Image 2) and one short clip (Veo 3.1 Lite). The server runs those after this JSON — do not fetch, do not invent photo URLs, do not call tools.

mediaShots (optional array, max 3 stills and 1 clip):
- still: { id, kind: "image", role: "hero" | "atmosphere", prompt, aspectRatio?: "wide" | "landscape" | "portrait" | "square", cropGuidance? }
- clip: { id, kind: "video", prompt, sourceShotId?, sourceEvidenceIndex? }

Video prompt must be English. An existing still is optional: sourceShotId of a still in this same list, or sourceEvidenceIndex of a fact-sheet photo. If you pass a still, the clip brings that frame to life — it is not filmed job video and must not replace real work with a fake crew. Atmosphere only, never fake proof photos.

If you request a clip with no still, either also request a still to animate or the page code will bind Media to the video item (firstStill skips video).`;

export const MEDIA_ALREADY_ON_PROPS_CONTRACT = `Stills and clips are already on props.media (origin "generated" vs omitted/evidence). Use them. Do not request more generation. Do not treat generated clips as filmed job video. beforeAfter / "Our work" is evidence photos only. Hero may use a generated still when there is no real still. If a video exists with no still, bind Media to the video item — do not rely only on firstStill.`;
