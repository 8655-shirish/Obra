#!/usr/bin/env python3
"""Generate the photorealistic Lemonade Stand template media with Higgsfield."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/templates/lemonade-stand/generated"
LEDGER = OUT / "media-ledger.json"
FORCE_FILES = {
    filename.strip()
    for filename in os.environ.get("P12_FORCE_FILES", "").split(",")
    if filename.strip()
}

WORLD = (
    "Photorealistic editorial residential painting photography in one coherent friendly US "
    "neighborhood, modest 1920s-to-1960s bungalows and practical family interiors, warm late-afternoon "
    "summer sunlight, natural 35mm color, believable materials and scale, professional but approachable "
    "local painting crew, saturated yet plausible lemon yellow, warm watermelon coral, clear pool blue, "
    "leaf green, paper white, and occasional deep cherry paint accents. Authentic lived-in details, clean "
    "professional preparation, never luxury-showroom styling. Real photograph, not illustration, not "
    "cartoon, not CGI, not 3D render, not miniature, not dollhouse, not collage. No text, words, letters, "
    "numbers, logos, brands, labels, signs, watermarks, distorted architecture, impossible tools, duplicate "
    "people, extra fingers, or warped faces."
)

ROLES: list[dict[str, str]] = [
    {
        "file": "hero.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide hero photograph of a cheerful lemon-yellow Craftsman bungalow with paper-white "
            "trim, a deep-cherry front door, a subtle coral-and-cream canvas porch awning, mature leafy tree, "
            "and two friendly residential painters in clean practical work clothes standing naturally near "
            "the porch with unbranded rollers and a paint bucket. Compose the house and crew mainly in the "
            "right two-thirds; preserve calmer wall, lawn, and sky in the left third for an HTML message board. "
            "Eye-level street view, inviting but credible, faces small in frame, no readable signage."
        ),
    },
    {
        "file": "street.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide eye-level view down one leafy neighborhood block with four distinct modest homes "
            "painted in coordinated pool blue, lemon yellow, soft watermelon coral, and warm paper white, "
            "clean trim, porches, sidewalks, mature trees, parked bicycle, natural summer shadows. No people "
            "prominent, no cars blocking houses, no readable house numbers, generous continuous street composition."
        ),
    },
    {
        "file": "service-interior.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide interior photograph of a real painter rolling a calm pool-blue wall in a modest sunny "
            "living room, nearby furniture fully covered with clean drop cloths, floors protected, crisp paper-white "
            "trim, one restrained coral door visible at the edge. Painter seen in profile at mid-distance, correct "
            "roller and extension pole, credible work posture, airy window light."
        ),
    },
    {
        "file": "service-cabinets.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera is unquestionably indoors in a practical enclosed family kitchen, medium-wide documentary "
            "photograph facing a full wall of leaf-green shaker cabinets beneath a visible white ceiling, with countertop, "
            "backsplash, sink, and protected wood floor all clearly in frame. One painter carefully applies an even finish "
            "to a cabinet frame; removed doors rest on an indoor rack, hardware is organized, and counters are protected. "
            "No exterior, sky, lawn, porch, garage, vehicles, or outdoor work."
        ),
    },
    {
        "file": "service-trim.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide close residential photograph of a painter finishing the paper-white trim around a rich "
            "watermelon-coral front door on a leaf-green bungalow porch, precise brushwork, protected threshold, "
            "deep-cherry hardware, warm sunlight, hand and brush anatomically correct, face outside frame."
        ),
    },
    {
        "file": "process.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Very wide documentary process photograph inside a sunlit bungalow room: two professional "
            "painters preparing one wall before coating, one inspecting and patching a small imperfection while the "
            "other masks paper-white trim and protects the floor, organized unbranded supplies, pale lemon sample "
            "patches, credible safety and body proportions. Leave broad visual detail across the entire horizontal frame."
        ),
    },
    {
        "file": "planning.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Overhead editorial photograph of a real wood porch table used for paint planning: unbranded "
            "sample boards in lemon, coral, pool blue, leaf green, paper white and deep cherry, clean brushes, roller, "
            "masking tape, pencil, blank kraft-paper notes with no writing, afternoon leaf shadows. Rich tactile realism."
        ),
    },
    {
        "file": "reviews.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide candid photograph of a painter and two adult homeowners having a friendly final walkthrough "
            "on a freshly painted lemon-yellow bungalow porch with a pool-blue door and paper-white trim, everyone "
            "standing naturally and looking at the finish rather than posing for camera, faces believable and mid-distance, "
            "warm community feeling, no testimonial sign or text."
        ),
    },
    {
        "file": "faq.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera is unquestionably indoors in a modest enclosed living room, with visible ceiling, wood floor, "
            "sofa, baseboard, and interior wall filling the frame. Wide candid consultation photograph of one local painter "
            "and one adult homeowner comparing unbranded pool-blue and soft-lemon sample boards directly against the wall. "
            "Natural body language, accurate hands, faces small and believable. No exterior, lawn, porch, sky, vehicles, "
            "outdoor work, or paperwork text."
        ),
    },
    {
        "file": "estimate.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Wide exterior consultation photograph: a friendly painter and homeowner walking toward the porch "
            "of a colorful modest bungalow while discussing the siding and front door, clean sample boards and clipboard "
            "with blank paper, lemon flowers and pool-blue porch details, ample quiet space on the left for an HTML estimate "
            "board, natural late-afternoon light, no readable text."
        ),
    },
    {
        "file": "guide-color.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide close editorial photograph of six unbranded painted sample boards in lemon, coral, pool blue, "
            "leaf green, paper white, and deep cherry leaning against existing trim on a porch, shifting afternoon sunlight "
            "revealing undertones, no hands or text."
        ),
    },
    {
        "file": "guide-prep.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide close documentary photograph of excellent residential paint preparation: a smooth repaired wall "
            "patch, crisp masking at paper-white trim, protected wood floor, sanding block and unbranded primer nearby, one "
            "gloved hand at edge of frame, no face, realistic dust control."
        ),
    },
    {
        "file": "guide-sheen.jpg",
        "quality": "basic",
        "prompt": (
            f"{WORLD} Wide photographic finish comparison of four large unbranded pool-blue painted boards showing matte, "
            "eggshell, satin, and semi-gloss response under the same warm window light, arranged on a real wood porch table, "
            "subtle believable reflection differences, no text or labels."
        ),
    },
    {
        "file": "project-porch-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photograph for a paint transformation: straight-on eye-level wide view of one "
            "modest Craftsman bungalow and full front porch, tired faded beige siding, scuffed off-white trim, weathered brown "
            "door, intact roof and mature landscaping, clear warm afternoon, no people, no renovation damage. Centered facade "
            "with all architectural lines fully visible."
        ),
    },
    {
        "file": "project-sunroom-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photograph for a paint transformation: straight-on wide view of a modest cottage "
            "with an enclosed front sunroom, faded cream siding, dull tan trim, muted gray-blue door, intact windows and roof, "
            "small garden, warm afternoon, no people. Preserve clear unique sunroom geometry and complete facade."
        ),
    },
    {
        "file": "project-bungalow-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photograph for a paint transformation: straight-on eye-level wide view of a small "
            "1950s bungalow, faded pale gray clapboard, worn cream trim, dark brown front door, low roof, two front windows, "
            "simple steps and established shrubs, warm afternoon, no people, complete structure visible."
        ),
    },
    {
        "file": "project-door-before.jpg",
        "quality": "high",
        "prompt": (
            f"{WORLD} Camera-locked source photograph for a paint transformation: wide close frontal view of a modest bungalow "
            "entry, dull beige paneled front door, worn off-white casing, muted sage siding, original porch light and brass "
            "hardware, intact threshold, afternoon light, no person, all door and trim geometry clearly visible."
        ),
    },
]

EDITS = [
    {
        "file": "project-porch-after.jpg",
        "reference": "project-porch-before.jpg",
        "prompt": (
            "Use the supplied bungalow photograph as the exact immutable scene. Lock camera, lens, crop, perspective, roof, "
            "porch, windows, door geometry, steps, landscaping, sky, sunlight, shadows, and every nonpainted object. Change "
            "paint only: siding becomes believable pool blue, trim becomes warm paper white, and the front door becomes deep "
            "cherry red with a clean professional finish. Remove only visible paint wear. No remodel, repair, new object, "
            "moved plant, changed weather, person, text, logo, sign, or altered architecture. Return a photoreal photograph."
        ),
    },
    {
        "file": "project-sunroom-after.jpg",
        "reference": "project-sunroom-before.jpg",
        "prompt": (
            "Use the supplied cottage sunroom photograph as the exact immutable scene. Lock camera, lens, crop, perspective, "
            "roof, enclosed-sunroom geometry, windows, door, garden, sky, sunlight, shadows, and every nonpainted object. Change "
            "paint only: siding becomes a soft believable lemon yellow, sunroom and window trim become deep cherry, and the front "
            "door becomes pool blue with a professional finish. Remove only visible paint wear. No remodel, new object, changed "
            "weather, people, text, signage, or altered architecture. Return a photoreal photograph."
        ),
    },
    {
        "file": "project-bungalow-after.jpg",
        "reference": "project-bungalow-before.jpg",
        "prompt": (
            "Use the supplied 1950s bungalow photograph as the exact immutable scene. Lock camera, lens, crop, perspective, roof, "
            "windows, steps, shrubs, sky, sunlight, shadows, and every nonpainted object. Change paint only: clapboard becomes a "
            "warm restrained watermelon coral, trim becomes paper white, and the front door becomes leaf green with a professional "
            "finish. Remove only visible paint wear. No remodel, landscaping change, new object, person, text, sign, or altered "
            "architecture. Return a photoreal photograph."
        ),
    },
    {
        "file": "project-door-after.jpg",
        "reference": "project-door-before.jpg",
        "prompt": (
            "Use the supplied bungalow-entry photograph as the exact immutable scene. Lock camera, lens, crop, door panels, casing, "
            "siding, porch light, hardware, threshold, sunlight, shadows, and every nonpainted object. Change paint only: front door "
            "becomes rich watermelon coral, casing becomes crisp paper white, and existing siding becomes a fresh restrained leaf "
            "green. Preserve hardware exactly and remove only visible paint wear. No remodel, new decoration, person, text, sign, "
            "or changed geometry. Return a photoreal photograph."
        ),
    },
]


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout)
    return result


def sha256(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def save_ledger(ledger: dict) -> None:
    LEDGER.write_text(json.dumps(ledger, indent=2) + "\n", encoding="utf-8")


def load_ledger() -> dict:
    if LEDGER.exists():
        current = json.loads(LEDGER.read_text(encoding="utf-8"))
        if current.get("mediaKind") == "photorealistic-generated-photography" and isinstance(
            current.get("assets"), dict
        ):
            return current
    return {
        "template": "painter12-lemonade-stand",
        "route": "/templates/painter12",
        "brand": "True Coat",
        "variant": "Lemonade Stand",
        "mediaKind": "photorealistic-generated-photography",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "artDirection": (
            "Sunny, believable neighborhood painting photography with modest homes, practical crews, "
            "warm summer light, and saturated but plausible Lemonade Stand paint accents."
        ),
        "rightsStatus": "verification-required-before-publication",
        "truthNote": (
            "Photorealistic media generated through the authenticated Higgsfield account for this fictional "
            "template; not documented client projects or verified customer proof."
        ),
        "assets": {},
        "pairs": [],
    }


def create_image(prompt: str, quality: str, reference: Path | None = None) -> str:
    for attempt in range(6):
        command = [
            "higgsfield",
            "generate",
            "create",
            "seedream_v4_5",
            "--prompt",
            prompt,
            "--aspect_ratio",
            "16:9",
            "--quality",
            quality,
        ]
        if reference:
            command.extend(["--image", str(reference)])
        result = run(command, check=False)
        if result.returncode == 0:
            return result.stdout.strip()
        message = result.stderr or result.stdout
        if "rate_limit" in message.lower() and attempt < 5:
            delay = 20 * (attempt + 1)
            print(f"rate limited; retrying in {delay}s", flush=True)
            time.sleep(delay)
            continue
        raise RuntimeError(message)
    raise RuntimeError("Higgsfield image generation exhausted retries")


def wait_result(job_id: str, timeout: str = "15m") -> dict:
    run(["higgsfield", "generate", "wait", job_id, "--timeout", timeout, "--interval", "5s"])
    payload = json.loads(run(["higgsfield", "generate", "get", job_id, "--json"]).stdout)
    if payload.get("status") != "completed" or not payload.get("result_url"):
        raise RuntimeError(f"Job {job_id} did not complete: {payload.get('status')}")
    return payload


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, destination)


def optimize(downloaded: Path, destination: Path) -> dict[str, dict[str, int | str]]:
    with Image.open(downloaded) as source:
        image = ImageOps.fit(
            source.convert("RGB"),
            (1600, 1000),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
    image.save(destination, "JPEG", quality=88, optimize=True, progressive=True)
    variants: dict[str, dict[str, int | str]] = {}
    for width in (800, 1200):
        resized = image.resize((width, round(width / 1.6)), Image.Resampling.LANCZOS)
        variant = destination.with_name(f"{destination.stem}-{width}.jpg")
        resized.save(variant, "JPEG", quality=82, optimize=True, progressive=True)
        variants[str(width)] = {
            "file": variant.name,
            "width": width,
            "height": round(width / 1.6),
            "bytes": variant.stat().st_size,
            "sha256": sha256(variant),
        }
    downloaded.unlink(missing_ok=True)
    return variants


def generate_image(ledger: dict, role: dict[str, str], reference: Path | None = None) -> None:
    filename = role["file"]
    destination = OUT / filename
    existing = ledger["assets"].get(filename, {})
    if destination.exists() and existing.get("provider") == "Higgsfield" and filename not in FORCE_FILES:
        print(f"skip {filename}", flush=True)
        return
    print(f"generate {filename}", flush=True)
    job_id = create_image(role["prompt"], role.get("quality", "high"), reference)
    payload = wait_result(job_id)
    downloaded = OUT / f".{filename}.download"
    download(payload["result_url"], downloaded)
    variants = optimize(downloaded, destination)
    ledger["assets"][filename] = {
        "provider": "Higgsfield",
        "model": "Seedream 4.5",
        "jobId": job_id,
        "prompt": role["prompt"],
        "reference": reference.name if reference else None,
        "aspectRatio": "16:9",
        "width": 1600,
        "height": 1000,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
        "variants": variants,
    }
    save_ledger(ledger)
    print(f"wrote {filename}", flush=True)


def generate_video(ledger: dict) -> None:
    filename = "hero-motion.mp4"
    destination = OUT / filename
    existing = ledger["assets"].get(filename, {})
    if destination.exists() and existing.get("provider") == "Higgsfield" and filename not in FORCE_FILES:
        print(f"skip {filename}", flush=True)
        return
    prompt = (
        "Use the supplied photoreal neighborhood-painter hero photograph as the exact scene. Lock camera, lens, "
        "crop, house geometry, paint colors, porch, crew identity, clothing, tools, tree, lawn, and every object. "
        "Create one seamless six-second natural summer moment: a very gentle breeze moves a few leaves and the edge "
        "of the canvas awning, soft sunlight shifts subtly across the painted siding, and the crew makes only tiny "
        "natural posture movements. No camera move, zoom, cut, morphing, walking, talking, new object, changed face, "
        "changed hands, text, logo, sign, watermark, or audio. Maintain photographic realism throughout."
    )
    print(f"generate {filename}", flush=True)
    job_id = run(
        [
            "higgsfield",
            "generate",
            "create",
            "seedance_2_0_mini",
            "--prompt",
            prompt,
            "--start-image",
            str(OUT / "hero.jpg"),
            "--aspect_ratio",
            "16:9",
            "--duration",
            "6",
            "--generate_audio",
            "false",
            "--resolution",
            "720p",
            "--bitrate_mode",
            "standard",
        ]
    ).stdout.strip()
    payload = wait_result(job_id, "25m")
    downloaded = OUT / ".hero-motion.download.mp4"
    download(payload["result_url"], downloaded)
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(downloaded),
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(destination),
        ]
    )
    downloaded.unlink(missing_ok=True)
    ledger["assets"][filename] = {
        "provider": "Higgsfield",
        "model": "Seedance 2.0 Mini",
        "jobId": job_id,
        "prompt": prompt,
        "reference": "hero.jpg",
        "durationSeconds": 6,
        "bytes": destination.stat().st_size,
        "sha256": sha256(destination),
    }
    save_ledger(ledger)
    print(f"wrote {filename}", flush=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ledger = load_ledger()
    for role in ROLES:
        if FORCE_FILES and role["file"] not in FORCE_FILES:
            continue
        generate_image(ledger, role)
    for edit in EDITS:
        if FORCE_FILES and edit["file"] not in FORCE_FILES:
            continue
        reference = OUT / edit["reference"]
        if not reference.exists():
            raise RuntimeError(f"Missing comparison reference {reference.name}")
        generate_image(ledger, edit, reference)
    ledger["pairs"] = [
        {
            "id": before["file"].removeprefix("project-").removesuffix("-before.jpg"),
            "before": before["file"],
            "after": after["file"],
            "sameProperty": True,
            "sameCameraRequired": True,
            "afterGeneratedFromBeforeReference": True,
        }
        for before, after in zip(ROLES[-4:], EDITS)
    ]
    save_ledger(ledger)
    if not FORCE_FILES or "hero-motion.mp4" in FORCE_FILES:
        generate_video(ledger)
    save_ledger(ledger)
    print(f"ledger -> {LEDGER}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise
